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
  const { getSupabaseAdminEnvStatus, getSupabaseAdminOrNull } = await import(
    "@/integrations/supabase/client.server",
  );
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    const missing = getSupabaseAdminEnvStatus().missing.join(", ");
    throw new Error(
      `Database sync is unavailable until the server has: ${missing}. Add those values to local env or hosting secrets.`,
    );
  }
  return supabaseAdmin;
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function makeId(prefix: string) {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const SHARE_PRICE = 500;
const ROUNDING_BASE = 1;
const MANDATORY_SAVINGS_THRESHOLD = 1000;
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

function parseMembershipNumber(account: string) {
  const norm = account.trim().toUpperCase();
  const match = norm.match(/SBC0*(\d{1,4})/);
  if (!match) return undefined;
  return `M${match[1].padStart(3, "0")}`;
}

function memberNeedsStickerRow(member: {
  business_permanence?: string | null;
  fee_has_shop?: boolean | null;
}) {
  if (member.business_permanence) return member.business_permanence === "permanent";
  return !!member.fee_has_shop;
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

export async function recordMpesaConfirmationEvent(args: {
  raw: Record<string, unknown>;
  account: string;
  amount: number;
  mpesaRef?: string;
  payerName?: string;
  phone?: string;
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
      processed: false,
    })
    .select("id, processed, transaction_id")
    .single();
  if (error) throw new Error(error.message);
  return data;
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
      .select("processed, transaction_id")
      .eq("id", args.eventId)
      .maybeSingle();
    if (eventError) throw new Error(eventError.message);
    if (event?.processed) {
      return {
        matched: true,
        account: norm,
        notes: ["M-Pesa event already processed."],
      };
    }
  }

  const memberId = parseMembershipNumber(norm);
  if (!memberId) {
    notes.push(`Account "${args.account}" did not match SBC member pattern.`);
    await markMpesaEventProcessed(args.eventId, null);
    return { matched: false, account: norm, notes };
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from("members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) {
    notes.push(`No member with ID ${memberId}. Holding as suspense.`);
    await markMpesaEventProcessed(args.eventId, null);
    return { matched: false, account: norm, notes };
  }

  let remaining = Number(args.amount ?? 0);
  const today = new Date().toISOString().slice(0, 10);
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

  if (member.is_investor && member.investor_id) {
    const { data: investor, error: investorError } = await supabaseAdmin
      .from("investors")
      .select("contributed")
      .eq("id", member.investor_id)
      .maybeSingle();
    if (investorError) throw new Error(investorError.message);
    if (investor) {
      const { error: updateInvestorError } = await supabaseAdmin
        .from("investors")
        .update({
          contributed: Number(investor.contributed ?? 0) + remaining,
        })
        .eq("id", member.investor_id);
      if (updateInvestorError) throw new Error(updateInvestorError.message);
    }

    primary = {
      type: "investor_contribution",
      amount: remaining,
      note: `Investment via Paybill ${norm}`,
    };
    primaryTransactionId = await insertTransactionRow({
      date: today,
      type: "investor_contribution",
      amount: remaining,
      member_id: memberId,
      by_staff: "MPESA",
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Investment top-up via Paybill ${norm}`,
    });
    notes.push(`Routed ${remaining}/= to investment pool for member-investor ${member.name}.`);
    await markMpesaEventProcessed(args.eventId, primaryTransactionId);
    return {
      matched: true,
      memberId,
      account: norm,
      primary,
      toRoundOff: 0,
      penaltiesCleared: [],
      notes,
    };
  }

  const memberPatch: Record<string, unknown> = {};
  const feeQueue: Array<{
    key: "fee_membership" | "fee_card" | "fee_sticker";
    label: string;
    amount: number;
    required: boolean;
  }> = [
    { key: "fee_membership", label: "Membership fee", amount: 500, required: true },
    { key: "fee_card", label: "Membership card", amount: 500, required: true },
    {
      key: "fee_sticker",
      label: "Sticker fee",
      amount: 500,
      required: memberNeedsStickerRow(member),
    },
  ];

  for (const fee of feeQueue) {
    if (!fee.required) continue;
    if (member[fee.key]) continue;
    if (remaining < fee.amount) break;
    remaining -= fee.amount;
    memberPatch[fee.key] = true;
    txBatch.push({
      date: today,
      type: "fee_payment",
      amount: fee.amount,
      member_id: memberId,
      by_staff: "MPESA",
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `${fee.label} (auto)`,
    });
    notes.push(`Paid ${fee.label} - ${fee.amount}/=.`);
  }

  const { data: outstandingPenalties, error: penaltiesError } = await supabaseAdmin
    .from("penalties")
    .select("*")
    .eq("member_id", memberId)
    .eq("status", "outstanding")
    .order("date", { ascending: true });
  if (penaltiesError) throw new Error(penaltiesError.message);

  for (const penalty of outstandingPenalties ?? []) {
    const amount = Number(penalty.amount ?? 0);
    if (remaining < amount) continue;
    remaining -= amount;
    penaltiesCleared.push({ id: penalty.id, amount });
    notes.push(`Cleared penalty ${penalty.id} (${penalty.reason}) - ${amount}/=.`);
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

  const { data: activeLoan, error: activeLoanError } = await supabaseAdmin
    .from("loans")
    .select("*")
    .eq("member_id", memberId)
    .eq("status", "active")
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (activeLoanError) throw new Error(activeLoanError.message);

  if (activeLoan && remaining > 0) {
    const summary = loanBalanceSummary(activeLoan);
    const applied = Math.min(remaining, summary.balance);
    const rounded = roundUpKES(applied, ROUNDING_BASE);
    const surplus = Math.max(0, rounded - applied);
    if (remaining >= rounded) {
      remaining -= rounded;
      if (surplus > 0) toRoundOff += surplus;
    } else {
      remaining = 0;
    }

    primary = {
      type: "loan_repayment",
      amount: applied,
      loanId: activeLoan.id,
      note: `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
    };
    txBatch.push({
      date: today,
      type: "loan_repayment",
      amount: applied,
      member_id: memberId,
      loan_id: activeLoan.id,
      by_staff: "MPESA",
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Paybill ${norm} - ${args.payerName ?? ""}`,
    });

    const nextPaid = Number(activeLoan.paid ?? 0) + applied;
    const nextBalance = Math.max(0, summary.total - nextPaid);
    const { error: loanUpdateError } = await supabaseAdmin
      .from("loans")
      .update({
        paid: nextPaid,
        status: nextBalance <= 0 ? "closed" : activeLoan.status,
      })
      .eq("id", activeLoan.id);
    if (loanUpdateError) throw new Error(loanUpdateError.message);

    if (!member.fee_first_upfront_paid) {
      memberPatch.fee_first_upfront_paid = true;
    }

    notes.push(
      `Applied ${applied}/= to loan ${activeLoan.id}; rounded up to ${rounded}/=, surplus ${surplus}/= -> round-off pool.`,
    );
  }

  if (remaining > 0) {
    const rounded = roundUpKES(remaining, ROUNDING_BASE);
    const surplus = Math.max(0, rounded - remaining);
    const applied = remaining;
    if (!primary) {
      primary = {
        type: "deposit",
        amount: applied,
        note: `M-Pesa ${args.mpesaRef ?? ""} from ${args.payerName ?? "-"}`,
      };
    }
    txBatch.push({
      date: today,
      type: "deposit",
      amount: applied,
      member_id: memberId,
      by_staff: "MPESA",
      ref: args.mpesaRef,
      account: norm,
      payer_name: args.payerName,
      note: `Paybill ${norm} - ${args.payerName ?? ""}`,
    });
    memberPatch.savings_balance = Number(member.savings_balance ?? 0) + applied;
    if (surplus > 0) toRoundOff += surplus;
    if (Number(member.savings_balance ?? 0) + applied < MANDATORY_SAVINGS_THRESHOLD) {
      notes.push(
        `Member is still below the mandatory savings threshold of ${MANDATORY_SAVINGS_THRESHOLD}/=.`,
      );
    } else {
      notes.push("Member meets mandatory savings threshold.");
    }
    remaining = 0;
  }

  if (Object.keys(memberPatch).length > 0) {
    const { error: memberUpdateError } = await supabaseAdmin
      .from("members")
        .update(memberPatch as any)
      .eq("id", memberId);
    if (memberUpdateError) throw new Error(memberUpdateError.message);
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

  await markMpesaEventProcessed(args.eventId, primaryTransactionId ?? null);
  return {
    matched: true,
    memberId,
    account: norm,
    primary,
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
  const { data, error } = await supabaseAdmin.from(table).select("id");
  if (error) throw new Error(error.message);

  const maxSeen = (data ?? []).reduce((maxValue, row) => {
    const match = String(row.id ?? "").match(/(\d+)/);
    if (!match) return maxValue;
    return Math.max(maxValue, Number(match[1]));
  }, minimum - 1);

  return `${prefix}${maxSeen + 1}`;
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
    isInvestor: row.is_investor,
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
    custom: row.custom,
    notes: row.notes ?? undefined,
    updatedAt: row.updated_at,
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
    feePolicies: [],
    supportThreads: [],
  };
}

export const loadAppData = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getAuthSessionData();
  const base = emptyAppData();
  if (!session.authMode) return base;

  const supabaseAdmin = await requireSupabaseAdmin();
  const runtimeDb = supabaseAdmin as any;

  if (session.authMode === "member" && session.memberId) {
    const [memberResult, staffResult, loansResult, transactionsResult, penaltiesResult, roundOffResult, feePoliciesResult, supportThreadsResult] =
      await Promise.all([
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
        runtimeDb.from("fee_policies").select("*").order("updated_at", { ascending: false }),
        runtimeDb
          .from("support_threads")
          .select("*")
          .eq("member_id", session.memberId)
          .order("updated_at", { ascending: false }),
      ]);

    const memberResults = [
      memberResult,
      staffResult,
      loansResult,
      transactionsResult,
      penaltiesResult,
      roundOffResult,
      feePoliciesResult,
      supportThreadsResult,
    ];
    const failedMemberResult = memberResults.find((result) => result.error);
    if (failedMemberResult?.error) throw new Error(failedMemberResult.error.message);
    if (!memberResult.data) return base;

    const threadIds = (supportThreadsResult.data ?? []).map((row: any) => row.id);
    const supportMessagesResult = threadIds.length
      ? await runtimeDb
          .from("support_messages")
          .select("*")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (supportMessagesResult.error) throw new Error(supportMessagesResult.error.message);

    const supportMessagesByThread = groupSupportMessages(supportMessagesResult.data ?? []);

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
      feePolicies: (feePoliciesResult.data ?? []).map(mapFeePolicyRow),
      supportThreads: (supportThreadsResult.data ?? []).map((row: any) =>
        mapSupportThreadRow(row, supportMessagesByThread),
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
    memosResult,
    approvalsResult,
    feePoliciesResult,
    supportThreadsResult,
    supportMessagesResult,
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
    runtimeDb.from("staff_messages").select("*").order("created_at", { ascending: true }),
    runtimeDb.from("staff_memos").select("*").order("memo_date", { ascending: false }),
    runtimeDb.from("approval_requests").select("*").order("created_at", { ascending: false }),
    runtimeDb.from("fee_policies").select("*").order("updated_at", { ascending: false }),
    runtimeDb.from("support_threads").select("*").order("updated_at", { ascending: false }),
    runtimeDb.from("support_messages").select("*").order("created_at", { ascending: true }),
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
    memosResult,
    approvalsResult,
    feePoliciesResult,
    supportThreadsResult,
    supportMessagesResult,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  const supportMessagesByThread = groupSupportMessages(supportMessagesResult.data ?? []);

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
    memos: (memosResult.data ?? []).map(mapMemoRow),
    approvals: (approvalsResult.data ?? []).map(mapApprovalRow),
    feePolicies: (feePoliciesResult.data ?? []).map(mapFeePolicyRow),
    supportThreads: (supportThreadsResult.data ?? []).map((row: any) =>
      mapSupportThreadRow(row, supportMessagesByThread),
    ),
  };
});

export const createMemberRecord = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
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
      investorContribution?: number;
      investorNotes?: string;
    }) => ({
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

    const supabaseAdmin = await requireSupabaseAdmin();
    const phone = toLocalKenyanPhone(data.phone);
    const normalizedPhone = toComparableKenyanPhone(phone);

    const { data: existingMembers, error: existingError } = await supabaseAdmin
      .from("members")
      .select("id, phone, old_system_id");
    if (existingError) throw new Error(existingError.message);

    const duplicate = (existingMembers ?? []).find((row) => {
      const samePhone = toComparableKenyanPhone(row.phone) === normalizedPhone;
      const sameLegacyId =
        data.oldSystemId &&
        row.old_system_id &&
        row.old_system_id.trim().toUpperCase() === data.oldSystemId.trim().toUpperCase();
      return samePhone || sameLegacyId;
    });
    if (duplicate) {
      throw new Error(`Member already exists in the database as ${duplicate.id}.`);
    }

    const memberId = await nextPrefixedId("members", "M", 101);
    const lastName =
      [data.secondName, data.thirdName].filter(Boolean).join(" ").trim() || undefined;
    const hasShop = data.businessPermanence === "permanent";
    const fieldOfficerId = data.fieldOfficerId ?? actor.id;

    const { error: memberError } = await supabaseAdmin.from("members").insert({
      id: memberId,
      name: data.name,
      phone,
      joined_at: data.joinedAt ?? new Date().toISOString().slice(0, 10),
      status: data.status,
      shares: data.shares,
      savings_balance: data.savingsBalance,
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
      is_investor: data.investorContribution > 0,
    });
    if (memberError) throw new Error(memberError.message);

    if (data.investorContribution > 0) {
      const investorId = await nextPrefixedId("investors", "I", 1);
      const txId = await nextPrefixedId("transactions", "T", 1);

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

      const { error: txError } = await supabaseAdmin.from("transactions").insert({
        id: txId,
        date: data.joinedAt ?? new Date().toISOString().slice(0, 10),
        type: "investor_contribution",
        amount: data.investorContribution,
        member_id: memberId,
        by_staff: actor.id,
        note: `Member-investor onboarding: ${data.name}`,
      });
      if (txError) throw new Error(txError.message);
    }

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
    await requireDirectorActor();
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
    if (existing) throw new Error("That email address is already assigned to another staff account.");

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
    return { ok: true };
  });

export const deleteStaffRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    const actor = await requireDirectorActor();
    if (!data.id) throw new Error("Staff id is required.");
    if (data.id === actor.id) throw new Error("You cannot delete your own staff account.");
    const supabaseAdmin = await requireSupabaseAdmin();
    const { error } = await supabaseAdmin.from("staff").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
        ? data.photos
            .map((photo) => String(photo ?? "").trim())
            .filter(Boolean)
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
    const totalPhotoBytes = data.photos.reduce((sum, photo) => sum + approxDataUrlBytes(photo), 0);
    if (totalPhotoBytes > MAX_FIELD_VISIT_TOTAL_BYTES) {
      throw new Error("The selected field visit photos are too large. Remove some photos and try again.");
    }

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
      by_staff: actor.id,
    };
    const { error } = await supabaseAdmin.from("field_visits").insert(insertPayload);
    if (error) throw new Error(error.message);
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
      approvedAmount:
        data?.approvedAmount == null ? undefined : Number(data.approvedAmount ?? 0),
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
      approvedAmount:
        data?.approvedAmount == null ? undefined : Number(data.approvedAmount ?? 0),
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
        | "fee_payment";
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
    const id = await insertTransactionRow({
      date: data.date,
      type: data.type,
      amount: data.amount,
      member_id: data.memberId ?? null,
      loan_id: data.loanId ?? null,
      by_staff: actor.id,
      note: data.note ?? null,
      ref: data.ref ?? null,
      account: data.account ?? null,
      payer_name: data.payerName ?? null,
    });

    if (data.memberId) {
      const { data: member, error: memberError } = await supabaseAdmin
        .from("members")
        .select("savings_balance, shares")
        .eq("id", data.memberId)
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
            .eq("id", data.memberId);
          if (updateMemberError) throw new Error(updateMemberError.message);
        }
      }
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
      openingBalance:
        data?.openingBalance == null ? undefined : Number(data.openingBalance),
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
      const { error: memberError } = await supabaseAdmin
        .from("members")
        .update({
          is_investor: true,
          investor_id: id,
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
  .inputValidator((data: { penaltyId: string }) => ({ penaltyId: String(data?.penaltyId ?? "").trim() }))
  .handler(async ({ data }) => {
    await requireManagerOrDirectorActor();
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
    await requireStaffActor();
    if (!data.account) throw new Error("M-Pesa account is required.");
    if (data.amount <= 0) throw new Error("M-Pesa amount must be above zero.");
    return applyMpesaPaymentToDatabase(data);
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
    if (!data.senderId || !data.receiverId) throw new Error("Both sender and receiver are required.");
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
    }) => ({
      title: String(data?.title ?? "").trim(),
      body: String(data?.body ?? "").trim(),
      by: String(data?.by ?? "").trim(),
      byStaffId: data?.byStaffId?.trim() || undefined,
      date: data?.date?.trim() || new Date().toISOString().slice(0, 10),
    }),
  )
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.title || !data.body || !data.by) throw new Error("Memo title, body and author are required.");

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
    return { id };
  });

export const deleteStaffMemoRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    await requireStaffActor();
    if (!data.id) throw new Error("Memo id is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { error } = await runtimeDb.from("staff_memos").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
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
    const id = makeId("APR");
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
      scope: "all" | "new_only" | "loan_holders" | "investors";
      custom?: boolean;
      notes?: string;
    }) => ({
      key: String(data?.key ?? "").trim(),
      label: String(data?.label ?? "").trim(),
      amount: Number(data?.amount ?? 0),
      permanence: data?.permanence ?? "permanent",
      durationDays: data?.durationDays ? Number(data.durationDays) : undefined,
      effectiveFrom: String(data?.effectiveFrom ?? "").trim() || new Date().toISOString().slice(0, 10),
      scope: data?.scope ?? "all",
      custom: !!data?.custom,
      notes: data?.notes?.trim() || undefined,
    }),
  )
  .handler(async ({ data }) => {
    await requireDirectorActor();
    if (!data.key || !data.label) throw new Error("Fee policy key and label are required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { error } = await runtimeDb.from("fee_policies").upsert({
      key: data.key,
      label: data.label,
      amount: data.amount,
      permanence: data.permanence,
      duration_days: data.permanence === "semi" ? (data.durationDays ?? null) : null,
      effective_from: data.effectiveFrom,
      scope: data.scope,
      custom: data.custom,
      notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteFeePolicyRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { key: string }) => ({ key: String(data?.key ?? "").trim() }))
  .handler(async ({ data }) => {
    await requireDirectorActor();
    if (!data.key) throw new Error("Fee key is required.");
    const runtimeDb = (await requireSupabaseAdmin()) as any;
    const { error } = await runtimeDb.from("fee_policies").delete().eq("key", data.key);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    if (!data.threadId || !data.fromName || !data.text) throw new Error("Support message is incomplete.");
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
    await requireStaffActor();
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
    return { ok: true };
  });
