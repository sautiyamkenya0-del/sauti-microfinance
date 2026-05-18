import { createServerFn } from "@tanstack/react-start";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  clearAuthSession,
  signInMemberSession,
  signInStaffSession,
  verifyPassword,
} from "@/lib/auth.server";
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

function parseMembershipNumber(value: string) {
  const normalized = value.trim().toUpperCase();
  const match = normalized.match(/(\d{1,4})/);
  if (!match) return undefined;
  return `M${match[1].padStart(3, "0")}`;
}

export const signInStaff = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => ({
    email: String(data?.email ?? "").trim().toLowerCase(),
    password: String(data?.password ?? ""),
  }))
  .handler(async ({ data }) => {
    if (!data.email || !data.password) throw new Error("Enter your email and password.");

    const supabaseAdmin = requireSupabaseAdmin();
    const { data: staffRow, error } = await supabaseAdmin
      .from("staff")
      .select("*")
      .eq("email", data.email)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const passwordCheck = verifyPassword(data.password, staffRow?.temp_password);
    if (!staffRow || !passwordCheck.ok) throw new Error("Invalid email or password.");

    if (passwordCheck.upgradedHash) {
      const { error: upgradeError } = await supabaseAdmin
        .from("staff")
        .update({ temp_password: passwordCheck.upgradedHash })
        .eq("id", staffRow.id);
      if (upgradeError) throw new Error(upgradeError.message);
    }

    await signInStaffSession(staffRow.id);
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

    const memberId = parseMembershipNumber(data.memberNo);
    if (!memberId) throw new Error("The supplied sign-in details are not valid.");

    const supabaseAdmin = requireSupabaseAdmin();
    const { data: memberRow, error } = await supabaseAdmin
      .from("members")
      .select("id, name, phone")
      .eq("id", memberId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const suppliedPhone = toComparableKenyanPhone(data.phone);
    const memberPhone = toComparableKenyanPhone(memberRow?.phone ?? "");
    if (!memberRow || !suppliedPhone || memberPhone !== suppliedPhone) {
      throw new Error("The supplied sign-in details are not valid.");
    }

    await signInMemberSession(memberRow.id);
    return {
      member: {
        id: memberRow.id,
        name: memberRow.name,
      },
    };
  });

export const signOutSession = createServerFn({ method: "POST" }).handler(async () => {
  await clearAuthSession();
  return { ok: true };
});
