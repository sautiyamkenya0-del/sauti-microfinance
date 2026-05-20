import { createServerFn } from "@tanstack/react-start";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  requireDirectorActor,
  requireMemberActor,
  requireSignedInSession,
  requireStaffActor,
} from "@/lib/auth.server";

type DbRow = Record<string, unknown>;

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
  return {
    id: readText(row.id),
    date: readText(row.memo_date),
    title: readText(row.title),
    body: readText(row.body),
    by: readText(row.by_name),
    byStaffId: optionalText(row.by_staff_id),
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

function mapCarryoverLoanRow(row: DbRow) {
  return {
    id: readText(row.id),
    memberId: readText(row.member_id),
    label: readText(row.label) || "Legacy loan",
    loanCycleNumber: Math.max(1, Math.floor(readNumber(row.loan_cycle_number))),
    principal: readNumber(row.principal),
    interestRatePct: readNumber(row.interest_rate_pct),
    termDays: Math.max(7, Math.floor(readNumber(row.term_days))) as 7 | 14 | 30 | 60 | 90,
    dailySavingsAmount: readNumber(row.daily_savings_amount),
    startDate: readText(row.start_date),
    dueDate: optionalText(row.due_date),
    closedOn: optionalText(row.closed_on),
    paidToDate: readNumber(row.paid_to_date),
    status: readText(row.status) as "active" | "closed" | "defaulted",
    finished: row.finished === true,
    penaltyWaivedAmount: readNumber(row.penalty_waived_amount),
    notes: optionalText(row.notes),
    createdBy: optionalText(row.created_by),
    updatedBy: optionalText(row.updated_by),
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at),
  };
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
      loans: (loansResult.data ?? []).map((row: DbRow) => mapCarryoverLoanRow(row)),
    };
  });

export const listAllCarryoverLoans = createServerFn({ method: "POST" }).handler(async () => {
  await requireDirectorActor();
  const runtimeDb = requireSupabaseAdmin() as any;
  const { data, error } = await runtimeDb
    .from("member_carryover_loans")
    .select("*")
    .order("start_date", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: DbRow) => mapCarryoverLoanRow(row));
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
