import { createFileRoute } from "@tanstack/react-router";

import {
  applyMpesaPaymentToDatabase,
  findMemberByMembershipInput,
  recordMpesaConfirmationEvent,
} from "@/lib/app-data.functions";
import { sendMpesaReceiptSms } from "@/lib/mpesa.server";
import { getSecret } from "@/lib/runtime-secrets.server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export const Route = createFileRoute("/api/public/mpesa/confirmation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const expected = await getSecret("MPESA_SHORTCODE");
          if (
            expected &&
            body.BusinessShortCode &&
            String(body.BusinessShortCode) !== String(expected)
          ) {
            return Response.json(
              { ResultCode: 1, ResultDesc: "Wrong shortcode" },
              { status: 200, headers: NO_STORE_HEADERS },
            );
          }

          const mpesaRef = String(body.TransID || "").trim() || undefined;
          const account = String(body.BillRefNumber || "")
            .trim()
            .toUpperCase();
          const amount = Number(body.TransAmount) || 0;
          const payerName = [body.FirstName, body.MiddleName, body.LastName]
            .filter(Boolean)
            .join(" ");
          const payerPhone = body.MSISDN ? String(body.MSISDN) : undefined;

          const event = await recordMpesaConfirmationEvent({
            raw: body,
            account,
            amount,
            mpesaRef,
            payerName,
            phone: payerPhone,
          });

          let processedResult: Awaited<ReturnType<typeof applyMpesaPaymentToDatabase>> | undefined;
          if (!event.processed) {
            try {
              processedResult = await applyMpesaPaymentToDatabase({
                eventId: event.id,
                account,
                amount,
                payerName,
                mpesaRef,
              });
            } catch (processingError) {
              console.error("mpesa confirmation processing error", processingError);
            }
          }

          if (processedResult?.matched) {
            try {
              const member = await findMemberByMembershipInput(account);
              await sendMpesaReceiptSms({
                member,
                amount,
                mpesaRef,
                account,
                payerPhone,
              });
            } catch (smsError) {
              console.error("mpesa receipt sms error", smsError);
            }
          }

          return Response.json(
            { ResultCode: 0, ResultDesc: "Success" },
            { headers: NO_STORE_HEADERS },
          );
        } catch (error) {
          console.error("mpesa confirmation parse error", error);
          return Response.json(
            { ResultCode: 0, ResultDesc: "Success" },
            { headers: NO_STORE_HEADERS },
          );
        }
      },
    },
  },
});
