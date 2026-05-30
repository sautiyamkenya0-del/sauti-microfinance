import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Section, Badge } from "@/components/ui-bits";
import { useStore } from "@/lib/store";
import { useEffect, useState } from "react";
import { CommsTabs } from "./staff";
import { useSupportInboxActions } from "@/lib/support-inbox";
import { Inbox, Send, CheckCircle2, Copy, Pencil, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useReadIds } from "@/lib/read-state";
import { formatKenyaDateTime, formatKenyaTime } from "@/lib/time";
import { useServerFn } from "@tanstack/react-start";
import { polishSupportReplyRecord } from "@/lib/app-data.functions";

export const Route = createFileRoute("/support-inbox")({
  head: () => ({ meta: [{ title: "Member Support — Sauti Microfinance" }] }),
  component: SupportInboxPage,
});

function SupportInboxPage() {
  const { currentUser, staff } = useStore();
  const polishSupportReply = useServerFn(polishSupportReplyRecord);
  const {
    rows: threads,
    appendMessage,
    setThreadStatus,
    updateMessage,
    deleteMessage,
  } = useSupportInboxActions();
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
  const [polishing, setPolishing] = useState(false);
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

  async function polishReply() {
    const draft = reply.trim();
    if (!draft || !active) {
      toast.error("Write a draft reply first.");
      return;
    }
    setPolishing(true);
    try {
      const result = await polishSupportReply({ data: { threadId: active.id, draft } });
      const body = String(result.body ?? "").trim();
      if (!body) throw new Error("SautiAI did not return a polished reply.");
      setReply(body);
      toast.success("Reply polished");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not polish the reply.");
    } finally {
      setPolishing(false);
    }
  }

  async function copyMessage(text: string) {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  }

  async function copyThread() {
    if (!active) return;
    const body = active.messages
      .map((message) => `[${formatKenyaTime(message.at)}] ${message.fromName}: ${message.text}`)
      .join("\n");
    await navigator.clipboard.writeText(body);
    toast.success("Conversation copied");
  }

  function canManageMessage(message: NonNullable<typeof active>["messages"][number]) {
    return (
      message.from === "staff" &&
      (message.fromId === currentUser.id ||
        currentUser.role === "director" ||
        currentUser.role === "manager")
    );
  }

  async function editMessage(messageId: string, text: string) {
    const next = window.prompt("Edit message", text);
    if (next == null || next.trim() === text.trim()) return;
    await updateMessage(messageId, next);
    toast.success("Message updated");
  }

  async function removeMessage(messageId: string) {
    if (!window.confirm("Delete this message?")) return;
    await deleteMessage(messageId);
    toast.success("Message deleted");
  }

  async function deleteThreadMessages() {
    if (!active) return;
    const deletable = active.messages.filter(canManageMessage);
    if (deletable.length === 0) {
      toast.error("No staff replies you can delete in this conversation.");
      return;
    }
    if (!window.confirm(`Delete ${deletable.length} staff reply/replies?`)) return;
    for (const message of deletable) {
      await deleteMessage(message.id);
    }
    toast.success("Conversation messages deleted");
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
                    {formatKenyaDateTime(t.updatedAt)} · {assigned?.name ?? "unassigned"}
                  </div>
                </button>
              );
            })}
          </aside>

          <Section
            action={
              active ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyThread()}
                    disabled={active.messages.length === 0}
                    className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40"
                    title="Copy conversation"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteThreadMessages()}
                    disabled={!active.messages.some(canManageMessage)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    title="Delete staff replies"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null
            }
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
                        <div className="mb-1 flex justify-end gap-1 opacity-70">
                          <button
                            type="button"
                            onClick={() => void copyMessage(m.text)}
                            className="grid h-5 w-5 place-items-center rounded hover:bg-background/20"
                            title="Copy"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          {canManageMessage(m) ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void editMessage(m.id, m.text)}
                                className="grid h-5 w-5 place-items-center rounded hover:bg-background/20"
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeMessage(m.id)}
                                className="grid h-5 w-5 place-items-center rounded hover:bg-background/20"
                                title="Delete"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          ) : null}
                        </div>
                        <div className="text-[10px] opacity-70 mb-0.5">
                          {m.fromName} · {formatKenyaTime(m.at)}
                        </div>
                        <div className="whitespace-pre-wrap">{m.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <form
                  className="border-t border-border p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <div className="flex gap-2">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Reply to member…"
                      rows={3}
                      className="min-h-[76px] flex-1 resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm"
                    />
                    <div className="flex w-36 flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => void polishReply()}
                        disabled={polishing || !reply.trim()}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {polishing ? "Polishing" : "Polish"}
                      </button>
                      <button className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                        <Send className="h-3.5 w-3.5" />
                        Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => void close()}
                        className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Close
                      </button>
                    </div>
                  </div>
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
