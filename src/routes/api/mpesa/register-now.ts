import { createFileRoute } from "@tanstack/react-router";
import { readServerEnv } from "@/lib/server-env";
import { fetchMpesaDaraja } from "@/lib/mpesa-config.server";
import { logErrorToServer } from "@/lib/error-logging.server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export const Route = createFileRoute("/api/mpesa/register-now")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const consumerKey = readServerEnv("MPESA_CONSUMER_KEY");
          const consumerSecret = readServerEnv("MPESA_CONSUMER_SECRET");
          const shortcode = readServerEnv("MPESA_SHORTCODE");
          const env = (readServerEnv("MPESA_ENV") || "production").toLowerCase();
          const domain = readServerEnv("MPESA_DOMAIN") || "sbm.sautiyamkenya.co.ke";

          if (!consumerKey || !consumerSecret || !shortcode) {
            return Response.json(
              { ok: false, error: "Missing MPESA env vars (MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE)" },
              { status: 400, headers: NO_STORE_HEADERS },
            );
          }

          const tokenUrl =
            env === "sandbox"
              ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
              : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

          const tokenRes = await fetchMpesaDaraja(tokenUrl, {
            method: "GET",
            headers: {
              Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
            },
          });

          if (!tokenRes.ok) {
            const body = await tokenRes.text();
            const msg = `Failed to obtain access token from Daraja: ${tokenRes.status}`;
            console.error(msg, body);
            await logErrorToServer({
              level: "error",
              category: "mpesa.register_now.auth",
              message: msg,
              context: { status: tokenRes.status, body },
            });
            return Response.json({ ok: false, error: msg, body }, { status: 502, headers: NO_STORE_HEADERS });
          }

          const tokenData = (await tokenRes.json()) as { access_token?: string };
          const accessToken = tokenData.access_token;
          if (!accessToken) {
            const msg = "No access token returned from Daraja";
            console.error(msg, tokenData);
            await logErrorToServer({
              level: "error",
              category: "mpesa.register_now.auth",
              message: msg,
              context: { tokenData },
            });
            return Response.json({ ok: false, error: msg, tokenData }, { status: 502, headers: NO_STORE_HEADERS });
          }

          // Use URLs that do not contain the word "mpesa" (Safaricom rejects URLs containing that word)
          const confirmationUrl = `https://${domain}/api/public/payments/confirmation`;
          const validationUrl = `https://${domain}/api/public/payments/validation`;

          const registerUrl =
            env === "sandbox"
              ? "https://sandbox.safaricom.co.ke/mpesa/c2b/v2/registerurl"
              : "https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl";

          const registerRes = await fetchMpesaDaraja(registerUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ShortCode: String(shortcode),
              ResponseType: "Completed",
              ConfirmationURL: confirmationUrl,
              ValidationURL: validationUrl,
            }),
          });

          const registerData = await registerRes.json();

          if (!registerRes.ok) {
            const msg = `Safaricom registration failed: ${registerRes.status}`;
            console.error(msg, registerData);
            await logErrorToServer({
              level: "error",
              category: "mpesa.register_now.response",
              message: msg,
              context: { status: registerRes.status, response: registerData },
            });
            return Response.json({ ok: false, error: msg, response: registerData }, { status: 502, headers: NO_STORE_HEADERS });
          }

          await logErrorToServer({
            level: "info",
            category: "mpesa.register_now",
            message: "Safaricom C2B URLs registered",
            context: { shortcode, confirmationUrl, validationUrl, response: registerData },
          });

          return Response.json({ ok: true, response: registerData }, { headers: NO_STORE_HEADERS });
        } catch (error) {
          console.error("mpesa register-now error", error);
          try {
            await logErrorToServer({
              level: "error",
              category: "mpesa.register_now.exception",
              message: "Unexpected error during register-now",
              context: { error: String(error ?? "") },
            });
          } catch (_) {
            /* ignore logging failure */
          }
          return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: NO_STORE_HEADERS });
        }
      },
    },
  },
});
