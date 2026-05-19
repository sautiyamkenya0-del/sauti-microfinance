import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { useStore, roleLabel } from "@/lib/store";
import { useEffect, useRef, useState } from "react";
import {
  Send,
  Paperclip,
  Mic,
  Square,
  Download,
  Image as ImgIcon,
  MessageSquare,
  StickyNote,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { useReadIds } from "@/lib/read-state";

export const Route = createFileRoute("/staff")({
  head: () => ({ meta: [{ title: "Staff Chat — Sauti Microfinance" }] }),
  component: StaffChat,
});

type Att = { name: string; type: string; size: number; data: string };
type ChatMsg = {
  id: string;
  from: string;
  fromName: string;
  to: string;
  text?: string;
  att?: Att;
  at: string;
};

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

function StaffChat() {
  const { staff, currentUser, staffMessages, addStaffMessage, reloadStaffMessages } = useStore();
  const others = staff.filter((s) => s.id !== currentUser.id);
  const [activeId, setActiveId] = useState(others[0]?.id ?? "");
  const allMsgs: ChatMsg[] = staffMessages.map((message) => ({
    id: message.id,
    from: message.senderId,
    fromName: message.senderName,
    to: message.receiverId,
    text: message.content,
    att: message.attachment,
    at: message.createdAt,
  }));
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[] } | null>(null);
  const [recording, setRecording] = useState(false);

  const { markRead } = useReadIds();
  useEffect(() => {
    if (!activeId && others[0]?.id) setActiveId(others[0].id);
  }, [activeId, others]);

  useEffect(() => {
    const sync = () => {
      if (document.hidden) return;
      reloadStaffMessages().catch(() => {});
    };
    const timer = window.setInterval(sync, 30000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [reloadStaffMessages]);

  // Mark messages from the open thread as read so badges/notification count drop.
  useEffect(() => {
    if (!activeId) return;
    const ids = allMsgs
      .filter((m) => m.from === activeId && m.to === currentUser.id)
      .map((m) => `msg-${m.id}`);
    if (ids.length) markRead(ids);
  }, [activeId, allMsgs, currentUser.id, markRead]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  // Cross-tab notify: detect a new INCOMING message and ping bell, sound, vibrate.
  const lastSeenRef = useRef<number>(allMsgs.length);
  useEffect(() => {
    const incoming = allMsgs.slice(lastSeenRef.current).filter((m) => m.to === currentUser.id);
    if (incoming.length) {
      try {
        const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
        if (!AudioCtor) throw new Error("AudioContext unavailable");
        const ctx = new AudioCtor();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.value = 0.07;
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.18);
      } catch {
        /* no-op */
      }
      navigator.vibrate?.([120, 60, 120]);
      window.dispatchEvent(
        new CustomEvent("sauti:notify", {
          detail: {
            id: `msg-${incoming[0].id}`,
            kind: "message",
            title: `New message from ${incoming[0].fromName}`,
            detail: incoming[0].text ?? `Attachment: ${incoming[0].att?.name ?? "file"}`,
            urgent: false,
          },
        }),
      );
    }
    lastSeenRef.current = allMsgs.length;
  }, [allMsgs, currentUser.id]);

  const thread = allMsgs.filter(
    (m) =>
      (m.from === currentUser.id && m.to === activeId) ||
      (m.from === activeId && m.to === currentUser.id),
  );

  async function pushMsg(m: Omit<ChatMsg, "id" | "from" | "fromName" | "to" | "at">) {
    if (!activeId) return;
    await addStaffMessage({
      senderId: currentUser.id,
      senderName: currentUser.name,
      receiverId: activeId,
      content: m.text,
      attachment: m.att,
    });
  }
  async function send() {
    const t = text.trim();
    if (!t) return;
    await pushMsg({ text: t });
    setText("");
  }

  function attach(file: File) {
    if (file.size > 10 * 1024 * 1024) return toast.error("Max 10 MB");
    const r = new FileReader();
    r.onload = () => {
      void pushMsg({
        att: { name: file.name, type: file.type, size: file.size, data: r.result as string },
      });
    };
    r.readAsDataURL(file);
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        const r = new FileReader();
        r.onload = () => {
          void pushMsg({
            att: {
              name: `voice-${Date.now()}.webm`,
              type: "audio/webm",
              size: blob.size,
              data: r.result as string,
            },
          });
        };
        r.readAsDataURL(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recRef.current = { rec, chunks };
      setRecording(true);
    } catch {
      toast.error("Mic access denied");
    }
  }
  function stopRec() {
    recRef.current?.rec.stop();
    setRecording(false);
    recRef.current = null;
  }

  return (
    <>
      <AppHeader
        title="Staff Chat"
        subtitle="WhatsApp-style — text, photos, files and voice notes synced from the database."
      />
      <main className="flex-1 p-6 lg:p-8">
        <CommsTabs />
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 h-[calc(100vh-12rem)]">
          <aside className="bg-card border border-border rounded-xl overflow-y-auto">
            {others.map((s) => {
              const last = [...allMsgs]
                .reverse()
                .find(
                  (m) =>
                    (m.from === s.id && m.to === currentUser.id) ||
                    (m.to === s.id && m.from === currentUser.id),
                );
              const photo = s.photo;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border hover:bg-muted/50 flex gap-3 items-center ${activeId === s.id ? "bg-muted" : ""}`}
                >
                  {photo ? (
                    <img src={photo} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                      {s.name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{s.name}</div>
                    <div className="text-[11px] text-muted-foreground">{roleLabel(s.role)}</div>
                    {last && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">
                        {last.text ?? `📎 ${last.att?.name}`}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          <section className="bg-card border border-border rounded-xl flex flex-col">
            <div className="px-5 py-3 border-b border-border font-medium text-sm flex items-center gap-2">
              {(() => {
                const o = others.find((x) => x.id === activeId);
                const p = o?.photo;
                return p ? (
                  <img src={p} className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-muted grid place-items-center text-[10px]">
                    {o?.name[0]}
                  </div>
                );
              })()}
              {others.find((o) => o.id === activeId)?.name ?? "Select a staff"}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {thread.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.from === currentUser.id ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${m.from === currentUser.id ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                  >
                    {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
                    {m.att && <Attachment att={m.att} />}
                    <div className="text-[10px] opacity-60 mt-1">
                      {new Date(m.at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form
              className="p-3 border-t border-border flex gap-2 items-center"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <label
                className="h-9 w-9 grid place-items-center rounded-md hover:bg-muted cursor-pointer"
                title="Attach file/image/video"
              >
                <Paperclip className="h-4 w-4" />
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                  onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])}
                />
              </label>
              <button
                type="button"
                onClick={recording ? stopRec : startRec}
                className={`h-9 w-9 grid place-items-center rounded-md ${recording ? "bg-destructive text-destructive-foreground" : "hover:bg-muted"}`}
                title={recording ? "Stop recording" : "Voice note"}
              >
                {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type a message…"
                className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button className="px-4 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2 h-9">
                <Send className="h-4 w-4" />
                Send
              </button>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}

function Attachment({ att }: { att: Att }) {
  const isImg = att.type.startsWith("image/");
  const isVid = att.type.startsWith("video/");
  const isAud = att.type.startsWith("audio/");
  return (
    <div className="mt-1 group">
      {isImg && <img src={att.data} alt={att.name} className="max-w-full rounded-md max-h-64" />}
      {isVid && <video src={att.data} controls className="max-w-full rounded-md max-h-64" />}
      {isAud && <audio src={att.data} controls className="w-full" />}
      {!isImg && !isVid && !isAud && (
        <a
          href={att.data}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 bg-background/40 rounded-md px-2 py-1.5 text-xs underline"
        >
          <ImgIcon className="h-3 w-3" />
          {att.name} · view
        </a>
      )}
      <a
        href={att.data}
        download={att.name}
        title="Download (optional)"
        className="inline-flex items-center justify-center h-5 w-5 mt-1 rounded-sm opacity-0 group-hover:opacity-70 hover:opacity-100 transition"
      >
        <Download className="h-3 w-3" />
      </a>
    </div>
  );
}

/** Sub-page tab strip rendered at the top of /staff, /memos and /support-inbox.
 *  Sub-menus expand inside the page (here) — not inside the sidebar. */
export function CommsTabs() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const tabs = [
    { to: "/staff", label: "Chat", icon: MessageSquare },
    { to: "/memos", label: "Memos", icon: StickyNote },
    { to: "/support-inbox", label: "Member Support", icon: Inbox },
  ] as const;
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = path === t.to;
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-t-md border-b-2 -mb-px transition-colors ${
              active
                ? "border-primary text-primary font-medium bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
