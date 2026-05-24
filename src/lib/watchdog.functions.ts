import { createServerFn } from "@tanstack/react-start";

import { requireDirectorActor } from "@/lib/auth.server";
import { runWatchdogAnalysis } from "@/lib/watchdog.server";

export const askWatchdog = createServerFn({ method: "POST" })
  .inputValidator((d: { question: string }) => {
    const q = String(d?.question ?? "").trim();
    if (!q || q.length > 2000) throw new Error("Question required (2000 characters or fewer).");
    return { question: q };
  })
  .handler(async ({ data }) => {
    await requireDirectorActor();
    return runWatchdogAnalysis(data.question);
  });
