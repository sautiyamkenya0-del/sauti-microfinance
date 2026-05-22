import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaConfirmationRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/public/payments/confirmation")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMpesaConfirmationRequest(request),
      POST: async ({ request }) => handleMpesaConfirmationRequest(request),
    },
  },
});
