import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Send } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { plainAiText } from "@/lib/ai-text";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/ai")({
  head: () => ({ meta: [{ title: "SautiAI - Assistant" }] }),
  component: AiPage,
});

type Msg = { role: "user" | "assistant"; content: string };

function AiPage() {
  const store = useStore();
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Hello, I'm SautiAI. Ask me about members, investors, suppliers, loans, dockets, payments, or anything that looks unusual and I'll keep it short and useful.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [
      ...msgs,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMsgs(next);
    setInput("");
    setBusy(true);

    const snapshot = {
      currentUserRole: store.currentUser.role,
      counts: {
        members: store.members.length,
        loans: store.loans.length,
        tx: store.transactions.length,
        staff: store.staff.length,
      },
      members: store.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone })).slice(0, 60),
      loans: store.loans
        .map((l) => ({
          id: l.id,
          memberId: l.memberId,
          principal: l.principal,
          status: l.status,
        }))
        .slice(0, 60),
      penalties: (store.penalties ?? []).slice(0, 30),
      recentTx: store.transactions.slice(-30),
    };

    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...msgs, { role: "user", content: text }],
          snapshot,
          role: store.currentUser.role,
          mode: "staff",
        }),
      });
      if (!r.ok || !r.body) {
        const err = await r.json().catch(() => ({ error: "Failed" }));
        setMsgs((p) =>
          p.map((m, i) => (i === p.length - 1 ? { ...m, content: `Notice: ${err.error}` } : m)),
        );
        setBusy(false);
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const j = line.slice(6).trim();
          if (j === "[DONE]") {
            done = true;
            break;
          }
          try {
            const p = JSON.parse(j);
            const c = p.choices?.[0]?.delta?.content;
            if (c) {
              acc += c;
              const cleaned = plainAiText(acc);
              setMsgs((p2) =>
                p2.map((m, i) => (i === p2.length - 1 ? { ...m, content: cleaned } : m)),
              );
            }
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
    } catch (e: unknown) {
      setMsgs((p) =>
        p.map((m, i) =>
          i === p.length - 1
            ? { ...m, content: `Notice: ${e instanceof Error ? e.message : "Error"}` }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="SautiAI"
        subtitle="Director-grade read assistant across members, loans, M-Pesa, suppliers, dockets, payroll, approvals, support, and audit logs. Nothing posts until a human confirms."
      />
      <main className="flex-1 p-6 lg:p-8 flex flex-col gap-4 max-w-4xl w-full mx-auto">
        <div className="flex-1 bg-card border border-border rounded-xl p-4 overflow-y-auto space-y-4 min-h-[55vh]">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && (
                <div className="h-8 w-8 rounded-full bg-primary/15 grid place-items-center text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              >
                {m.content || <span className="opacity-50">...</span>}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Try: summarize SBC003, check overdue loans, or draft a safe next step for L0008"
            className="flex-1 bg-card border border-border rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            disabled={busy}
            className="px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            {busy ? "..." : "Send"}
          </button>
        </form>
      </main>
    </>
  );
}
