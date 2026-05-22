import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";
import { recordMpesaStkPushRequestEvent } from "@/lib/app-data.functions";
import { requireMemberActor, requireSignedInSession } from "@/lib/auth.server";
import { formatMembershipNumber } from "@/lib/membership";
import {
  fetchMpesaDaraja,
  getDarajaAccessTokenForConfig,
  getMpesaConfigCandidateOrder,
  loadMpesaConfigVariants,
  type MpesaConfigVariant,
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

function formatDarajaPhone(value: unknown) {
  let phone = String(value ?? "").trim();
  if (phone.startsWith("+")) phone = phone.slice(1);
  phone = phone.replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `254${phone.slice(1)}`;
  if (/^7\d{8}$/.test(phone) || /^1\d{8}$/.test(phone)) phone = `254${phone}`;
  return phone;
}

function callbackUrlFromConfig(configuredUrl: string | undefined, requestUrl: string) {
  const configured = String(configuredUrl ?? "").trim();
  if (configured) return configured;
  return `${new URL(requestUrl).origin}/api/public/payments/confirmation`;
}

async function sendDarajaStkPush(args: {
  config: MpesaConfigVariant;
  accessToken: string;
  requestUrl: string;
  msisdn: string;
  amount: number;
  accountRef: string;
  description: string;
}) {
  const shortcode = args.config.shortcode ?? "";
  const passkey = args.config.passkey ?? "";
  const timestamp = darajaTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
  const callback = callbackUrlFromConfig(args.config.callbackUrl, args.requestUrl);
  const base =
    args.config.normalizedEnv === "sandbox"
      ? "https://sandbox.safaricom.co.ke"
      : "https://api.safaricom.co.ke";

  const response = await fetchMpesaDaraja(`${base}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: args.amount,
      PartyA: args.msisdn,
      PartyB: shortcode,
      PhoneNumber: args.msisdn,
      CallBackURL: callback,
      AccountReference: args.accountRef,
      TransactionDesc: args.description,
    }),
  });

  const body = asRecord(await response.json().catch(() => ({})));
  return {
    ok: response.ok,
    status: response.status,
    body,
    callback,
    timestampZone: "Africa/Nairobi",
  };
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
          const msisdn = formatDarajaPhone(body.phone);
          const amount = Math.max(1, Math.floor(Number(body.amount) || 0));
          const accountRef = String(body.accountRef ?? "SBC").slice(0, 12);
          const description = String(body.description ?? "Sauti payment").slice(0, 100);

          if (!/^254[17]\d{8}$/.test(msisdn)) {
            return Response.json(
              {
                ok: false,
                error:
                  "Invalid phone format. Use 07XXXXXXXX, 01XXXXXXXX, 2547XXXXXXXX, or 2541XXXXXXXX.",
              },
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

          const adminEnv = getSupabaseAdminEnvStatus();
          const variants = await loadMpesaConfigVariants();
          const candidates = getMpesaConfigCandidateOrder(variants);
          const stkReadyCandidates = candidates.filter(
            (candidate) => candidate.completeness.stkReady,
          );

          if (stkReadyCandidates.length === 0) {
            return Response.json(
              {
                ok: false,
                error: "M-Pesa is not fully configured on the server.",
                hint: adminEnv.ok
                  ? "Set MPESA_ENV, MPESA_SHORTCODE, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, and MPESA_PASSKEY in the secret vault or hosting environment."
                  : `The runtime secret table cannot be read because ${adminEnv.missing.join(", ")} is missing on the server. Add the missing server env and restart/redeploy, or place the MPESA_* values directly in the hosting environment.`,
                details: {
                  resolutionMode: variants.resolutionMode,
                  candidates: candidates.map((candidate) => ({
                    label: candidate.label,
                    env: candidate.normalizedEnv,
                    stkReady: candidate.completeness.stkReady,
                    sources: candidate.sources,
                  })),
                },
              },
              { status: 503 },
            );
          }

          const authAttempts: unknown[] = [];
          const stkAttempts: unknown[] = [];

          for (const config of stkReadyCandidates) {
            const tokenAttempt = await getDarajaAccessTokenForConfig(config);
            authAttempts.push(tokenAttempt);

            if (!tokenAttempt.ok || !tokenAttempt.accessToken) {
              if (tokenAttempt.timeoutMs) {
                console.error("Daraja oauth timed out", tokenAttempt);
                return Response.json(
                  {
                    ok: false,
                    error: "M-Pesa authentication timed out before Daraja responded.",
                    hint: "Safaricom Daraja did not respond quickly enough. Try again shortly; if this repeats, check Daraja status and network reachability from the server.",
                    attempts: authAttempts,
                  },
                  { status: 504 },
                );
              }
              continue;
            }

            let stkResult: Awaited<ReturnType<typeof sendDarajaStkPush>>;
            try {
              stkResult = await sendDarajaStkPush({
                config,
                accessToken: tokenAttempt.accessToken,
                requestUrl: request.url,
                msisdn,
                amount,
                accountRef,
                description,
              });
            } catch (error) {
              if (error instanceof MpesaRequestTimeoutError) {
                return Response.json(
                  {
                    ok: false,
                    error: "M-Pesa STK request timed out before Daraja responded.",
                    hint: "Safaricom Daraja did not respond quickly enough. Try again shortly; if this repeats, check Daraja status and network reachability from the server.",
                    timeoutMs: error.timeoutMs,
                    attempts: stkAttempts,
                  },
                  { status: 504 },
                );
              }
              throw error;
            }

            if (stkResult.ok) {
              try {
                await recordMpesaStkPushRequestEvent({
                  raw: {
                    callback: stkResult.callback,
                    accountRef,
                    amount,
                    phone: msisdn,
                    description,
                    response: stkResult.body,
                    configLabel: config.label,
                    configSources: config.sources,
                  },
                  account: accountRef.toUpperCase(),
                  amount,
                  phone: msisdn,
                  checkoutRequestId:
                    String(stkResult.body.CheckoutRequestID ?? "").trim() || undefined,
                  merchantRequestId:
                    String(stkResult.body.MerchantRequestID ?? "").trim() || undefined,
                });
              } catch (trackingError) {
                console.error("stkpush request tracking error", trackingError);
              }

              return Response.json({
                ok: true,
                ...stkResult.body,
                configLabel: config.label,
              });
            }

            const errorCode = String(stkResult.body.errorCode ?? "");
            const errorMessage = String(stkResult.body.errorMessage ?? "STK push failed");
            const requestId = String(stkResult.body.requestId ?? "");
            const attempt = {
              label: config.label,
              env: config.normalizedEnv,
              status: stkResult.status,
              errorCode,
              errorMessage,
              requestId,
              shortcode: config.shortcode,
              sources: config.sources,
              callback: stkResult.callback,
              timestampZone: stkResult.timestampZone,
              body: stkResult.body,
            };
            stkAttempts.push(attempt);
            console.error("Daraja stkpush failed", attempt);

            if (errorCode === "404.001.03") {
              continue;
            }

            return Response.json(
              { ok: false, error: errorMessage, details: stkResult.body, attempts: stkAttempts },
              { status: 502 },
            );
          }

          const successfulAuth = authAttempts.some((attempt) => asRecord(attempt).ok === true);

          if (!successfulAuth) {
            console.error("Daraja oauth failed for all M-Pesa candidates", authAttempts);
            const lastAttempt = asRecord(authAttempts[authAttempts.length - 1]);
            if (lastAttempt.timeoutMs) {
              return Response.json(
                {
                  ok: false,
                  error: "M-Pesa authentication timed out before Daraja responded.",
                  hint: "Safaricom Daraja did not respond quickly enough. Try again shortly; if this repeats, check Daraja status and network reachability from the server.",
                  attempts: authAttempts,
                },
                { status: 504 },
              );
            }
            return Response.json(
              {
                ok: false,
                error: `M-Pesa authentication failed (${lastAttempt.status ?? "unknown"}).`,
                hint:
                  lastAttempt.status === 400 || lastAttempt.status === 401
                    ? "Check that the consumer key, consumer secret, and MPESA_ENV match the same Daraja environment. If Vercel has the right values but /secret-keys is stale, set SAUTI_MPESA_SECRET_SOURCE=env-first or delete the stale runtime MPESA_* keys."
                    : "Check the configured Daraja credentials and try again.",
                daraja: lastAttempt.body ?? lastAttempt.error,
                attempts: authAttempts,
              },
              { status: 502 },
            );
          }

          return Response.json(
            {
              ok: false,
              error: "Daraja rejected every configured M-Pesa app/token for STK Push.",
              hint: "The server tried each configured M-Pesa source. Put the exact old-site production values in hosting env, set SAUTI_MPESA_SECRET_SOURCE=env-first, redeploy, and remove stale MPESA_* values from /secret-keys.",
              attempts: stkAttempts,
            },
            { status: 502 },
          );
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
