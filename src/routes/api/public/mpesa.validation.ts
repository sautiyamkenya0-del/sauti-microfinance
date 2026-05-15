import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/mpesa/validation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const acc = String(body.BillRefNumber || "").toUpperCase();
          // Accept anything that looks like an SBC member code.
          if (!/^SBC\d{3,}$/.test(acc)) {
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
