import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { useStore, fmtKES, type PettyCashEntry } from "@/lib/store";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  X,
  Image as ImageIcon,
  RefreshCw,
  Loader2,
  Download,
  Search,
} from "lucide-react";

export const Route = createFileRoute("/pettycash")({
  head: () => ({ meta: [{ title: "Petty Cash Book — Sauti Microfinance" }] }),
  component: PettyPage,
});

type EntryDraft = Omit<PettyCashEntry, "id"> & { id?: string };

const empty = (): EntryDraft => ({
  date: new Date().toISOString().slice(0, 10),
  time: "",
  type: "payment",
  payee: "",
  contact: "",
  description: "",
  amount: 0,
  txnCost: 0,
  mode: "cash",
  reference: "",
  category: "Admin",
  by: "",
});

function PettyPage() {
  const { pettyCash, addPetty, staff } = useStore();
  const [openEntry, setOpenEntry] = useState(false);
  const [openScan, setOpenScan] = useState(false);
  const [draft, setDraft] = useState<EntryDraft>(empty());

  // Filters
  const [filter, setFilter] = useState<"today" | "yesterday" | "month" | "lastmonth" | "all">(
    "month",
  );
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const list = useMemo(() => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const yStr = y.toISOString().slice(0, 10);
    const monthStart = `${todayStr.slice(0, 7)}-01`;
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lmStart = lastMonth.toISOString().slice(0, 10);
    const lmEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0, 10);

    return pettyCash.filter((p) => {
      if (filter === "today" && p.date !== todayStr) return false;
      if (filter === "yesterday" && p.date !== yStr) return false;
      if (filter === "month" && p.date < monthStart) return false;
      if (filter === "lastmonth" && (p.date < lmStart || p.date > lmEnd)) return false;
      if (from && p.date < from) return false;
      if (to && p.date > to) return false;
      if (search) {
        const s = search.toLowerCase();
        const blob =
          `${p.payee ?? ""} ${p.contact ?? ""} ${p.description ?? ""} ${p.reference ?? ""}`.toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [pettyCash, filter, search, from, to]);

  const stats = useMemo(() => {
    const topups = list.filter((p) => p.type === "topup").reduce((s, p) => s + p.amount, 0);
    const payments = list.filter((p) => p.type !== "topup").reduce((s, p) => s + p.amount, 0);
    const txnCost = list.reduce((s, p) => s + (p.txnCost ?? 0), 0);
    const opening = list.length ? (list[list.length - 1].openingBalance ?? 0) : 0;
    const cashBalance = opening + topups - payments - txnCost;
    return { topups, payments, txnCost, opening, cashBalance };
  }, [list]);

  const downloadReport = () => {
    const headers = [
      "Date",
      "Time",
      "Type",
      "Payee",
      "Contact",
      "Details",
      "Mode",
      "Reference",
      "Amount",
      "TxnCost",
    ];
    const rows = list.map((p) => [
      p.date,
      p.time ?? "",
      p.type ?? "payment",
      p.payee ?? "",
      p.contact ?? "",
      p.description ?? "",
      p.mode ?? "",
      p.reference ?? "",
      p.amount,
      p.txnCost ?? 0,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `petty-cash-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <AppHeader
        title="Petty Cash Book"
        subtitle="Daily cash in / cash out · transaction costs tracked"
      />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-5">
        <SectionTabs section="capital" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setOpenScan(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border border-border bg-card hover:bg-muted"
            >
              <Sparkles className="h-4 w-4" /> Scan with AI
            </button>
            <button
              onClick={() => {
                setDraft(empty());
                setOpenEntry(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> New entry
            </button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium text-sm">Upload with AI</div>
            <div className="text-xs text-muted-foreground">
              Add an M-PESA screenshot, payment proof photo, or pasted message and the system will
              read the payee, phone, amount, cost, time, and reference for you.
            </div>
          </div>
          <button
            onClick={() => setOpenScan(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm border border-border bg-card hover:bg-muted"
          >
            <Sparkles className="h-4 w-4" /> Open AI payment scan
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatBox label="Cash Balance" value={fmtKES(stats.cashBalance)} />
          <StatBox label="Opening Balance" value={fmtKES(stats.opening)} />
          <StatBox label="Top-ups (cash in)" value={fmtKES(stats.topups)} />
          <StatBox label="Payments" value={fmtKES(stats.payments)} />
          <StatBox
            label="Bank / Txn Charges"
            value={fmtKES(stats.txnCost)}
            hint={`bank KSh 0 · pay ${fmtKES(stats.txnCost)}`}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {(
            [
              ["today", "Today"],
              ["yesterday", "Yesterday"],
              ["month", "This month"],
              ["lastmonth", "Last month"],
              ["all", "All"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-md text-sm ${filter === k ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-muted"}`}
            >
              {l}
            </button>
          ))}
          <div className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5 flex-1 min-w-[200px] max-w-[320px]">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payee, contact, ref…"
              className="bg-transparent text-sm outline-none flex-1"
            />
          </div>
          <label className="text-xs">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ml-2 bg-card border border-border rounded-md px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ml-2 bg-card border border-border rounded-md px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={() => {
              setSearch("");
              setFrom("");
              setTo("");
            }}
            className="px-3 py-1.5 rounded-md text-sm border border-border bg-card hover:bg-muted"
          >
            Clear
          </button>
          <button
            onClick={downloadReport}
            className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Download className="h-4 w-4" /> Download report
          </button>
        </div>

        <div className="text-xs text-muted-foreground">
          Showing {list.length} of {pettyCash.length} entries. Leave the date filters blank to see
          the full petty cash book.
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Payee</th>
                  <th className="px-4 py-3 text-left">Contact</th>
                  <th className="px-4 py-3 text-left">Details</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Txn cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No entries match these filters.
                    </td>
                  </tr>
                )}
                {list.map((p) => {
                  const isPayment = (p.type ?? "payment") !== "topup";
                  return (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 align-top">
                        <div>{p.date}</div>
                        {p.time && (
                          <div className="text-[11px] text-muted-foreground">{p.time}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${isPayment ? "bg-muted" : "bg-success/15 text-success"}`}
                        >
                          {isPayment ? "Payment" : "Top-up"}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top font-medium">{p.payee ?? "—"}</td>
                      <td className="px-4 py-3 align-top text-xs font-mono text-muted-foreground">
                        {p.contact ?? "—"}
                      </td>
                      <td className="px-4 py-3 align-top">{p.description}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="uppercase text-xs">{p.mode ?? "cash"}</div>
                        {p.reference && (
                          <div className="text-[11px] font-mono text-muted-foreground">
                            {p.reference}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 align-top text-right font-semibold ${isPayment ? "text-destructive" : "text-success"}`}
                      >
                        {isPayment ? "-" : "+"}
                        {fmtKES(p.amount)}
                      </td>
                      <td className="px-4 py-3 align-top text-right text-muted-foreground">
                        {p.txnCost ? fmtKES(p.txnCost) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {(openEntry || openScan) && (
        <PettyEntryDialog
          mode={openScan ? "scan" : "manual"}
          draft={draft}
          setDraft={setDraft}
          onClose={() => {
            setOpenEntry(false);
            setOpenScan(false);
          }}
          onSave={async (d) => {
            if (!d.payee && !d.description) {
              toast.error("Add at least a payee or details.");
              return;
            }
            if (!d.amount || d.amount <= 0) {
              toast.error("Amount must be > 0.");
              return;
            }
            await addPetty({ ...d, by: d.by || staff[0]?.id || "" });
            toast.success(d.type === "topup" ? "Top-up recorded" : "Payment recorded");
            setOpenEntry(false);
            setOpenScan(false);
            setDraft(empty());
          }}
        />
      )}
    </>
  );
}

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl sm:text-2xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function PettyEntryDialog({
  mode,
  draft,
  setDraft,
  onClose,
  onSave,
}: {
  mode: "manual" | "scan";
  draft: EntryDraft;
  setDraft: (d: EntryDraft) => void;
  onClose: () => void;
  onSave: (d: EntryDraft) => Promise<void>;
}) {
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const runScan = async () => {
    if (!imageDataUrl && !text.trim()) {
      toast.error("Add an image or paste a message first.");
      return;
    }
    setScanning(true);
    try {
      const r = await fetch("/api/ai/scan-mpesa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, text }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        toast.error(j.error ?? "Scan failed");
        return;
      }
      const e = j.entry ?? {};
      setDraft({
        ...draft,
        date: e.date || draft.date,
        time: e.time || draft.time,
        type: e.type || draft.type,
        payee: e.payee || draft.payee,
        contact: e.contact || draft.contact,
        description: e.details || draft.description,
        amount: Number(e.amount) || draft.amount,
        txnCost: Number(e.txnCost) || draft.txnCost,
        mode: e.mode || draft.mode,
        reference: e.reference || draft.reference,
      });
      toast.success("Fields filled — review and save.");
    } catch (err: any) {
      toast.error(err?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 grid place-items-center z-50 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl border border-border w-full max-w-2xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="font-display text-lg font-semibold">New petty cash entry</h3>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Fill with AI */}
          <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
            <div>
              <div className="font-medium text-sm">Fill with AI</div>
              <div className="text-xs text-muted-foreground">
                Upload an M-PESA screenshot, payment photo, or paste the message text and we'll fill
                the details.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setImageDataUrl(null);
                  setText("");
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-border bg-card hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
              <button
                onClick={runScan}
                disabled={scanning}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-border bg-card hover:bg-muted disabled:opacity-50"
              >
                {scanning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}{" "}
                Scan with AI
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-medium mb-1">Screenshot</div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPickImage(f);
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-border bg-card hover:bg-muted mb-2"
                >
                  <ImageIcon className="h-3.5 w-3.5" /> Add image
                </button>
                <div className="border-2 border-dashed border-border rounded-md h-28 grid place-items-center text-xs text-muted-foreground overflow-hidden">
                  {imageDataUrl ? (
                    <img src={imageDataUrl} alt="preview" className="max-h-full" />
                  ) : (
                    "No image yet"
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium mb-1">Message text (optional)</div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  placeholder="Paste the M-PESA or bank message here if you have it as text."
                  className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Time">
              <input
                type="text"
                placeholder="e.g. 08:43 AM"
                value={draft.time ?? ""}
                onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Type">
              <select
                value={draft.type ?? "payment"}
                onChange={(e) => setDraft({ ...draft, type: e.target.value as any })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="payment">Payment (cash out)</option>
                <option value="topup">Top-up (cash in)</option>
              </select>
            </Field>
          </div>

          <Field label="Payee">
            <input
              placeholder="e.g. Ester Ndungu"
              value={draft.payee ?? ""}
              onChange={(e) => setDraft({ ...draft, payee: e.target.value })}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Contact (phone)">
            <input
              placeholder="e.g. 0712 345678"
              value={draft.contact ?? ""}
              onChange={(e) => setDraft({ ...draft, contact: e.target.value })}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </Field>

          <Field label="What was paid for">
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (KSh)">
              <input
                type="number"
                value={draft.amount || ""}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Transaction cost">
              <input
                type="number"
                placeholder="0"
                value={draft.txnCost || ""}
                onChange={(e) => setDraft({ ...draft, txnCost: Number(e.target.value) })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode of payment">
              <select
                value={draft.mode ?? "cash"}
                onChange={(e) => setDraft({ ...draft, mode: e.target.value as any })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank</option>
              </select>
            </Field>
            <Field label="Payment reference">
              <input
                placeholder="M-Pesa code, cheque #"
                value={draft.reference ?? ""}
                onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
            </Field>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md hover:bg-muted">
            Cancel
          </button>
          <button
            onClick={() => void onSave(draft)}
            className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save entry
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}
