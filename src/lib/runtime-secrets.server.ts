import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Server-only: read a runtime secret value (or undefined). */
export async function getRuntimeSecret(key: string): Promise<string | undefined> {
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
  return process.env[k];
}
