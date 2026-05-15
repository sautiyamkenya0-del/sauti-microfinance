import { createFileRoute } from "@tanstack/react-router";
import { getSecret } from "@/lib/runtime-secrets.server";

/** Daraja STK Push trigger.
 *  POST { phone, amount, accountRef, description } → kicks off Lipa Na M-Pesa Online prompt on the user's phone.
 *  Falls back to a simulated CheckoutRequestID when M-Pesa secrets aren't configured (dev mode).
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

          // Normalize to 2547XXXXXXXX
          let msisdn = phoneRaw;
          if (msisdn.startsWith("0")) msisdn = "254" + msisdn.slice(1);
          if (msisdn.startsWith("+")) msisdn = msisdn.slice(1);
          if (!/^254\d{9}$/.test(msisdn)) {
            return Response.json(
              { ok: false, error: "Invalid phone — must be 2547XXXXXXXX." },
              { status: 400 },
            );
          }
          if (amount < 1)
            return Response.json({ ok: false, error: "Amount must be ≥ 1." }, { status: 400 });

          // Director-managed overrides (runtime_secrets table) win over build-time env.
          const consumerKey = await getSecret("MPESA_CONSUMER_KEY");
          const consumerSecret = await getSecret("MPESA_CONSUMER_SECRET");
          const shortcode = await getSecret("MPESA_SHORTCODE");
          const passkey = await getSecret("MPESA_PASSKEY");
          const env = ((await getSecret("MPESA_ENV")) ?? "production").toLowerCase();
          const base =
            env === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";

          // Dev fallback: no creds → simulate
          if (!consumerKey || !consumerSecret || !shortcode || !passkey) {
            return Response.json({
              ok: true,
              simulated: true,
              CheckoutRequestID: `SIM-${Date.now()}`,
              ResponseDescription: "Simulated STK (no M-Pesa creds configured).",
            });
          }

          // 1) OAuth token
          const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
          const tokenRes = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
            headers: { Authorization: `Basic ${auth}` },
          });
          if (!tokenRes.ok) {
            const t = await tokenRes.text();
            console.error("Daraja oauth failed", tokenRes.status, t);
            const hint =
              tokenRes.status === 400
                ? "Likely the consumer key/secret don't match the MPESA_ENV. If these are sandbox keys, set MPESA_ENV=sandbox. Visit /api/public/mpesa/diagnose for details."
                : "Check MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET.";
            return Response.json(
              { ok: false, error: `M-Pesa auth failed (${tokenRes.status}). ${hint}`, daraja: t },
              { status: 502 },
            );
          }
          const tokenJson = (await tokenRes.json()) as { access_token: string };
          const accessToken = tokenJson.access_token;

          // 2) STK push
          const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
          const password = Buffer.from(`${shortcode}${passkey}${ts}`).toString("base64");
          const origin = new URL(request.url).origin;
          const callback = `${origin}/api/public/mpesa/confirmation`;

          const stkRes = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              BusinessShortCode: shortcode,
              Password: password,
              Timestamp: ts,
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
                    "M-Pesa STK is not enabled for these live credentials. OAuth succeeded, but Daraja rejected the STK request for this app.",
                  hint: "Enable Lipa Na M-Pesa Online / STK Push on the same production app in the Daraja portal, or switch back to the app/environment whose credentials were issued for STK.",
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
        } catch (e: any) {
          console.error("stkpush handler error", e);
          return Response.json(
            { ok: false, error: e?.message ?? "Unknown error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
