import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/lib/audit.server";

/** Public wrapper: log an action from the client. */
export const logAudit = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      actor_id?: string;
      actor_name?: string;
      actor_role?: string;
      action: string;
      target_type?: string;
      target_id?: string;
      summary: string;
      details?: unknown;
    }) => {
      if (!d?.action || !d?.summary) throw new Error("action + summary required");
      return d;
    },
  )
  .handler(async ({ data }) => {
    await recordAudit(data);
    return { ok: true };
  });

/** List audit rows with optional filters. */
export const listAudit = createServerFn({ method: "POST" })
  .inputValidator(
    (
      d: {
        actorId?: string;
        action?: string;
        targetType?: string;
        q?: string;
        limit?: number;
      } = {},
    ) => d,
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("audit_log")
      .select("*")
      .order("ts", { ascending: false })
      .limit(Math.min(data.limit ?? 500, 2000));
    if (data.actorId) q = q.eq("actor_id", data.actorId);
    if (data.action) q = q.ilike("action", `%${data.action}%`);
    if (data.targetType) q = q.eq("target_type", data.targetType);
    if (data.q) q = q.ilike("summary", `%${data.q}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Distinct actors for the filter dropdown. */
export const listAuditActors = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("audit_log")
    .select("actor_id, actor_name, actor_role")
    .not("actor_id", "is", null)
    .limit(2000);
  if (error) throw new Error(error.message);
  const seen = new Map<string, { id: string; name: string; role: string }>();
  for (const r of data ?? []) {
    const id = r.actor_id ?? "";
    if (id && !seen.has(id))
      seen.set(id, { id, name: r.actor_name ?? id, role: r.actor_role ?? "" });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
});
