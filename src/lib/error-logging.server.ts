import "@tanstack/react-start/server-only";

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

export type ErrorLogEntry = {
  id: string;
  timestamp: string;
  level: "error" | "warning" | "info";
  category: string;
  message: string;
  file?: string;
  line?: number;
  stack?: string;
  context?: Record<string, unknown>;
  user_id?: string;
  created_at: string;
};

/** Log an error to the database */
export async function logErrorToServer(args: {
  level: "error" | "warning" | "info";
  category: string;
  message: string;
  file?: string;
  line?: number;
  stack?: string;
  context?: Record<string, unknown>;
  user_id?: string;
}) {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) return;

  try {
    await supabaseAdmin.from("error_logs").insert({
      level: args.level,
      category: args.category,
      message: args.message,
      file: args.file,
      line: args.line,
      stack: args.stack,
      context: args.context,
      user_id: args.user_id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to log error to database", error);
  }
}

/** Retrieve paginated error logs */
export async function getErrorLogs(args: {
  limit?: number;
  offset?: number;
  level?: "error" | "warning" | "info";
  category?: string;
  days?: number;
} = {}) {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) {
    return {
      items: [],
      total: 0,
      readable: false,
      reason: "Supabase admin client not available",
    };
  }

  try {
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    const daysAgo = args.days ?? 7;

    let query = supabaseAdmin
      .from("error_logs")
      .select("*", { count: "exact" })
      .gte(
        "created_at",
        new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (args.level) {
      query = query.eq("level", args.level);
    }
    if (args.category) {
      query = query.ilike("category", `%${args.category}%`);
    }

    const { data, count, error } = await query;

    if (error) throw error;

    return {
      items: (data ?? []) as ErrorLogEntry[],
      total: count ?? 0,
      readable: true,
      reason: "",
    };
  } catch (error) {
    console.error("Failed to fetch error logs", error);
    return {
      items: [],
      total: 0,
      readable: false,
      reason: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/** Clear old error logs (older than specified days) */
export async function clearOldErrorLogs(daysOld: number = 30) {
  const supabaseAdmin = getSupabaseAdminOrNull();
  if (!supabaseAdmin) return false;

  try {
    const cutoffDate = new Date(
      Date.now() - daysOld * 24 * 60 * 60 * 1000
    ).toISOString();
    const { error } = await supabaseAdmin
      .from("error_logs")
      .delete()
      .lt("created_at", cutoffDate);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Failed to clear old error logs", error);
    return false;
  }
}
