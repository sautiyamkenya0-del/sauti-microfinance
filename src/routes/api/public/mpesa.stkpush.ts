import { createFileRoute } from "@tanstack/react-router";

import { getSecret } from "@/lib/runtime-secrets.server";

/** Daraja STK Push trigger.
 * POST { phone, amount, accountRef, description } -> sends a real Lipa Na M-Pesa Online prompt.
 */
export const Route = createFileRoute("/api/public/mpesa/stkpush")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
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

          const consumerKey = await getSecret("MPESA_CONSUMER_KEY");
          const consumerSecret = await getSecret("MPESA_CONSUMER_SECRET");
          const shortcode = await getSecret("MPESA_SHORTCODE");
          const passkey = await getSecret("MPESA_PASSKEY");
          const env = ((await getSecret("MPESA_ENV")) ?? "production").toLowerCase();
          const base =
            env === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";

          if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
            return Response.json(
              {
                ok: false,
                error: "M-Pesa is not fully configured on the server.",
                hint:
                  "Set MPESA_ENV, MPESA_SHORTCODE, MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, and MPESA_PASSKEY in the secret vault or hosting environment.",
              },
              { status: 503 },
            );
          }

          const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
          const tokenRes = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { Authorization: `Basic ${auth}` },
          });

          if (!tokenRes.ok) {
            const details = await tokenRes.text();
            console.error("Daraja oauth failed", tokenRes.status, details);
            return Response.json(
              {
                ok: false,
                error: `M-Pesa authentication failed (${tokenRes.status}).`,
                hint:
                  tokenRes.status === 400
                    ? "Check that the consumer key, consumer secret, and MPESA_ENV match the correct Daraja environment."
                    : "Check the configured Daraja credentials and try again.",
                daraja: details,
              },
              { status: 502 },
            );
          }

          const tokenJson = (await tokenRes.json()) as { access_token: string };
          const accessToken = tokenJson.access_token;

          const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
          const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
          const origin = new URL(request.url).origin;
          const callback = `${origin}/api/public/mpesa/confirmation`;

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
                  error:
                    "M-Pesa STK is not enabled for the configured Daraja application.",
                  hint:
                    "Enable Lipa Na M-Pesa Online / STK Push for the same production app in the Daraja portal, or switch back to credentials that already have STK enabled.",
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
