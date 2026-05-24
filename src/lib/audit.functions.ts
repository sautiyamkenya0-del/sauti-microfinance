import { createServerFn } from "@tanstack/react-start";

import { listAuditActorsFromServer, listAuditEntries, recordAudit } from "@/lib/audit.server";
import { requireDirectorActor, requireSignedInSession } from "@/lib/auth.server";

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
    await requireSignedInSession();
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
    await requireDirectorActor();
    return listAuditEntries(data);
  });

/** Distinct actors for the filter dropdown. */
export const listAuditActors = createServerFn({ method: "GET" }).handler(async () => {
  await requireDirectorActor();
  return listAuditActorsFromServer();
});
