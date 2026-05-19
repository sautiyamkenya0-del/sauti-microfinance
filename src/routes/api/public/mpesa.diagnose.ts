import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";
import { requireDirectorActor } from "@/lib/auth.server";
import { getDarajaAccessToken, loadMpesaConfigVariants } from "@/lib/mpesa-config.server";
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
      resolutionMode: details.resolutionMode,
      candidates: {
        runtimeVault: {
          source: details.candidates.runtimeVault.source,
          normalizedLength: details.candidates.runtimeVault.normalizedLength,
        },
        hostingEnv: {
          source: details.candidates.hostingEnv.source,
          normalizedLength: details.candidates.hostingEnv.normalizedLength,
        },
      },
    };
  }

  return {
    status: "set",
    source: details.source,
    resolutionMode: details.resolutionMode,
    normalizedLength: details.normalizedLength,
    hadOuterWhitespace: details.hadOuterWhitespace,
    hadWrappingQuotes: details.hadWrappingQuotes,
    candidates: {
      runtimeVault: {
        source: details.candidates.runtimeVault.source,
        normalizedLength: details.candidates.runtimeVault.normalizedLength,
      },
      hostingEnv: {
        source: details.candidates.hostingEnv.source,
        normalizedLength: details.candidates.hostingEnv.normalizedLength,
      },
    },
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
        const [envDetails, consumerKeyDetails, consumerSecretDetails, shortcodeDetails, passkeyDetails] =
          await Promise.all([
            inspectSecret("MPESA_ENV"),
            inspectSecret("MPESA_CONSUMER_KEY"),
            inspectSecret("MPESA_CONSUMER_SECRET"),
            inspectSecret("MPESA_SHORTCODE"),
            inspectSecret("MPESA_PASSKEY"),
          ]);

        const configVariants = await loadMpesaConfigVariants();
        const sc = shortcodeDetails.value ?? "";
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
            resolutionMode: envDetails.resolutionMode,
            candidates: {
              runtimeVault: {
                source: envDetails.candidates.runtimeVault.source,
                normalizedLength: envDetails.candidates.runtimeVault.normalizedLength,
              },
              hostingEnv: {
                source: envDetails.candidates.hostingEnv.source,
                normalizedLength: envDetails.candidates.hostingEnv.normalizedLength,
              },
            },
          },
          MPESA_CONSUMER_KEY: summarizeSecret(consumerKeyDetails, { preview: true }),
          MPESA_CONSUMER_SECRET: summarizeSecret(consumerSecretDetails),
          MPESA_SHORTCODE: {
            ...summarizeSecret(shortcodeDetails),
            ...(sc ? { effectiveValue: sc } : {}),
          },
          MPESA_PASSKEY: summarizeSecret(passkeyDetails),
          base,
          precedence: `${configVariants.resolutionMode} (primary) with automatic alternate-source retry for OAuth`,
          variants: {
            effective: {
              env: configVariants.effective.normalizedEnv,
              sources: configVariants.effective.sources,
              oauthReady: configVariants.effective.completeness.oauthReady,
              stkReady: configVariants.effective.completeness.stkReady,
            },
            hosting_env: {
              env: configVariants.hostingEnv.normalizedEnv,
              sources: configVariants.hostingEnv.sources,
              oauthReady: configVariants.hostingEnv.completeness.oauthReady,
              stkReady: configVariants.hostingEnv.completeness.stkReady,
            },
            runtime_vault: {
              env: configVariants.runtimeVault.normalizedEnv,
              sources: configVariants.runtimeVault.sources,
              oauthReady: configVariants.runtimeVault.completeness.oauthReady,
              stkReady: configVariants.runtimeVault.completeness.stkReady,
            },
          },
          runtime_vault: adminEnv.ok
            ? "available"
            : `unavailable (missing ${adminEnv.missing.join(", ")})`,
        };

        if (!configVariants.effective.completeness.oauthReady) {
          return Response.json({
            ok: false,
            stage: "presence",
            presence,
            error: "Consumer key/secret missing",
          });
        }

        try {
          const authResult = await getDarajaAccessToken();
          if (!authResult.ok) {
            return Response.json({
              ok: false,
              stage: "oauth",
              status: authResult.status,
              presence,
              attempts: authResult.attempts,
              hint:
                authResult.status === 400 || authResult.status === 401
                  ? "Likely causes: the Daraja consumer key/secret do not match MPESA_ENV, the wrong source won the secret lookup, or the configured values include wrapping quotes/whitespace."
                  : undefined,
            });
          }

          return Response.json({
            ok: true,
            stage: "oauth",
            status: 200,
            presence,
            attempts: authResult.attempts,
            active_variant: {
              label: authResult.config.label,
              env: authResult.config.normalizedEnv,
              sources: authResult.config.sources,
            },
            access_token_prefix: String(authResult.accessToken ?? "").slice(0, 12) + "...",
            expires_in: authResult.expiresIn,
            note:
              authResult.config.label === "hosting_env" || authResult.config.label === "runtime_vault"
                ? `OAuth succeeded after switching to ${authResult.config.label}. If this is the desired long-term source, set SAUTI_MPESA_SECRET_SOURCE=${authResult.config.label === "hosting_env" ? "env-first" : "runtime-first"} or clean up the conflicting MPESA_* values.`
                : "OAuth is working. If STK Push still returns 404.001.03 Invalid Access Token, the Daraja app is authenticated but not provisioned for Lipa Na M-Pesa Online / STK Push in this environment.",
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
