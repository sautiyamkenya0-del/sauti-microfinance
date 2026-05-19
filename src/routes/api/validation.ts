import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaValidationRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/validation")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMpesaValidationRequest(request),
    },
  },
});
