import "@tanstack/react-start/server-only";

import {
  applyMpesaPaymentToDatabase,
  findMemberByMembershipInput,
  findMpesaStkPushRequestContext,
  recordMpesaConfirmationEvent,
  recordMpesaValidationEvent,
} from "@/lib/app-data.functions";
import { listConfiguredMpesaShortcodes } from "@/lib/mpesa-config.server";
import { sendMpesaReceiptSms } from "@/lib/mpesa.server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

function successAck(resultDesc: string = "Success") {
  return Response.json({ ResultCode: 0, ResultDesc: resultDesc }, { headers: NO_STORE_HEADERS });
}

function retryAck(resultDesc: string = "Temporarily unavailable. Please retry.") {
  return Response.json({ ResultCode: 1, ResultDesc: resultDesc }, { headers: NO_STORE_HEADERS });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function textValue(value: unknown) {
  const next = String(value ?? "").trim();
  return next || undefined;
}

function numberValue(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

async function readBodyObject(request: Request) {
  const rawText = await request.text();
  if (!rawText.trim()) return {};

  try {
    const parsed = JSON.parse(rawText);
    return isRecord(parsed) ? parsed : {};
  } catch {
    const params = new URLSearchParams(rawText);
    if (!Array.from(params.keys()).length) {
      throw new Error("Callback body is not valid JSON.");
    }
    return Object.fromEntries(params.entries());
  }
}

function buildC2bPayerName(body: Record<string, unknown>) {
  const combined = [body.FirstName, body.MiddleName, body.LastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return combined || textValue(body.CustomerName);
}

function readStkMetadataValue(items: unknown[], name: string) {
  const match = items.find(
    (item) =>
      isRecord(item) &&
      String(item.Name ?? "")
        .trim()
        .toLowerCase() === name.toLowerCase(),
  );
  return isRecord(match) ? match.Value : undefined;
}

async function normalizeConfirmationBody(body: Record<string, unknown>) {
  const root = asRecord(body);
  const stkCallback = asRecord(asRecord(root.Body).stkCallback);

  if (Object.keys(stkCallback).length > 0) {
    const metadataItems = Array.isArray(asRecord(stkCallback.CallbackMetadata).Item)
      ? (asRecord(stkCallback.CallbackMetadata).Item as unknown[])
      : [];
    const checkoutRequestId = textValue(stkCallback.CheckoutRequestID);
    const merchantRequestId = textValue(stkCallback.MerchantRequestID);
    const resultCode = numberValue(stkCallback.ResultCode);
    const resultDesc = textValue(stkCallback.ResultDesc);
    const requestContext = await findMpesaStkPushRequestContext({
      checkoutRequestId,
      merchantRequestId,
      phone: textValue(readStkMetadataValue(metadataItems, "PhoneNumber")),
      amount: numberValue(readStkMetadataValue(metadataItems, "Amount")),
    }).catch((error) => {
      console.error("mpesa stk request lookup error", error);
      return null;
    });

    const account = textValue(
      root.AccountReference ?? stkCallback.AccountReference ?? requestContext?.account,
    )?.toUpperCase();
    const amount =
      numberValue(readStkMetadataValue(metadataItems, "Amount")) ||
      numberValue(requestContext?.amount);
    const payerPhone =
      textValue(readStkMetadataValue(metadataItems, "PhoneNumber")) ??
      textValue(requestContext?.phone);
    const mpesaReceipt = textValue(readStkMetadataValue(metadataItems, "MpesaReceiptNumber"));
    const trackingRef = mpesaReceipt ?? checkoutRequestId ?? merchantRequestId;

    return {
      channel: "stk" as const,
      raw: body,
      account: account ?? "",
      amount,
      payerName: undefined,
      payerPhone,
      businessShortCode: textValue(root.BusinessShortCode),
      paymentRef: mpesaReceipt,
      eventRef: trackingRef,
      success: resultCode === 0,
      resultCode,
      resultDesc,
    };
  }

  return {
    channel: "c2b" as const,
    raw: body,
    account: String(root.BillRefNumber ?? root.AccountReference ?? "")
      .trim()
      .toUpperCase(),
    amount: numberValue(root.TransAmount ?? root.Amount),
    payerName: buildC2bPayerName(root),
    payerPhone: textValue(root.MSISDN ?? root.PhoneNumber),
    businessShortCode: textValue(root.BusinessShortCode ?? root.ShortCode),
    paymentRef: textValue(root.TransID ?? root.MpesaReceiptNumber),
    eventRef: textValue(root.TransID ?? root.MpesaReceiptNumber),
    success: true,
    resultCode: 0,
    resultDesc: "Accepted",
  };
}

export async function handleMpesaValidationRequest(request: Request) {
  try {
    const body = await readBodyObject(request);
    const account = String(body.BillRefNumber ?? body.AccountReference ?? "")
      .trim()
      .toUpperCase();
    const amount = numberValue(body.TransAmount ?? body.Amount);
    const payerName = buildC2bPayerName(body);

    try {
      await recordMpesaValidationEvent({
        raw: body,
        account,
        amount,
        payerName,
        phone: textValue(body.MSISDN ?? body.PhoneNumber),
      });
    } catch (error) {
      console.error("mpesa validation audit error", error);
    }

    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("mpesa validation parse error", error);
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" }, { headers: NO_STORE_HEADERS });
  }
}

export async function handleMpesaConfirmationRequest(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readBodyObject(request);
  } catch (error) {
    console.error("mpesa confirmation parse error", error);
    return successAck("Accepted");
  }

  try {
    const normalized = await normalizeConfirmationBody(body);
    const expectedShortcodes = await listConfiguredMpesaShortcodes();
    if (
      expectedShortcodes.length > 0 &&
      normalized.businessShortCode &&
      !expectedShortcodes.includes(String(normalized.businessShortCode).trim())
    ) {
      return Response.json(
        { ResultCode: 1, ResultDesc: "Wrong shortcode" },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    const event = await recordMpesaConfirmationEvent({
      raw: normalized.raw,
      account: normalized.account,
      amount: normalized.amount,
      mpesaRef: normalized.eventRef,
      payerName: normalized.payerName,
      phone: normalized.payerPhone,
      processed: !normalized.success,
    });

    let processedResult: Awaited<ReturnType<typeof applyMpesaPaymentToDatabase>> | undefined;
    if (normalized.success && !event.processed && normalized.amount > 0 && normalized.account) {
      processedResult = await applyMpesaPaymentToDatabase({
        eventId: event.id,
        account: normalized.account,
        amount: normalized.amount,
        payerName: normalized.payerName,
        mpesaRef: normalized.paymentRef ?? normalized.eventRef,
      });
    }

    if (processedResult?.matched) {
      try {
        const member = await findMemberByMembershipInput(normalized.account);
        await sendMpesaReceiptSms({
          member,
          amount: normalized.amount,
          mpesaRef: normalized.paymentRef ?? normalized.eventRef,
          account: normalized.account,
          payerPhone: normalized.payerPhone,
        });
      } catch (smsError) {
        console.error("mpesa receipt sms error", smsError);
      }
    }

    return successAck();
  } catch (error) {
    console.error("mpesa confirmation handling error", error);
    return retryAck();
  }
}
