import http from "node:http";
import { createHash } from "node:crypto";

import mysql from "mysql2";
import mysqlPromise from "mysql2/promise";

function toPort(value, fallback) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : fallback;
}

function toTimeout(value, fallback) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) && next >= 1000 ? Math.floor(next) : fallback;
}

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireSafeIdentifier(value, label) {
  const next = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(next)) {
    throw new Error(`Unsafe ${label} identifier "${value}". Use letters, numbers, and underscores only.`);
  }
  return next;
}

function legacyTableCandidates(configuredTable) {
  const candidates = [configuredTable?.trim(), "api_topup", "api_topups"].filter(
    (value) => Boolean(value && String(value).trim().length > 0),
  );

  return [...new Set(candidates.map((value) => requireSafeIdentifier(value, "table")))];
}

function normalizeColumnName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(columns, candidates, override) {
  if (override) {
    const exact = columns.find(
      (column) => normalizeColumnName(column) === normalizeColumnName(override),
    );
    if (exact) return exact;
  }

  for (const candidate of candidates) {
    const match = columns.find(
      (column) => normalizeColumnName(column) === normalizeColumnName(candidate),
    );
    if (match) return match;
  }
  return undefined;
}

function readUnknown(row, key) {
  if (!key) return undefined;
  return row[key];
}

function readText(row, key) {
  const value = readUnknown(row, key);
  if (value == null) return undefined;
  const next = String(value).trim();
  return next || undefined;
}

function readNumber(row, key) {
  const value = readUnknown(row, key);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const next = Number(normalized);
    return Number.isFinite(next) ? next : 0;
  }
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function readDateTime(row, key) {
  const value = readUnknown(row, key);
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const next = new Date(String(value));
  return Number.isNaN(next.getTime()) ? undefined : next.toISOString();
}

function rawRowToObject(row) {
  return JSON.parse(JSON.stringify(row));
}

function findDirectKey(row, candidates) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const match = keys.find((key) => normalizeColumnName(key) === normalizeColumnName(candidate));
    if (match) return match;
  }
  return undefined;
}

function buildPayerName(row, mappings) {
  const direct = readText(row, mappings.payerName);
  if (direct) return direct;

  const parts = [
    readText(row, findDirectKey(row, ["first_name", "firstname", "fname"])),
    readText(row, findDirectKey(row, ["middle_name", "middlename", "mname"])),
    readText(row, findDirectKey(row, ["last_name", "lastname", "surname"])),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildSourceKey(row, sourceTable, mappings) {
  const preferred = readText(row, mappings.id) ?? readText(row, mappings.ref) ?? undefined;
  if (preferred) return `${sourceTable}:${preferred}`;

  const hash = createHash("sha1").update(JSON.stringify(rawRowToObject(row))).digest("hex");
  return `${sourceTable}:sha1:${hash}`;
}

function rowToTopup(row, sourceTable, mappings) {
  const mappingNotes = [];
  const sourceAmount = readNumber(row, mappings.amount);
  const sourceAccount = readText(row, mappings.account);
  const sourceMemberHint = readText(row, mappings.memberHint);
  const sourceRef = readText(row, mappings.ref);
  const statusValue = readText(row, mappings.status)?.toLowerCase();

  if (!mappings.amount) mappingNotes.push("No amount column was detected automatically.");
  if (!mappings.account && !mappings.memberHint) {
    mappingNotes.push("No SBC/member account column was detected automatically.");
  }
  if (!sourceAccount && sourceMemberHint) {
    mappingNotes.push(`Using "${mappings.memberHint}" as the member/account hint.`);
  }
  if (statusValue) {
    mappingNotes.push(`Source status: ${statusValue}`);
  }

  return {
    sourceKey: buildSourceKey(row, sourceTable, mappings),
    sourceTable,
    sourceCreatedAt: readDateTime(row, mappings.createdAt),
    sourceAccount,
    sourceMemberHint,
    sourcePayerName: buildPayerName(row, mappings),
    sourcePhone: readText(row, mappings.phone),
    sourceAmount,
    sourceRef,
    raw: rawRowToObject(row),
    mappingNotes,
  };
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const bridgeKey = String(process.env.OLD_DB_BRIDGE_KEY ?? "").trim() || undefined;
const dbHost = requireEnv("OLD_DB_HOST");
const dbName = requireEnv("OLD_DB_NAME");
const dbUser = requireEnv("OLD_DB_USER");
const dbPass = requireEnv("OLD_DB_PASS");
const dbPort = toPort(process.env.OLD_DB_PORT, 3306);
const configuredSourceTable = String(process.env.OLD_DB_TOPUP_TABLE ?? "").trim() || undefined;
const connectTimeout = toTimeout(process.env.OLD_DB_CONNECT_TIMEOUT_MS, 10000);
const queryTimeout = toTimeout(process.env.OLD_DB_QUERY_TIMEOUT_MS, 15000);
const bindHost = String(process.env.OLD_DB_BRIDGE_BIND ?? "127.0.0.1").trim() || "127.0.0.1";
const bindPort = toPort(process.env.OLD_DB_BRIDGE_PORT ?? process.env.PORT, 8788);

const pool = mysqlPromise.createPool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPass,
  database: dbName,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 0,
  namedPlaceholders: false,
  multipleStatements: false,
  supportBigNumbers: true,
  decimalNumbers: true,
  connectTimeout,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

async function queryLegacy(sql, values) {
  return pool.query({ sql, timeout: queryTimeout }, values);
}

async function resolveLegacySourceTable() {
  const checkedTables = [];

  for (const tableName of legacyTableCandidates(configuredSourceTable)) {
    checkedTables.push(tableName);
    try {
      const [, fields] = await queryLegacy(`SELECT * FROM ${mysql.escapeId(tableName)} LIMIT 1`);
      return {
        sourceTable: tableName,
        fields: fields ?? [],
      };
    } catch (error) {
      if (String(error?.code ?? "") === "ER_NO_SUCH_TABLE") continue;
      throw error;
    }
  }

  throw new Error(`Could not find a legacy topup table. Checked: ${checkedTables.join(", ")}.`);
}

async function loadLegacyTopups(limit) {
  const { sourceTable, fields } = await resolveLegacySourceTable();
  const escapedTable = mysql.escapeId(sourceTable);
  const columns = (fields ?? []).map((field) => field.name);
  if (!columns.length) {
    return { columns: [], mappings: {}, rows: [] };
  }

  const mappings = {
    id: findColumn(
      columns,
      ["id", "topup_id", "api_topup_id", "transid", "transaction_id"],
      process.env.OLD_DB_TOPUP_ID_COLUMN,
    ),
    amount: findColumn(
      columns,
      ["amount", "trans_amount", "transamount", "paid_amount", "total_amount"],
      process.env.OLD_DB_TOPUP_AMOUNT_COLUMN,
    ),
    account: findColumn(
      columns,
      ["account", "bill_ref_number", "billrefnumber", "membership_no", "member_no", "sbc", "account_no"],
      process.env.OLD_DB_TOPUP_ACCOUNT_COLUMN,
    ),
    memberHint: findColumn(
      columns,
      ["member_id", "memberid", "sbc_id", "membership_id"],
      process.env.OLD_DB_TOPUP_MEMBER_COLUMN,
    ),
    ref: findColumn(
      columns,
      ["mpesa_ref", "transid", "reference", "ref", "receipt"],
      process.env.OLD_DB_TOPUP_REF_COLUMN,
    ),
    phone: findColumn(
      columns,
      ["phone", "msisdn", "mobile", "mobile_no"],
      process.env.OLD_DB_TOPUP_PHONE_COLUMN,
    ),
    payerName: findColumn(
      columns,
      ["payer_name", "name", "customer_name", "full_name"],
      process.env.OLD_DB_TOPUP_PAYER_COLUMN,
    ),
    createdAt: findColumn(
      columns,
      ["created_at", "createdon", "date_created", "transaction_date", "trans_time", "posted_at", "date"],
      process.env.OLD_DB_TOPUP_CREATED_AT_COLUMN,
    ),
    status: findColumn(
      columns,
      ["status", "processed", "state", "sync_status"],
      process.env.OLD_DB_TOPUP_STATUS_COLUMN,
    ),
  };

  const orderColumn = requireSafeIdentifier(
    mappings.createdAt ?? mappings.id ?? columns[0],
    "order column",
  );
  const batchSize = Math.max(1, Math.min(500, Math.floor(Number(limit ?? 100) || 100)));
  const [rows] = await queryLegacy(
    `SELECT * FROM ${escapedTable} ORDER BY ${mysql.escapeId(orderColumn)} DESC LIMIT ?`,
    [batchSize],
  );

  return {
    columns,
    mappings,
    rows: rows.map((row) => rowToTopup(row, sourceTable, mappings)),
  };
}

function isAuthorized(req) {
  if (!bridgeKey) return true;
  const authHeader = String(req.headers.authorization ?? "");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const headerKey = String(req.headers["x-bridge-key"] ?? "").trim();
  return bearer === bridgeKey || headerKey === bridgeKey;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 400, { ok: false, error: "Missing request URL." });
      return;
    }

    if (!isAuthorized(req)) {
      json(res, 401, { ok: false, error: "Unauthorized." });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method !== "GET") {
      json(res, 405, { ok: false, error: "Only GET is supported." });
      return;
    }

    if (url.pathname === "/health") {
      const { sourceTable } = await resolveLegacySourceTable();
      json(res, 200, {
        ok: true,
        sourceTable,
        host: dbHost,
        database: dbName,
        mode: "bridge",
      });
      return;
    }

    if (url.pathname === "/topups") {
      const scan = await loadLegacyTopups(url.searchParams.get("limit"));
      json(res, 200, scan);
      return;
    }

    json(res, 404, { ok: false, error: "Not found." });
  } catch (error) {
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown bridge error.",
    });
  }
});

server.listen(bindPort, bindHost, () => {
  console.log(
    `[legacy-topup-bridge] listening on http://${bindHost}:${bindPort} for legacy topup sync`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close(() => {
      process.exit(0);
    });
    try {
      await pool.end();
    } catch {}
  });
}
