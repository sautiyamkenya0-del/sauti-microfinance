import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { requireSignedInSession, requireStaffActor } from "@/lib/auth.server";
import { streamGroqChat } from "@/lib/groq.server";

type AiTableSpec = {
  key: string;
  table: string;
  columns?: string;
  limit?: number;
  build?: (query: any) => any;
  directorOnly?: boolean;
};

const DEFAULT_AI_TABLE_LIMIT = 1000;
const HEAVY_AI_TABLE_LIMIT = 3000;

function missingTableOrColumn(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "42703" ||
    message.includes("does not exist") ||
    message.includes("column")
  );
}

async function readAiTable(db: any, spec: AiTableSpec) {
  let query = db.from(spec.table).select(spec.columns ?? "*");
  if (spec.build) query = spec.build(query);
  query = query.limit(spec.limit ?? DEFAULT_AI_TABLE_LIMIT);

  const { data, error } = await query;
  if (error) {
    if (missingTableOrColumn(error)) {
      return { key: spec.key, rows: [], warning: `${spec.table}: ${error.message}` };
    }
    throw new Error(error.message);
  }
  return { key: spec.key, rows: data ?? [], warning: undefined };
}

async function buildStaffAiSnapshot(clientSnapshot: unknown) {
  const actor = await requireStaffActor();
  const isDirector = actor.role === "director";
  const db = getSupabaseAdminOrNull() as any;
  if (!db) {
    return {
      clientSnapshot,
      serverSnapshotUnavailable:
        "Supabase admin client is not configured, so SautiAI is using the client snapshot only.",
    };
  }

  const specs: AiTableSpec[] = [
    {
      key: "staff",
      table: "staff",
      columns: "id, name, role, email, can_mark_attendance, created_at, updated_at",
      build: (query) => query.order("id", { ascending: true }),
    },
    {
      key: "members",
      table: "members",
      columns:
        "id, name, phone, member_category, status, savings_balance, shares, joined_at, fee_membership, fee_card, fee_sticker, fee_first_upfront_paid, created_at, updated_at",
      build: (query) => query.order("id", { ascending: true }),
    },
    {
      key: "investors",
      table: "investors",
      columns: "id, member_id, name, amount, status, joined_at, updated_at",
      build: (query) => query.order("joined_at", { ascending: false }),
    },
    {
      key: "loans",
      table: "loans",
      limit: HEAVY_AI_TABLE_LIMIT,
      build: (query) => query.order("start_date", { ascending: false }),
    },
    {
      key: "transactions",
      table: "transactions",
      limit: HEAVY_AI_TABLE_LIMIT,
      columns:
        "id, member_id, loan_id, date, type, amount, ref, account, note, created_at, updated_at",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "mpesaEvents",
      table: "mpesa_events",
      limit: HEAVY_AI_TABLE_LIMIT,
      columns: "id, account, amount, phone, mpesa_ref, processed, transaction_id, created_at",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "mpesaReceiptAllocations",
      table: "mpesa_receipt_allocations",
      limit: HEAVY_AI_TABLE_LIMIT,
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "pettyCash",
      table: "petty_cash",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "penalties",
      table: "penalties",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "roundOff",
      table: "round_off",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "attendance",
      table: "attendance",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "appraisals",
      table: "appraisals",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "fieldVisits",
      table: "field_visits",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "followups",
      table: "followups",
      build: (query) => query.order("date", { ascending: false }),
    },
    {
      key: "feePolicies",
      table: "fee_policies",
      build: (query) => query.order("updated_at", { ascending: false }),
    },
    { key: "policySettings", table: "policy_settings" },
    {
      key: "performanceTargets",
      table: "performance_targets",
      build: (query) => query.order("start_on", { ascending: false }),
    },
    {
      key: "memberCarryoverLoans",
      table: "member_carryover_loans",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "suppliers",
      table: "suppliers",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "supplierFulfillmentRequests",
      table: "supplier_fulfillment_requests",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "supplierInventory",
      table: "supplier_inventory_items",
      build: (query) => query.order("updated_at", { ascending: false }),
    },
    {
      key: "internalStore",
      table: "internal_store_items",
      build: (query) => query.order("updated_at", { ascending: false }),
    },
    { key: "memberDocketBalances", table: "member_docket_balances" },
    {
      key: "memberDocketMovements",
      table: "member_docket_movements",
      limit: HEAVY_AI_TABLE_LIMIT,
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "systemOutflows",
      table: "system_outflows",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "systemPayoutRequests",
      table: "system_payout_requests",
      build: (query) => query.order("created_at", { ascending: false }),
      directorOnly: true,
    },
    { key: "staffPayrollProfiles", table: "staff_payroll_profiles", directorOnly: true },
    {
      key: "staffPayrollPayments",
      table: "staff_payroll_payments",
      build: (query) => query.order("created_at", { ascending: false }),
      directorOnly: true,
    },
    {
      key: "staffMemos",
      table: "staff_memos",
      build: (query) => query.order("memo_date", { ascending: false }),
    },
    {
      key: "approvalRequests",
      table: "approval_requests",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "supportThreads",
      table: "support_threads",
      build: (query) => query.order("updated_at", { ascending: false }),
    },
    {
      key: "supportMessages",
      table: "support_messages",
      limit: 20000,
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "auditLog",
      table: "audit_log",
      limit: 1000,
      build: (query) => query.order("ts", { ascending: false }),
      directorOnly: true,
    },
    {
      key: "staffMessages",
      table: "staff_messages",
      limit: 1000,
      build: (query) => query.order("created_at", { ascending: false }),
      directorOnly: true,
    },
    {
      key: "reportSnapshots",
      table: "report_snapshots",
      build: (query) => query.order("created_at", { ascending: false }),
    },
    {
      key: "mpesaCallbackErrors",
      table: "mpesa_callback_errors",
      limit: 10000,
      build: (query) => query.order("created_at", { ascending: false }),
    },
  ];

  const allowedSpecs = specs.filter((spec) => isDirector || !spec.directorOnly);
  const entries = await Promise.all(allowedSpecs.map((spec) => readAiTable(db, spec)));
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  const warnings: string[] = [];
  for (const entry of entries) {
    tables[entry.key] = entry.rows;
    counts[entry.key] = entry.rows.length;
    if (entry.warning) warnings.push(entry.warning);
  }

  return {
    audience: "staff",
    currentStaff: actor,
    access: isDirector
      ? "director read context for SautiAI analysis across available system tables; money movement still needs a human-confirmed system action."
      : "staff read context for SautiAI analysis with sensitive payroll, payout, staff-message, and audit tables withheld; money movement still needs a human-confirmed system action.",
    moneyDockets: [
      "daily_compliance_contribution",
      "withdrawable_savings",
      "loan_savings",
      "shares",
      "share_reserve",
      "full_purpose_pool",
      "investment",
      "penalty_payment",
      "supplier_payables",
      "client_withdrawals",
      "investor_withdrawals",
      "staff_payments",
      "loan_disbursements",
      "petty_cash",
    ],
    purposePoolDistribution: [
      ["Levies & Permits Fund", 40],
      ["Welfare Fund", 15],
      ["Legal Fund", 20],
      ["Operations/Admin", 25],
    ],
    generatedAt: new Date().toISOString(),
    counts,
    warnings,
    tables,
    clientSnapshot,
  };
}

async function buildMemberAiSnapshot(memberId: string, clientSnapshot: unknown) {
  const db = getSupabaseAdminOrNull() as any;
  if (!db) return clientSnapshot;

  const specs: AiTableSpec[] = [
    {
      key: "member",
      table: "members",
      build: (query) => query.eq("id", memberId).limit(1),
    },
    {
      key: "loans",
      table: "loans",
      build: (query) => query.eq("member_id", memberId).order("start_date", { ascending: false }),
    },
    {
      key: "transactions",
      table: "transactions",
      limit: 500,
      build: (query) => query.eq("member_id", memberId).order("created_at", { ascending: false }),
    },
    {
      key: "penalties",
      table: "penalties",
      build: (query) => query.eq("member_id", memberId).order("date", { ascending: false }),
    },
    {
      key: "roundOff",
      table: "round_off",
      build: (query) => query.eq("member_id", memberId).order("date", { ascending: false }),
    },
    {
      key: "supplierRequests",
      table: "supplier_fulfillment_requests",
      build: (query) => query.eq("member_id", memberId).order("created_at", { ascending: false }),
    },
    {
      key: "feePolicies",
      table: "fee_policies",
      build: (query) => query.order("updated_at", { ascending: false }),
    },
    { key: "policySettings", table: "policy_settings" },
  ];

  const entries = await Promise.all(specs.map((spec) => readAiTable(db, spec)));
  const tables: Record<string, unknown[]> = {};
  const warnings: string[] = [];
  for (const entry of entries) {
    tables[entry.key] = entry.rows;
    if (entry.warning) warnings.push(entry.warning);
  }

  return {
    audience: "member",
    generatedAt: new Date().toISOString(),
    warnings,
    tables,
    clientSnapshot,
  };
}

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const session = await requireSignedInSession();
          const { messages, snapshot, role, mode } = await request.json();
          const safeMode = session.authMode === "member" ? "customer" : mode;
          const safeRole = session.authMode === "member" ? "member" : role;
          const enrichedSnapshot =
            session.authMode === "member" && session.memberId
              ? await buildMemberAiSnapshot(session.memberId, snapshot)
              : await buildStaffAiSnapshot(snapshot);

          const system =
            safeMode === "customer"
              ? `You are SautiAI, the friendly first-line customer care assistant for Sauti Microfinance (Sauti Business Community / SBC), a Kenyan SACCO that runs on M-Pesa Paybill.
You are speaking directly to a member.

Voice and style:
- Be warm, natural, plain-spoken, and reassuring.
- Use plain text only. Do not use markdown, asterisks, bold, headings, or code formatting.
- Keep replies concise unless the member asks for more detail.
- Light humor is welcome in small doses if it feels natural. Never be cheesy or dismissive.
- Format money as KSh.
- Do not repeat generic portal summaries after every answer.

You can help with:
- How to pay using Paybill and the account number format.
- Their daily compliance contribution, shares, active loans, and fees using the snapshot below.
- Loan eligibility basics: members first build KSh 5,000 in daily compliance contribution / mandatory savings and KSh 3,000 in mandatory shares, mandatory fees clear first, and the sticker fee only applies to members with a permanent business or physical shop.
- Loan terms, penalties, round-off, and general Sauti questions.

Boundaries:
- You cannot approve loans, change phone numbers, reset PINs, or move money. Say clearly that those need staff approval.
- If the member is upset, asks for a human, or you do not know the answer, encourage them to tap Talk to a real person.
- If the question needs live outside information such as weather, breaking news, or politics, say you cannot verify live external information from inside SautiAI.
- If the question is general and not time-sensitive, you may answer briefly and then gently steer back to Sauti topics.
- Do not reveal staff names, internal IDs, or other members' data.

Member context:
${JSON.stringify(enrichedSnapshot).slice(0, 12000)}`
              : `You are SautiAI, the in-app assistant for Sauti Microfinance, a Kenyan SACCO running on M-Pesa Paybill (account format SBC###).
You are speaking to internal staff. You have director-grade read access to the included live system snapshot and may propose actions, but the human must confirm before anything is written.

Voice and style:
- Sound warm, calm, capable, and easy to talk to.
- Use plain text only. Do not use markdown, asterisks, bold, headings, or code formatting.
- Keep replies concise unless the user asks for depth.
- Use KSh for money.
- Light humor is welcome occasionally, but keep it tasteful and never at a member's expense.
- Do not dump role, counts, Current State, or Issues detected blocks unless they help answer the question.

Working rules:
- Use the server-built snapshot below as your source for Sauti data. It includes members, investors, loans, transactions, M-Pesa records, suppliers, stock, fuel/service requests, every available money docket, outflows, payroll, approvals, support, policy settings, staff messages, report snapshots, callback errors, and audit history when those tables exist.
- When asked about a member, loan, or transaction, find it by id, name, or phone.
- When asked about money movement dockets, remember Full purpose pool as a source excludes Operations/Admin, while Full purpose pool as a receiver includes Operations/Admin.
- Purpose pool is Levies & Permits 40%, Welfare 15%, Legal 20%, Operations/Admin 25%.
- Use "daily compliance contribution" in user-facing wording.
- If you detect anomalies such as overdue loans, savings shortfalls, unusual outflows, or mis-allocated M-Pesa payments, call them out clearly under the plain label: Issues detected:
- For action requests such as approvals, postings, or disbursements, respond with a short proposal and end with: Confirm to apply.
- Never claim an action is already done unless the snapshot explicitly shows it already happened.
- Respect role: the current role is ${safeRole}. If a request reaches beyond that role, say so plainly.

Off-topic handling:
- If the request needs live external information such as weather, breaking news, or political officeholders, say you cannot verify live outside data from inside SautiAI.
- If the request is general non-time-sensitive knowledge, answer briefly, then pivot back naturally.

Snapshot:
${JSON.stringify(enrichedSnapshot).slice(0, 50000)}`;

          const fullMessages = [{ role: "system", content: system }, ...messages];
          return await streamGroqChat(fullMessages);
        } catch (e: unknown) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Unknown error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
