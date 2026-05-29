import { useEffect, useRef, useState } from "react";
import { Plus, Sparkles, Send, UserCog } from "lucide-react";
import { toast } from "sonner";

import { plainAiText } from "@/lib/ai-text";
import { useStore } from "@/lib/store";
import type { Member } from "@/lib/store";
import { useSupportInboxActions } from "@/lib/support-inbox";

type Msg = { role: "user" | "assistant"; content: string };
type MemberChatSession = { id: string; title: string; updatedAt: string; messages: Msg[] };

/**
 * Member-facing AI customer care assistant. Lives in the Member Portal.
 * - Streams answers from /api/ai/chat with a customer-care system prompt.
 * - "Talk to a real person" forwards the conversation to the member's field
 *   officer (or any manager if none set) via the in-house support inbox.
 */
export function MemberAIChat({ member }: { member: Member }) {
  const { staff } = useStore();
  const { rows: threads, createThread, appendMessage } = useSupportInboxActions();
  const myThread = threads.find((t) => t.memberId === member.id && t.status !== "closed");

  const initialMessage = memberInitialMessage(member);
  const [sessions, setSessions] = useState<MemberChatSession[]>(() =>
    loadMemberAiSessions(member.id),
  );
  const [sessionId, setSessionId] = useState(() => sessions[0]?.id ?? newMemberChatId());
  const [msgs, setMsgs] = useState<Msg[]>(() => sessions[0]?.messages ?? [initialMessage]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    const nextSessions = loadMemberAiSessions(member.id);
    setSessions(nextSessions);
    setSessionId(nextSessions[0]?.id ?? newMemberChatId());
    setMsgs(nextSessions[0]?.messages ?? [memberInitialMessage(member)]);
  }, [member.id]);

  useEffect(() => {
    if (myThread && myThread.status !== "ai") return;
    const title =
      msgs.find((message) => message.role === "user")?.content.slice(0, 48) ||
      "New SautiAI chat";
    const nextSession = {
      id: sessionId,
      title,
      updatedAt: new Date().toISOString(),
      messages: msgs,
    };
    setSessions((current) =>
      saveMemberAiSessions(member.id, [
        nextSession,
        ...current.filter((session) => session.id !== sessionId),
      ]),
    );
  }, [member.id, msgs, myThread, sessionId]);

  const staffReplies = myThread?.messages.filter((m) => m.from === "staff").length ?? 0;

  function pickAssignedStaff(): string | undefined {
    if (member.fieldOfficerId) {
      const fo = staff.find((s) => s.id === member.fieldOfficerId);
      if (fo) return fo.id;
    }
    const mgr = staff.find((s) => s.role === "manager") ?? staff.find((s) => s.role === "director");
    return mgr?.id;
  }

  async function handover() {
    if (forwarding) return;
    setForwarding(true);
    try {
      const assigned = pickAssignedStaff();
      const initial = msgs.map((m) => ({
        id: `M-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        from: m.role === "user" ? ("member" as const) : ("ai" as const),
        fromName: m.role === "user" ? member.name : "SautiAI",
        fromId: m.role === "user" ? member.id : undefined,
        text: plainAiText(m.content),
        at: new Date().toISOString(),
      }));
      const threadId = await createThread({
        memberId: member.id,
        memberName: member.name,
        subject:
          msgs.find((m) => m.role === "user")?.content.slice(0, 80) ?? "Member support request",
        initialMessages: initial,
        assignedStaffId: assigned,
      });
      const assignedName = staff.find((s) => s.id === assigned)?.name ?? "the support team";
      setMsgs((p) => [
        ...p,
        {
          role: "assistant",
          content: `Done. I've forwarded our chat to ${assignedName}. They'll reply shortly. You can keep this page open and message again here anytime.`,
        },
      ]);
      toast.success(`Forwarded to ${assignedName}`);
      return threadId;
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to forward the conversation.");
      return undefined;
    } finally {
      setForwarding(false);
    }
  }

  function startNewChat() {
    const id = newMemberChatId();
    setSessionId(id);
    setMsgs([memberInitialMessage(member)]);
    setInput("");
  }

  function openChat(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    setSessionId(session.id);
    setMsgs(session.messages.length ? session.messages : [memberInitialMessage(member)]);
    setInput("");
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    if (myThread && myThread.status !== "ai") {
      await appendMessage(myThread.id, {
        from: "member",
        fromName: member.name,
        fromId: member.id,
        text,
      });
      setMsgs((p) => [...p, { role: "user", content: text }]);
      setInput("");
      return;
    }

    const next: Msg[] = [
      ...msgs,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ];
    setMsgs(next);
    setInput("");
    setBusy(true);

    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...msgs, { role: "user", content: text }],
          snapshot: {
            audience: "member",
            member: {
              id: member.id,
              name: member.name,
              phone: member.phone,
              savingsBalance: member.savingsBalance,
              shares: member.shares,
              status: member.status,
              fees: member.fees,
              businessPermanence: member.businessPermanence,
            },
          },
          role: "member",
          mode: "customer",
        }),
      });
      if (!r.ok || !r.body) {
        const txt = await r.text().catch(() => "");
        let errMsg = txt;
        try {
          errMsg = JSON.parse(txt).error ?? txt;
        } catch {
          /* keep raw response text */
        }
        console.error("MemberAIChat /api/ai/chat failed", r.status, txt);
        setMsgs((p) =>
          p.map((m, i) =>
            i === p.length - 1
              ? {
                  ...m,
                  content: `AI is unavailable right now (${r.status}). ${errMsg || "Please try again or tap Talk to a real person."}`,
                }
              : m,
          ),
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
            ? {
                ...m,
                content: `Something went wrong: ${e instanceof Error ? e.message : "Error"}`,
              }
            : m,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const visibleMsgs: Msg[] = myThread
    ? myThread.messages.map((m) => ({
        role: m.from === "member" ? "user" : "assistant",
        content: m.from === "staff" ? `${m.fromName} (staff): ${m.text}` : plainAiText(m.text),
      }))
    : msgs;

  return (
    <div className="bg-card border border-border rounded-xl flex flex-col h-[480px]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-primary/15 grid place-items-center text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="text-sm font-semibold">SautiAI Customer Care</div>
            <div className="text-[10px] text-muted-foreground">
              {myThread && myThread.status !== "ai"
                ? `Connected with ${staff.find((s) => s.id === myThread.assignedStaffId)?.name ?? "staff"}${staffReplies ? ` - ${staffReplies} reply${staffReplies > 1 ? "ies" : ""}` : ""}`
                : "Instant answers, any hour"}
            </div>
          </div>
        </div>
        {!myThread && (
          <button
            onClick={() => void handover()}
            disabled={forwarding}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50"
          >
            <UserCog className="h-3.5 w-3.5" /> Talk to a real person
          </button>
        )}
      </div>

      {!myThread || myThread.status === "ai" ? (
        <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
          <select
            value={sessionId}
            onChange={(event) => openChat(event.target.value)}
            className="max-w-[220px] rounded-md border border-border bg-muted px-2 py-1.5 text-xs"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title} - {new Date(session.updatedAt).toLocaleDateString()}
              </option>
            ))}
            {!sessions.some((session) => session.id === sessionId) ? (
              <option value={sessionId}>New SautiAI chat</option>
            ) : null}
          </select>
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {visibleMsgs.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
            >
              {m.content || <span className="opacity-50">...</span>}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="p-2 border-t border-border flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            myThread && myThread.status !== "ai" ? "Reply to staff..." : "Ask SautiAI anything..."
          }
          className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          disabled={busy}
          className="px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 inline-flex items-center gap-1.5"
        >
          <Send className="h-3.5 w-3.5" />
          Send
        </button>
      </form>
    </div>
  );
}

function memberInitialMessage(member: Member): Msg {
  return {
    role: "assistant",
    content: `Hi ${member.firstName ?? member.name.split(" ")[0]}! I'm SautiAI. Ask me about your daily compliance contribution, loans, M-Pesa Paybill, fees, or anything about Sauti Microfinance. If you want a real person, tap Talk to a real person any time.`,
  };
}

function newMemberChatId() {
  return `member-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function memberAiStorageKey(memberId: string) {
  return `sauti-member-ai:sessions:${memberId}`;
}

function loadMemberAiSessions(memberId: string): MemberChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(memberAiStorageKey(memberId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function saveMemberAiSessions(memberId: string, sessions: MemberChatSession[]) {
  const next = sessions.slice(0, 30);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(memberAiStorageKey(memberId), JSON.stringify(next));
  }
  return next;
}
