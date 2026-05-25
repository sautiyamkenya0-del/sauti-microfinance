import { createServerFn } from "@tanstack/react-start";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { membershipIdCandidates } from "@/lib/membership";
import {
  clearAuthSession,
  getAuthSessionData,
  signInMemberSession,
  signInStaffSession,
  verifyPassword,
} from "@/lib/auth.server";
import { recordAudit } from "@/lib/audit.server";
import { toComparableKenyanPhone } from "@/lib/utils";

function requireSupabaseAdmin() {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error(
      "Database sync is unavailable until the server has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured.",
    );
  }
  return supabaseAdmin;
}

export const signInStaff = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => ({
    email: String(data?.email ?? "")
      .trim()
      .toLowerCase(),
    password: String(data?.password ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    if (!data.email || !data.password) throw new Error("Enter your email and password.");

    const supabaseAdmin = requireSupabaseAdmin();
    const { data: staffRow, error } = await supabaseAdmin
      .from("staff")
      .select("id, name, role, temp_password")
      .ilike("email", data.email)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const passwordCheck = verifyPassword(data.password, staffRow?.temp_password);
    if (!staffRow || !passwordCheck.ok) {
      await recordAudit({
        actor_id: staffRow?.id ?? null,
        actor_name: staffRow?.name ?? null,
        actor_role: staffRow?.role ?? "staff",
        action: "auth.staff.sign_in_failed",
        target_type: "staff",
        target_id: staffRow?.id ?? null,
        summary: `Failed staff sign-in for ${data.email}`,
        details: {
          email: data.email,
          reason: staffRow ? "invalid_password" : "unknown_email",
        },
      });
      throw new Error("Invalid email or password.");
    }

    if (passwordCheck.upgradedHash) {
      const { error: upgradeError } = await supabaseAdmin
        .from("staff")
        .update({ temp_password: passwordCheck.upgradedHash })
        .eq("id", staffRow.id);
      if (upgradeError) throw new Error(upgradeError.message);
    }

    await signInStaffSession(staffRow.id);
    await recordAudit({
      actor_id: staffRow.id,
      actor_name: staffRow.name,
      actor_role: staffRow.role,
      action: "auth.staff.signed_in",
      target_type: "staff",
      target_id: staffRow.id,
      summary: `${staffRow.name} signed in`,
      details: {
        email: data.email,
        upgradedLegacyPasswordHash: !!passwordCheck.upgradedHash,
      },
    });
    return {
      user: {
        id: staffRow.id,
        name: staffRow.name,
        role: staffRow.role,
      },
    };
  });

export const signInMember = createServerFn({ method: "POST" })
  .inputValidator((data: { memberNo: string; phone: string }) => ({
    memberNo: String(data?.memberNo ?? "").trim(),
    phone: String(data?.phone ?? "").trim(),
  }))
  .handler(async ({ data }) => {
    if (!data.memberNo || !data.phone) {
      throw new Error("Enter your membership number and registered phone number.");
    }

    const memberCandidates = membershipIdCandidates(data.memberNo);
    if (!memberCandidates.length) throw new Error("The supplied sign-in details are not valid.");

    const supabaseAdmin = requireSupabaseAdmin();
    const { data: memberRows, error } = await supabaseAdmin
      .from("members")
      .select("id, name, phone")
      .in("id", memberCandidates);
    if (error) throw new Error(error.message);
    const memberRow = memberCandidates
      .map((candidate) => (memberRows ?? []).find((row) => row.id === candidate))
      .find(Boolean);

    const suppliedPhone = toComparableKenyanPhone(data.phone);
    const memberPhone = toComparableKenyanPhone(memberRow?.phone ?? "");
    if (!memberRow || !suppliedPhone || memberPhone !== suppliedPhone) {
      await recordAudit({
        actor_id: memberRow?.id ?? null,
        actor_name: memberRow?.name ?? null,
        actor_role: "member",
        action: "auth.member.sign_in_failed",
        target_type: "member",
        target_id: memberRow?.id ?? null,
        summary: `Failed member sign-in for ${data.memberNo}`,
        details: {
          memberNo: data.memberNo,
          reason: memberRow ? "phone_mismatch" : "unknown_member",
        },
      });
      throw new Error("The supplied sign-in details are not valid.");
    }

    await signInMemberSession(memberRow.id);
    const { data: supplierRow, error: supplierError } = await supabaseAdmin
      .from("suppliers")
      .select("id")
      .eq("member_id", memberRow.id)
      .maybeSingle();
    if (supplierError && supplierError.code !== "42P01") {
      throw new Error(supplierError.message);
    }
    await recordAudit({
      actor_id: memberRow.id,
      actor_name: memberRow.name,
      actor_role: "member",
      action: "auth.member.signed_in",
      target_type: "member",
      target_id: memberRow.id,
      summary: `${memberRow.name} signed in`,
      details: {
        memberNo: data.memberNo,
      },
    });
    return {
      member: {
        id: memberRow.id,
        name: memberRow.name,
      },
      portal: supplierRow ? "supplier" : "member",
    };
  });

export const signOutSession = createServerFn({ method: "POST" }).handler(async () => {
  const session = await getAuthSessionData();
  const supabaseAdmin = getSupabaseAdminOrNull();

  let auditEntry:
    | {
        actor_id: string;
        actor_name: string;
        actor_role: string;
        action: string;
        target_type: string;
        target_id: string;
        summary: string;
      }
    | undefined;

  if (supabaseAdmin && session.authMode === "staff" && session.staffId) {
    const { data: staff } = await supabaseAdmin
      .from("staff")
      .select("id, name, role")
      .eq("id", session.staffId)
      .maybeSingle();
    if (staff) {
      auditEntry = {
        actor_id: staff.id,
        actor_name: staff.name,
        actor_role: staff.role,
        action: "auth.staff.signed_out",
        target_type: "staff",
        target_id: staff.id,
        summary: `${staff.name} signed out`,
      };
    }
  } else if (supabaseAdmin && session.authMode === "member" && session.memberId) {
    const { data: member } = await supabaseAdmin
      .from("members")
      .select("id, name")
      .eq("id", session.memberId)
      .maybeSingle();
    if (member) {
      auditEntry = {
        actor_id: member.id,
        actor_name: member.name,
        actor_role: "member",
        action: "auth.member.signed_out",
        target_type: "member",
        target_id: member.id,
        summary: `${member.name} signed out`,
      };
    }
  }

  await clearAuthSession();
  if (auditEntry) {
    await recordAudit(auditEntry);
  }
  return { ok: true };
});
