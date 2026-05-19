import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";
import { requireDirectorActor } from "@/lib/auth.server";
import { inspectSecret } from "@/lib/runtime-secrets.server";
import { readServerEnv } from "@/lib/server-env";

function summarizeSecret(
  details: Awaited<ReturnType<typeof inspectSecret>>,
  options?: {
    preview?: boolean;
  },
) {
  if (!details.value) {
    return {
      status: "MISSING",
      source: details.source,
    };
  }

  return {
    status: "set",
    source: details.source,
    normalizedLength: details.normalizedLength,
    hadOuterWhitespace: details.hadOuterWhitespace,
    hadWrappingQuotes: details.hadWrappingQuotes,
    ...(options?.preview ? { prefix: details.value.slice(0, 4) } : {}),
  };
}

/** GET /api/public/mpesa/diagnose
 *  Returns whether each MPESA_* secret is set + tries an OAuth token call.
 *  Helps troubleshoot "M-Pesa auth failed" without sending an STK prompt.
 */
export const Route = createFileRoute("/api/public/mpesa/diagnose")({
  server: {
    handlers: {
      GET: async () => {
        const diagnosticsEnabled =
          (readServerEnv("NODE_ENV") ?? "").toLowerCase() !== "production" ||
          (readServerEnv("SAUTI_ENABLE_MPESA_DIAGNOSTICS") ?? "").toLowerCase() === "true";
        if (!diagnosticsEnabled) {
          return new Response("Not found", { status: 404 });
        }

        await requireDirectorActor();
        const adminEnv = getSupabaseAdminEnvStatus();
        const envDetails = await inspectSecret("MPESA_ENV");
        const consumerKeyDetails = await inspectSecret("MPESA_CONSUMER_KEY");
        const consumerSecretDetails = await inspectSecret("MPESA_CONSUMER_SECRET");
        const shortcodeDetails = await inspectSecret("MPESA_SHORTCODE");
        const passkeyDetails = await inspectSecret("MPESA_PASSKEY");

        const ck = consumerKeyDetails.value ?? "";
        const cs = consumerSecretDetails.value ?? "";
        const sc = shortcodeDetails.value ?? "";
        const pk = passkeyDetails.value ?? "";
        const env = (envDetails.value ?? "production").toLowerCase();
        const base =
          env === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";

        const presence = {
          MPESA_ENV: {
            status: envDetails.value ? "set" : "defaulted",
            source: envDetails.value ? envDetails.source : "default",
            effectiveValue: env,
            normalizedLength: envDetails.normalizedLength,
            hadOuterWhitespace: envDetails.hadOuterWhitespace,
            hadWrappingQuotes: envDetails.hadWrappingQuotes,
          },
          MPESA_CONSUMER_KEY: summarizeSecret(consumerKeyDetails, { preview: true }),
          MPESA_CONSUMER_SECRET: summarizeSecret(consumerSecretDetails),
          MPESA_SHORTCODE: {
            ...summarizeSecret(shortcodeDetails),
            ...(sc ? { effectiveValue: sc } : {}),
          },
          MPESA_PASSKEY: summarizeSecret(passkeyDetails),
          base,
          precedence: "runtime_vault overrides hosting env",
          runtime_vault: adminEnv.ok
            ? "available"
            : `unavailable (missing ${adminEnv.missing.join(", ")})`,
        };

        if (!ck || !cs)
          return Response.json({
            ok: false,
            stage: "presence",
            presence,
            error: "Consumer key/secret missing",
          });

        try {
          const auth = Buffer.from(`${ck}:${cs}`).toString("base64");
          const res = await fetch(`${base}/oauth/v2/generate?grant_type=client_credentials`, {
            headers: { Authorization: `Basic ${auth}` },
          });
          const text = await res.text();
          let body: any;
          try {
            body = JSON.parse(text);
          } catch {
            body = { raw: text };
          }
          if (!res.ok) {
            return Response.json({
              ok: false,
              stage: "oauth",
              status: res.status,
              presence,
              response: body,
              hint:
                res.status === 400
                  ? "Likely causes: the Daraja consumer key/secret do not match MPESA_ENV, a saved /secret-keys value is overriding Vercel, or the Vercel values were pasted with wrapping quotes/whitespace."
                  : undefined,
            });
          }
          return Response.json({
            ok: true,
            stage: "oauth",
            status: res.status,
            presence,
            access_token_prefix: String(body.access_token ?? "").slice(0, 12) + "…",
            expires_in: body.expires_in,
            note: "OAuth is working. If STK Push still returns 404.001.03 Invalid Access Token, the Daraja app is authenticated but not provisioned for Lipa Na M-Pesa Online / STK Push in this environment.",
          });
        } catch (e: any) {
          return Response.json({
            ok: false,
            stage: "oauth",
            presence,
            error: e?.message ?? "fetch failed",
          });
        }
      },
    },
  },
});
