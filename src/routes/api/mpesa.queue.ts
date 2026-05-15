import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/mpesa/queue")({
  server: {
    handlers: {
      GET: async () => {
        const q: any[] = (globalThis as any).__MPESA_QUEUE__ ?? [];
        const drained = q.splice(0, q.length);
        return Response.json({ items: drained });
      },
    },
  },
});
