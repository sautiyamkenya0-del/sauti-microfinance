import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";
import { recordMpesaStkPushRequestEvent } from "@/lib/app-data.functions";
import { requireMemberActor, requireSignedInSession } from "@/lib/auth.server";
import { formatMembershipNumber } from "@/lib/membership";
import { getDarajaAccessToken } from "@/lib/mpesa-config.server";
import { toComparableKenyanPhone } from "@/lib/utils";

/** Daraja STK Push trigger.
 * POST { phone, amount, accountRef, description } -> sends a real Lipa Na M-Pesa Online prompt.
 */
export const Route = createFileRoute("/api/public/mpesa/stkpush")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const session = await requireSignedInSession();
          const body = await request.json();
          const phoneRaw = String(body.phone ?? "").replace(/\D/g, "");
          const amount = Math.max(1, Math.floor(Number(body.amount) || 0));
          const accountRef = String(body.accountRef ?? "SBC").slice(0, 12);
          const description = String(body.description ?? "Sauti payment").slice(0, 100);

          let msisdn = phoneRaw;
          if (msisdn.startsWith("0")) msisdn = "254" + msisdn.slice(1);
          if (msisdn.startsWith("+")) msisdn = msisdn.slice(1);

          if (!/^254\d{9}$/.test(msisdn)) {
            return Response.json(
              { ok: false, error: "Invalid phone number. Use the format 2547XXXXXXXX." },
              { status: 400 },
            );
          }

          if (amount < 1) {
            return Response.json(
              { ok: false, error: "Amount must be at least 1." },
              { status: 400 },
            );
          }

          if (session.authMode === "member") {
            const member = await requireMemberActor();
            const expectedAccountRef = formatMembershipNumber(member.id);
            if (accountRef.toUpperCase() !== expectedAccountRef) {
              return Response.json(
                {
                  ok: false,
                  error: "Members can only trigger M-Pesa prompts for their own account.",
                },
                { status: 403 },
              );
            }
            if (toComparableKenyanPhone(body.phone) !== toComparableKenyanPhone(member.phone)) {
              return Response.json(
                {
                  ok: false,
                  error:
                    "Members can only trigger M-Pesa prompts to their registered phone number.",
                },
                { status: 403 },
              );
            }
          }

          const tokenResult = await getDarajaAccessToken();
          const adminEnv = getSupabaseAdminEnvStatus();
          const activeConfig = tokenResult.ok ? tokenResult.config : tokenResult.variants.effective;
          const shortcode = activeConfig.shortcode;
          const passkey = activeConfig.passkey;
          const base =
            activeConfig.normalizedEnv === "sandbox"
              ? "https://sandbox.safaricom.co.ke"
              : "https://api.safaricom.co.ke";

          if (!shortcode || !passkey || !activeConfig.completeness.oauthReady) {
            return Response.json(
              {
                ok: false,
                error: "M-Pesa is not fully configured on the server.",
                hint: adminEnv.ok
                  ? "Set MPESA_ENV, MPESA_SHORTCODE, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, and MPESA_PASSKEY in the secret vault or hosting environment."
                  : `The runtime secret table cannot be read because ${adminEnv.missing.join(", ")} is missing on the server. Add the missing server env and restart/redeploy, or place the MPESA_* values directly in the hosting environment.`,
                details: {
                  resolutionMode: tokenResult.variants.resolutionMode,
                  activeSource: activeConfig.sources,
                },
              },
              { status: 503 },
            );
          }

          if (!tokenResult.ok) {
            const lastAttempt = tokenResult.attempts[tokenResult.attempts.length - 1];
            console.error("Daraja oauth failed", tokenResult.status, tokenResult.attempts);
            return Response.json(
              {
                ok: false,
                error: `M-Pesa authentication failed (${tokenResult.status ?? "unknown"}).`,
                hint:
                  tokenResult.status === 400 || tokenResult.status === 401
                    ? "Check that the consumer key, consumer secret, and MPESA_ENV match the same Daraja environment. If Vercel has the right values but /secret-keys is stale, set SAUTI_MPESA_SECRET_SOURCE=env-first or delete the stale runtime MPESA_* keys."
                    : "Check the configured Daraja credentials and try again.",
                daraja: lastAttempt?.body ?? tokenResult.error,
                attempts: tokenResult.attempts,
              },
              { status: 502 },
            );
          }

          const accessToken = tokenResult.accessToken;

          const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
          const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
          const origin = new URL(request.url).origin;
          const callback = `${origin}/api/confirmation`;

          const stkRes = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              BusinessShortCode: shortcode,
              Password: password,
              Timestamp: timestamp,
              TransactionType: "CustomerPayBillOnline",
              Amount: amount,
              PartyA: msisdn,
              PartyB: shortcode,
              PhoneNumber: msisdn,
              CallBackURL: callback,
              AccountReference: accountRef,
              TransactionDesc: description,
            }),
          });

          const stkJson = await stkRes.json().catch(() => ({}));
          if (!stkRes.ok) {
            console.error("Daraja stkpush failed", stkRes.status, stkJson);

            const errorCode = String((stkJson as any)?.errorCode ?? "");
            const errorMessage = String((stkJson as any)?.errorMessage ?? "STK push failed");
            const requestId = String((stkJson as any)?.requestId ?? "");

            if (errorCode === "404.001.03") {
              return Response.json(
                {
                  ok: false,
                  error: "M-Pesa STK is not enabled for the configured Daraja application.",
                  hint: "Enable Lipa Na M-Pesa Online / STK Push for the same production app in the Daraja portal, or switch back to credentials that already have STK enabled.",
                  details: { ...(stkJson as object), requestId, errorCode, errorMessage },
                },
                { status: 502 },
              );
            }

            return Response.json(
              { ok: false, error: errorMessage, details: stkJson },
              { status: 502 },
            );
          }

          try {
            await recordMpesaStkPushRequestEvent({
              raw: {
                callback,
                accountRef,
                amount,
                phone: msisdn,
                description,
                response: stkJson as Record<string, unknown>,
              },
              account: accountRef.toUpperCase(),
              amount,
              phone: msisdn,
              checkoutRequestId: String((stkJson as any)?.CheckoutRequestID ?? "").trim() || undefined,
              merchantRequestId: String((stkJson as any)?.MerchantRequestID ?? "").trim() || undefined,
            });
          } catch (trackingError) {
            console.error("stkpush request tracking error", trackingError);
          }

          return Response.json({ ok: true, ...(stkJson as object) });
        } catch (error: any) {
          console.error("stkpush handler error", error);
          return Response.json(
            { ok: false, error: error?.message ?? "Unknown server error." },
            { status: 500 },
          );
        }
      },
    },
  },
});
