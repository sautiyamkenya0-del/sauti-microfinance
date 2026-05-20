import { createFileRoute } from "@tanstack/react-router";

import { handleMpesaB2cResultRequest } from "@/lib/mpesa-callbacks.server";

export const Route = createFileRoute("/api/public/mpesa/b2c/result")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMpesaB2cResultRequest(request),
    },
  },
});
