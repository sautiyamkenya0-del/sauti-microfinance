import { createFileRoute } from "@tanstack/react-router";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { requireStaffActor } from "@/lib/auth.server";
import {
  applyMpesaPaymentToDatabase,
  cleanupDuplicateTransactionRefs,
} from "@/lib/app-data.functions";

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
      POST: async () => {
        await requireStaffActor();
        const supabaseAdmin = getSupabaseAdminOrNull();
        if (!supabaseAdmin) {
          return Response.json({ processed: 0, items: [] }, { headers: NO_STORE_HEADERS });
        }

        const { data, error } = await supabaseAdmin
          .from("mpesa_events")
          .select("id, mpesa_ref, amount, account, payer_name, created_at")
          .eq("kind", "confirmation")
          .eq("processed", false)
          .order("created_at", { ascending: true })
          .limit(250);
        if (error) {
          return Response.json(
            { processed: 0, items: [], error: error.message },
            { headers: NO_STORE_HEADERS },
          );
        }

        const items = [];
        for (const row of data ?? []) {
          try {
            const result = await applyMpesaPaymentToDatabase({
              eventId: row.id,
              account: String(row.account ?? ""),
              amount: Number(row.amount ?? 0),
              payerName: String(row.payer_name ?? "") || undefined,
              mpesaRef: String(row.mpesa_ref ?? "") || undefined,
            });
            items.push({ id: row.id, ok: true, result });
          } catch (error) {
            items.push({
              id: row.id,
              ok: false,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        const duplicatesRemoved = await cleanupDuplicateTransactionRefs();
        return Response.json(
          { processed: items.length, items, duplicatesRemoved },
          { headers: NO_STORE_HEADERS },
        );
      },
    },
  },
});
