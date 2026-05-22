import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaValidationRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/public/mpesa/validation")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMpesaValidationRequest(request),
      POST: async ({ request }) => handleMpesaValidationRequest(request),
    },
  },
});
