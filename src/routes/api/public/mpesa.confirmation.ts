import { createFileRoute } from "@tanstack/react-router";
import { getSecret } from "@/lib/runtime-secrets.server";

// In-memory FIFO buffer of incoming Daraja C2B confirmations.
// The frontend polls /api/mpesa/queue, drains, and runs applyMpesaPayment().
// (Worker memory only — fine for single-instance preview; move to Cloud when scaling.)
declare global {
  // eslint-disable-next-line no-var
  var __MPESA_QUEUE__: any[] | undefined;
}
function queue() {
  return (globalThis.__MPESA_QUEUE__ ??= []);
}

export const Route = createFileRoute("/api/public/mpesa/confirmation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          // Daraja C2B confirmation shape:
          // { TransactionType, TransID, TransTime, TransAmount, BusinessShortCode, BillRefNumber, MSISDN, FirstName, MiddleName, LastName }
          const expected = await getSecret("MPESA_SHORTCODE");
          if (
            expected &&
            body.BusinessShortCode &&
            String(body.BusinessShortCode) !== String(expected)
          ) {
            return Response.json({ ResultCode: 1, ResultDesc: "Wrong shortcode" }, { status: 200 });
          }
          queue().push({
            txId: body.TransID,
            amount: Number(body.TransAmount) || 0,
            account: String(body.BillRefNumber || "").toUpperCase(),
            phone: body.MSISDN,
            name: [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(" "),
            at: new Date().toISOString(),
          });
          // Always 0/Success — Daraja retries otherwise.
          return Response.json({ ResultCode: 0, ResultDesc: "Success" });
        } catch (e) {
          console.error("mpesa confirmation parse error", e);
          return Response.json({ ResultCode: 0, ResultDesc: "Success" });
        }
      },
    },
  },
});
