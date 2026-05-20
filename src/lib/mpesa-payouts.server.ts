import "@tanstack/react-start/server-only";

import { fetchMpesaDaraja, getDarajaAccessToken } from "@/lib/mpesa-config.server";
import { getSecret } from "@/lib/runtime-secrets.server";
import { readServerEnv } from "@/lib/server-env";
import { toComparableKenyanPhone } from "@/lib/utils";

function mpesaBaseUrl(env?: string) {
  return String(env ?? "")
    .trim()
    .toLowerCase() === "sandbox"
    ? "https://sandbox.safaricom.co.ke"
    : "https://api.safaricom.co.ke";
}

function normalizePayoutPhone(value?: string | null) {
  const normalized = toComparableKenyanPhone(String(value ?? ""));
  return /^254(1|7)\d{8}$/.test(normalized) ? normalized : undefined;
}

function callbackUrlForPath(secretValue: string | undefined, path: string) {
  const explicit = String(secretValue ?? "").trim();
  if (explicit) return explicit;
  const publicBaseUrl = String(readServerEnv("PUBLIC_BASE_URL") ?? "").trim();
  if (!publicBaseUrl) return undefined;
  return `${publicBaseUrl.replace(/\/+$/, "")}${path}`;
}

async function readRequiredSecret(key: string, label: string) {
  const value = String((await getSecret(key)) ?? "").trim();
  if (!value) throw new Error(`${label} is not configured.`);
  return value;
}

export async function requestMpesaWithdrawalPayout(args: {
  amount: number;
  phone: string;
  accountReference: string;
  memberName?: string;
  remarks?: string;
}) {
  const normalizedPhone = normalizePayoutPhone(args.phone);
  if (!normalizedPhone) {
    throw new Error("The selected member does not have a valid M-Pesa phone number.");
  }

  const tokenResult = await getDarajaAccessToken();
  if (!tokenResult.ok || !tokenResult.accessToken) {
    throw new Error(tokenResult.error ?? "M-Pesa authentication failed.");
  }

  const shortcode = String(tokenResult.config.shortcode ?? "").trim();
  if (!shortcode) {
    throw new Error("MPESA_SHORTCODE is not configured.");
  }

  const initiatorName = await readRequiredSecret("MPESA_INITIATOR_NAME", "MPESA_INITIATOR_NAME");
  const securityCredential = await readRequiredSecret(
    "MPESA_SECURITY_CREDENTIAL",
    "MPESA_SECURITY_CREDENTIAL",
  );
  const resultUrl = callbackUrlForPath(
    await getSecret("MPESA_B2C_RESULT_URL"),
    "/api/public/mpesa/b2c/result",
  );
  const timeoutUrl = callbackUrlForPath(
    await getSecret("MPESA_B2C_TIMEOUT_URL"),
    "/api/public/mpesa/b2c/timeout",
  );

  if (!resultUrl || !timeoutUrl) {
    throw new Error(
      "Configure PUBLIC_BASE_URL or set MPESA_B2C_RESULT_URL and MPESA_B2C_TIMEOUT_URL before sending withdrawals.",
    );
  }

  const requestBody = {
    InitiatorName: initiatorName,
    SecurityCredential: securityCredential,
    CommandID: "BusinessPayment",
    Amount: Math.round(Number(args.amount ?? 0)),
    PartyA: shortcode,
    PartyB: normalizedPhone,
    Remarks:
      String(args.remarks ?? "").trim() ||
      `Savings withdrawal for ${args.memberName ?? args.accountReference}`,
    QueueTimeOutURL: timeoutUrl,
    ResultURL: resultUrl,
    Occasion: args.accountReference,
  };

  const response = await fetchMpesaDaraja(
    `${mpesaBaseUrl(tokenResult.config.normalizedEnv)}/mpesa/b2c/v3/paymentrequest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenResult.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );

  const responseText = await response.text().catch(() => "");
  let responseBody: unknown = responseText;
  try {
    responseBody = JSON.parse(responseText);
  } catch {
    responseBody = responseText;
  }

  if (!response.ok) {
    const detail =
      typeof responseBody === "string"
        ? responseBody
        : String(
            (responseBody as { errorMessage?: unknown; ResponseDescription?: unknown })
              ?.errorMessage ??
              (responseBody as { ResponseDescription?: unknown })?.ResponseDescription ??
              "",
          ).trim();
    throw new Error(
      `M-Pesa payout request failed (${response.status}). ${detail || "No response body."}`,
    );
  }

  const body = (typeof responseBody === "object" && responseBody ? responseBody : {}) as Record<
    string,
    unknown
  >;
  const responseCode = String(body.ResponseCode ?? "").trim();
  if (responseCode && responseCode !== "0") {
    throw new Error(String(body.ResponseDescription ?? "M-Pesa rejected the payout request."));
  }

  return {
    requestBody,
    responseBody: body,
    conversationId: String(body.ConversationID ?? "").trim() || undefined,
    originatorConversationId: String(body.OriginatorConversationID ?? "").trim() || undefined,
  };
}
