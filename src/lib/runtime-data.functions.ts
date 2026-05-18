import { createServerFn } from "@tanstack/react-start";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { requireMemberActor, requireSignedInSession, requireStaffActor } from "@/lib/auth.server";

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
    scope: readText(row.scope) as "all" | "new_only" | "loan_holders" | "investors",
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
