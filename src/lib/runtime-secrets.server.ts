import "@tanstack/react-start/server-only";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/lib/audit.server";
import { readServerEnv } from "@/lib/server-env";

type RuntimeSecretActor = {
  actorId?: string;
  actorName?: string;
  actorRole?: string;
};

/** Server-only: read a runtime secret value (or undefined). */
export async function getRuntimeSecret(key: string): Promise<string | undefined> {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) return undefined;

  const { data } = await supabaseAdmin
    .from("runtime_secrets")
    .select("value")
    .eq("key", key.toUpperCase())
    .maybeSingle();
  return data?.value ?? undefined;
}

/**
 * Server-only: read a secret. Director-managed values stored in the
 * `runtime_secrets` table take precedence over the build-time
 * `process.env` value, so directors can edit secrets (Groq AI,
 * M-Pesa shortcode/keys, etc.) directly from the /secret-keys vault
 * without redeploying.
 */
export async function getSecret(key: string): Promise<string | undefined> {
  const k = key.toUpperCase();
  const override = await getRuntimeSecret(k);
  if (override && override.trim().length > 0) return override;
  return readServerEnv(k);
}

export async function listRuntimeSecretsFromServer() {
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
}

export async function saveRuntimeSecretOnServer(
  key: string,
  value: string,
  actor: RuntimeSecretActor = {},
) {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error(
      "Runtime secret saving is unavailable until the server has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Add those values to local env or hosting secrets.",
    );
  }

  const { error } = await supabaseAdmin
    .from("runtime_secrets")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);

  await recordAudit({
    actor_id: actor.actorId,
    actor_name: actor.actorName,
    actor_role: actor.actorRole,
    action: "secret.upsert",
    target_type: "runtime_secret",
    target_id: key,
    summary: `Saved secret ${key} (${value.length} chars)`,
  });
}

export async function deleteRuntimeSecretOnServer(key: string, actor: RuntimeSecretActor = {}) {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error(
      "Runtime secret deletion is unavailable until the server has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Add those values to local env or hosting secrets.",
    );
  }

  const { error } = await supabaseAdmin.from("runtime_secrets").delete().eq("key", key);
  if (error) throw new Error(error.message);

  await recordAudit({
    actor_id: actor.actorId,
    actor_name: actor.actorName,
    actor_role: actor.actorRole,
    action: "secret.delete",
    target_type: "runtime_secret",
    target_id: key,
    summary: `Deleted secret ${key}`,
  });
}
