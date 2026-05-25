import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Badge, Section } from "@/components/ui-bits";
import { CommsTabs } from "./staff";
import { useStore } from "@/lib/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Plus, StickyNote, Trash2 } from "lucide-react";
import { useStaffMemos } from "@/lib/memos-board";
import { useReadIds } from "@/lib/read-state";
import { useServerFn } from "@tanstack/react-start";
import { listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";

type MemoAudience = "staff" | "members" | "suppliers" | "supplier" | "all";

export const Route = createFileRoute("/memos")({
  head: () => ({ meta: [{ title: "Memos — Sauti Microfinance" }] }),
  component: MemosPage,
});

function audienceLabel(audience?: string, supplierId?: string, suppliers: any[] = []) {
  if (audience === "members") return "All members";
  if (audience === "suppliers") return "All suppliers";
  if (audience === "supplier") {
    const supplier = suppliers.find((row) => row.id === supplierId);
    return supplier ? `Supplier: ${supplier.name}` : "Specific supplier";
  }
  if (audience === "all") return "Everyone";
  if (audience === "member") return "Specific member";
  return "Staff";
}

function MemosPage() {
  const { currentUser } = useStore();
  const { memos, postMemo, removeMemo } = useStaffMemos();
  const { markRead } = useReadIds();
  const loadSupplierWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<MemoAudience>("staff");
  const [targetSupplierId, setTargetSupplierId] = useState("");
  const [kind, setKind] = useState<"info" | "warning" | "alert">("info");
  const [expiresAt, setExpiresAt] = useState("");
  const [suppliers, setSuppliers] = useState<any[]>([]);

  useEffect(() => {
    const unreadMemoIds = memos
      .filter(
        (memo) =>
          memo.byStaffId !== currentUser.id && (!memo.byStaffId || memo.by !== currentUser.name),
      )
      .map((memo) => `memo-${memo.id}`);
    if (unreadMemoIds.length) markRead(unreadMemoIds);
  }, [currentUser.id, currentUser.name, markRead, memos]);

  useEffect(() => {
    loadSupplierWorkspace()
      .then((workspace) => setSuppliers((workspace as any).suppliers ?? []))
      .catch(() => setSuppliers([]));
  }, [loadSupplierWorkspace]);

  async function post() {
    if (!title.trim() || !body.trim()) return toast.error("Title and body required");
    if (audience === "supplier" && !targetSupplierId) {
      return toast.error("Choose the supplier who should receive this notice.");
    }
    await postMemo({
      title,
      body,
      by: currentUser.name,
      byStaffId: currentUser.id,
      date: new Date().toISOString().slice(0, 10),
      audience,
      targetSupplierId: audience === "supplier" ? targetSupplierId : undefined,
      kind,
      expiresAt: expiresAt || undefined,
    });
    setTitle("");
    setBody("");
    setAudience("staff");
    setTargetSupplierId("");
    setKind("info");
    setExpiresAt("");
    toast.success(audience === "staff" ? "Memo posted" : "Notice posted");
  }

  function downloadMemo(memo: (typeof memos)[number]) {
    const payload = JSON.stringify(memo, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${memo.date}-${memo.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "memo"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <AppHeader
        title="Communications"
        subtitle="Post staff memos, member notices, supplier notices, and specific supplier messages."
      />
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
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as MemoAudience)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="staff">Staff only</option>
                <option value="members">All members</option>
                <option value="suppliers">All suppliers</option>
                <option value="supplier">Specific supplier</option>
                <option value="all">Everyone</option>
              </select>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="alert">Urgent alert</option>
              </select>
              <input
                type="date"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </div>
            {audience === "supplier" ? (
              <select
                value={targetSupplierId}
                onChange={(event) => setTargetSupplierId(event.target.value)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="">Choose supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            ) : null}
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
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge tone={m.audience === "staff" ? "muted" : "accent"}>
                        {audienceLabel(m.audience, m.targetSupplierId, suppliers)}
                      </Badge>
                      {m.expiresAt ? <span>Expires {m.expiresAt}</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.date} · by {m.by}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => downloadMemo(m)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Download memo"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => void removeMemo(m.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
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
