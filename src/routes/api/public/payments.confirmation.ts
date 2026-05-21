import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaConfirmationRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/public/payments/confirmation")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMpesaConfirmationRequest(request),
    },
  },
});
