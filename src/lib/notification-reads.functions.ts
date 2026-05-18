import { createServerFn } from "@tanstack/react-start";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { requireStaffActor } from "@/lib/auth.server";

function requireSupabaseAdmin() {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    throw new Error(
      "Database sync is unavailable until the server has SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY configured.",
    );
  }
  return supabaseAdmin as any;
}

export const listNotificationReads = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await requireStaffActor();
  const runtimeDb = requireSupabaseAdmin();
  const { data, error } = await runtimeDb
    .from("staff_notification_reads")
    .select("notice_id")
    .eq("staff_id", actor.id);

  if (error) throw new Error(error.message);

  return {
    ids: (data ?? [])
      .map((row: Record<string, unknown>) => String(row.notice_id ?? "").trim())
      .filter(Boolean),
  };
});

export const markNotificationReads = createServerFn({ method: "POST" })
  .inputValidator((data: { ids?: string[] }) => ({
    ids: Array.isArray(data?.ids)
      ? [...new Set(data.ids.map((id) => String(id ?? "").trim()).filter(Boolean))]
      : [],
  }))
  .handler(async ({ data }) => {
    const actor = await requireStaffActor();
    if (!data.ids.length) return { ok: true };

    const runtimeDb = requireSupabaseAdmin();
    const rows = data.ids.map((noticeId) => ({
      staff_id: actor.id,
      notice_id: noticeId,
    }));
    const { error } = await runtimeDb
      .from("staff_notification_reads")
      .upsert(rows, { onConflict: "staff_id,notice_id", ignoreDuplicates: true });

    if (error) throw new Error(error.message);
    return { ok: true };
  });
