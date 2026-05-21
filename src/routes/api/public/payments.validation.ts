import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaValidationRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/public/payments/validation")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMpesaValidationRequest(request),
    },
  },
});
