import { createServerFn } from "@tanstack/react-start";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  requireDirectorActor,
  requireMemberActor,
  requireSignedInSession,
  requireStaffActor,
} from "@/lib/auth.server";
import {
  deriveCarryoverPaidToDateByLoan,
  normalizeLegacyCarryoverLoanFeeBreakdown,
  summarizeLegacyCarryoverLoan,
} from "@/lib/legacy-finance";
import {
  DEFAULT_POLICY_SETTINGS,
  mergePolicySettings,
  type PolicySettings,
  type PolicySettingRow,
} from "@/lib/policy-settings";

type DbRow = Record<string, unknown>;
const SUPABASE_PAGE_SIZE = 1000;

function requireSupabaseAdmin() {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error(
      "Database sync is unavailable until the server has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured.",
    );
  }
  return supabaseAdmin;
}

function readText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown) {
  const next = readText(value).trim();
  return next || undefined;
}

function readNumber(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

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

function mapPolicySettingRow(row: DbRow): PolicySettingRow {
  return {
    key: readText(row.key),
    label: readText(row.label),
    value: row.value ?? {},
    notes: optionalText(row.notes),
    updatedAt: optionalText(row.updated_at),
  };
}

async function loadRuntimePolicySettings(runtimeDb: any): Promise<PolicySettings> {
  const { data, error } = await runtimeDb.from("policy_settings").select("*");
  if (error) {
    if (isMissingRelationError(error)) return DEFAULT_POLICY_SETTINGS;
    throw new Error(error.message);
  }
  return mergePolicySettings((data ?? []).map((row: DbRow) => mapPolicySettingRow(row)));
}

function mapStaffMessageRow(row: DbRow) {
  const attachment =
    row.attachment && typeof row.attachment === "object"
      ? (row.attachment as Record<string, unknown>)
      : null;

  return {
    id: readText(row.id),
    senderId: readText(row.sender_id),
    receiverId: readText(row.receiver_id),
    senderName: readText(row.sender_name),
    content: optionalText(row.content),
    attachment: attachment
      ? {
          name: readText(attachment.name) || "attachment",
          type: readText(attachment.type) || "application/octet-stream",
          size: readNumber(attachment.size),
          data: readText(attachment.data),
        }
      : undefined,
    createdAt: readText(row.created_at),
  };
}

function mapMemoRow(row: DbRow) {
  const letterMeta =
    row.letter_meta && typeof row.letter_meta === "object"
      ? (row.letter_meta as Record<string, unknown>)
      : {};
  return {
    id: readText(row.id),
    date: readText(row.memo_date),
    title: readText(row.title),
    body: readText(row.body),
    by: readText(row.by_name),
    byStaffId: optionalText(row.by_staff_id),
    audience: optionalText(row.audience) ?? "staff",
    targetMemberId: optionalText(row.target_member_id),
    targetSupplierId: optionalText(row.target_supplier_id),
    kind: optionalText(row.notice_kind) ?? "info",
    expiresAt: optionalText(row.expires_at),
    documentKind: optionalText(row.document_kind) ?? "memo",
    letterMeta,
    createdAt: readText(row.created_at),
  };
}

function mapApprovalRow(row: DbRow) {
  return {
    id: readText(row.id),
    kind: readText(row.kind),
    title: readText(row.title),
    detail: readText(row.detail),
    requestedBy: readText(row.requested_by),
    requestedByName: optionalText(row.requested_by_name),
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : undefined,
    status: readText(row.status) as "pending" | "approved" | "rejected",
    createdAt: readText(row.created_at),
    reviewedBy: optionalText(row.reviewed_by),
    reviewNote: optionalText(row.review_note),
    reviewedAt: optionalText(row.reviewed_at),
  };
}

function mapFeePolicyRow(row: DbRow) {
  return {
    key: readText(row.key),
    label: readText(row.label),
    amount: readNumber(row.amount),
    permanence: readText(row.permanence) as "permanent" | "semi",
    durationDays:
      row.duration_days == null
        ? undefined
        : Math.max(0, Math.floor(readNumber(row.duration_days))),
    effectiveFrom: readText(row.effective_from),
    scope: readText(row.scope) as
      | "all"
      | "new_only"
      | "selected_members"
      | "loan_holders"
      | "investors",
    selectedMemberIds: Array.isArray(row.selected_member_ids)
      ? row.selected_member_ids.map((value) => readText(value)).filter(Boolean)
      : [],
    custom: row.custom === true,
    notes: optionalText(row.notes),
    updatedAt: readText(row.updated_at),
  };
}

function mapPerformanceTargetRow(row: DbRow) {
  return {
    id: readText(row.id),
    metric: readText(row.metric),
    period: readText(row.period),
    expectedValue: readNumber(row.expected_value),
    startOn: readText(row.start_on),
    notes: optionalText(row.notes),
    createdAt: readText(row.created_at),
    updatedAt: readText(row.updated_at),
  };
}

function mapServiceCatalogRow(row: DbRow) {
  const customCharges = Array.isArray(row.custom_charges)
    ? row.custom_charges
    : row.custom_charges && typeof row.custom_charges === "object"
      ? [row.custom_charges]
      : [];
  return {
    id: readText(row.id),
    name: readText(row.name),
    serviceCategory: optionalText(row.service_category),
    description: optionalText(row.description),
    price: readNumber(row.price),
    billingFrequency: readText(row.billing_frequency) || "monthly",
    scope: readText(row.scope) || "all_members",
    selectedMemberIds: Array.isArray(row.selected_member_ids)
      ? row.selected_member_ids.map((value) => readText(value)).filter(Boolean)
      : [],
    deductionMode: readText(row.deduction_mode) || "normal",
    feeOverrides:
      row.fee_overrides && typeof row.fee_overrides === "object"
        ? (row.fee_overrides as Record<string, unknown>)
        : {},
    effectiveDate: optionalText(row.effective_date),
    expiryDate: optionalText(row.expiry_date),
    registrationFee: readNumber(row.registration_fee),
    processingFee: readNumber(row.processing_fee),
    serviceCharge: readNumber(row.service_charge),
    waiverAmount: readNumber(row.waiver_amount),
    penaltyAmount: readNumber(row.penalty_amount),
    customCharges,
    negotiatedDiscountAmount: readNumber(row.negotiated_discount_amount),
    normalDeductions:
      row.normal_deductions && typeof row.normal_deductions === "object"
        ? (row.normal_deductions as Record<string, unknown>)
        : {},
    gracePeriodDays: Math.max(0, Math.floor(readNumber(row.grace_period_days))),
    renewalRules:
      row.renewal_rules && typeof row.renewal_rules === "object"
        ? (row.renewal_rules as Record<string, unknown>)
        : {},
    active: row.active !== false,
    createdBy: optionalText(row.created_by),
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at),
  };
}

function mapCountyChargeScheduleRow(row: DbRow) {
  return {
    id: readText(row.id),
    county: readText(row.county) || "Kiambu",
    scheduleVersion: readText(row.schedule_version) || "default",
    code: readText(row.code),
    description: readText(row.description),
    businessType: optionalText(row.business_type),
    fireAmount: readNumber(row.fire_amount),
    swAmount: readNumber(row.sw_amount),
    sbpAmount: readNumber(row.sbp_amount),
    appAmount: readNumber(row.app_amount),
    phoAmount: readNumber(row.pho_amount),
    phoInspectionAmount: readNumber(row.pho_inspection_amount),
    otherAmount: readNumber(row.other_amount),
    totalAmount: readNumber(row.total_amount),
    effectiveFrom: optionalText(row.effective_from),
    effectiveTo: optionalText(row.effective_to),
    active: row.active !== false,
    updatedAt: optionalText(row.updated_at),
  };
}

function mapServiceApplicationRow(row: DbRow) {
  return {
    id: readText(row.id),
    applicationNumber: readText(row.application_number),
    memberId: readText(row.member_id),
    serviceId: optionalText(row.service_id),
    applicationKind: readText(row.application_kind) || "new",
    serviceType: optionalText(row.service_type),
    caseType: readText(row.case_type) || "normal",
    priority: readText(row.priority) || "normal",
    problemReason: optionalText(row.problem_reason),
    notes: optionalText(row.notes),
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    county: optionalText(row.county),
    subcounty: optionalText(row.subcounty),
    ward: optionalText(row.ward),
    town: optionalText(row.town),
    scheduleId: optionalText(row.schedule_id),
    invoiceReference: optionalText(row.invoice_reference),
    invoiceNumber: optionalText(row.invoice_number),
    invoiceDate: optionalText(row.invoice_date),
    invoiceAmountCharged: readNumber(row.invoice_amount_charged),
    issueDate: optionalText(row.issue_date),
    expiryDate: optionalText(row.expiry_date),
    renewalWindowDays: Math.max(0, Math.floor(readNumber(row.renewal_window_days))),
    gracePeriodDays: Math.max(0, Math.floor(readNumber(row.grace_period_days))),
    confiscationReference: optionalText(row.confiscation_reference),
    inventorySheetNumber: optionalText(row.inventory_sheet_number),
    confiscationDate: optionalText(row.confiscation_date),
    status: readText(row.status) || "submitted",
    paymentStatus: readText(row.payment_status) || "pending",
    workflowStage: readText(row.workflow_stage) || "application_submitted",
    calculatedCharges:
      row.calculated_charges && typeof row.calculated_charges === "object"
        ? (row.calculated_charges as Record<string, unknown>)
        : {},
    createdBy: optionalText(row.created_by),
    assignedTo: optionalText(row.assigned_to),
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at),
  };
}

function mapMemberServiceSubscriptionRow(row: DbRow) {
  return {
    memberId: readText(row.member_id),
    serviceId: readText(row.service_id),
    status: readText(row.status) || "active",
    assignedBy: optionalText(row.assigned_by),
    assignedAt: optionalText(row.assigned_at),
    updatedAt: optionalText(row.updated_at),
  };
}

function mapCarryoverProfileRow(row: DbRow) {
  return {
    memberId: readText(row.member_id),
    savingsBalance: readNumber(row.savings_balance),
    shareUnits: Math.max(0, Math.floor(readNumber(row.share_units))),
    feesPaidTotal: readNumber(row.fees_paid_total),
    loanRepaymentsTotal: readNumber(row.loan_repayments_total),
    investmentBalance: readNumber(row.investment_balance),
    otherCollectedTotal: readNumber(row.other_collected_total),
    totalCollected: readNumber(row.total_collected),
    pendingBalance: readNumber(row.pending_balance),
    penaltiesOutstanding: readNumber(row.penalties_outstanding),
    penaltiesWaivedTotal: readNumber(row.penalties_waived_total),
    membershipFeePaid: row.membership_fee_paid === true,
    cardFeePaid: row.card_fee_paid === true,
    stickerFeePaid: row.sticker_fee_paid === true,
    firstUpfrontPaid: row.first_upfront_paid === true,
    completedLoanCycles: Math.max(0, Math.floor(readNumber(row.completed_loan_cycles))),
    firstLoanStartDate: optionalText(row.first_loan_start_date),
    lastLoanEndDate: optionalText(row.last_loan_end_date),
    collectionBreakdown:
      row.collection_breakdown && typeof row.collection_breakdown === "object"
        ? (row.collection_breakdown as Record<string, unknown>)
        : {},
    notes: optionalText(row.notes),
    createdBy: optionalText(row.created_by),
    updatedBy: optionalText(row.updated_by),
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at),
  };
}

function normalizeCarryoverStatus(value: unknown) {
  return value === "closed" || value === "defaulted" || value === "active" ? value : "active";
}

function mapCarryoverLoanRow(
  row: DbRow,
  options?: {
    paidToDate?: number;
    deriveStatus?: boolean;
    settings?: PolicySettings;
    asOfDate?: string;
  },
) {
  const loanCycleNumber = Math.max(1, Math.floor(readNumber(row.loan_cycle_number)));
  const paidToDate = options?.paidToDate ?? readNumber(row.paid_to_date);
  const loan = {
    id: readText(row.id),
    memberId: readText(row.member_id),
    label: readText(row.label) || "Legacy loan",
    loanKind:
      readText(row.loan_kind) === "fuel" ||
      readText(row.loan_kind) === "stock" ||
      readText(row.loan_kind) === "service"
        ? (readText(row.loan_kind) as "fuel" | "stock" | "service")
        : "financial",
    loanCycleNumber,
    principal: readNumber(row.principal),
    interestRatePct: readNumber(row.interest_rate_pct),
    termDays: Math.max(1, Math.floor(readNumber(row.term_days))),
    dailySavingsAmount: readNumber(row.daily_savings_amount),
    startDate: readText(row.start_date),
    dueDate: optionalText(row.due_date),
    closedOn: optionalText(row.closed_on),
    paidToDate,
    status: normalizeCarryoverStatus(readText(row.status)) as "active" | "closed" | "defaulted",
    finished: row.finished === true,
    penaltyWaivedAmount: readNumber(row.penalty_waived_amount),
    feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
      row.fee_breakdown && typeof row.fee_breakdown === "object"
        ? (row.fee_breakdown as Record<string, unknown>)
        : {},
      loanCycleNumber,
    ),
    notes: optionalText(row.notes),
    createdBy: optionalText(row.created_by),
    updatedBy: optionalText(row.updated_by),
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at),
  };
  if (!options?.deriveStatus) return loan;

  const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
  const summary = summarizeLegacyCarryoverLoan(
    loan,
    options.settings ?? DEFAULT_POLICY_SETTINGS,
    asOfDate,
  );
  const status =
    summary.totalOwedNow <= 0
      ? "closed"
      : summary.dueDate < asOfDate || loan.status === "defaulted"
        ? "defaulted"
        : "active";

  return {
    ...loan,
    status,
    finished: status === "closed",
    closedOn: status === "closed" ? (loan.closedOn ?? summary.dueDate) : undefined,
  };
}

async function listCarryoverRepaymentLedgerRows(runtimeDb: any, memberIds: string[]) {
  const uniqueMemberIds = Array.from(new Set(memberIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueMemberIds.length === 0) {
    return { transactions: [] as DbRow[], allocations: [] as DbRow[] };
  }

  const transactions = await fetchAllRows<DbRow>(() =>
    runtimeDb
      .from("transactions")
      .select("id, member_id, loan_id, type, amount, note, date, created_at")
      .in("member_id", uniqueMemberIds)
      .order("created_at", { ascending: true }),
  );

  let allocations: DbRow[] = [];
  try {
    allocations = await fetchAllRows<DbRow>(() =>
      runtimeDb
        .from("mpesa_receipt_allocations")
        .select("id, member_id, loan_id, transaction_id, allocation_type, amount, note, created_at")
        .in("member_id", uniqueMemberIds)
        .eq("allocation_type", "carryover_loan_repayment")
        .order("created_at", { ascending: true }),
    );
  } catch (error: any) {
    if (!isMissingRelationError(error)) throw error;
  }

  return { transactions, allocations };
}

async function mapCarryoverLoanRowsWithLedger(runtimeDb: any, rows: DbRow[]) {
  const memberIds = rows.map((row) => readText(row.member_id)).filter(Boolean);
  const [settings, ledger] = await Promise.all([
    loadRuntimePolicySettings(runtimeDb),
    listCarryoverRepaymentLedgerRows(runtimeDb, memberIds),
  ]);
  const paidByLoanId = deriveCarryoverPaidToDateByLoan({
    loans: rows.map((row) => ({ id: readText(row.id), memberId: readText(row.member_id) })),
    transactions: ledger.transactions,
    allocations: ledger.allocations,
  });

  return rows.map((row) => {
    const loanId = readText(row.id);
    const hasLedgerPaid = paidByLoanId.has(loanId);
    return mapCarryoverLoanRow(row, {
      paidToDate: hasLedgerPaid ? (paidByLoanId.get(loanId) ?? 0) : undefined,
      deriveStatus: hasLedgerPaid,
      settings,
    });
  });
}

function mapReportSnapshotRow(row: DbRow) {
  return {
    id: readText(row.id),
    reportKey: readText(row.report_key),
    title: readText(row.title),
    periodStart: readText(row.period_start),
    periodEnd: readText(row.period_end),
    filters:
      row.filters && typeof row.filters === "object"
        ? (row.filters as Record<string, unknown>)
        : {},
    summary:
      row.summary && typeof row.summary === "object"
        ? (row.summary as Record<string, unknown>)
        : {},
    chartData:
      row.chart_data && typeof row.chart_data === "object"
        ? (row.chart_data as Record<string, unknown>)
        : {},
    generatedBy: optionalText(row.generated_by),
    createdAt: readText(row.created_at),
  };
}

function groupSupportMessages(rows: DbRow[]) {
  const grouped = new Map<string, DbRow[]>();
  for (const row of rows) {
    const threadId = readText(row.thread_id);
    const list = grouped.get(threadId) ?? [];
    list.push(row);
    grouped.set(threadId, list);
  }
  return grouped;
}

function mapSupportThreadRow(row: DbRow, supportMessagesByThread: Map<string, DbRow[]>) {
  return {
    id: readText(row.id),
    memberId: readText(row.member_id),
    memberName: readText(row.member_name),
    assignedStaffId: optionalText(row.assigned_staff_id),
    status: readText(row.status) as "ai" | "open" | "claimed" | "closed",
    subject: readText(row.subject),
    createdAt: readText(row.created_at),
    updatedAt: readText(row.updated_at),
    messages: (supportMessagesByThread.get(readText(row.id)) ?? []).map((message) => ({
      id: readText(message.id),
      from: readText(message.sender_kind) as "member" | "ai" | "staff",
      fromName: readText(message.sender_name),
      fromId: optionalText(message.sender_id),
      text: readText(message.text),
      at: readText(message.created_at),
    })),
  };
}

export const listStaffMessages = createServerFn({ method: "POST" }).handler(async () => {
  const actor = await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("staff_messages")
    .select("*")
    .or(`sender_id.eq.${actor.id},receiver_id.eq.${actor.id}`)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapStaffMessageRow(row as DbRow));
});

export const listStaffMemos = createServerFn({ method: "POST" }).handler(async () => {
  await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("staff_memos")
    .select("*")
    .order("memo_date", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapMemoRow(row as DbRow));
});

export const listClientNotices = createServerFn({ method: "GET" })
  .inputValidator((data: { memberId?: string } | undefined) => ({
    memberId: data?.memberId?.trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    let targetMemberId = data.memberId ?? "";
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      targetMemberId = member.id;
    } else {
      await requireStaffActor();
    }

    const today = new Date().toISOString().slice(0, 10);
    const supabaseAdmin = requireSupabaseAdmin();
    const { data: rows, error } = await supabaseAdmin
      .from("staff_memos")
      .select("*")
      .in("audience", ["members", "member", "all"])
      .or(`expires_at.is.null,expires_at.gte.${today}`)
      .order("memo_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      if (
        isMissingColumnError(error, "audience") ||
        isMissingColumnError(error, "expires_at") ||
        isMissingColumnError(error, "target_member_id")
      ) {
        return [];
      }
      throw new Error(error.message);
    }
    return (rows ?? [])
      .filter((row) => {
        const memo = row as DbRow;
        if (readText(memo.audience) !== "member") return true;
        return !!targetMemberId && readText(memo.target_member_id) === targetMemberId;
      })
      .map((row) => mapMemoRow(row as DbRow));
  });

export const listSupplierNotices = createServerFn({ method: "GET" })
  .inputValidator((data: { supplierId?: string } | undefined) => ({
    supplierId: data?.supplierId?.trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    const supabaseAdmin = requireSupabaseAdmin();
    let targetSupplierId = data.supplierId ?? "";

    if (session.authMode === "member") {
      const member = await requireMemberActor();
      const { data: supplier, error: supplierError } = await supabaseAdmin
        .from("suppliers")
        .select("id")
        .eq("member_id", member.id)
        .maybeSingle();
      if (supplierError) throw new Error(supplierError.message);
      targetSupplierId = readText((supplier as DbRow | null)?.id);
    } else {
      await requireStaffActor();
    }

    if (!targetSupplierId) return [];

    const today = new Date().toISOString().slice(0, 10);
    const { data: rows, error } = await supabaseAdmin
      .from("staff_memos")
      .select("*")
      .in("audience", ["suppliers", "supplier", "all"])
      .or(`expires_at.is.null,expires_at.gte.${today}`)
      .order("memo_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(40);

    if (error) {
      if (
        isMissingColumnError(error, "audience") ||
        isMissingColumnError(error, "expires_at") ||
        isMissingColumnError(error, "target_supplier_id")
      ) {
        return [];
      }
      throw new Error(error.message);
    }

    return (rows ?? [])
      .filter((row) => {
        const memo = row as DbRow;
        if (readText(memo.audience) !== "supplier") return true;
        return readText(memo.target_supplier_id) === targetSupplierId;
      })
      .map((row) => mapMemoRow(row as DbRow));
  });

export const listApprovalRequests = createServerFn({ method: "POST" }).handler(async () => {
  await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("approval_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapApprovalRow(row as DbRow));
});

export const listFeePolicies = createServerFn({ method: "POST" }).handler(async () => {
  await requireSignedInSession();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("fee_policies")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapFeePolicyRow(row as DbRow));
});

export const listServiceCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSignedInSession();
  if (session.authMode !== "member") await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  let query = supabaseAdmin
    .from("service_catalog")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });
  if (session.authMode === "member") query = query.eq("active", true);
  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapServiceCatalogRow(row as DbRow));
});

export const listCountyChargeSchedules = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("county_charge_schedules")
    .select("*")
    .order("active", { ascending: false })
    .order("county", { ascending: true })
    .order("code", { ascending: true });
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapCountyChargeScheduleRow(row as DbRow));
});

export const listServiceApplications = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("service_applications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapServiceApplicationRow(row as DbRow));
});

export const listMemberServiceSubscriptions = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaffActor();
    const supabaseAdmin = requireSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("member_service_subscriptions")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => mapMemberServiceSubscriptionRow(row as DbRow));
  },
);

export const listServiceAdministrationReports = createServerFn({ method: "GET" }).handler(
  async () => {
    await requireStaffActor();
    const supabaseAdmin = requireSupabaseAdmin();
    const [dashboardResult, memberReportsResult, invoicesResult, allocationsResult] =
      await Promise.all([
        supabaseAdmin.from("service_module_dashboard").select("*").maybeSingle(),
        supabaseAdmin.from("service_member_reports").select("*").order("name", { ascending: true }),
        supabaseAdmin
          .from("service_billing_invoices")
          .select("*")
          .order("issued_at", { ascending: false })
          .limit(200),
        supabaseAdmin
          .from("locomotive_business_wallet_allocations")
          .select("*")
          .order("allocated_at", { ascending: false })
          .limit(200),
      ]);

    const failed = [dashboardResult, memberReportsResult, invoicesResult, allocationsResult].find(
      (result) => result.error && !isMissingRelationError(result.error),
    );
    if (failed?.error) throw new Error(failed.error.message);

    return {
      dashboard: dashboardResult.error ? null : ((dashboardResult.data ?? null) as DbRow | null),
      members: memberReportsResult.error ? [] : ((memberReportsResult.data ?? []) as DbRow[]),
      invoices: invoicesResult.error ? [] : ((invoicesResult.data ?? []) as DbRow[]),
      locomotiveAllocations: allocationsResult.error
        ? []
        : ((allocationsResult.data ?? []) as DbRow[]),
    };
  },
);

export const listLocomotiveBusinessWorkspace = createServerFn({ method: "GET" })
  .inputValidator((data: { adminStaffId?: string } | undefined) => ({
    adminStaffId: String(data?.adminStaffId ?? "").trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    const supabaseAdmin = requireSupabaseAdmin();
    const canInspectAll = actor.role === "director" || actor.role === "manager";
    const selectedAdminStaffId = actor.role === "locomotive_admin" ? actor.id : data.adminStaffId;

    const adminsResult = await supabaseAdmin
      .from("staff")
      .select("id, name, email, phone, member_id, role, active")
      .eq("role", "locomotive_admin")
      .order("name", { ascending: true });
    if (adminsResult.error && !isMissingRelationError(adminsResult.error)) {
      throw new Error(adminsResult.error.message);
    }
    const locomotiveAdmins = adminsResult.error ? [] : ((adminsResult.data ?? []) as DbRow[]);
    const selectedAdmin = selectedAdminStaffId
      ? (locomotiveAdmins.find((row) => readText(row.id) === selectedAdminStaffId) ?? null)
      : null;
    const selectedAdminMemberId = readText(selectedAdmin?.member_id);
    const adminStaffFilter =
      selectedAdminStaffId && (actor.role === "locomotive_admin" || canInspectAll)
        ? selectedAdminStaffId
        : "";

    const memberQuery = supabaseAdmin
      .from("members")
      .select("*")
      .eq("locomotive_business_member", true)
      .order("joined_at", { ascending: false });
    if (adminStaffFilter) memberQuery.eq("locomotive_admin_staff_id", adminStaffFilter);

    const allocationQuery = supabaseAdmin
      .from("locomotive_business_wallet_allocations")
      .select("*")
      .order("allocated_at", { ascending: false })
      .limit(200);
    if (adminStaffFilter) allocationQuery.eq("admin_staff_id", adminStaffFilter);

    const depositQuery = supabaseAdmin
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    const depositMemberId =
      actor.role === "locomotive_admin" ? actor.memberId : selectedAdminMemberId;
    if (depositMemberId) depositQuery.eq("member_id", depositMemberId);

    const actorMemberQuery = depositMemberId
      ? supabaseAdmin.from("members").select("*").eq("id", depositMemberId).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const docketBalancesQuery = depositMemberId
      ? supabaseAdmin
          .from("member_docket_balances")
          .select("docket, amount")
          .eq("member_id", depositMemberId)
          .in("docket", ["withdrawable_savings", "loan_savings"])
      : Promise.resolve({ data: [], error: null });

    const [
      membersResult,
      allocationsResult,
      servicesResult,
      depositsResult,
      actorMemberResult,
      docketBalancesResult,
    ] = await Promise.all([
      memberQuery,
      allocationQuery,
      supabaseAdmin
        .from("service_catalog")
        .select("*")
        .eq("active", true)
        .eq("service_category", "locomotive_business_wallet")
        .order("name", { ascending: true }),
      depositQuery,
      actorMemberQuery,
      docketBalancesQuery,
    ]);

    const failed = [
      membersResult,
      allocationsResult,
      servicesResult,
      depositsResult,
      actorMemberResult,
      docketBalancesResult,
    ].find((result) => result.error && !isMissingRelationError(result.error));
    if (failed?.error) throw new Error(failed.error.message);

    const deposits = depositsResult.error ? [] : ((depositsResult.data ?? []) as DbRow[]);
    const depositTotal = deposits
      .filter((row) => readText(row.type) === "deposit")
      .reduce((sum, row) => sum + readNumber(row.amount), 0);
    const allocations = allocationsResult.error ? [] : ((allocationsResult.data ?? []) as DbRow[]);
    const allocatedTotal = allocations
      .filter(
        (row) =>
          readText(row.status || "confirmed") === "confirmed" &&
          readText(row.payment_method || "mpesa") !== "cash",
      )
      .reduce((sum: number, row: DbRow) => sum + readNumber(row.gross_amount), 0);
    const pendingTotal = allocations
      .filter((row) => readText(row.status || "confirmed") === "pending")
      .reduce((sum: number, row: DbRow) => sum + readNumber(row.gross_amount), 0);
    const cashTotal = allocations
      .filter(
        (row) =>
          readText(row.status || "confirmed") === "confirmed" &&
          readText(row.payment_method || "mpesa") === "cash",
      )
      .reduce((sum: number, row: DbRow) => sum + readNumber(row.gross_amount), 0);
    const docketBalances = docketBalancesResult.error
      ? []
      : ((docketBalancesResult.data ?? []) as DbRow[]);
    const withdrawableSavingsBalance = docketBalances
      .filter((row) => readText(row.docket) === "withdrawable_savings")
      .reduce((sum: number, row: DbRow) => sum + readNumber(row.amount), 0);
    const loanSavingsBalance = docketBalances
      .filter((row) => readText(row.docket) === "loan_savings")
      .reduce((sum: number, row: DbRow) => sum + readNumber(row.amount), 0);

    return {
      actorMemberId: depositMemberId ?? "",
      actorMember: actorMemberResult.error
        ? null
        : ((actorMemberResult.data ?? null) as DbRow | null),
      selectedAdminStaffId: adminStaffFilter,
      selectedAdmin,
      locomotiveAdmins,
      members: membersResult.error ? [] : ((membersResult.data ?? []) as DbRow[]),
      allocations,
      services: servicesResult.error ? [] : ((servicesResult.data ?? []) as DbRow[]),
      deposits,
      depositTotal,
      allocatedTotal,
      pendingTotal,
      cashTotal,
      availableBalance: Math.max(0, depositTotal - allocatedTotal),
      withdrawableSavingsBalance,
      loanSavingsBalance,
    };
  });

export const listMemberSelfServiceWorkspaceRecord = createServerFn({ method: "GET" })
  .inputValidator((data: { memberId?: string } | undefined) => ({
    memberId: data?.memberId?.trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    let targetMemberId = data.memberId ?? "";
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      targetMemberId = member.id;
    } else {
      await requireStaffActor();
    }
    if (!targetMemberId) {
      return {
        services: [],
        subscriptions: [],
        stockItems: [],
        requests: [],
        serviceWalletBalance: 0,
      };
    }

    const supabaseAdmin = requireSupabaseAdmin();
    const [servicesResult, subscriptionsResult, stockResult, requestsResult, serviceWalletResult] =
      await Promise.all([
        supabaseAdmin
          .from("service_catalog")
          .select("*")
          .eq("active", true)
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("member_service_subscriptions")
          .select("*")
          .eq("member_id", targetMemberId)
          .neq("status", "cancelled")
          .order("updated_at", { ascending: false }),
        supabaseAdmin
          .from("internal_store_items")
          .select("*")
          .gt("quantity_available", 0)
          .order("item_name", { ascending: true }),
        supabaseAdmin
          .from("supplier_fulfillment_requests")
          .select("*")
          .eq("member_id", targetMemberId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin
          .from("member_docket_balances")
          .select("amount")
          .eq("member_id", targetMemberId)
          .eq("docket", "service_wallet")
          .maybeSingle(),
      ]);

    const failed = [
      servicesResult,
      subscriptionsResult,
      stockResult,
      requestsResult,
      serviceWalletResult,
    ].find((result) => result.error && !isMissingRelationError(result.error));
    if (failed?.error) throw new Error(failed.error.message);

    return {
      services: servicesResult.error
        ? []
        : (servicesResult.data ?? []).map((row: DbRow) => mapServiceCatalogRow(row)),
      subscriptions: subscriptionsResult.error
        ? []
        : (subscriptionsResult.data ?? []).map((row: DbRow) =>
            mapMemberServiceSubscriptionRow(row),
          ),
      stockItems: stockResult.error ? [] : ((stockResult.data ?? []) as DbRow[]),
      requests: requestsResult.error ? [] : ((requestsResult.data ?? []) as DbRow[]),
      serviceWalletBalance: readNumber((serviceWalletResult.data as DbRow | null)?.amount),
    };
  });

export const listPerformanceTargets = createServerFn({ method: "POST" }).handler(async () => {
  await requireStaffActor();
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("performance_targets")
    .select("*")
    .order("start_on", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapPerformanceTargetRow(row as DbRow));
});

export const loadMemberCarryover = createServerFn({ method: "POST" })
  .inputValidator((data: { memberId: string }) => ({
    memberId: String(data?.memberId ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    await requireDirectorActor();
    if (!data.memberId) {
      return { profile: null, loans: [] };
    }

    const runtimeDb = requireSupabaseAdmin() as any;
    const [profileResult, loansResult] = await Promise.all([
      runtimeDb
        .from("member_carryover_profiles")
        .select("*")
        .eq("member_id", data.memberId)
        .maybeSingle(),
      runtimeDb
        .from("member_carryover_loans")
        .select("*")
        .eq("member_id", data.memberId)
        .order("start_date", { ascending: false }),
    ]);

    if (profileResult.error) throw new Error(profileResult.error.message);
    if (loansResult.error) throw new Error(loansResult.error.message);

    return {
      profile: profileResult.data ? mapCarryoverProfileRow(profileResult.data as DbRow) : null,
      loans: await mapCarryoverLoanRowsWithLedger(runtimeDb, (loansResult.data ?? []) as DbRow[]),
    };
  });

export const listAllCarryoverLoans = createServerFn({ method: "POST" }).handler(async () => {
  await requireStaffActor();
  const runtimeDb = requireSupabaseAdmin() as any;
  const { data, error } = await runtimeDb
    .from("member_carryover_loans")
    .select("*")
    .order("start_date", { ascending: false });

  if (error) throw new Error(error.message);
  return mapCarryoverLoanRowsWithLedger(runtimeDb, (data ?? []) as DbRow[]);
});

export const listAllCarryoverProfiles = createServerFn({ method: "POST" }).handler(async () => {
  await requireStaffActor();
  const runtimeDb = requireSupabaseAdmin() as any;
  const { data, error } = await runtimeDb
    .from("member_carryover_profiles")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: DbRow) => mapCarryoverProfileRow(row));
});

export const listPortalCarryoverLoans = createServerFn({ method: "POST" })
  .inputValidator((data?: { memberId?: string }) => ({
    memberId: String(data?.memberId ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    const memberId = session.authMode === "member" ? session.memberId : data.memberId;
    if (!memberId) return [];

    const runtimeDb = requireSupabaseAdmin() as any;
    const { data: rows, error } = await runtimeDb
      .from("member_carryover_loans")
      .select("*")
      .eq("member_id", memberId)
      .order("start_date", { ascending: false });

    if (error) throw new Error(error.message);
    return mapCarryoverLoanRowsWithLedger(runtimeDb, (rows ?? []) as DbRow[]);
  });

export const listReportSnapshots = createServerFn({ method: "POST" }).handler(async () => {
  await requireStaffActor();
  const runtimeDb = requireSupabaseAdmin() as any;
  const { data, error } = await runtimeDb
    .from("report_snapshots")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: DbRow) => mapReportSnapshotRow(row));
});

export const listSupportThreads = createServerFn({ method: "POST" }).handler(async () => {
  const session = await requireSignedInSession();
  const supabaseAdmin = requireSupabaseAdmin();

  if (session.authMode === "member") {
    const member = await requireMemberActor();
    const { data: threads, error: threadsError } = await supabaseAdmin
      .from("support_threads")
      .select("*")
      .eq("member_id", member.id)
      .order("updated_at", { ascending: false });
    if (threadsError) throw new Error(threadsError.message);

    const threadIds = (threads ?? []).map((row) => readText((row as DbRow).id));
    const messagesResult = threadIds.length
      ? await supabaseAdmin
          .from("support_messages")
          .select("*")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (messagesResult.error) throw new Error(messagesResult.error.message);

    const grouped = groupSupportMessages((messagesResult.data ?? []) as DbRow[]);
    return (threads ?? []).map((row) => mapSupportThreadRow(row as DbRow, grouped));
  }

  const actor = await requireStaffActor();
  const threadsQuery =
    actor.role === "director" || actor.role === "manager"
      ? supabaseAdmin.from("support_threads").select("*")
      : supabaseAdmin
          .from("support_threads")
          .select("*")
          .or(`assigned_staff_id.is.null,assigned_staff_id.eq.${actor.id}`);

  const { data: threads, error: threadsError } = await threadsQuery.order("updated_at", {
    ascending: false,
  });
  if (threadsError) throw new Error(threadsError.message);

  const threadIds = (threads ?? []).map((row) => readText((row as DbRow).id));
  const messagesResult = threadIds.length
    ? await supabaseAdmin
        .from("support_messages")
        .select("*")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (messagesResult.error) throw new Error(messagesResult.error.message);

  const grouped = groupSupportMessages((messagesResult.data ?? []) as DbRow[]);
  return (threads ?? []).map((row) => mapSupportThreadRow(row as DbRow, grouped));
});

export const listSupplierWorkspaceRecord = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSignedInSession();
  const supabaseAdmin = requireSupabaseAdmin();

  let mode: "staff" | "supplier" = "staff";
  let signedSupplierId = "";
  let signedMemberId = "";

  if (session.authMode === "member") {
    const member = await requireMemberActor();
    const { data: supplier, error } = await supabaseAdmin
      .from("suppliers")
      .select("*")
      .eq("member_id", member.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!supplier) {
      throw new Error("This SBC number is not linked to a supplier profile.");
    }
    mode = "supplier";
    signedSupplierId = readText((supplier as DbRow).id);
    signedMemberId = member.id;
  } else {
    await requireStaffActor();
  }

  const suppliersQuery =
    mode === "supplier"
      ? supabaseAdmin.from("suppliers").select("*").eq("id", signedSupplierId)
      : supabaseAdmin.from("suppliers").select("*").order("created_at", { ascending: false });
  const supplierInventoryQuery =
    mode === "supplier"
      ? supabaseAdmin
          .from("supplier_inventory_items")
          .select("*")
          .eq("supplier_id", signedSupplierId)
          .order("updated_at", { ascending: false })
      : supabaseAdmin
          .from("supplier_inventory_items")
          .select("*")
          .order("updated_at", { ascending: false });
  const requestsQuery =
    mode === "supplier"
      ? supabaseAdmin
          .from("supplier_fulfillment_requests")
          .select("*")
          .eq("supplier_id", signedSupplierId)
          .order("created_at", { ascending: false })
      : supabaseAdmin
          .from("supplier_fulfillment_requests")
          .select("*")
          .order("created_at", { ascending: false });
  const outflowsQuery =
    mode === "supplier"
      ? supabaseAdmin
          .from("system_outflows")
          .select("*")
          .eq("supplier_id", signedSupplierId)
          .order("created_at", { ascending: false })
      : supabaseAdmin
          .from("system_outflows")
          .select("*")
          .eq("kind", "supplier_payment")
          .order("created_at", { ascending: false });
  const loansQuery =
    mode === "supplier"
      ? supabaseAdmin
          .from("loans")
          .select(
            "id, member_id, principal, approved_amount, status, purpose, loan_kind, supplier_id, supplier_request_status, supplier_payload",
          )
          .eq("supplier_id", signedSupplierId)
          .order("created_at", { ascending: false })
      : supabaseAdmin
          .from("loans")
          .select(
            "id, member_id, principal, approved_amount, status, purpose, loan_kind, supplier_id, supplier_request_status, supplier_payload",
          )
          .in("loan_kind", ["fuel", "stock", "service"])
          .order("created_at", { ascending: false });
  const brokerClientsQuery =
    mode === "supplier"
      ? supabaseAdmin
          .from("supplier_broker_clients")
          .select("*")
          .eq("supplier_id", signedSupplierId)
          .order("updated_at", { ascending: false })
      : supabaseAdmin
          .from("supplier_broker_clients")
          .select("*")
          .order("updated_at", { ascending: false });
  const brokerTransactionsQuery =
    mode === "supplier"
      ? supabaseAdmin
          .from("supplier_broker_client_transactions")
          .select("*")
          .eq("supplier_id", signedSupplierId)
          .order("created_at", { ascending: false })
      : supabaseAdmin
          .from("supplier_broker_client_transactions")
          .select("*")
          .order("created_at", { ascending: false });

  const [
    suppliersResult,
    inventoryResult,
    requestsResult,
    outflowsResult,
    loansResult,
    membersResult,
    internalStoreResult,
    brokerClientsResult,
    brokerTransactionsResult,
  ] = await Promise.all([
    suppliersQuery,
    supplierInventoryQuery,
    requestsQuery,
    outflowsQuery,
    loansQuery,
    supabaseAdmin
      .from("members")
      .select("id, name, phone, member_category")
      .order("name", { ascending: true }),
    mode === "supplier"
      ? Promise.resolve({ data: [], error: null })
      : supabaseAdmin
          .from("internal_store_items")
          .select("*")
          .order("updated_at", { ascending: false }),
    brokerClientsQuery,
    brokerTransactionsQuery,
  ]);

  const failed = [
    suppliersResult,
    inventoryResult,
    requestsResult,
    outflowsResult,
    loansResult,
    membersResult,
    internalStoreResult,
    brokerClientsResult,
    brokerTransactionsResult,
  ].find((result) => result.error && !isMissingRelationError(result.error));
  if (failed?.error) throw new Error(failed.error.message);

  const visibleSupplierMemberIds = new Set([
    signedMemberId,
    ...((requestsResult.data ?? []) as DbRow[]).map((request) => readText(request.member_id)),
    ...((loansResult.data ?? []) as DbRow[]).map((loan) => readText(loan.member_id)),
  ]);
  const memberRows =
    mode === "supplier"
      ? ((membersResult.data ?? []) as DbRow[]).filter((row) =>
          visibleSupplierMemberIds.has(readText(row.id)),
        )
      : ((membersResult.data ?? []) as DbRow[]).filter(
          (row) => readText(row.member_category) !== "supplier",
        );

  return {
    mode,
    signedSupplierId,
    signedMemberId,
    suppliers: (suppliersResult.data ?? []) as DbRow[],
    supplierInventory: (inventoryResult.data ?? []) as DbRow[],
    requests: (requestsResult.data ?? []) as DbRow[],
    outflows: (outflowsResult.data ?? []) as DbRow[],
    loans: (loansResult.data ?? []) as DbRow[],
    members: memberRows,
    internalStore: (internalStoreResult.data ?? []) as DbRow[],
    brokerClients: (brokerClientsResult.error ? [] : (brokerClientsResult.data ?? [])) as DbRow[],
    brokerTransactions: (brokerTransactionsResult.error
      ? []
      : (brokerTransactionsResult.data ?? [])) as DbRow[],
  };
});

export const listMemberSupplierRequestsRecord = createServerFn({ method: "GET" })
  .inputValidator((data: { memberId?: string } | undefined) => ({
    memberId: data?.memberId?.trim() || undefined,
  }))
  .handler(async ({ data }) => {
    const session = await requireSignedInSession();
    const supabaseAdmin = requireSupabaseAdmin();

    let targetMemberId = data.memberId ?? "";
    if (session.authMode === "member") {
      const member = await requireMemberActor();
      targetMemberId = member.id;
    } else {
      await requireStaffActor();
    }

    if (!targetMemberId) return [];

    const [requestsResult, suppliersResult] = await Promise.all([
      supabaseAdmin
        .from("supplier_fulfillment_requests")
        .select("*")
        .eq("member_id", targetMemberId)
        .order("created_at", { ascending: false }),
      supabaseAdmin.from("suppliers").select("id, name"),
    ]);
    if (requestsResult.error) throw new Error(requestsResult.error.message);
    if (suppliersResult.error) throw new Error(suppliersResult.error.message);

    const supplierNames = new Map(
      (suppliersResult.data ?? []).map((row) => [
        readText((row as DbRow).id),
        readText((row as DbRow).name),
      ]),
    );

    return (requestsResult.data ?? []).map((row) => {
      const request = row as DbRow;
      return {
        id: readText(request.id),
        supplierId: readText(request.supplier_id),
        supplierName:
          supplierNames.get(readText(request.supplier_id)) ?? readText(request.supplier_id),
        loanId: optionalText(request.loan_id),
        kind: readText(request.kind),
        amount: readNumber(request.amount),
        status: readText(request.status),
        commodityName: optionalText(request.commodity_name),
        quantityRequested: readNumber(request.quantity_requested),
        unitOfMeasure: optionalText(request.unit_of_measure),
        vehiclePlate: optionalText(request.vehicle_plate),
        fuelType: optionalText(request.fuel_type),
        verificationCode: optionalText(request.verification_code),
        verifiedAt: optionalText(request.verified_at),
        fulfilledAt: optionalText(request.fulfilled_at),
        detail:
          request.detail && typeof request.detail === "object"
            ? (request.detail as Record<string, unknown>)
            : {},
      };
    });
  });
