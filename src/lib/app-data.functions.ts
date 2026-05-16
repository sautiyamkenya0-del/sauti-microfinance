import { createServerFn } from "@tanstack/react-start";

import {
  getSupabaseAdminEnvStatus,
  getSupabaseAdminOrNull,
} from "@/integrations/supabase/client.server";
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

function requireSupabaseAdmin() {
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
  const supabaseAdmin = requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from(table).select("id");
  if (error) throw new Error(error.message);

  const maxSeen = (data ?? []).reduce((maxValue, row) => {
    const match = String(row.id ?? "").match(/(\d+)/);
    if (!match) return maxValue;
    return Math.max(maxValue, Number(match[1]));
  }, minimum - 1);

  return `${prefix}${maxSeen + 1}`;
}

export const loadAppData = createServerFn({ method: "GET" }).handler(async () => {
  const supabaseAdmin = requireSupabaseAdmin();
  const runtimeDb = supabaseAdmin as any;

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
    supabaseAdmin.from("field_visits").select("*").order("date", { ascending: false }),
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

  const supportMessagesByThread = new Map<string, any[]>();
  for (const row of supportMessagesResult.data ?? []) {
    const list = supportMessagesByThread.get(row.thread_id) ?? [];
    list.push(row);
    supportMessagesByThread.set(row.thread_id, list);
  }

  return {
    staff: (staffResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      email: row.email ?? undefined,
      phone: row.phone ?? undefined,
      nationalId: row.national_id ?? undefined,
      address: row.address ?? undefined,
      notes: row.notes ?? undefined,
      photo: row.photo ?? undefined,
      tempPassword: row.temp_password ?? undefined,
      canMarkAttendance: row.can_mark_attendance,
      fingerprintEnrolled: row.fingerprint_enrolled,
    })),
    members: (membersResult.data ?? []).map((row) => {
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
    }),
    loans: (loansResult.data ?? []).map((row) => ({
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
    })),
    transactions: (transactionsResult.data ?? []).map((row) => ({
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
    })),
    pettyCash: (pettyCashResult.data ?? []).map((row) => ({
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
    })),
    investors: (investorsResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      contributed: toNumber(row.contributed),
      sharePct: toNumber(row.share_pct),
      joinedAt: row.joined_at,
      phone: row.phone ?? undefined,
      notes: row.notes ?? undefined,
      memberId: row.member_id ?? undefined,
    })),
    attendance: (attendanceResult.data ?? []).map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      date: row.date,
      status: row.status,
      checkIn: row.check_in ?? undefined,
      checkOut: row.check_out ?? undefined,
    })),
    appraisals: (appraisalsResult.data ?? []).map((row) => ({
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
    })),
    fieldVisits: (fieldVisitsResult.data ?? []).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      date: row.date,
      type: row.type,
      lat: row.lat == null ? undefined : toNumber(row.lat),
      lng: row.lng == null ? undefined : toNumber(row.lng),
      locationNotes: row.location_notes ?? "",
      photos: row.photos ?? undefined,
      by: row.by_staff ?? "",
    })),
    followups: (followupsResult.data ?? []).map((row) => ({
      id: row.id,
      loanId: row.loan_id,
      memberId: row.member_id,
      date: row.date,
      note: row.note,
      outcome: row.outcome,
      by: row.by_staff ?? "",
    })),
    penalties: (penaltiesResult.data ?? []).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      loanId: row.loan_id ?? undefined,
      date: row.date,
      amount: toNumber(row.amount),
      reason: row.reason,
      status: row.status,
      paidFrom: row.paid_from ?? undefined,
    })),
    roundOff: (roundOffResult.data ?? []).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      date: row.date,
      amount: toNumber(row.amount),
      source: row.source,
      ref: row.ref ?? undefined,
    })),
    staffMessages: (staffMessagesResult.data ?? []).map((row: any) => ({
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
    })),
    memos: (memosResult.data ?? []).map((row: any) => ({
      id: row.id,
      date: row.memo_date,
      title: row.title,
      body: row.body,
      by: row.by_name,
      byStaffId: row.by_staff_id ?? undefined,
      createdAt: row.created_at,
    })),
    approvals: (approvalsResult.data ?? []).map((row: any) => ({
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
    })),
    feePolicies: (feePoliciesResult.data ?? []).map((row: any) => ({
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
    })),
    supportThreads: (supportThreadsResult.data ?? []).map((row: any) => ({
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
    })),
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
    if (!data.name) throw new Error("Member name is required.");
    if (!data.phone) throw new Error("Member phone is required.");
    if (!isValidLocalKenyanPhone(data.phone)) {
      throw new Error("Use a local phone number starting with 07 or 01.");
    }

    const supabaseAdmin = requireSupabaseAdmin();
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
      field_officer_id: data.fieldOfficerId ?? null,
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
        by_staff: data.fieldOfficerId ?? null,
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
    if (!data.name) throw new Error("Staff name is required.");
    if (!data.email) throw new Error("Staff email is required.");
    if (!data.tempPassword || data.tempPassword.length < 6) {
      throw new Error("Temporary password must be at least 6 characters.");
    }

    const supabaseAdmin = requireSupabaseAdmin();
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
      temp_password: data.tempPassword,
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
    if (!data.id) throw new Error("Staff id is required.");
    const supabaseAdmin = requireSupabaseAdmin();
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
        temp_password: patch.tempPassword || undefined,
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
    if (!data.id) throw new Error("Staff id is required.");
    const supabaseAdmin = requireSupabaseAdmin();
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
    if (!data.staffId) throw new Error("Staff id is required.");
    const supabaseAdmin = requireSupabaseAdmin();
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
    if (!data.senderId || !data.receiverId) throw new Error("Both sender and receiver are required.");
    if (!data.senderName) throw new Error("Sender name is required.");
    if (!data.content && !data.attachment) throw new Error("Message cannot be empty.");

    const runtimeDb = requireSupabaseAdmin() as any;
    const id = makeId("STM");
    const { error } = await runtimeDb.from("staff_messages").insert({
      id,
      sender_id: data.senderId,
      receiver_id: data.receiverId,
      sender_name: data.senderName,
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
    if (!data.title || !data.body || !data.by) throw new Error("Memo title, body and author are required.");

    const runtimeDb = requireSupabaseAdmin() as any;
    const id = makeId("MEM");
    const { error } = await runtimeDb.from("staff_memos").insert({
      id,
      memo_date: data.date,
      title: data.title,
      body: data.body,
      by_staff_id: data.byStaffId ?? null,
      by_name: data.by,
    });
    if (error) throw new Error(error.message);
    return { id };
  });

export const deleteStaffMemoRecord = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "").trim() }))
  .handler(async ({ data }) => {
    if (!data.id) throw new Error("Memo id is required.");
    const runtimeDb = requireSupabaseAdmin() as any;
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
    if (!data.kind || !data.title || !data.detail || !data.requestedBy) {
      throw new Error("Approval request is incomplete.");
    }

    const runtimeDb = requireSupabaseAdmin() as any;
    const id = makeId("APR");
    const { error } = await runtimeDb.from("approval_requests").insert({
      id,
      kind: data.kind,
      title: data.title,
      detail: data.detail,
      requested_by: data.requestedBy,
      requested_by_name: data.requestedByName ?? null,
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
    if (!data.id || !data.reviewedBy) throw new Error("Approval decision is incomplete.");
    const runtimeDb = requireSupabaseAdmin() as any;
    const { error } = await runtimeDb
      .from("approval_requests")
      .update({
        status: data.decision,
        reviewed_by: data.reviewedBy,
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
    if (!data.key || !data.label) throw new Error("Fee policy key and label are required.");
    const runtimeDb = requireSupabaseAdmin() as any;
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
    if (!data.key) throw new Error("Fee key is required.");
    const runtimeDb = requireSupabaseAdmin() as any;
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
    if (!data.memberId || !data.memberName || !data.subject) {
      throw new Error("Support thread details are incomplete.");
    }

    const runtimeDb = requireSupabaseAdmin() as any;
    const id = makeId("SUP");
    const { error: threadError } = await runtimeDb.from("support_threads").insert({
      id,
      member_id: data.memberId,
      member_name: data.memberName,
      assigned_staff_id: data.assignedStaffId ?? null,
      status: data.assignedStaffId ? "open" : "ai",
      subject: data.subject,
    });
    if (threadError) throw new Error(threadError.message);

    if (data.initialMessages.length > 0) {
      const rows = data.initialMessages.map((message, index) => ({
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
    if (!data.threadId || !data.fromName || !data.text) throw new Error("Support message is incomplete.");
    const runtimeDb = requireSupabaseAdmin() as any;
    const id = makeId("SUM");
    const { error } = await runtimeDb.from("support_messages").insert({
      id,
      thread_id: data.threadId,
      sender_kind: data.from,
      sender_name: data.fromName,
      sender_id: data.fromId ?? null,
      text: data.text,
    });
    if (error) throw new Error(error.message);
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
    if (!data.id) throw new Error("Support thread id is required.");
    const runtimeDb = requireSupabaseAdmin() as any;
    const { error } = await runtimeDb
      .from("support_threads")
      .update({
        status: data.status,
        assigned_staff_id: data.assignedStaffId ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
