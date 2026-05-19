import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";
import { recordMpesaStkPushRequestEvent } from "@/lib/app-data.functions";
import { requireMemberActor, requireSignedInSession } from "@/lib/auth.server";
import { formatMembershipNumber } from "@/lib/membership";
import {
  fetchMpesaDaraja,
  getDarajaAccessToken,
  MpesaRequestTimeoutError,
} from "@/lib/mpesa-config.server";
import { toComparableKenyanPhone } from "@/lib/utils";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function darajaTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}${value("month")}${value("day")}${value("hour")}${value("minute")}${value("second")}`;
}

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
            if (lastAttempt?.timeoutMs) {
              return Response.json(
                {
                  ok: false,
                  error: "M-Pesa authentication timed out before Daraja responded.",
                  hint: "Safaricom Daraja did not respond quickly enough. Try again shortly; if this repeats, check Daraja status and network reachability from the server.",
                  attempts: tokenResult.attempts,
                },
                { status: 504 },
              );
            }
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

          const timestamp = darajaTimestamp();
          const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
          const origin = new URL(request.url).origin;
          const callback = `${origin}/api/public/mpesa/confirmation`;

          let stkRes: Response;
          try {
            stkRes = await fetchMpesaDaraja(`${base}/mpesa/stkpush/v1/processrequest`, {
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
          } catch (error) {
            if (error instanceof MpesaRequestTimeoutError) {
              return Response.json(
                {
                  ok: false,
                  error: "M-Pesa STK request timed out before Daraja responded.",
                  hint: "Safaricom Daraja did not respond quickly enough. Try again shortly; if this repeats, check Daraja status and network reachability from the server.",
                  timeoutMs: error.timeoutMs,
                },
                { status: 504 },
              );
            }
            throw error;
          }

          const stkJson = asRecord(await stkRes.json().catch(() => ({})));
          if (!stkRes.ok) {
            console.error("Daraja stkpush failed", stkRes.status, stkJson);

            const errorCode = String(stkJson.errorCode ?? "");
            const errorMessage = String(stkJson.errorMessage ?? "STK push failed");
            const requestId = String(stkJson.requestId ?? "");

            if (errorCode === "404.001.03") {
              return Response.json(
                {
                  ok: false,
                  error: "Daraja rejected the configured M-Pesa app/token for STK Push.",
                  hint: "If these production values work on the old site, this deployment is probably using different effective MPESA_* values from /secret-keys or the hosting env. Check /secret-keys, then set SAUTI_MPESA_SECRET_SOURCE=env-first or delete stale runtime MPESA_* keys.",
                  details: {
                    ...stkJson,
                    requestId,
                    errorCode,
                    errorMessage,
                    activeVariant: activeConfig.label,
                    env: activeConfig.normalizedEnv,
                    shortcode,
                    sources: activeConfig.sources,
                    callback,
                    timestampZone: "Africa/Nairobi",
                  },
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
                response: stkJson,
              },
              account: accountRef.toUpperCase(),
              amount,
              phone: msisdn,
              checkoutRequestId: String(stkJson.CheckoutRequestID ?? "").trim() || undefined,
              merchantRequestId: String(stkJson.MerchantRequestID ?? "").trim() || undefined,
            });
          } catch (trackingError) {
            console.error("stkpush request tracking error", trackingError);
          }

          return Response.json({ ok: true, ...stkJson });
        } catch (error) {
          console.error("stkpush handler error", error);
          return Response.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unknown server error.",
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
