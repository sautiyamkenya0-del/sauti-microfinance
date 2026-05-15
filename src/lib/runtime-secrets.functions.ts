import { createServerFn } from "@tanstack/react-start";

import {
  getSupabaseAdminEnvStatus,
  getSupabaseAdminOrNull,
} from "@/integrations/supabase/client.server";
import { recordAudit } from "@/lib/audit.server";

type RuntimeSecretListResult = {
  items: Array<{ key: string; preview: string; length: number; updated_at: string }>;
  writable: boolean;
  reason: string;
};

/** List all runtime secret keys with redacted previews. */
export const listRuntimeSecrets = createServerFn({ method: "GET" }).handler<
  Promise<RuntimeSecretListResult>
>(async () => {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    return {
      items: [],
      writable: false,
      reason:
        "The runtime secret vault is unavailable because SUPABASE_SERVICE_ROLE_KEY is not configured on the server.",
    };
  }

  const { data, error } = await supabaseAdmin
    .from("runtime_secrets")
    .select("key, updated_at, value")
    .order("key");
  if (error) throw new Error(error.message);

  return {
    items: (data ?? []).map((row) => ({
      key: row.key,
      updated_at: row.updated_at,
      preview: row.value ? `${row.value.slice(0, 4)}...${row.value.slice(-3)}` : "",
      length: row.value?.length ?? 0,
    })),
    writable: true,
    reason: "",
  };
});

/** Upsert a runtime secret. */
export const setRuntimeSecret = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      key: string;
      value: string;
      actorId?: string;
      actorName?: string;
      actorRole?: string;
    }) => {
      const key = String(data?.key ?? "")
        .trim()
        .toUpperCase();
      const value = String(data?.value ?? "");
      if (!/^[A-Z0-9_]{2,64}$/.test(key)) throw new Error("Key must be A-Z, 0-9, _ (2-64 chars)");
      if (!value || value.length > 4096) throw new Error("Value required (max 4096 chars)");
      return {
        key,
        value,
        actorId: data.actorId,
        actorName: data.actorName,
        actorRole: data.actorRole,
      };
    },
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = getSupabaseAdminOrNull();
    if (!supabaseAdmin) {
      const missing = getSupabaseAdminEnvStatus().missing.join(", ");
      throw new Error(
        `Runtime secret saving is unavailable until the server has: ${missing}. Add those values to local env or hosting secrets.`,
      );
    }

    const { error } = await supabaseAdmin
      .from("runtime_secrets")
      .upsert({ key: data.key, value: data.value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);

    await recordAudit({
      actor_id: data.actorId,
      actor_name: data.actorName,
      actor_role: data.actorRole,
      action: "secret.upsert",
      target_type: "runtime_secret",
      target_id: data.key,
      summary: `Saved secret ${data.key} (${data.value.length} chars)`,
    });

    return { ok: true };
  });

/** Delete a secret. */
export const deleteRuntimeSecret = createServerFn({ method: "POST" })
  .inputValidator(
    (data: { key: string; actorId?: string; actorName?: string; actorRole?: string }) => ({
      key: String(data?.key ?? "")
        .trim()
        .toUpperCase(),
      actorId: data.actorId,
      actorName: data.actorName,
      actorRole: data.actorRole,
    }),
  )
  .handler(async ({ data }) => {
    const supabaseAdmin = getSupabaseAdminOrNull();
    if (!supabaseAdmin) {
      const missing = getSupabaseAdminEnvStatus().missing.join(", ");
      throw new Error(
        `Runtime secret deletion is unavailable until the server has: ${missing}. Add those values to local env or hosting secrets.`,
      );
    }

    const { error } = await supabaseAdmin.from("runtime_secrets").delete().eq("key", data.key);
    if (error) throw new Error(error.message);

    await recordAudit({
      actor_id: data.actorId,
      actor_name: data.actorName,
      actor_role: data.actorRole,
      action: "secret.delete",
      target_type: "runtime_secret",
      target_id: data.key,
      summary: `Deleted secret ${data.key}`,
    });

    return { ok: true };
  });
