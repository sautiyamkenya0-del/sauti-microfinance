import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { completeGroqChat } from "@/lib/groq.server";

export const askWatchdog = createServerFn({ method: "POST" })
  .inputValidator((d: { question: string }) => {
    const q = String(d?.question ?? "").trim();
    if (!q || q.length > 2000) throw new Error("Question required (≤2000 chars)");
    return { question: q };
  })
  .handler(async ({ data }) => {
    const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 14).toISOString();
    const [
      { data: audit },
      { data: txns },
      { data: loans },
      { data: members },
      { data: staff },
      { data: penalties },
    ] = await Promise.all([
      supabaseAdmin
        .from("audit_log")
        .select("*")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin.from("loans").select("*").order("updated_at", { ascending: false }).limit(200),
      supabaseAdmin
        .from("members")
        .select("id,name,phone,status,savings_balance,fee_membership,created_at,updated_at")
        .limit(200),
      supabaseAdmin.from("staff").select("id,name,role,created_at,updated_at").limit(50),
      supabaseAdmin
        .from("penalties")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const snapshot = { audit, txns, loans, members, staff, penalties };
    const system = `You are the Sauti Microfinance Watchdog AI. You have READ-ONLY access to a 14-day slice of audit_log plus current loans/transactions/members/staff/penalties.
Your job: detect anything fishy and answer the director's question.
Look for: rank/role elevation attempts, deleted or modified transactions, repeated failed logins, unusual money outflows, members with negative or wildly inconsistent balances, loans whose paid > principal, staff editing their own records, secrets being added/removed at odd hours, duplicated audit entries (potential replay), and patterns that don't match normal SACCO operations.
Respond in markdown with sections: ⚠️ Issues detected, 🔎 Notable activity, ✅ Looks fine. Be specific — quote actor names, ids, amounts (KSh), and timestamps. If nothing's off, say so. Never claim you took an action — you can't.`;

    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: `${data.question}\n\nSNAPSHOT (truncated):\n${JSON.stringify(snapshot).slice(0, 16000)}`,
      },
    ];
    return { answer: await completeGroqChat(messages), source: "groq" as const };
  });
