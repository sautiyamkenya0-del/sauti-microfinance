import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Section } from "@/components/ui-bits";
import { CommsTabs } from "./staff";
import { useStore } from "@/lib/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StickyNote, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/memos")({
  head: () => ({ meta: [{ title: "Memos — Sauti Microfinance" }] }),
  component: MemosPage,
});

type Memo = { id: string; date: string; title: string; body: string; by: string };
const MEMO_KEY = "sauti_memos_v1";

function MemosPage() {
  const { currentUser } = useStore();
  const [memos, setMemos] = useState<Memo[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(MEMO_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  }, [memos]);

  function post() {
    if (!title.trim() || !body.trim()) return toast.error("Title and body required");
    setMemos((p) => [
      {
        id: `MM${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        title,
        body,
        by: currentUser.name,
      },
      ...p,
    ]);
    setTitle("");
    setBody("");
    toast.success("Memo posted");
  }

  return (
    <>
      <AppHeader title="Staff Memos" subtitle="Internal announcements visible to all staff." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <CommsTabs />
        <Section title="Post a memo">
          <div className="p-5 space-y-3 max-w-2xl">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Memo title"
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a memo for the team…"
              rows={5}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
            <button
              onClick={post}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Post Memo
            </button>
          </div>
        </Section>

        <Section title={`Memos board (${memos.length})`}>
          <div className="p-5 space-y-3">
            {memos.length === 0 && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <StickyNote className="h-4 w-4" />
                No memos yet.
              </div>
            )}
            {memos.map((m) => (
              <div key={m.id} className="bg-muted/30 border border-border rounded-lg p-4">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <div className="font-medium">{m.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.date} · by {m.by}
                    </div>
                  </div>
                  <button
                    onClick={() => setMemos((p) => p.filter((x) => x.id !== m.id))}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}
