import { createServerFn } from "@tanstack/react-start";

import { requireDirectorActor } from "@/lib/auth.server";
import { requestMpesaWithdrawalPayout } from "@/lib/mpesa-payouts.server";
import { payrollMonthWindow, payableSalaryFromAttendance } from "@/lib/payroll";

function makeId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const SUPABASE_PAGE_SIZE = 1000;

async function fetchAllRows<T = any>(queryFactory: () => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await queryFactory().range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

async function requireSupabaseAdmin() {
  const { getSupabaseAdminOrNull } = await import("@/integrations/supabase/client.server");
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error("Database sync is unavailable until Supabase admin secrets are configured.");
  }
  return supabaseAdmin;
}

function toNumber(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function readText(value: unknown) {
  return String(value ?? "").trim();
}

function isInflowType(type: string) {
  return (
    type === "deposit" ||
    type === "loan_repayment" ||
    type === "share_purchase" ||
    type === "investor_contribution" ||
    type === "fee_payment" ||
    type === "mpesa_unallocated"
  );
}

function isOutflowType(type: string) {
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
    .filter((row: { type?: string | null }) => isInflowType(readText(row.type)))
    .reduce(
      (sum: number, row: { amount?: number | string | null }) => sum + toNumber(row.amount),
      0,
    );
  const outflow = transactionRows
    .filter((row: { type?: string | null }) => isOutflowType(readText(row.type)))
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

export const getSystemCashSummaryRecord = createServerFn({ method: "POST" }).handler(async () => {
  await requireDirectorActor();
  const runtimeDb = await requireSupabaseAdmin();
  return computeSystemCashSummary(runtimeDb);
});

export const listStaffPayrollProfiles = createServerFn({ method: "POST" }).handler(async () => {
  await requireDirectorActor();
  const runtimeDb = await requireSupabaseAdmin();
  const { data, error } = await runtimeDb
    .from("staff_payroll_profiles")
    .select("*")
    .order("staff_id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    staffId: readText(row.staff_id),
    baseSalary: toNumber(row.base_salary),
    payoutPhone: readText(row.payout_phone) || undefined,
    notes: readText(row.notes) || undefined,
    createdAt: readText(row.created_at) || undefined,
    updatedAt: readText(row.updated_at) || undefined,
  }));
});

export const listStaffPayrollPayments = createServerFn({ method: "POST" }).handler(async () => {
  await requireDirectorActor();
  const runtimeDb = await requireSupabaseAdmin();
  const { data, error } = await runtimeDb
    .from("staff_payroll_payments")
    .select("*")
    .order("requested_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: readText(row.id),
    staffId: readText(row.staff_id),
    periodStart: readText(row.period_start),
    periodEnd: readText(row.period_end),
    baseSalary: toNumber(row.base_salary),
    workDays: Math.max(0, Math.floor(toNumber(row.work_days))),
    presentDays: Math.max(0, Math.floor(toNumber(row.present_days))),
    payableAmount: toNumber(row.payable_amount),
    paidAmount: toNumber(row.paid_amount),
    status: readText(row.status) || "requested",
    requestedBy: readText(row.requested_by) || undefined,
    requestedAt: readText(row.requested_at) || undefined,
    paidAt: readText(row.paid_at) || undefined,
    transactionId: readText(row.transaction_id) || undefined,
    payoutRequestId: readText(row.payout_request_id) || undefined,
    note: readText(row.note) || undefined,
    mpesaRef: readText(row.mpesa_ref) || undefined,
  }));
});

export const upsertStaffPayrollProfileRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { staffId: string; baseSalary: number; payoutPhone?: string; notes?: string }) => ({
      staffId: readText(data?.staffId),
      baseSalary: Math.max(0, toNumber(data?.baseSalary)),
      payoutPhone: readText(data?.payoutPhone) || undefined,
      notes: readText(data?.notes) || undefined,
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.staffId) throw new Error("Staff id is required.");
    const runtimeDb = await requireSupabaseAdmin();
    const { error } = await runtimeDb.from("staff_payroll_profiles").upsert({
      staff_id: data.staffId,
      base_salary: data.baseSalary,
      payout_phone: data.payoutPhone ?? null,
      notes: data.notes ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { ok: true, updatedBy: actor.id };
  });

export const requestStaffPayrollPayoutRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { staffId: string; month: string; note?: string }) => ({
    staffId: readText(data?.staffId),
    month: readText(data?.month),
    note: readText(data?.note) || undefined,
  }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.staffId) throw new Error("Staff id is required.");
    const runtimeDb = await requireSupabaseAdmin();
    const period = payrollMonthWindow(data.month);

    const [staffResult, profileResult, attendanceResult, priorPaymentsResult] = await Promise.all([
      runtimeDb.from("staff").select("id, name, phone").eq("id", data.staffId).maybeSingle(),
      runtimeDb
        .from("staff_payroll_profiles")
        .select("*")
        .eq("staff_id", data.staffId)
        .maybeSingle(),
      runtimeDb
        .from("attendance")
        .select("staff_id, date, status")
        .eq("staff_id", data.staffId)
        .gte("date", period.start)
        .lte("date", period.end),
      runtimeDb
        .from("staff_payroll_payments")
        .select("paid_amount, status")
        .eq("staff_id", data.staffId)
        .eq("period_start", period.start)
        .eq("period_end", period.end),
    ]);
    const failed = [staffResult, profileResult, attendanceResult, priorPaymentsResult].find(
      (result) => result.error,
    );
    if (failed?.error) throw new Error(failed.error.message);
    if (!staffResult.data) throw new Error("Staff member not found.");
    if (!profileResult.data) throw new Error("Set the staff salary before paying payroll.");

    const alreadyPaid = (priorPaymentsResult.data ?? [])
      .filter((row: { status?: string | null }) => readText(row.status) === "paid")
      .reduce(
        (sum: number, row: { paid_amount?: number | string | null }) =>
          sum + toNumber(row.paid_amount),
        0,
      );

    const payroll = payableSalaryFromAttendance({
      baseSalary: toNumber(profileResult.data.base_salary),
      rows: (attendanceResult.data ?? []).map((row: Record<string, unknown>) => ({
        staffId: readText(row.staff_id),
        date: readText(row.date),
        status: readText(row.status) as "present" | "late" | "signed_out" | "permission" | "absent",
      })),
      staffId: data.staffId,
      start: period.start,
      end: period.end,
      alreadyPaid,
    });
    if (payroll.outstanding <= 0) {
      throw new Error("This payroll period has already been fully paid.");
    }

    const cashSummary = await computeSystemCashSummary(runtimeDb);
    if (cashSummary.available < payroll.outstanding) {
      throw new Error(
        `Insufficient paybill balance. Available ${cashSummary.available}/=, required ${payroll.outstanding}/=.`,
      );
    }

    const payoutPhone =
      readText(profileResult.data.payout_phone) || readText(staffResult.data.phone);
    if (!payoutPhone) throw new Error("The selected staff member does not have a payroll phone.");

    const paymentId = makeId("PAY");
    const payout = await requestMpesaWithdrawalPayout({
      amount: payroll.outstanding,
      phone: payoutPhone,
      accountReference: `PAYROLL-${data.staffId}`,
      memberName: staffResult.data.name,
      remarks: data.note || `Payroll for ${period.month}`,
    });

    const { error: paymentError } = await runtimeDb.from("staff_payroll_payments").insert({
      id: paymentId,
      staff_id: data.staffId,
      period_start: period.start,
      period_end: period.end,
      base_salary: toNumber(profileResult.data.base_salary),
      work_days: payroll.workDays,
      present_days: payroll.presentDays,
      payable_amount: payroll.grossPayable,
      paid_amount: 0,
      status: "requested",
      requested_by: actor.id,
      requested_at: new Date().toISOString(),
      note: data.note ?? null,
    });
    if (paymentError) throw new Error(paymentError.message);

    const payoutRequestId = makeId("SPR");
    const { error: payoutRequestError } = await runtimeDb.from("system_payout_requests").insert({
      id: payoutRequestId,
      purpose: "staff_payroll",
      target_id: paymentId,
      receiver_staff_id: data.staffId,
      phone: payoutPhone,
      amount: payroll.outstanding,
      account_reference: `PAYROLL-${data.staffId}`,
      conversation_id: payout.conversationId ?? null,
      originator_conversation_id: payout.originatorConversationId ?? null,
      remarks: data.note ?? null,
      status: "requested",
      requested_by: actor.id,
      raw: {
        purpose: "staff_payroll",
        payrollPaymentId: paymentId,
        month: period.month,
        periodStart: period.start,
        periodEnd: period.end,
      } as any,
    });
    if (payoutRequestError) throw new Error(payoutRequestError.message);

    const { error: linkError } = await runtimeDb
      .from("staff_payroll_payments")
      .update({ payout_request_id: payoutRequestId })
      .eq("id", paymentId);
    if (linkError) throw new Error(linkError.message);

    return {
      ok: true,
      paymentId,
      payoutRequestId,
      amount: payroll.outstanding,
      workDays: payroll.workDays,
      presentDays: payroll.presentDays,
    };
  });
