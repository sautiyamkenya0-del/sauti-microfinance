import { createFileRoute } from "@tanstack/react-router";
import { requireDirectorActor } from "@/lib/auth.server";
import { fetchMpesaDaraja } from "@/lib/mpesa-config.server";
import { readServerEnv } from "@/lib/server-env";
import { logErrorToServer } from "@/lib/error-logging.server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function c2bCallbackBaseUrl(request: Request) {
  const explicitBase = String(readServerEnv("MPESA_PUBLIC_BASE_URL") ?? "").trim();
  if (explicitBase) return explicitBase.replace(/\/+$/, "");

  const publicBase = String(readServerEnv("PUBLIC_BASE_URL") ?? "").trim();
  if (publicBase) return publicBase.replace(/\/+$/, "");

  const domain = String(readServerEnv("MPESA_DOMAIN") ?? "").trim();
  if (domain) {
    if (/^https?:\/\//i.test(domain)) return domain.replace(/\/+$/, "");
    return `https://${domain.replace(/\/+$/, "")}`;
  }

  return new URL(request.url).origin.replace(/\/+$/, "");
}

/**
 * Admin-only endpoint to register/update Safaricom C2B callback URLs.
 * This tells Safaricom where to send unprompted PayBill transactions (manual payments).
 *
 * Call this once after deploying a new site to update Safaricom's routing.
 */
export const Route = createFileRoute("/api/admin/mpesa/register-c2b-urls")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Live payment routing is director-only.
        await requireDirectorActor();

        try {
          const consumerKey = readServerEnv("MPESA_CONSUMER_KEY");
          const consumerSecret = readServerEnv("MPESA_CONSUMER_SECRET");
          const shortcode = readServerEnv("MPESA_SHORTCODE");
          const env = readServerEnv("MPESA_ENV") || "production";

          if (!consumerKey || !consumerSecret || !shortcode) {
            return Response.json(
              {
                ok: false,
                error: "Missing required MPESA configuration (consumer key, secret, or shortcode)",
              },
              { status: 400, headers: NO_STORE_HEADERS },
            );
          }

          // Get access token from Daraja OAuth
          const tokenUrl =
            env.toLowerCase() === "sandbox"
              ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
              : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

          const tokenRes = await fetchMpesaDaraja(tokenUrl, {
            method: "GET",
            headers: {
              Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
            },
          });

          if (!tokenRes.ok) {
            const errorBody = await tokenRes.text();
            const msg = `Failed to obtain access token from Daraja: ${tokenRes.status} ${errorBody}`;
            console.error(msg);
            await logErrorToServer({
              level: "error",
              category: "mpesa.c2b_registration.auth",
              message: msg,
              context: { statusCode: tokenRes.status, errorBody },
            });
            return Response.json(
              { ok: false, error: msg },
              { status: 502, headers: NO_STORE_HEADERS },
            );
          }

          const tokenData = (await tokenRes.json()) as { access_token?: string };
          const accessToken = tokenData.access_token;
          if (!accessToken) {
            const msg = "No access token in response from Daraja";
            console.error(msg);
            await logErrorToServer({
              level: "error",
              category: "mpesa.c2b_registration.auth",
              message: msg,
              context: { tokenData },
            });
            return Response.json(
              { ok: false, error: msg },
              { status: 502, headers: NO_STORE_HEADERS },
            );
          }

          const baseUrl = c2bCallbackBaseUrl(request);
          const confirmationUrl =
            String(readServerEnv("MPESA_C2B_CONFIRMATION_URL") ?? "").trim() ||
            `${baseUrl}/api/public/payments/confirmation`;
          const validationUrl =
            String(readServerEnv("MPESA_C2B_VALIDATION_URL") ?? "").trim() ||
            `${baseUrl}/api/public/payments/validation`;

          // Register URLs with Safaricom
          const registerUrl =
            env.toLowerCase() === "sandbox"
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

          const registerData = (await registerRes.json()) as Record<string, unknown>;

          if (!registerRes.ok) {
            const msg = `Safaricom registration failed: ${registerRes.status}`;
            console.error(msg, registerData);
            await logErrorToServer({
              level: "error",
              category: "mpesa.c2b_registration.response",
              message: msg,
              context: { statusCode: registerRes.status, response: registerData },
            });
            return Response.json(
              { ok: false, error: msg, response: registerData },
              { status: 502, headers: NO_STORE_HEADERS },
            );
          }

          // Log successful registration
          console.info("mpesa c2b urls registered successfully", {
            shortcode,
            confirmationUrl,
            validationUrl,
            response: registerData,
          });

          await logErrorToServer({
            level: "info",
            category: "mpesa.c2b_registration",
            message: "Successfully registered C2B URLs with Safaricom",
            context: {
              shortcode,
              confirmationUrl,
              validationUrl,
              response: registerData,
            },
          });

          return Response.json(
            {
              ok: true,
              shortcode,
              confirmationUrl,
              validationUrl,
              response: registerData,
            },
            { headers: NO_STORE_HEADERS },
          );
        } catch (error) {
          console.error("mpesa c2b registration error", error);
          await logErrorToServer({
            level: "error",
            category: "mpesa.c2b_registration.exception",
            message: "Unexpected error during C2B URL registration",
            context: { error: String(error ?? "") },
          });
          return Response.json(
            {
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }
      },
    },
  },
});
