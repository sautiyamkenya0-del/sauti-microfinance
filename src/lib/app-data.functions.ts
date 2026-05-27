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
  normalizeMemberTags,
  normalizeMembershipNumber,
  resolveMemberCategory,
  type MemberCategory,
} from "@/lib/membership";
import {
  DEFAULT_POLICY_SETTINGS,
  POLICY_SETTING_LABELS,
  clonePolicySettings,
  mergePolicySettings,
  normalizePolicyTermDays,
  policySettingsRowsFromConfig,
  transactionFeeForAmount,
  waterfallRuleForScenario,
  type PolicySettingKey,
  type PolicySettingRow,
} from "@/lib/policy-settings";
import {
  normalizeLegacyCarryoverLoanFeeBreakdown,
  summarizeLegacyCarryoverLoan,
} from "@/lib/legacy-finance";
import { requestMpesaWithdrawalPayout } from "@/lib/mpesa-payouts.server";
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

type CarryoverLiveState = {
  savingsBalance: number;
  shareUnits: number;
  membershipFeePaid: boolean;
  cardFeePaid: boolean;
  stickerFeePaid: boolean;
  firstUpfrontPaid: boolean;
  source: "snapshot" | "ledger" | "member";
};

function readBooleanValue(value: unknown) {
  return (
    value === true ||
    String(value ?? "")
      .trim()
      .toLowerCase() === "true"
  );
}

function liveStateFromMemberRow(member: Record<string, unknown>): CarryoverLiveState {
  return {
    savingsBalance: Number(member.savings_balance ?? 0),
    shareUnits: Math.max(0, Math.floor(Number(member.shares ?? 0))),
    membershipFeePaid: readBooleanValue(member.fee_membership),
    cardFeePaid: readBooleanValue(member.fee_card),
    stickerFeePaid: readBooleanValue(member.fee_sticker),
    firstUpfrontPaid: readBooleanValue(member.fee_first_upfront_paid),
    source: "member",
  };
}

function readPreCarryoverLiveState(value: unknown): CarryoverLiveState | null {
  const breakdown = asJsonObject(value);
  const snapshot = asJsonObject(breakdown.preCarryoverLiveState);
  if (Object.keys(snapshot).length === 0) return null;

  return {
    savingsBalance: Number(snapshot.savingsBalance ?? snapshot.savings_balance ?? 0),
    shareUnits: Math.max(
      0,
      Math.floor(Number(snapshot.shareUnits ?? snapshot.share_units ?? snapshot.shares ?? 0)),
    ),
    membershipFeePaid: readBooleanValue(
      snapshot.membershipFeePaid ?? snapshot.membership_fee_paid ?? snapshot.fee_membership,
    ),
    cardFeePaid: readBooleanValue(
      snapshot.cardFeePaid ?? snapshot.card_fee_paid ?? snapshot.fee_card,
    ),
    stickerFeePaid: readBooleanValue(
      snapshot.stickerFeePaid ?? snapshot.sticker_fee_paid ?? snapshot.fee_sticker,
    ),
    firstUpfrontPaid: readBooleanValue(
      snapshot.firstUpfrontPaid ?? snapshot.first_upfront_paid ?? snapshot.fee_first_upfront_paid,
    ),
    source: "snapshot",
  };
}

function serializableCarryoverLiveState(state: CarryoverLiveState) {
  return {
    savingsBalance: state.savingsBalance,
    shareUnits: state.shareUnits,
    membershipFeePaid: state.membershipFeePaid,
    cardFeePaid: state.cardFeePaid,
    stickerFeePaid: state.stickerFeePaid,
    firstUpfrontPaid: state.firstUpfrontPaid,
  };
}

async function rebuildMemberLiveStateFromTransactionLedger(
  runtimeDb: any,
  memberId: string,
): Promise<CarryoverLiveState> {
  const rows = await fetchAllRows<Record<string, unknown>>(() =>
    runtimeDb.from("transactions").select("type, amount, note").eq("member_id", memberId),
  );

  let savingsBalance = 0;
  let shareAmount = 0;
  let membershipFeePaid = false;
  let cardFeePaid = false;
  let stickerFeePaid = false;
  let firstUpfrontPaid = false;

  for (const row of rows) {
    const type = String(row.type ?? "");
    const amount = Number(row.amount ?? 0);
    const note = String(row.note ?? "")
      .trim()
      .toLowerCase();

    if (type === "deposit") savingsBalance += amount;
    if (type === "withdrawal") savingsBalance -= amount;
    if (type === "share_purchase") shareAmount += amount;

    if (type === "fee_payment") {
      if (note.includes("membership fee") || note.includes("registration fee")) {
        membershipFeePaid = true;
      }
      if (note.includes("membership card") || /\bcard\b/.test(note)) {
        cardFeePaid = true;
      }
      if (note.includes("sticker")) {
        stickerFeePaid = true;
      }
      if (note.includes("upfront")) {
        firstUpfrontPaid = true;
      }
    }

    if (type === "loan_repayment") {
      firstUpfrontPaid = true;
    }
  }

  return {
    savingsBalance,
    shareUnits: Math.max(0, Math.floor(shareAmount / SHARE_PRICE)),
    membershipFeePaid,
    cardFeePaid,
    stickerFeePaid,
    firstUpfrontPaid,
    source: "ledger",
  };
}

function makeId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows<T = any>(queryFactory: () => any): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await queryFactory().range(from, to);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

function isMissingColumnError(error: any, column: string) {
  const message = String(error?.message ?? "");
  return error?.code === "42703" || message.includes(column);
}

function isMissingRelationError(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || message.includes("does not exist");
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
  void recordAudit({
    actor_id: args.actor.id,
    actor_name: args.actor.name,
    actor_role: args.actor.role ?? null,
    action: args.action,
    target_type: args.targetType,
    target_id: args.targetId ?? null,
    summary: args.summary,
    details: args.details,
  }).catch((error) => {
    console.error("Failed to record audit entry", error);
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

const SHARE_PRICE = 100;
const ROUNDING_BASE = DEFAULT_POLICY_SETTINGS.percentages.roundOffStep;
const MANDATORY_SAVINGS_THRESHOLD = DEFAULT_POLICY_SETTINGS.percentages.mandatorySavingsThreshold;
const MANDATORY_SHARES_THRESHOLD = DEFAULT_POLICY_SETTINGS.percentages.mandatorySharesThreshold;
const COMPLIANCE_SAVINGS_PCT = 0.6;
const COMPLIANCE_SHARES_PCT = 0.4;
const POST_COMPLIANCE_LOAN_SAVINGS_PCT = 0.2;
const PURPOSE_POOL_TRANSFERABLE_SOURCE_PCT = 0.75;
const SPECIAL_MEMBER_TRANSACTION_INTEREST = 100;
const SPECIAL_MEMBER_BUFFER_PER_PAYMENT = 100;
const SPECIAL_MEMBER_BUFFER_TARGET = 3000;
const MAX_FIELD_VISIT_PHOTOS = 6;
const MAX_FIELD_VISIT_TOTAL_BYTES = 8 * 1024 * 1024;

const PREMIUM_UPFRONT_TABLE = [
  { min: 5000, max: 10000, minShares: 900, minSavings: 1000 },
  { min: 10001, max: 20000, minShares: 1500, minSavings: 2500 },
  { min: 20001, max: 30000, minShares: 2100, minSavings: 3500 },
  { min: 30001, max: 40000, minShares: 3000, minSavings: 4000 },
  { min: 40001, max: 50000, minShares: 3000, minSavings: 5000 },
];

function roundUpKES(amount: number, step: number = ROUNDING_BASE) {
  if (amount <= 0) return 0;
  return Math.ceil(amount / step) * step;
}

function roundMoney(amount: number) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

function mandatorySavingsThresholdForSettings(settings: typeof DEFAULT_POLICY_SETTINGS) {
  return Math.max(
    0,
    Number(settings.percentages.mandatorySavingsThreshold || MANDATORY_SAVINGS_THRESHOLD),
  );
}

function mandatorySharesThresholdForSettings(settings: typeof DEFAULT_POLICY_SETTINGS) {
  return Math.max(
    0,
    Number(settings.percentages.mandatorySharesThreshold || MANDATORY_SHARES_THRESHOLD),
  );
}

function shareBasketValue(shares: unknown, reserve: unknown = 0) {
  return roundMoney(
    Math.max(0, Math.floor(Number(shares ?? 0))) * SHARE_PRICE +
      Math.max(0, Number(reserve ?? 0)),
  );
}

function normalizeShareBasketForThreshold(args: {
  shares: unknown;
  shareReserveBalance?: unknown;
  settings: typeof DEFAULT_POLICY_SETTINGS;
}) {
  const threshold = mandatorySharesThresholdForSettings(args.settings);
  const originalValue = shareBasketValue(args.shares, args.shareReserveBalance);
  const cappedValue = Math.min(originalValue, threshold);
  const shares = Math.floor(cappedValue / SHARE_PRICE);
  const shareReserveBalance = roundMoney(cappedValue - shares * SHARE_PRICE);
  const overflow = roundMoney(Math.max(0, originalValue - cappedValue));

  return {
    shares,
    shareReserveBalance,
    originalValue,
    cappedValue,
    overflow,
    threshold,
    changed:
      shares !== Math.max(0, Math.floor(Number(args.shares ?? 0))) ||
      shareReserveBalance !== roundMoney(Math.max(0, Number(args.shareReserveBalance ?? 0))),
  };
}

function assertMandatorySavingsWithinThreshold(args: {
  amount: unknown;
  settings: typeof DEFAULT_POLICY_SETTINGS;
}) {
  const amount = roundMoney(Math.max(0, Number(args.amount ?? 0)));
  const threshold = mandatorySavingsThresholdForSettings(args.settings);
  if (amount > threshold) {
    throw new Error(
      `Daily compliance contribution cannot exceed the mandatory threshold of ${threshold}/=. Route extra money to loan savings or purpose pool.`,
    );
  }
}

function assertShareBasketWithinThreshold(args: {
  shares: unknown;
  shareReserveBalance?: unknown;
  settings: typeof DEFAULT_POLICY_SETTINGS;
}) {
  const normalized = normalizeShareBasketForThreshold(args);
  if (normalized.overflow > 0) {
    throw new Error(
      `Shares cannot exceed the mandatory threshold of ${normalized.threshold}/=. Route extra money to purpose pool or loan savings.`,
    );
  }
}

function premiumUpfrontRequirementForAmount(amount: number) {
  const normalized = Math.max(0, Number(amount ?? 0));
  if (normalized <= 5000) return { minShares: 0, minSavings: 0, total: 0 };
  const tier =
    PREMIUM_UPFRONT_TABLE.find((row) => normalized >= row.min && normalized <= row.max) ??
    PREMIUM_UPFRONT_TABLE[PREMIUM_UPFRONT_TABLE.length - 1];
  return {
    minShares: tier?.minShares ?? 0,
    minSavings: tier?.minSavings ?? 0,
    total: (tier?.minShares ?? 0) + (tier?.minSavings ?? 0),
  };
}

function normalizeLoanTermDays(termDays?: number) {
  return normalizePolicyTermDays(termDays);
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

function transactionFeeAmountForLoanWithSettings(
  amount: number,
  settings: typeof DEFAULT_POLICY_SETTINGS,
) {
  const fixedFee = transactionFeeForAmount(amount, settings);
  if (fixedFee > 0) return fixedFee;
  return amount * (settings.percentages.transactionCostPct / 100);
}

function computeLoanPricing(args: {
  netAmount: number;
  ratePct: number;
  termDays?: number;
  termMonths?: number;
  processingFeeMode?: string | null;
  insuranceFeeMode?: string | null;
  loanKind?: string | null;
  settings?: typeof DEFAULT_POLICY_SETTINGS;
}) {
  const settings = args.settings ?? DEFAULT_POLICY_SETTINGS;
  const netAmount = Math.max(0, Number(args.netAmount ?? 0));
  const termDays = normalizeLoanTermDays(args.termDays ?? Number(args.termMonths ?? 1) * 30);
  const termMonths =
    Number(args.termMonths ?? 0) > 0 ? Number(args.termMonths ?? 0) : termPeriodsFromDays(termDays);
  const supplierBacked =
    args.loanKind === "fuel" || args.loanKind === "stock" || args.loanKind === "service";
  const processing = supplierBacked ? 0 : netAmount * (settings.percentages.processingPct / 100);
  const insurance = supplierBacked ? 0 : netAmount * (settings.percentages.insurancePct / 100);
  const transactionFee = supplierBacked
    ? 0
    : transactionFeeAmountForLoanWithSettings(netAmount, settings);
  const processingMode = args.processingFeeMode === "upfront" ? "upfront" : "financed";
  const insuranceMode = args.insuranceFeeMode === "upfront" ? "upfront" : "financed";
  const processingUpfront = processingMode === "upfront" ? processing : 0;
  const insuranceUpfront = insuranceMode === "upfront" ? insurance : 0;
  const financedPrincipal =
    netAmount + (processing - processingUpfront) + (insurance - insuranceUpfront) + transactionFee;
  const ratePct = supplierBacked ? 0 : Number(args.ratePct ?? 0);
  const schedule = loanScheduleTotal(financedPrincipal, ratePct, termMonths);
  return {
    termDays,
    termMonths,
    processing,
    insurance,
    transactionFee,
    processingMode,
    insuranceMode,
    processingUpfront,
    insuranceUpfront,
    financedPrincipal,
    interest: schedule.interest,
    totalRepayment: schedule.total,
    netDisbursedAmount: netAmount,
  };
}

function loanBalanceSummary(loan: {
  principal: number | string | null;
  approved_amount?: number | string | null;
  financed_principal_amount?: number | string | null;
  rate?: number | string | null;
  term_days?: number | null;
  term_months?: number | null;
  paid?: number | string | null;
}) {
  const approved = Number(loan.approved_amount ?? loan.principal ?? 0);
  const financedPrincipal = Number(loan.financed_principal_amount ?? approved);
  const termDays = normalizeLoanTermDays(loan.term_days ?? Number(loan.term_months ?? 1) * 30);
  const periods =
    Number(loan.term_months ?? 0) > 0
      ? Number(loan.term_months ?? 0)
      : termPeriodsFromDays(termDays);
  const total = loanScheduleTotal(financedPrincipal, Number(loan.rate ?? 0), periods).total;
  const paid = Number(loan.paid ?? 0);
  return {
    approved,
    financedPrincipal,
    termDays,
    total,
    paid,
    balance: Math.max(0, total - paid),
  };
}

function normalizeLoanKindValue(value?: string | null) {
  return value === "fuel" || value === "stock" || value === "service" ? value : "financial";
}

function openLoanDateValue(loan: {
  start_date?: string | null;
  created_at?: string | null;
  id?: string | null;
}) {
  return String(loan.start_date ?? loan.created_at ?? loan.id ?? "");
}

function sortOpenLoansByDispatchDate<
  T extends { start_date?: string | null; created_at?: string | null; id?: string | null },
>(loans: T[]) {
  return [...loans].sort((left, right) => {
    const byDate = openLoanDateValue(left).localeCompare(openLoanDateValue(right));
    if (byDate !== 0) return byDate;
    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });
}

function carryoverLoanBalanceSummary(
  loan: Record<string, unknown>,
  settings: typeof DEFAULT_POLICY_SETTINGS,
) {
  const summary = summarizeLegacyCarryoverLoan(
    {
      principal: toNumber(loan.principal as number | string | null | undefined),
      interestRatePct: toNumber(loan.interest_rate_pct as number | string | null | undefined),
      termDays: normalizeLoanTermDays(Number(loan.term_days ?? 30)),
      dailySavingsAmount: toNumber(loan.daily_savings_amount as number | string | null | undefined),
      startDate: String(loan.start_date ?? new Date().toISOString().slice(0, 10)),
      dueDate: loan.due_date ? String(loan.due_date) : undefined,
      paidToDate: toNumber(loan.paid_to_date as number | string | null | undefined),
      status:
        loan.status === "closed" || loan.status === "defaulted" || loan.status === "active"
          ? loan.status
          : "active",
      finished: loan.finished === true,
      penaltyWaivedAmount: toNumber(
        loan.penalty_waived_amount as number | string | null | undefined,
      ),
      loanCycleNumber: Math.max(1, Math.floor(Number(loan.loan_cycle_number ?? 1))),
      feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
        (loan.fee_breakdown ?? {}) as Record<string, unknown>,
        Math.max(1, Math.floor(Number(loan.loan_cycle_number ?? 1))),
      ),
    },
    settings,
  );

  return {
    total: summary.totalExpectedCollected,
    paid: toNumber(loan.paid_to_date as number | string | null | undefined),
    balance: summary.balance,
  };
}

async function assertNoDuplicateOpenLoanKind(
  supabaseAdmin: any,
  args: { memberId: string; loanKind?: string | null; excludeLoanId?: string | null },
) {
  const loanKind = normalizeLoanKindValue(args.loanKind);
  let query = (supabaseAdmin as any)
    .from("loans")
    .select("id, status")
    .eq("member_id", args.memberId)
    .eq("loan_kind", loanKind)
    .in("status", ["pending", "active", "defaulted"])
    .limit(1);

  if (args.excludeLoanId) query = query.neq("id", args.excludeLoanId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let carryoverQuery = (supabaseAdmin as any)
    .from("member_carryover_loans")
    .select("id, status")
    .eq("member_id", args.memberId)
    .eq("loan_kind", loanKind)
    .in("status", ["active", "defaulted"])
    .eq("finished", false)
    .limit(1);

  if (args.excludeLoanId) carryoverQuery = carryoverQuery.neq("id", args.excludeLoanId);

  const { data: carryoverData, error: carryoverError } = await carryoverQuery;
  if (carryoverError) throw new Error(carryoverError.message);

  if ((data ?? []).length > 0 || (carryoverData ?? []).length > 0) {
    const label =
      loanKind === "financial"
        ? "financial"
        : loanKind === "fuel"
          ? "fuel"
          : loanKind === "stock"
            ? "stock"
            : "service";
    throw new Error(
      `This member already has an open ${label} loan. Close that loan before creating another one in the same category.`,
    );
  }
}

function loanDailyRepaymentObligation(loan: {
  principal: number | string | null;
  approved_amount?: number | string | null;
  financed_principal_amount?: number | string | null;
  rate?: number | string | null;
  term_days?: number | null;
  term_months?: number | null;
  paid?: number | string | null;
}) {
  const summary = loanBalanceSummary(loan);
  return Math.min(summary.balance, summary.total / Math.max(1, summary.termDays));
}

function memberNeedsStickerRow(member: {
  business_permanence?: string | null;
  fee_has_shop?: boolean | null;
}) {
  if (member.business_permanence) return member.business_permanence === "permanent";
  return !!member.fee_has_shop;
}

function uniqueTextValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function membershipAccountAliases(value: string) {
  return uniqueTextValues(membershipIdCandidates(value));
}

function feeNoteValue(note?: string | null) {
  return String(note ?? "")
    .trim()
    .toLowerCase();
}

function isPurposePoolFeeTransaction(note?: string | null) {
  return feeNoteValue(note).startsWith("purpose pool");
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
  created_at?: string | null;
  type: string;
  amount: number;
  member_id?: string | null;
  loan_id?: string | null;
  by_staff?: string | null;
  note?: string | null;
  ref?: string | null;
  account?: string | null;
  payer_name?: string | null;
  dedupeByRef?: boolean;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  await ensureSystemStaffActor(supabaseAdmin, row.by_staff);

  const ref = row.ref?.trim();
  if (ref && row.dedupeByRef) {
    const existingTransactionId = await resolveExistingTransactionRef(supabaseAdmin, ref);
    if (existingTransactionId) return existingTransactionId;
  }

  let lastError: any = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
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
      created_at: row.created_at ?? undefined,
    });
    if (!error) return id;
    lastError = error;
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error(lastError?.message ?? "Failed to allocate a unique transaction id.");
}

async function resolveExistingTransactionRef(supabaseAdmin: any, ref: string) {
  const normalizedRef = ref.trim();
  if (!normalizedRef) return null;

  const { data: existingRows, error } = await supabaseAdmin
    .from("transactions")
    .select("id, type, member_id, created_at")
    .eq("ref", normalizedRef)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  if (!existingRows || existingRows.length === 0) return null;

  const preferred =
    existingRows.find((row: any) => row.type !== "mpesa_unallocated" && row.member_id) ??
    existingRows[0];
  const duplicateIds = existingRows
    .filter((row: any) => row.id !== preferred.id)
    .map((row: any) => row.id);

  if (duplicateIds.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from("transactions")
      .delete()
      .in("id", duplicateIds);
    if (deleteError) throw new Error(deleteError.message);
  }

  return String(preferred.id);
}

export async function cleanupDuplicateTransactionRefs() {
  const supabaseAdmin = await requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("id, ref, type, member_id, loan_id, amount, note, account, payer_name, created_at")
    .not("ref", "is", null)
    .order("ref", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const grouped = new Map<string, Array<Record<string, any>>>();
  for (const row of rows) {
    const normalizedRef = String(row.ref ?? "").trim();
    if (!normalizedRef) continue;
    const bucket = grouped.get(normalizedRef) ?? [];
    bucket.push(row);
    grouped.set(normalizedRef, bucket);
  }

  let removed = 0;
  for (const [, refRows] of grouped.entries()) {
    if (refRows.length <= 1) continue;
    const seen = new Map<string, any>();
    const duplicateIds: string[] = [];
    for (const row of refRows) {
      const fingerprint = JSON.stringify({
        type: row.type ?? "",
        amount: Number(row.amount ?? 0),
        member_id: row.member_id ?? "",
        loan_id: row.loan_id ?? "",
        note: String(row.note ?? "").trim(),
        account: String(row.account ?? "").trim(),
        payer_name: String(row.payer_name ?? "").trim(),
      });
      if (!seen.has(fingerprint)) {
        seen.set(fingerprint, row);
        continue;
      }
      duplicateIds.push(row.id);
    }
    if (duplicateIds.length > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from("transactions")
        .delete()
        .in("id", duplicateIds);
      if (deleteError) throw new Error(deleteError.message);
      removed += duplicateIds.length;
    }
  }

  return removed;
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
  createdAt?: string;
}) {
  return insertTransactionRow({
    date: args.date,
    created_at: args.createdAt ?? null,
    type: "mpesa_unallocated",
    amount: args.amount,
    member_id: null,
    by_staff: MPESA_SYSTEM_STAFF_ID,
    note: args.note,
    ref: args.mpesaRef ?? null,
    account: args.account,
    payer_name: args.payerName ?? null,
    dedupeByRef: true,
  });
}

async function insertMpesaReceiptAllocationRow(args: {
  eventId?: string | null;
  mpesaRef?: string | null;
  memberId?: string | null;
  loanId?: string | null;
  transactionId?: string | null;
  allocationType: string;
  amount: number;
  note?: string | null;
  createdAt?: string | null;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const id = `MRA${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await (supabaseAdmin as any).from("mpesa_receipt_allocations").insert({
    id,
    event_id: args.eventId ?? null,
    mpesa_ref: args.mpesaRef?.trim() || null,
    member_id: args.memberId ?? null,
    loan_id: args.loanId ?? null,
    transaction_id: args.transactionId ?? null,
    allocation_type: args.allocationType,
    amount: args.amount,
    note: args.note ?? null,
    created_at: args.createdAt ?? undefined,
  });
  if (error) {
    console.warn("Skipping M-Pesa receipt allocation audit insert", {
      message: error.message,
      code: error.code,
    });
    return null;
  }
  return id;
}

function isInternalRedistributionTransactionRow(row: {
  by_staff?: string | null;
  note?: string | null;
}) {
  const note = String(row.note ?? "")
    .trim()
    .toLowerCase();
  if (!note) return false;
  return (
    note.startsWith("policy redistribution:") ||
    note.startsWith("purpose pool reallocation ->") ||
    note.startsWith("round-off captured from m-pesa receipt")
  );
}

async function findExistingMpesaTransaction(args: {
  account: string;
  amount?: number;
  mpesaRef?: string;
}) {
  const ref = args.mpesaRef?.trim();
  if (!ref) return null;

  const supabaseAdmin = await requireSupabaseAdmin();
  let query = supabaseAdmin
    .from("transactions")
    .select("id, type, member_id, amount")
    .eq("by_staff", MPESA_SYSTEM_STAFF_ID)
    .eq("ref", ref)
    .order("created_at", { ascending: false });

  if (typeof args.amount === "number") {
    query = query.eq("amount", args.amount);
  }

  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] ?? null) as {
    id: string;
    type: string;
    member_id?: string | null;
    amount?: number;
  } | null;
}

async function createProcessedMpesaLedgerLink(args: {
  account: string;
  amount: number;
  payerName?: string;
  mpesaRef?: string;
  eventId?: string;
  date?: string;
  createdAt?: string;
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
      createdAt: args.createdAt,
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
    created_at: args.createdAt ?? null,
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
        loanCycleNumber: Number(loan.loan_cycle_number ?? 1),
        feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
          loan.fee_breakdown as Record<string, unknown>,
          Number(loan.loan_cycle_number ?? 1),
        ),
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
  createdAt?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const ref = args.mpesaRef?.trim() || undefined;

  if (ref) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("mpesa_events")
      .select("id, processed, transaction_id")
      .eq("kind", "confirmation")
      .eq("mpesa_ref", ref)
      .order("processed", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
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
      created_at: args.createdAt ?? undefined,
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

export async function validateMpesaDepositRequest(args: { account: string; amount?: number }) {
  const amount = Number(args.amount ?? 0);
  if (amount <= 0) {
    return { accepted: false, reason: "Payment amount must be above zero." };
  }

  const accountContext = parseMpesaAccountDocket(args.account);
  if (!accountContext.account) {
    return { accepted: true };
  }

  const member = await findMemberByMembershipInput(accountContext.account);
  if (!member) {
    return { accepted: true };
  }

  const runtimeDb = (await requireSupabaseAdmin()) as any;
  const { data: outstandingPenalties, error: penaltiesError } = await runtimeDb
    .from("penalties")
    .select("id")
    .eq("member_id", member.id)
    .eq("status", "outstanding")
    .limit(1);
  if (penaltiesError) throw new Error(penaltiesError.message);

  if ((outstandingPenalties ?? []).length > 0 && accountContext.docket !== "penalty_payment") {
    return {
      accepted: false,
      reason: "Outstanding penalties must be paid through the penalty payment option first.",
    };
  }

  const { data: defaultedLoans, error: defaultedError } = await runtimeDb
    .from("loans")
    .select("id")
    .eq("member_id", member.id)
    .eq("status", "defaulted")
    .limit(1);
  if (defaultedError) throw new Error(defaultedError.message);

  if ((defaultedLoans ?? []).length > 0 && accountContext.docket) {
    return {
      accepted: false,
      reason: "This member has a defaulted loan; payments must route to the defaulted loan.",
    };
  }

  if (accountContext.docket === "loan_savings") {
    const compliance = await memberMeetsComplianceThreshold(runtimeDb, member);
    if (!compliance.ok) {
      return {
        accepted: false,
        reason: `Loan savings opens after savings reach ${compliance.savingsThreshold}/= and shares reach ${compliance.sharesThreshold}/=.`,
      };
    }
  }

  return { accepted: true };
}

export async function applyMpesaPaymentToDatabase(args: {
  account: string;
  amount: number;
  payerName?: string;
  mpesaRef?: string;
  eventId?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const accountContext = parseMpesaAccountDocket(args.account);
  const norm = accountContext.account.trim().toUpperCase();
  const targetedDocket = accountContext.docket;
  const amount = Number(args.amount ?? 0);
  const notes: string[] = [];
  let paymentCreatedAt: string | undefined;
  let paymentDate = new Date().toISOString().slice(0, 10);

  if (args.eventId) {
    const { data: event, error: eventError } = await supabaseAdmin
      .from("mpesa_events")
      .select("processed, transaction_id, created_at")
      .eq("id", args.eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    paymentCreatedAt = event?.created_at ? String(event.created_at) : undefined;
    paymentDate = paymentCreatedAt ? paymentCreatedAt.slice(0, 10) : paymentDate;
    if (!norm || amount <= 0) {
      // If there's no account but a positive amount, create an unallocated ledger row
      if (!norm && amount > 0) {
        const note =
          "M-Pesa confirmation was recorded without an account reference; created an unallocated ledger row.";
        const transactionId = await createUnallocatedMpesaTransaction({
          account: args.account?.trim() ?? "",
          amount,
          payerName: args.payerName,
          mpesaRef: args.mpesaRef,
          note,
          date: paymentDate,
          createdAt: paymentCreatedAt,
        });
        await markMpesaEventProcessed(args.eventId, transactionId);
        return {
          matched: false,
          account: norm,
          transactionId,
          notes: [note],
          primary: { type: "mpesa_unallocated", amount, note },
        };
      }

      const note = !norm
        ? "M-Pesa confirmation was recorded without an account reference; no ledger transaction was created."
        : "M-Pesa confirmation was recorded without a positive amount; no ledger transaction was created.";
      await markMpesaEventProcessed(args.eventId, null);
      return {
        matched: false,
        account: norm,
        notes: [note],
      };
    }
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
        amount,
        payerName: args.payerName,
        mpesaRef: args.mpesaRef,
        eventId: args.eventId,
        date: paymentDate,
        createdAt: paymentCreatedAt,
      });
      return { account: norm, ...linked };
    }
  }

  if (!norm || amount <= 0) {
    // If there's no account but a positive amount, create an unallocated ledger row
    if (!norm && amount > 0) {
      const note =
        "M-Pesa confirmation was recorded without an account reference; created an unallocated ledger row.";
      const unallocatedTransactionId = await createUnallocatedMpesaTransaction({
        account: args.account?.trim() ?? "",
        amount,
        payerName: args.payerName,
        mpesaRef: args.mpesaRef,
        note,
        date: paymentDate,
        createdAt: paymentCreatedAt,
      });
      // args.eventId may be undefined; markMpesaEventProcessed will no-op if so
      await markMpesaEventProcessed(args.eventId, unallocatedTransactionId);
      return {
        matched: false,
        account: norm,
        transactionId: unallocatedTransactionId,
        notes: [note],
        primary: { type: "mpesa_unallocated", amount, note },
      };
    }

    const note = !norm
      ? "M-Pesa confirmation was recorded without an account reference; no ledger transaction was created."
      : "M-Pesa confirmation was recorded without a positive amount; no ledger transaction was created.";
    await markMpesaEventProcessed(args.eventId, null);
    return {
      matched: false,
      account: norm,
      notes: [note],
    };
  }

  const existingReceipt = await findExistingMpesaTransaction({
    account: norm,
    mpesaRef: args.mpesaRef,
  });
  if (existingReceipt?.id) {
    await markMpesaEventProcessed(args.eventId, String(existingReceipt.id));
    const matched = existingReceipt.type !== "mpesa_unallocated";
    return {
      matched,
      memberId: existingReceipt.member_id ?? undefined,
      account: norm,
      transactionId: String(existingReceipt.id),
      primary: {
        type: String(existingReceipt.type),
        amount: Number(existingReceipt.amount ?? amount),
        note: "Duplicate M-Pesa confirmation was linked to the existing ledger row.",
      },
      notes: ["Duplicate M-Pesa confirmation was linked to the existing ledger row."],
    };
  }

  const membershipCandidates = membershipIdCandidates(norm);
  const member = await findMemberByMembershipInput(norm);
  if (!member) {
    const note = membershipCandidates.length
      ? `No member matched account "${args.account}". Recorded as an unallocated M-Pesa payment.`
      : `Account "${args.account}" did not match a known member reference. Recorded as an unallocated M-Pesa payment.`;
    notes.push(note);
    const unallocatedTransactionId = await createUnallocatedMpesaTransaction({
      account: norm,
      amount,
      payerName: args.payerName,
      mpesaRef: args.mpesaRef,
      note,
      date: paymentDate,
      createdAt: paymentCreatedAt,
    });
    await markMpesaEventProcessed(args.eventId, unallocatedTransactionId);
    return {
      matched: false,
      account: norm,
      notes,
      transactionId: unallocatedTransactionId,
      primary: {
        type: "mpesa_unallocated",
        amount,
        note,
      },
    };
  }
  const memberId = member.id;
  const matchedMember = member;
  const memberCategory = resolveMemberCategory(member.member_category, member.is_investor);

  let remaining = amount;
  const txBatch: Array<{
    date?: string;
    created_at?: string | null;
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
  const allocationBatch: Array<{
    allocationType: string;
    note?: string | null;
    loanId?: string | null;
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
  const liveLoanPatches: Array<{
    id: string;
    paid: number;
    status: "pending" | "active" | "closed" | "defaulted" | "rejected";
  }> = [];
  const carryoverLoanPatches: Array<{
    id: string;
    memberId: string;
    paidToDate: number;
    status: "active" | "closed" | "defaulted";
    finished: boolean;
    closedOn?: string | null;
  }> = [];

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
      date: paymentDate,
      created_at: paymentCreatedAt ?? null,
      type: "investor_contribution",
      amount: investorAmount,
      member_id: memberId,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Investment top-up via Paybill ${norm}`,
    });
    await insertMpesaReceiptAllocationRow({
      eventId: args.eventId,
      mpesaRef: args.mpesaRef,
      memberId,
      transactionId: primaryTransactionId,
      allocationType: "investor_contribution",
      amount: investorAmount,
      note: `Investment top-up via Paybill ${norm}`,
      createdAt: paymentCreatedAt ?? null,
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

  const { data: loanRows, error: activeLoanError } = await supabaseAdmin
    .from("loans")
    .select("*")
    .eq("member_id", memberId)
    .in("status", ["defaulted", "active"])
    .order("start_date", { ascending: true })
    .limit(10);
  if (activeLoanError) throw new Error(activeLoanError.message);
  const liveOpenLoans = sortOpenLoansByDispatchDate((loanRows ?? []) as Record<string, any>[]);

  const { data: carryoverRows, error: carryoverLoanError } = await (supabaseAdmin as any)
    .from("member_carryover_loans")
    .select("*")
    .eq("member_id", memberId)
    .in("status", ["defaulted", "active"])
    .eq("finished", false)
    .order("start_date", { ascending: true })
    .limit(25);
  if (carryoverLoanError) throw new Error(carryoverLoanError.message);
  const carryoverOpenLoans = sortOpenLoansByDispatchDate(
    ((carryoverRows ?? []) as Record<string, any>[]).filter((loan) => loan.finished !== true),
  );
  const openLoanTargets = sortOpenLoansByDispatchDate([
    ...liveOpenLoans.map((loan) => {
      const summary = loanBalanceSummary(loan as any);
      return {
        source: "live" as const,
        id: String(loan.id),
        memberId,
        start_date: loan.start_date ?? null,
        created_at: loan.created_at ?? null,
        loan,
        status: String(loan.status ?? "active"),
        paid: summary.paid,
        balance: summary.balance,
        total: summary.total,
      };
    }),
    ...carryoverOpenLoans.map((loan) => {
      const summary = carryoverLoanBalanceSummary(loan, policySettings);
      return {
        source: "carryover" as const,
        id: String(loan.id),
        memberId: String(loan.member_id ?? memberId),
        start_date: loan.start_date ?? null,
        created_at: loan.created_at ?? null,
        loan,
        status: String(loan.status ?? "active"),
        paid: summary.paid,
        balance: summary.balance,
        total: summary.total,
      };
    }),
  ]);
  const activeLoan =
    liveOpenLoans.find((loan: any) => loan.status === "defaulted") ??
    liveOpenLoans.find((loan: any) => loan.status === "active") ??
    null;
  const hasOpenLoan = openLoanTargets.some((loan) => loan.balance > 0);
  const hasDefaultedLoan = openLoanTargets.some(
    (loan) => loan.status === "defaulted" && loan.balance > 0,
  );

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
      { hasActiveLoan: hasOpenLoan },
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

  const scenario = hasOpenLoan ? "member_with_loan" : "member_without_loan";
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
    return Number(memberPatch.savings_balance ?? matchedMember.savings_balance ?? 0);
  }

  function currentShareUnits() {
    return Number(memberPatch.shares ?? matchedMember.shares ?? 0);
  }

  function currentShareValue() {
    return currentShareUnits() * SHARE_PRICE;
  }

  function currentShareReserveBalance() {
    return Number(memberPatch.share_reserve_balance ?? matchedMember.share_reserve_balance ?? 0);
  }

  function currentShareBasketValue() {
    return currentShareValue() + currentShareReserveBalance();
  }

  function queueTransaction(
    row: {
      date?: string;
      created_at?: string | null;
      type: string;
      amount: number;
      member_id?: string | null;
      loan_id?: string | null;
      by_staff?: string | null;
      note?: string | null;
      ref?: string | null;
      account?: string | null;
      payer_name?: string | null;
    },
    allocationType: string,
  ) {
    txBatch.push(row);
    allocationBatch.push({
      allocationType,
      note: row.note ?? null,
      loanId: row.loan_id ?? null,
    });
  }

  function queueSavingsDeposit(
    applied: number,
    notePrefix: string,
    options?: {
      note?: string;
      allocationType?: string;
      primaryNote?: string;
      trackMandatoryThreshold?: boolean;
      roundOff?: boolean;
    },
  ) {
    if (applied <= 0) return;
    const rounded = options?.roundOff === false ? applied : roundUpKES(applied, roundOffStep);
    const surplus = Math.max(0, rounded - applied);
    setPrimaryIfMissing(
      "deposit",
      applied,
      options?.primaryNote ?? `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
    );
    queueTransaction(
      {
        date: paymentDate,
        created_at: paymentCreatedAt ?? null,
        type: "deposit",
        amount: applied,
        member_id: memberId,
        by_staff: MPESA_SYSTEM_STAFF_ID,
        ref: args.mpesaRef,
        account: norm,
        payer_name: args.payerName,
        note: options?.note ?? `Paybill ${norm} - ${args.payerName ?? ""}`,
      },
      options?.allocationType ?? "deposit",
    );
    memberPatch.savings_balance = roundMoney(currentSavingsBalance() + applied);
    if (surplus > 0) toRoundOff += surplus;
    if (options?.trackMandatoryThreshold === false) return;
    if (currentSavingsBalance() < mandatorySavingsThreshold) {
      notes.push(
        `${notePrefix} Member is still below the daily compliance contribution threshold of ${mandatorySavingsThreshold}/=.`,
      );
    } else {
      notes.push(`${notePrefix} Member meets the daily compliance contribution threshold.`);
    }
  }

  function queueShareContribution(applied: number, notePrefix: string, note?: string) {
    let amount = roundMoney(applied);
    if (amount <= 0) return;

    const basketGap = Math.max(0, mandatorySharesThreshold - currentShareBasketValue());
    if (basketGap <= 0) {
      allocatePostComplianceSplit(amount, "mandatory shares threshold is already full");
      return;
    }

    const overflow = roundMoney(Math.max(0, amount - basketGap));
    amount = Math.min(amount, basketGap);

    setPrimaryIfMissing(
      "share_purchase",
      amount,
      `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
    );
    queueTransaction(
      {
        date: paymentDate,
        created_at: paymentCreatedAt ?? null,
        type: "share_purchase",
        amount,
        member_id: memberId,
        by_staff: MPESA_SYSTEM_STAFF_ID,
        ref: args.mpesaRef,
        account: norm,
        payer_name: args.payerName,
        note: note ?? `Mandatory shares via Paybill ${norm}`,
      },
      "share_purchase",
    );

    const shareGapAmount = Math.max(0, mandatorySharesThreshold - currentShareValue());
    let nextReserve = roundMoney(currentShareReserveBalance() + amount);
    const convertibleAmount =
      Math.floor(Math.min(nextReserve, shareGapAmount) / SHARE_PRICE) * SHARE_PRICE;
    const convertedUnits = Math.floor(convertibleAmount / SHARE_PRICE);
    if (convertedUnits > 0) {
      memberPatch.shares = currentShareUnits() + convertedUnits;
      nextReserve = roundMoney(nextReserve - convertedUnits * SHARE_PRICE);
    }
    memberPatch.share_reserve_balance = nextReserve;

    if (convertedUnits > 0) {
      notes.push(
        `${notePrefix} Added ${amount}/= to mandatory shares and converted ${convertedUnits} share unit(s).`,
      );
    } else {
      notes.push(`${notePrefix} Added ${amount}/= to mandatory share reserve.`);
    }

    if (overflow > 0) {
      allocatePostComplianceSplit(overflow, "share threshold overflow");
    }
  }

  function queuePurposePoolContribution(applied: number, reason: string) {
    const amount = roundMoney(applied);
    if (amount <= 0) return;
    setPrimaryIfMissing("fee_payment", amount, `Purpose pool via Paybill ${norm}`);
    queueTransaction(
      {
        date: paymentDate,
        created_at: paymentCreatedAt ?? null,
        type: "fee_payment",
        amount,
        member_id: memberId,
        by_staff: MPESA_SYSTEM_STAFF_ID,
        ref: args.mpesaRef,
        account: norm,
        payer_name: args.payerName,
        note: `Purpose pool contribution (auto) - ${reason}`,
      },
      "purpose_pool",
    );
    notes.push(`Routed ${amount}/= into the internal purpose pool (${reason}).`);
  }

  function allocatePostComplianceSplit(applied: number, reason: string) {
    const amount = roundMoney(applied);
    if (amount <= 0) return;
    if (
      currentSavingsBalance() < mandatorySavingsThreshold ||
      currentShareBasketValue() < mandatorySharesThreshold
    ) {
      allocateComplianceBasket(amount, "Compliance gate before loan savings:");
      return;
    }
    const loanSavingsAmount = roundMoney(amount * POST_COMPLIANCE_LOAN_SAVINGS_PCT);
    const purposePoolAmount = roundMoney(amount - loanSavingsAmount);

    if (purposePoolAmount > 0) {
      queuePurposePoolContribution(purposePoolAmount, reason);
    }
    if (loanSavingsAmount > 0) {
      queueSavingsDeposit(loanSavingsAmount, "Post-compliance savings:", {
        note: `Loan savings / multiplier savings via Paybill ${norm}`,
        allocationType: "loan_savings",
        primaryNote: `Loan savings via Paybill ${norm}`,
        trackMandatoryThreshold: false,
        roundOff: false,
      });
      notes.push(`Routed ${loanSavingsAmount}/= to loan savings / multiplier savings (${reason}).`);
    }
  }

  function allocateComplianceBasket(applied: number, notePrefix: string) {
    let amount = roundMoney(applied);
    if (amount <= 0) return;

    const savingsGap = Math.max(0, mandatorySavingsThreshold - currentSavingsBalance());
    const shareGap = Math.max(0, mandatorySharesThreshold - currentShareBasketValue());
    const complianceCapacity = roundMoney(savingsGap + shareGap);

    if (complianceCapacity <= 0) {
      allocatePostComplianceSplit(amount, "mandatory compliance basket is already full");
      return;
    }

    const complianceApplied = Math.min(amount, complianceCapacity);
    let savingsTarget = Math.min(
      savingsGap,
      roundMoney(complianceApplied * COMPLIANCE_SAVINGS_PCT),
    );
    let shareTarget = Math.min(shareGap, roundMoney(complianceApplied * COMPLIANCE_SHARES_PCT));
    let unassigned = roundMoney(complianceApplied - savingsTarget - shareTarget);

    if (unassigned > 0 && savingsTarget < savingsGap) {
      const extraSavings = Math.min(unassigned, roundMoney(savingsGap - savingsTarget));
      savingsTarget = roundMoney(savingsTarget + extraSavings);
      unassigned = roundMoney(unassigned - extraSavings);
    }
    if (unassigned > 0 && shareTarget < shareGap) {
      const extraShares = Math.min(unassigned, roundMoney(shareGap - shareTarget));
      shareTarget = roundMoney(shareTarget + extraShares);
      unassigned = roundMoney(unassigned - extraShares);
    }

    if (savingsTarget > 0) {
      queueSavingsDeposit(savingsTarget, notePrefix, {
        note: `Mandatory daily compliance contribution via Paybill ${norm}`,
        roundOff: false,
      });
    }
    if (shareTarget > 0) {
      queueShareContribution(
        shareTarget,
        notePrefix,
        `Mandatory compliance shares via Paybill ${norm}`,
      );
    }

    amount = roundMoney(amount - complianceApplied);
    if (amount > 0 || unassigned > 0) {
      allocatePostComplianceSplit(
        roundMoney(amount + unassigned),
        "amount above daily compliance contribution and shares thresholds",
      );
    }
  }

  async function applyLoanRepayment(applied: number) {
    let available = roundMoney(applied);
    if (available <= 0 || !hasOpenLoan) return available;

    for (const target of openLoanTargets) {
      if (available <= 0) break;
      const balance = roundMoney(target.balance);
      if (balance <= 0) continue;

      const safeApplied = Math.min(available, balance);
      if (safeApplied <= 0) continue;

      const rounded = roundUpKES(safeApplied, roundOffStep);
      const surplus = Math.max(0, rounded - safeApplied);
      if (surplus > 0) toRoundOff += surplus;

      const note =
        target.source === "carryover"
          ? `Carryover loan repayment ${target.id} via Paybill ${norm}`
          : `Paybill ${norm} - ${args.payerName ?? ""}`;
      setPrimaryIfMissing(
        "loan_repayment",
        safeApplied,
        `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
        target.source === "live" ? target.id : undefined,
      );
      queueTransaction(
        {
          date: paymentDate,
          created_at: paymentCreatedAt ?? null,
          type: "loan_repayment",
          amount: safeApplied,
          member_id: memberId,
          loan_id: target.source === "live" ? target.id : null,
          by_staff: MPESA_SYSTEM_STAFF_ID,
          ref: args.mpesaRef,
          account: norm,
          payer_name: args.payerName,
          note,
        },
        target.source === "carryover" ? "carryover_loan_repayment" : "loan_repayment",
      );

      const nextPaid = roundMoney(target.paid + safeApplied);
      const nextBalance = Math.max(0, roundMoney(target.total - nextPaid));
      const nextStatus = nextBalance <= 0 ? "closed" : target.status;
      target.paid = nextPaid;
      target.balance = nextBalance;
      target.status = nextStatus;

      if (target.source === "live") {
        target.loan.paid = nextPaid;
        target.loan.status = nextStatus;
        liveLoanPatches.push({
          id: target.id,
          paid: nextPaid,
          status: nextStatus as "pending" | "active" | "closed" | "defaulted" | "rejected",
        });
      } else {
        target.loan.paid_to_date = nextPaid;
        target.loan.status = nextStatus;
        target.loan.finished = nextBalance <= 0;
        carryoverLoanPatches.push({
          id: target.id,
          memberId: target.memberId,
          paidToDate: nextPaid,
          status: nextStatus as "active" | "closed" | "defaulted",
          finished: nextBalance <= 0,
          closedOn: nextBalance <= 0 ? paymentDate : null,
        });
      }

      notes.push(
        `Applied ${safeApplied}/= to ${target.source === "carryover" ? "carryover " : ""}loan ${target.id}; rounded up to ${rounded}/=, surplus ${surplus}/= -> round-off pool.`,
      );
      available = roundMoney(available - safeApplied);
    }

    return available;
  }

  function allocatePremiumUpfrontRequirement(applied: number) {
    if (!activeLoan || applied <= 0) return applied;
    const approvedAmount = Number(activeLoan.approved_amount ?? activeLoan.principal ?? 0);
    const requirement = premiumUpfrontRequirementForAmount(approvedAmount);
    if (requirement.total <= 0 || matchedMember.fee_first_upfront_paid) return applied;

    let available = applied;
    const savingsGap = Math.max(0, requirement.minSavings - currentSavingsBalance());
    const savingsApplied = Math.min(available, savingsGap);
    if (savingsApplied > 0) {
      queueSavingsDeposit(savingsApplied, "Premium upfront:", {
        note: `Premium upfront savings via Paybill ${norm}`,
      });
      available = roundMoney(available - savingsApplied);
    }

    const shareGap = Math.max(0, requirement.minShares - currentShareBasketValue());
    const shareApplied = Math.min(available, shareGap);
    if (shareApplied > 0) {
      queueShareContribution(
        shareApplied,
        "Premium upfront:",
        `Premium upfront shares via Paybill ${norm}`,
      );
      available = roundMoney(available - shareApplied);
    }

    const upfrontMet =
      currentSavingsBalance() >= requirement.minSavings &&
      currentShareBasketValue() >= requirement.minShares;
    if (upfrontMet) {
      memberPatch.fee_first_upfront_paid = true;
      notes.push(
        `Premium upfront requirement met: savings ${requirement.minSavings}/=, shares ${requirement.minShares}/=.`,
      );
    } else if (savingsApplied > 0 || shareApplied > 0) {
      notes.push(
        `Premium upfront still pending: savings target ${requirement.minSavings}/=, shares target ${requirement.minShares}/=.`,
      );
    }

    return available;
  }

  async function loadSpecialBufferBalance(kind: "locomotive" | "stock") {
    const prefix = kind === "locomotive" ? "Locomotive fuel buffer" : "Stock buffer";
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("amount")
      .eq("member_id", memberId)
      .eq("type", "deposit")
      .ilike("note", `${prefix}%`);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((sum: number, row: { amount?: number | string | null }) => {
      return sum + Number(row.amount ?? 0);
    }, 0);
  }

  function queueSpecialInterest(applied: number, kind: "locomotive" | "stock") {
    const amount = roundMoney(applied);
    if (amount <= 0) return;
    const label = kind === "locomotive" ? "Locomotive fuel" : "Stock";
    setPrimaryIfMissing("fee_payment", amount, `${label} loan transaction interest via Paybill`);
    queueTransaction(
      {
        date: paymentDate,
        created_at: paymentCreatedAt ?? null,
        type: "fee_payment",
        amount,
        member_id: memberId,
        by_staff: MPESA_SYSTEM_STAFF_ID,
        ref: args.mpesaRef,
        account: norm,
        payer_name: args.payerName,
        note: `${label} loan transaction interest (auto)`,
      },
      `${kind}_loan_interest`,
    );
    notes.push(`Deducted ${amount}/= ${label.toLowerCase()} loan transaction interest.`);
  }

  async function allocateSpecialMemberPayment(kind: "locomotive" | "stock") {
    if (remaining <= 0) return;
    const label = kind === "locomotive" ? "Locomotive fuel" : "Stock";
    const openLoanBalance = openLoanTargets.reduce((sum, loan) => sum + loan.balance, 0);

    if (openLoanBalance > 0) {
      if (kind === "locomotive") {
        const interest = Math.min(remaining, SPECIAL_MEMBER_TRANSACTION_INTEREST);
        queueSpecialInterest(interest, kind);
        remaining = roundMoney(remaining - interest);

        const existingBuffer = await loadSpecialBufferBalance(kind);
        const pendingBuffer = txBatch
          .filter(
            (row) =>
              row.type === "deposit" && String(row.note ?? "").startsWith("Locomotive fuel buffer"),
          )
          .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
        const bufferGap = Math.max(
          0,
          SPECIAL_MEMBER_BUFFER_TARGET - existingBuffer - pendingBuffer,
        );
        const bufferApplied = Math.min(remaining, SPECIAL_MEMBER_BUFFER_PER_PAYMENT, bufferGap);
        if (bufferApplied > 0) {
          queueSavingsDeposit(bufferApplied, `${label} buffer:`, {
            note: `${label} buffer via Paybill ${norm}`,
            allocationType: `${kind}_buffer`,
            primaryNote: `${label} buffer via Paybill ${norm}`,
            trackMandatoryThreshold: false,
            roundOff: false,
          });
          notes.push(`Saved ${bufferApplied}/= toward the fuel buffer.`);
          remaining = roundMoney(remaining - bufferApplied);
        }
      }

      if (remaining > 0) {
        const overflow = await applyLoanRepayment(remaining);
        remaining = roundMoney(overflow);
      }
    }

    if (remaining <= 0) return;

    const existingBuffer = await loadSpecialBufferBalance(kind);
    const pendingBuffer = txBatch
      .filter(
        (row) =>
          row.type === "deposit" &&
          String(row.note ?? "").startsWith(
            kind === "locomotive" ? "Locomotive fuel buffer" : "Stock buffer",
          ),
      )
      .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
    const bufferGap = Math.max(0, SPECIAL_MEMBER_BUFFER_TARGET - existingBuffer - pendingBuffer);
    const bufferApplied = Math.min(remaining, bufferGap);
    if (bufferApplied > 0) {
      queueSavingsDeposit(bufferApplied, `${label} buffer:`, {
        note: `${label} buffer via Paybill ${norm}`,
        allocationType: `${kind}_buffer`,
        primaryNote: `${label} buffer via Paybill ${norm}`,
        trackMandatoryThreshold: false,
        roundOff: false,
      });
      notes.push(`Filled ${label.toLowerCase()} buffer by ${bufferApplied}/=.`);
      remaining = roundMoney(remaining - bufferApplied);
    }

    if (remaining > 0) {
      allocatePostComplianceSplit(remaining, `${label.toLowerCase()} loan and buffer are complete`);
      remaining = 0;
    }
  }

  function allocateServiceMemberPayment() {
    if (remaining <= 0) return;
    const amount = roundMoney(remaining);
    setPrimaryIfMissing("fee_payment", amount, `Service payment via Paybill ${norm}`);
    queueTransaction(
      {
        date: paymentDate,
        created_at: paymentCreatedAt ?? null,
        type: "fee_payment",
        amount,
        member_id: memberId,
        by_staff: MPESA_SYSTEM_STAFF_ID,
        ref: args.mpesaRef,
        account: norm,
        payer_name: args.payerName,
        note: `Service payment (auto) via Paybill ${norm}`,
      },
      "service_payment",
    );
    notes.push(
      `Routed ${amount}/= to the member service account for admin-applied service fees and interest.`,
    );
    remaining = 0;
  }

  async function allocateMemberPaymentAfterFeesAndPenalties() {
    if (remaining <= 0) return;

    if (memberCategory === "service") {
      allocateServiceMemberPayment();
      return;
    }

    if (memberCategory === "locomotive" || memberCategory === "stock") {
      await allocateSpecialMemberPayment(memberCategory);
      return;
    }

    if (!hasOpenLoan || memberCategory === "both") {
      allocateComplianceBasket(remaining, "Non-loan flow:");
      remaining = 0;
      return;
    }

    const approvedAmount = activeLoan
      ? Number(activeLoan.approved_amount ?? activeLoan.principal ?? 0)
      : 0;
    if (activeLoan) {
      remaining = allocatePremiumUpfrontRequirement(remaining);
    }

    const complianceContribution = Math.min(remaining, approvedAmount <= 5000 ? 50 : 100);
    if (complianceContribution > 0) {
      allocateComplianceBasket(complianceContribution, "Loan compliance contribution:");
      remaining = roundMoney(remaining - complianceContribution);
    }

    if (remaining > 0) {
      const overflow = await applyLoanRepayment(remaining);
      remaining = 0;
      if (overflow > 0) {
        allocateComplianceBasket(overflow, "Post-loan remainder:");
      }
    }
  }

  if (
    targetedDocket &&
    targetedDocket !== "penalty_payment" &&
    !hasDefaultedLoan &&
    (outstandingPenalties ?? []).length === 0
  ) {
    await adjustMemberDocketBalance({
      runtimeDb: supabaseAdmin,
      member: matchedMember,
      docket: targetedDocket,
      delta: amount,
      protected: true,
    });

    const targetedTxType =
      targetedDocket === "shares" || targetedDocket === "share_reserve"
        ? "share_purchase"
        : targetedDocket === "investment"
          ? "investor_contribution"
          : targetedDocket === "purpose_pool"
            ? "fee_payment"
            : "deposit";
    primary = {
      type: targetedTxType,
      amount,
      note: `Protected ${targetedDocket.replace(/_/g, " ")} deposit via Paybill ${norm}`,
    };
    primaryTransactionId = await insertTransactionRow({
      date: paymentDate,
      created_at: paymentCreatedAt ?? null,
      type: targetedTxType,
      amount,
      member_id: memberId,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: primary.note,
    });
    await insertMpesaReceiptAllocationRow({
      eventId: args.eventId,
      mpesaRef: args.mpesaRef,
      memberId,
      transactionId: primaryTransactionId,
      allocationType: targetedDocket,
      amount,
      note: primary.note,
      createdAt: paymentCreatedAt ?? null,
    });
    const { error: movementError } = await supabaseAdmin.from("member_docket_movements").insert({
      id: makeId("MDM"),
      member_id: memberId,
      to_docket: targetedDocket,
      amount,
      reason: `Protected M-Pesa targeted deposit (${accountContext.raw})`,
      by_staff: MPESA_SYSTEM_STAFF_ID,
      protected: true,
    });
    if (movementError) throw new Error(movementError.message);
    notes.push(
      `Protected ${amount}/= in ${targetedDocket.replace(/_/g, " ")}; redistribution and carryover resets will not move it.`,
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

  if (hasDefaultedLoan) {
    const overflow = await applyLoanRepayment(remaining);
    remaining = 0;
    if (overflow > 0) {
      allocateComplianceBasket(overflow, "Post-defaulted loan remainder:");
    }
  } else {
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
        queueTransaction(
          {
            date: paymentDate,
            created_at: paymentCreatedAt ?? null,
            type: "fee_payment",
            amount: fee.amount,
            member_id: memberId,
            by_staff: MPESA_SYSTEM_STAFF_ID,
            ref: args.mpesaRef,
            account: norm,
            payer_name: args.payerName,
            note: `${fee.label} (auto)`,
          },
          "fee_payment",
        );
        notes.push(`Paid ${fee.label} - ${fee.amount}/=.`);
        continue;
      }

      if (step === "penalties") {
        for (const penalty of outstandingPenalties ?? []) {
          const amount = Number(penalty.amount ?? 0);
          if (remaining < amount) continue;
          remaining -= amount;
          penaltiesCleared.push({ id: penalty.id, amount });
          setPrimaryIfMissing(
            "fee_payment",
            amount,
            `Penalty payment ${penalty.id} via Paybill ${norm}`,
          );
          queueTransaction(
            {
              date: paymentDate,
              created_at: paymentCreatedAt ?? null,
              type: "fee_payment",
              amount,
              member_id: memberId,
              loan_id: penalty.loan_id ?? null,
              by_staff: MPESA_SYSTEM_STAFF_ID,
              ref: args.mpesaRef,
              account: norm,
              payer_name: args.payerName,
              note: `Penalty payment ${penalty.id} (${penalty.reason})`,
            },
            "penalty_payment",
          );
          notes.push(`Cleared penalty ${penalty.id} (${penalty.reason}) - ${amount}/=.`);
        }
        continue;
      }
    }

    await allocateMemberPaymentAfterFeesAndPenalties();
  }

  if (remaining > 0) {
    allocateComplianceBasket(remaining, "Safety fallback:");
    notes.push(
      "Remaining balance was routed through the compliance basket and post-compliance split because the configured preprocessing steps ended before the full amount was allocated.",
    );
    remaining = 0;
  }

  for (const [index, tx] of txBatch.entries()) {
    const txId = await insertTransactionRow(tx);
    const allocation = allocationBatch[index];
    if (allocation) {
      await insertMpesaReceiptAllocationRow({
        eventId: args.eventId,
        mpesaRef: args.mpesaRef,
        memberId,
        loanId: allocation.loanId ?? tx.loan_id ?? null,
        transactionId: txId,
        allocationType: allocation.allocationType,
        amount: Number(tx.amount ?? 0),
        note: allocation.note ?? tx.note ?? null,
        createdAt: paymentCreatedAt ?? null,
      });
    }
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
    const roundOffId = await insertRoundOffRow({
      memberId,
      amount: toRoundOff,
      source: primary?.type === "deposit" ? "savings_deposit" : "loan_repayment",
      date: paymentDate,
      ref: args.mpesaRef,
    });
    await insertMpesaReceiptAllocationRow({
      eventId: args.eventId,
      mpesaRef: args.mpesaRef,
      memberId,
      transactionId: null,
      allocationType: "round_off",
      amount: toRoundOff,
      note: `Round-off captured from M-Pesa receipt (${roundOffId})`,
      createdAt: paymentCreatedAt ?? null,
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

  const uniqueLiveLoanPatches = Array.from(
    new Map(liveLoanPatches.map((patch) => [patch.id, patch])).values(),
  );
  for (const patch of uniqueLiveLoanPatches) {
    const { error: loanUpdateError } = await supabaseAdmin
      .from("loans")
      .update({
        paid: patch.paid,
        status: patch.status,
      })
      .eq("id", patch.id);
    if (loanUpdateError) throw new Error(loanUpdateError.message);
  }

  const uniqueCarryoverLoanPatches = Array.from(
    new Map(carryoverLoanPatches.map((patch) => [patch.id, patch])).values(),
  );
  const carryoverMemberIds = new Set<string>();
  for (const patch of uniqueCarryoverLoanPatches) {
    const { error: carryoverUpdateError } = await (supabaseAdmin as any)
      .from("member_carryover_loans")
      .update({
        paid_to_date: patch.paidToDate,
        status: patch.status,
        finished: patch.finished,
        closed_on: patch.closedOn,
      })
      .eq("id", patch.id);
    if (carryoverUpdateError) throw new Error(carryoverUpdateError.message);
    carryoverMemberIds.add(patch.memberId);
  }
  for (const carryoverMemberId of carryoverMemberIds) {
    await refreshCarryoverMemberSummary(supabaseAdmin, carryoverMemberId);
  }

  if (Object.keys(memberPatch).length > 0) {
    const { error: memberUpdateError } = await supabaseAdmin
      .from("members")
      .update(memberPatch as any)
      .eq("id", memberId);
    if (memberUpdateError) throw new Error(memberUpdateError.message);
  }

  await repairMemberFinancialInvariants({
    runtimeDb: supabaseAdmin,
    memberId,
    actorId: MPESA_SYSTEM_STAFF_ID,
    reason: "M-Pesa allocation",
  });

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

async function findMpesaWithdrawalRequestEvent(args: {
  conversationId?: string;
  originatorConversationId?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const conversationId = args.conversationId?.trim() || undefined;
  const originatorConversationId = args.originatorConversationId?.trim() || undefined;

  if (conversationId) {
    const { data, error } = await supabaseAdmin
      .from("mpesa_events")
      .select("*")
      .eq("kind", "b2c_request")
      .eq("mpesa_ref", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (originatorConversationId) {
    const { data, error } = await supabaseAdmin
      .from("mpesa_events")
      .select("*")
      .eq("kind", "b2c_request")
      .contains("raw", { originatorConversationId } as any)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  return null;
}

async function findSystemPayoutRequest(args: {
  conversationId?: string;
  originatorConversationId?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const conversationId = args.conversationId?.trim() || undefined;
  const originatorConversationId = args.originatorConversationId?.trim() || undefined;

  if (conversationId) {
    const { data, error } = await supabaseAdmin
      .from("system_payout_requests")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  if (originatorConversationId) {
    const { data, error } = await supabaseAdmin
      .from("system_payout_requests")
      .select("*")
      .eq("originator_conversation_id", originatorConversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  return null;
}

async function finalizeSuccessfulWithdrawalRequest(args: {
  requestEvent: any;
  payoutRef?: string;
  resultDesc?: string;
  createdAt?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  if (args.requestEvent.transaction_id) {
    await markMpesaEventProcessed(args.requestEvent.id, String(args.requestEvent.transaction_id));
    return String(args.requestEvent.transaction_id);
  }

  const memberId = String(args.requestEvent.account ?? "").trim();
  if (!memberId) {
    throw new Error("The payout request is missing a member account reference.");
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from("members")
    .select("id, savings_balance, shares, share_reserve_balance")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) {
    throw new Error(`The payout member ${memberId} could not be found.`);
  }

  const payoutDate = args.createdAt
    ? String(args.createdAt).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const requestedBy =
    String((args.requestEvent.raw as { requestedBy?: unknown } | null)?.requestedBy ?? "").trim() ||
    MPESA_SYSTEM_STAFF_ID;
  const note = args.resultDesc?.trim() || "Withdrawal payout completed via M-Pesa B2C";
  const amount = toNumber(args.requestEvent.amount);

  const transactionId = await insertTransactionRow({
    date: payoutDate,
    created_at: args.createdAt ?? null,
    type: "withdrawal",
    amount,
    member_id: memberId,
    by_staff: requestedBy,
    ref: args.payoutRef?.trim() || args.requestEvent.mpesa_ref || null,
    account: formatMembershipNumber(memberId),
    payer_name: args.requestEvent.payer_name ?? null,
    note,
  });

  await adjustMemberDocketBalance({
    runtimeDb: supabaseAdmin,
    member,
    docket: "withdrawable_savings",
    delta: -amount,
  });
  const { error: movementError } = await supabaseAdmin.from("member_docket_movements").insert({
    id: makeId("MDM"),
    member_id: memberId,
    from_docket: "withdrawable_savings",
    amount,
    reason: "Client withdrawable savings payout completed",
    by_staff: requestedBy,
    protected: true,
  });
  if (movementError) throw new Error(movementError.message);

  await markMpesaEventProcessed(args.requestEvent.id, transactionId);
  return transactionId;
}

async function finalizeSuccessfulSystemPayoutRequest(args: {
  request: any;
  payoutRef?: string;
  resultDesc?: string;
  createdAt?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  if (args.request.transaction_id) {
    return String(args.request.transaction_id);
  }

  const payoutDate = args.createdAt
    ? String(args.createdAt).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const requestedBy =
    String(args.request.requested_by ?? MPESA_SYSTEM_STAFF_ID).trim() || MPESA_SYSTEM_STAFF_ID;
  const note =
    args.resultDesc?.trim() ||
    `${String(args.request.purpose ?? "").replace(/_/g, " ")} completed via M-Pesa B2C`;
  const amount = toNumber(args.request.amount);
  let transactionId: string | undefined;

  if (args.request.purpose === "loan_disbursement") {
    transactionId = await insertTransactionRow({
      date: payoutDate,
      created_at: args.createdAt ?? null,
      type: "loan_disbursement",
      amount,
      member_id: args.request.member_id ?? null,
      loan_id: args.request.loan_id ?? null,
      by_staff: requestedBy,
      ref: args.payoutRef?.trim() || args.request.conversation_id || null,
      account: args.request.account_reference ?? null,
      payer_name: null,
      note,
    });
    if (args.request.loan_id) {
      const { error: loanError } = await supabaseAdmin
        .from("loans")
        .update({
          disbursement_status: "paid",
          disbursement_completed_at: args.createdAt ?? new Date().toISOString(),
        })
        .eq("id", args.request.loan_id);
      if (loanError) throw new Error(loanError.message);
    }
  } else if (args.request.purpose === "staff_payroll") {
    const { data: staffRow, error: staffError } = await supabaseAdmin
      .from("staff")
      .select("name")
      .eq("id", args.request.receiver_staff_id)
      .maybeSingle();
    if (staffError) throw new Error(staffError.message);

    transactionId = await insertTransactionRow({
      date: payoutDate,
      created_at: args.createdAt ?? null,
      type: "staff_payroll",
      amount,
      by_staff: requestedBy,
      ref: args.payoutRef?.trim() || args.request.conversation_id || null,
      account: args.request.receiver_staff_id ?? null,
      payer_name: staffRow?.name ?? null,
      note,
    });

    if (args.request.raw && typeof args.request.raw === "object") {
      const payrollPaymentId = String(
        (args.request.raw as { payrollPaymentId?: unknown }).payrollPaymentId ?? "",
      ).trim();
      if (payrollPaymentId) {
        const { error: paymentError } = await supabaseAdmin
          .from("staff_payroll_payments")
          .update({
            status: "paid",
            paid_amount: amount,
            paid_at: args.createdAt ?? new Date().toISOString(),
            transaction_id: transactionId,
            mpesa_ref: args.payoutRef?.trim() || args.request.conversation_id || null,
          })
          .eq("id", payrollPaymentId);
        if (paymentError) throw new Error(paymentError.message);
      }
    }
  }

  const { error } = await supabaseAdmin
    .from("system_payout_requests")
    .update({
      status: "paid",
      mpesa_ref: args.payoutRef?.trim() || args.request.conversation_id || null,
      transaction_id: transactionId ?? null,
    })
    .eq("id", args.request.id);
  if (error) throw new Error(error.message);

  return transactionId ?? args.request.id;
}

async function markSystemPayoutRequestTerminal(
  request: any,
  status: "failed" | "timeout",
  payoutRef?: string,
) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("system_payout_requests")
    .update({
      status,
      mpesa_ref: payoutRef?.trim() || request.conversation_id || null,
    })
    .eq("id", request.id);
  if (error) throw new Error(error.message);

  if (request.purpose === "loan_disbursement" && request.loan_id) {
    const { error: loanError } = await supabaseAdmin
      .from("loans")
      .update({
        disbursement_status: status,
      })
      .eq("id", request.loan_id);
    if (loanError) throw new Error(loanError.message);
  }

  if (request.purpose === "staff_payroll" && request.raw && typeof request.raw === "object") {
    const payrollPaymentId = String(
      (request.raw as { payrollPaymentId?: unknown }).payrollPaymentId ?? "",
    ).trim();
    if (payrollPaymentId) {
      const { error: paymentError } = await supabaseAdmin
        .from("staff_payroll_payments")
        .update({
          status,
        })
        .eq("id", payrollPaymentId);
      if (paymentError) throw new Error(paymentError.message);
    }
  }
}

export async function applyMpesaWithdrawalResultToDatabase(args: {
  raw: Record<string, unknown>;
  conversationId?: string;
  originatorConversationId?: string;
  payoutRef?: string;
  resultCode: number;
  resultDesc?: string;
  createdAt?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const systemPayoutRequest = await findSystemPayoutRequest({
    conversationId: args.conversationId,
    originatorConversationId: args.originatorConversationId,
  });
  const requestEvent = await findMpesaWithdrawalRequestEvent({
    conversationId: args.conversationId,
    originatorConversationId: args.originatorConversationId,
  });

  const { data: callbackEvent, error: callbackError } = await supabaseAdmin
    .from("mpesa_events")
    .insert({
      kind: "b2c_result",
      account: requestEvent?.account ?? null,
      amount: requestEvent?.amount ?? null,
      mpesa_ref: args.conversationId ?? args.originatorConversationId ?? args.payoutRef ?? null,
      payer_name: requestEvent?.payer_name ?? null,
      phone: requestEvent?.phone ?? null,
      raw: args.raw as any,
      processed: true,
      created_at: args.createdAt ?? undefined,
    })
    .select("id")
    .single();
  if (callbackError) throw new Error(callbackError.message);

  if (!requestEvent) {
    if (systemPayoutRequest) {
      if (args.resultCode !== 0) {
        await markSystemPayoutRequestTerminal(systemPayoutRequest, "failed", args.payoutRef);
        return {
          matched: true,
          callbackEventId: callbackEvent.id,
          requestEventId: systemPayoutRequest.id,
          succeeded: false,
        };
      }

      const transactionId = await finalizeSuccessfulSystemPayoutRequest({
        request: systemPayoutRequest,
        payoutRef: args.payoutRef,
        resultDesc: args.resultDesc,
        createdAt: args.createdAt,
      });

      const { error: callbackLinkError } = await supabaseAdmin
        .from("mpesa_events")
        .update({ transaction_id: transactionId })
        .eq("id", callbackEvent.id);
      if (callbackLinkError) throw new Error(callbackLinkError.message);

      return {
        matched: true,
        callbackEventId: callbackEvent.id,
        requestEventId: systemPayoutRequest.id,
        transactionId,
        succeeded: true,
      };
    }

    return {
      matched: false,
      callbackEventId: callbackEvent.id,
      succeeded: args.resultCode === 0,
    };
  }

  if (args.resultCode !== 0) {
    await markMpesaEventProcessed(requestEvent.id, null);
    return {
      matched: true,
      callbackEventId: callbackEvent.id,
      requestEventId: requestEvent.id,
      succeeded: false,
    };
  }

  const transactionId = await finalizeSuccessfulWithdrawalRequest({
    requestEvent,
    payoutRef: args.payoutRef,
    resultDesc: args.resultDesc,
    createdAt: args.createdAt,
  });

  const { error: callbackLinkError } = await supabaseAdmin
    .from("mpesa_events")
    .update({ transaction_id: transactionId })
    .eq("id", callbackEvent.id);
  if (callbackLinkError) throw new Error(callbackLinkError.message);

  return {
    matched: true,
    callbackEventId: callbackEvent.id,
    requestEventId: requestEvent.id,
    transactionId,
    succeeded: true,
  };
}

export async function markMpesaWithdrawalTimeout(args: {
  raw: Record<string, unknown>;
  conversationId?: string;
  originatorConversationId?: string;
  createdAt?: string;
}) {
  const supabaseAdmin = await requireSupabaseAdmin();
  const systemPayoutRequest = await findSystemPayoutRequest({
    conversationId: args.conversationId,
    originatorConversationId: args.originatorConversationId,
  });
  const requestEvent = await findMpesaWithdrawalRequestEvent({
    conversationId: args.conversationId,
    originatorConversationId: args.originatorConversationId,
  });

  const { error: timeoutError } = await supabaseAdmin.from("mpesa_events").insert({
    kind: "b2c_timeout",
    account: requestEvent?.account ?? null,
    amount: requestEvent?.amount ?? null,
    mpesa_ref: args.conversationId ?? args.originatorConversationId ?? null,
    payer_name: requestEvent?.payer_name ?? null,
    phone: requestEvent?.phone ?? null,
    raw: args.raw as any,
    processed: true,
    created_at: args.createdAt ?? undefined,
  });
  if (timeoutError) throw new Error(timeoutError.message);

  if (requestEvent) {
    await markMpesaEventProcessed(requestEvent.id, null);
  }

  if (systemPayoutRequest) {
    await markSystemPayoutRequestTerminal(systemPayoutRequest, "timeout");
  }

  return {
    matched: !!requestEvent || !!systemPayoutRequest,
    requestEventId: requestEvent?.id ?? systemPayoutRequest?.id ?? null,
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
  const memberTags = normalizeMemberTags(row.member_tags, row.member_category, row.is_investor);

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    joinedAt: row.joined_at,
    status: row.status,
    shares: row.shares,
    shareReserveBalance: toNumber(row.share_reserve_balance),
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
    memberTags,
    isInvestor: memberTags.includes("investor") || isInvestorCategory(category),
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
    financedPrincipalAmount:
      row.financed_principal_amount == null ? undefined : toNumber(row.financed_principal_amount),
    rate: toNumber(row.rate),
    termMonths: row.term_months,
    termDays: row.term_days == null ? undefined : (row.term_days as 7 | 14 | 30 | 60 | 90),
    startDate: row.start_date,
    status: row.status,
    officerId: row.officer_id ?? "",
    paid: toNumber(row.paid),
    netDisbursedAmount:
      row.net_disbursed_amount == null ? undefined : toNumber(row.net_disbursed_amount),
    processingFeeAmount:
      row.processing_fee_amount == null ? undefined : toNumber(row.processing_fee_amount),
    insuranceFeeAmount:
      row.insurance_fee_amount == null ? undefined : toNumber(row.insurance_fee_amount),
    transactionFeeAmount:
      row.transaction_fee_amount == null ? undefined : toNumber(row.transaction_fee_amount),
    processingFeeMode:
      row.processing_fee_mode === "upfront" || row.processing_fee_mode === "financed"
        ? row.processing_fee_mode
        : undefined,
    insuranceFeeMode:
      row.insurance_fee_mode === "upfront" || row.insurance_fee_mode === "financed"
        ? row.insurance_fee_mode
        : undefined,
    disbursementStatus:
      row.disbursement_status === "requested" ||
      row.disbursement_status === "paid" ||
      row.disbursement_status === "failed" ||
      row.disbursement_status === "timeout" ||
      row.disbursement_status === "not_requested"
        ? row.disbursement_status
        : undefined,
    purpose: row.purpose ?? undefined,
    loanKind:
      row.loan_kind === "fuel" || row.loan_kind === "stock" || row.loan_kind === "service"
        ? row.loan_kind
        : "financial",
    supplierPayload: asJsonObject(row.supplier_payload),
    supplierId: row.supplier_id ?? undefined,
    supplierRequestStatus: row.supplier_request_status ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewNote: row.review_note ?? undefined,
    frozenAt: row.frozen_at ?? undefined,
    frozenNote: row.frozen_note ?? undefined,
    penaltyWaivedAmount:
      row.penalty_waived_amount == null ? undefined : toNumber(row.penalty_waived_amount),
  };
}

function mapTransactionRow(row: any) {
  return {
    id: row.id,
    date: row.date,
    createdAt: row.created_at ?? undefined,
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

function mpesaRawTimestampValue(raw: Record<string, unknown> | null | undefined) {
  const transTime = String(raw?.TransTime ?? raw?.TransactionDate ?? "").trim();
  if (!/^\d{14}$/.test(transTime)) return undefined;
  const year = transTime.slice(0, 4);
  const month = transTime.slice(4, 6);
  const day = transTime.slice(6, 8);
  const hour = transTime.slice(8, 10);
  const minute = transTime.slice(10, 12);
  const second = transTime.slice(12, 14);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
}

function mpesaRawNumberValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const text = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : undefined;
}

function mpesaRawResultParameters(raw: Record<string, unknown> | null | undefined) {
  const result = asJsonObject(raw?.Result);
  const directParameters = asJsonObject(raw?.ResultParameters).ResultParameter;
  const nestedParameters = asJsonObject(result.ResultParameters).ResultParameter;
  const value = directParameters ?? nestedParameters;
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function mpesaRawAccountBalance(raw: Record<string, unknown> | null | undefined) {
  const directKeys = [
    "OrgAccountBalance",
    "AccountBalance",
    "AvailableBalance",
    "AvailableFunds",
    "B2CUtilityAccountAvailableFunds",
    "B2CWorkingAccountAvailableFunds",
    "WorkingAccountAvailableFunds",
    "UtilityAccountAvailableFunds",
  ];

  for (const key of directKeys) {
    const amount = mpesaRawNumberValue(raw?.[key]);
    if (amount !== undefined) return amount;
  }

  for (const [key, value] of Object.entries(raw ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (
      !normalizedKey.includes("orgaccountbalance") &&
      !normalizedKey.includes("accountbalance") &&
      !normalizedKey.includes("availablebalance") &&
      !normalizedKey.includes("availablefunds")
    ) {
      continue;
    }
    const amount = mpesaRawNumberValue(value);
    if (amount !== undefined) return amount;
  }

  for (const item of mpesaRawResultParameters(raw)) {
    const parameter = asJsonObject(item);
    const key = String(parameter.Key ?? parameter.Name ?? "").toLowerCase();
    if (
      !key.includes("orgaccountbalance") &&
      !key.includes("accountbalance") &&
      !key.includes("availablebalance") &&
      !key.includes("availablefunds")
    ) {
      continue;
    }
    const amount = mpesaRawNumberValue(parameter.Value);
    if (amount !== undefined) return amount;
  }

  return undefined;
}

function mpesaDisplayTypeLabel(value?: string | null) {
  switch (String(value ?? "").trim()) {
    case "deposit":
      return "deposit";
    case "share_purchase":
      return "share purchase";
    case "loan_repayment":
      return "loan repayment";
    case "fee_payment":
      return "fee payment";
    case "investor_contribution":
      return "investor contribution";
    case "purpose_pool":
      return "purpose pool";
    case "mpesa_unallocated":
      return "mpesa unallocated";
    case "withdrawal":
      return "withdrawal";
    case "loan_disbursement":
      return "loan disbursement";
    case "staff_payroll":
      return "staff payroll";
    default:
      return String(value ?? "mpesa");
  }
}

function payoutPurposeToTransactionType(value?: string | null) {
  switch (String(value ?? "").trim()) {
    case "loan_disbursement":
      return "loan_disbursement";
    case "staff_payroll":
      return "staff_payroll";
    default:
      return "withdrawal";
  }
}

async function listMpesaReceiptAllocationRows(supabaseAdmin: any) {
  try {
    return await fetchAllRows(() =>
      (supabaseAdmin as any)
        .from("mpesa_receipt_allocations")
        .select("*")
        .order("created_at", { ascending: true }),
    );
  } catch (error: any) {
    console.warn("Skipping M-Pesa receipt allocations while reading audit data", {
      message: error?.message ?? String(error ?? ""),
    });
    return [];
  }
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

async function redistributePurposePoolBalances(runtimeDb: any, actor: AuditActor) {
  const [policySettings, feePolicies, memberRows, activeLoanRows, purposePoolRows, penaltyRows] =
    await Promise.all([
      loadRuntimePolicySettings(runtimeDb),
      loadRuntimeFeePolicies(runtimeDb),
      fetchAllRows(() => runtimeDb.from("members").select("*").order("id")),
      fetchAllRows(() => runtimeDb.from("loans").select("member_id").eq("status", "active")),
      fetchAllRows(() =>
        runtimeDb
          .from("transactions")
          .select("member_id, amount, note")
          .eq("type", "fee_payment")
          .order("created_at", { ascending: true }),
      ),
      fetchAllRows(() =>
        runtimeDb.from("penalties").select("*").eq("status", "outstanding").order("date", {
          ascending: true,
        }),
      ),
    ]);

  const activeLoanMemberIds = new Set(
    activeLoanRows.map((row: { member_id?: string | null }) => String(row.member_id ?? "").trim()),
  );
  const purposePoolByMember = new Map<
    string,
    Array<{ amount: number | string | null; note?: string | null }>
  >();
  for (const row of purposePoolRows) {
    const memberId = String(row.member_id ?? "").trim();
    if (!memberId || !isPurposePoolFeeTransaction(row.note)) continue;
    const list = purposePoolByMember.get(memberId) ?? [];
    list.push({ amount: row.amount, note: row.note ?? null });
    purposePoolByMember.set(memberId, list);
  }

  const outstandingPenaltiesByMember = new Map<string, any[]>();
  for (const penalty of penaltyRows) {
    const memberId = String(penalty.member_id ?? "").trim();
    if (!memberId) continue;
    const list = outstandingPenaltiesByMember.get(memberId) ?? [];
    list.push(penalty);
    outstandingPenaltiesByMember.set(memberId, list);
  }

  let redistributedMembers = 0;
  let createdTransactions = 0;
  let penaltiesSettled = 0;
  const redistributionDate = new Date().toISOString().slice(0, 10);

  for (const member of memberRows) {
    const memberId = String(member.id ?? "").trim();
    if (!memberId) continue;

    const memberCategory = resolveMemberCategory(member.member_category, member.is_investor);
    if (isInvestorOnlyCategory(memberCategory)) continue;

    let purposePoolBalance = (purposePoolByMember.get(memberId) ?? []).reduce(
      (sum, row) => sum + toNumber(row.amount),
      0,
    );
    if (purposePoolBalance <= 0) continue;

    let nextSavingsBalance = toNumber(member.savings_balance);
    let nextShareUnits = toNumber(member.shares);
    const memberPatch: Record<string, unknown> = {};
    const txBatch: Array<{
      date?: string;
      type: string;
      amount: number;
      member_id?: string | null;
      by_staff?: string | null;
      note?: string | null;
      account?: string | null;
    }> = [];
    const penaltiesToSettle: string[] = [];
    const scenario = activeLoanMemberIds.has(memberId) ? "member_with_loan" : "member_without_loan";
    const account = formatMembershipNumber(memberId);

    const feeApplies = (key: string) => {
      const policy = feePolicies.find((row) => row.key === key);
      if (!policy) return false;
      return feePolicyAppliesToMember(
        policy,
        {
          id: memberId,
          joinedAt: member.joined_at ?? undefined,
          category: member.member_category ?? undefined,
          isInvestor: member.is_investor ?? undefined,
        },
        { hasActiveLoan: activeLoanMemberIds.has(memberId) },
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
        amount: feeApplies("membership") ? feePolicyAmount(feePolicies, "membership", 0) : 0,
        required: feeApplies("membership"),
      },
      card_fee: {
        key: "fee_card",
        label: "Membership card",
        amount: feeApplies("card") ? feePolicyAmount(feePolicies, "card", 0) : 0,
        required: feeApplies("card"),
      },
      sticker_fee: {
        key: "fee_sticker",
        label: "Sticker fee",
        amount: feeApplies("sticker") ? feePolicyAmount(feePolicies, "sticker", 0) : 0,
        required: memberNeedsStickerRow(member) && feeApplies("sticker"),
      },
    };

    const allocatePurposePoolOutflow = (amount: number, reason: string) => {
      if (amount <= 0) return 0;
      purposePoolBalance -= amount;
      txBatch.push({
        date: redistributionDate,
        type: "fee_payment",
        amount: -amount,
        member_id: memberId,
        by_staff: actor.id,
        account,
        note: `Purpose pool reallocation -> ${reason}`,
      });
      return amount;
    };

    const allocateSavings = (amount: number, note: string) => {
      if (amount <= 0) return;
      nextSavingsBalance += amount;
      memberPatch.savings_balance = nextSavingsBalance;
      txBatch.push({
        date: redistributionDate,
        type: "deposit",
        amount,
        member_id: memberId,
        by_staff: actor.id,
        account,
        note,
      });
    };

    const allocateShares = (amount: number, note: string) => {
      const wholeUnits = Math.floor(amount / SHARE_PRICE);
      const actualAmount = wholeUnits * SHARE_PRICE;
      if (actualAmount <= 0) return 0;
      nextShareUnits += wholeUnits;
      memberPatch.shares = nextShareUnits;
      txBatch.push({
        date: redistributionDate,
        type: "share_purchase",
        amount: actualAmount,
        member_id: memberId,
        by_staff: actor.id,
        account,
        note,
      });
      return actualAmount;
    };

    const settleFeeFromPurposePool = (fee: {
      key: "fee_membership" | "fee_card" | "fee_sticker";
      label: string;
      amount: number;
      required: boolean;
    }) => {
      if (!fee.required || fee.amount <= 0 || purposePoolBalance < fee.amount) return;
      if (member[fee.key] || memberPatch[fee.key]) return;
      allocatePurposePoolOutflow(fee.amount, fee.label.toLowerCase());
      memberPatch[fee.key] = true;
      txBatch.push({
        date: redistributionDate,
        type: "fee_payment",
        amount: fee.amount,
        member_id: memberId,
        by_staff: actor.id,
        account,
        note: `Policy redistribution: ${fee.label}`,
      });
    };

    const preprocessingSteps = waterfallRuleForScenario(scenario, policySettings).steps.filter(
      (step) =>
        step === "membership_fee" ||
        step === "card_fee" ||
        step === "sticker_fee" ||
        step === "penalties",
    );

    for (const step of preprocessingSteps) {
      if (purposePoolBalance <= 0) break;

      if (step === "membership_fee" || step === "card_fee" || step === "sticker_fee") {
        const fee = feeQueue[step];
        if (fee) settleFeeFromPurposePool(fee);
        continue;
      }

      if (step === "penalties") {
        for (const penalty of outstandingPenaltiesByMember.get(memberId) ?? []) {
          const amount = toNumber(penalty.amount);
          if (amount <= 0 || purposePoolBalance < amount) continue;
          allocatePurposePoolOutflow(amount, `penalty ${penalty.id}`);
          penaltiesToSettle.push(String(penalty.id));
        }
      }
    }

    const savingsGap = Math.max(
      0,
      policySettings.percentages.mandatorySavingsThreshold - nextSavingsBalance,
    );
    if (purposePoolBalance > 0 && savingsGap > 0) {
      const savingsTopUp = Math.min(purposePoolBalance, savingsGap);
      allocatePurposePoolOutflow(savingsTopUp, "mandatory savings threshold");
      allocateSavings(savingsTopUp, "Policy redistribution: mandatory savings threshold");
    }

    const shareGapAmount = Math.max(
      0,
      policySettings.percentages.mandatorySharesThreshold - nextShareUnits * SHARE_PRICE,
    );
    if (purposePoolBalance > 0 && shareGapAmount > 0) {
      const shareTopUp =
        Math.floor(Math.min(purposePoolBalance, shareGapAmount) / SHARE_PRICE) * SHARE_PRICE;
      if (shareTopUp > 0) {
        allocatePurposePoolOutflow(shareTopUp, "mandatory shares threshold");
        allocateShares(shareTopUp, "Policy redistribution: mandatory shares threshold");
      }
    }

    if (
      txBatch.length === 0 &&
      Object.keys(memberPatch).length === 0 &&
      penaltiesToSettle.length === 0
    ) {
      continue;
    }

    for (const row of txBatch) {
      await insertTransactionRow(row);
      createdTransactions += 1;
    }

    if (Object.keys(memberPatch).length > 0) {
      const { error: memberUpdateError } = await runtimeDb
        .from("members")
        .update(memberPatch as any)
        .eq("id", memberId);
      if (memberUpdateError) throw new Error(memberUpdateError.message);

      const carryoverPatch: Record<string, unknown> = {};
      if ("savings_balance" in memberPatch) {
        carryoverPatch.savings_balance = memberPatch.savings_balance;
      }
      if ("shares" in memberPatch) {
        carryoverPatch.share_units = memberPatch.shares;
      }
      if ("fee_membership" in memberPatch) {
        carryoverPatch.membership_fee_paid = memberPatch.fee_membership;
      }
      if ("fee_card" in memberPatch) {
        carryoverPatch.card_fee_paid = memberPatch.fee_card;
      }
      if ("fee_sticker" in memberPatch) {
        carryoverPatch.sticker_fee_paid = memberPatch.fee_sticker;
      }

      if (Object.keys(carryoverPatch).length > 0) {
        const { error: carryoverError } = await runtimeDb
          .from("member_carryover_profiles")
          .update(carryoverPatch as any)
          .eq("member_id", memberId);
        if (carryoverError) throw new Error(carryoverError.message);
      }
    }

    if (penaltiesToSettle.length > 0) {
      const { error: penaltyUpdateError } = await runtimeDb
        .from("penalties")
        .update({
          status: "paid",
          paid_from: "mpesa",
        })
        .in("id", penaltiesToSettle);
      if (penaltyUpdateError) throw new Error(penaltyUpdateError.message);
      penaltiesSettled += penaltiesToSettle.length;
    }

    await repairMemberFinancialInvariants({
      runtimeDb,
      memberId,
      actorId: actor.id,
      reason: "Purpose-pool redistribution",
    });

    redistributedMembers += 1;
  }

  return {
    redistributedMembers,
    createdTransactions,
    penaltiesSettled,
  };
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
    dataVersion: "",
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

const APP_DATA_CHANGE_TABLES = [
  { table: "staff", idColumn: "id" },
  { table: "members", idColumn: "id" },
  { table: "loans", idColumn: "id" },
  { table: "transactions", idColumn: "id" },
  { table: "petty_cash", idColumn: "id" },
  { table: "investors", idColumn: "id" },
  { table: "attendance", idColumn: "id" },
  { table: "appraisals", idColumn: "id" },
  { table: "field_visits", idColumn: "id" },
  { table: "followups", idColumn: "id" },
  { table: "penalties", idColumn: "id" },
  { table: "round_off", idColumn: "id" },
  { table: "staff_messages", idColumn: "id" },
  { table: "fee_policies", idColumn: "key" },
  { table: "policy_settings", idColumn: "key" },
  { table: "mpesa_events", idColumn: "id" },
  { table: "mpesa_receipt_allocations", idColumn: "id" },
  { table: "system_payout_requests", idColumn: "id" },
] as const;

async function latestTableChangeMarker(
  supabaseAdmin: any,
  table: string,
  idColumn: string,
  column: string,
) {
  const selectColumns =
    column === "updated_at" ? `${idColumn}, updated_at, created_at` : `${idColumn}, created_at`;
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(selectColumns)
    .order(column, { ascending: false })
    .limit(1);

  if (error) {
    if (isMissingRelationError(error)) return `${table}:missing`;
    if (column === "updated_at" && isMissingColumnError(error, "updated_at")) {
      return latestTableChangeMarker(supabaseAdmin, table, idColumn, "created_at");
    }
    if (isMissingColumnError(error, "created_at")) {
      const fallback = await supabaseAdmin
        .from(table)
        .select(idColumn)
        .order(idColumn, { ascending: false })
        .limit(1);
      if (fallback.error) {
        if (isMissingRelationError(fallback.error)) return `${table}:missing`;
        throw new Error(fallback.error.message);
      }
      return `${table}:${fallback.data?.[0]?.[idColumn] ?? ""}`;
    }
    throw new Error(error.message);
  }

  const row = data?.[0] ?? {};
  return `${table}:${row[idColumn] ?? ""}:${row.updated_at ?? row.created_at ?? ""}`;
}

async function getAppDataVersion(supabaseAdmin: any) {
  const markers = await Promise.all(
    APP_DATA_CHANGE_TABLES.map(({ table, idColumn }) =>
      latestTableChangeMarker(supabaseAdmin, table, idColumn, "updated_at"),
    ),
  );
  return markers.join("|");
}

async function buildAppData(version?: string) {
  const session = await getAuthSessionData();
  const base = emptyAppData();
  if (!session.authMode) return base;

  const supabaseAdmin = await requireSupabaseAdmin();
  const dataVersion = version ?? (await getAppDataVersion(supabaseAdmin));

  if (session.authMode === "member" && session.memberId) {
    const [
      memberResult,
      staffResult,
      investorRows,
      loansResult,
      transactionRows,
      penaltiesResult,
      roundOffResult,
      feePoliciesResult,
      policySettingsResult,
    ] = await Promise.all([
      supabaseAdmin.from("members").select("*").eq("id", session.memberId).maybeSingle(),
      supabaseAdmin.from("staff").select("id, name, role").order("id"),
      fetchAllRows(() =>
        supabaseAdmin
          .from("investors")
          .select("*")
          .eq("member_id", session.memberId)
          .order("joined_at", { ascending: false }),
      ),
      supabaseAdmin
        .from("loans")
        .select("*")
        .eq("member_id", session.memberId)
        .order("start_date", { ascending: false }),
      fetchAllRows(() =>
        supabaseAdmin
          .from("transactions")
          .select("*")
          .eq("member_id", session.memberId)
          .order("date", { ascending: false })
          .order("created_at", { ascending: false }),
      ),
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
      dataVersion,
      isAuthenticated: true,
      authMode: "member" as const,
      portalMemberId: memberResult.data.id,
      staff: (staffResult.data ?? []).map(mapStaffRow),
      members: [mapMemberRow(memberResult.data)],
      investors: investorRows.map(mapInvestorRow),
      loans: (loansResult.data ?? []).map(mapLoanRow),
      transactions: transactionRows.map(mapTransactionRow),
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
    transactionRows,
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
    fetchAllRows(() =>
      supabaseAdmin
        .from("transactions")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false }),
    ),
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
  const memberRows = (membersResult.data ?? []).filter(
    (row) => resolveMemberCategory(row.member_category, row.is_investor) !== "supplier",
  );

  return {
    ...base,
    dataVersion,
    isAuthenticated: true,
    authMode: "staff" as const,
    currentUser: staffRows.find((row) => row.id === actor.id),
    staff: staffRows,
    members: memberRows.map(mapMemberRow),
    loans: (loansResult.data ?? []).map(mapLoanRow),
    transactions: transactionRows.map(mapTransactionRow),
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
}

export const loadAppData = createServerFn({ method: "POST" }).handler(async () => {
  return buildAppData();
});

export const loadAppDataIfChanged = createServerFn({ method: "POST" })
  .inputValidator((data: { knownVersion?: string } | undefined) => ({
    knownVersion: String(data?.knownVersion ?? ""),
  }))
  .handler(async ({ data }) => {
    const session = await getAuthSessionData();
    if (!session.authMode) {
      return { changed: true, version: "", data: emptyAppData() };
    }

    const supabaseAdmin = await requireSupabaseAdmin();
    const version = await getAppDataVersion(supabaseAdmin);
    if (data.knownVersion && data.knownVersion === version) {
      return { changed: false, version };
    }

    return { changed: true, version, data: await buildAppData(version) };
  });

export const listMpesaReceiptAudit = createServerFn({ method: "POST" })
  .inputValidator((data: { memberId?: string; account?: string; query?: string } | undefined) => ({
    memberId: String(data?.memberId ?? "").trim() || undefined,
    account:
      String(data?.account ?? "")
        .trim()
        .toUpperCase() || undefined,
    query:
      String(data?.query ?? "")
        .trim()
        .toLowerCase() || undefined,
  }))
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    let scopedMemberId = data.memberId;
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      scopedMemberId = member.id;
    } else {
      await requireDirectorActor();
    }
    const supabaseAdmin = await requireSupabaseAdmin();

    const [events, allocations, linkedTransactions, members, payoutRequests] = await Promise.all([
      fetchAllRows(() =>
        supabaseAdmin
          .from("mpesa_events")
          .select("*")
          .in("kind", ["confirmation", "b2c_request", "b2c_result", "b2c_timeout"])
          .order("created_at", { ascending: false }),
      ),
      listMpesaReceiptAllocationRows(supabaseAdmin),
      fetchAllRows(() =>
        supabaseAdmin
          .from("transactions")
          .select(
            "id, type, amount, member_id, loan_id, note, account, payer_name, ref, created_at",
          )
          .eq("by_staff", MPESA_SYSTEM_STAFF_ID),
      ),
      fetchAllRows(() => supabaseAdmin.from("members").select("id, name")),
      fetchAllRows(() =>
        supabaseAdmin.from("system_payout_requests").select("*").order("created_at", {
          ascending: false,
        }),
      ),
    ]);

    const memberNames = new Map(
      members.map((row: any) => [String(row.id ?? "").trim(), String(row.name ?? "").trim()]),
    );
    const accountFilterAliases = data.account
      ? new Set(membershipAccountAliases(data.account))
      : null;
    const matchesAccountFilter = (account?: string | null, memberId?: string | null) => {
      if (!accountFilterAliases) return true;
      const aliases = membershipAccountAliases(String(account ?? ""));
      const memberAliases = memberId ? membershipAccountAliases(memberId) : [];
      return [...aliases, ...memberAliases].some((alias) => accountFilterAliases.has(alias));
    };
    const transactionsById = new Map(
      linkedTransactions.map((row: any) => [String(row.id ?? "").trim(), row]),
    );
    const confirmationRefs = new Set<string>();
    for (const event of events) {
      if (String(event.kind ?? "").trim() !== "confirmation") continue;
      const raw = asJsonObject(event.raw);
      const receiptRef = String(event.mpesa_ref ?? raw.TransID ?? raw.MpesaReceiptNumber ?? "")
        .trim()
        .toUpperCase();
      if (receiptRef) confirmationRefs.add(receiptRef);
    }

    const allocationsByEvent = new Map<string, any[]>();
    const allocationsByReceiptRef = new Map<string, any[]>();
    for (const row of allocations) {
      const eventId = String(row.event_id ?? "").trim();
      if (eventId) {
        const bucket = allocationsByEvent.get(eventId) ?? [];
        bucket.push(row);
        allocationsByEvent.set(eventId, bucket);
        continue;
      }

      const receiptRef = String(row.mpesa_ref ?? "").trim();
      if (!receiptRef) continue;
      const bucket = allocationsByReceiptRef.get(receiptRef) ?? [];
      bucket.push(row);
      allocationsByReceiptRef.set(receiptRef, bucket);
    }

    const b2cResultsByRef = new Map<string, any>();
    for (const event of events) {
      if (String(event.kind ?? "") !== "b2c_result") continue;
      const ref = String(event.mpesa_ref ?? "").trim();
      if (ref && !b2cResultsByRef.has(ref)) b2cResultsByRef.set(ref, event);
    }

    const rows: any[] = [];

    for (const event of events) {
      const kind = String(event.kind ?? "").trim();
      if (kind !== "confirmation") continue;

      const raw = asJsonObject(event.raw);
      const eventAllocations = (allocationsByEvent.get(String(event.id ?? "").trim()) ?? []).sort(
        (a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
      );
      const linkedTransaction = event.transaction_id
        ? transactionsById.get(String(event.transaction_id).trim())
        : null;
      const receiptAllocations =
        eventAllocations.length > 0 || !linkedTransaction
          ? eventAllocations
          : [
              {
                id: `linked-${linkedTransaction.id}`,
                transaction_id: linkedTransaction.id,
                allocation_type: linkedTransaction.type,
                amount: linkedTransaction.amount,
                note: linkedTransaction.note,
                member_id: linkedTransaction.member_id,
                loan_id: linkedTransaction.loan_id,
                created_at: linkedTransaction.created_at,
              },
            ];
      const primaryAllocation = receiptAllocations[0] ?? null;
      const memberId =
        String(
          primaryAllocation?.member_id ?? linkedTransaction?.member_id ?? event.account ?? "",
        ).trim() || undefined;
      const account = String(event.account ?? linkedTransaction?.account ?? raw.BillRefNumber ?? "")
        .trim()
        .toUpperCase();
      const receiptRef =
        String(event.mpesa_ref ?? raw.TransID ?? raw.MpesaReceiptNumber ?? "").trim() || undefined;
      const eventCreatedAt = String(event.created_at ?? "").trim();
      const exactAt = mpesaRawTimestampValue(raw) ?? (eventCreatedAt || undefined);
      const primaryType =
        String(primaryAllocation?.allocation_type ?? "").trim() || "mpesa_unallocated";
      const allocatedAmount = receiptAllocations.reduce(
        (sum, allocation) => sum + toNumber(allocation.amount),
        0,
      );
      const originalAmount = toNumber(event.amount) || allocatedAmount;
      const receiptRow = {
        id: String(event.id),
        source: "mpesa_receipt",
        direction: "in",
        status: memberId ? "matched" : "unallocated",
        type: primaryType,
        typeLabel: mpesaDisplayTypeLabel(primaryType),
        amount: originalAmount,
        originalAmount,
        account,
        memberId,
        memberName:
          memberNames.get(memberId ?? "") ||
          String(event.payer_name ?? "").trim() ||
          String(raw.FirstName ?? "").trim() ||
          undefined,
        payerName: String(event.payer_name ?? "").trim() || undefined,
        phone: String(event.phone ?? "").trim() || undefined,
        mpesaRef: receiptRef,
        paybillBalance: mpesaRawAccountBalance(raw),
        businessShortCode: String(raw.BusinessShortCode ?? raw.ShortCode ?? "").trim() || undefined,
        exactReceivedAt: exactAt,
        createdAt: String(event.created_at ?? "").trim() || exactAt,
        note:
          String(primaryAllocation?.note ?? "").trim() ||
          String(raw.TransactionType ?? "Pay Bill").trim(),
        allocationCount: receiptAllocations.length,
        allocations: receiptAllocations.map((allocation) => ({
          id: String(allocation.id),
          transactionId: allocation.transaction_id ? String(allocation.transaction_id) : undefined,
          type: String(allocation.allocation_type ?? "").trim(),
          typeLabel: mpesaDisplayTypeLabel(allocation.allocation_type),
          amount: toNumber(allocation.amount),
          note: String(allocation.note ?? "").trim() || undefined,
          memberId: allocation.member_id ? String(allocation.member_id) : undefined,
          loanId: allocation.loan_id ? String(allocation.loan_id) : undefined,
        })),
        transactionIds: Array.from(
          new Set([
            ...receiptAllocations
              .map((allocation) => String(allocation.transaction_id ?? "").trim())
              .filter(Boolean),
            String(event.transaction_id ?? "").trim(),
          ]),
        ).filter(Boolean),
      };

      if (scopedMemberId && receiptRow.memberId !== scopedMemberId) continue;
      if (!matchesAccountFilter(receiptRow.account, receiptRow.memberId)) continue;
      if (data.query) {
        const haystack = [
          receiptRow.memberName,
          receiptRow.account,
          receiptRow.mpesaRef,
          receiptRow.payerName,
          receiptRow.typeLabel,
          receiptRow.note,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(data.query)) continue;
      }

      rows.push(receiptRow);
    }

    for (const [receiptRef, receiptAllocations] of allocationsByReceiptRef.entries()) {
      if (confirmationRefs.has(receiptRef.toUpperCase())) continue;

      const eventAllocations = receiptAllocations.sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
      );
      const primaryAllocation = eventAllocations[0] ?? null;
      const memberId = String(primaryAllocation?.member_id ?? "").trim() || undefined;
      const primaryType =
        String(primaryAllocation?.allocation_type ?? "").trim() || "mpesa_unallocated";
      const originalAmount = eventAllocations.reduce(
        (sum, allocation) => sum + toNumber(allocation.amount),
        0,
      );
      const createdAt = String(primaryAllocation?.created_at ?? "").trim() || undefined;
      const receiptRow = {
        id: `allocation-receipt-${receiptRef}`,
        source: "mpesa_receipt",
        direction: "in",
        status: memberId ? "matched" : "unallocated",
        type: primaryType,
        typeLabel: mpesaDisplayTypeLabel(primaryType),
        amount: originalAmount,
        originalAmount,
        account: memberId ?? "-",
        memberId,
        memberName: memberNames.get(memberId ?? "") || undefined,
        payerName: undefined,
        phone: undefined,
        mpesaRef: receiptRef,
        paybillBalance: undefined,
        businessShortCode: undefined,
        exactReceivedAt: createdAt,
        createdAt,
        note:
          String(primaryAllocation?.note ?? "").trim() ||
          "Backfilled from current M-Pesa ledger rows",
        allocationCount: eventAllocations.length,
        allocations: eventAllocations.map((allocation) => ({
          id: String(allocation.id),
          transactionId: allocation.transaction_id ? String(allocation.transaction_id) : undefined,
          type: String(allocation.allocation_type ?? "").trim(),
          typeLabel: mpesaDisplayTypeLabel(allocation.allocation_type),
          amount: toNumber(allocation.amount),
          note: String(allocation.note ?? "").trim() || undefined,
          memberId: allocation.member_id ? String(allocation.member_id) : undefined,
          loanId: allocation.loan_id ? String(allocation.loan_id) : undefined,
        })),
        transactionIds: eventAllocations
          .map((allocation) => String(allocation.transaction_id ?? "").trim())
          .filter(Boolean),
      };

      if (scopedMemberId && receiptRow.memberId !== scopedMemberId) continue;
      if (!matchesAccountFilter(receiptRow.account, receiptRow.memberId)) continue;
      if (data.query) {
        const haystack = [
          receiptRow.memberName,
          receiptRow.account,
          receiptRow.mpesaRef,
          receiptRow.typeLabel,
          receiptRow.note,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(data.query)) continue;
      }

      rows.push(receiptRow);
    }

    for (const request of payoutRequests) {
      const account = String(request.account_reference ?? request.member_id ?? "").trim();
      const memberId = String(request.member_id ?? "").trim() || undefined;
      const purposeType = payoutPurposeToTransactionType(request.purpose);
      const resultEvent =
        b2cResultsByRef.get(String(request.conversation_id ?? "").trim()) ??
        b2cResultsByRef.get(String(request.originator_conversation_id ?? "").trim()) ??
        null;
      const receiptRef =
        String(request.mpesa_ref ?? "").trim() ||
        String(resultEvent?.mpesa_ref ?? "").trim() ||
        String(request.conversation_id ?? "").trim() ||
        String(request.originator_conversation_id ?? "").trim() ||
        undefined;
      const payoutCreatedAt = String(resultEvent?.created_at ?? request.created_at ?? "").trim();
      const resultRaw = asJsonObject(resultEvent?.raw);
      const exactAt = mpesaRawTimestampValue(resultRaw) ?? (payoutCreatedAt || undefined);
      const payoutRow = {
        id: `payout-${request.id}`,
        source: "mpesa_payout",
        direction: "out",
        status: String(request.status ?? "").trim() || "requested",
        type: purposeType,
        typeLabel: mpesaDisplayTypeLabel(purposeType),
        amount: toNumber(request.amount),
        originalAmount: toNumber(request.amount),
        account,
        memberId,
        memberName:
          memberNames.get(memberId ?? "") ||
          String(request.receiver_staff_id ?? "").trim() ||
          undefined,
        payerName: undefined,
        phone: String(request.phone ?? "").trim() || undefined,
        mpesaRef: receiptRef,
        paybillBalance: mpesaRawAccountBalance(resultRaw),
        businessShortCode: undefined,
        exactReceivedAt: exactAt,
        createdAt: String(request.created_at ?? "").trim() || exactAt,
        note:
          String(request.remarks ?? "").trim() ||
          String(request.purpose ?? "")
            .replace(/_/g, " ")
            .trim() ||
          undefined,
        allocationCount: 0,
        allocations: [],
        transactionIds: request.transaction_id ? [String(request.transaction_id)] : [],
      };

      if (scopedMemberId && payoutRow.memberId !== scopedMemberId) continue;
      if (!matchesAccountFilter(payoutRow.account, payoutRow.memberId)) continue;
      if (data.query) {
        const haystack = [
          payoutRow.memberName,
          payoutRow.account,
          payoutRow.mpesaRef,
          payoutRow.typeLabel,
          payoutRow.note,
          payoutRow.status,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(data.query)) continue;
      }

      rows.push(payoutRow);
    }

    rows.sort((a, b) =>
      String(b.exactReceivedAt ?? b.createdAt ?? "").localeCompare(
        String(a.exactReceivedAt ?? a.createdAt ?? ""),
      ),
    );

    return rows;
  });

export const triggerPurposePoolRedistributionRecord = createServerFn({ method: "POST" }).handler(
  async () => {
    const actor = await requireDirectorActor();
    const runtimeDb = await requireSupabaseAdmin();
    const redistribution = await redistributePurposePoolBalances(runtimeDb, actor);
    await auditAction({
      actor,
      action: "policy.redistribution.triggered",
      targetType: "policy_settings",
      summary: `${actor.name} triggered manual purpose-pool redistribution`,
      details: redistribution,
    });
    return { ok: true, redistribution };
  },
);

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
      memberTags?: MemberCategory[];
      memberTags?: MemberCategory[];
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
      email: data?.email?.trim().toLowerCase() || undefined,
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
      category: resolveMemberCategory(data?.category),
      memberTags: normalizeMemberTags(data?.memberTags, data?.category),
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
    const memberTags = normalizeMemberTags(data.memberTags, memberCategory);
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
    const investorOnly = memberCategory === "investor" && !memberTags.includes("member");
    const shares = investorOnly ? 0 : data.shares;
    const savingsBalance = investorOnly ? 0 : data.savingsBalance;
    const policySettings = await loadRuntimePolicySettings(supabaseAdmin);
    if (!investorOnly) {
      assertMandatorySavingsWithinThreshold({ amount: savingsBalance, settings: policySettings });
      assertShareBasketWithinThreshold({ shares, settings: policySettings });
    }

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
      member_tags: memberTags,
      is_investor: memberTags.includes("investor") || isInvestorCategory(memberCategory),
    });
    if (memberError) throw new Error(memberError.message);

    if (memberTags.includes("investor") || isInvestorCategory(memberCategory)) {
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

export const updateMemberRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId: string;
      nextMemberId?: string;
      name: string;
      phone: string;
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
      memberTags?: MemberCategory[];
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      nextMemberId: data?.nextMemberId?.trim() || undefined,
      name: String(data?.name ?? "").trim(),
      phone: String(data?.phone ?? "").trim(),
      status: data?.status ?? "active",
      shares: Number(data?.shares ?? 0),
      savingsBalance: Number(data?.savingsBalance ?? 0),
      firstName: data?.firstName?.trim() || undefined,
      secondName: data?.secondName?.trim() || undefined,
      thirdName: data?.thirdName?.trim() || undefined,
      dob: data?.dob?.trim() || undefined,
      gender: data?.gender,
      email: data?.email?.trim().toLowerCase() || undefined,
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
      category: resolveMemberCategory(data?.category),
      memberTags: normalizeMemberTags(data?.memberTags, data?.category),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.memberId) throw new Error("Member id is required.");
    if (!data.name) throw new Error("Member name is required.");
    if (!data.phone) throw new Error("Member phone is required.");
    if (!isValidLocalKenyanPhone(data.phone)) {
      throw new Error("Use a local phone number starting with 07 or 01.");
    }

    const supabaseAdmin = await requireSupabaseAdmin();
    const phone = toLocalKenyanPhone(data.phone);
    const normalizedPhone = toComparableKenyanPhone(phone);
    const memberCategory = resolveMemberCategory(data.category);
    const memberTags = normalizeMemberTags(data.memberTags, memberCategory);
    const lastName = [data.secondName, data.thirdName].filter(Boolean).join(" ").trim() || null;
    const currentMemberId = String(data.memberId).trim();
    const requestedNextMemberId = data.nextMemberId
      ? normalizeMembershipNumber(data.nextMemberId)
      : undefined;
    if (data.nextMemberId && !requestedNextMemberId) {
      throw new Error("Membership number must follow the SBC0001K format.");
    }
    const targetMemberId =
      requestedNextMemberId && requestedNextMemberId !== currentMemberId
        ? requestedNextMemberId
        : currentMemberId;
    const targetMembershipNumber = formatMembershipNumber(targetMemberId);
    const hasShop = data.businessPermanence === "permanent";
    const investorOnly = memberCategory === "investor" && !memberTags.includes("member");
    const nextShares = investorOnly ? 0 : data.shares;
    const nextSavingsBalance = investorOnly ? 0 : data.savingsBalance;

    const { data: currentMember, error: currentMemberError } = await supabaseAdmin
      .from("members")
      .select("*")
      .eq("id", currentMemberId)
      .maybeSingle();
    if (currentMemberError) throw new Error(currentMemberError.message);
    if (!currentMember) throw new Error("The selected member could not be found.");

    const { data: existingMembers, error: existingMembersError } = await supabaseAdmin
      .from("members")
      .select("id, phone, old_system_id");
    if (existingMembersError) throw new Error(existingMembersError.message);

    const duplicate = (existingMembers ?? []).find((row) => {
      if (row.id === currentMemberId) return false;
      const samePhone = toComparableKenyanPhone(row.phone) === normalizedPhone;
      const sameMemberId =
        targetMemberId !== currentMemberId &&
        membershipIdCandidates(targetMemberId).some((candidate) => candidate === row.id);
      const sameLegacyId =
        data.oldSystemId &&
        row.old_system_id &&
        row.old_system_id.trim().toUpperCase() === data.oldSystemId.trim().toUpperCase();
      return samePhone || sameLegacyId || sameMemberId;
    });
    if (duplicate) {
      throw new Error(`Member already exists in the database as ${duplicate.id}.`);
    }

    const policySettings = await loadRuntimePolicySettings(supabaseAdmin);
    if (!investorOnly) {
      assertMandatorySavingsWithinThreshold({
        amount: nextSavingsBalance,
        settings: policySettings,
      });
      assertShareBasketWithinThreshold({
        shares: nextShares,
        shareReserveBalance: currentMember.share_reserve_balance,
        settings: policySettings,
      });
    }

    const memberPayload = {
      name: data.name,
      phone,
      status: data.status,
      shares: nextShares,
      savings_balance: nextSavingsBalance,
      share_reserve_balance: investorOnly ? 0 : currentMember.share_reserve_balance,
      fee_has_shop: hasShop,
      first_name: data.firstName ?? null,
      second_name: data.secondName ?? null,
      third_name: data.thirdName ?? null,
      last_name: lastName,
      dob: data.dob ?? null,
      gender: data.gender ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      city: data.city ?? null,
      county: data.county ?? null,
      village: data.village ?? null,
      old_system_id: data.oldSystemId ?? currentMember.old_system_id ?? null,
      business_name: data.businessName ?? null,
      business_type: data.businessType ?? null,
      business_permanence: data.businessPermanence ?? null,
      business_address: data.businessAddress ?? null,
      field_officer_id: data.fieldOfficerId ?? null,
      member_category: memberCategory,
      member_tags: memberTags,
      is_investor: memberTags.includes("investor") || isInvestorCategory(memberCategory),
    };

    const syncSelectedMemberFeePolicies = async (fromMemberId: string, toMemberId: string) => {
      const { data: feePolicies, error: feePoliciesError } = await supabaseAdmin
        .from("fee_policies")
        .select("key, selected_member_ids")
        .contains("selected_member_ids", [fromMemberId]);
      if (feePoliciesError) {
        if (isMissingColumnError(feePoliciesError, "selected_member_ids")) return;
        throw new Error(feePoliciesError.message);
      }

      for (const policy of feePolicies ?? []) {
        const nextIds = uniqueTextValues(
          (policy.selected_member_ids ?? []).map((memberId: string) =>
            memberId === fromMemberId ? toMemberId : memberId,
          ),
        ).sort();
        const { error } = await supabaseAdmin
          .from("fee_policies")
          .update({ selected_member_ids: nextIds })
          .eq("key", policy.key);
        if (error) {
          if (isMissingColumnError(error, "selected_member_ids")) return;
          throw new Error(error.message);
        }
      }
    };

    const syncMemberBackedInvestor = async (memberId: string) => {
      if (!memberTags.includes("investor") && !isInvestorCategory(memberCategory) && !currentMember.investor_id) return;

      let investorId = currentMember.investor_id ?? null;
      if ((memberTags.includes("investor") || isInvestorCategory(memberCategory)) && !investorId) {
        const investor = await ensureInvestorForMember({
          id: memberId,
          name: data.name,
          phone,
          joined_at: currentMember.joined_at,
          investor_id: currentMember.investor_id ?? null,
          is_investor: true,
          member_category: memberCategory,
        });
        investorId = investor?.id ?? null;
      }

      if (!investorId) return;

      const { error: investorError } = await supabaseAdmin
        .from("investors")
        .update({
          name: data.name,
          phone,
          member_id: memberId,
        })
        .eq("id", investorId);
      if (investorError) throw new Error(investorError.message);

      const { error: memberLinkError } = await supabaseAdmin
        .from("members")
        .update({ investor_id: investorId })
        .eq("id", memberId);
      if (memberLinkError) throw new Error(memberLinkError.message);
    };

    if (targetMemberId !== currentMemberId) {
      const targetMemberPayload = {
        id: targetMemberId,
        joined_at: currentMember.joined_at,
        fee_membership: currentMember.fee_membership,
        fee_card: currentMember.fee_card,
        fee_sticker: currentMember.fee_sticker,
        fee_first_upfront_paid: currentMember.fee_first_upfront_paid,
        investor_id: currentMember.investor_id ?? null,
        savings_only: currentMember.savings_only,
        created_at: currentMember.created_at,
        ...memberPayload,
      };
      const { error: insertError } = await supabaseAdmin
        .from("members")
        .insert(targetMemberPayload);
      if (insertError) {
        if (insertError.code !== "23505") throw new Error(insertError.message);

        const { data: existingTarget, error: existingTargetError } = await supabaseAdmin
          .from("members")
          .select("id, name, phone")
          .eq("id", targetMemberId)
          .maybeSingle();
        if (existingTargetError) throw new Error(existingTargetError.message);

        const existingComparablePhone = toComparableKenyanPhone(existingTarget?.phone);
        const nextComparablePhone = toComparableKenyanPhone(phone);
        const samePhone =
          !!existingComparablePhone &&
          !!nextComparablePhone &&
          existingComparablePhone === nextComparablePhone;
        const sameName =
          String(existingTarget?.name ?? "")
            .trim()
            .toLowerCase() ===
          String(currentMember.name ?? data.name)
            .trim()
            .toLowerCase();
        if (!existingTarget || (!samePhone && !sameName)) {
          throw new Error(
            `Membership number ${targetMembershipNumber} already belongs to another member.`,
          );
        }

        const { error: updateTargetError } = await supabaseAdmin
          .from("members")
          .update(targetMemberPayload)
          .eq("id", targetMemberId);
        if (updateTargetError) throw new Error(updateTargetError.message);
      }

      const moveMemberReference = async (table: string) => {
        const { error } = await supabaseAdmin
          .from(table)
          .update({ member_id: targetMemberId } as any)
          .eq("member_id", currentMemberId);
        if (error) throw new Error(error.message);
      };
      const moveOptionalMemberReference = async (table: string) => {
        const { error } = await supabaseAdmin
          .from(table)
          .update({ member_id: targetMemberId } as any)
          .eq("member_id", currentMemberId);
        if (error && !isMissingRelationError(error)) throw new Error(error.message);
      };
      const mergeCarryoverProfileReference = async () => {
        const { data: sourceProfile, error: sourceProfileError } = await supabaseAdmin
          .from("member_carryover_profiles")
          .select("*")
          .eq("member_id", currentMemberId)
          .maybeSingle();
        if (sourceProfileError) {
          if (isMissingRelationError(sourceProfileError)) return;
          throw new Error(sourceProfileError.message);
        }
        if (!sourceProfile) return;

        const { error: upsertProfileError } = await supabaseAdmin
          .from("member_carryover_profiles")
          .upsert({ ...sourceProfile, member_id: targetMemberId } as any);
        if (upsertProfileError) throw new Error(upsertProfileError.message);

        const { error: deleteProfileError } = await supabaseAdmin
          .from("member_carryover_profiles")
          .delete()
          .eq("member_id", currentMemberId);
        if (deleteProfileError) throw new Error(deleteProfileError.message);
      };

      await moveMemberReference("investors");
      await moveMemberReference("loans");
      await moveMemberReference("transactions");
      await moveMemberReference("appraisals");
      await moveMemberReference("field_visits");
      await moveMemberReference("followups");
      await moveMemberReference("penalties");
      await moveMemberReference("round_off");
      await moveMemberReference("support_threads");
      await mergeCarryoverProfileReference();
      await moveMemberReference("member_carryover_loans");
      await moveOptionalMemberReference("system_payout_requests");

      const currentAccountAliases = membershipAccountAliases(currentMemberId);
      for (const accountAlias of currentAccountAliases) {
        const { error: transactionAccountError } = await supabaseAdmin
          .from("transactions")
          .update({ account: targetMembershipNumber })
          .eq("member_id", targetMemberId)
          .eq("account", accountAlias);
        if (transactionAccountError) throw new Error(transactionAccountError.message);

        const { error: pendingMpesaAccountError } = await supabaseAdmin
          .from("mpesa_events")
          .update({ account: targetMembershipNumber })
          .eq("account", accountAlias);
        if (pendingMpesaAccountError) throw new Error(pendingMpesaAccountError.message);
      }

      await syncSelectedMemberFeePolicies(currentMemberId, targetMemberId);

      const { error: deleteError } = await supabaseAdmin
        .from("members")
        .delete()
        .eq("id", currentMemberId);
      if (deleteError) throw new Error(deleteError.message);
    } else {
      const { error } = await supabaseAdmin
        .from("members")
        .update(memberPayload)
        .eq("id", currentMemberId);
      if (error) throw new Error(error.message);
    }

    const finalMemberId = targetMemberId;

    const { error: supportThreadError } = await supabaseAdmin
      .from("support_threads")
      .update({
        member_name: data.name,
      })
      .eq("member_id", finalMemberId);
    if (supportThreadError) throw new Error(supportThreadError.message);

    await syncMemberBackedInvestor(finalMemberId);

    await auditAction({
      actor,
      action: "member.updated",
      targetType: "member",
      targetId: finalMemberId,
      summary: `${actor.name} updated member ${finalMemberId}`,
      details: {
        membershipNumber: formatMembershipNumber(finalMemberId),
        previousMembershipNumber:
          finalMemberId !== currentMemberId ? formatMembershipNumber(currentMemberId) : null,
        category: memberCategory,
        fieldOfficerId: data.fieldOfficerId ?? null,
        status: data.status,
        phone,
        shares: nextShares,
        savingsBalance: nextSavingsBalance,
        businessName: data.businessName ?? null,
        businessPermanence: data.businessPermanence ?? null,
      },
    });
    return { id: finalMemberId };
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
      email: data?.email?.trim().toLowerCase() || undefined,
      phone: data?.phone?.trim() || undefined,
      nationalId: data?.nationalId?.trim() || undefined,
      address: data?.address?.trim() || undefined,
      notes: data?.notes?.trim() || undefined,
      photo: data?.photo || undefined,
      tempPassword: data?.tempPassword?.trim() || undefined,
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
      .ilike("email", data.email)
      .limit(1)
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
    const normalizedTempPassword = data.patch.tempPassword?.trim();
    if (normalizedTempPassword && normalizedTempPassword.length < 6) {
      throw new Error("Temporary password must be at least 6 characters.");
    }
    if (data.id === actor.id && data.patch.role && data.patch.role !== "director") {
      throw new Error("You cannot remove your own director access.");
    }
    const supabaseAdmin = await requireSupabaseAdmin();
    const patch = data.patch;
    const hasPatch = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
    const updates: Record<string, unknown> = {};
    if (hasPatch("name")) updates.name = patch.name?.trim() || undefined;
    if (hasPatch("role")) updates.role = patch.role as never;
    if (hasPatch("email")) updates.email = patch.email?.trim().toLowerCase() || undefined;
    if (hasPatch("phone")) updates.phone = patch.phone?.trim() || null;
    if (hasPatch("nationalId")) updates.national_id = patch.nationalId?.trim() || null;
    if (hasPatch("address")) updates.address = patch.address?.trim() || null;
    if (hasPatch("notes")) updates.notes = patch.notes?.trim() || null;
    if (hasPatch("photo")) updates.photo = patch.photo || null;
    if (normalizedTempPassword) updates.temp_password = hashPassword(normalizedTempPassword);
    if (hasPatch("canMarkAttendance")) {
      updates.can_mark_attendance = patch.role === "director" ? true : patch.canMarkAttendance;
    }
    if (hasPatch("fingerprintEnrolled")) {
      updates.fingerprint_enrolled = patch.fingerprintEnrolled;
    }
    if (Object.keys(updates).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("staff").update(updates).eq("id", data.id);
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

function makeStaffTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let suffix = "";
  for (let index = 0; index < 10; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `Sauti!${suffix}`;
}

export const resetStaffPasswordRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({
    id: String(data?.id ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.id) throw new Error("Staff id is required.");
    const supabaseAdmin = await requireSupabaseAdmin();
    const { data: staffRow, error: staffError } = await supabaseAdmin
      .from("staff")
      .select("id, name, email, role")
      .eq("id", data.id)
      .maybeSingle();
    if (staffError) throw new Error(staffError.message);
    if (!staffRow) throw new Error("Staff account not found.");

    const tempPassword = makeStaffTemporaryPassword();
    const { error } = await supabaseAdmin
      .from("staff")
      .update({ temp_password: hashPassword(tempPassword) })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: "staff.password_reset",
      targetType: "staff",
      targetId: data.id,
      summary: `${actor.name} reset staff password for ${staffRow.name}`,
      details: {
        email: staffRow.email,
        role: staffRow.role,
      },
    });

    return { tempPassword };
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
      financedPrincipalAmount?: number;
      netDisbursedAmount?: number;
      processingFeeAmount?: number;
      insuranceFeeAmount?: number;
      transactionFeeAmount?: number;
      processingFeeMode?: "upfront" | "financed";
      insuranceFeeMode?: "upfront" | "financed";
      disbursementStatus?: "not_requested" | "requested" | "paid" | "failed" | "timeout";
      rate?: number;
      termMonths?: number;
      termDays?: number;
      startDate?: string;
      status?: "pending" | "active" | "closed" | "defaulted" | "rejected";
      officerId?: string;
      purpose?: string;
      loanKind?: "financial" | "fuel" | "stock" | "service";
      supplierPayload?: Record<string, unknown>;
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      principal: Number(data?.principal ?? 0),
      approvedAmount: data?.approvedAmount == null ? undefined : Number(data.approvedAmount ?? 0),
      financedPrincipalAmount:
        data?.financedPrincipalAmount == null
          ? undefined
          : Number(data.financedPrincipalAmount ?? 0),
      netDisbursedAmount:
        data?.netDisbursedAmount == null ? undefined : Number(data.netDisbursedAmount ?? 0),
      processingFeeAmount:
        data?.processingFeeAmount == null ? undefined : Number(data.processingFeeAmount ?? 0),
      insuranceFeeAmount:
        data?.insuranceFeeAmount == null ? undefined : Number(data.insuranceFeeAmount ?? 0),
      transactionFeeAmount:
        data?.transactionFeeAmount == null ? undefined : Number(data.transactionFeeAmount ?? 0),
      processingFeeMode: data?.processingFeeMode === "upfront" ? "upfront" : "financed",
      insuranceFeeMode: data?.insuranceFeeMode === "upfront" ? "upfront" : "financed",
      disbursementStatus:
        data?.disbursementStatus === "requested" ||
        data?.disbursementStatus === "paid" ||
        data?.disbursementStatus === "failed" ||
        data?.disbursementStatus === "timeout"
          ? data.disbursementStatus
          : "not_requested",
      rate: Number(data?.rate ?? 0),
      termMonths: Number(data?.termMonths ?? 0),
      termDays: data?.termDays == null ? undefined : Number(data.termDays),
      startDate: data?.startDate?.trim() || new Date().toISOString().slice(0, 10),
      status: data?.status ?? "pending",
      officerId: data?.officerId?.trim() || undefined,
      purpose: data?.purpose?.trim() || undefined,
      loanKind:
        data?.loanKind === "fuel" || data?.loanKind === "stock" || data?.loanKind === "service"
          ? data.loanKind
          : "financial",
      supplierPayload: asJsonObject(data?.supplierPayload),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.memberId) throw new Error("Member is required.");
    if (data.principal <= 0) throw new Error("Loan principal must be above zero.");

    const supabaseAdmin = await requireSupabaseAdmin();
    await assertNoDuplicateOpenLoanKind(supabaseAdmin, {
      memberId: data.memberId,
      loanKind: data.loanKind,
    });
    const id = await nextPrefixedId("loans", "L", 1001);
    const netAmount =
      data.status === "active" ? (data.approvedAmount ?? data.principal) : data.approvedAmount;
    const policySettings = await loadRuntimePolicySettings(supabaseAdmin);
    const pricing = computeLoanPricing({
      netAmount: netAmount ?? data.netDisbursedAmount ?? data.principal,
      ratePct: data.rate,
      termDays: data.termDays,
      termMonths: data.termMonths,
      processingFeeMode: data.processingFeeMode,
      insuranceFeeMode: data.insuranceFeeMode,
      loanKind: data.loanKind,
      settings: policySettings,
    });
    const supplierBacked = data.loanKind !== "financial";
    const officerId = data.officerId ?? actor.id;
    const { error } = await supabaseAdmin.from("loans").insert({
      id,
      member_id: data.memberId,
      principal: data.principal,
      approved_amount: netAmount ?? null,
      financed_principal_amount: supplierBacked
        ? (netAmount ?? data.principal)
        : (data.financedPrincipalAmount ?? pricing.financedPrincipal ?? data.principal),
      net_disbursed_amount: supplierBacked
        ? 0
        : (data.netDisbursedAmount ?? netAmount ?? data.principal),
      processing_fee_amount: supplierBacked ? 0 : (data.processingFeeAmount ?? pricing.processing),
      insurance_fee_amount: supplierBacked ? 0 : (data.insuranceFeeAmount ?? pricing.insurance),
      transaction_fee_amount: supplierBacked
        ? 0
        : (data.transactionFeeAmount ?? pricing.transactionFee),
      processing_fee_mode: supplierBacked ? "upfront" : data.processingFeeMode,
      insurance_fee_mode: supplierBacked ? "upfront" : data.insuranceFeeMode,
      disbursement_status:
        data.status === "active"
          ? "paid"
          : ((data.disbursementStatus as string | undefined) ?? "not_requested"),
      rate: supplierBacked ? 0 : data.rate,
      term_months: data.termMonths,
      term_days: data.termDays ?? null,
      start_date: data.startDate,
      status: data.status as never,
      officer_id: officerId,
      paid: 0,
      purpose: data.purpose ?? null,
      loan_kind: data.loanKind,
      supplier_payload: data.supplierPayload,
      supplier_request_status: data.loanKind === "financial" ? null : "draft",
    });
    if (error) throw new Error(error.message);

    if (data.status === "active") {
      await insertTransactionRow({
        date: data.startDate,
        type: "loan_disbursement",
        amount: netAmount ?? data.principal,
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
        approvedAmount: netAmount ?? null,
        financedPrincipalAmount: data.financedPrincipalAmount ?? pricing.financedPrincipal,
        processingFeeMode: data.processingFeeMode,
        insuranceFeeMode: data.insuranceFeeMode,
        status: data.status,
        officerId,
        termDays: data.termDays ?? null,
        termMonths: data.termMonths,
        purpose: clipAuditText(data.purpose, 160),
        loanKind: data.loanKind,
        supplierPayload: data.supplierPayload,
      },
    });
    return { id };
  });

type SystemPayoutPurpose = "loan_disbursement" | "staff_payroll";

function isInflowTransactionType(type: string) {
  return (
    type === "deposit" ||
    type === "loan_repayment" ||
    type === "share_purchase" ||
    type === "investor_contribution" ||
    type === "fee_payment" ||
    type === "mpesa_unallocated"
  );
}

function isOutflowTransactionType(type: string) {
  return (
    type === "withdrawal" ||
    type === "loan_disbursement" ||
    type === "petty_cash" ||
    type === "staff_payroll"
  );
}

async function computeSystemCashSummary(runtimeDb: any) {
  const [transactionRows, pendingPayoutRows] = await Promise.all([
    fetchAllRows(() => runtimeDb.from("transactions").select("type, amount")),
    fetchAllRows(() =>
      runtimeDb.from("system_payout_requests").select("amount").eq("status", "requested"),
    ),
  ]);

  const inflow = transactionRows
    .filter((row: { type?: string | null }) => isInflowTransactionType(String(row.type ?? "")))
    .reduce(
      (sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount),
      0,
    );
  const outflow = transactionRows
    .filter((row: { type?: string | null }) => isOutflowTransactionType(String(row.type ?? "")))
    .reduce(
      (sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount),
      0,
    );
  const pending = pendingPayoutRows.reduce(
    (sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount),
    0,
  );

  return {
    inflow,
    outflow,
    pending,
    available: inflow - outflow - pending,
  };
}

async function createSystemPayoutRequest(
  runtimeDb: any,
  args: {
    purpose: SystemPayoutPurpose;
    amount: number;
    phone: string;
    accountReference: string;
    receiverName: string;
    remarks?: string;
    requestedBy: AuditActor;
    loanId?: string;
    memberId?: string;
    receiverStaffId?: string;
    targetId?: string;
    raw?: Record<string, unknown>;
  },
) {
  const payout = await requestMpesaWithdrawalPayout({
    amount: args.amount,
    phone: args.phone,
    accountReference: args.accountReference,
    memberName: args.receiverName,
    remarks: args.remarks,
  });

  const id = makeId("SPR");
  const { error } = await runtimeDb.from("system_payout_requests").insert({
    id,
    purpose: args.purpose,
    target_id: args.targetId ?? args.loanId ?? args.receiverStaffId ?? null,
    member_id: args.memberId ?? null,
    loan_id: args.loanId ?? null,
    receiver_staff_id: args.receiverStaffId ?? null,
    phone: args.phone,
    amount: args.amount,
    account_reference: args.accountReference,
    conversation_id: payout.conversationId ?? null,
    originator_conversation_id: payout.originatorConversationId ?? null,
    remarks: args.remarks ?? null,
    status: "requested",
    requested_by: args.requestedBy.id,
    raw: {
      ...(args.raw ?? {}),
      purpose: args.purpose,
      conversationId: payout.conversationId ?? null,
      originatorConversationId: payout.originatorConversationId ?? null,
    } as any,
  });
  if (error) throw new Error(error.message);

  return {
    id,
    conversationId: payout.conversationId,
    originatorConversationId: payout.originatorConversationId,
    responseBody: payout.responseBody,
  };
}

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
    const actor = await requireDirectorActor();
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
    if (loan.supplier_request_status === "approved") {
      throw new Error("This supplier-backed loan is already approved and waiting for fulfillment.");
    }

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
    await assertNoDuplicateOpenLoanKind(supabaseAdmin, {
      memberId: String(loan.member_id ?? ""),
      loanKind: String((loan as any).loan_kind ?? "financial"),
      excludeLoanId: data.loanId,
    });
    const policySettings = await loadRuntimePolicySettings(supabaseAdmin);
    const pricing = computeLoanPricing({
      netAmount: approvedAmount,
      ratePct: Number(loan.rate ?? 0),
      termDays: Number(loan.term_days ?? 0) || undefined,
      termMonths: Number(loan.term_months ?? 0) || undefined,
      processingFeeMode: String(loan.processing_fee_mode ?? "financed"),
      insuranceFeeMode: String(loan.insurance_fee_mode ?? "financed"),
      loanKind: String(loan.loan_kind ?? "financial"),
      settings: policySettings,
    });
    const loanKind = String(loan.loan_kind ?? "financial");
    if (loanKind !== "financial") {
      const { error } = await supabaseAdmin
        .from("loans")
        .update({
          approved_amount: approvedAmount,
          financed_principal_amount: approvedAmount,
          net_disbursed_amount: 0,
          processing_fee_amount: 0,
          insurance_fee_amount: 0,
          transaction_fee_amount: 0,
          processing_fee_mode: "upfront",
          insurance_fee_mode: "upfront",
          rate: 0,
          supplier_request_status: "approved",
          disbursement_status: "not_requested",
          reviewed_by: actor.id,
          review_note: data.note ?? null,
        })
        .eq("id", data.loanId);
      if (error) throw new Error(error.message);

      await auditAction({
        actor,
        action: "loan.supplier_approved",
        targetType: "loan",
        targetId: data.loanId,
        summary: `${actor.name} approved ${loanKind} loan ${data.loanId} for supplier fulfillment`,
        details: {
          memberId: loan.member_id,
          approvedAmount,
          financedPrincipalAmount: approvedAmount,
          loanKind,
          note: clipAuditText(data.note, 160),
        },
      });
      return { ok: true, supplierPending: true };
    }

    const cashSummary = await computeSystemCashSummary(supabaseAdmin);
    if (cashSummary.available < approvedAmount) {
      throw new Error(
        `Insufficient paybill balance. Available ${cashSummary.available}/=, required ${approvedAmount}/=.`,
      );
    }

    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, name, phone")
      .eq("id", loan.member_id)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new Error("The member linked to this loan could not be found.");

    const payoutRequest = await createSystemPayoutRequest(supabaseAdmin, {
      purpose: "loan_disbursement",
      amount: approvedAmount,
      phone: member.phone,
      accountReference: formatMembershipNumber(member.id),
      receiverName: member.name,
      remarks: data.note ?? loan.purpose ?? `Loan disbursement ${loan.id}`,
      requestedBy: actor,
      loanId: loan.id,
      memberId: member.id,
      targetId: loan.id,
      raw: {
        approvedAmount,
        financedPrincipalAmount: pricing.financedPrincipal,
        transactionFeeAmount: pricing.transactionFee,
      },
    });

    const { error } = await supabaseAdmin
      .from("loans")
      .update({
        approved_amount: approvedAmount,
        financed_principal_amount: pricing.financedPrincipal,
        net_disbursed_amount: approvedAmount,
        processing_fee_amount: pricing.processing,
        insurance_fee_amount: pricing.insurance,
        transaction_fee_amount: pricing.transactionFee,
        processing_fee_mode: loan.processing_fee_mode === "upfront" ? "upfront" : "financed",
        insurance_fee_mode: loan.insurance_fee_mode === "upfront" ? "upfront" : "financed",
        status: "active",
        disbursement_status: "requested",
        disbursement_requested_at: new Date().toISOString(),
        payout_request_id: payoutRequest.id,
        reviewed_by: actor.id,
        review_note: data.note ?? null,
      })
      .eq("id", data.loanId);
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: "loan.approved",
      targetType: "loan",
      targetId: data.loanId,
      summary: `${actor.name} approved loan ${data.loanId}`,
      details: {
        memberId: loan.member_id,
        approvedAmount,
        financedPrincipalAmount: pricing.financedPrincipal,
        payoutRequestId: payoutRequest.id,
        note: clipAuditText(data.note, 160),
      },
    });
    return { ok: true, payoutRequestId: payoutRequest.id };
  });

export const requestWithdrawalPayoutRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { memberId: string; amount: number; remarks?: string; allowOverdraw?: boolean }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      amount: Number(data?.amount ?? 0),
      remarks: data?.remarks?.trim() || undefined,
      allowOverdraw: !!data?.allowOverdraw,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.memberId) throw new Error("Member is required.");
    if (data.amount <= 0) throw new Error("Withdrawal amount must be above zero.");

    const supabaseAdmin = await requireSupabaseAdmin();
    const { data: member, error: memberError } = await supabaseAdmin
      .from("members")
      .select("id, name, phone, savings_balance, shares, share_reserve_balance")
      .eq("id", data.memberId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new Error("The selected member could not be found.");

    const currentBalance = await getMemberDocketBalance(
      supabaseAdmin,
      member,
      "withdrawable_savings",
    );
    if (!data.allowOverdraw && currentBalance < data.amount) {
      throw new Error(
        `Withdrawal exceeds the member's withdrawable savings balance of ${currentBalance}/=. Confirm overdraft to continue.`,
      );
    }

    const payout = await requestMpesaWithdrawalPayout({
      amount: data.amount,
      phone: member.phone,
      accountReference: formatMembershipNumber(member.id),
      memberName: member.name,
      remarks: data.remarks,
    });

    const { data: requestEvent, error: requestEventError } = await supabaseAdmin
      .from("mpesa_events")
      .insert({
        kind: "b2c_request",
        account: member.id,
        amount: data.amount,
        mpesa_ref: payout.conversationId ?? payout.originatorConversationId ?? null,
        payer_name: member.name,
        phone: member.phone,
        raw: {
          memberId: member.id,
          requestedBy: actor.id,
          requestedByName: actor.name,
          allowOverdraw: data.allowOverdraw,
          remarks: data.remarks ?? null,
          docket: "withdrawable_savings",
          balanceAtRequest: currentBalance,
          originatorConversationId: payout.originatorConversationId ?? null,
          conversationId: payout.conversationId ?? null,
          requestBody: payout.requestBody,
          responseBody: payout.responseBody,
        } as any,
        processed: false,
      })
      .select("id")
      .single();
    if (requestEventError) throw new Error(requestEventError.message);

    await auditAction({
      actor,
      action: "withdrawal.requested",
      targetType: "mpesa_event",
      targetId: requestEvent.id,
      summary: `${actor.name} requested a withdrawal payout for ${member.id}`,
      details: {
        memberId: member.id,
        amount: data.amount,
        conversationId: payout.conversationId ?? null,
        originatorConversationId: payout.originatorConversationId ?? null,
        allowOverdraw: data.allowOverdraw,
        remarks: data.remarks ?? null,
        docket: "withdrawable_savings",
        balanceAtRequest: currentBalance,
      },
    });

    return {
      id: requestEvent.id,
      conversationId: payout.conversationId ?? null,
      originatorConversationId: payout.originatorConversationId ?? null,
    };
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
        | "mpesa_unallocated"
        | "staff_payroll";
      account?: string;
      payerName?: string;
      amount: number;
      memberId?: string;
      loanId?: string;
      ref?: string;
      by: string;
      note?: string;
      allowOverdraw?: boolean;
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
      allowOverdraw: !!data?.allowOverdraw,
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

    if (resolvedMemberId && data.type === "deposit") {
      const { data: defaultedLoans, error: defaultedError } = await supabaseAdmin
        .from("loans")
        .select("id")
        .eq("member_id", resolvedMemberId)
        .eq("status", "defaulted")
        .limit(1);
      if (defaultedError) throw new Error(defaultedError.message);
      if ((defaultedLoans ?? []).length > 0) {
        throw new Error("This member has a defaulted loan. Record the money as a loan repayment.");
      }

      const { data: outstandingPenalties, error: penaltiesError } = await supabaseAdmin
        .from("penalties")
        .select("id")
        .eq("member_id", resolvedMemberId)
        .eq("status", "outstanding")
        .limit(1);
      if (penaltiesError) throw new Error(penaltiesError.message);
      if ((outstandingPenalties ?? []).length > 0) {
        throw new Error("This member has outstanding penalties. Use Pay penalties first.");
      }
    }

    const memberPatch: Record<string, unknown> = {};
    const policySettings = await loadRuntimePolicySettings(supabaseAdmin);
    let memberBeforeTransaction: {
      savings_balance?: number | string | null;
      shares?: number | string | null;
      share_reserve_balance?: number | string | null;
    } | null = null;
    if (resolvedMemberId) {
      const { data: member, error: memberError } = await supabaseAdmin
        .from("members")
        .select("savings_balance, shares, share_reserve_balance")
        .eq("id", resolvedMemberId)
        .maybeSingle();
      if (memberError) throw new Error(memberError.message);
      memberBeforeTransaction = member;
      if (memberBeforeTransaction) {
        if (data.type === "deposit") {
          const nextSavings =
            Number(memberBeforeTransaction.savings_balance ?? 0) + data.amount;
          assertMandatorySavingsWithinThreshold({
            amount: nextSavings,
            settings: policySettings,
          });
          memberPatch.savings_balance = nextSavings;
        } else if (data.type === "withdrawal") {
          const currentBalance = Number(memberBeforeTransaction.savings_balance ?? 0);
          if (!data.allowOverdraw && currentBalance < data.amount) {
            throw new Error(
              `Withdrawal exceeds the member's savings balance of ${currentBalance}/=. Confirm overdraft to continue.`,
            );
          }
          memberPatch.savings_balance = currentBalance - data.amount;
        } else if (data.type === "share_purchase") {
          const nextShares =
            Number(memberBeforeTransaction.shares ?? 0) + Math.floor(data.amount / SHARE_PRICE);
          assertShareBasketWithinThreshold({
            shares: nextShares,
            shareReserveBalance: memberBeforeTransaction.share_reserve_balance,
            settings: policySettings,
          });
          memberPatch.shares = nextShares;
        }
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

    if (resolvedMemberId && Object.keys(memberPatch).length > 0) {
      const { error: updateMemberError } = await supabaseAdmin
        .from("members")
        .update(memberPatch as any)
        .eq("id", resolvedMemberId);
      if (updateMemberError) throw new Error(updateMemberError.message);
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
    (data: {
      title: string;
      body: string;
      by: string;
      byStaffId?: string;
      date?: string;
      audience?: "staff" | "members" | "member" | "suppliers" | "supplier" | "all";
      targetMemberId?: string;
      targetSupplierId?: string;
      kind?: "info" | "warning" | "alert";
      expiresAt?: string;
    }) => ({
      title: String(data?.title ?? "").trim(),
      body: String(data?.body ?? "").trim(),
      by: String(data?.by ?? "").trim(),
      byStaffId: data?.byStaffId?.trim() || undefined,
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
      audience:
        data?.audience === "members" ||
        data?.audience === "member" ||
        data?.audience === "suppliers" ||
        data?.audience === "supplier" ||
        data?.audience === "all"
          ? data.audience
          : "staff",
      targetMemberId: data?.targetMemberId?.trim() || undefined,
      targetSupplierId: data?.targetSupplierId?.trim() || undefined,
      kind: data?.kind === "warning" || data?.kind === "alert" ? data.kind : "info",
      expiresAt: data?.expiresAt?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.title || !data.body || !data.by)
      throw new Error("Memo title, body and author are required.");
    if (data.audience === "member" && !data.targetMemberId) {
      throw new Error("Choose the member who should receive this notice.");
    }
    if (data.audience === "supplier" && !data.targetSupplierId) {
      throw new Error("Choose the supplier who should receive this notice.");
    }

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = makeId("MEM");
    const { error } = await runtimeDb.from("staff_memos").insert({
      id,
      memo_date: data.date,
      title: data.title,
      body: data.body,
      by_staff_id: actor.id,
      by_name: actor.name,
      audience: data.audience,
      target_member_id: data.audience === "member" ? data.targetMemberId : null,
      target_supplier_id: data.audience === "supplier" ? data.targetSupplierId : null,
      notice_kind: data.kind,
      expires_at: data.expiresAt ?? null,
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
        audience: data.audience,
        targetMemberId: data.targetMemberId ?? null,
        targetSupplierId: data.targetSupplierId ?? null,
        kind: data.kind,
        expiresAt: data.expiresAt ?? null,
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
    const payload = {
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
    };
    let { error } = await runtimeDb.from("fee_policies").upsert(payload);
    if (error && isMissingColumnError(error, "selected_member_ids")) {
      const fallbackPayload = { ...payload };
      delete (fallbackPayload as Partial<typeof payload>).selected_member_ids;
      const retry = await runtimeDb.from("fee_policies").upsert(fallbackPayload);
      error = retry.error;
    }
    if (error) throw new Error(error.message);
    const redistribution = await redistributePurposePoolBalances(runtimeDb, actor);
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
        redistribution,
      },
    });
    return { ok: true, redistribution };
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
    const redistribution = await redistributePurposePoolBalances(runtimeDb, actor);
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
        redistribution,
      },
    });
    return { ok: true, redistribution };
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
    const redistribution = await redistributePurposePoolBalances(runtimeDb, actor);
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
        redistribution,
      },
    });
    return { ok: true, redistribution };
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

type MemberDocket =
  | "withdrawable_savings"
  | "mandatory_savings"
  | "loan_savings"
  | "shares"
  | "share_reserve"
  | "purpose_pool"
  | "investment"
  | "penalty_payment";

type SupplierKind = "fuel" | "stock" | "service";
type SupplierType = "individual" | "company";
type SupplierRegistrationCategory = "goods" | "services" | "works";
type SupplierClass = "normal" | "special_broker";
type SupplierAgpoCategory = "youth" | "women" | "pwd" | "not_applicable";

const MEMBER_DOCKETS: MemberDocket[] = [
  "withdrawable_savings",
  "mandatory_savings",
  "loan_savings",
  "shares",
  "share_reserve",
  "purpose_pool",
  "investment",
  "penalty_payment",
];

const DOCKET_ACCOUNT_ALIASES: Record<string, MemberDocket> = {
  WITHDRAWABLE: "withdrawable_savings",
  WITHDRAWABLES: "withdrawable_savings",
  WITHDRAW: "withdrawable_savings",
  WDS: "withdrawable_savings",
  SAVINGS: "mandatory_savings",
  DAILY: "mandatory_savings",
  DAILYCOMPLIANCE: "mandatory_savings",
  DAILY_COMPLIANCE: "mandatory_savings",
  CONTRIBUTION: "mandatory_savings",
  MANDATORY: "mandatory_savings",
  COMPLIANCE: "mandatory_savings",
  LOANSAVINGS: "loan_savings",
  LOAN_SAVINGS: "loan_savings",
  MULTIPLIER: "loan_savings",
  SHARES: "shares",
  SHARE: "shares",
  RESERVE: "share_reserve",
  SHARERESERVE: "share_reserve",
  SHARE_RESERVE: "share_reserve",
  PURPOSE: "purpose_pool",
  PURPOSEPOOL: "purpose_pool",
  PURPOSE_POOL: "purpose_pool",
  INVESTMENT: "investment",
  INVEST: "investment",
  PENALTY: "penalty_payment",
  PENALTIES: "penalty_payment",
  PAYPENALTY: "penalty_payment",
  PAY_PENALTIES: "penalty_payment",
};

function normalizeMemberDocket(value: unknown): MemberDocket {
  return MEMBER_DOCKETS.includes(value as MemberDocket)
    ? (value as MemberDocket)
    : "withdrawable_savings";
}

function normalizeDocketAccountToken(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function docketFromAccountToken(value: unknown): MemberDocket | undefined {
  const token = normalizeDocketAccountToken(value);
  if (!token) return undefined;
  return DOCKET_ACCOUNT_ALIASES[token] ?? DOCKET_ACCOUNT_ALIASES[token.replace(/_/g, "")];
}

function parseMpesaAccountDocket(rawAccount: string) {
  const raw = String(rawAccount ?? "").trim();
  const normalized = raw.toUpperCase();
  const parts = normalized.split(/[\s:#|/\\-]+/).filter(Boolean);
  const docket = parts
    .slice(1)
    .map((part) => docketFromAccountToken(part))
    .find(Boolean);

  return {
    raw,
    account: parts[0] ?? normalized,
    docket,
  };
}

function normalizeSupplierKind(value: unknown): SupplierKind {
  return value === "fuel" || value === "stock" || value === "service" ? value : "stock";
}

function normalizeSupplierType(value: unknown): SupplierType {
  return value === "company" ? "company" : "individual";
}

function normalizeSupplierRegistrationCategory(value: unknown): SupplierRegistrationCategory {
  return value === "services" || value === "works" ? value : "goods";
}

function normalizeSupplierClass(value: unknown): SupplierClass {
  return value === "special_broker" ? "special_broker" : "normal";
}

function normalizeAgpoCategory(value: unknown): SupplierAgpoCategory {
  return value === "youth" || value === "women" || value === "pwd" ? value : "not_applicable";
}

function supplierVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function readSupplierDetailText(
  detail: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const next = String(detail[key] ?? "").trim();
    if (next) return next;
  }
  return undefined;
}

function readSupplierDetailNumber(
  detail: Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const next = Number(detail[key] ?? 0);
    if (Number.isFinite(next) && next > 0) return next;
  }
  return undefined;
}

async function resolveSupplierMutationActor(runtimeDb: any, supplierId?: string) {
  const session = await requireSignedInSession();
  if (session.authMode === "staff") {
    const actor = await requireStaffActor();
    return { actor, supplierMemberId: undefined };
  }

  const member = await requireMemberActor();
  const supplierQuery = runtimeDb.from("suppliers").select("id").eq("member_id", member.id);
  if (supplierId) supplierQuery.eq("id", supplierId);
  const { data: supplier, error } = await supplierQuery.maybeSingle();
  if (error) throw new Error(error.message);
  if (!supplier) {
    throw new Error("This member sign-in is not linked to the requested supplier profile.");
  }

  return {
    actor: {
      id: member.id,
      name: member.name,
      role: "supplier_member",
    } satisfies AuditActor,
    supplierMemberId: member.id,
  };
}

function systemOutflowKindFor(value: unknown) {
  const normalized = String(value ?? "").trim();
  const allowed = new Set([
    "client_withdrawal",
    "supplier_payment",
    "investor_withdrawal",
    "staff_payment",
    "loan_disbursement",
    "petty_cash",
    "docket_transfer",
    "other",
  ]);
  return allowed.has(normalized) ? normalized : "other";
}

async function getMemberDocketBalance(
  runtimeDb: any,
  member: Record<string, unknown>,
  docket: MemberDocket,
) {
  if (docket === "mandatory_savings") return toNumber(member.savings_balance);
  if (docket === "shares") return toNumber(member.shares) * SHARE_PRICE;
  if (docket === "share_reserve") return toNumber(member.share_reserve_balance);

  const { data, error } = await runtimeDb
    .from("member_docket_balances")
    .select("amount")
    .eq("member_id", member.id)
    .eq("docket", docket)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return toNumber(data?.amount);
}

async function memberMeetsComplianceThreshold(runtimeDb: any, member: Record<string, unknown>) {
  const policySettings = await loadRuntimePolicySettings(runtimeDb);
  const savingsThreshold =
    policySettings.percentages.mandatorySavingsThreshold || MANDATORY_SAVINGS_THRESHOLD;
  const sharesThreshold =
    policySettings.percentages.mandatorySharesThreshold || MANDATORY_SHARES_THRESHOLD;
  const savings = toNumber(member.savings_balance);
  const sharesValue =
    toNumber(member.shares) * SHARE_PRICE + toNumber(member.share_reserve_balance);

  return {
    ok: savings >= savingsThreshold && sharesValue >= sharesThreshold,
    savings,
    sharesValue,
    savingsThreshold,
    sharesThreshold,
  };
}

async function adjustMemberDocketBalance(args: {
  runtimeDb: any;
  member: Record<string, unknown>;
  docket: MemberDocket;
  delta: number;
  protected?: boolean;
}) {
  const { runtimeDb, member, docket } = args;
  const delta = roundMoney(args.delta);
  if (delta === 0) return;

  if (docket === "loan_savings" && delta > 0) {
    const compliance = await memberMeetsComplianceThreshold(runtimeDb, member);
    if (!compliance.ok) {
      throw new Error(
        `Loan savings opens after compliance is met: daily compliance contribution ${compliance.savings}/${compliance.savingsThreshold}, shares ${compliance.sharesValue}/${compliance.sharesThreshold}.`,
      );
    }
  }

  const current = await getMemberDocketBalance(runtimeDb, member, docket);
  const next = roundMoney(current + delta);
  if (next < 0) {
    throw new Error(`Insufficient ${docket.replace(/_/g, " ")} balance.`);
  }
  const policySettings = await loadRuntimePolicySettings(runtimeDb);

  if (docket === "mandatory_savings") {
    assertMandatorySavingsWithinThreshold({ amount: next, settings: policySettings });
    const { error } = await runtimeDb
      .from("members")
      .update({ savings_balance: next })
      .eq("id", member.id);
    if (error) throw new Error(error.message);
    member.savings_balance = next;
    return;
  }

  if (docket === "shares") {
    if (Math.abs(delta) % SHARE_PRICE !== 0) {
      throw new Error(`Share transfers must be in increments of ${SHARE_PRICE}/=.`);
    }
    const nextUnits = Math.floor(next / SHARE_PRICE);
    assertShareBasketWithinThreshold({
      shares: nextUnits,
      shareReserveBalance: member.share_reserve_balance,
      settings: policySettings,
    });
    const { error } = await runtimeDb
      .from("members")
      .update({ shares: nextUnits })
      .eq("id", member.id);
    if (error) throw new Error(error.message);
    member.shares = nextUnits;
    return;
  }

  if (docket === "share_reserve") {
    assertShareBasketWithinThreshold({
      shares: member.shares,
      shareReserveBalance: next,
      settings: policySettings,
    });
    const { error } = await runtimeDb
      .from("members")
      .update({ share_reserve_balance: next })
      .eq("id", member.id);
    if (error) throw new Error(error.message);
    member.share_reserve_balance = next;
    return;
  }

  const balancePayload: Record<string, unknown> = {
    member_id: member.id,
    docket,
    amount: next,
    updated_at: new Date().toISOString(),
  };
  if (args.protected === true) balancePayload.protected = true;

  const { error } = await runtimeDb.from("member_docket_balances").upsert(balancePayload);
  if (error) throw new Error(error.message);
}

async function adjustStoredMemberDocketBalance(args: {
  runtimeDb: any;
  memberId: string;
  docket: MemberDocket;
  delta: number;
  protected?: boolean;
}) {
  const delta = roundMoney(args.delta);
  if (delta === 0) return 0;

  const { data, error } = await args.runtimeDb
    .from("member_docket_balances")
    .select("amount, protected")
    .eq("member_id", args.memberId)
    .eq("docket", args.docket)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const next = roundMoney(Math.max(0, toNumber(data?.amount) + delta));
  const { error: upsertError } = await args.runtimeDb.from("member_docket_balances").upsert({
    member_id: args.memberId,
    docket: args.docket,
    amount: next,
    protected: args.protected === true || data?.protected === true,
    updated_at: new Date().toISOString(),
  });
  if (upsertError) throw new Error(upsertError.message);
  return next;
}

async function recordInvariantDocketMovement(args: {
  runtimeDb: any;
  memberId: string;
  fromDocket?: MemberDocket | null;
  toDocket?: MemberDocket | null;
  amount: number;
  actorId?: string | null;
  reason: string;
}) {
  const amount = roundMoney(args.amount);
  if (amount <= 0) return;
  if (args.actorId === MPESA_SYSTEM_STAFF_ID) {
    await ensureSystemStaffActor(args.runtimeDb, MPESA_SYSTEM_STAFF_ID);
  }
  const { error } = await args.runtimeDb.from("member_docket_movements").insert({
    id: makeId("MDM"),
    member_id: args.memberId,
    from_docket: args.fromDocket ?? null,
    to_docket: args.toDocket ?? null,
    amount,
    reason: args.reason,
    by_staff: args.actorId ?? null,
    protected: true,
  });
  if (error) throw new Error(error.message);
}

async function computeMemberLifetimeNet(runtimeDb: any, memberId: string) {
  const [transactions, profileResult] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(() =>
      runtimeDb.from("transactions").select("type, amount").eq("member_id", memberId),
    ),
    runtimeDb
      .from("member_carryover_profiles")
      .select("total_collected, collection_breakdown")
      .eq("member_id", memberId)
      .maybeSingle(),
  ]);
  if (profileResult.error && !isMissingRelationError(profileResult.error)) {
    throw new Error(profileResult.error.message);
  }

  const inflowTypes = new Set([
    "deposit",
    "loan_repayment",
    "share_purchase",
    "fee_payment",
    "investor_contribution",
  ]);
  const outflowTypes = new Set(["withdrawal", "loan_disbursement"]);
  const ledgerNet = transactions.reduce((sum, transaction) => {
    const type = String(transaction.type ?? "");
    const amount = toNumber(transaction.amount as any);
    if (inflowTypes.has(type)) return sum + amount;
    if (outflowTypes.has(type)) return sum - amount;
    return sum;
  }, 0);

  const breakdown = asJsonObject(profileResult.data?.collection_breakdown);
  const carryoverCollected = Math.max(
    toNumber(profileResult.data?.total_collected),
    toNumber(breakdown.totalDepositsRecorded),
  );
  return Math.max(0, roundMoney(Math.max(ledgerNet, carryoverCollected)));
}

async function repairMemberFinancialInvariants(args: {
  runtimeDb: any;
  memberId: string;
  actorId?: string | null;
  reason: string;
  capPurposePoolToLifetimeNet?: boolean;
}) {
  const policySettings = await loadRuntimePolicySettings(args.runtimeDb);
  const { data: member, error } = await args.runtimeDb
    .from("members")
    .select("id, savings_balance, shares, share_reserve_balance")
    .eq("id", args.memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) return { changed: false, overflowToPurposePool: 0, purposePoolTrimmed: 0 };

  const memberPatch: Record<string, unknown> = {};
  let overflowToPurposePool = 0;
  const savingsThreshold = mandatorySavingsThresholdForSettings(policySettings);
  const currentSavings = toNumber(member.savings_balance);
  if (currentSavings > savingsThreshold) {
    memberPatch.savings_balance = savingsThreshold;
    overflowToPurposePool = roundMoney(overflowToPurposePool + currentSavings - savingsThreshold);
  }

  const normalizedShares = normalizeShareBasketForThreshold({
    shares: member.shares,
    shareReserveBalance: member.share_reserve_balance,
    settings: policySettings,
  });
  if (normalizedShares.changed) {
    memberPatch.shares = normalizedShares.shares;
    memberPatch.share_reserve_balance = normalizedShares.shareReserveBalance;
    overflowToPurposePool = roundMoney(overflowToPurposePool + normalizedShares.overflow);
  }

  if (Object.keys(memberPatch).length > 0) {
    const { error: updateError } = await args.runtimeDb
      .from("members")
      .update(memberPatch as any)
      .eq("id", args.memberId);
    if (updateError) throw new Error(updateError.message);
  }

  if (overflowToPurposePool > 0) {
    await adjustStoredMemberDocketBalance({
      runtimeDb: args.runtimeDb,
      memberId: args.memberId,
      docket: "purpose_pool",
      delta: overflowToPurposePool,
      protected: true,
    });
    await recordInvariantDocketMovement({
      runtimeDb: args.runtimeDb,
      memberId: args.memberId,
      fromDocket: null,
      toDocket: "purpose_pool",
      amount: overflowToPurposePool,
      actorId: args.actorId,
      reason: `${args.reason}: moved mandatory-threshold overflow into purpose pool`,
    });
  }

  let purposePoolTrimmed = 0;
  if (args.capPurposePoolToLifetimeNet) {
    const lifetimeNet = await computeMemberLifetimeNet(args.runtimeDb, args.memberId);
    const { data: docketRows, error: docketError } = await args.runtimeDb
      .from("member_docket_balances")
      .select("docket, amount")
      .eq("member_id", args.memberId);
    if (docketError) throw new Error(docketError.message);

    const savedMember = {
      savings_balance: memberPatch.savings_balance ?? member.savings_balance,
      shares: memberPatch.shares ?? member.shares,
      share_reserve_balance: memberPatch.share_reserve_balance ?? member.share_reserve_balance,
    };
    const mandatoryHeld =
      toNumber(savedMember.savings_balance) +
      shareBasketValue(savedMember.shares, savedMember.share_reserve_balance);
    const rows = (docketRows ?? []) as Array<{ docket?: string | null; amount?: unknown }>;
    const purposePool = rows
      .filter((row) => row.docket === "purpose_pool")
      .reduce((sum, row) => sum + toNumber(row.amount), 0);
    const otherDockets = rows
      .filter((row) => row.docket && row.docket !== "purpose_pool")
      .reduce((sum, row) => sum + toNumber(row.amount), 0);
    const maxPurposePool = Math.max(0, roundMoney(lifetimeNet - mandatoryHeld - otherDockets));
    if (purposePool > maxPurposePool) {
      purposePoolTrimmed = roundMoney(purposePool - maxPurposePool);
      const { error: purposeError } = await args.runtimeDb.from("member_docket_balances").upsert({
        member_id: args.memberId,
        docket: "purpose_pool",
        amount: maxPurposePool,
        protected: true,
        updated_at: new Date().toISOString(),
      });
      if (purposeError) throw new Error(purposeError.message);
      await recordInvariantDocketMovement({
        runtimeDb: args.runtimeDb,
        memberId: args.memberId,
        fromDocket: "purpose_pool",
        toDocket: null,
        amount: purposePoolTrimmed,
        actorId: args.actorId,
        reason: `${args.reason}: removed unbacked purpose-pool balance above lifetime net`,
      });
    }
  }

  return {
    changed:
      Object.keys(memberPatch).length > 0 || overflowToPurposePool > 0 || purposePoolTrimmed > 0,
    overflowToPurposePool,
    purposePoolTrimmed,
  };
}

async function loadMemberForDocket(runtimeDb: any, memberId: string) {
  const { data: member, error } = await runtimeDb
    .from("members")
    .select("id, name, phone, savings_balance, shares, share_reserve_balance")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member) throw new Error("Member was not found.");
  return member as Record<string, unknown>;
}

async function settlePenaltiesFromDocketDeposit(args: {
  runtimeDb: any;
  member: Record<string, unknown>;
  amount: number;
  actor: AuditActor;
  reason?: string;
}) {
  const { data: penalties, error } = await args.runtimeDb
    .from("penalties")
    .select("*")
    .eq("member_id", args.member.id)
    .eq("status", "outstanding")
    .order("date", { ascending: true });
  if (error) throw new Error(error.message);

  let remaining = roundMoney(args.amount);
  for (const penalty of penalties ?? []) {
    const penaltyAmount = toNumber(penalty.amount);
    if (remaining < penaltyAmount) break;
    remaining = roundMoney(remaining - penaltyAmount);
    const { error: updateError } = await args.runtimeDb
      .from("penalties")
      .update({ status: "paid", paid_from: "direct" })
      .eq("id", penalty.id);
    if (updateError) throw new Error(updateError.message);
  }

  const paidAmount = roundMoney(args.amount - remaining);
  const txId =
    paidAmount > 0
      ? await insertTransactionRow({
          type: "fee_payment",
          amount: paidAmount,
          member_id: String(args.member.id),
          by_staff: args.actor.id,
          account: formatMembershipNumber(String(args.member.id)),
          note: args.reason ?? "Penalty payment via protected docket deposit",
        })
      : undefined;

  let dailyRepaymentTransactionId: string | undefined;
  if (remaining > 0 && paidAmount > 0) {
    const { data: loanRows, error: loanError } = await args.runtimeDb
      .from("loans")
      .select("*")
      .eq("member_id", args.member.id)
      .in("status", ["defaulted", "active"])
      .order("start_date", { ascending: true })
      .limit(10);
    if (loanError) throw new Error(loanError.message);

    const activeLoan =
      (loanRows ?? []).find((loan: any) => loan.status === "defaulted") ??
      (loanRows ?? []).find((loan: any) => loan.status === "active");
    if (activeLoan) {
      const dailyDue = roundMoney(loanDailyRepaymentObligation(activeLoan));
      const repaymentAmount = Math.min(remaining, dailyDue);
      if (repaymentAmount > 0) {
        dailyRepaymentTransactionId = await insertTransactionRow({
          type: "loan_repayment",
          amount: repaymentAmount,
          member_id: String(args.member.id),
          loan_id: activeLoan.id,
          by_staff: args.actor.id,
          account: formatMembershipNumber(String(args.member.id)),
          note: "Daily repayment included with penalty payment",
        });
        const summary = loanBalanceSummary(activeLoan);
        const nextPaid = toNumber(activeLoan.paid) + repaymentAmount;
        const nextBalance = Math.max(0, summary.total - nextPaid);
        const { error: updateLoanError } = await args.runtimeDb
          .from("loans")
          .update({
            paid: nextPaid,
            status: nextBalance <= 0 ? "closed" : activeLoan.status,
          })
          .eq("id", activeLoan.id);
        if (updateLoanError) throw new Error(updateLoanError.message);
        remaining = roundMoney(remaining - repaymentAmount);
      }
    }
  }

  if (remaining > 0) {
    await adjustMemberDocketBalance({
      runtimeDb: args.runtimeDb,
      member: args.member,
      docket: "penalty_payment",
      delta: remaining,
      protected: true,
    });
  }

  return { transactionId: txId, dailyRepaymentTransactionId, remaining };
}

export const listWithdrawalOperationsRecord = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaffActor();
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const [
      members,
      investors,
      staff,
      suppliers,
      supplierRequests,
      docketBalances,
      docketMovements,
      outflows,
      transactions,
      loans,
      penalties,
      carryoverProfiles,
    ] = await Promise.all([
      fetchAllRows(() =>
        runtimeDb
          .from("members")
          .select(
            "id, name, phone, member_category, savings_balance, shares, share_reserve_balance, status",
          )
          .order("id"),
      ),
      fetchAllRows(() =>
        runtimeDb.from("investors").select("id, name, phone, contributed, member_id").order("name"),
      ),
      fetchAllRows(() => runtimeDb.from("staff").select("id, name, phone, role").order("name")),
      fetchAllRows(() =>
        runtimeDb.from("suppliers").select("*").order("created_at", { ascending: false }),
      ),
      fetchAllRows(() =>
        runtimeDb
          .from("supplier_fulfillment_requests")
          .select("*")
          .order("created_at", { ascending: false }),
      ),
      fetchAllRows(() => runtimeDb.from("member_docket_balances").select("*")),
      fetchAllRows(() =>
        runtimeDb
          .from("member_docket_movements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ),
      fetchAllRows(() =>
        runtimeDb.from("system_outflows").select("*").order("created_at", { ascending: false }),
      ),
      fetchAllRows(() =>
        runtimeDb
          .from("transactions")
          .select("*")
          .in("type", ["withdrawal", "loan_disbursement", "petty_cash", "staff_payroll"])
          .order("created_at", { ascending: false })
          .limit(100),
      ),
      fetchAllRows(() =>
        runtimeDb
          .from("loans")
          .select(
            "id, member_id, principal, approved_amount, financed_principal_amount, rate, term_months, term_days, paid, status, purpose, loan_kind, supplier_id, supplier_request_status, supplier_payload",
          )
          .order("created_at", { ascending: false }),
      ),
      fetchAllRows(() =>
        runtimeDb.from("penalties").select("id, member_id, loan_id, amount, reason, status"),
      ),
      fetchAllRows(() =>
        runtimeDb
          .from("member_carryover_profiles")
          .select(
            "member_id, investment_balance, pending_balance, penalties_outstanding, collection_breakdown",
          ),
      ),
    ]);

    const cashSummary = await computeSystemCashSummary(runtimeDb);
    return {
      members,
      investors,
      staff,
      suppliers,
      supplierRequests,
      docketBalances,
      docketMovements,
      outflows,
      transactions,
      loans,
      penalties,
      carryoverProfiles,
      cashSummary,
    };
  },
);

export const recordProtectedDocketDepositRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { memberId: string; docket: MemberDocket; amount: number; reason?: string }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      docket: normalizeMemberDocket(data?.docket),
      amount: Number(data?.amount ?? 0),
      reason: data?.reason?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.memberId) throw new Error("Member is required.");
    if (data.amount <= 0) throw new Error("Amount must be above zero.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const member = await loadMemberForDocket(runtimeDb, data.memberId);
    const { data: outstandingPenalties, error: penaltyError } = await runtimeDb
      .from("penalties")
      .select("id, amount")
      .eq("member_id", data.memberId)
      .eq("status", "outstanding");
    if (penaltyError) throw new Error(penaltyError.message);
    if ((outstandingPenalties ?? []).length > 0 && data.docket !== "penalty_payment") {
      throw new Error(
        "This member has outstanding penalties. Use Pay penalties before depositing to another docket.",
      );
    }

    let penaltyResult: { transactionId?: string; remaining?: number } | undefined;
    if (data.docket === "penalty_payment") {
      penaltyResult = await settlePenaltiesFromDocketDeposit({
        runtimeDb,
        member,
        amount: data.amount,
        actor,
        reason: data.reason,
      });
    } else {
      await adjustMemberDocketBalance({
        runtimeDb,
        member,
        docket: data.docket,
        delta: data.amount,
        protected: true,
      });
    }

    const movementId = makeId("MDM");
    const { error: movementError } = await runtimeDb.from("member_docket_movements").insert({
      id: movementId,
      member_id: data.memberId,
      to_docket: data.docket,
      amount: data.amount,
      reason: data.reason ?? "Protected targeted deposit",
      by_staff: actor.id,
      protected: true,
    });
    if (movementError) throw new Error(movementError.message);

    await auditAction({
      actor,
      action: "member_docket.deposit",
      targetType: "member",
      targetId: data.memberId,
      summary: `${actor.name} deposited ${data.amount}/= to ${data.docket}`,
      details: { docket: data.docket, amount: data.amount, reason: data.reason ?? null },
    });
    return { ok: true, movementId, ...penaltyResult };
  });

export const transferMemberDocketRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      memberId: string;
      fromDocket: MemberDocket;
      toDocket: MemberDocket;
      amount: number;
      reason?: string;
    }) => ({
      memberId: String(data?.memberId ?? "").trim(),
      fromDocket: normalizeMemberDocket(data?.fromDocket),
      toDocket: normalizeMemberDocket(data?.toDocket),
      amount: Number(data?.amount ?? 0),
      reason: data?.reason?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.memberId) throw new Error("Member is required.");
    if (data.amount <= 0) throw new Error("Amount must be above zero.");
    if (data.fromDocket === data.toDocket) throw new Error("Choose two different dockets.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const member = await loadMemberForDocket(runtimeDb, data.memberId);
    if (data.fromDocket === "purpose_pool") {
      const currentPurposePool = await getMemberDocketBalance(runtimeDb, member, "purpose_pool");
      const transferablePurposePool = roundMoney(
        currentPurposePool * PURPOSE_POOL_TRANSFERABLE_SOURCE_PCT,
      );
      if (data.amount > transferablePurposePool) {
        throw new Error(
          `Full purpose pool as a source excludes Operations/Admin. Available to transfer is ${transferablePurposePool}/=; ${roundMoney(currentPurposePool - transferablePurposePool)}/= remains reserved for Operations/Admin.`,
        );
      }
    }
    await adjustMemberDocketBalance({
      runtimeDb,
      member,
      docket: data.fromDocket,
      delta: -data.amount,
    });
    await adjustMemberDocketBalance({
      runtimeDb,
      member,
      docket: data.toDocket,
      delta: data.amount,
      protected: true,
    });

    const movementId = makeId("MDM");
    const { error } = await runtimeDb.from("member_docket_movements").insert({
      id: movementId,
      member_id: data.memberId,
      from_docket: data.fromDocket,
      to_docket: data.toDocket,
      amount: data.amount,
      reason: data.reason ?? "Director docket transfer",
      by_staff: actor.id,
      protected: true,
    });
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: "member_docket.transferred",
      targetType: "member",
      targetId: data.memberId,
      summary: `${actor.name} moved ${data.amount}/= from ${data.fromDocket} to ${data.toDocket}`,
      details: data,
    });
    return { ok: true, movementId };
  });

export const createSupplierRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      name: string;
      kind: SupplierKind;
      supplierClass?: SupplierClass;
      supplierType?: SupplierType;
      registrationCategory?: SupplierRegistrationCategory;
      phone?: string;
      alternativePhone?: string;
      email?: string;
      postalAddress?: string;
      postalCodeTown?: string;
      county?: string;
      subCountyTown?: string;
      physicalLocation?: string;
      individualFirstName?: string;
      individualSecondName?: string;
      individualThirdName?: string;
      nationalId?: string;
      gender?: "Male" | "Female";
      dateOfBirth?: string;
      businessRegistrationNumber?: string;
      registrationDate?: string;
      contactPerson?: string;
      contactPersonDesignation?: string;
      kraPin?: string;
      taxComplianceCertificateNumber?: string;
      agpoCategory?: SupplierAgpoCategory;
      regulatoryLicenseNumber?: string;
      bankName?: string;
      bankBranch?: string;
      accountName?: string;
      accountNumber?: string;
      mpesaPaybillTill?: string;
      documentChecklist?: Record<string, boolean>;
      location?: string;
      notes?: string;
    }) => ({
      name: String(data?.name ?? "").trim(),
      kind: normalizeSupplierKind(data?.kind),
      supplierClass: normalizeSupplierClass(data?.supplierClass),
      supplierType: normalizeSupplierType(data?.supplierType),
      registrationCategory: normalizeSupplierRegistrationCategory(data?.registrationCategory),
      phone: data?.phone?.trim() || undefined,
      alternativePhone: data?.alternativePhone?.trim() || undefined,
      email: data?.email?.trim() || undefined,
      postalAddress: data?.postalAddress?.trim() || undefined,
      postalCodeTown: data?.postalCodeTown?.trim() || undefined,
      county: data?.county?.trim() || undefined,
      subCountyTown: data?.subCountyTown?.trim() || undefined,
      physicalLocation: data?.physicalLocation?.trim() || undefined,
      individualFirstName: data?.individualFirstName?.trim() || undefined,
      individualSecondName: data?.individualSecondName?.trim() || undefined,
      individualThirdName: data?.individualThirdName?.trim() || undefined,
      nationalId: data?.nationalId?.trim() || undefined,
      gender: data?.gender,
      dateOfBirth: data?.dateOfBirth?.trim() || undefined,
      businessRegistrationNumber: data?.businessRegistrationNumber?.trim() || undefined,
      registrationDate: data?.registrationDate?.trim() || undefined,
      contactPerson: data?.contactPerson?.trim() || undefined,
      contactPersonDesignation: data?.contactPersonDesignation?.trim() || undefined,
      kraPin: data?.kraPin?.trim().toUpperCase() || undefined,
      taxComplianceCertificateNumber: data?.taxComplianceCertificateNumber?.trim() || undefined,
      agpoCategory: normalizeAgpoCategory(data?.agpoCategory),
      regulatoryLicenseNumber: data?.regulatoryLicenseNumber?.trim() || undefined,
      bankName: data?.bankName?.trim() || undefined,
      bankBranch: data?.bankBranch?.trim() || undefined,
      accountName: data?.accountName?.trim() || undefined,
      accountNumber: data?.accountNumber?.trim() || undefined,
      mpesaPaybillTill: data?.mpesaPaybillTill?.trim() || undefined,
      documentChecklist: asJsonObject(data?.documentChecklist) as Record<string, boolean>,
      location:
        data?.location?.trim() ||
        data?.physicalLocation?.trim() ||
        data?.subCountyTown?.trim() ||
        undefined,
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    const isSpecialBroker = data.supplierClass === "special_broker";
    const supplierKind = isSpecialBroker ? "service" : data.kind;
    const individualName = [
      data.individualFirstName,
      data.individualSecondName,
      data.individualThirdName,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    const supplierName =
      data.supplierType === "individual" ? individualName || data.name : data.name;
    if (!supplierName) throw new Error("Supplier name is required.");
    if (!data.phone) throw new Error("Supplier phone is required.");
    if (!isValidLocalKenyanPhone(data.phone)) {
      throw new Error("Use a local phone number starting with 07 or 01.");
    }
    if (data.alternativePhone && !isValidLocalKenyanPhone(data.alternativePhone)) {
      throw new Error("Use a local alternative phone number starting with 07 or 01.");
    }
    if (data.supplierType === "individual" && !data.nationalId) {
      throw new Error("National ID or passport number is required for individual suppliers.");
    }
    if (!isSpecialBroker && data.supplierType === "company" && !data.businessRegistrationNumber) {
      throw new Error("Business registration or certificate number is required for companies.");
    }
    if (!isSpecialBroker && !data.kraPin) throw new Error("KRA PIN is required.");
    if (!isSpecialBroker && (!data.bankName || !data.accountName || !data.accountNumber)) {
      throw new Error("Supplier bank name, account name, and account number are required.");
    }

    const runtimeDb = (await requireSupabaseAdmin()) as any;

    if (data.kraPin) {
      const { data: existingSupplier, error: existingSupplierError } = await runtimeDb
        .from("suppliers")
        .select("id, name")
        .eq("kra_pin", data.kraPin)
        .maybeSingle();
      if (existingSupplierError && !isMissingColumnError(existingSupplierError, "kra_pin")) {
        throw new Error(existingSupplierError.message);
      }
      if (existingSupplier) {
        throw new Error(`That KRA PIN is already registered to supplier ${existingSupplier.name}.`);
      }
    }

    const { data: existingMembers, error: existingMembersError } = await runtimeDb
      .from("members")
      .select("id");
    if (existingMembersError) throw new Error(existingMembersError.message);

    const memberId = nextMembershipNumber(
      (existingMembers ?? []).map((row: { id?: string | null }) => row.id),
      1,
    );
    const phone = toLocalKenyanPhone(data.phone);
    const alternativePhone = data.alternativePhone
      ? toLocalKenyanPhone(data.alternativePhone)
      : undefined;
    const joinedAt = new Date().toISOString().slice(0, 10);
    const location = data.location ?? data.physicalLocation ?? data.subCountyTown;
    const memberFirstName =
      data.supplierType === "individual"
        ? data.individualFirstName
        : data.contactPerson?.split(/\s+/).filter(Boolean)[0];
    const memberLastName =
      data.supplierType === "individual"
        ? [data.individualSecondName, data.individualThirdName].filter(Boolean).join(" ").trim()
        : data.name;
    const { error: memberError } = await runtimeDb.from("members").insert({
      id: memberId,
      name: supplierName,
      phone,
      joined_at: joinedAt,
      status: "active",
      shares: 0,
      savings_balance: 0,
      fee_membership: false,
      fee_card: false,
      fee_has_shop: false,
      fee_sticker: false,
      fee_first_upfront_paid: false,
      first_name: memberFirstName ?? null,
      second_name: data.supplierType === "individual" ? (data.individualSecondName ?? null) : null,
      third_name: data.supplierType === "individual" ? (data.individualThirdName ?? null) : null,
      last_name: memberLastName || null,
      dob: data.dateOfBirth ?? null,
      gender: data.gender ?? null,
      email: data.email ?? null,
      address: data.postalAddress ?? location ?? null,
      city: data.subCountyTown ?? null,
      county: data.county ?? null,
      village: data.physicalLocation ?? null,
      business_name: data.supplierType === "company" ? data.name : null,
      business_type: isSpecialBroker ? "broker" : data.registrationCategory,
      business_permanence: null,
      business_address: data.physicalLocation ?? location ?? null,
      field_officer_id: actor.id,
      member_category: "supplier",
      is_investor: false,
    });
    if (memberError) throw new Error(memberError.message);

    const id = makeId("SUP");
    const { error } = await runtimeDb.from("suppliers").insert({
      id,
      name: supplierName,
      kind: supplierKind,
      member_id: memberId,
      supplier_class: data.supplierClass,
      supplier_type: data.supplierType,
      registration_category: isSpecialBroker ? "services" : data.registrationCategory,
      individual_first_name: data.individualFirstName ?? null,
      individual_second_name: data.individualSecondName ?? null,
      individual_third_name: data.individualThirdName ?? null,
      national_id: data.nationalId ?? null,
      gender: data.gender ?? null,
      date_of_birth: data.dateOfBirth ?? null,
      business_registration_number: data.businessRegistrationNumber ?? null,
      registration_date: data.registrationDate ?? null,
      phone,
      alternative_phone: alternativePhone ?? null,
      email: data.email ?? null,
      contact_person: data.contactPerson ?? null,
      contact_person_designation: data.contactPersonDesignation ?? null,
      postal_address: data.postalAddress ?? null,
      postal_code_town: data.postalCodeTown ?? null,
      county: data.county ?? null,
      sub_county_town: data.subCountyTown ?? null,
      physical_location: data.physicalLocation ?? null,
      kra_pin: data.kraPin ?? null,
      tax_compliance_certificate_number: data.taxComplianceCertificateNumber ?? null,
      agpo_category: data.agpoCategory,
      regulatory_license_number: data.regulatoryLicenseNumber ?? null,
      bank_name: data.bankName ?? null,
      bank_branch: data.bankBranch ?? null,
      account_name: data.accountName ?? null,
      account_number: data.accountNumber ?? null,
      mpesa_paybill_till: data.mpesaPaybillTill ?? null,
      document_checklist: data.documentChecklist,
      location: location ?? null,
      notes: data.notes ?? null,
    });
    if (error) {
      await runtimeDb.from("members").delete().eq("id", memberId);
      throw new Error(error.message);
    }
    await auditAction({
      actor,
      action: "supplier.created",
      targetType: "supplier",
      targetId: id,
      summary: `${actor.name} registered supplier ${supplierName}`,
      details: {
        ...data,
        memberId,
        supplierName,
        supplierKind,
      },
    });
    return { id, memberId };
  });

export const createSupplierFulfillmentRequestRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      supplierId: string;
      memberId: string;
      loanId?: string;
      kind: SupplierKind;
      amount: number;
      detail?: Record<string, unknown>;
    }) => ({
      supplierId: String(data?.supplierId ?? "").trim(),
      memberId: String(data?.memberId ?? "").trim(),
      loanId: data?.loanId?.trim() || undefined,
      kind: normalizeSupplierKind(data?.kind),
      amount: Number(data?.amount ?? 0),
      detail: data?.detail ?? {},
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.supplierId || !data.memberId) throw new Error("Supplier and member are required.");
    if (data.amount <= 0) throw new Error("Amount must be above zero.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const detail = asJsonObject(data.detail);
    const { data: supplier, error: supplierError } = await runtimeDb
      .from("suppliers")
      .select("id, kind, status, supplier_class")
      .eq("id", data.supplierId)
      .maybeSingle();
    if (supplierError) throw new Error(supplierError.message);
    if (!supplier) throw new Error("Supplier was not found.");
    if (supplier.status !== "active") throw new Error("Supplier is not active.");
    if (supplier.supplier_class === "special_broker") {
      throw new Error(
        "Special broker suppliers manage people and deposits, not commodity requests.",
      );
    }
    if (supplier.kind !== data.kind) {
      throw new Error(
        `This request is ${data.kind}, but the selected supplier is ${supplier.kind}.`,
      );
    }
    const commodityName =
      readSupplierDetailText(detail, "item", "commodityName", "serviceType", "purpose") ??
      (data.kind === "fuel" ? "Fuel" : undefined);
    const quantityRequested = readSupplierDetailNumber(detail, "quantity", "litres", "amount");
    const unitOfMeasure =
      readSupplierDetailText(detail, "unit", "unitOfMeasure") ??
      (data.kind === "fuel" ? "litres" : "unit");
    const vehiclePlate = readSupplierDetailText(detail, "vehicle", "vehiclePlate");
    const fuelType = readSupplierDetailText(detail, "fuelType");
    const driverMemberId =
      data.kind === "fuel"
        ? (readSupplierDetailText(detail, "driverMemberId") ?? data.memberId)
        : undefined;
    const verificationCode = data.kind === "fuel" ? supplierVerificationCode() : undefined;
    const id = makeId("SFR");
    const { error } = await runtimeDb.from("supplier_fulfillment_requests").insert({
      id,
      supplier_id: data.supplierId,
      loan_id: data.loanId ?? null,
      member_id: data.memberId,
      kind: data.kind,
      amount: data.amount,
      detail,
      commodity_name: commodityName ?? null,
      quantity_requested: quantityRequested ?? null,
      unit_of_measure: unitOfMeasure ?? null,
      vehicle_plate: vehiclePlate ?? null,
      fuel_type: fuelType ?? null,
      driver_member_id: driverMemberId ?? null,
      verification_code: verificationCode ?? null,
      verification_code_issued_at: verificationCode ? new Date().toISOString() : null,
      status: "sent",
      requested_by: actor.id,
    });
    if (error) throw new Error(error.message);
    if (data.loanId) {
      const { error: loanError } = await runtimeDb
        .from("loans")
        .update({
          loan_kind: data.kind,
          supplier_id: data.supplierId,
          supplier_request_status: "sent",
          supplier_payload: detail,
        })
        .eq("id", data.loanId);
      if (loanError) throw new Error(loanError.message);
    }
    await auditAction({
      actor,
      action: "supplier_request.created",
      targetType: "supplier_fulfillment_request",
      targetId: id,
      summary: `${actor.name} sent ${data.kind} request ${id} to supplier`,
      details: data,
    });
    return { id, verificationCode };
  });

export const markSupplierFulfilledRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      requestId: string;
      fulfilledByName?: string;
      verificationCode?: string;
      verificationNote?: string;
    }) => ({
      requestId: String(data?.requestId ?? "").trim(),
      fulfilledByName: data?.fulfilledByName?.trim() || undefined,
      verificationCode: data?.verificationCode?.trim() || undefined,
      verificationNote: data?.verificationNote?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    if (!data.requestId) throw new Error("Supplier request is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: request, error: requestError } = await runtimeDb
      .from("supplier_fulfillment_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) throw new Error("Supplier request was not found.");
    if (request.status !== "sent") {
      throw new Error(`This supplier request is already ${request.status}.`);
    }

    const { actor } = await resolveSupplierMutationActor(runtimeDb, String(request.supplier_id));
    const requestVerificationCode = String(request.verification_code ?? "").trim();
    if (request.kind === "fuel" && requestVerificationCode) {
      if (!data.verificationCode) {
        throw new Error("Enter the driver verification code before confirming fuel delivery.");
      }
      if (data.verificationCode !== requestVerificationCode) {
        throw new Error("The supplied driver verification code is not correct.");
      }
    }

    const now = new Date().toISOString();
    if (request.kind === "stock") {
      const quantity = Number(request.quantity_requested ?? 0);
      const commodity = String(request.commodity_name ?? "").trim();
      if (quantity > 0 && commodity) {
        const { data: inventoryRows, error: inventoryError } = await runtimeDb
          .from("supplier_inventory_items")
          .select("*")
          .eq("supplier_id", request.supplier_id)
          .eq("item_kind", "stock")
          .ilike("item_name", `%${commodity}%`)
          .order("updated_at", { ascending: false })
          .limit(1);
        if (inventoryError) throw new Error(inventoryError.message);
        const inventoryItem = inventoryRows?.[0];
        if (inventoryItem) {
          const available = Number(inventoryItem.quantity_available ?? 0);
          if (available < quantity) {
            throw new Error(
              `Supplier inventory has only ${available} ${inventoryItem.unit ?? "units"} for ${inventoryItem.item_name}.`,
            );
          }
          const { error: inventoryUpdateError } = await runtimeDb
            .from("supplier_inventory_items")
            .update({
              quantity_available: Math.max(0, available - quantity),
              updated_at: now,
            })
            .eq("id", inventoryItem.id);
          if (inventoryUpdateError) throw new Error(inventoryUpdateError.message);
        }

        if (!request.loan_id) {
          const unitPrice = Number(request.amount ?? 0) / Math.max(1, quantity);
          const storeId = makeId("STK");
          const { error: storeError } = await runtimeDb.from("internal_store_items").insert({
            id: storeId,
            item_name: commodity,
            item_kind: "stock",
            unit: request.unit_of_measure ?? "unit",
            quantity_available: quantity,
            unit_price: unitPrice,
            buying_price: unitPrice,
            preferred_supplier_id: request.supplier_id,
            notes: `Received from supplier request ${request.id}; set selling price before issuing.`,
            created_by: actor.id,
            updated_by: actor.id,
            updated_at: now,
          });
          if (storeError) throw new Error(storeError.message);
        }
      }
    }

    const { error } = await runtimeDb
      .from("supplier_fulfillment_requests")
      .update({
        status: "fulfilled",
        fulfilled_by_name: data.fulfilledByName ?? actor.name,
        fulfilled_at: now,
        verified_at: request.kind === "fuel" ? now : (request.verified_at ?? null),
        verified_by_member_id:
          request.kind === "fuel"
            ? (request.driver_member_id ?? request.member_id ?? null)
            : (request.verified_by_member_id ?? null),
        verification_note: data.verificationNote ?? null,
        updated_at: now,
      })
      .eq("id", data.requestId);
    if (error) throw new Error(error.message);

    if (request.loan_id) {
      const { error: loanError } = await runtimeDb
        .from("loans")
        .update({
          status: "active",
          approved_amount: request.amount,
          net_disbursed_amount: 0,
          supplier_request_status: "fulfilled",
          disbursement_status: "paid",
          disbursement_completed_at: now,
          start_date: now.slice(0, 10),
        })
        .eq("id", request.loan_id);
      if (loanError) throw new Error(loanError.message);
    }

    await auditAction({
      actor,
      action: "supplier_request.fulfilled",
      targetType: "supplier_fulfillment_request",
      targetId: data.requestId,
      summary: `${actor.name} marked supplier request ${data.requestId} fulfilled`,
      details: { fulfilledByName: data.fulfilledByName ?? actor.name },
    });
    return { ok: true };
  });

export const recordSystemOutflowRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      kind?: string;
      amount: number;
      receiverName: string;
      receiverPhone?: string;
      method?: string;
      memberId?: string;
      staffId?: string;
      investorId?: string;
      supplierId?: string;
      loanId?: string;
      note?: string;
      supplierRequestId?: string;
    }) => ({
      kind: systemOutflowKindFor(data?.kind),
      amount: Number(data?.amount ?? 0),
      receiverName: String(data?.receiverName ?? "").trim(),
      receiverPhone: data?.receiverPhone?.trim() || undefined,
      method: data?.method?.trim() || "cash",
      memberId: data?.memberId?.trim() || undefined,
      staffId: data?.staffId?.trim() || undefined,
      investorId: data?.investorId?.trim() || undefined,
      supplierId: data?.supplierId?.trim() || undefined,
      loanId: data?.loanId?.trim() || undefined,
      note: data?.note?.trim() || undefined,
      supplierRequestId: data?.supplierRequestId?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (data.amount <= 0) throw new Error("Amount must be above zero.");
    if (!data.receiverName) throw new Error("Receiver name is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;

    const txType = data.kind === "supplier_payment" ? "loan_disbursement" : "withdrawal";
    const transactionId = await insertTransactionRow({
      type: txType,
      amount: data.amount,
      member_id: data.memberId ?? null,
      loan_id: data.loanId ?? null,
      by_staff: actor.id,
      ref: data.supplierRequestId ?? null,
      note: `${data.kind}: ${data.receiverName}. ${data.note ?? ""}`.trim(),
    });

    const id = makeId("OUT");
    const { error } = await runtimeDb.from("system_outflows").insert({
      id,
      kind: data.kind,
      amount: data.amount,
      receiver_name: data.receiverName,
      receiver_phone: data.receiverPhone ?? null,
      method: data.method,
      member_id: data.memberId ?? null,
      staff_id: data.staffId ?? null,
      investor_id: data.investorId ?? null,
      supplier_id: data.supplierId ?? null,
      loan_id: data.loanId ?? null,
      transaction_id: transactionId,
      note: data.note ?? null,
      by_staff: actor.id,
    });
    if (error) throw new Error(error.message);

    if (data.supplierRequestId) {
      const { error: requestError } = await runtimeDb
        .from("supplier_fulfillment_requests")
        .update({
          status: "paid",
          paid_transaction_id: transactionId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.supplierRequestId);
      if (requestError) throw new Error(requestError.message);
    }

    await auditAction({
      actor,
      action: "system_outflow.created",
      targetType: "system_outflow",
      targetId: id,
      summary: `${actor.name} recorded ${data.kind} outflow ${id}`,
      details: data,
    });
    return { id, transactionId };
  });

export const saveSupplierInventoryItemRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      itemId?: string;
      supplierId: string;
      itemName: string;
      itemKind: SupplierKind;
      unit?: string;
      quantityAvailable?: number;
      unitPrice?: number;
      buyingPrice?: number;
      sellingPrice?: number;
      brand?: string;
      quality?: string;
      sku?: string;
      notes?: string;
    }) => ({
      itemId: data?.itemId?.trim() || undefined,
      supplierId: String(data?.supplierId ?? "").trim(),
      itemName: String(data?.itemName ?? "").trim(),
      itemKind: normalizeSupplierKind(data?.itemKind),
      unit: data?.unit?.trim() || "unit",
      quantityAvailable: Number(data?.quantityAvailable ?? 0),
      unitPrice: Number(data?.unitPrice ?? 0),
      buyingPrice: data?.buyingPrice == null ? undefined : Number(data.buyingPrice ?? 0),
      sellingPrice: data?.sellingPrice == null ? undefined : Number(data.sellingPrice ?? 0),
      brand: data?.brand?.trim() || undefined,
      quality: data?.quality?.trim() || undefined,
      sku: data?.sku?.trim() || undefined,
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    if (!data.supplierId) throw new Error("Supplier is required.");
    if (!data.itemName) throw new Error("Commodity name is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { actor } = await resolveSupplierMutationActor(runtimeDb, data.supplierId);

    const id = data.itemId ?? makeId("SIN");
    const { error } = await runtimeDb.from("supplier_inventory_items").upsert({
      id,
      supplier_id: data.supplierId,
      item_name: data.itemName,
      item_kind: data.itemKind,
      unit: data.unit,
      quantity_available: Math.max(0, data.quantityAvailable),
      unit_price: Math.max(0, data.unitPrice),
      buying_price: Math.max(0, data.buyingPrice ?? data.unitPrice),
      selling_price: Math.max(0, data.sellingPrice ?? data.unitPrice),
      brand: data.brand ?? null,
      quality: data.quality ?? null,
      sku: data.sku ?? null,
      notes: data.notes ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: data.itemId ? "supplier_inventory.updated" : "supplier_inventory.created",
      targetType: "supplier_inventory_item",
      targetId: id,
      summary: `${actor.name} saved supplier inventory item ${data.itemName}`,
      details: {
        supplierId: data.supplierId,
        itemKind: data.itemKind,
        quantityAvailable: data.quantityAvailable,
        unitPrice: data.unitPrice,
      },
    });
    return { id };
  });

export const createSupplierBrokerClientRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      supplierId: string;
      firstName: string;
      secondName?: string;
      thirdName?: string;
      nationalId?: string;
      role?: string;
      phone?: string;
      openingBalance?: number;
      notes?: string;
    }) => ({
      supplierId: String(data?.supplierId ?? "").trim(),
      firstName: String(data?.firstName ?? "").trim(),
      secondName: data?.secondName?.trim() || undefined,
      thirdName: data?.thirdName?.trim() || undefined,
      nationalId: data?.nationalId?.trim() || undefined,
      role: data?.role?.trim() || undefined,
      phone: data?.phone?.trim() || undefined,
      openingBalance: Number(data?.openingBalance ?? 0),
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    if (!data.supplierId) throw new Error("Supplier is required.");
    if (!data.firstName) throw new Error("First name is required.");
    if (data.phone && !isValidLocalKenyanPhone(data.phone)) {
      throw new Error("Use a local phone number starting with 07 or 01.");
    }

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { actor } = await resolveSupplierMutationActor(runtimeDb, data.supplierId);
    const { data: supplier, error: supplierError } = await runtimeDb
      .from("suppliers")
      .select("id, supplier_class")
      .eq("id", data.supplierId)
      .maybeSingle();
    if (supplierError) throw new Error(supplierError.message);
    if (!supplier) throw new Error("Supplier was not found.");
    if (supplier.supplier_class !== "special_broker") {
      throw new Error("People intake is only available for special broker suppliers.");
    }

    const openingBalance = Math.max(0, data.openingBalance);
    const id = makeId("BRC");
    const { error } = await runtimeDb.from("supplier_broker_clients").insert({
      id,
      supplier_id: data.supplierId,
      first_name: data.firstName,
      second_name: data.secondName ?? null,
      third_name: data.thirdName ?? null,
      national_id: data.nationalId ?? null,
      role: data.role ?? null,
      phone: data.phone ? toLocalKenyanPhone(data.phone) : null,
      opening_balance: openingBalance,
      current_balance: openingBalance,
      notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: "supplier_broker_client.created",
      targetType: "supplier_broker_client",
      targetId: id,
      summary: `${actor.name} added broker client ${data.firstName}`,
      details: {
        supplierId: data.supplierId,
        nationalId: clipAuditText(data.nationalId, 40),
        role: data.role ?? null,
        openingBalance,
      },
    });
    return { id };
  });

export const recordSupplierBrokerClientTransactionRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      supplierId: string;
      clientId: string;
      kind: "deposit" | "withdrawal";
      amount: number;
      note?: string;
    }) => ({
      supplierId: String(data?.supplierId ?? "").trim(),
      clientId: String(data?.clientId ?? "").trim(),
      kind: data?.kind === "withdrawal" ? "withdrawal" : "deposit",
      amount: Number(data?.amount ?? 0),
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    if (!data.supplierId || !data.clientId) throw new Error("Supplier and client are required.");
    if (data.amount <= 0) throw new Error("Amount must be above zero.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { actor } = await resolveSupplierMutationActor(runtimeDb, data.supplierId);
    const { data: client, error: clientError } = await runtimeDb
      .from("supplier_broker_clients")
      .select("*")
      .eq("id", data.clientId)
      .eq("supplier_id", data.supplierId)
      .maybeSingle();
    if (clientError) throw new Error(clientError.message);
    if (!client) throw new Error("Broker client was not found.");

    const currentBalance = Number(client.current_balance ?? 0);
    const nextBalance =
      data.kind === "deposit" ? currentBalance + data.amount : currentBalance - data.amount;
    if (nextBalance < 0) {
      throw new Error("Withdrawal cannot be higher than the client's current balance.");
    }

    const now = new Date().toISOString();
    const id = makeId("BRT");
    const { error: txError } = await runtimeDb.from("supplier_broker_client_transactions").insert({
      id,
      supplier_client_id: data.clientId,
      supplier_id: data.supplierId,
      kind: data.kind,
      amount: data.amount,
      balance_after: nextBalance,
      note: data.note ?? null,
      recorded_by: actor.id,
      created_at: now,
    });
    if (txError) throw new Error(txError.message);

    const { error: updateError } = await runtimeDb
      .from("supplier_broker_clients")
      .update({
        current_balance: nextBalance,
        updated_at: now,
      })
      .eq("id", data.clientId);
    if (updateError) throw new Error(updateError.message);

    await auditAction({
      actor,
      action: `supplier_broker_client.${data.kind}`,
      targetType: "supplier_broker_client",
      targetId: data.clientId,
      summary: `${actor.name} recorded ${data.kind} of ${data.amount}/= for broker client ${data.clientId}`,
      details: {
        supplierId: data.supplierId,
        amount: data.amount,
        balanceAfter: nextBalance,
        note: clipAuditText(data.note, 160),
      },
    });
    return { id, balanceAfter: nextBalance };
  });

export const saveInternalStoreItemRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      itemId?: string;
      itemName: string;
      itemKind: SupplierKind;
      unit?: string;
      quantityAvailable?: number;
      reorderLevel?: number;
      unitPrice?: number;
      preferredSupplierId?: string;
      buyingPrice?: number;
      sellingPrice?: number;
      brand?: string;
      quality?: string;
      notes?: string;
    }) => ({
      itemId: data?.itemId?.trim() || undefined,
      itemName: String(data?.itemName ?? "").trim(),
      itemKind: normalizeSupplierKind(data?.itemKind),
      unit: data?.unit?.trim() || "unit",
      quantityAvailable: Number(data?.quantityAvailable ?? 0),
      reorderLevel: Number(data?.reorderLevel ?? 0),
      unitPrice: Number(data?.unitPrice ?? 0),
      preferredSupplierId: data?.preferredSupplierId?.trim() || undefined,
      buyingPrice: data?.buyingPrice == null ? undefined : Number(data.buyingPrice ?? 0),
      sellingPrice: data?.sellingPrice == null ? undefined : Number(data.sellingPrice ?? 0),
      brand: data?.brand?.trim() || undefined,
      quality: data?.quality?.trim() || undefined,
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.itemName) throw new Error("Store item name is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const id = data.itemId ?? makeId("STK");
    const { error } = await runtimeDb.from("internal_store_items").upsert({
      id,
      item_name: data.itemName,
      item_kind: data.itemKind,
      unit: data.unit,
      quantity_available: Math.max(0, data.quantityAvailable),
      reorder_level: Math.max(0, data.reorderLevel),
      unit_price: Math.max(0, data.unitPrice),
      buying_price: Math.max(0, data.buyingPrice ?? data.unitPrice),
      selling_price: Math.max(0, data.sellingPrice ?? data.unitPrice),
      brand: data.brand ?? null,
      quality: data.quality ?? null,
      preferred_supplier_id: data.preferredSupplierId ?? null,
      notes: data.notes ?? null,
      created_by: actor.id,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    await auditAction({
      actor,
      action: data.itemId ? "internal_store.updated" : "internal_store.created",
      targetType: "internal_store_item",
      targetId: id,
      summary: `${actor.name} saved internal store item ${data.itemName}`,
      details: {
        itemKind: data.itemKind,
        quantityAvailable: data.quantityAvailable,
        reorderLevel: data.reorderLevel,
        unitPrice: data.unitPrice,
      },
    });
    return { id };
  });

export const issueInternalStoreLoanRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      itemId: string;
      memberId: string;
      quantity: number;
      loanId?: string;
      note?: string;
    }) => ({
      itemId: String(data?.itemId ?? "").trim(),
      memberId: String(data?.memberId ?? "").trim(),
      quantity: Number(data?.quantity ?? 0),
      loanId: data?.loanId?.trim() || undefined,
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.itemId || !data.memberId) throw new Error("Store item and member are required.");
    if (data.quantity <= 0) throw new Error("Issued quantity must be above zero.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: item, error: itemError } = await runtimeDb
      .from("internal_store_items")
      .select("*")
      .eq("id", data.itemId)
      .maybeSingle();
    if (itemError) throw new Error(itemError.message);
    if (!item) throw new Error("Internal store item was not found.");

    const available = Number(item.quantity_available ?? 0);
    if (available < data.quantity) {
      throw new Error(
        `Only ${available} ${item.unit ?? "units"} are available in the internal store.`,
      );
    }

    const nextQuantity = Math.max(0, available - data.quantity);
    const now = new Date().toISOString();
    const { error: stockError } = await runtimeDb
      .from("internal_store_items")
      .update({
        quantity_available: nextQuantity,
        updated_by: actor.id,
        updated_at: now,
      })
      .eq("id", data.itemId);
    if (stockError) throw new Error(stockError.message);

    if (data.loanId) {
      const { data: loan, error: loanError } = await runtimeDb
        .from("loans")
        .select("*")
        .eq("id", data.loanId)
        .maybeSingle();
      if (loanError) throw new Error(loanError.message);
      if (!loan) throw new Error("The linked loan was not found.");

      const amount = roundMoney(data.quantity * Number(item.unit_price ?? 0));
      const supplierPayload = asJsonObject(loan.supplier_payload);
      const { error: updateLoanError } = await runtimeDb
        .from("loans")
        .update({
          status: "active",
          approved_amount: amount || loan.approved_amount || loan.principal,
          net_disbursed_amount: 0,
          supplier_request_status: "fulfilled",
          disbursement_status: "paid",
          disbursement_completed_at: now,
          start_date: now.slice(0, 10),
          supplier_payload: {
            ...supplierPayload,
            source: "internal_store",
            storeItemId: item.id,
            storeItemName: item.item_name,
            quantityIssued: data.quantity,
            unit: item.unit ?? "unit",
          },
        })
        .eq("id", data.loanId);
      if (updateLoanError) throw new Error(updateLoanError.message);
    }

    await auditAction({
      actor,
      action: "internal_store.issued",
      targetType: "internal_store_item",
      targetId: data.itemId,
      summary: `${actor.name} issued ${data.quantity} ${item.unit ?? "units"} from the internal store`,
      details: {
        memberId: data.memberId,
        loanId: data.loanId ?? null,
        itemName: item.item_name,
        note: clipAuditText(data.note, 160),
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
    const [existingProfileResult, currentMemberResult] = await Promise.all([
      runtimeDb
        .from("member_carryover_profiles")
        .select("collection_breakdown")
        .eq("member_id", data.memberId)
        .maybeSingle(),
      runtimeDb
        .from("members")
        .select(
          "savings_balance, shares, fee_membership, fee_card, fee_sticker, fee_first_upfront_paid",
        )
        .eq("id", data.memberId)
        .maybeSingle(),
    ]);
    if (existingProfileResult.error) throw new Error(existingProfileResult.error.message);
    if (currentMemberResult.error) throw new Error(currentMemberResult.error.message);
    if (!currentMemberResult.data) throw new Error("Member not found.");

    const collectionBreakdown = {
      ...data.collectionBreakdown,
      totalDepositsRecorded: Math.max(
        0,
        Number(
          (data.collectionBreakdown as { totalDepositsRecorded?: unknown } | undefined)
            ?.totalDepositsRecorded ?? data.totalCollected,
        ) || 0,
      ),
    };
    const existingSnapshot = readPreCarryoverLiveState(
      existingProfileResult.data?.collection_breakdown,
    );
    const incomingSnapshot = readPreCarryoverLiveState(collectionBreakdown);
    if (!incomingSnapshot) {
      if (existingSnapshot) {
        collectionBreakdown.preCarryoverLiveState =
          serializableCarryoverLiveState(existingSnapshot);
      } else if (!existingProfileResult.data) {
        collectionBreakdown.preCarryoverLiveState = serializableCarryoverLiveState(
          liveStateFromMemberRow(currentMemberResult.data as Record<string, unknown>),
        );
      }
    }
    const totalCollected = Math.max(
      0,
      Number(
        (collectionBreakdown as { totalDepositsRecorded?: unknown }).totalDepositsRecorded ??
          data.totalCollected,
      ) || 0,
    );
    const policySettings = await loadRuntimePolicySettings(runtimeDb);
    const savingsThreshold = mandatorySavingsThresholdForSettings(policySettings);
    const savingsBalance = Math.min(data.savingsBalance, savingsThreshold);
    const savingsOverflow = Math.max(0, data.savingsBalance - savingsThreshold);
    const normalizedShares = normalizeShareBasketForThreshold({
      shares: data.shareUnits,
      settings: policySettings,
    });
    const thresholdOverflow = roundMoney(savingsOverflow + normalizedShares.overflow);
    if (thresholdOverflow > 0) {
      collectionBreakdown.purposePoolBalance = roundMoney(
        toNumber((collectionBreakdown as { purposePoolBalance?: unknown }).purposePoolBalance) +
          thresholdOverflow,
      );
    }
    const nonPurposeAllocated =
      savingsBalance +
      normalizedShares.cappedValue +
      data.feesPaidTotal +
      data.loanRepaymentsTotal +
      data.investmentBalance +
      data.otherCollectedTotal;
    const maxPurposePoolBalance = Math.max(0, roundMoney(totalCollected - nonPurposeAllocated));
    collectionBreakdown.purposePoolBalance = Math.min(
      toNumber((collectionBreakdown as { purposePoolBalance?: unknown }).purposePoolBalance),
      maxPurposePoolBalance,
    );

    const { error } = await runtimeDb.from("member_carryover_profiles").upsert({
      member_id: data.memberId,
      savings_balance: savingsBalance,
      share_units: normalizedShares.shares,
      fees_paid_total: data.feesPaidTotal,
      loan_repayments_total: data.loanRepaymentsTotal,
      investment_balance: data.investmentBalance,
      other_collected_total: data.otherCollectedTotal,
      total_collected: totalCollected,
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
      collection_breakdown: collectionBreakdown,
      notes: data.notes ?? null,
      created_by: actor.id,
      updated_by: actor.id,
    });
    if (error) throw new Error(error.message);

    const { error: memberError } = await runtimeDb
      .from("members")
      .update({
        savings_balance: savingsBalance,
        shares: normalizedShares.shares,
        share_reserve_balance: normalizedShares.shareReserveBalance,
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
        savingsBalance,
        shareUnits: normalizedShares.shares,
        overflowToPurposePool: thresholdOverflow,
        totalCollected,
        penaltiesOutstanding: data.penaltiesOutstanding,
        completedLoanCycles: data.completedLoanCycles,
      },
    });
    return { ok: true };
  });

export const resetMemberCarryoverRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { memberId: string }) => ({
    memberId: String(data?.memberId ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.memberId) throw new Error("Member id is required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { data: member, error: memberError } = await runtimeDb
      .from("members")
      .select(
        "id, savings_balance, shares, fee_membership, fee_card, fee_sticker, fee_first_upfront_paid",
      )
      .eq("id", data.memberId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new Error("Member not found.");

    const restored = {
      source: "cleared",
      savingsBalance: 0,
      shareUnits: 0,
      membershipFeePaid: false,
      cardFeePaid: false,
      stickerFeePaid: false,
      firstUpfrontPaid: false,
    };

    const { error: updateMemberError } = await runtimeDb
      .from("members")
      .update({
        savings_balance: restored.savingsBalance,
        shares: restored.shareUnits,
        fee_membership: restored.membershipFeePaid,
        fee_card: restored.cardFeePaid,
        fee_sticker: restored.stickerFeePaid,
        fee_first_upfront_paid: restored.firstUpfrontPaid,
      })
      .eq("id", data.memberId);
    if (updateMemberError) throw new Error(updateMemberError.message);

    const { error: loansDeleteError } = await runtimeDb
      .from("member_carryover_loans")
      .delete()
      .eq("member_id", data.memberId);
    if (loansDeleteError) throw new Error(loansDeleteError.message);

    const { error: profileDeleteError } = await runtimeDb
      .from("member_carryover_profiles")
      .delete()
      .eq("member_id", data.memberId);
    if (profileDeleteError) throw new Error(profileDeleteError.message);

    await auditAction({
      actor,
      action: "member_carryover.reset",
      targetType: "member_carryover_profile",
      targetId: data.memberId,
      summary: `${actor.name} reset carryover records for ${data.memberId}`,
      details: {
        restoredFrom: restored.source,
        savingsBalance: restored.savingsBalance,
        shareUnits: restored.shareUnits,
        membershipFeePaid: restored.membershipFeePaid,
        cardFeePaid: restored.cardFeePaid,
        stickerFeePaid: restored.stickerFeePaid,
        firstUpfrontPaid: restored.firstUpfrontPaid,
      },
    });

    return {
      ok: true,
      restoredFrom: restored.source,
      savingsBalance: restored.savingsBalance,
      shareUnits: restored.shareUnits,
    };
  });

export const upsertMemberCarryoverLoanRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id?: string;
      memberId: string;
      label: string;
      loanKind?: "financial" | "fuel" | "stock" | "service";
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
      feeBreakdown?: Record<string, unknown>;
      notes?: string;
    }) => ({
      id: String(data?.id ?? "").trim() || undefined,
      memberId: String(data?.memberId ?? "").trim(),
      label: String(data?.label ?? "").trim() || "Legacy loan",
      loanKind:
        data?.loanKind === "fuel" || data?.loanKind === "stock" || data?.loanKind === "service"
          ? data.loanKind
          : "financial",
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
      feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
        data?.feeBreakdown,
        Math.max(1, Math.floor(Number(data?.loanCycleNumber ?? 1))),
      ),
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
        loanCycleNumber: data.loanCycleNumber,
        feeBreakdown: data.feeBreakdown,
      },
      policySettings,
    );
    const status =
      computedSummary.totalOwedNow <= 0
        ? "closed"
        : data.status === "closed"
          ? computedSummary.dueDate < new Date().toISOString().slice(0, 10)
            ? "defaulted"
            : "active"
          : data.status;
    if (status !== "closed") {
      await assertNoDuplicateOpenLoanKind(runtimeDb, {
        memberId: data.memberId,
        loanKind: data.loanKind,
        excludeLoanId: id,
      });
    }
    const { error } = await runtimeDb.from("member_carryover_loans").upsert({
      id,
      member_id: data.memberId,
      label: data.label,
      loan_kind: data.loanKind,
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
      finished: computedSummary.totalOwedNow <= 0,
      penalty_waived_amount: data.penaltyWaivedAmount,
      fee_breakdown: data.feeBreakdown,
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
        loanKind: data.loanKind,
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

export const waiveLoanFollowupPenaltyRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      loanId: string;
      loanKind?: "live" | "carryover";
      amount?: number;
      note?: string;
    }) => ({
      loanId: String(data?.loanId ?? "").trim(),
      loanKind: data?.loanKind === "carryover" ? "carryover" : "live",
      amount: data?.amount == null ? undefined : Math.max(0, Number(data.amount)),
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.loanId) throw new Error("Loan id is required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    if (data.loanKind === "carryover") {
      const { data: loan, error } = await runtimeDb
        .from("member_carryover_loans")
        .select("*")
        .eq("id", data.loanId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!loan) throw new Error("Carryover loan not found.");

      const policySettings = await loadRuntimePolicySettings(runtimeDb);
      const summary = summarizeLegacyCarryoverLoan(mapCarryoverLoanForSummary(loan), policySettings);
      const waiveAmount = Math.min(
        summary.estimatedPenaltyNow,
        data.amount && data.amount > 0 ? data.amount : summary.estimatedPenaltyNow,
      );
      if (waiveAmount <= 0) throw new Error("There is no penalty amount to waive.");

      const nextWaived = toNumber(loan.penalty_waived_amount) + waiveAmount;
      const { error: updateError } = await runtimeDb
        .from("member_carryover_loans")
        .update({
          penalty_waived_amount: nextWaived,
          notes: [loan.notes, `Penalty waiver ${waiveAmount}/= by ${actor.name}${data.note ? ` - ${data.note}` : ""}`]
            .filter(Boolean)
            .join("\n"),
          updated_by: actor.id,
        })
        .eq("id", data.loanId);
      if (updateError) throw new Error(updateError.message);
      await refreshCarryoverMemberSummary(runtimeDb, loan.member_id);
      return { ok: true, waivedAmount: waiveAmount };
    }

    const { data: loan, error } = await runtimeDb
      .from("loans")
      .select("*")
      .eq("id", data.loanId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!loan) throw new Error("Loan not found.");
    const currentWaived = toNumber(loan.penalty_waived_amount);
    const waiveAmount = data.amount && data.amount > 0 ? data.amount : 0;
    if (waiveAmount <= 0) throw new Error("Enter the penalty amount to waive.");

    const { error: updateError } = await runtimeDb
      .from("loans")
      .update({
        penalty_waived_amount: currentWaived + waiveAmount,
        review_note: [loan.review_note, `Penalty waiver ${waiveAmount}/= by ${actor.name}${data.note ? ` - ${data.note}` : ""}`]
          .filter(Boolean)
          .join("\n"),
      })
      .eq("id", data.loanId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true, waivedAmount: waiveAmount };
  });

export const freezeLoanFollowupRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { loanId: string; loanKind?: "live" | "carryover"; note?: string }) => ({
      loanId: String(data?.loanId ?? "").trim(),
      loanKind: data?.loanKind === "carryover" ? "carryover" : "live",
      note: data?.note?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.loanId) throw new Error("Loan id is required.");

    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const frozenAt = new Date().toISOString().slice(0, 10);
    if (data.loanKind === "carryover") {
      const { data: loan, error } = await runtimeDb
        .from("member_carryover_loans")
        .select("*")
        .eq("id", data.loanId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!loan) throw new Error("Carryover loan not found.");
      const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
        asJsonObject(loan.fee_breakdown),
        Math.max(1, Math.floor(toNumber(loan.loan_cycle_number) || 1)),
      );
      const { error: updateError } = await runtimeDb
        .from("member_carryover_loans")
        .update({
          status: loan.status === "closed" ? "closed" : "defaulted",
          fee_breakdown: {
            ...feeBreakdown,
            productMeta: {
              ...(feeBreakdown.productMeta ?? {}),
              frozenAsOf: frozenAt,
              frozenBy: actor.id,
              frozenNote: data.note ?? null,
            },
          },
          notes: [loan.notes, `Loan frozen by ${actor.name} on ${frozenAt}${data.note ? ` - ${data.note}` : ""}`]
            .filter(Boolean)
            .join("\n"),
          updated_by: actor.id,
        })
        .eq("id", data.loanId);
      if (updateError) throw new Error(updateError.message);
      await refreshCarryoverMemberSummary(runtimeDb, loan.member_id);
      return { ok: true, frozenAt };
    }

    const { error: updateError } = await runtimeDb
      .from("loans")
      .update({
        frozen_at: frozenAt,
        frozen_note: data.note ?? null,
        status: "defaulted",
      })
      .eq("id", data.loanId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true, frozenAt };
  });

export const updateCurrentSnapshotRecord = createServerFn({ method: "POST" }).handler(async () => {
  const actor = await requireDirectorActor();
  const runtimeDb = (await requireSupabaseAdmin()) as any;
  const policySettings = await loadRuntimePolicySettings(runtimeDb);

  const [members, transactions, liveLoans, carryoverLoans] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(() =>
      runtimeDb
        .from("members")
        .select("id, old_system_id, savings_balance, shares, share_reserve_balance"),
    ),
    fetchAllRows<Record<string, unknown>>(() =>
      runtimeDb
        .from("transactions")
        .select("id, member_id, loan_id, account, date, created_at, type, amount")
        .order("date", { ascending: true }),
    ),
    fetchAllRows<Record<string, unknown>>(() => runtimeDb.from("loans").select("*")),
    fetchAllRows<Record<string, unknown>>(() =>
      runtimeDb.from("member_carryover_loans").select("*").order("start_date", { ascending: true }),
    ),
  ]);

  const memberIdByAlias = new Map<string, string>();
  for (const member of members) {
    const memberId = String(member.id ?? "").trim();
    if (!memberId) continue;
    for (const alias of membershipAccountAliases(memberId)) {
      memberIdByAlias.set(alias, memberId);
    }
    const oldSystemId = String(member.old_system_id ?? "").trim();
    if (oldSystemId) {
      for (const alias of membershipAccountAliases(oldSystemId)) {
        memberIdByAlias.set(alias, memberId);
      }
    }
  }

  const resolveSnapshotMemberId = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    for (const alias of membershipAccountAliases(raw)) {
      const memberId = memberIdByAlias.get(alias);
      if (memberId) return memberId;
    }
    return "";
  };

  const transactionsByMember = new Map<string, Record<string, unknown>[]>();
  const repaymentByLiveLoan = new Map<string, number>();
  const transactionMemberPatches: Array<{ id: string; memberId: string }> = [];

  for (const transaction of transactions) {
    const explicitMemberId = resolveSnapshotMemberId(transaction.member_id);
    const accountMemberId = resolveSnapshotMemberId(transaction.account);
    const memberId = explicitMemberId || accountMemberId;
    if (memberId) {
      const group = transactionsByMember.get(memberId) ?? [];
      group.push(transaction);
      transactionsByMember.set(memberId, group);

      const transactionId = String(transaction.id ?? "").trim();
      if (transactionId && String(transaction.member_id ?? "").trim() !== memberId) {
        transactionMemberPatches.push({ id: transactionId, memberId });
      }
    }

    if (String(transaction.type ?? "") === "loan_repayment") {
      const loanId = String(transaction.loan_id ?? "").trim();
      if (loanId) {
        repaymentByLiveLoan.set(
          loanId,
          roundMoney((repaymentByLiveLoan.get(loanId) ?? 0) + toNumber(transaction.amount as any)),
        );
      }
    }
  }

  let transactionsLinked = 0;
  for (const patch of transactionMemberPatches) {
    const { error } = await runtimeDb
      .from("transactions")
      .update({ member_id: patch.memberId })
      .eq("id", patch.id);
    if (error) throw new Error(error.message);
    transactionsLinked += 1;
  }

  let membersUpdated = 0;
  for (const member of members) {
    const memberId = String(member.id ?? "").trim();
    if (!memberId) continue;
    const memberTransactions = transactionsByMember.get(memberId) ?? [];
    const shareAmount = memberTransactions
      .filter((transaction) => String(transaction.type ?? "") === "share_purchase")
      .reduce((sum, transaction) => sum + toNumber(transaction.amount as any), 0);
    const savingsTransactions = memberTransactions.filter((transaction) =>
      ["deposit", "withdrawal"].includes(String(transaction.type ?? "")),
    );

    const patch: Record<string, unknown> = {};
    let snapshotOverflowToPurposePool = 0;
    if (shareAmount > 0) {
      const shareUnits = Math.floor(shareAmount / SHARE_PRICE);
      const shareReserveBalance = roundMoney(shareAmount - shareUnits * SHARE_PRICE);
      const normalizedShares = normalizeShareBasketForThreshold({
        shares: shareUnits,
        shareReserveBalance,
        settings: policySettings,
      });
      patch.shares = normalizedShares.shares;
      patch.share_reserve_balance = normalizedShares.shareReserveBalance;
      snapshotOverflowToPurposePool = roundMoney(
        snapshotOverflowToPurposePool + normalizedShares.overflow,
      );
    }
    if (savingsTransactions.length > 0) {
      const savingsBalance = roundMoney(
        savingsTransactions.reduce((sum, transaction) => {
          const amount = toNumber(transaction.amount as any);
          return String(transaction.type ?? "") === "withdrawal" ? sum - amount : sum + amount;
        }, 0),
      );
      const savingsThreshold = mandatorySavingsThresholdForSettings(policySettings);
      patch.savings_balance = Math.min(savingsBalance, savingsThreshold);
      snapshotOverflowToPurposePool = roundMoney(
        snapshotOverflowToPurposePool + Math.max(0, savingsBalance - savingsThreshold),
      );
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await runtimeDb.from("members").update(patch).eq("id", memberId);
      if (error) throw new Error(error.message);
      membersUpdated += 1;
    }

    if (snapshotOverflowToPurposePool > 0) {
      await adjustStoredMemberDocketBalance({
        runtimeDb,
        memberId,
        docket: "purpose_pool",
        delta: snapshotOverflowToPurposePool,
        protected: true,
      });
      await recordInvariantDocketMovement({
        runtimeDb,
        memberId,
        fromDocket: null,
        toDocket: "purpose_pool",
        amount: snapshotOverflowToPurposePool,
        actorId: actor.id,
        reason: "Current snapshot repair: moved threshold overflow into purpose pool",
      });
    }

    const repair = await repairMemberFinancialInvariants({
      runtimeDb,
      memberId,
      actorId: actor.id,
      reason: "Current snapshot repair",
      capPurposePoolToLifetimeNet: true,
    });
    if (repair.changed && Object.keys(patch).length === 0) {
      membersUpdated += 1;
    }
  }

  let liveLoansUpdated = 0;
  for (const loan of liveLoans) {
    const loanId = String(loan.id ?? "").trim();
    if (!loanId || !repaymentByLiveLoan.has(loanId)) continue;
    const paid = repaymentByLiveLoan.get(loanId) ?? 0;
    const summary = loanBalanceSummary({ ...(loan as any), paid });
    const currentStatus = String(loan.status ?? "active");
    const nextStatus =
      summary.balance <= 0 && currentStatus !== "rejected" && currentStatus !== "pending"
        ? "closed"
        : currentStatus;
    const { error } = await runtimeDb
      .from("loans")
      .update({ paid, status: nextStatus })
      .eq("id", loanId);
    if (error) throw new Error(error.message);
    liveLoansUpdated += 1;
  }

  const carryoverByMember = new Map<string, Record<string, unknown>[]>();
  for (const loan of carryoverLoans) {
    const memberId = String(loan.member_id ?? "").trim();
    if (!memberId) continue;
    const group = carryoverByMember.get(memberId) ?? [];
    group.push(loan);
    carryoverByMember.set(memberId, group);
  }

  let carryoverLoansUpdated = 0;
  const carryoverMembersUpdated = new Set<string>();
  for (const [memberId, loans] of carryoverByMember) {
    const memberTransactions = transactionsByMember.get(memberId) ?? [];
    const inflow = memberTransactions
      .filter((transaction) =>
        [
          "deposit",
          "loan_repayment",
          "share_purchase",
          "fee_payment",
          "investor_contribution",
        ].includes(String(transaction.type ?? "")),
      )
      .reduce((sum, transaction) => sum + toNumber(transaction.amount as any), 0);
    const outflow = memberTransactions
      .filter((transaction) =>
        ["withdrawal", "loan_disbursement"].includes(String(transaction.type ?? "")),
      )
      .reduce((sum, transaction) => sum + toNumber(transaction.amount as any), 0);
    let remaining = Math.max(0, roundMoney(inflow - outflow));
    const sortedLoans = sortOpenLoansByDispatchDate(loans as any[]);

    for (const loan of sortedLoans) {
      const summary = summarizeLegacyCarryoverLoan(
        { ...mapCarryoverLoanForSummary(loan), paidToDate: 0 },
        policySettings,
      );
      const fullExpected = summary.totalExpectedCollected;
      const applied = Math.min(remaining, fullExpected);
      remaining = roundMoney(remaining - applied);
      const status = applied >= fullExpected ? "closed" : String(loan.status ?? "active");
      const finished = applied >= fullExpected;
      const { error } = await runtimeDb
        .from("member_carryover_loans")
        .update({
          paid_to_date: applied,
          status: finished ? "closed" : status === "closed" ? "active" : status,
          finished,
          closed_on: finished ? String(loan.due_date ?? summary.dueDate) : null,
        })
        .eq("id", String(loan.id));
      if (error) throw new Error(error.message);
      carryoverLoansUpdated += 1;
      carryoverMembersUpdated.add(memberId);
    }
  }

  for (const memberId of carryoverMembersUpdated) {
    await refreshCarryoverMemberSummary(runtimeDb, memberId);
  }

  await auditAction({
    actor,
    action: "snapshot.current_updated",
    targetType: "system",
    targetId: "current_snapshot",
    summary: `${actor.name} updated current records using current system logic`,
    details: {
      membersUpdated,
      liveLoansUpdated,
      carryoverLoansUpdated,
      transactionsLinked,
      sharePrice: SHARE_PRICE,
    },
  });

  return {
    membersUpdated,
    liveLoansUpdated,
    carryoverLoansUpdated,
    transactionsLinked,
    sharePrice: SHARE_PRICE,
  };
});

function mapCarryoverLoanForSummary(row: any) {
  return {
    principal: toNumber(row.principal),
    interestRatePct: toNumber(row.interest_rate_pct),
    termDays: Number(row.term_days ?? 30) as 7 | 14 | 30 | 60 | 90,
    dailySavingsAmount: toNumber(row.daily_savings_amount),
    startDate: String(row.start_date ?? new Date().toISOString().slice(0, 10)),
    dueDate: row.due_date ?? undefined,
    paidToDate: toNumber(row.paid_to_date),
    status: row.status ?? "active",
    finished: row.finished === true,
    penaltyWaivedAmount: toNumber(row.penalty_waived_amount),
    loanCycleNumber: Math.max(1, Math.floor(toNumber(row.loan_cycle_number) || 1)),
    feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
      asJsonObject(row.fee_breakdown),
      Math.max(1, Math.floor(toNumber(row.loan_cycle_number) || 1)),
    ),
  };
}

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
