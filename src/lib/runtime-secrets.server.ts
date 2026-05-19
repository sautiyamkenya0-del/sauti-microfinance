import "@tanstack/react-start/server-only";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/lib/audit.server";
import { inspectServerEnv, readServerEnv } from "@/lib/server-env";

type RuntimeSecretActor = {
  actorId?: string;
  actorName?: string;
  actorRole?: string;
};

export type SecretInspection = {
  key: string;
  source: "runtime_vault" | "process.env" | "import.meta.env" | "missing";
  rawLength: number;
  normalizedLength: number;
  hadOuterWhitespace: boolean;
  hadWrappingQuotes: boolean;
  value?: string;
};

function normalizeSecretValue(raw: string | undefined): Omit<SecretInspection, "key" | "source"> {
  if (typeof raw !== "string") {
    return {
      rawLength: 0,
      normalizedLength: 0,
      hadOuterWhitespace: false,
      hadWrappingQuotes: false,
      value: undefined,
    };
  }

  const trimmed = raw.trim();
  const hadOuterWhitespace = trimmed !== raw;
  const hadWrappingQuotes =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  const unwrapped = hadWrappingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
  const value = unwrapped.length > 0 ? unwrapped : undefined;

  return {
    rawLength: raw.length,
    normalizedLength: value?.length ?? 0,
    hadOuterWhitespace,
    hadWrappingQuotes,
    value,
  };
}

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

export async function inspectSecret(key: string): Promise<SecretInspection> {
  const normalizedKey = key.toUpperCase();
  const runtimeDetails = normalizeSecretValue(await getRuntimeSecret(normalizedKey));
  if (runtimeDetails.value) {
    return {
      key: normalizedKey,
      source: "runtime_vault",
      ...runtimeDetails,
    };
  }

  const envDetails = inspectServerEnv(normalizedKey);
  return {
    key: normalizedKey,
    source: envDetails.source,
    rawLength: envDetails.rawLength,
    normalizedLength: envDetails.normalizedLength,
    hadOuterWhitespace: envDetails.hadOuterWhitespace,
    hadWrappingQuotes: envDetails.hadWrappingQuotes,
    value: envDetails.value,
  };
}

/**
 * Server-only: read a secret. Director-managed values stored in the
 * `runtime_secrets` table take precedence over the build-time
 * `process.env` value, so directors can edit secrets (Groq AI,
 * M-Pesa shortcode/keys, etc.) directly from the /secret-keys vault
 * without redeploying.
 */
export async function getSecret(key: string): Promise<string | undefined> {
  const details = await inspectSecret(key);
  if (details.value) return details.value;
  return readServerEnv(key.toUpperCase());
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
