import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Badge, Section } from "@/components/ui-bits";
import { CommsTabs } from "./staff";
import { fmtKES, loanSummary, useStore } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Plus, Sparkles, StickyNote, Trash2 } from "lucide-react";
import { useStaffMemos } from "@/lib/memos-board";
import { useReadIds } from "@/lib/read-state";
import { useServerFn } from "@tanstack/react-start";
import { listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";
import { polishMemberLetterRecord } from "@/lib/app-data.functions";
import {
  downloadLetterheadHtml,
  LetterheadDocument,
  type LetterFact,
} from "@/components/LetterheadDocument";

type MemoAudience = "staff" | "members" | "member" | "suppliers" | "supplier" | "all";
type LetterFactKey =
  | "name"
  | "memberNumber"
  | "phone"
  | "savingsBalance"
  | "shares"
  | "loanAppliedFor"
  | "loanDueDate"
  | "loanStatus"
  | "penalties";

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
  const { currentUser, members, loans, penalties } = useStore();
  const { memos, postMemo, removeMemo } = useStaffMemos();
  const { markRead } = useReadIds();
  const loadSupplierWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const polishLetter = useServerFn(polishMemberLetterRecord);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<MemoAudience>("staff");
  const [targetMemberId, setTargetMemberId] = useState("");
  const [targetSupplierId, setTargetSupplierId] = useState("");
  const [kind, setKind] = useState<"info" | "warning" | "alert">("info");
  const [expiresAt, setExpiresAt] = useState("");
  const [documentKind, setDocumentKind] = useState<"memo" | "letter">("memo");
  const [letterIntent, setLetterIntent] = useState("");
  const [letterFactKeys, setLetterFactKeys] = useState<LetterFactKey[]>([
    "name",
    "memberNumber",
    "savingsBalance",
    "loanAppliedFor",
    "loanDueDate",
  ]);
  const [polishing, setPolishing] = useState(false);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const selectedMember = members.find((member) => member.id === targetMemberId);
  const selectedLoan = useMemo(() => {
    if (!targetMemberId) return undefined;
    return loans
      .filter((loan) => loan.memberId === targetMemberId)
      .sort((left, right) => right.startDate.localeCompare(left.startDate))[0];
  }, [loans, targetMemberId]);
  const selectedLoanSummary = selectedLoan ? loanSummary(selectedLoan) : undefined;
  const selectedPenaltyTotal = useMemo(
    () =>
      penalties
        .filter((penalty) => penalty.memberId === targetMemberId && penalty.status === "outstanding")
        .reduce((sum, penalty) => sum + penalty.amount, 0),
    [penalties, targetMemberId],
  );
  const availableLetterFacts = useMemo<Array<{ key: LetterFactKey; label: string; value: string }>>(
    () => [
      { key: "name", label: "Name", value: selectedMember?.name ?? "" },
      { key: "memberNumber", label: "Member number", value: selectedMember?.id ?? "" },
      { key: "phone", label: "Phone", value: selectedMember?.phone ?? "" },
      {
        key: "savingsBalance",
        label: "Savings balance",
        value: selectedMember ? fmtKES(selectedMember.savingsBalance) : "",
      },
      {
        key: "shares",
        label: "Shares",
        value: selectedMember ? String(selectedMember.shares) : "",
      },
      {
        key: "loanAppliedFor",
        label: "Loan applied for",
        value: selectedLoan ? fmtKES(selectedLoan.approvedAmount ?? selectedLoan.principal) : "",
      },
      {
        key: "loanDueDate",
        label: "Due date",
        value: selectedLoanSummary?.dueDate ?? "",
      },
      {
        key: "loanStatus",
        label: "Loan status",
        value: selectedLoan?.status ?? "",
      },
      {
        key: "penalties",
        label: "Outstanding penalties",
        value: selectedPenaltyTotal > 0 ? fmtKES(selectedPenaltyTotal) : "",
      },
    ],
    [selectedLoan, selectedLoanSummary?.dueDate, selectedMember, selectedPenaltyTotal],
  );
  const selectedLetterFacts = availableLetterFacts
    .filter((fact) => letterFactKeys.includes(fact.key) && fact.value)
    .map(({ label, value }) => ({ label, value }));

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

  async function post(mode: "memo" | "letter" = documentKind) {
    if (!title.trim() || !body.trim()) return toast.error("Title and body required");
    const effectiveDocumentKind = mode;
    const effectiveAudience = effectiveDocumentKind === "letter" ? "member" : audience;
    if (effectiveDocumentKind === "letter" && !targetMemberId) {
      return toast.error("Choose the member who should receive this letter.");
    }
    if (effectiveAudience === "member" && !targetMemberId) {
      return toast.error("Choose the member who should receive this notice.");
    }
    if (effectiveAudience === "supplier" && !targetSupplierId) {
      return toast.error("Choose the supplier who should receive this notice.");
    }
    await postMemo({
      title,
      body,
      by: currentUser.name,
      byStaffId: currentUser.id,
      date: new Date().toISOString().slice(0, 10),
      audience: effectiveAudience,
      targetMemberId: effectiveAudience === "member" ? targetMemberId : undefined,
      targetSupplierId: effectiveAudience === "supplier" ? targetSupplierId : undefined,
      kind,
      expiresAt: expiresAt || undefined,
      documentKind: effectiveDocumentKind,
      letterMeta:
        effectiveDocumentKind === "letter"
          ? {
              recipientName: selectedMember?.name ?? "",
              recipientId: selectedMember?.id ?? targetMemberId,
              facts: selectedLetterFacts,
              intent: letterIntent,
              polishedWithAi: false,
            }
          : undefined,
    });
    setTitle("");
    setBody("");
    setAudience("staff");
    setTargetMemberId("");
    setTargetSupplierId("");
    setKind("info");
    setExpiresAt("");
    setDocumentKind("memo");
    setLetterIntent("");
    toast.success(effectiveDocumentKind === "letter" ? "Letter sent" : "Memo posted");
  }

  async function polishDraft() {
    if (!targetMemberId) return toast.error("Choose a member before polishing the letter.");
    if (!body.trim()) return toast.error("Write the draft details first.");
    setPolishing(true);
    try {
      const result = await polishLetter({
        data: {
          memberId: targetMemberId,
          intent: letterIntent,
          draft: body,
          includedFacts: {
            facts: selectedLetterFacts,
            title,
          },
        },
      });
      setBody(result.body);
      if (!title.trim()) setTitle("Member Notice");
      toast.success("Letter polished. Review it before sending.");
    } catch (error: any) {
      toast.error(error?.message ?? "AI could not polish this letter.");
    } finally {
      setPolishing(false);
    }
  }

  async function downloadMemo(memo: (typeof memos)[number]) {
    if (memo.documentKind === "letter") {
      const meta = memo.letterMeta ?? {};
      await downloadLetterheadHtml({
        title: memo.title,
        body: memo.body,
        date: memo.date,
        recipientName: String(meta.recipientName ?? ""),
        recipientId: String(meta.recipientId ?? meta.memberId ?? memo.targetMemberId ?? ""),
        facts: Array.isArray(meta.facts) ? (meta.facts as LetterFact[]) : [],
      });
      return;
    }
    const payload = JSON.stringify(memo, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${memo.date}-${memo.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "memo"}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleLetterFact(key: LetterFactKey, checked: boolean) {
    setLetterFactKeys((current) =>
      checked
        ? Array.from(new Set([...current, key]))
        : current.filter((existingKey) => existingKey !== key),
    );
  }

  return (
    <>
      <AppHeader
        title="Communications"
        subtitle="Post staff memos, member notices, supplier notices, and specific supplier messages."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <CommsTabs />
        <Section title="Letterhead letter">
          <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
            <div className="space-y-3">
              <select
                value={targetMemberId}
                onChange={(event) => {
                  setTargetMemberId(event.target.value);
                  setAudience("member");
                  setDocumentKind("letter");
                }}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="">Choose member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.id} - {member.name}
                  </option>
                ))}
              </select>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Letter subject"
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
              <textarea
                value={letterIntent}
                onChange={(event) => setLetterIntent(event.target.value)}
                placeholder="AI polish instruction, for example: member has defaulted and should clear arrears by Friday"
                rows={2}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
              <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">
                {availableLetterFacts.map((fact) => (
                  <label key={fact.key} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={letterFactKeys.includes(fact.key)}
                      onChange={(event) => toggleLetterFact(fact.key, event.target.checked)}
                    />
                    <span>
                      {fact.label}
                      {fact.value ? (
                        <span className="text-muted-foreground"> - {fact.value}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Write the facts and rough wording here, then polish with AI if needed."
                rows={8}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setDocumentKind("letter");
                    setAudience("member");
                    void polishDraft();
                  }}
                  disabled={polishing}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {polishing ? "Polishing..." : "Polish letter with AI"}
                </button>
                <button
                  onClick={() => {
                    setDocumentKind("letter");
                    setAudience("member");
                    void post("letter");
                  }}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Send Letter
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                Review letterhead
              </div>
              <LetterheadDocument
                title={title || "Member Notice"}
                body={body || "Your letter will appear here."}
                recipientName={selectedMember?.name}
                recipientId={selectedMember?.id}
                facts={selectedLetterFacts}
              />
            </div>
          </div>
        </Section>
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
              onClick={() => void post("memo")}
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
                      {m.documentKind === "letter" ? <Badge tone="accent">Letterhead</Badge> : null}
                      {m.expiresAt ? <span>Expires {m.expiresAt}</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.date} · by {m.by}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void downloadMemo(m)}
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
                {m.documentKind === "letter" ? (
                  <div className="mt-3 max-w-3xl">
                    <LetterheadDocument
                      title={m.title}
                      body={m.body}
                      date={m.date}
                      recipientName={String(m.letterMeta?.recipientName ?? "")}
                      recipientId={String(
                        m.letterMeta?.recipientId ?? m.letterMeta?.memberId ?? "",
                      )}
                      facts={Array.isArray(m.letterMeta?.facts) ? (m.letterMeta.facts as LetterFact[]) : []}
                    />
                  </div>
                ) : (
                  <p className="text-sm mt-2 whitespace-pre-wrap">{m.body}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      </main>
    </>
  );
}
