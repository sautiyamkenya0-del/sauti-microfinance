import "@tanstack/react-start/server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { useSession } from "@tanstack/react-start/server";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { readServerEnv } from "@/lib/server-env";

export type AuthMode = "staff" | "member";

type AppSessionData = {
  authMode?: AuthMode;
  staffId?: string;
  memberId?: string;
};

export type StaffActor = {
  id: string;
  name: string;
  role: "director" | "manager" | "loan_officer" | "locomotive_admin";
  canMarkAttendance: boolean;
  memberId?: string;
};

export type MemberActor = {
  id: string;
  name: string;
  phone: string;
  fieldOfficerId?: string;
};

const SESSION_NAME = "sauti-session";
const HASH_PREFIX = "scrypt";

function sessionPassword() {
  const secret =
    readServerEnv("SAUTI_SESSION_SECRET") ??
    readServerEnv("SESSION_SECRET") ??
    readServerEnv("APP_SESSION_SECRET") ??
    readServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!secret || secret.length < 16) {
    throw new Error(
      "Session security is unavailable until SAUTI_SESSION_SECRET, SESSION_SECRET, APP_SESSION_SECRET, or SUPABASE_SERVICE_ROLE_KEY is configured on the server.",
    );
  }

  return secret;
}

async function useAuthSession() {
  return useSession<AppSessionData>({
    name: SESSION_NAME,
    password: sessionPassword(),
    maxAge: 60 * 60 * 12,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: (readServerEnv("NODE_ENV") ?? "").toLowerCase() === "production",
    },
  });
}

async function requireSupabaseAdmin() {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error(
      "Database sync is unavailable until the server has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured.",
    );
  }
  return supabaseAdmin;
}

function isMissingColumnError(error: any, column: string) {
  const message = String(error?.message ?? "");
  return error?.code === "42703" || message.includes(column);
}

export async function getAuthSessionData() {
  const session = await useAuthSession();
  return session.data;
}

export async function signInStaffSession(staffId: string) {
  const session = await useAuthSession();
  await session.update(() => ({
    authMode: "staff",
    staffId,
    memberId: undefined,
  }));
}

export async function signInMemberSession(memberId: string) {
  const session = await useAuthSession();
  await session.update(() => ({
    authMode: "member",
    memberId,
    staffId: undefined,
  }));
}

export async function clearAuthSession() {
  const session = await useAuthSession();
  await session.clear();
}

export async function requireSignedInSession() {
  const data = await getAuthSessionData();
  if (!data.authMode) throw new Error("Please sign in to continue.");
  return data;
}

export async function requireStaffActor() {
  const session = await requireSignedInSession();
  if (session.authMode !== "staff" || !session.staffId) {
    throw new Error("Staff sign-in is required for this action.");
  }

  const supabaseAdmin = await requireSupabaseAdmin();
  let { data, error } = await supabaseAdmin
    .from("staff")
    .select("id, name, role, can_mark_attendance, member_id")
    .eq("id", session.staffId)
    .maybeSingle();
  if (error && isMissingColumnError(error, "member_id")) {
    const retry = await supabaseAdmin
      .from("staff")
      .select("id, name, role, can_mark_attendance")
      .eq("id", session.staffId)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
  }
  if (error) throw new Error(error.message);

  if (!data) {
    await clearAuthSession();
    throw new Error("Your staff session is no longer valid. Please sign in again.");
  }

  return {
    id: data.id,
    name: data.name,
    role: data.role,
    canMarkAttendance: data.can_mark_attendance,
    memberId: data.member_id ?? undefined,
  } satisfies StaffActor;
}

export async function requireDirectorActor() {
  const actor = await requireStaffActor();
  if (actor.role !== "director") throw new Error("Director access is required.");
  return actor;
}

export async function requireManagerOrDirectorActor() {
  const actor = await requireStaffActor();
  if (actor.role !== "manager" && actor.role !== "director") {
    throw new Error("Manager or director access is required.");
  }
  return actor;
}

export async function requireMemberActor() {
  const session = await requireSignedInSession();
  if (session.authMode !== "member" || !session.memberId) {
    throw new Error("Member sign-in is required for this action.");
  }

  const supabaseAdmin = await requireSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("members")
    .select("id, name, phone, field_officer_id")
    .eq("id", session.memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!data) {
    await clearAuthSession();
    throw new Error("Your member session is no longer valid. Please sign in again.");
  }

  return {
    id: data.id,
    name: data.name,
    phone: data.phone,
    fieldOfficerId: data.field_officer_id ?? undefined,
  } satisfies MemberActor;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}:${salt}:${derived}`;
}

function isPasswordHash(value: string) {
  return value.startsWith(`${HASH_PREFIX}:`);
}

export function verifyPassword(password: string, storedValue?: string | null) {
  if (!storedValue) return { ok: false as const };

  if (!isPasswordHash(storedValue)) {
    const ok = storedValue === password;
    return {
      ok,
      upgradedHash: ok ? hashPassword(password) : undefined,
    };
  }

  const [, salt, expectedHash] = storedValue.split(":");
  if (!salt || !expectedHash) return { ok: false as const };

  const actualHash = scryptSync(password, salt, expectedHash.length / 2);
  const ok = timingSafeEqual(actualHash, Buffer.from(expectedHash, "hex"));
  return { ok };
}
