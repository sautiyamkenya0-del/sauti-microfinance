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
