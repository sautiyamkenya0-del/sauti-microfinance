import { createServerFn } from "@tanstack/react-start";

import { requireDirectorActor, requireSignedInSession } from "@/lib/auth.server";
import { clearOldErrorLogs, getErrorLogs, logErrorToServer } from "@/lib/error-logging.server";

export const listErrorLogs = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      limit?: number;
      offset?: number;
      level?: "error" | "warning" | "info";
      category?: string;
      days?: number;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireDirectorActor();
    return getErrorLogs({
      limit: data.limit ?? 50,
      offset: data.offset ?? 0,
      level: data.level,
      category: data.category,
      days: data.days ?? 7,
    });
  });

export const recordErrorLog = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      level: "error" | "warning" | "info";
      category: string;
      message: string;
      file?: string;
      line?: number;
      stack?: string;
      context?: Record<string, unknown>;
    }) => data,
  )
  .handler(async ({ data }) => {
    await requireSignedInSession();
    await logErrorToServer({
      level: data.level,
      category: data.category,
      message: data.message,
      file: data.file,
      line: data.line,
      stack: data.stack,
      context: data.context,
    });
    return { ok: true };
  });

export const deleteOldErrorLogs = createServerFn({ method: "POST" })
  .inputValidator((data: { daysOld?: number }) => data)
  .handler(async ({ data }) => {
    await requireDirectorActor();
    const success = await clearOldErrorLogs(data.daysOld ?? 30);
    return { ok: success };
  });
