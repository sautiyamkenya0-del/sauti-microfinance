import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { requireManagerOrDirectorActor } from "@/lib/auth.server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export const Route = createFileRoute("/api/mpesa/queue")({
  server: {
    handlers: {
      GET: async () => {
        await requireManagerOrDirectorActor();
        const supabaseAdmin = getSupabaseAdminOrNull();
        if (!supabaseAdmin) {
          return Response.json({ items: [] }, { headers: NO_STORE_HEADERS });
        }

        const { data, error } = await supabaseAdmin
          .from("mpesa_events")
          .select("id, mpesa_ref, amount, account, payer_name, created_at")
          .eq("kind", "confirmation")
          .eq("processed", false)
          .order("created_at", { ascending: true })
          .limit(50);
        if (error) {
          return Response.json({ items: [], error: error.message }, { headers: NO_STORE_HEADERS });
        }

        const items = (data ?? []).map((row) => ({
          id: row.id,
          txId: row.mpesa_ref ?? row.id,
          amount: Number(row.amount ?? 0),
          account: String(row.account ?? ""),
          name: String(row.payer_name ?? ""),
          at: row.created_at,
        }));
        return Response.json({ items }, { headers: NO_STORE_HEADERS });
      },
    },
  },
});
