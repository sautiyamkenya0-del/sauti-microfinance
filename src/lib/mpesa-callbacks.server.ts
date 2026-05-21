import "@tanstack/react-start/server-only";

import {
  applyMpesaPaymentToDatabase,
  applyMpesaWithdrawalResultToDatabase,
  findMemberByMembershipInput,
  findMpesaStkPushRequestContext,
  markMpesaWithdrawalTimeout,
  recordMpesaConfirmationEvent,
  recordMpesaValidationEvent,
} from "@/lib/app-data.functions";
import { logErrorToServer } from "@/lib/error-logging.server";
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

function mpesaTimestampValue(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^\d{14}$/.test(raw)) return undefined;
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  const hour = raw.slice(8, 10);
  const minute = raw.slice(10, 12);
  const second = raw.slice(12, 14);
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+03:00`;
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

function readB2cResultParameter(result: Record<string, unknown>, name: string) {
  const resultParameters = asRecord(result.ResultParameters);
  const items = Array.isArray(resultParameters.ResultParameter)
    ? (resultParameters.ResultParameter as unknown[])
    : [];
  const match = items.find(
    (item) =>
      isRecord(item) &&
      String(item.Key ?? "")
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
    }).catch(async (error) => {
      console.error("mpesa stk request lookup error", error);
      try {
        await logErrorToServer({
          level: "warning",
          category: "mpesa.stk_lookup",
          message: "Failed to lookup STK request context",
          context: { error: String(error ?? "") },
        });
      } catch (_) {
        /* ignore logging failure */
      }
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
    const transactionDate =
      mpesaTimestampValue(readStkMetadataValue(metadataItems, "TransactionDate")) ?? undefined;
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
      createdAt: transactionDate,
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
    createdAt: mpesaTimestampValue(root.TransTime) ?? undefined,
    success: true,
    resultCode: 0,
    resultDesc: "Accepted",
  };
}

function normalizeB2cResultBody(body: Record<string, unknown>) {
  const result = asRecord(body.Result);
  return {
    raw: body,
    resultCode: numberValue(result.ResultCode),
    resultDesc: textValue(result.ResultDesc),
    conversationId: textValue(result.ConversationID),
    originatorConversationId: textValue(result.OriginatorConversationID),
    payoutRef:
      textValue(readB2cResultParameter(result, "TransactionReceipt")) ??
      textValue(readB2cResultParameter(result, "TransactionID")),
  };
}

function normalizeB2cTimeoutBody(body: Record<string, unknown>) {
  const result = asRecord(body.Result);
  return {
    raw: body,
    conversationId: textValue(result.ConversationID ?? body.ConversationID),
    originatorConversationId: textValue(
      result.OriginatorConversationID ?? body.OriginatorConversationID,
    ),
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
    const phone = textValue(body.MSISDN ?? body.PhoneNumber);

    console.warn("mpesa validation callback received", {
      account,
      amount,
      payerName,
      phone,
    });
    console.info("mpesa validation request body", body);
    // Also emit an error-level log so platforms that filter info logs still show the payload
    console.error("mpesa validation payload (for visibility)", { account, amount, payerName, phone });
    await logErrorToServer({
      level: "info",
      category: "mpesa.validation.payload",
      message: "M-Pesa validation callback received",
      context: {
        account,
        amount,
        payerName,
        phone,
        body,
      },
    });

    try {
      await recordMpesaValidationEvent({
        raw: body,
        account,
        amount,
        payerName,
        phone,
      });
    } catch (error) {
      console.error("mpesa validation audit error", error);
      try {
        await logErrorToServer({
          level: "warning",
          category: "mpesa.validation",
          message: "Failed to record validation event",
          context: { error: String(error ?? ""), body },
        });
      } catch (_) {
        /* ignore logging failure */
      }
    }

    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("mpesa validation parse error", error);
    try {
      await logErrorToServer({
        level: "error",
        category: "mpesa.validation.parse",
        message: "Failed to parse validation callback body",
        context: { error: String(error ?? "") },
      });
    } catch (_) {
      /* ignore logging failure */
    }
    return Response.json({ ResultCode: 0, ResultDesc: "Accepted" }, { headers: NO_STORE_HEADERS });
  }
}

export async function handleMpesaConfirmationRequest(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readBodyObject(request);
  } catch (error) {
    console.error("mpesa confirmation parse error", error);
    try {
      await logErrorToServer({
        level: "error",
        category: "mpesa.confirmation.parse",
        message: "Failed to parse confirmation callback body",
        context: { error: String(error ?? "") },
      });
    } catch (_) {
      /* ignore logging failure */
    }
    return successAck("Accepted");
  }

  try {
    console.info("mpesa confirmation request body", body);
    // Emit an error-level log to ensure Vercel/hosted logs capture confirmation payloads
    console.error("mpesa confirmation payload (for visibility)", {
      bodySummary: {
        account: String(body?.Body?.stkCallback?.AccountReference ?? body?.AccountReference ?? ""),
      },
    });
    await logErrorToServer({
      level: "info",
      category: "mpesa.confirmation.payload",
      message: "M-Pesa confirmation callback received",
      context: {
        body,
      },
    });

    const normalized = await normalizeConfirmationBody(body);
    const expectedShortcodes = await listConfiguredMpesaShortcodes();
    // Put normalized summary at error level to make it visible in filtered logs
    console.error("mpesa confirmation normalized (for visibility)", {
      account: normalized.account,
      amount: normalized.amount,
      mpesaRef: normalized.eventRef,
      success: normalized.success,
      businessShortCode: normalized.businessShortCode,
      payerPhone: normalized.payerPhone,
    });
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
      createdAt: normalized.createdAt,
    });

    let processedResult: Awaited<ReturnType<typeof applyMpesaPaymentToDatabase>> | undefined;
    if (
      normalized.success &&
      normalized.amount > 0 &&
      normalized.account &&
      (!event.processed || !event.transaction_id)
    ) {
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
    try {
      await logErrorToServer({
        level: "error",
        category: "mpesa.confirmation",
        message: "Error handling mpesa confirmation",
        context: { error: String(error ?? "") },
      });
    } catch (_) {
      /* ignore logging failure */
    }
    return retryAck();
  }
}

export async function handleMpesaB2cResultRequest(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readBodyObject(request);
  } catch (error) {
    console.error("mpesa b2c result parse error", error);
    return successAck("Accepted");
  }

  try {
    const normalized = normalizeB2cResultBody(body);
    // Ensure B2C result payloads appear in host logs
    console.error("mpesa b2c result normalized (for visibility)", {
      conversationId: normalized.conversationId,
      originatorConversationId: normalized.originatorConversationId,
      payoutRef: normalized.payoutRef,
      resultCode: normalized.resultCode,
    });
    await applyMpesaWithdrawalResultToDatabase({
      raw: normalized.raw,
      conversationId: normalized.conversationId,
      originatorConversationId: normalized.originatorConversationId,
      payoutRef: normalized.payoutRef,
      resultCode: normalized.resultCode,
      resultDesc: normalized.resultDesc,
    });
    return successAck();
  } catch (error) {
    console.error("mpesa b2c result handling error", error);
    try {
      await logErrorToServer({
        level: "error",
        category: "mpesa.b2c_result",
        message: "Error handling B2C payout result",
        context: { error: String(error ?? "") },
      });
    } catch (_) {
      /* ignore logging failure */
    }
    return retryAck();
  }
}

export async function handleMpesaB2cTimeoutRequest(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readBodyObject(request);
  } catch (error) {
    console.error("mpesa b2c timeout parse error", error);
    return successAck("Accepted");
  }

  try {
    const normalized = normalizeB2cTimeoutBody(body);
    // Log timeouts at error level for visibility
    console.error("mpesa b2c timeout normalized (for visibility)", {
      conversationId: normalized.conversationId,
      originatorConversationId: normalized.originatorConversationId,
    });
    await markMpesaWithdrawalTimeout({
      raw: normalized.raw,
      conversationId: normalized.conversationId,
      originatorConversationId: normalized.originatorConversationId,
    });
    return successAck();
  } catch (error) {
    console.error("mpesa b2c timeout handling error", error);
    try {
      await logErrorToServer({
        level: "error",
        category: "mpesa.b2c_timeout",
        message: "Error handling B2C payout timeout",
        context: { error: String(error ?? "") },
      });
    } catch (_) {
      /* ignore logging failure */
    }
    return retryAck();
  }
}
