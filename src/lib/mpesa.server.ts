import "@tanstack/react-start/server-only";

import { formatMembershipNumber } from "@/lib/membership";
import { getSecret } from "@/lib/runtime-secrets.server";
import { toComparableKenyanPhone } from "@/lib/utils";

function smsDestination(value?: string | null) {
  const normalized = toComparableKenyanPhone(String(value ?? ""));
  return /^254(1|7)\d{8}$/.test(normalized) ? normalized : undefined;
}

function formatKes(amount: number) {
  return new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export async function sendMpesaReceiptSms(args: {
  member?: { id: string; phone?: string | null; name?: string | null } | null;
  amount: number;
  mpesaRef?: string;
  account: string;
  payerPhone?: string;
}) {
  const url = await getSecret("MPESA_SMS_URL");
  const username = await getSecret("MPESA_SMS_USERNAME");
  const password = await getSecret("MPESA_SMS_PASSWORD");
  const source = (await getSecret("MPESA_SMS_SOURCE")) ?? "Sauti";
  const fallbackPhone = await getSecret("MPESA_SMS_FALLBACK_PHONE");

  if (!url || !username || !password) {
    return { attempted: false, reason: "SMS provider is not configured." as const };
  }

  const destination =
    smsDestination(args.member?.phone) ??
    smsDestination(args.payerPhone) ??
    smsDestination(fallbackPhone);
  if (!destination) {
    return { attempted: false, reason: "No valid SMS destination was available." as const };
  }

  const accountLabel = args.member?.id
    ? formatMembershipNumber(args.member.id)
    : formatMembershipNumber(args.account);
  const message =
    `Sauti Business Community: Thank you for the contribution of KES ${formatKes(args.amount)}.` +
    ` Ref: ${args.mpesaRef ?? "-"}. Account: ${accountLabel}.`;

  const smsUrl = new URL(url);
  smsUrl.searchParams.set("username", username);
  smsUrl.searchParams.set("password", password);
  smsUrl.searchParams.set("message", message);
  smsUrl.searchParams.set("destination", destination);
  smsUrl.searchParams.set("source", source);

  const response = await fetch(smsUrl, {
    method: "GET",
    headers: {
      Accept: "text/plain, application/json;q=0.9, */*;q=0.8",
    },
    cache: "no-store",
  });

  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`SMS gateway failed (${response.status}): ${body || "empty response"}`);
  }

  return {
    attempted: true,
    destination,
    body,
  };
}
