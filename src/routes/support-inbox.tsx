import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Section, Badge } from "@/components/ui-bits";
import { useStore } from "@/lib/store";
import { useEffect, useState } from "react";
import { CommsTabs } from "./staff";
import { useSupportInboxActions } from "@/lib/support-inbox";
import { Inbox, Send, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useReadIds } from "@/lib/read-state";

export const Route = createFileRoute("/support-inbox")({
  head: () => ({ meta: [{ title: "Member Support — Sauti Microfinance" }] }),
  component: SupportInboxPage,
});

function SupportInboxPage() {
  const { currentUser, staff } = useStore();
  const { rows: threads, appendMessage, setThreadStatus } = useSupportInboxActions();
  const { markRead } = useReadIds();
  // Inbox: threads assigned to me + unassigned + my role-relevant
  const visible = threads.filter(
    (t) =>
      t.status !== "closed" &&
      (!t.assignedStaffId ||
        t.assignedStaffId === currentUser.id ||
        currentUser.role === "director" ||
        currentUser.role === "manager"),
  );
  const [activeId, setActiveId] = useState<string>(visible[0]?.id ?? "");
  const [reply, setReply] = useState("");
  const active = threads.find((t) => t.id === activeId);

  useEffect(() => {
    if (activeId && visible.some((thread) => thread.id === activeId)) return;
    setActiveId(visible[0]?.id ?? "");
  }, [activeId, visible]);

  useEffect(() => {
    const latest = active?.messages[active.messages.length - 1];
    if (!latest) return;
    if (latest.from === "staff" && latest.fromId === currentUser.id) return;
    markRead(`support-${active.id}-${latest.id}`);
  }, [active, currentUser.id, markRead]);

  async function send() {
    const t = reply.trim();
    if (!t || !active) return;
    await appendMessage(active.id, {
      from: "staff",
      fromName: currentUser.name,
      fromId: currentUser.id,
      text: t,
    });
    if (active.status === "open" || active.status === "ai") {
      await setThreadStatus(active.id, "claimed", currentUser.id);
    }
    setReply("");
  }

  async function close() {
    if (!active) return;
    await setThreadStatus(active.id, "closed");
    toast.success("Conversation closed");
  }

  return (
    <>
      <AppHeader
        title="Member Support Inbox"
        subtitle="Conversations forwarded from SautiAI by members who want to talk to a real person."
      />
      <main className="flex-1 p-6 lg:p-8">
        <CommsTabs />
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-[calc(100vh-12rem)]">
          <aside className="bg-card border border-border rounded-xl overflow-y-auto">
            {visible.length === 0 && (
              <div className="p-6 text-sm text-muted-foreground flex flex-col items-center gap-2">
                <Inbox className="h-8 w-8" />
                No open requests.
              </div>
            )}
            {visible.map((t) => {
              const assigned = staff.find((s) => s.id === t.assignedStaffId);
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 ${activeId === t.id ? "bg-muted" : ""}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="font-medium text-sm truncate">{t.memberName}</div>
                    <Badge
                      tone={
                        t.status === "open"
                          ? "warning"
                          : t.status === "claimed"
                            ? "success"
                            : "default"
                      }
                    >
                      {t.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{t.subject}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(t.updatedAt).toLocaleString()} · {assigned?.name ?? "unassigned"}
                  </div>
                </button>
              );
            })}
          </aside>

          <Section
            title={active ? `${active.memberName} · ${active.subject}` : "Select a conversation"}
          >
            {active ? (
              <div className="flex flex-col h-[calc(100vh-16rem)]">
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {active.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.from === "staff" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${m.from === "staff" ? "bg-primary text-primary-foreground" : m.from === "ai" ? "bg-accent/20" : "bg-muted"}`}
                      >
                        <div className="text-[10px] opacity-70 mb-0.5">
                          {m.fromName} · {new Date(m.at).toLocaleTimeString()}
                        </div>
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  className="p-3 border-t border-border flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Reply to member…"
                    className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                  <button className="px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1">
                    <Send className="h-3.5 w-3.5" />
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => void close()}
                    className="px-3 rounded-md border border-border text-sm inline-flex items-center gap-1 hover:bg-muted"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Close
                  </button>
                </form>
              </div>
            ) : (
              <div className="p-8 text-sm text-muted-foreground">
                Pick a thread on the left to read & reply.
              </div>
            )}
          </Section>
        </div>
      </main>
    </>
  );
}
