import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import mysql from "mysql2";
import type { FieldPacket, Pool } from "mysql2/promise";
import mysqlPromise from "mysql2/promise";

import { readServerEnv } from "@/lib/server-env";

export type LegacyTopupSourceRow = {
  sourceKey: string;
  sourceTable: string;
  sourceCreatedAt?: string;
  sourceAccount?: string;
  sourceMemberHint?: string;
  sourcePayerName?: string;
  sourcePhone?: string;
  sourceAmount: number;
  sourceRef?: string;
  raw: Record<string, unknown>;
  mappingNotes: string[];
};

export type LegacyTopupSourceScan = {
  columns: string[];
  mappings: {
    id?: string;
    amount?: string;
    account?: string;
    memberHint?: string;
    ref?: string;
    phone?: string;
    payerName?: string;
    createdAt?: string;
    status?: string;
  };
  rows: LegacyTopupSourceRow[];
};

function toPort(value: string | undefined, fallback: number) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : fallback;
}

function toTimeout(value: string | undefined, fallback: number) {
  const next = Number(value ?? fallback);
  return Number.isFinite(next) && next >= 1000 ? Math.floor(next) : fallback;
}

export function getLegacyDbEnvStatus() {
  const bridgeUrl = readServerEnv("OLD_DB_BRIDGE_URL");
  const bridgeKey = readServerEnv("OLD_DB_BRIDGE_KEY");
  const host = readServerEnv("OLD_DB_HOST");
  const database = readServerEnv("OLD_DB_NAME");
  const user = readServerEnv("OLD_DB_USER");
  const password = readServerEnv("OLD_DB_PASS");
  const port = toPort(readServerEnv("OLD_DB_PORT"), 3306);
  const table = readServerEnv("OLD_DB_TOPUP_TABLE") || "api_topup";
  const mode = bridgeUrl ? "bridge" : "direct";
  const missing =
    mode === "bridge"
      ? []
      : [
          ...(!host ? ["OLD_DB_HOST"] : []),
          ...(!database ? ["OLD_DB_NAME"] : []),
          ...(!user ? ["OLD_DB_USER"] : []),
          ...(!password ? ["OLD_DB_PASS"] : []),
        ];

  return {
    mode,
    bridgeUrl,
    bridgeKey,
    host,
    database,
    user,
    password,
    port,
    table,
    missing,
    ok: mode === "bridge" || missing.length === 0,
  };
}

function requireSafeIdentifier(value: string, label: string) {
  const next = value.trim();
  if (!/^[A-Za-z0-9_]+$/.test(next)) {
    throw new Error(
      `Unsafe ${label} identifier "${value}". Use letters, numbers, and underscores only.`,
    );
  }
  return next;
}

let legacyPool: Pool | undefined;

function createLegacyPool() {
  const env = getLegacyDbEnvStatus();
  if (
    env.mode !== "direct" ||
    !env.ok ||
    !env.host ||
    !env.database ||
    !env.user ||
    !env.password
  ) {
    throw new Error(
      `Old database access is unavailable until these values are configured: ${env.missing.join(", ")}.`,
    );
  }

  return mysqlPromise.createPool({
    host: env.host,
    port: env.port,
    user: env.user,
    password: env.password,
    database: env.database,
    waitForConnections: true,
    connectionLimit: 4,
    queueLimit: 0,
    namedPlaceholders: false,
    multipleStatements: false,
    supportBigNumbers: true,
    decimalNumbers: true,
    connectTimeout: toTimeout(readServerEnv("OLD_DB_CONNECT_TIMEOUT_MS"), 10000),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });
}

export function getLegacyPoolOrNull() {
  const env = getLegacyDbEnvStatus();
  if (!env.ok || env.mode !== "direct") return null;
  if (!legacyPool) legacyPool = createLegacyPool();
  return legacyPool;
}

function legacyQueryTimeout() {
  return toTimeout(readServerEnv("OLD_DB_QUERY_TIMEOUT_MS"), 15000);
}

async function queryLegacy(
  pool: Pool,
  sql: string,
  values?: unknown[],
): Promise<[unknown, FieldPacket[]]> {
  return (await pool.query({ sql, timeout: legacyQueryTimeout() } as any, values)) as [
    unknown,
    FieldPacket[],
  ];
}

function normalizeColumnName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findColumn(columns: string[], candidates: string[], overrideKey?: string) {
  const override = overrideKey ? readServerEnv(overrideKey) : undefined;
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

function readUnknown(row: Record<string, unknown>, key?: string) {
  if (!key) return undefined;
  return row[key];
}

function readText(row: Record<string, unknown>, key?: string) {
  const value = readUnknown(row, key);
  if (value == null) return undefined;
  const next = String(value).trim();
  return next || undefined;
}

function readNumber(row: Record<string, unknown>, key?: string) {
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

function readDateTime(row: Record<string, unknown>, key?: string) {
  const value = readUnknown(row, key);
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const next = new Date(String(value));
  return Number.isNaN(next.getTime()) ? undefined : next.toISOString();
}

function rawRowToObject(row: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function buildPayerName(row: Record<string, unknown>, mappings: LegacyTopupSourceScan["mappings"]) {
  const direct = readText(row, mappings.payerName);
  if (direct) return direct;

  const parts = [
    readText(row, findDirectKey(row, ["first_name", "firstname", "fname"])),
    readText(row, findDirectKey(row, ["middle_name", "middlename", "mname"])),
    readText(row, findDirectKey(row, ["last_name", "lastname", "surname"])),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function findDirectKey(row: Record<string, unknown>, candidates: string[]) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const match = keys.find((key) => normalizeColumnName(key) === normalizeColumnName(candidate));
    if (match) return match;
  }
  return undefined;
}

function buildSourceKey(
  row: Record<string, unknown>,
  sourceTable: string,
  mappings: LegacyTopupSourceScan["mappings"],
) {
  const preferred = readText(row, mappings.id) ?? readText(row, mappings.ref) ?? undefined;
  if (preferred) return `${sourceTable}:${preferred}`;
  const hash = createHash("sha1")
    .update(JSON.stringify(rawRowToObject(row)))
    .digest("hex");
  return `${sourceTable}:sha1:${hash}`;
}

function rowToTopup(
  row: Record<string, unknown>,
  sourceTable: string,
  mappings: LegacyTopupSourceScan["mappings"],
) {
  const mappingNotes: string[] = [];
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
  } satisfies LegacyTopupSourceRow;
}

async function loadLegacyTopupRowsFromBridge(
  bridgeUrl: string,
  bridgeKey: string | undefined,
  limit: number,
): Promise<LegacyTopupSourceScan> {
  const baseUrl = bridgeUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutMs = toTimeout(readServerEnv("OLD_DB_BRIDGE_TIMEOUT_MS"), 15000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/topups?limit=${Math.max(1, Math.min(500, limit))}`, {
      headers: {
        Accept: "application/json",
        ...(bridgeKey ? { Authorization: `Bearer ${bridgeKey}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Legacy bridge request failed (${response.status}).`);
    }

    const payload = (await response.json()) as Partial<LegacyTopupSourceScan>;
    return {
      columns: Array.isArray(payload.columns)
        ? payload.columns.map((column) => String(column))
        : [],
      mappings:
        payload.mappings && typeof payload.mappings === "object"
          ? {
              id: typeof payload.mappings.id === "string" ? payload.mappings.id : undefined,
              amount:
                typeof payload.mappings.amount === "string" ? payload.mappings.amount : undefined,
              account:
                typeof payload.mappings.account === "string" ? payload.mappings.account : undefined,
              memberHint:
                typeof payload.mappings.memberHint === "string"
                  ? payload.mappings.memberHint
                  : undefined,
              ref: typeof payload.mappings.ref === "string" ? payload.mappings.ref : undefined,
              phone:
                typeof payload.mappings.phone === "string" ? payload.mappings.phone : undefined,
              payerName:
                typeof payload.mappings.payerName === "string"
                  ? payload.mappings.payerName
                  : undefined,
              createdAt:
                typeof payload.mappings.createdAt === "string"
                  ? payload.mappings.createdAt
                  : undefined,
              status:
                typeof payload.mappings.status === "string" ? payload.mappings.status : undefined,
            }
          : {},
      rows: Array.isArray(payload.rows)
        ? payload.rows.map((row) => ({
            sourceKey: String(row.sourceKey ?? ""),
            sourceTable: String(row.sourceTable ?? "api_topup"),
            sourceCreatedAt:
              typeof row.sourceCreatedAt === "string" ? row.sourceCreatedAt : undefined,
            sourceAccount: typeof row.sourceAccount === "string" ? row.sourceAccount : undefined,
            sourceMemberHint:
              typeof row.sourceMemberHint === "string" ? row.sourceMemberHint : undefined,
            sourcePayerName:
              typeof row.sourcePayerName === "string" ? row.sourcePayerName : undefined,
            sourcePhone: typeof row.sourcePhone === "string" ? row.sourcePhone : undefined,
            sourceAmount: Number(row.sourceAmount ?? 0),
            sourceRef: typeof row.sourceRef === "string" ? row.sourceRef : undefined,
            raw: row.raw && typeof row.raw === "object" ? row.raw : {},
            mappingNotes: Array.isArray(row.mappingNotes)
              ? row.mappingNotes.map((note) => String(note))
              : [],
          }))
        : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadLegacyTopupRows(limit: number = 100): Promise<LegacyTopupSourceScan> {
  const env = getLegacyDbEnvStatus();
  if (env.mode === "bridge" && env.bridgeUrl) {
    return loadLegacyTopupRowsFromBridge(env.bridgeUrl, env.bridgeKey, limit);
  }

  const pool = getLegacyPoolOrNull();
  if (!pool) {
    throw new Error(
      `Old database access is unavailable until these values are configured: ${env.missing.join(", ")}.`,
    );
  }

  const sourceTable = requireSafeIdentifier(env.table, "old database table");
  const escapedTable = mysql.escapeId(sourceTable);
  const [, fields] = await queryLegacy(pool, `SELECT * FROM ${escapedTable} LIMIT 1`);
  const columns = ((fields as FieldPacket[]) ?? []).map((field) => field.name);
  if (!columns.length) {
    return {
      columns: [],
      mappings: {},
      rows: [],
    };
  }

  const mappings: LegacyTopupSourceScan["mappings"] = {
    id: findColumn(
      columns,
      ["id", "topup_id", "api_topup_id", "transid", "transaction_id"],
      "OLD_DB_TOPUP_ID_COLUMN",
    ),
    amount: findColumn(
      columns,
      ["amount", "trans_amount", "transamount", "paid_amount", "total_amount"],
      "OLD_DB_TOPUP_AMOUNT_COLUMN",
    ),
    account: findColumn(
      columns,
      [
        "account",
        "bill_ref_number",
        "billrefnumber",
        "membership_no",
        "member_no",
        "sbc",
        "account_no",
      ],
      "OLD_DB_TOPUP_ACCOUNT_COLUMN",
    ),
    memberHint: findColumn(
      columns,
      ["member_id", "memberid", "sbc_id", "membership_id"],
      "OLD_DB_TOPUP_MEMBER_COLUMN",
    ),
    ref: findColumn(
      columns,
      ["mpesa_ref", "transid", "reference", "ref", "receipt"],
      "OLD_DB_TOPUP_REF_COLUMN",
    ),
    phone: findColumn(
      columns,
      ["phone", "msisdn", "mobile", "mobile_no"],
      "OLD_DB_TOPUP_PHONE_COLUMN",
    ),
    payerName: findColumn(
      columns,
      ["payer_name", "name", "customer_name", "full_name"],
      "OLD_DB_TOPUP_PAYER_COLUMN",
    ),
    createdAt: findColumn(
      columns,
      [
        "created_at",
        "createdon",
        "date_created",
        "transaction_date",
        "trans_time",
        "posted_at",
        "date",
      ],
      "OLD_DB_TOPUP_CREATED_AT_COLUMN",
    ),
    status: findColumn(
      columns,
      ["status", "processed", "state", "sync_status"],
      "OLD_DB_TOPUP_STATUS_COLUMN",
    ),
  };

  const orderColumn = mappings.createdAt ?? mappings.id ?? columns[0];
  const safeOrderColumn = requireSafeIdentifier(orderColumn, "old database order column");
  const batchSize = Math.max(1, Math.min(500, Math.floor(limit || 100)));
  const [fullRows] = await queryLegacy(
    pool,
    `SELECT * FROM ${escapedTable} ORDER BY ${mysql.escapeId(safeOrderColumn)} DESC LIMIT ?`,
    [batchSize],
  );

  return {
    columns,
    mappings,
    rows: (fullRows as Record<string, unknown>[]).map((row) =>
      rowToTopup(row, sourceTable, mappings),
    ),
  };
}
