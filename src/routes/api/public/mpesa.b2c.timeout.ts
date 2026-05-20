import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaB2cTimeoutRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/public/mpesa/b2c/timeout")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMpesaB2cTimeoutRequest(request),
    },
  },
});
