import { createFileRoute } from "@tanstack/react-router";

import { findMemberByMembershipInput, recordMpesaValidationEvent } from "@/lib/app-data.functions";
import { isMembershipAccountReference } from "@/lib/membership";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export const Route = createFileRoute("/api/public/mpesa/validation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const account = String(body.BillRefNumber || "")
            .trim()
            .toUpperCase();
          const amount = Number(body.TransAmount) || 0;
          const payerName = [body.FirstName, body.MiddleName, body.LastName]
            .filter(Boolean)
            .join(" ");

          try {
            await recordMpesaValidationEvent({
              raw: body,
              account,
              amount,
              payerName,
              phone: body.MSISDN ? String(body.MSISDN) : undefined,
            });
          } catch (error) {
            console.error("mpesa validation audit error", error);
          }

          if (!isMembershipAccountReference(account)) {
            return Response.json(
              { ResultCode: 1, ResultDesc: "Rejected: invalid account number" },
              { headers: NO_STORE_HEADERS },
            );
          }

          const member = await findMemberByMembershipInput(account);
          if (!member) {
            return Response.json(
              { ResultCode: 1, ResultDesc: "Rejected: membership number not found" },
              { headers: NO_STORE_HEADERS },
            );
          }

          return Response.json(
            { ResultCode: 0, ResultDesc: "Accepted" },
            { headers: NO_STORE_HEADERS },
          );
        } catch (error) {
          console.error("mpesa validation parse error", error);
          return Response.json(
            { ResultCode: 1, ResultDesc: "Rejected: validation error" },
            { headers: NO_STORE_HEADERS },
          );
        }
      },
    },
  },
});
