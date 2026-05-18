import { createFileRoute } from "@tanstack/react-router";
import { isMembershipAccountReference } from "@/lib/membership";

export const Route = createFileRoute("/api/public/mpesa/validation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const acc = String(body.BillRefNumber || "").toUpperCase();
          // Accept current SBC codes and legacy member references during the transition.
          if (!isMembershipAccountReference(acc)) {
            return Response.json({ ResultCode: "C2B00012", ResultDesc: "Invalid Account Number" });
          }
          return Response.json({ ResultCode: "0", ResultDesc: "Accepted" });
        } catch {
          return Response.json({ ResultCode: "0", ResultDesc: "Accepted" });
        }
      },
    },
  },
});
