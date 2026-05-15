import { createFileRoute } from "@tanstack/react-router";
import { getSecret } from "@/lib/runtime-secrets.server";

/** GET /api/public/mpesa/diagnose
 *  Returns whether each MPESA_* secret is set + tries an OAuth token call.
 *  Helps troubleshoot "M-Pesa auth failed" without sending an STK prompt.
 */
export const Route = createFileRoute("/api/public/mpesa/diagnose")({
  server: {
    handlers: {
      GET: async () => {
        const ck = (await getSecret("MPESA_CONSUMER_KEY")) ?? "";
        const cs = (await getSecret("MPESA_CONSUMER_SECRET")) ?? "";
        const sc = (await getSecret("MPESA_SHORTCODE")) ?? "";
        const pk = (await getSecret("MPESA_PASSKEY")) ?? "";
        const env = ((await getSecret("MPESA_ENV")) ?? "production").toLowerCase();
        const base =
          env === "sandbox" ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";

        const presence = {
          MPESA_ENV: env,
          MPESA_CONSUMER_KEY: ck ? `set (len ${ck.length}, prefix ${ck.slice(0, 4)})` : "MISSING",
          MPESA_CONSUMER_SECRET: cs ? `set (len ${cs.length})` : "MISSING",
          MPESA_SHORTCODE: sc || "MISSING",
          MPESA_PASSKEY: pk ? `set (len ${pk.length})` : "MISSING",
          base,
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
          const res = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
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
                  ? "Likely cause: keys are for the WRONG environment. If these are sandbox keys, set MPESA_ENV=sandbox; if production, ensure they are activated."
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
