import { createServerFn } from "@tanstack/react-start";
import {
  getAuthSessionData,
  hashPassword,
  requireDirectorActor,
  requireManagerOrDirectorActor,
  requireMemberActor,
  requireSignedInSession,
  requireStaffActor,
} from "@/lib/auth.server";
import { recordAudit } from "@/lib/audit.server";
import {
  DEFAULT_FEE_POLICIES,
  feePolicyAppliesToMember,
  feePolicyAmount,
  normalizeFeePolicies,
  type FeePolicy,
} from "@/lib/fees-policy";
import {
  formatMembershipNumber,
  isInvestorCategory,
  isInvestorOnlyCategory,
  membershipIdCandidates,
  nextMembershipNumber,
  normalizeMembershipNumber,
  resolveMemberCategory,
  type MemberCategory,
} from "@/lib/membership";
import {
  DEFAULT_POLICY_SETTINGS,
  POLICY_SETTING_LABELS,
  clonePolicySettings,
  mergePolicySettings,
  policySettingsRowsFromConfig,
  waterfallRuleForScenario,
  type PolicySettingKey,
  type PolicySettingRow,
} from "@/lib/policy-settings";
import { summarizeLegacyCarryoverLoan } from "@/lib/legacy-finance";
import { isValidLocalKenyanPhone, toComparableKenyanPhone, toLocalKenyanPhone } from "@/lib/utils";

function splitLegacyLastName(lastName: string | null | undefined) {
  const parts = String(lastName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    secondName: parts[0] || undefined,
    thirdName: parts.slice(1).join(" ") || undefined,
  };
}

async function requireSupabaseAdmin() {
  const { getSupabaseAdminEnvStatus, getSupabaseAdminOrNull } =
    await import("@/integrations/supabase/client.server");
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    const missing = getSupabaseAdminEnvStatus().missing.join(", ");
    throw new Error(
      `Database sync is unavailable until the server has: ${missing}. Add those values to local env or hosting secrets.`,
    );
  }
  return supabaseAdmin;
}

const MPESA_SYSTEM_STAFF_ID = "MPESA";
const MPESA_SYSTEM_STAFF_NAME = "M-Pesa Auto";

async function ensureSystemStaffActor(supabaseAdmin: any, staffId?: string | null) {
  if (staffId !== MPESA_SYSTEM_STAFF_ID) return;

  const { data, error } = await supabaseAdmin
    .from("staff")
    .select("id")
    .eq("id", MPESA_SYSTEM_STAFF_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return;

  const { error: insertError } = await supabaseAdmin.from("staff").insert({
    id: MPESA_SYSTEM_STAFF_ID,
    name: MPESA_SYSTEM_STAFF_NAME,
    role: "loan_officer",
    can_mark_attendance: false,
    fingerprint_enrolled: false,
  });

  if (insertError && insertError.code !== "23505") {
    throw new Error(insertError.message);
  }
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function addDaysIso(date: string, days: number) {
  const next = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function asJsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function makeId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

type AuditActor = {
  id: string;
  name: string;
  role?: string | null;
};

function clipAuditText(value: unknown, limit: number = 140) {
  const next = String(value ?? "").trim();
  if (!next) return "";
  return next.length > limit ? `${next.slice(0, limit)}...` : next;
}

async function auditAction(args: {
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
}) {
  await recordAudit({
    actor_id: args.actor.id,
    actor_name: args.actor.name,
    actor_role: args.actor.role ?? null,
    action: args.action,
    target_type: args.targetType,
    target_id: args.targetId ?? null,
    summary: args.summary,
    details: args.details,
  });
}

function summarizeAttachment(attachment?: Record<string, unknown>) {
  if (!attachment) return undefined;
  return {
    name: clipAuditText(attachment.name, 80),
    type: clipAuditText(attachment.type, 60),
    size: Number(attachment.size ?? 0),
  };
}

const SHARE_PRICE = 500;
const ROUNDING_BASE = DEFAULT_POLICY_SETTINGS.percentages.roundOffStep;
const MANDATORY_SAVINGS_THRESHOLD = DEFAULT_POLICY_SETTINGS.percentages.mandatorySavingsThreshold;
const MANDATORY_SHARES_THRESHOLD = DEFAULT_POLICY_SETTINGS.percentages.mandatorySharesThreshold;
const MAX_FIELD_VISIT_PHOTOS = 6;
const MAX_FIELD_VISIT_TOTAL_BYTES = 8 * 1024 * 1024;

function roundUpKES(amount: number, step: number = ROUNDING_BASE) {
  if (amount <= 0) return 0;
  return Math.ceil(amount / step) * step;
}

function normalizeLoanTermDays(termDays?: number) {
  if (termDays === 7 || termDays === 14 || termDays === 30 || termDays === 60 || termDays === 90)
    return termDays;
  if ((termDays ?? 0) <= 10) return 7;
  if ((termDays ?? 0) <= 21) return 14;
  if ((termDays ?? 0) <= 45) return 30;
  if ((termDays ?? 0) <= 75) return 60;
  return 90;
}

function termPeriodsFromDays(termDays?: number) {
  return Math.max(1, Math.ceil(normalizeLoanTermDays(termDays) / 30));
}

function loanScheduleTotal(principal: number, monthlyRatePct: number, months: number) {
  const periods = Number.isFinite(months) && months > 0 ? months : 1;
  const interest = principal * (monthlyRatePct / 100) * periods;
  const total = principal + interest;
  return { interest, total, monthly: total / periods };
}

function loanBalanceSummary(loan: {
  principal: number | string | null;
  approved_amount?: number | string | null;
  rate?: number | string | null;
  term_days?: number | null;
  term_months?: number | null;
  paid?: number | string | null;
}) {
  const approved = Number(loan.approved_amount ?? loan.principal ?? 0);
  const termDays = normalizeLoanTermDays(loan.term_days ?? Number(loan.term_months ?? 1) * 30);
  const periods =
    Number(loan.term_months ?? 0) > 0
      ? Number(loan.term_months ?? 0)
      : termPeriodsFromDays(termDays);
  const total = loanScheduleTotal(approved, Number(loan.rate ?? 0), periods).total;
  const paid = Number(loan.paid ?? 0);
  return {
    approved,
    termDays,
    total,
    paid,
    balance: Math.max(0, total - paid),
  };
}

function memberNeedsStickerRow(member: {
  business_permanence?: string | null;
  fee_has_shop?: boolean | null;
}) {
  if (member.business_permanence) return member.business_permanence === "permanent";
  return !!member.fee_has_shop;
}

export async function findMemberByMembershipInput(account: string) {
  const candidates = membershipIdCandidates(account);
  const raw = String(account ?? "")
    .trim()
    .toUpperCase();
  const lookupValues = Array.from(new Set([raw, ...candidates].filter(Boolean)));
  if (!lookupValues.length) return null;

  const supabaseAdmin = await requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from("members").select("*").in("id", lookupValues);
  if (error) throw new Error(error.message);

  for (const candidate of lookupValues) {
    const match = (data ?? []).find((row) => row.id === candidate);
    if (match) return match;
  }

  const { data: legacyMatches, error: legacyError } = await supabaseAdmin
    .from("members")
    .select("*")
    .in("old_system_id", lookupValues);
  if (legacyError) throw new Error(legacyError.message);

  for (const candidate of lookupValues) {
    const match = (legacyMatches ?? []).find(
      (row) =>
        String(row.old_system_id ?? "")
          .trim()
          .toUpperCase() === candidate,
    );
    if (match) return match;
  }

  return null;
}

async function ensureInvestorForMember(member: {
  id: string;
  name: string;
  phone?: string | null;
  joined_at?: string | null;
  investor_id?: string | null;
  is_investor?: boolean | null;
  member_category?: string | null;
}) {
  const category = resolveMemberCategory(member.member_category, member.is_investor);
  if (!isInvestorCategory(category)) return null;

  const supabaseAdmin = await requireSupabaseAdmin();
  let investorId = member.investor_id ?? null;

  if (investorId) {
    const { data: investor, error } = await supabaseAdmin
      .from("investors")
      .select("*")
      .eq("id", investorId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (investor) return investor;
  }

  const { data: linkedInvestor, error: linkedError } = await supabaseAdmin
    .from("investors")
    .select("*")
    .eq("member_id", member.id)
    .maybeSingle();
  if (linkedError) throw new Error(linkedError.message);
  if (linkedInvestor) {
    if (linkedInvestor.id !== investorId || !member.is_investor) {
      const { error: memberError } = await supabaseAdmin
        .from("members")
        .update({
          investor_id: linkedInvestor.id,
          is_investor: true,
          member_category: category,
        })
        .eq("id", member.id);
      if (memberError) throw new Error(memberError.message);
    }
    return linkedInvestor;
  }

  investorId = await nextPrefixedId("investors", "I", 1);
  const joinedAt = member.joined_at ?? new Date().toISOString().slice(0, 10);
  const { error: investorError } = await supabaseAdmin.from("investors").insert({
    id: investorId,
    name: member.name,
    contributed: 0,
    share_pct: 0,
    joined_at: joinedAt,
    phone: member.phone ?? null,
    notes: `Auto-linked from ${formatMembershipNumber(member.id)}`,
    member_id: member.id,
  });
  if (investorError) throw new Error(investorError.message);

  const { error: memberError } = await supabaseAdmin
    .from("members")
    .update({
      investor_id: investorId,
      is_investor: true,
      member_category: category,
    })
    .eq("id", member.id);
  if (memberError) throw new Error(memberError.message);

  const { data: investor, error } = await supabaseAdmin
    .from("investors")
    .select("*")
    .eq("id", investorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return investor;
}

async function insertTransactionRow(row: {
  date?: string;
  type: string;
  amount: number;
  member_id?: string | null;
  loan_id?: string | null;
  by_staff?: string | null;
  note?: string | null;
  ref?: string | null;
  account?: string | null;
  payer_name?: string | null;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  await ensureSystemStaffActor(supabaseAdmin, row.by_staff);

  const ref = row.ref?.trim();
  if (row.by_staff === MPESA_SYSTEM_STAFF_ID && ref) {
    let duplicateQuery = supabaseAdmin
      .from("transactions")
      .select("id")
      .eq("ref", ref)
      .eq("type", row.type as never)
      .eq("amount", row.amount)
      .limit(1);

    duplicateQuery = row.account
      ? duplicateQuery.eq("account", row.account)
      : duplicateQuery.is("account", null);
    duplicateQuery = row.member_id
      ? duplicateQuery.eq("member_id", row.member_id)
      : duplicateQuery.is("member_id", null);
    duplicateQuery = row.loan_id
      ? duplicateQuery.eq("loan_id", row.loan_id)
      : duplicateQuery.is("loan_id", null);
    duplicateQuery = row.note
      ? duplicateQuery.eq("note", row.note)
      : duplicateQuery.is("note", null);

    const { data: existing, error: duplicateError } = await duplicateQuery.maybeSingle();
    if (duplicateError) throw new Error(duplicateError.message);
    if (existing?.id) return String(existing.id);
  }

  const id = await nextPrefixedId("transactions", "T", 1);
  const { error } = await supabaseAdmin.from("transactions").insert({
    id,
    date: row.date ?? new Date().toISOString().slice(0, 10),
    type: row.type as never,
    amount: row.amount,
    member_id: row.member_id ?? null,
    loan_id: row.loan_id ?? null,
    by_staff: row.by_staff ?? null,
    note: row.note ?? null,
    ref: row.ref ?? null,
    account: row.account ?? null,
    payer_name: row.payer_name ?? null,
  });
  if (error) throw new Error(error.message);
  return id;
}

async function insertRoundOffRow(row: {
  memberId: string;
  amount: number;
  source: "loan_repayment" | "savings_deposit" | "share_purchase" | "manual";
  date?: string;
  ref?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const ref = row.ref?.trim();
  if (ref) {
    const { data: existing, error: duplicateError } = await supabaseAdmin
      .from("round_off")
      .select("id")
      .eq("member_id", row.memberId)
      .eq("amount", row.amount)
      .eq("source", row.source as never)
      .eq("ref", ref)
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw new Error(duplicateError.message);
    if (existing?.id) return String(existing.id);
  }

  const id = await nextPrefixedId("round_off", "RO", 1);
  const { error } = await supabaseAdmin.from("round_off").insert({
    id,
    member_id: row.memberId,
    amount: row.amount,
    source: row.source as never,
    date: row.date ?? new Date().toISOString().slice(0, 10),
    ref: row.ref ?? null,
  });
  if (error) throw new Error(error.message);
  return id;
}

async function markMpesaEventProcessed(eventId?: string, transactionId?: string | null) {
  if (!eventId) return;
  const supabaseAdmin = await requireSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("mpesa_events")
    .update({
      processed: true,
      transaction_id: transactionId ?? null,
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
}

async function createUnallocatedMpesaTransaction(args: {
  account: string;
  amount: number;
  payerName?: string;
  mpesaRef?: string;
  note: string;
  date?: string;
}) {
  return insertTransactionRow({
    date: args.date,
    type: "mpesa_unallocated",
    amount: args.amount,
    member_id: null,
    by_staff: MPESA_SYSTEM_STAFF_ID,
    note: args.note,
    ref: args.mpesaRef ?? null,
    account: args.account,
    payer_name: args.payerName ?? null,
  });
}

async function findExistingMpesaTransaction(args: {
  account: string;
  amount: number;
  mpesaRef?: string;
}) {
  const ref = args.mpesaRef?.trim();
  if (!ref) return null;

  const supabaseAdmin = await requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("id, type, member_id")
    .eq("ref", ref)
    .eq("account", args.account)
    .eq("amount", args.amount)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function createProcessedMpesaLedgerLink(args: {
  account: string;
  amount: number;
  payerName?: string;
  mpesaRef?: string;
  eventId?: string;
  date?: string;
}) {
  const existing = await findExistingMpesaTransaction({
    account: args.account,
    amount: args.amount,
    mpesaRef: args.mpesaRef,
  });
  if (existing?.id) {
    await markMpesaEventProcessed(args.eventId, String(existing.id));
    return {
      matched: existing.type !== "mpesa_unallocated",
      memberId: existing.member_id ?? undefined,
      transactionId: String(existing.id),
      primary: {
        type: String(existing.type),
        amount: args.amount,
        note: "M-Pesa event was already processed and has been linked to an existing ledger row.",
      },
      notes: ["M-Pesa event was already processed and has been linked to an existing ledger row."],
    };
  }

  const member = await findMemberByMembershipInput(args.account);
  if (!member) {
    const note =
      "M-Pesa event was already processed without a linked member; created the missing unallocated ledger row without changing balances.";
    const transactionId = await createUnallocatedMpesaTransaction({
      account: args.account,
      amount: args.amount,
      payerName: args.payerName,
      mpesaRef: args.mpesaRef,
      note,
      date: args.date,
    });
    await markMpesaEventProcessed(args.eventId, transactionId);
    return {
      matched: false,
      transactionId,
      primary: { type: "mpesa_unallocated", amount: args.amount, note },
      notes: [note],
    };
  }

  const note =
    "M-Pesa event was already processed without a linked transaction; created the missing savings ledger row without changing balances.";
  const transactionId = await insertTransactionRow({
    date: args.date,
    type: "deposit",
    amount: args.amount,
    member_id: member.id,
    by_staff: MPESA_SYSTEM_STAFF_ID,
    note,
    ref: args.mpesaRef ?? null,
    account: args.account,
    payer_name: args.payerName ?? null,
  });
  await markMpesaEventProcessed(args.eventId, transactionId);
  return {
    matched: true,
    memberId: member.id,
    transactionId,
    primary: { type: "deposit", amount: args.amount, note },
    notes: [note],
  };
}

async function refreshCarryoverMemberSummary(runtimeDb: any, memberId: string) {
  const policySettings = await loadRuntimePolicySettings(runtimeDb);
  const { data: loans, error: loansError } = await runtimeDb
    .from("member_carryover_loans")
    .select("*")
    .eq("member_id", memberId)
    .order("start_date", { ascending: true });
  if (loansError) throw new Error(loansError.message);

  const sorted = (loans ?? []) as Array<Record<string, unknown>>;
  const firstLoanStartDate = sorted[0]?.start_date ? String(sorted[0].start_date) : null;
  const loanSummaries = sorted.map((loan) => {
    const summary = summarizeLegacyCarryoverLoan(
      {
        principal: Number(loan.principal ?? 0),
        interestRatePct: Number(loan.interest_rate_pct ?? 0),
        termDays: Number(loan.term_days ?? 30) as 7 | 14 | 30 | 60 | 90,
        dailySavingsAmount: Number(loan.daily_savings_amount ?? 0),
        startDate: String(loan.start_date ?? ""),
        dueDate: loan.due_date ? String(loan.due_date) : undefined,
        paidToDate: Number(loan.paid_to_date ?? 0),
        status: String(loan.status ?? "active") as "active" | "closed" | "defaulted",
        finished: loan.finished === true,
        penaltyWaivedAmount: Number(loan.penalty_waived_amount ?? 0),
      },
      policySettings,
    );
    return { loan, summary };
  });
  const closedDates = loanSummaries
    .map(({ loan, summary }) => String(loan.closed_on ?? summary.dueDate ?? ""))
    .filter(Boolean)
    .sort();
  const lastLoanEndDate = closedDates.length > 0 ? closedDates[closedDates.length - 1] : null;
  const completedLoanCycles = loanSummaries.filter(
    ({ loan, summary }) => loan.status === "closed" || loan.finished === true || summary.isFinished,
  ).length;
  const pendingBalance = loanSummaries
    .filter(({ loan, summary }) => loan.status !== "closed" && !summary.isFinished)
    .reduce((sum, { summary }) => sum + summary.totalOwedNow, 0);

  const { error: profileError } = await runtimeDb.from("member_carryover_profiles").upsert({
    member_id: memberId,
    completed_loan_cycles: completedLoanCycles,
    first_loan_start_date: firstLoanStartDate,
    last_loan_end_date: lastLoanEndDate,
    pending_balance: pendingBalance,
  });
  if (profileError) throw new Error(profileError.message);
}

export async function recordMpesaConfirmationEvent(args: {
  raw: Record<string, unknown>;
  account: string;
  amount: number;
  mpesaRef?: string;
  payerName?: string;
  phone?: string;
  processed?: boolean;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const ref = args.mpesaRef?.trim() || undefined;

  if (ref) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("mpesa_events")
      .select("id, processed, transaction_id")
      .eq("kind", "confirmation")
      .eq("mpesa_ref", ref)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return existing;
  }

  const { data, error } = await supabaseAdmin
    .from("mpesa_events")
    .insert({
      kind: "confirmation",
      account: args.account || null,
      amount: args.amount || null,
      mpesa_ref: ref ?? null,
      payer_name: args.payerName ?? null,
      phone: args.phone ?? null,
      raw: args.raw as any,
      processed: args.processed ?? false,
    })
    .select("id, processed, transaction_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function recordMpesaStkPushRequestEvent(args: {
  raw: Record<string, unknown>;
  account: string;
  amount: number;
  phone?: string;
  checkoutRequestId?: string;
  merchantRequestId?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const checkoutRequestId = args.checkoutRequestId?.trim() || undefined;
  const merchantRequestId = args.merchantRequestId?.trim() || undefined;

  if (checkoutRequestId) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("mpesa_events")
      .select("id")
      .eq("kind", "stkpush_request")
      .eq("mpesa_ref", checkoutRequestId)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return existing;
  }

  const raw = {
    ...args.raw,
    CheckoutRequestID: checkoutRequestId ?? null,
    MerchantRequestID: merchantRequestId ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from("mpesa_events")
    .insert({
      kind: "stkpush_request",
      account: args.account || null,
      amount: args.amount || null,
      mpesa_ref: checkoutRequestId ?? merchantRequestId ?? null,
      payer_name: null,
      phone: args.phone ?? null,
      raw: raw as any,
      processed: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function findMpesaStkPushRequestContext(args: {
  checkoutRequestId?: string;
  merchantRequestId?: string;
  phone?: string;
  amount?: number;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const checkoutRequestId = args.checkoutRequestId?.trim() || undefined;
  const merchantRequestId = args.merchantRequestId?.trim() || undefined;
  const phone = args.phone?.trim() || undefined;
  const amount = Number(args.amount ?? 0);

  if (checkoutRequestId) {
    const { data, error } = await supabaseAdmin
      .from("mpesa_events")
      .select("id, account, phone, amount, mpesa_ref, raw, created_at")
      .eq("kind", "stkpush_request")
      .eq("mpesa_ref", checkoutRequestId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (merchantRequestId) {
    const { data, error } = await supabaseAdmin
      .from("mpesa_events")
      .select("id, account, phone, amount, mpesa_ref, raw, created_at")
      .eq("kind", "stkpush_request")
      .contains("raw", { MerchantRequestID: merchantRequestId } as any)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (phone && amount > 0) {
    const { data, error } = await supabaseAdmin
      .from("mpesa_events")
      .select("id, account, phone, amount, mpesa_ref, raw, created_at")
      .eq("kind", "stkpush_request")
      .eq("phone", phone)
      .eq("amount", amount)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  return null;
}

export async function recordMpesaValidationEvent(args: {
  raw: Record<string, unknown>;
  account: string;
  amount?: number;
  payerName?: string;
  phone?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const { error } = await supabaseAdmin.from("mpesa_events").insert({
    kind: "validation",
    account: args.account || null,
    amount: Number.isFinite(args.amount) ? args.amount : null,
    payer_name: args.payerName ?? null,
    phone: args.phone ?? null,
    raw: args.raw as any,
    processed: true,
  });
  if (error) throw new Error(error.message);
}

export async function applyMpesaPaymentToDatabase(args: {
  account: string;
  amount: number;
  payerName?: string;
  mpesaRef?: string;
  eventId?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const norm = args.account.trim().toUpperCase();
  const notes: string[] = [];

  if (args.eventId) {
    const { data: event, error: eventError } = await supabaseAdmin
      .from("mpesa_events")
      .select("processed, transaction_id, created_at")
      .eq("id", args.eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (event?.processed) {
      if (event.transaction_id) {
        let matched = true;
        const { data: transaction, error: transactionError } = await supabaseAdmin
          .from("transactions")
          .select("type")
          .eq("id", event.transaction_id)
          .maybeSingle();
        if (transactionError) throw new Error(transactionError.message);
        matched = transaction?.type !== "mpesa_unallocated";
        return {
          matched,
          account: norm,
          transactionId: event.transaction_id ?? undefined,
          notes: [
            matched
              ? "M-Pesa event already processed."
              : "M-Pesa event already recorded as an unallocated payment.",
          ],
        };
      }

      const linked = await createProcessedMpesaLedgerLink({
        account: norm,
        amount: Number(args.amount ?? 0),
        payerName: args.payerName,
        mpesaRef: args.mpesaRef,
        eventId: args.eventId,
        date: String(event.created_at ?? new Date().toISOString()).slice(0, 10),
      });
      return { account: norm, ...linked };
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const membershipCandidates = membershipIdCandidates(norm);
  const member = await findMemberByMembershipInput(norm);
  if (!member) {
    const note = membershipCandidates.length
      ? `No member matched account "${args.account}". Recorded as an unallocated M-Pesa payment.`
      : `Account "${args.account}" did not match a known member reference. Recorded as an unallocated M-Pesa payment.`;
    notes.push(note);
    const unallocatedTransactionId = await createUnallocatedMpesaTransaction({
      account: norm,
      amount: Number(args.amount ?? 0),
      payerName: args.payerName,
      mpesaRef: args.mpesaRef,
      note,
      date: today,
    });
    await markMpesaEventProcessed(args.eventId, unallocatedTransactionId);
    return {
      matched: false,
      account: norm,
      notes,
      transactionId: unallocatedTransactionId,
      primary: {
        type: "mpesa_unallocated",
        amount: Number(args.amount ?? 0),
        note,
      },
    };
  }
  const memberId = member.id;
  const memberCategory = resolveMemberCategory(member.member_category, member.is_investor);

  let remaining = Number(args.amount ?? 0);
  const txBatch: Array<{
    date?: string;
    type: string;
    amount: number;
    member_id?: string | null;
    loan_id?: string | null;
    by_staff?: string | null;
    note?: string | null;
    ref?: string | null;
    account?: string | null;
    payer_name?: string | null;
  }> = [];
  const penaltiesCleared: { id: string; amount: number }[] = [];
  let primary:
    | {
        type: string;
        amount: number;
        loanId?: string;
        note?: string;
      }
    | undefined;
  let toRoundOff = 0;
  let primaryTransactionId: string | undefined;
  let activeLoanPatch:
    | {
        id: string;
        paid: number;
        status: string;
      }
    | undefined;

  if (isInvestorOnlyCategory(memberCategory)) {
    const investor = await ensureInvestorForMember(member);
    if (!investor) throw new Error("Investor account could not be resolved.");
    const investorAmount = remaining;
    primary = {
      type: "investor_contribution",
      amount: investorAmount,
      note: `Investment via Paybill ${norm}`,
    };
    primaryTransactionId = await insertTransactionRow({
      date: today,
      type: "investor_contribution",
      amount: investorAmount,
      member_id: memberId,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Investment top-up via Paybill ${norm}`,
    });

    const { error: updateInvestorError } = await supabaseAdmin
      .from("investors")
      .update({
        contributed: Number(investor.contributed ?? 0) + investorAmount,
      })
      .eq("id", investor.id);
    if (updateInvestorError) throw new Error(updateInvestorError.message);

    notes.push(
      `Routed ${investorAmount}/= to the investment pool for investor account ${member.name}.`,
    );
    await markMpesaEventProcessed(args.eventId, primaryTransactionId);
    return {
      matched: true,
      memberId,
      account: norm,
      primary,
      transactionId: primaryTransactionId,
      toRoundOff: 0,
      penaltiesCleared: [],
      notes,
    };
  }

  const policySettings = await loadRuntimePolicySettings(supabaseAdmin);
  const feePolicies = await loadRuntimeFeePolicies(supabaseAdmin);
  const normalizedFeePolicies = normalizeFeePolicies(feePolicies);
  const memberPatch: Record<string, unknown> = {};
  const roundOffStep = policySettings.percentages.roundOffStep || ROUNDING_BASE;
  const mandatorySavingsThreshold =
    policySettings.percentages.mandatorySavingsThreshold || MANDATORY_SAVINGS_THRESHOLD;
  const mandatorySharesThreshold =
    policySettings.percentages.mandatorySharesThreshold || MANDATORY_SHARES_THRESHOLD;

  const { data: outstandingPenalties, error: penaltiesError } = await supabaseAdmin
    .from("penalties")
    .select("*")
    .eq("member_id", memberId)
    .eq("status", "outstanding")
    .order("date", { ascending: true });
  if (penaltiesError) throw new Error(penaltiesError.message);

  const { data: activeLoan, error: activeLoanError } = await supabaseAdmin
    .from("loans")
    .select("*")
    .eq("member_id", memberId)
    .eq("status", "active")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (activeLoanError) throw new Error(activeLoanError.message);

  const feeApplies = (key: string) => {
    const policy = normalizedFeePolicies.find((row) => row.key === key);
    if (!policy) return false;
    return feePolicyAppliesToMember(
      policy,
      {
        id: memberId,
        joinedAt: member.joined_at ?? undefined,
        category: member.member_category ?? undefined,
        isInvestor: member.is_investor ?? undefined,
      },
      { hasActiveLoan: !!activeLoan },
    );
  };
  const feeQueue: Record<
    string,
    {
      key: "fee_membership" | "fee_card" | "fee_sticker";
      label: string;
      amount: number;
      required: boolean;
    }
  > = {
    membership_fee: {
      key: "fee_membership",
      label: "Membership fee",
      amount: feeApplies("membership")
        ? feePolicyAmount(normalizedFeePolicies, "membership", 0)
        : 0,
      required: feeApplies("membership"),
    },
    card_fee: {
      key: "fee_card",
      label: "Membership card",
      amount: feeApplies("card") ? feePolicyAmount(normalizedFeePolicies, "card", 0) : 0,
      required: feeApplies("card"),
    },
    sticker_fee: {
      key: "fee_sticker",
      label: "Sticker fee",
      amount: feeApplies("sticker") ? feePolicyAmount(normalizedFeePolicies, "sticker", 0) : 0,
      required: memberNeedsStickerRow(member) && feeApplies("sticker"),
    },
  };

  const scenario = activeLoan ? "member_with_loan" : "member_without_loan";
  const waterfall = waterfallRuleForScenario(scenario, policySettings).steps;
  const preprocessingSteps = waterfall.filter(
    (step) =>
      step === "membership_fee" ||
      step === "card_fee" ||
      step === "sticker_fee" ||
      step === "penalties",
  );

  function setPrimaryIfMissing(type: string, amount: number, note: string, loanId?: string) {
    if (primary) return;
    primary = { type, amount, note, loanId };
  }

  function currentSavingsBalance() {
    return Number(memberPatch.savings_balance ?? member.savings_balance ?? 0);
  }

  function currentShareUnits() {
    return Number(memberPatch.shares ?? member.shares ?? 0);
  }

  function currentShareValue() {
    return currentShareUnits() * SHARE_PRICE;
  }

  function queueSavingsDeposit(applied: number, notePrefix: string) {
    if (applied <= 0) return;
    const rounded = roundUpKES(applied, roundOffStep);
    const surplus = Math.max(0, rounded - applied);
    setPrimaryIfMissing(
      "deposit",
      applied,
      `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
    );
    txBatch.push({
      date: today,
      type: "deposit",
      amount: applied,
      member_id: memberId,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Paybill ${norm} - ${args.payerName ?? ""}`,
    });
    memberPatch.savings_balance = currentSavingsBalance() + applied;
    if (surplus > 0) toRoundOff += surplus;
    if (currentSavingsBalance() < mandatorySavingsThreshold) {
      notes.push(
        `${notePrefix} Member is still below the mandatory savings threshold of ${mandatorySavingsThreshold}/=.`,
      );
    } else {
      notes.push(`${notePrefix} Member meets mandatory savings threshold.`);
    }
  }

  function queueSharePurchase(applied: number, notePrefix: string) {
    if (applied <= 0) return;
    const wholeUnits = Math.floor(applied / SHARE_PRICE);
    const actualApplied = wholeUnits * SHARE_PRICE;
    if (actualApplied <= 0) return;

    setPrimaryIfMissing(
      "share_purchase",
      actualApplied,
      `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
    );
    txBatch.push({
      date: today,
      type: "share_purchase",
      amount: actualApplied,
      member_id: memberId,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Mandatory shares via Paybill ${norm}`,
    });
    memberPatch.shares = currentShareUnits() + wholeUnits;
    notes.push(
      `${notePrefix} Converted ${actualApplied}/= into ${wholeUnits} mandatory share unit(s).`,
    );
  }

  function queuePurposePoolContribution(applied: number, reason: string) {
    if (applied <= 0) return;
    setPrimaryIfMissing("fee_payment", applied, `Purpose pool via Paybill ${norm}`);
    txBatch.push({
      date: today,
      type: "fee_payment",
      amount: applied,
      member_id: memberId,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Purpose pool contribution (auto) - ${reason}`,
    });
    notes.push(`Routed ${applied}/= into the internal purpose pool (${reason}).`);
  }

  async function applyLoanRepayment(applied: number) {
    if (!activeLoan || applied <= 0) return 0;
    const summary = loanBalanceSummary(activeLoan);
    const safeApplied = Math.min(applied, summary.balance);
    if (safeApplied <= 0) return applied;

    const rounded = roundUpKES(safeApplied, roundOffStep);
    const surplus = Math.max(0, rounded - safeApplied);
    if (surplus > 0) toRoundOff += surplus;

    setPrimaryIfMissing(
      "loan_repayment",
      safeApplied,
      `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
      activeLoan.id,
    );
    txBatch.push({
      date: today,
      type: "loan_repayment",
      amount: safeApplied,
      member_id: memberId,
      loan_id: activeLoan.id,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Paybill ${norm} - ${args.payerName ?? ""}`,
    });

    const nextPaid = Number(activeLoan.paid ?? 0) + safeApplied;
    const nextBalance = Math.max(0, summary.total - nextPaid);
    const nextStatus = nextBalance <= 0 ? "closed" : activeLoan.status;
    activeLoan.paid = nextPaid;
    activeLoan.status = nextStatus;
    activeLoanPatch = {
      id: activeLoan.id,
      paid: nextPaid,
      status: nextStatus,
    };

    if (!member.fee_first_upfront_paid) {
      memberPatch.fee_first_upfront_paid = true;
    }

    notes.push(
      `Applied ${safeApplied}/= to loan ${activeLoan.id}; rounded up to ${rounded}/=, surplus ${surplus}/= -> round-off pool.`,
    );
    return Math.max(0, applied - safeApplied);
  }

  function allocateSavingsWaterfall(applied: number, notePrefix: string) {
    let remainingSavingsPortion = Math.max(0, applied);
    if (remainingSavingsPortion <= 0) return;

    const savingsGap = Math.max(0, mandatorySavingsThreshold - currentSavingsBalance());
    const savingsApplied = Math.min(remainingSavingsPortion, savingsGap);
    if (savingsApplied > 0) {
      queueSavingsDeposit(savingsApplied, notePrefix);
      remainingSavingsPortion -= savingsApplied;
    }

    const shareGapAmount = Math.max(0, mandatorySharesThreshold - currentShareValue());
    const desiredShareAmount = Math.min(remainingSavingsPortion, shareGapAmount);
    const shareApplied = Math.floor(desiredShareAmount / SHARE_PRICE) * SHARE_PRICE;
    if (shareApplied > 0) {
      queueSharePurchase(shareApplied, notePrefix);
      remainingSavingsPortion -= shareApplied;
    }

    if (remainingSavingsPortion > 0) {
      const stillBelowShares = currentShareValue() < mandatorySharesThreshold;
      queuePurposePoolContribution(
        remainingSavingsPortion,
        stillBelowShares
          ? "share-stage remainder below a full 500 share block"
          : "amount above mandatory savings and shares thresholds",
      );
      remainingSavingsPortion = 0;
    }
  }

  async function allocateMemberPaymentAfterFeesAndPenalties() {
    if (remaining <= 0) return;

    if (!activeLoan) {
      allocateSavingsWaterfall(remaining, "Non-loan flow:");
      remaining = 0;
      return;
    }

    const approvedAmount = Number(activeLoan.approved_amount ?? activeLoan.principal ?? 0);
    const dailySavingsPortion = Math.min(remaining, approvedAmount <= 5000 ? 50 : 100);
    if (dailySavingsPortion > 0) {
      allocateSavingsWaterfall(dailySavingsPortion, "Loan savings leg:");
      remaining -= dailySavingsPortion;
    }

    if (remaining > 0) {
      const overflow = await applyLoanRepayment(remaining);
      remaining = 0;
      if (overflow > 0) {
        allocateSavingsWaterfall(overflow, "Post-loan remainder:");
      }
    }
  }

  for (const step of preprocessingSteps) {
    if (remaining <= 0) break;

    if (step === "membership_fee" || step === "card_fee" || step === "sticker_fee") {
      const fee = feeQueue[step];
      if (!fee || !fee.required || fee.amount <= 0) continue;
      if (member[fee.key] || memberPatch[fee.key]) continue;
      if (remaining < fee.amount) continue;
      remaining -= fee.amount;
      memberPatch[fee.key] = true;
      setPrimaryIfMissing("fee_payment", fee.amount, `${fee.label} via Paybill ${norm}`);
      txBatch.push({
        date: today,
        type: "fee_payment",
        amount: fee.amount,
        member_id: memberId,
        by_staff: MPESA_SYSTEM_STAFF_ID,
        ref: args.mpesaRef,
        account: norm,
        payer_name: args.payerName,
        note: `${fee.label} (auto)`,
      });
      notes.push(`Paid ${fee.label} - ${fee.amount}/=.`);
      continue;
    }

    if (step === "penalties") {
      for (const penalty of outstandingPenalties ?? []) {
        const amount = Number(penalty.amount ?? 0);
        if (remaining < amount) continue;
        remaining -= amount;
        penaltiesCleared.push({ id: penalty.id, amount });
        notes.push(`Cleared penalty ${penalty.id} (${penalty.reason}) - ${amount}/=.`);
      }
      continue;
    }
  }

  await allocateMemberPaymentAfterFeesAndPenalties();

  if (remaining > 0) {
    allocateSavingsWaterfall(remaining, "Safety fallback:");
    notes.push(
      "Remaining balance was routed through the savings/shares/purpose-pool flow because the configured preprocessing steps ended before the full amount was allocated.",
    );
    remaining = 0;
  }

  for (const tx of txBatch) {
    const txId = await insertTransactionRow(tx);
    if (
      !primaryTransactionId &&
      primary &&
      tx.type === primary.type &&
      Number(tx.amount) === Number(primary.amount) &&
      (primary.loanId ? tx.loan_id === primary.loanId : true)
    ) {
      primaryTransactionId = txId;
    }
    if (!primaryTransactionId) primaryTransactionId = txId;
  }

  if (toRoundOff > 0) {
    await insertRoundOffRow({
      memberId,
      amount: toRoundOff,
      source: primary?.type === "deposit" ? "savings_deposit" : "loan_repayment",
      date: today,
      ref: args.mpesaRef,
    });
  }

  if (penaltiesCleared.length > 0) {
    for (const penalty of penaltiesCleared) {
      const { error } = await supabaseAdmin
        .from("penalties")
        .update({ status: "paid", paid_from: "mpesa" })
        .eq("id", penalty.id);
      if (error) throw new Error(error.message);
    }
  }

  if (activeLoanPatch) {
    const { error: loanUpdateError } = await supabaseAdmin
      .from("loans")
      .update({
        paid: activeLoanPatch.paid,
        status: activeLoanPatch.status,
      })
      .eq("id", activeLoanPatch.id);
    if (loanUpdateError) throw new Error(loanUpdateError.message);
  }

  if (Object.keys(memberPatch).length > 0) {
    const { error: memberUpdateError } = await supabaseAdmin
      .from("members")
      .update(memberPatch as any)
      .eq("id", memberId);
    if (memberUpdateError) throw new Error(memberUpdateError.message);
  }

  await markMpesaEventProcessed(args.eventId, primaryTransactionId ?? null);
  return {
    matched: true,
    memberId,
    account: norm,
    primary,
    transactionId: primaryTransactionId,
    toRoundOff,
    penaltiesCleared,
    notes,
  };
}

async function nextPrefixedId(
  table:
    | "members"
    | "investors"
    | "transactions"
    | "staff"
    | "loans"
    | "petty_cash"
    | "appraisals"
    | "field_visits"
    | "followups"
    | "round_off",
  prefix: string,
  minimum: number,
) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin.rpc("next_entity_id", {
    entity_name: table,
  });
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(`Failed to allocate a new ${table} identifier.`);
  }
  return String(data);
}

function approxDataUrlBytes(value: string) {
  const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return Math.ceil((payload.length * 3) / 4);
}

function mapStaffRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    nationalId: row.national_id ?? undefined,
    address: row.address ?? undefined,
    notes: row.notes ?? undefined,
    photo: row.photo ?? undefined,
    canMarkAttendance: !!row.can_mark_attendance,
    fingerprintEnrolled: !!row.fingerprint_enrolled,
  };
}

function mapMemberRow(row: any) {
  const legacyNames = splitLegacyLastName(row.last_name);
  const businessPermanence =
    (row.business_permanence as "permanent" | "semi" | null | undefined) ?? undefined;
  const category = resolveMemberCategory(row.member_category, row.is_investor);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    joinedAt: row.joined_at,
    status: row.status,
    shares: row.shares,
    savingsBalance: toNumber(row.savings_balance),
    fees: {
      membership: row.fee_membership,
      card: row.fee_card,
      hasShop:
        businessPermanence === "permanent"
          ? true
          : businessPermanence === "semi"
            ? false
            : row.fee_has_shop,
      sticker: row.fee_sticker,
      firstUpfrontPaid: row.fee_first_upfront_paid,
    },
    category,
    isInvestor: isInvestorCategory(category),
    investorId: row.investor_id ?? undefined,
    firstName: row.first_name ?? undefined,
    secondName: row.second_name ?? legacyNames.secondName,
    thirdName: row.third_name ?? legacyNames.thirdName,
    lastName: row.last_name ?? undefined,
    dob: row.dob ?? undefined,
    gender: (row.gender as "Male" | "Female" | null) ?? undefined,
    email: row.email ?? undefined,
    address: row.address ?? undefined,
    city: row.city ?? undefined,
    county: row.county ?? undefined,
    village: row.village ?? undefined,
    savingsOnly: row.savings_only,
    oldSystemId: row.old_system_id ?? undefined,
    businessName: row.business_name ?? undefined,
    businessType: row.business_type ?? undefined,
    businessPermanence,
    businessAddress: row.business_address ?? undefined,
    fieldOfficerId: row.field_officer_id ?? undefined,
  };
}

function mapLoanRow(row: any) {
  return {
    id: row.id,
    memberId: row.member_id,
    principal: toNumber(row.principal),
    approvedAmount: row.approved_amount == null ? undefined : toNumber(row.approved_amount),
    rate: toNumber(row.rate),
    termMonths: row.term_months,
    termDays: row.term_days == null ? undefined : (row.term_days as 7 | 14 | 30 | 60 | 90),
    startDate: row.start_date,
    status: row.status,
    officerId: row.officer_id ?? "",
    paid: toNumber(row.paid),
    purpose: row.purpose ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewNote: row.review_note ?? undefined,
  };
}

function mapTransactionRow(row: any) {
  return {
    id: row.id,
    date: row.date,
    type: row.type,
    account: row.account ?? undefined,
    payerName: row.payer_name ?? undefined,
    amount: toNumber(row.amount),
    memberId: row.member_id ?? undefined,
    loanId: row.loan_id ?? undefined,
    ref: row.ref ?? undefined,
    by: row.by_staff ?? "",
    note: row.note ?? undefined,
  };
}

function mapPettyCashRow(row: any) {
  return {
    id: row.id,
    date: row.date,
    description: row.description,
    amount: toNumber(row.amount),
    category: row.category ?? "",
    by: row.by_staff ?? "",
    time: row.time ?? undefined,
    type: row.type ?? undefined,
    payee: row.payee ?? undefined,
    contact: row.contact ?? undefined,
    mode: row.mode ?? undefined,
    reference: row.reference ?? undefined,
    txnCost: row.txn_cost == null ? undefined : toNumber(row.txn_cost),
    openingBalance: row.opening_balance == null ? undefined : toNumber(row.opening_balance),
  };
}

function mapInvestorRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    contributed: toNumber(row.contributed),
    sharePct: toNumber(row.share_pct),
    joinedAt: row.joined_at,
    phone: row.phone ?? undefined,
    notes: row.notes ?? undefined,
    memberId: row.member_id ?? undefined,
  };
}

function mapAttendanceRow(row: any) {
  return {
    id: row.id,
    staffId: row.staff_id,
    date: row.date,
    status: row.status,
    checkIn: row.check_in ?? undefined,
    checkOut: row.check_out ?? undefined,
  };
}

function mapAppraisalRow(row: any) {
  return {
    id: row.id,
    memberId: row.member_id,
    loanId: row.loan_id ?? undefined,
    date: row.date,
    officerId: row.officer_id ?? "",
    goodDay: toNumber(row.good_day),
    averageDay: toNumber(row.average_day),
    badDay: toNumber(row.bad_day),
    operatingExpenses: toNumber(row.operating_expenses),
    nonEarningDays: row.non_earning_days,
    existingDebt: toNumber(row.existing_debt),
    monthlyDebtRepayment: toNumber(row.monthly_debt_repayment),
    crbStatus: (row.crb_status as "Positive" | "Negative" | "Unknown" | "No Record") ?? "Unknown",
    reschedulesLast12: row.reschedules_last_12,
    dti: toNumber(row.dti),
    dicr: toNumber(row.dicr),
    bdsr: toNumber(row.bdsr),
    lsr: toNumber(row.lsr),
    savingsBuffer: toNumber(row.savings_buffer),
    scoreDICR: toNumber(row.score_dicr),
    scoreBDSR: toNumber(row.score_bdsr),
    scoreSavings: toNumber(row.score_savings),
    scoreCRB: toNumber(row.score_crb),
    scoreBurden: toNumber(row.score_burden),
    scoreDocs: toNumber(row.score_docs),
    scoreCoop: toNumber(row.score_coop),
    totalScore: toNumber(row.total_score),
    decision:
      (row.decision as "Approve" | "Approve with Adjustments" | "Refer / Downsize" | "Reject") ??
      "Refer / Downsize",
    riskLevel: (row.risk_level as "LOW" | "MODERATE" | "HIGH" | "VERY HIGH") ?? "MODERATE",
    approvedAmount: toNumber(row.approved_amount),
    approvedTerm: row.approved_term ?? "",
    specialConditions: row.special_conditions ?? "",
    notes: row.notes ?? "",
  };
}

function mapFieldVisitRow(row: any) {
  return {
    id: row.id,
    memberId: row.member_id,
    date: row.date,
    type: row.type,
    lat: row.lat == null ? undefined : toNumber(row.lat),
    lng: row.lng == null ? undefined : toNumber(row.lng),
    locationNotes: row.location_notes ?? "",
    photos: row.photos ?? undefined,
    photoLabels: row.photo_labels ?? undefined,
    by: row.by_staff ?? "",
  };
}

function mapFollowupRow(row: any) {
  return {
    id: row.id,
    loanId: row.loan_id,
    memberId: row.member_id,
    date: row.date,
    note: row.note,
    outcome: row.outcome,
    by: row.by_staff ?? "",
  };
}

function mapPenaltyRow(row: any) {
  return {
    id: row.id,
    memberId: row.member_id,
    loanId: row.loan_id ?? undefined,
    date: row.date,
    amount: toNumber(row.amount),
    reason: row.reason,
    status: row.status,
    paidFrom: row.paid_from ?? undefined,
  };
}

function mapRoundOffRow(row: any) {
  return {
    id: row.id,
    memberId: row.member_id,
    date: row.date,
    amount: toNumber(row.amount),
    source: row.source,
    ref: row.ref ?? undefined,
  };
}

function mapStaffMessageRow(row: any) {
  return {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    senderName: row.sender_name,
    content: row.content ?? undefined,
    attachment: row.attachment
      ? {
          name: row.attachment.name ?? "attachment",
          type: row.attachment.type ?? "application/octet-stream",
          size: Number(row.attachment.size ?? 0),
          data: row.attachment.data ?? "",
        }
      : undefined,
    createdAt: row.created_at,
  };
}

function mapMemoRow(row: any) {
  return {
    id: row.id,
    date: row.memo_date,
    title: row.title,
    body: row.body,
    by: row.by_name,
    byStaffId: row.by_staff_id ?? undefined,
    createdAt: row.created_at,
  };
}

function mapApprovalRow(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    requestedBy: row.requested_by,
    requestedByName: row.requested_by_name ?? undefined,
    payload: row.payload ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewNote: row.review_note ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
  };
}

function mapFeePolicyRow(row: any) {
  return {
    key: row.key,
    label: row.label,
    amount: toNumber(row.amount),
    permanence: row.permanence,
    durationDays: row.duration_days ?? undefined,
    effectiveFrom: row.effective_from,
    scope: row.scope,
    selectedMemberIds: Array.isArray(row.selected_member_ids)
      ? row.selected_member_ids.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
      : [],
    custom: row.custom,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at,
  };
}

function mapPolicySettingRow(row: any): PolicySettingRow {
  return {
    key: row.key,
    label: row.label,
    value: row.value ?? {},
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

async function loadRuntimeFeePolicies(supabaseAdmin: any): Promise<FeePolicy[]> {
  const { data, error } = await supabaseAdmin
    .from("fee_policies")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return normalizeFeePolicies((data ?? []).map(mapFeePolicyRow));
}

async function loadRuntimePolicySettings(supabaseAdmin: any) {
  const { data, error } = await supabaseAdmin.from("policy_settings").select("*");
  if (error) throw new Error(error.message);
  return mergePolicySettings((data ?? []).map(mapPolicySettingRow));
}

function groupSupportMessages(rows: any[]) {
  const supportMessagesByThread = new Map<string, any[]>();
  for (const row of rows) {
    const list = supportMessagesByThread.get(row.thread_id) ?? [];
    list.push(row);
    supportMessagesByThread.set(row.thread_id, list);
  }
  return supportMessagesByThread;
}

function mapSupportThreadRow(row: any, supportMessagesByThread: Map<string, any[]>) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    assignedStaffId: row.assigned_staff_id ?? undefined,
    status: row.status,
    subject: row.subject,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: (supportMessagesByThread.get(row.id) ?? []).map((message: any) => ({
      id: message.id,
      from: message.sender_kind,
      fromName: message.sender_name,
      fromId: message.sender_id ?? undefined,
      text: message.text,
      at: message.created_at,
    })),
  };
}

function emptyAppData() {
  return {
    isAuthenticated: false,
    authMode: "staff" as const,
    portalMemberId: "",
    currentUser: undefined,
    staff: [],
    members: [],
    loans: [],
    transactions: [],
    pettyCash: [],
    investors: [],
    attendance: [],
    appraisals: [],
    fieldVisits: [],
    followups: [],
    penalties: [],
    roundOff: [],
    staffMessages: [],
    memos: [],
    approvals: [],
    feePolicies: normalizeFeePolicies(DEFAULT_FEE_POLICIES),
    policySettings: clonePolicySettings(DEFAULT_POLICY_SETTINGS),
    supportThreads: [],
  };
}

export const loadAppData = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getAuthSessionData();
  const base = emptyAppData();
  if (!session.authMode) return base;

  const supabaseAdmin = await requireSupabaseAdmin();

  if (session.authMode === "member" && session.memberId) {
    const [
      memberResult,
      staffResult,
      loansResult,
      transactionsResult,
      penaltiesResult,
      roundOffResult,
      feePoliciesResult,
      policySettingsResult,
    ] = await Promise.all([
      supabaseAdmin.from("members").select("*").eq("id", session.memberId).maybeSingle(),
      supabaseAdmin.from("staff").select("id, name, role").order("id"),
      supabaseAdmin
        .from("loans")
        .select("*")
        .eq("member_id", session.memberId)
        .order("start_date", { ascending: false }),
      supabaseAdmin
        .from("transactions")
        .select("*")
        .eq("member_id", session.memberId)
        .order("date", { ascending: false }),
      supabaseAdmin
        .from("penalties")
        .select("*")
        .eq("member_id", session.memberId)
        .order("date", { ascending: false }),
      supabaseAdmin
        .from("round_off")
        .select("*")
        .eq("member_id", session.memberId)
        .order("date", { ascending: false }),
      supabaseAdmin.from("fee_policies").select("*").order("updated_at", { ascending: false }),
      supabaseAdmin.from("policy_settings").select("*"),
    ]);

    const memberResults = [
      memberResult,
      staffResult,
      loansResult,
      transactionsResult,
      penaltiesResult,
      roundOffResult,
      feePoliciesResult,
      policySettingsResult,
    ];
    const failedMemberResult = memberResults.find((result) => result.error);
    if (failedMemberResult?.error) throw new Error(failedMemberResult.error.message);
    if (!memberResult.data) return base;

    return {
      ...base,
      isAuthenticated: true,
      authMode: "member" as const,
      portalMemberId: memberResult.data.id,
      staff: (staffResult.data ?? []).map(mapStaffRow),
      members: [mapMemberRow(memberResult.data)],
      loans: (loansResult.data ?? []).map(mapLoanRow),
      transactions: (transactionsResult.data ?? []).map(mapTransactionRow),
      penalties: (penaltiesResult.data ?? []).map(mapPenaltyRow),
      roundOff: (roundOffResult.data ?? []).map(mapRoundOffRow),
      feePolicies: normalizeFeePolicies((feePoliciesResult.data ?? []).map(mapFeePolicyRow)),
      policySettings: mergePolicySettings(
        (policySettingsResult.data ?? []).map(mapPolicySettingRow),
      ),
    };
  }

  const actor = await requireStaffActor();

  const [
    staffResult,
    membersResult,
    loansResult,
    transactionsResult,
    pettyCashResult,
    investorsResult,
    attendanceResult,
    appraisalsResult,
    fieldVisitsResult,
    followupsResult,
    penaltiesResult,
    roundOffResult,
    staffMessagesResult,
    feePoliciesResult,
    policySettingsResult,
  ] = await Promise.all([
    supabaseAdmin.from("staff").select("*").order("id"),
    supabaseAdmin.from("members").select("*").order("id"),
    supabaseAdmin.from("loans").select("*").order("start_date", { ascending: false }),
    supabaseAdmin.from("transactions").select("*").order("date", { ascending: false }),
    supabaseAdmin.from("petty_cash").select("*").order("date", { ascending: false }),
    supabaseAdmin.from("investors").select("*").order("joined_at", { ascending: false }),
    supabaseAdmin.from("attendance").select("*").order("date", { ascending: false }),
    supabaseAdmin.from("appraisals").select("*").order("date", { ascending: false }),
    supabaseAdmin
      .from("field_visits")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabaseAdmin.from("followups").select("*").order("date", { ascending: false }),
    supabaseAdmin.from("penalties").select("*").order("date", { ascending: false }),
    supabaseAdmin.from("round_off").select("*").order("date", { ascending: false }),
    supabaseAdmin
      .from("staff_messages")
      .select("*")
      .or(`sender_id.eq.${actor.id},receiver_id.eq.${actor.id}`)
      .order("created_at", { ascending: true }),
    supabaseAdmin.from("fee_policies").select("*").order("updated_at", { ascending: false }),
    supabaseAdmin.from("policy_settings").select("*"),
  ]);

  const results = [
    staffResult,
    membersResult,
    loansResult,
    transactionsResult,
    pettyCashResult,
    investorsResult,
    attendanceResult,
    appraisalsResult,
    fieldVisitsResult,
    followupsResult,
    penaltiesResult,
    roundOffResult,
    staffMessagesResult,
    feePoliciesResult,
    policySettingsResult,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  const staffRows = (staffResult.data ?? []).map(mapStaffRow);

  return {
    ...base,
    isAuthenticated: true,
    authMode: "staff" as const,
    currentUser: staffRows.find((row) => row.id === actor.id),
    staff: staffRows,
    members: (membersResult.data ?? []).map(mapMemberRow),
    loans: (loansResult.data ?? []).map(mapLoanRow),
    transactions: (transactionsResult.data ?? []).map(mapTransactionRow),
    pettyCash: (pettyCashResult.data ?? []).map(mapPettyCashRow),
    investors: (investorsResult.data ?? []).map(mapInvestorRow),
    attendance: (attendanceResult.data ?? []).map(mapAttendanceRow),
    appraisals: (appraisalsResult.data ?? []).map(mapAppraisalRow),
    fieldVisits: (fieldVisitsResult.data ?? []).map(mapFieldVisitRow),
    followups: (followupsResult.data ?? []).map(mapFollowupRow),
    penalties: (penaltiesResult.data ?? []).map(mapPenaltyRow),
    roundOff: (roundOffResult.data ?? []).map(mapRoundOffRow),
    staffMessages: (staffMessagesResult.data ?? []).map(mapStaffMessageRow),
    feePolicies: normalizeFeePolicies((feePoliciesResult.data ?? []).map(mapFeePolicyRow)),
    policySettings: mergePolicySettings((policySettingsResult.data ?? []).map(mapPolicySettingRow)),
  };
});

export const createMemberRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId?: string;
      name: string;
      phone: string;
      joinedAt?: string;
      status?: "active" | "dormant";
      shares?: number;
      savingsBalance?: number;
      firstName?: string;
      secondName?: string;
      thirdName?: string;
      dob?: string;
      gender?: "Male" | "Female";
      email?: string;
      address?: string;
      city?: string;
      county?: string;
      village?: string;
      oldSystemId?: string;
      businessName?: string;
      businessType?: string;
      businessPermanence?: "permanent" | "semi";
      businessAddress?: string;
      fieldOfficerId?: string;
      category?: MemberCategory;
      investorContribution?: number;
      investorNotes?: string;
    }) => ({
      memberId: data?.memberId?.trim() || undefined,
      name: String(data?.name ?? "").trim(),
      phone: String(data?.phone ?? "").trim(),
      joinedAt: data?.joinedAt,
      status: data?.status ?? "active",
      shares: Number(data?.shares ?? 0),
      savingsBalance: Number(data?.savingsBalance ?? 0),
      firstName: data?.firstName?.trim() || undefined,
      secondName: data?.secondName?.trim() || undefined,
      thirdName: data?.thirdName?.trim() || undefined,
      dob: data?.dob?.trim() || undefined,
      gender: data?.gender,
      email: data?.email?.trim() || undefined,
      address: data?.address?.trim() || undefined,
      city: data?.city?.trim() || undefined,
      county: data?.county?.trim() || undefined,
      village: data?.village?.trim() || undefined,
      oldSystemId: data?.oldSystemId?.trim() || undefined,
      businessName: data?.businessName?.trim() || undefined,
      businessType: data?.businessType?.trim() || undefined,
      businessPermanence:
        data?.businessPermanence === "permanent" || data?.businessPermanence === "semi"
          ? data.businessPermanence
          : undefined,
      businessAddress: data?.businessAddress?.trim() || undefined,
      fieldOfficerId: data?.fieldOfficerId?.trim() || undefined,
      category:
        data?.category === "investor" || data?.category === "both" || data?.category === "member"
          ? data.category
          : "member",
      investorContribution: Number(data?.investorContribution ?? 0),
      investorNotes: data?.investorNotes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.name) throw new Error("Member name is required.");
    if (!data.phone) throw new Error("Member phone is required.");
    if (!isValidLocalKenyanPhone(data.phone)) {
      throw new Error("Use a local phone number starting with 07 or 01.");
    }
    if (data.investorContribution < 0) {
      throw new Error("Initial investment cannot be negative.");
    }

    const supabaseAdmin = await requireSupabaseAdmin();
    const phone = toLocalKenyanPhone(data.phone);
    const normalizedPhone = toComparableKenyanPhone(phone);
    const memberCategory = resolveMemberCategory(data.category);
    const requestedMemberId = data.memberId ? normalizeMembershipNumber(data.memberId) : undefined;
    if (data.memberId && !requestedMemberId) {
      throw new Error("Membership number must follow the SBC0001K format.");
    }

    const { data: existingMembers, error: existingError } = await supabaseAdmin
      .from("members")
      .select("id, phone, old_system_id");
    if (existingError) throw new Error(existingError.message);

    const duplicate = (existingMembers ?? []).find((row) => {
      const samePhone = toComparableKenyanPhone(row.phone) === normalizedPhone;
      const sameMemberId =
        !!requestedMemberId &&
        membershipIdCandidates(requestedMemberId).some((candidate) => candidate === row.id);
      const sameLegacyId =
        data.oldSystemId &&
        row.old_system_id &&
        row.old_system_id.trim().toUpperCase() === data.oldSystemId.trim().toUpperCase();
      return samePhone || sameLegacyId || sameMemberId;
    });
    if (duplicate) {
      throw new Error(`Member already exists in the database as ${duplicate.id}.`);
    }

    const memberId =
      requestedMemberId ??
      nextMembershipNumber(
        (existingMembers ?? []).map((row) => row.id),
        1,
      );
    const lastName =
      [data.secondName, data.thirdName].filter(Boolean).join(" ").trim() || undefined;
    const hasShop = data.businessPermanence === "permanent";
    const fieldOfficerId = data.fieldOfficerId ?? actor.id;
    const shares = memberCategory === "investor" ? 0 : data.shares;
    const savingsBalance = memberCategory === "investor" ? 0 : data.savingsBalance;

    const { error: memberError } = await supabaseAdmin.from("members").insert({
      id: memberId,
      name: data.name,
      phone,
      joined_at: data.joinedAt ?? new Date().toISOString().slice(0, 10),
      status: data.status,
      shares,
      savings_balance: savingsBalance,
      fee_has_shop: hasShop,
      first_name: data.firstName ?? null,
      second_name: data.secondName ?? null,
      third_name: data.thirdName ?? null,
      last_name: lastName ?? null,
      dob: data.dob ?? null,
      gender: data.gender ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      county: data.county ?? null,
      village: data.village ?? null,
      old_system_id: data.oldSystemId ?? null,
      business_name: data.businessName ?? null,
      business_type: data.businessType ?? null,
      business_permanence: data.businessPermanence ?? null,
      business_address: data.businessAddress ?? null,
      field_officer_id: fieldOfficerId,
      member_category: memberCategory,
      is_investor: isInvestorCategory(memberCategory),
    });
    if (memberError) throw new Error(memberError.message);

    if (isInvestorCategory(memberCategory)) {
      const investorId = await nextPrefixedId("investors", "I", 1);

      const { error: investorError } = await supabaseAdmin.from("investors").insert({
        id: investorId,
        name: data.name,
        contributed: data.investorContribution,
        share_pct: 0,
        joined_at: data.joinedAt ?? new Date().toISOString().slice(0, 10),
        phone,
        notes: data.investorNotes ?? null,
        member_id: memberId,
      });
      if (investorError) throw new Error(investorError.message);

      const { error: memberUpdateError } = await supabaseAdmin
        .from("members")
        .update({ investor_id: investorId })
        .eq("id", memberId);
      if (memberUpdateError) throw new Error(memberUpdateError.message);

      if (data.investorContribution > 0) {
        const txId = await nextPrefixedId("transactions", "T", 1);
        const { error: txError } = await supabaseAdmin.from("transactions").insert({
          id: txId,
          date: data.joinedAt ?? new Date().toISOString().slice(0, 10),
          type: "investor_contribution",
          amount: data.investorContribution,
          member_id: memberId,
          account: formatMembershipNumber(memberId),
          by_staff: actor.id,
          note: `Investor onboarding: ${data.name}`,
        });
        if (txError) throw new Error(txError.message);
      }
    }

    await auditAction({
      actor,
      action: "member.created",
      targetType: "member",
      targetId: memberId,
      summary: `${actor.name} created member ${data.name}`,
      details: {
        membershipNumber: formatMembershipNumber(memberId),
        category: memberCategory,
        fieldOfficerId,
        status: data.status,
        phone,
        savingsBalance,
        shares,
        businessName: data.businessName ?? null,
        businessPermanence: data.businessPermanence ?? null,
        investorContribution: data.investorContribution || 0,
      },
    });
    return { id: memberId };
  });

export const createStaffRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      name: string;
      role: "director" | "manager" | "loan_officer";
      firstName?: string;
      secondName?: string;
      thirdName?: string;
      email?: string;
      phone?: string;
      nationalId?: string;
      address?: string;
      notes?: string;
      photo?: string;
      tempPassword?: string;
      canMarkAttendance?: boolean;
      fingerprintEnrolled?: boolean;
    }) => ({
      name: String(data?.name ?? "").trim(),
      role: data?.role ?? "loan_officer",
      firstName: data?.firstName?.trim() || undefined,
      secondName: data?.secondName?.trim() || undefined,
      thirdName: data?.thirdName?.trim() || undefined,
      email: data?.email?.trim() || undefined,
      phone: data?.phone?.trim() || undefined,
      nationalId: data?.nationalId?.trim() || undefined,
      address: data?.address?.trim() || undefined,
      notes: data?.notes?.trim() || undefined,
      photo: data?.photo || undefined,
      tempPassword: data?.tempPassword || undefined,
      canMarkAttendance: !!data?.canMarkAttendance,
      fingerprintEnrolled: !!data?.fingerprintEnrolled,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.name) throw new Error("Staff name is required.");
    if (!data.email) throw new Error("Staff email is required.");
    if (!data.tempPassword || data.tempPassword.length < 6) {
      throw new Error("Temporary password must be at least 6 characters.");
    }

    const supabaseAdmin = await requireSupabaseAdmin();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("staff")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing)
      throw new Error("That email address is already assigned to another staff account.");

    const staffId = await nextPrefixedId("staff", "S", 1);
    const { error } = await supabaseAdmin.from("staff").insert({
      id: staffId,
      name: data.name,
      role: data.role as never,
      email: data.email,
      phone: data.phone ?? null,
      national_id: data.nationalId ?? null,
      address: data.address ?? null,
      notes: data.notes ?? null,
      photo: data.photo ?? null,
      temp_password: hashPassword(data.tempPassword),
      can_mark_attendance: data.role === "director" ? true : data.canMarkAttendance,
      fingerprint_enrolled: data.fingerprintEnrolled,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "staff.created",
      targetType: "staff",
      targetId: staffId,
      summary: `${actor.name} created staff account ${data.name}`,
      details: {
        role: data.role,
        email: data.email,
        canMarkAttendance: data.role === "director" ? true : data.canMarkAttendance,
        fingerprintEnrolled: data.fingerprintEnrolled,
      },
    });
    return { id: staffId };
  });

export const updateStaffRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      patch: {
        name?: string;
        role?: "director" | "manager" | "loan_officer";
        firstName?: string;
        secondName?: string;
        thirdName?: string;
        email?: string;
        phone?: string;
        nationalId?: string;
        address?: string;
        notes?: string;
        photo?: string;
        tempPassword?: string;
        canMarkAttendance?: boolean;
        fingerprintEnrolled?: boolean;
      };
    }) => ({
      id: String(data?.id ?? "").trim(),
      patch: data?.patch ?? {},
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.id) throw new Error("Staff id is required.");
    if (data.patch.tempPassword && data.patch.tempPassword.length < 6) {
      throw new Error("Temporary password must be at least 6 characters.");
    }
    if (data.id === actor.id && data.patch.role && data.patch.role !== "director") {
      throw new Error("You cannot remove your own director access.");
    }
    const supabaseAdmin = await requireSupabaseAdmin();
    const patch = data.patch;
    const { error } = await supabaseAdmin
      .from("staff")
      .update({
        name: patch.name?.trim() || undefined,
        role: patch.role as never,
        email: patch.email?.trim() || undefined,
        phone: patch.phone?.trim() || null,
        national_id: patch.nationalId?.trim() || null,
        address: patch.address?.trim() || null,
        notes: patch.notes?.trim() || null,
        photo: patch.photo || null,
        temp_password: patch.tempPassword ? hashPassword(patch.tempPassword) : undefined,
        can_mark_attendance: patch.role === "director" ? true : patch.canMarkAttendance,
        fingerprint_enrolled: patch.fingerprintEnrolled,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "staff.updated",
      targetType: "staff",
      targetId: data.id,
      summary: `${actor.name} updated staff ${data.id}`,
      details: {
        name: patch.name?.trim() || undefined,
        role: patch.role,
        email: patch.email?.trim() || undefined,
        phone: patch.phone?.trim() || undefined,
        canMarkAttendance: patch.role === "director" ? true : patch.canMarkAttendance,
        fingerprintEnrolled: patch.fingerprintEnrolled,
        passwordReset: !!patch.tempPassword,
      },
    });
    return { ok: true };
  });

export const deleteStaffRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.id) throw new Error("Staff id is required.");
    if (data.id === actor.id) throw new Error("You cannot delete your own staff account.");
    const supabaseAdmin = await requireSupabaseAdmin();
    const { data: existingStaff } = await supabaseAdmin
      .from("staff")
      .select("name, role, email")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("staff").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "staff.deleted",
      targetType: "staff",
      targetId: data.id,
      summary: `${actor.name} deleted staff ${existingStaff?.name ?? data.id}`,
      details: {
        name: existingStaff?.name ?? null,
        role: existingStaff?.role ?? null,
        email: existingStaff?.email ?? null,
      },
    });
    return { ok: true };
  });

export const upsertAttendanceRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      staffId: string;
      status: "present" | "signed_out" | "permission" | "absent";
      when?: "in" | "out";
      date?: string;
    }) => ({
      staffId: String(data?.staffId ?? "").trim(),
      status: data?.status ?? "present",
      when: data?.when ?? "in",
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.staffId) throw new Error("Staff id is required.");
    const canMarkOtherStaff =
      actor.id === data.staffId ||
      actor.role === "director" ||
      actor.role === "manager" ||
      actor.canMarkAttendance;
    if (!canMarkOtherStaff) {
      throw new Error("You can only update your own attendance unless granted attendance rights.");
    }
    const supabaseAdmin = await requireSupabaseAdmin();
    const time = new Date().toTimeString().slice(0, 5);
    const id = `A-${data.date}-${data.staffId}`;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("attendance")
      .select("check_in, check_out")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const checkIn =
      data.status === "present" && data.when === "in" ? time : (existing?.check_in ?? null);
    const checkOut =
      data.status === "signed_out" && data.when === "out" ? time : (existing?.check_out ?? null);

    const { error } = await supabaseAdmin.from("attendance").upsert({
      id,
      staff_id: data.staffId,
      date: data.date,
      status: data.status as never,
      check_in: data.status === "permission" || data.status === "absent" ? null : checkIn,
      check_out: data.status === "permission" || data.status === "absent" ? null : checkOut,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "attendance.upserted",
      targetType: "attendance",
      targetId: id,
      summary: `${actor.name} recorded attendance for ${data.staffId}`,
      details: {
        staffId: data.staffId,
        status: data.status,
        when: data.when,
        date: data.date,
        checkIn,
        checkOut,
      },
    });

    return { ok: true };
  });

export const createFieldVisitRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId: string;
      type: "business" | "home" | "live";
      locationNotes?: string;
      lat?: number;
      lng?: number;
      photos?: string[];
      photoLabels?: string[];
      byStaff?: string;
      date?: string;
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      type:
        data?.type === "home" || data?.type === "live" || data?.type === "business"
          ? data.type
          : "business",
      locationNotes: String(data?.locationNotes ?? "").trim(),
      lat: data?.lat == null ? undefined : Number(data.lat),
      lng: data?.lng == null ? undefined : Number(data.lng),
      photos: Array.isArray(data?.photos)
        ? data.photos.map((photo) => String(photo ?? "").trim()).filter(Boolean)
        : [],
      photoLabels: Array.isArray(data?.photoLabels)
        ? data.photoLabels.map((label) => String(label ?? "").trim())
        : [],
      byStaff: data?.byStaff?.trim() || undefined,
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.memberId) throw new Error("Member is required.");
    if (!data.locationNotes && (data.lat == null || data.lng == null)) {
      throw new Error("Add location notes or capture GPS coordinates.");
    }
    if ((data.lat == null) !== (data.lng == null)) {
      throw new Error("Both latitude and longitude are required together.");
    }
    if (data.lat != null && !Number.isFinite(data.lat)) {
      throw new Error("Latitude is invalid.");
    }
    if (data.lng != null && !Number.isFinite(data.lng)) {
      throw new Error("Longitude is invalid.");
    }
    if (data.photos.length > MAX_FIELD_VISIT_PHOTOS) {
      throw new Error(`Attach at most ${MAX_FIELD_VISIT_PHOTOS} photos per field visit.`);
    }
    if (data.photoLabels.length && data.photoLabels.length !== data.photos.length) {
      throw new Error("Each photo must have a matching description.");
    }
    const totalPhotoBytes = data.photos.reduce((sum, photo) => sum + approxDataUrlBytes(photo), 0);
    if (totalPhotoBytes > MAX_FIELD_VISIT_TOTAL_BYTES) {
      throw new Error(
        "The selected field visit photos are too large. Remove some photos and try again.",
      );
    }

    const photoLabels = data.photoLabels.length === data.photos.length ? data.photoLabels : [];

    const supabaseAdmin = await requireSupabaseAdmin();
    const id = await nextPrefixedId("field_visits", "FV", 1);
    const insertPayload = {
      id,
      member_id: data.memberId,
      date: data.date,
      type: data.type,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      location_notes: data.locationNotes || null,
      photos: data.photos.length ? data.photos : null,
      photo_labels: photoLabels.length ? photoLabels : null,
      by_staff: actor.id,
    };
    const { error } = await supabaseAdmin.from("field_visits").insert(insertPayload);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "field_visit.created",
      targetType: "field_visit",
      targetId: id,
      summary: `${actor.name} added a ${data.type} field visit for ${data.memberId}`,
      details: {
        memberId: data.memberId,
        date: data.date,
        hasGps: data.lat != null && data.lng != null,
        photoCount: data.photos.length,
        locationNotes: clipAuditText(data.locationNotes, 160),
      },
    });
    return {
      id,
      visit: mapFieldVisitRow(insertPayload),
    };
  });

export const createLoanRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId: string;
      principal: number;
      approvedAmount?: number;
      rate?: number;
      termMonths?: number;
      termDays?: number;
      startDate?: string;
      status?: "pending" | "active" | "closed" | "defaulted" | "rejected";
      officerId?: string;
      purpose?: string;
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      principal: Number(data?.principal ?? 0),
      approvedAmount: data?.approvedAmount == null ? undefined : Number(data.approvedAmount ?? 0),
      rate: Number(data?.rate ?? 0),
      termMonths: Number(data?.termMonths ?? 0),
      termDays: data?.termDays == null ? undefined : Number(data.termDays),
      startDate: data?.startDate?.trim() || new Date().toISOString().slice(0, 10),
      status: data?.status ?? "pending",
      officerId: data?.officerId?.trim() || undefined,
      purpose: data?.purpose?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.memberId) throw new Error("Member is required.");
    if (data.principal <= 0) throw new Error("Loan principal must be above zero.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const id = await nextPrefixedId("loans", "L", 1001);
    const approvedAmount =
      data.status === "active" ? (data.approvedAmount ?? data.principal) : data.approvedAmount;
    const officerId = data.officerId ?? actor.id;
    const { error } = await supabaseAdmin.from("loans").insert({
      id,
      member_id: data.memberId,
      principal: data.principal,
      approved_amount: approvedAmount ?? null,
      rate: data.rate,
      term_months: data.termMonths,
      term_days: data.termDays ?? null,
      start_date: data.startDate,
      status: data.status as never,
      officer_id: officerId,
      paid: 0,
      purpose: data.purpose ?? null,
    });
    if (error) throw new Error(error.message);

    if (data.status === "active") {
      await insertTransactionRow({
        date: data.startDate,
        type: "loan_disbursement",
        amount: approvedAmount ?? data.principal,
        member_id: data.memberId,
        loan_id: id,
        by_staff: actor.id,
        note: data.purpose ? `Disbursed for ${data.purpose}` : "Direct active loan disbursement",
      });
    }

    await auditAction({
      actor,
      action: "loan.created",
      targetType: "loan",
      targetId: id,
      summary: `${actor.name} created loan ${id}`,
      details: {
        memberId: data.memberId,
        principal: data.principal,
        approvedAmount: approvedAmount ?? null,
        status: data.status,
        officerId,
        termDays: data.termDays ?? null,
        termMonths: data.termMonths,
        purpose: clipAuditText(data.purpose, 160),
      },
    });
    return { id };
  });

export const reviewLoanRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      loanId: string;
      decision: "approved" | "rejected";
      approvedAmount?: number;
      reviewedBy: string;
      note?: string;
    }) => ({
      loanId: String(data?.loanId ?? "").trim(),
      decision: data?.decision ?? "approved",
      approvedAmount: data?.approvedAmount == null ? undefined : Number(data.approvedAmount ?? 0),
      reviewedBy: String(data?.reviewedBy ?? "").trim(),
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireManagerOrDirectorActor();
    if (!data.loanId) throw new Error("Loan id is required.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const { data: loan, error: loanError } = await supabaseAdmin
      .from("loans")
      .select("*")
      .eq("id", data.loanId)
      .maybeSingle();
    if (loanError) throw new Error(loanError.message);
    if (!loan) throw new Error("Loan not found.");
    if (loan.status !== "pending") throw new Error("Loan has already been reviewed.");

    if (data.decision === "rejected") {
      const { error } = await supabaseAdmin
        .from("loans")
        .update({
          status: "rejected",
          reviewed_by: actor.id,
          review_note: data.note ?? null,
        })
        .eq("id", data.loanId);
      if (error) throw new Error(error.message);
      await auditAction({
        actor,
        action: "loan.rejected",
        targetType: "loan",
        targetId: data.loanId,
        summary: `${actor.name} rejected loan ${data.loanId}`,
        details: {
          memberId: loan.member_id,
          note: clipAuditText(data.note, 160),
        },
      });
      return { ok: true };
    }

    const approvedAmount = data.approvedAmount ?? Number(loan.principal ?? 0);
    if (approvedAmount <= 0) throw new Error("Approved amount must be above zero.");

    const { error } = await supabaseAdmin
      .from("loans")
      .update({
        principal: approvedAmount,
        approved_amount: approvedAmount,
        status: "active",
        reviewed_by: actor.id,
        review_note: data.note ?? null,
      })
      .eq("id", data.loanId);
    if (error) throw new Error(error.message);

    await insertTransactionRow({
      date: new Date().toISOString().slice(0, 10),
      type: "loan_disbursement",
      amount: approvedAmount,
      member_id: loan.member_id,
      loan_id: loan.id,
      by_staff: actor.id,
      note: data.note ?? "Approved",
    });

    await auditAction({
      actor,
      action: "loan.approved",
      targetType: "loan",
      targetId: data.loanId,
      summary: `${actor.name} approved loan ${data.loanId}`,
      details: {
        memberId: loan.member_id,
        approvedAmount,
        note: clipAuditText(data.note, 160),
      },
    });
    return { ok: true };
  });

export const createTransactionRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      date?: string;
      type:
        | "deposit"
        | "withdrawal"
        | "loan_disbursement"
        | "loan_repayment"
        | "share_purchase"
        | "petty_cash"
        | "investor_contribution"
        | "fee_payment"
        | "mpesa_unallocated";
      account?: string;
      payerName?: string;
      amount: number;
      memberId?: string;
      loanId?: string;
      ref?: string;
      by: string;
      note?: string;
    }) => ({
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
      type: data?.type ?? "deposit",
      account: data?.account?.trim() || undefined,
      payerName: data?.payerName?.trim() || undefined,
      amount: Number(data?.amount ?? 0),
      memberId: data?.memberId?.trim() || undefined,
      loanId: data?.loanId?.trim() || undefined,
      ref: data?.ref?.trim() || undefined,
      by: String(data?.by ?? "").trim(),
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (data.amount <= 0) throw new Error("Transaction amount must be above zero.");
    if (data.type === "loan_repayment" && !data.loanId) {
      throw new Error("Loan repayment transactions must be linked to a loan.");
    }
    if (data.type === "share_purchase" && data.amount % SHARE_PRICE !== 0) {
      throw new Error(`Share purchases must be in increments of ${SHARE_PRICE}/=.`);
    }

    const supabaseAdmin = await requireSupabaseAdmin();
    let resolvedMemberId = data.memberId;
    let investorTarget: {
      id: string;
      contributed: number | string | null;
      member_id: string | null;
    } | null = null;

    if (!resolvedMemberId && data.account) {
      const member = await findMemberByMembershipInput(data.account);
      resolvedMemberId = member?.id;
    }

    if (data.type === "investor_contribution") {
      if (!resolvedMemberId) {
        throw new Error("Investor contributions must be linked to a membership number.");
      }
      const { data: member, error: memberError } = await supabaseAdmin
        .from("members")
        .select("*")
        .eq("id", resolvedMemberId)
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (!member) throw new Error("The selected membership number was not found.");
      investorTarget = await ensureInvestorForMember(member);
      if (!investorTarget) {
        throw new Error("The selected membership number is not registered as an investor.");
      }
    }

    const id = await insertTransactionRow({
      date: data.date,
      type: data.type,
      amount: data.amount,
      member_id: resolvedMemberId ?? null,
      loan_id: data.loanId ?? null,
      by_staff: actor.id,
      note: data.note ?? null,
      ref: data.ref ?? null,
      account: data.account ?? (resolvedMemberId ? formatMembershipNumber(resolvedMemberId) : null),
      payer_name: data.payerName ?? null,
    });

    if (resolvedMemberId) {
      const { data: member, error: memberError } = await supabaseAdmin
        .from("members")
        .select("savings_balance, shares")
        .eq("id", resolvedMemberId)
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      if (member) {
        const patch: Record<string, unknown> = {};
        if (data.type === "deposit") {
          patch.savings_balance = Number(member.savings_balance ?? 0) + data.amount;
        } else if (data.type === "withdrawal") {
          if (Number(member.savings_balance ?? 0) < data.amount) {
            throw new Error("Withdrawal exceeds the member's savings balance.");
          }
          patch.savings_balance = Math.max(0, Number(member.savings_balance ?? 0) - data.amount);
        } else if (data.type === "share_purchase") {
          patch.shares = Number(member.shares ?? 0) + Math.floor(data.amount / SHARE_PRICE);
        }
        if (Object.keys(patch).length > 0) {
          const { error: updateMemberError } = await supabaseAdmin
            .from("members")
            .update(patch as any)
            .eq("id", resolvedMemberId);
          if (updateMemberError) throw new Error(updateMemberError.message);
        }
      }
    }

    if (data.type === "investor_contribution" && investorTarget) {
      const { error: investorError } = await supabaseAdmin
        .from("investors")
        .update({
          contributed: Number(investorTarget.contributed ?? 0) + data.amount,
        })
        .eq("id", investorTarget.id);
      if (investorError) throw new Error(investorError.message);
    }

    if (data.loanId && data.type === "loan_repayment") {
      const { data: loan, error: loanError } = await supabaseAdmin
        .from("loans")
        .select("*")
        .eq("id", data.loanId)
        .maybeSingle();
      if (loanError) throw new Error(loanError.message);
      if (loan) {
        const summary = loanBalanceSummary(loan);
        const nextPaid = Number(loan.paid ?? 0) + data.amount;
        const nextBalance = Math.max(0, summary.total - nextPaid);
        const { error: updateLoanError } = await supabaseAdmin
          .from("loans")
          .update({
            paid: nextPaid,
            status: nextBalance <= 0 ? "closed" : loan.status,
          })
          .eq("id", data.loanId);
        if (updateLoanError) throw new Error(updateLoanError.message);
      }
    }

    await auditAction({
      actor,
      action: "transaction.created",
      targetType: "transaction",
      targetId: id,
      summary: `${actor.name} recorded ${data.type} transaction ${id}`,
      details: {
        type: data.type,
        amount: data.amount,
        memberId: resolvedMemberId ?? null,
        loanId: data.loanId ?? null,
        date: data.date,
        account:
          data.account ?? (resolvedMemberId ? formatMembershipNumber(resolvedMemberId) : null),
        ref: data.ref ?? null,
        note: clipAuditText(data.note, 160),
      },
    });
    return { id };
  });

export const createPettyCashRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      date?: string;
      description: string;
      amount: number;
      category?: string;
      by?: string;
      time?: string;
      type?: "payment" | "topup";
      payee?: string;
      contact?: string;
      mode?: "cash" | "mpesa" | "bank";
      reference?: string;
      txnCost?: number;
      openingBalance?: number;
    }) => ({
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
      description: String(data?.description ?? "").trim(),
      amount: Number(data?.amount ?? 0),
      category: data?.category?.trim() || undefined,
      by: data?.by?.trim() || undefined,
      time: data?.time?.trim() || undefined,
      type: data?.type,
      payee: data?.payee?.trim() || undefined,
      contact: data?.contact?.trim() || undefined,
      mode: data?.mode,
      reference: data?.reference?.trim() || undefined,
      txnCost: data?.txnCost == null ? undefined : Number(data.txnCost),
      openingBalance: data?.openingBalance == null ? undefined : Number(data.openingBalance),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.description) throw new Error("Petty cash details are required.");
    if (data.amount <= 0) throw new Error("Petty cash amount must be above zero.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const id = await nextPrefixedId("petty_cash", "P", 1);
    const { error } = await supabaseAdmin.from("petty_cash").insert({
      id,
      date: data.date,
      description: data.description,
      amount: data.amount,
      category: data.category ?? null,
      by_staff: actor.id,
      time: data.time ?? null,
      type: data.type ?? null,
      payee: data.payee ?? null,
      contact: data.contact ?? null,
      mode: data.mode ?? null,
      reference: data.reference ?? null,
      txn_cost: data.txnCost ?? null,
      opening_balance: data.openingBalance ?? null,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "petty_cash.created",
      targetType: "petty_cash",
      targetId: id,
      summary: `${actor.name} recorded petty cash entry ${id}`,
      details: {
        date: data.date,
        amount: data.amount,
        category: data.category ?? null,
        type: data.type ?? null,
        mode: data.mode ?? null,
        description: clipAuditText(data.description, 160),
        payee: clipAuditText(data.payee, 80),
        reference: clipAuditText(data.reference, 80),
      },
    });
    return { id };
  });

export const createAppraisalRecord = createServerFn({ method: "POST" })
  .inputValidator((data: Record<string, unknown>) => data)
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    const memberId = String(data.memberId ?? "").trim();
    if (!memberId) throw new Error("Member is required.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const id = await nextPrefixedId("appraisals", "AP", 1);
    const { error } = await supabaseAdmin.from("appraisals").insert({
      id,
      member_id: memberId,
      loan_id: data.loanId ? String(data.loanId) : null,
      date: new Date().toISOString().slice(0, 10),
      officer_id: actor.id,
      good_day: Number(data.goodDay ?? 0),
      average_day: Number(data.averageDay ?? 0),
      bad_day: Number(data.badDay ?? 0),
      operating_expenses: Number(data.operatingExpenses ?? 0),
      non_earning_days: Number(data.nonEarningDays ?? 0),
      existing_debt: Number(data.existingDebt ?? 0),
      monthly_debt_repayment: Number(data.monthlyDebtRepayment ?? 0),
      crb_status: data.crbStatus ? String(data.crbStatus) : null,
      reschedules_last_12: Number(data.reschedulesLast12 ?? 0),
      dti: Number(data.dti ?? 0),
      dicr: Number(data.dicr ?? 0),
      bdsr: Number(data.bdsr ?? 0),
      lsr: Number(data.lsr ?? 0),
      savings_buffer: Number(data.savingsBuffer ?? 0),
      score_dicr: Number(data.scoreDICR ?? 0),
      score_bdsr: Number(data.scoreBDSR ?? 0),
      score_savings: Number(data.scoreSavings ?? 0),
      score_crb: Number(data.scoreCRB ?? 0),
      score_burden: Number(data.scoreBurden ?? 0),
      score_docs: Number(data.scoreDocs ?? 0),
      score_coop: Number(data.scoreCoop ?? 0),
      total_score: Number(data.totalScore ?? 0),
      decision: data.decision ? String(data.decision) : null,
      risk_level: data.riskLevel ? String(data.riskLevel) : null,
      approved_amount: Number(data.approvedAmount ?? 0),
      approved_term: data.approvedTerm ? String(data.approvedTerm) : null,
      special_conditions: data.specialConditions ? String(data.specialConditions) : null,
      notes: data.notes ? String(data.notes) : null,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "appraisal.created",
      targetType: "appraisal",
      targetId: id,
      summary: `${actor.name} created appraisal ${id}`,
      details: {
        memberId,
        loanId: data.loanId ? String(data.loanId) : null,
        decision: data.decision ? String(data.decision) : null,
        riskLevel: data.riskLevel ? String(data.riskLevel) : null,
        approvedAmount: Number(data.approvedAmount ?? 0),
        totalScore: Number(data.totalScore ?? 0),
      },
    });
    return { id };
  });

export const createInvestorRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      name: string;
      contributed: number;
      sharePct?: number;
      joinedAt?: string;
      phone?: string;
      notes?: string;
      memberId?: string;
      byStaff?: string;
    }) => ({
      name: String(data?.name ?? "").trim(),
      contributed: Number(data?.contributed ?? 0),
      sharePct: Number(data?.sharePct ?? 0),
      joinedAt: data?.joinedAt?.trim() || new Date().toISOString().slice(0, 10),
      phone: data?.phone?.trim() || undefined,
      notes: data?.notes?.trim() || undefined,
      memberId: data?.memberId?.trim() || undefined,
      byStaff: data?.byStaff?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.name) throw new Error("Investor name is required.");
    if (data.contributed <= 0) throw new Error("Contribution must be above zero.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const id = await nextPrefixedId("investors", "I", 1);
    const { error } = await supabaseAdmin.from("investors").insert({
      id,
      name: data.name,
      contributed: data.contributed,
      share_pct: data.sharePct,
      joined_at: data.joinedAt,
      phone: data.phone ?? null,
      notes: data.notes ?? null,
      member_id: data.memberId ?? null,
    });
    if (error) throw new Error(error.message);

    if (data.memberId) {
      const { data: member, error: memberLookupError } = await supabaseAdmin
        .from("members")
        .select("member_category, is_investor")
        .eq("id", data.memberId)
        .maybeSingle();
      if (memberLookupError) throw new Error(memberLookupError.message);
      const nextCategory =
        resolveMemberCategory(member?.member_category, member?.is_investor) === "investor"
          ? "investor"
          : "both";
      const { error: memberError } = await supabaseAdmin
        .from("members")
        .update({
          is_investor: true,
          investor_id: id,
          member_category: nextCategory,
        })
        .eq("id", data.memberId);
      if (memberError) throw new Error(memberError.message);
    }

    await insertTransactionRow({
      date: data.joinedAt,
      type: "investor_contribution",
      amount: data.contributed,
      member_id: data.memberId ?? null,
      by_staff: actor.id,
      note: `Investor: ${data.name}`,
    });

    await auditAction({
      actor,
      action: "investor.created",
      targetType: "investor",
      targetId: id,
      summary: `${actor.name} created investor ${data.name}`,
      details: {
        name: data.name,
        memberId: data.memberId ?? null,
        contributed: data.contributed,
        sharePct: data.sharePct,
        joinedAt: data.joinedAt,
      },
    });
    return { id };
  });

export const createFollowupRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      loanId: string;
      memberId: string;
      date?: string;
      note: string;
      outcome: "promised" | "paid" | "no-show" | "dispute" | "other";
      by: string;
    }) => ({
      loanId: String(data?.loanId ?? "").trim(),
      memberId: String(data?.memberId ?? "").trim(),
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
      note: String(data?.note ?? "").trim(),
      outcome: data?.outcome ?? "promised",
      by: String(data?.by ?? "").trim(),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.loanId || !data.memberId || !data.note) {
      throw new Error("Follow-up details are incomplete.");
    }

    const supabaseAdmin = await requireSupabaseAdmin();
    const id = await nextPrefixedId("followups", "FU", 1);
    const { error } = await supabaseAdmin.from("followups").insert({
      id,
      loan_id: data.loanId,
      member_id: data.memberId,
      date: data.date,
      note: data.note,
      outcome: data.outcome as never,
      by_staff: actor.id,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "followup.created",
      targetType: "followup",
      targetId: id,
      summary: `${actor.name} added follow-up ${id}`,
      details: {
        loanId: data.loanId,
        memberId: data.memberId,
        date: data.date,
        outcome: data.outcome,
        note: clipAuditText(data.note, 160),
      },
    });
    return {
      id,
      followup: mapFollowupRow({
        id,
        loan_id: data.loanId,
        member_id: data.memberId,
        date: data.date,
        note: data.note,
        outcome: data.outcome,
        by_staff: actor.id,
      }),
    };
  });

export const settlePenaltyFromPoolRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { penaltyId: string }) => ({
    penaltyId: String(data?.penaltyId ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireManagerOrDirectorActor();
    if (!data.penaltyId) throw new Error("Penalty id is required.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const { data: penalty, error: penaltyError } = await supabaseAdmin
      .from("penalties")
      .select("*")
      .eq("id", data.penaltyId)
      .maybeSingle();
    if (penaltyError) throw new Error(penaltyError.message);
    if (!penalty || penalty.status !== "outstanding") return { ok: false };

    const { data: credits, error: creditsError } = await supabaseAdmin
      .from("round_off")
      .select("amount")
      .eq("member_id", penalty.member_id);
    if (creditsError) throw new Error(creditsError.message);
    const { data: debits, error: debitsError } = await supabaseAdmin
      .from("penalties")
      .select("amount")
      .eq("member_id", penalty.member_id)
      .eq("status", "paid")
      .eq("paid_from", "round_off_pool");
    if (debitsError) throw new Error(debitsError.message);

    const creditAmount = (credits ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const debitAmount = (debits ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const balance = creditAmount - debitAmount;
    if (balance < Number(penalty.amount ?? 0)) return { ok: false };

    const { error } = await supabaseAdmin
      .from("penalties")
      .update({ status: "paid", paid_from: "round_off_pool" })
      .eq("id", data.penaltyId);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "penalty.settled_from_round_off",
      targetType: "penalty",
      targetId: data.penaltyId,
      summary: `${actor.name} settled penalty ${data.penaltyId} from round-off pool`,
      details: {
        memberId: penalty.member_id,
        amount: Number(penalty.amount ?? 0),
        reason: clipAuditText(penalty.reason, 160),
      },
    });
    return { ok: true };
  });

export const applyMpesaPaymentRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      eventId?: string;
      account: string;
      amount: number;
      payerName?: string;
      mpesaRef?: string;
    }) => ({
      eventId: data?.eventId?.trim() || undefined,
      account: String(data?.account ?? "").trim(),
      amount: Number(data?.amount ?? 0),
      payerName: data?.payerName?.trim() || undefined,
      mpesaRef: data?.mpesaRef?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.account) throw new Error("M-Pesa account is required.");
    if (data.amount <= 0) throw new Error("M-Pesa amount must be above zero.");
    const result = await applyMpesaPaymentToDatabase(data);
    await auditAction({
      actor,
      action: "mpesa.payment_applied",
      targetType: "mpesa_event",
      targetId: data.eventId ?? data.mpesaRef ?? data.account,
      summary: `${actor.name} processed M-Pesa payment for ${data.account}`,
      details: {
        account: data.account,
        amount: data.amount,
        payerName: clipAuditText(data.payerName, 80),
        mpesaRef: data.mpesaRef ?? null,
        matched: result.matched,
        memberId: result.memberId ?? null,
        primaryType: result.primary?.type ?? null,
        primaryAmount: result.primary?.amount ?? null,
        toRoundOff: result.toRoundOff ?? 0,
      },
    });
    return result;
  });

export const createStaffMessageRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      senderId: string;
      receiverId: string;
      senderName: string;
      content?: string;
      attachment?: Record<string, unknown>;
    }) => ({
      senderId: String(data?.senderId ?? "").trim(),
      receiverId: String(data?.receiverId ?? "").trim(),
      senderName: String(data?.senderName ?? "").trim(),
      content: data?.content?.toString().trim() || undefined,
      attachment: data?.attachment ?? undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.senderId || !data.receiverId)
      throw new Error("Both sender and receiver are required.");
    if (!data.content && !data.attachment) throw new Error("Message cannot be empty.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = makeId("STM");
    const { error } = await runtimeDb.from("staff_messages").insert({
      id,
      sender_id: actor.id,
      receiver_id: data.receiverId,
      sender_name: actor.name,
      content: data.content ?? null,
      attachment: data.attachment ?? null,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "staff_message.sent",
      targetType: "staff_message",
      targetId: id,
      summary: `${actor.name} sent a staff message to ${data.receiverId}`,
      details: {
        receiverId: data.receiverId,
        contentPreview: clipAuditText(data.content, 160),
        attachment: summarizeAttachment(data.attachment),
      },
    });
    return { id };
  });

export const createStaffMemoRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { title: string; body: string; by: string; byStaffId?: string; date?: string }) => ({
      title: String(data?.title ?? "").trim(),
      body: String(data?.body ?? "").trim(),
      by: String(data?.by ?? "").trim(),
      byStaffId: data?.byStaffId?.trim() || undefined,
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.title || !data.body || !data.by)
      throw new Error("Memo title, body and author are required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = makeId("MEM");
    const { error } = await runtimeDb.from("staff_memos").insert({
      id,
      memo_date: data.date,
      title: data.title,
      body: data.body,
      by_staff_id: actor.id,
      by_name: actor.name,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "staff_memo.created",
      targetType: "staff_memo",
      targetId: id,
      summary: `${actor.name} posted memo ${data.title}`,
      details: {
        date: data.date,
        title: clipAuditText(data.title, 120),
        bodyPreview: clipAuditText(data.body, 180),
      },
    });
    return { id };
  });

export const deleteStaffMemoRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.id) throw new Error("Memo id is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: memo } = await runtimeDb
      .from("staff_memos")
      .select("title, memo_date, by_name")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await runtimeDb.from("staff_memos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "staff_memo.deleted",
      targetType: "staff_memo",
      targetId: data.id,
      summary: `${actor.name} deleted memo ${memo?.title ?? data.id}`,
      details: {
        title: memo?.title ?? null,
        memoDate: memo?.memo_date ?? null,
        byName: memo?.by_name ?? null,
      },
    });
    return { ok: true };
  });

export const createApprovalRequestRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      kind: string;
      title: string;
      detail: string;
      requestedBy: string;
      requestedByName?: string;
      payload?: Record<string, unknown>;
    }) => ({
      kind: String(data?.kind ?? "").trim(),
      title: String(data?.title ?? "").trim(),
      detail: String(data?.detail ?? "").trim(),
      requestedBy: String(data?.requestedBy ?? "").trim(),
      requestedByName: data?.requestedByName?.trim() || undefined,
      payload: data?.payload ?? undefined,
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    if (!data.kind || !data.title || !data.detail || !data.requestedBy) {
      throw new Error("Approval request is incomplete.");
    }

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = makeId("APR");
    let requestedBy = data.requestedBy;
    let requestedByName = data.requestedByName ?? null;
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      requestedBy = member.id;
      requestedByName = member.name;
    } else {
      const actor = await requireStaffActor();
      requestedBy = actor.id;
      requestedByName = actor.name;
    }
    const { error } = await runtimeDb.from("approval_requests").insert({
      id,
      kind: data.kind,
      title: data.title,
      detail: data.detail,
      requested_by: requestedBy,
      requested_by_name: requestedByName,
      payload: data.payload ?? null,
    });
    if (error) throw new Error(error.message);
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      await recordAudit({
        actor_id: member.id,
        actor_name: member.name,
        actor_role: "member",
        action: "approval_request.created",
        target_type: "approval_request",
        target_id: id,
        summary: `${member.name} created approval request ${data.title}`,
        details: {
          kind: data.kind,
          title: clipAuditText(data.title, 120),
          detail: clipAuditText(data.detail, 180),
        },
      });
    } else {
      const actor = await requireStaffActor();
      await auditAction({
        actor,
        action: "approval_request.created",
        targetType: "approval_request",
        targetId: id,
        summary: `${actor.name} created approval request ${data.title}`,
        details: {
          kind: data.kind,
          title: clipAuditText(data.title, 120),
          detail: clipAuditText(data.detail, 180),
        },
      });
    }
    return { id };
  });

export const decideApprovalRequestRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      decision: "approved" | "rejected";
      reviewedBy: string;
      note?: string;
    }) => ({
      id: String(data?.id ?? "").trim(),
      decision: data?.decision ?? "approved",
      reviewedBy: String(data?.reviewedBy ?? "").trim(),
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireManagerOrDirectorActor();
    if (!data.id) throw new Error("Approval decision is incomplete.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { error } = await runtimeDb
      .from("approval_requests")
      .update({
        status: data.decision,
        reviewed_by: actor.id,
        review_note: data.note ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "approval_request.decided",
      targetType: "approval_request",
      targetId: data.id,
      summary: `${actor.name} ${data.decision} approval request ${data.id}`,
      details: {
        decision: data.decision,
        note: clipAuditText(data.note, 160),
      },
    });
    return { ok: true };
  });

export const upsertFeePolicyRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      key: string;
      label: string;
      amount: number;
      permanence: "permanent" | "semi";
      durationDays?: number;
      effectiveFrom: string;
      scope: "all" | "new_only" | "selected_members" | "loan_holders" | "investors";
      selectedMemberIds?: string[];
      custom?: boolean;
      notes?: string;
    }) => ({
      key: String(data?.key ?? "").trim(),
      label: String(data?.label ?? "").trim(),
      amount: Number(data?.amount ?? 0),
      permanence: data?.permanence ?? "permanent",
      durationDays: data?.durationDays ? Number(data.durationDays) : undefined,
      effectiveFrom:
        String(data?.effectiveFrom ?? "").trim() || new Date().toISOString().slice(0, 10),
      scope: data?.scope ?? "all",
      selectedMemberIds: Array.isArray(data?.selectedMemberIds)
        ? data.selectedMemberIds.map((value) => String(value ?? "").trim()).filter(Boolean)
        : [],
      custom: !!data?.custom,
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.key || !data.label) throw new Error("Fee policy key and label are required.");
    if (data.scope === "selected_members" && data.selectedMemberIds.length === 0) {
      throw new Error("Select at least one member for a selected-members fee.");
    }
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { error } = await runtimeDb.from("fee_policies").upsert({
      key: data.key,
      label: data.label,
      amount: data.amount,
      permanence: data.permanence,
      duration_days: data.permanence === "semi" ? (data.durationDays ?? null) : null,
      effective_from: data.effectiveFrom,
      scope: data.scope,
      selected_member_ids: data.scope === "selected_members" ? data.selectedMemberIds : [],
      custom: data.custom,
      notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "fee_policy.upserted",
      targetType: "fee_policy",
      targetId: data.key,
      summary: `${actor.name} saved fee policy ${data.key}`,
      details: {
        label: data.label,
        amount: data.amount,
        permanence: data.permanence,
        durationDays: data.durationDays ?? null,
        effectiveFrom: data.effectiveFrom,
        scope: data.scope,
        selectedMemberIds: data.scope === "selected_members" ? data.selectedMemberIds : [],
        custom: data.custom,
      },
    });
    return { ok: true };
  });

export const deleteFeePolicyRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { key: string }) => ({ key: String(data?.key ?? "").trim() }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.key) throw new Error("Fee key is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: feePolicy } = await runtimeDb
      .from("fee_policies")
      .select("label, amount, permanence, scope")
      .eq("key", data.key)
      .maybeSingle();
    const { error } = await runtimeDb.from("fee_policies").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "fee_policy.deleted",
      targetType: "fee_policy",
      targetId: data.key,
      summary: `${actor.name} deleted fee policy ${data.key}`,
      details: {
        label: feePolicy?.label ?? null,
        amount: feePolicy?.amount ?? null,
        permanence: feePolicy?.permanence ?? null,
        scope: feePolicy?.scope ?? null,
      },
    });
    return { ok: true };
  });

export const upsertPolicySettingRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { key: PolicySettingKey; value: unknown; notes?: string }) => ({
    key: (data?.key ?? "percentages") as PolicySettingKey,
    value: data?.value ?? {},
    notes: data?.notes?.trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!(data.key in POLICY_SETTING_LABELS)) {
      throw new Error("Unknown policy setting key.");
    }
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const nextRows = policySettingsRowsFromConfig(
      mergePolicySettings([
        {
          key: data.key,
          label: POLICY_SETTING_LABELS[data.key],
          value: data.value,
          notes: data.notes,
        },
      ]),
    );
    const record = nextRows.find((row) => row.key === data.key);
    if (!record) throw new Error("Failed to prepare the policy setting.");

    const { error } = await runtimeDb.from("policy_settings").upsert({
      key: data.key,
      label: POLICY_SETTING_LABELS[data.key],
      value: record.value,
      notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "policy_setting.upserted",
      targetType: "policy_setting",
      targetId: data.key,
      summary: `${actor.name} updated policy setting ${data.key}`,
      details: {
        key: data.key,
        notes: data.notes ?? null,
        value: record.value,
      },
    });
    return { ok: true };
  });

export const upsertPerformanceTargetRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id?: string;
      metric: string;
      period: string;
      expectedValue: number;
      startOn: string;
      notes?: string;
    }) => ({
      id: String(data?.id ?? "").trim() || undefined,
      metric: String(data?.metric ?? "").trim(),
      period: String(data?.period ?? "").trim(),
      expectedValue: Number(data?.expectedValue ?? 0),
      startOn: String(data?.startOn ?? "").trim() || new Date().toISOString().slice(0, 10),
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    const validMetrics = new Set([
      "collections_total",
      "loan_repayments",
      "loan_disbursements",
      "new_loans_count",
      "registrations",
      "cards_paid",
      "stickers_paid",
      "stickers_issued",
    ]);
    const validPeriods = new Set(["daily", "weekly", "monthly", "annual"]);
    if (!validMetrics.has(data.metric)) throw new Error("Unknown target metric.");
    if (!validPeriods.has(data.period)) throw new Error("Unknown target period.");
    if (data.expectedValue < 0) throw new Error("Expected value cannot be negative.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = data.id ?? makeId("TGT");
    const { error } = await runtimeDb.from("performance_targets").upsert({
      id,
      metric: data.metric,
      period: data.period,
      expected_value: data.expectedValue,
      start_on: data.startOn,
      notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "performance_target.upserted",
      targetType: "performance_target",
      targetId: id,
      summary: `${actor.name} saved a ${data.period} ${data.metric} target`,
      details: {
        metric: data.metric,
        period: data.period,
        expectedValue: data.expectedValue,
        startOn: data.startOn,
        notes: data.notes ?? null,
      },
    });
    return { id };
  });

export const deletePerformanceTargetRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.id) throw new Error("Target id is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: target } = await runtimeDb
      .from("performance_targets")
      .select("metric, period, expected_value, start_on")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await runtimeDb.from("performance_targets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "performance_target.deleted",
      targetType: "performance_target",
      targetId: data.id,
      summary: `${actor.name} deleted target ${data.id}`,
      details: {
        metric: target?.metric ?? null,
        period: target?.period ?? null,
        expectedValue: target?.expected_value ?? null,
        startOn: target?.start_on ?? null,
      },
    });
    return { ok: true };
  });

export const upsertMemberCarryoverProfileRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId: string;
      savingsBalance: number;
      shareUnits: number;
      feesPaidTotal: number;
      loanRepaymentsTotal: number;
      investmentBalance: number;
      otherCollectedTotal: number;
      totalCollected: number;
      pendingBalance: number;
      penaltiesOutstanding: number;
      penaltiesWaivedTotal: number;
      membershipFeePaid: boolean;
      cardFeePaid: boolean;
      stickerFeePaid: boolean;
      firstUpfrontPaid: boolean;
      completedLoanCycles: number;
      firstLoanStartDate?: string;
      lastLoanEndDate?: string;
      collectionBreakdown?: Record<string, unknown>;
      notes?: string;
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      savingsBalance: Math.max(0, Number(data?.savingsBalance ?? 0)),
      shareUnits: Math.max(0, Math.floor(Number(data?.shareUnits ?? 0))),
      feesPaidTotal: Math.max(0, Number(data?.feesPaidTotal ?? 0)),
      loanRepaymentsTotal: Math.max(0, Number(data?.loanRepaymentsTotal ?? 0)),
      investmentBalance: Math.max(0, Number(data?.investmentBalance ?? 0)),
      otherCollectedTotal: Math.max(0, Number(data?.otherCollectedTotal ?? 0)),
      totalCollected: Math.max(0, Number(data?.totalCollected ?? 0)),
      pendingBalance: Math.max(0, Number(data?.pendingBalance ?? 0)),
      penaltiesOutstanding: Math.max(0, Number(data?.penaltiesOutstanding ?? 0)),
      penaltiesWaivedTotal: Math.max(0, Number(data?.penaltiesWaivedTotal ?? 0)),
      membershipFeePaid: !!data?.membershipFeePaid,
      cardFeePaid: !!data?.cardFeePaid,
      stickerFeePaid: !!data?.stickerFeePaid,
      firstUpfrontPaid: !!data?.firstUpfrontPaid,
      completedLoanCycles: Math.max(0, Math.floor(Number(data?.completedLoanCycles ?? 0))),
      firstLoanStartDate: data?.firstLoanStartDate?.trim() || undefined,
      lastLoanEndDate: data?.lastLoanEndDate?.trim() || undefined,
      collectionBreakdown: asJsonObject(data?.collectionBreakdown),
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.memberId) throw new Error("Member id is required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const derivedTotal =
      data.feesPaidTotal +
      data.loanRepaymentsTotal +
      data.investmentBalance +
      data.otherCollectedTotal;

    const { error } = await runtimeDb.from("member_carryover_profiles").upsert({
      member_id: data.memberId,
      savings_balance: data.savingsBalance,
      share_units: data.shareUnits,
      fees_paid_total: data.feesPaidTotal,
      loan_repayments_total: data.loanRepaymentsTotal,
      investment_balance: data.investmentBalance,
      other_collected_total: data.otherCollectedTotal,
      total_collected: derivedTotal,
      pending_balance: Math.max(0, Number(data.pendingBalance ?? 0)),
      penalties_outstanding: data.penaltiesOutstanding,
      penalties_waived_total: data.penaltiesWaivedTotal,
      membership_fee_paid: data.membershipFeePaid,
      card_fee_paid: data.cardFeePaid,
      sticker_fee_paid: data.stickerFeePaid,
      first_upfront_paid: data.firstUpfrontPaid,
      completed_loan_cycles: Math.max(0, Math.floor(Number(data.completedLoanCycles ?? 0))),
      first_loan_start_date: data.firstLoanStartDate ?? null,
      last_loan_end_date: data.lastLoanEndDate ?? null,
      collection_breakdown: data.collectionBreakdown,
      notes: data.notes ?? null,
      created_by: actor.id,
      updated_by: actor.id,
    });
    if (error) throw new Error(error.message);

    const { error: memberError } = await runtimeDb
      .from("members")
      .update({
        savings_balance: data.savingsBalance,
        shares: data.shareUnits,
        fee_membership: data.membershipFeePaid,
        fee_card: data.cardFeePaid,
        fee_sticker: data.stickerFeePaid,
        fee_first_upfront_paid: data.firstUpfrontPaid,
      })
      .eq("id", data.memberId);
    if (memberError) throw new Error(memberError.message);

    await refreshCarryoverMemberSummary(runtimeDb, data.memberId);

    await auditAction({
      actor,
      action: "member_carryover_profile.upserted",
      targetType: "member_carryover_profile",
      targetId: data.memberId,
      summary: `${actor.name} updated carryover balances for ${data.memberId}`,
      details: {
        savingsBalance: data.savingsBalance,
        shareUnits: data.shareUnits,
        totalCollected: derivedTotal,
        penaltiesOutstanding: data.penaltiesOutstanding,
        completedLoanCycles: data.completedLoanCycles,
      },
    });
    return { ok: true };
  });

export const upsertMemberCarryoverLoanRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id?: string;
      memberId: string;
      label: string;
      loanCycleNumber: number;
      principal: number;
      interestRatePct: number;
      termDays: number;
      dailySavingsAmount: number;
      startDate: string;
      dueDate?: string;
      closedOn?: string;
      paidToDate: number;
      status: "active" | "closed" | "defaulted";
      finished: boolean;
      penaltyWaivedAmount: number;
      notes?: string;
    }) => ({
      id: String(data?.id ?? "").trim() || undefined,
      memberId: String(data?.memberId ?? "").trim(),
      label: String(data?.label ?? "").trim() || "Legacy loan",
      loanCycleNumber: Math.max(1, Math.floor(Number(data?.loanCycleNumber ?? 1))),
      principal: Math.max(0, Number(data?.principal ?? 0)),
      interestRatePct: Math.max(0, Number(data?.interestRatePct ?? 0)),
      termDays: Number(data?.termDays ?? 30),
      dailySavingsAmount: Math.max(0, Number(data?.dailySavingsAmount ?? 0)),
      startDate: String(data?.startDate ?? "").trim() || new Date().toISOString().slice(0, 10),
      dueDate: data?.dueDate?.trim() || undefined,
      closedOn: data?.closedOn?.trim() || undefined,
      paidToDate: Math.max(0, Number(data?.paidToDate ?? 0)),
      status: data?.status ?? "active",
      finished: !!data?.finished,
      penaltyWaivedAmount: Math.max(0, Number(data?.penaltyWaivedAmount ?? 0)),
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.memberId) throw new Error("Member id is required.");
    if (data.principal <= 0) throw new Error("Loan principal must be above zero.");
    if (![7, 14, 30, 60, 90].includes(data.termDays)) {
      throw new Error("Carryover loans must use 7, 14, 30, 60, or 90 days.");
    }

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const policySettings = await loadRuntimePolicySettings(runtimeDb);
    const id = data.id ?? makeId("LLN");
    const dueDate = data.dueDate ?? addDaysIso(data.startDate, data.termDays);
    const computedSummary = summarizeLegacyCarryoverLoan(
      {
        principal: data.principal,
        interestRatePct: data.interestRatePct,
        termDays: data.termDays as 7 | 14 | 30 | 60 | 90,
        dailySavingsAmount: data.dailySavingsAmount,
        startDate: data.startDate,
        dueDate,
        paidToDate: data.paidToDate,
        status: data.status,
        finished: data.finished,
        penaltyWaivedAmount: data.penaltyWaivedAmount,
      },
      policySettings,
    );
    const status =
      data.finished || computedSummary.balance <= 0
        ? "closed"
        : data.status === "closed"
          ? "closed"
          : data.status;
    const { error } = await runtimeDb.from("member_carryover_loans").upsert({
      id,
      member_id: data.memberId,
      label: data.label,
      loan_cycle_number: data.loanCycleNumber,
      principal: data.principal,
      interest_rate_pct: data.interestRatePct,
      term_days: data.termDays,
      daily_savings_amount: data.dailySavingsAmount,
      start_date: data.startDate,
      due_date: dueDate,
      closed_on: data.closedOn ?? (status === "closed" ? dueDate : null),
      paid_to_date: data.paidToDate,
      status,
      finished: data.finished || status === "closed" || computedSummary.balance <= 0,
      penalty_waived_amount: data.penaltyWaivedAmount,
      notes: data.notes ?? null,
      created_by: actor.id,
      updated_by: actor.id,
    });
    if (error) throw new Error(error.message);

    await refreshCarryoverMemberSummary(runtimeDb, data.memberId);
    await auditAction({
      actor,
      action: "member_carryover_loan.upserted",
      targetType: "member_carryover_loan",
      targetId: id,
      summary: `${actor.name} saved legacy loan ${id} for ${data.memberId}`,
      details: {
        label: data.label,
        principal: data.principal,
        termDays: data.termDays,
        paidToDate: data.paidToDate,
        status,
      },
    });
    return { id };
  });

export const deleteMemberCarryoverLoanRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.id) throw new Error("Carryover loan id is required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: loan, error: loanError } = await runtimeDb
      .from("member_carryover_loans")
      .select("member_id, label")
      .eq("id", data.id)
      .maybeSingle();
    if (loanError) throw new Error(loanError.message);
    if (!loan) throw new Error("Carryover loan not found.");

    const { error } = await runtimeDb.from("member_carryover_loans").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await refreshCarryoverMemberSummary(runtimeDb, loan.member_id);
    await auditAction({
      actor,
      action: "member_carryover_loan.deleted",
      targetType: "member_carryover_loan",
      targetId: data.id,
      summary: `${actor.name} deleted legacy loan ${data.id}`,
      details: {
        memberId: loan.member_id,
        label: loan.label ?? null,
      },
    });
    return { ok: true };
  });

export const waivePenaltyRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { penaltyId: string; note?: string; amount?: number }) => ({
    penaltyId: String(data?.penaltyId ?? "").trim(),
    note: data?.note?.trim() || undefined,
    amount: data?.amount == null ? undefined : Number(data.amount),
  }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.penaltyId) throw new Error("Penalty id is required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: penalty, error: penaltyError } = await runtimeDb
      .from("penalties")
      .select("*")
      .eq("id", data.penaltyId)
      .maybeSingle();
    if (penaltyError) throw new Error(penaltyError.message);
    if (!penalty) throw new Error("Penalty not found.");
    if (penalty.status !== "outstanding") {
      throw new Error("Only outstanding penalties can be waived.");
    }

    const currentAmount = Number(penalty.amount ?? 0);
    const waiveAmount =
      data.amount == null
        ? currentAmount
        : Math.max(0, Math.min(currentAmount, Number(data.amount)));
    if (waiveAmount <= 0) throw new Error("Waiver amount must be above zero.");

    if (waiveAmount < currentAmount) {
      const waivedId = makeId("PWV");
      const { error: waivedInsertError } = await runtimeDb.from("penalties").insert({
        id: waivedId,
        member_id: penalty.member_id,
        loan_id: penalty.loan_id ?? null,
        date: new Date().toISOString().slice(0, 10),
        amount: waiveAmount,
        reason: `Waived from ${penalty.id}${data.note ? ` - ${data.note}` : ""}`,
        status: "waived",
        paid_from: "waiver",
      });
      if (waivedInsertError) throw new Error(waivedInsertError.message);

      const { error: penaltyUpdateError } = await runtimeDb
        .from("penalties")
        .update({ amount: currentAmount - waiveAmount })
        .eq("id", penalty.id);
      if (penaltyUpdateError) throw new Error(penaltyUpdateError.message);
    } else {
      const { error: penaltyUpdateError } = await runtimeDb
        .from("penalties")
        .update({ status: "waived", paid_from: "waiver" })
        .eq("id", penalty.id);
      if (penaltyUpdateError) throw new Error(penaltyUpdateError.message);
    }

    await auditAction({
      actor,
      action: "penalty.waived",
      targetType: "penalty",
      targetId: data.penaltyId,
      summary: `${actor.name} waived ${waiveAmount}/= from penalty ${data.penaltyId}`,
      details: {
        memberId: penalty.member_id,
        loanId: penalty.loan_id ?? null,
        originalAmount: currentAmount,
        waiveAmount,
        note: clipAuditText(data.note, 180),
      },
    });
    return { ok: true, waivedAmount: waiveAmount };
  });

export const createReportSnapshotRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      reportKey?: string;
      title: string;
      periodStart: string;
      periodEnd: string;
      filters?: Record<string, unknown>;
      summary?: Record<string, unknown>;
      chartData?: Record<string, unknown>;
    }) => ({
      reportKey: String(data?.reportKey ?? "").trim() || "reports",
      title: String(data?.title ?? "").trim() || "Report snapshot",
      periodStart: String(data?.periodStart ?? "").trim() || new Date().toISOString().slice(0, 10),
      periodEnd: String(data?.periodEnd ?? "").trim() || new Date().toISOString().slice(0, 10),
      filters: asJsonObject(data?.filters),
      summary: asJsonObject(data?.summary),
      chartData: asJsonObject(data?.chartData),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireManagerOrDirectorActor();
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = makeId("RPT");
    const { error } = await runtimeDb.from("report_snapshots").insert({
      id,
      report_key: data.reportKey,
      title: data.title,
      period_start: data.periodStart,
      period_end: data.periodEnd,
      filters: data.filters,
      summary: data.summary,
      chart_data: data.chartData,
      generated_by: actor.id,
    });
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: "report_snapshot.created",
      targetType: "report_snapshot",
      targetId: id,
      summary: `${actor.name} archived report snapshot ${data.title}`,
      details: {
        reportKey: data.reportKey,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
      },
    });
    return { id };
  });

export const createSupportThreadRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId: string;
      memberName: string;
      subject: string;
      assignedStaffId?: string;
      initialMessages: Array<{
        from: "member" | "ai" | "staff";
        fromName: string;
        fromId?: string;
        text: string;
      }>;
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      memberName: String(data?.memberName ?? "").trim(),
      subject: String(data?.subject ?? "").trim(),
      assignedStaffId: data?.assignedStaffId?.trim() || undefined,
      initialMessages: Array.isArray(data?.initialMessages) ? data.initialMessages : [],
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    if (!data.memberId || !data.memberName || !data.subject) {
      throw new Error("Support thread details are incomplete.");
    }

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    let memberId = data.memberId;
    let memberName = data.memberName;
    let initialMessages = data.initialMessages;
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      memberId = member.id;
      memberName = member.name;
      initialMessages = data.initialMessages.map((message) =>
        message.from === "member"
          ? {
              ...message,
              from: "member" as const,
              fromName: member.name,
              fromId: member.id,
            }
          : {
              ...message,
              from: "ai" as const,
              fromName: "SautiAI",
              fromId: undefined,
            },
      );
    } else {
      await requireStaffActor();
    }
    const id = makeId("SUP");
    const { error: threadError } = await runtimeDb.from("support_threads").insert({
      id,
      member_id: memberId,
      member_name: memberName,
      assigned_staff_id: data.assignedStaffId ?? null,
      status: data.assignedStaffId ? "open" : "ai",
      subject: data.subject,
    });
    if (threadError) throw new Error(threadError.message);

    if (initialMessages.length > 0) {
      const rows = initialMessages.map((message, index) => ({
        id: `${id}-MSG-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
        thread_id: id,
        sender_kind: message.from,
        sender_name: message.fromName,
        sender_id: message.fromId ?? null,
        text: message.text,
      }));
      const { error: messagesError } = await runtimeDb.from("support_messages").insert(rows);
      if (messagesError) throw new Error(messagesError.message);
    }

    if (session.authMode === "member") {
      const member = await requireMemberActor();
      await recordAudit({
        actor_id: member.id,
        actor_name: member.name,
        actor_role: "member",
        action: "support_thread.created",
        target_type: "support_thread",
        target_id: id,
        summary: `${member.name} created support thread ${data.subject}`,
        details: {
          subject: clipAuditText(data.subject, 120),
          initialMessageCount: initialMessages.length,
          assignedStaffId: data.assignedStaffId ?? null,
        },
      });
    } else {
      const actor = await requireStaffActor();
      await auditAction({
        actor,
        action: "support_thread.created",
        targetType: "support_thread",
        targetId: id,
        summary: `${actor.name} created support thread ${data.subject}`,
        details: {
          memberId,
          subject: clipAuditText(data.subject, 120),
          initialMessageCount: initialMessages.length,
          assignedStaffId: data.assignedStaffId ?? null,
        },
      });
    }
    return { id };
  });

export const appendSupportMessageRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      threadId: string;
      from: "member" | "ai" | "staff";
      fromName: string;
      fromId?: string;
      text: string;
    }) => ({
      threadId: String(data?.threadId ?? "").trim(),
      from: data?.from ?? "member",
      fromName: String(data?.fromName ?? "").trim(),
      fromId: data?.fromId?.trim() || undefined,
      text: String(data?.text ?? "").trim(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    if (!data.threadId || !data.fromName || !data.text)
      throw new Error("Support message is incomplete.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    let senderKind: "member" | "staff";
    let senderName: string;
    let senderId: string;
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      const { data: thread, error: threadError } = await runtimeDb
        .from("support_threads")
        .select("member_id")
        .eq("id", data.threadId)
        .maybeSingle();
      if (threadError) throw new Error(threadError.message);
      if (!thread || thread.member_id !== member.id) {
        throw new Error("You cannot reply to that support thread.");
      }
      senderKind = "member";
      senderName = member.name;
      senderId = member.id;
    } else {
      const actor = await requireStaffActor();
      senderKind = "staff";
      senderName = actor.name;
      senderId = actor.id;
    }
    const id = makeId("SUM");
    const { error } = await runtimeDb.from("support_messages").insert({
      id,
      thread_id: data.threadId,
      sender_kind: senderKind,
      sender_name: senderName,
      sender_id: senderId,
      text: data.text,
    });
    if (error) throw new Error(error.message);
    const { error: threadUpdateError } = await runtimeDb
      .from("support_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.threadId);
    if (threadUpdateError) throw new Error(threadUpdateError.message);
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      await recordAudit({
        actor_id: member.id,
        actor_name: member.name,
        actor_role: "member",
        action: "support_message.appended",
        target_type: "support_thread",
        target_id: data.threadId,
        summary: `${member.name} replied in support thread ${data.threadId}`,
        details: {
          textPreview: clipAuditText(data.text, 180),
        },
      });
    } else {
      const actor = await requireStaffActor();
      await auditAction({
        actor,
        action: "support_message.appended",
        targetType: "support_thread",
        targetId: data.threadId,
        summary: `${actor.name} replied in support thread ${data.threadId}`,
        details: {
          textPreview: clipAuditText(data.text, 180),
        },
      });
    }
    return { id };
  });

export const updateSupportThreadRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id: string;
      status: "ai" | "open" | "claimed" | "closed";
      assignedStaffId?: string;
    }) => ({
      id: String(data?.id ?? "").trim(),
      status: data?.status ?? "open",
      assignedStaffId: data?.assignedStaffId?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.id) throw new Error("Support thread id is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { error } = await runtimeDb
      .from("support_threads")
      .update({
        status: data.status,
        assigned_staff_id: data.assignedStaffId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await auditAction({
      actor,
      action: "support_thread.updated",
      targetType: "support_thread",
      targetId: data.id,
      summary: `${actor.name} updated support thread ${data.id}`,
      details: {
        status: data.status,
        assignedStaffId: data.assignedStaffId ?? null,
      },
    });
    return { ok: true };
  });
