import "@tanstack/react-start/server-only";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

export type AuditEntry = {
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  summary: string;
  details?: unknown;
  ip?: string | null;
  user_agent?: string | null;
};

/** Server-only: append one row to audit_log. Never throws (audit must not break flows). */
export async function recordAudit(e: AuditEntry): Promise<void> {
  try {
    const supabaseAdmin = getSupabaseAdminOrNull();
    if (!supabaseAdmin) return;

    await supabaseAdmin.from("audit_log").insert({
      actor_id: e.actor_id ?? null,
      actor_name: e.actor_name ?? null,
      actor_role: e.actor_role ?? null,
      action: e.action,
      target_type: e.target_type ?? null,
      target_id: e.target_id ?? null,
      summary: e.summary,
      details: (e.details ?? null) as never,
      ip: e.ip ?? null,
      user_agent: e.user_agent ?? null,
    });
  } catch (err) {
    console.warn("[audit] failed to record", err);
  }
}

export async function listAuditEntries(args: {
  actorId?: string;
  action?: string;
  targetType?: string;
  q?: string;
  limit?: number;
}) {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) return [];

  let query = supabaseAdmin
    .from("audit_log")
    .select("*")
    .order("ts", { ascending: false })
    .limit(Math.min(args.limit ?? 500, 2000));
  if (args.actorId) query = query.eq("actor_id", args.actorId);
  if (args.action) query = query.ilike("action", `%${args.action}%`);
  if (args.targetType) query = query.eq("target_type", args.targetType);
  if (args.q) query = query.ilike("summary", `%${args.q}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listAuditActorsFromServer() {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from("audit_log")
    .select("actor_id, actor_name, actor_role")
    .not("actor_id", "is", null)
    .limit(2000);
  if (error) throw new Error(error.message);

  const seen = new Map<string, { id: string; name: string; role: string }>();
  for (const row of data ?? []) {
    const id = row.actor_id ?? "";
    if (id && !seen.has(id)) {
      seen.set(id, {
        id,
        name: row.actor_name ?? id,
        role: row.actor_role ?? "",
      });
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
