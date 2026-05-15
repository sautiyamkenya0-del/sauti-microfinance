import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, Badge } from "@/components/ui-bits";
import { useStore, fmtKES } from "@/lib/store";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, Pencil } from "lucide-react";
import {
  useFeesPolicy,
  upsertFee,
  removeFee,
  isFeeActive,
  scopeLabel,
  type FeePolicy,
  type FeeScope,
  type FeePermanence,
} from "@/lib/fees-policy";

export const Route = createFileRoute("/fees-policy")({
  head: () => ({ meta: [{ title: "Fees Policy — Sauti Microfinance" }] }),
  component: FeesPolicyPage,
});

const SCOPES: FeeScope[] = ["all", "new_only", "loan_holders", "investors"];

function FeesPolicyPage() {
  const { currentUser } = useStore();
  const fees = useFeesPolicy();
  const [editing, setEditing] = useState<FeePolicy | null>(null);
  const [creating, setCreating] = useState(false);

  if (currentUser.role !== "director") return <Navigate to="/" />;

  function blank(): FeePolicy {
    return {
      key: `custom_${Date.now()}`,
      label: "",
      amount: 0,
      permanence: "permanent",
      scope: "all",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      custom: true,
      updatedAt: new Date().toISOString(),
    };
  }

  return (
    <>
      <AppHeader
        title="Fees Policy"
        subtitle="Director-only — set fee amounts, permanence and which members they apply to."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="admin" />
        <Section
          title="Active fees"
          action={
            <button
              onClick={() => {
                setEditing(blank());
                setCreating(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              Impose new fee
            </button>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left">Fee</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left pl-5">Permanence</th>
                  <th className="text-left">Applies to</th>
                  <th className="text-left">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fees.map((f) => (
                  <tr key={f.key}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{f.label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {f.key}
                        {f.custom ? " · custom" : ""}
                      </div>
                    </td>
                    <td className="text-right font-semibold">{fmtKES(f.amount)}</td>
                    <td className="pl-5">
                      {f.permanence === "permanent" ? (
                        <Badge tone="success">Permanent</Badge>
                      ) : (
                        <Badge tone="warning">
                          Semi · {f.durationDays}d from {f.effectiveFrom}
                        </Badge>
                      )}
                    </td>
                    <td>{scopeLabel(f.scope)}</td>
                    <td>
                      {isFeeActive(f) ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="muted">Expired</Badge>
                      )}
                    </td>
                    <td className="pr-5 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setEditing(f);
                          setCreating(false);
                        }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border hover:bg-muted"
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      {f.custom && (
                        <button
                          onClick={() => {
                            removeFee(f.key);
                            toast.success("Removed");
                          }}
                          className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {editing && (
          <Section title={creating ? "New fee" : `Edit · ${editing.label || editing.key}`}>
            <div className="p-5 grid sm:grid-cols-2 gap-4 max-w-3xl">
              <label className="block text-sm">
                Label
                <input
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                Amount (KES)
                <input
                  type="number"
                  value={editing.amount}
                  onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                Permanence
                <select
                  value={editing.permanence}
                  onChange={(e) =>
                    setEditing({ ...editing, permanence: e.target.value as FeePermanence })
                  }
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="permanent">Permanent</option>
                  <option value="semi">Semi-permanent</option>
                </select>
              </label>
              {editing.permanence === "semi" && (
                <label className="block text-sm">
                  Duration
                  <select
                    value={editing.durationDays ?? 30}
                    onChange={(e) =>
                      setEditing({ ...editing, durationDays: Number(e.target.value) })
                    }
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  >
                    <option value={7}>1 week</option>
                    <option value={14}>2 weeks</option>
                    <option value={30}>1 month</option>
                    <option value={60}>2 months</option>
                    <option value={90}>3 months</option>
                    <option value={180}>6 months</option>
                    <option value={365}>1 year</option>
                  </select>
                </label>
              )}
              <label className="block text-sm">
                Effective from
                <input
                  type="date"
                  value={editing.effectiveFrom}
                  onChange={(e) => setEditing({ ...editing, effectiveFrom: e.target.value })}
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                Applies to
                <select
                  value={editing.scope}
                  onChange={(e) => setEditing({ ...editing, scope: e.target.value as FeeScope })}
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {scopeLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm sm:col-span-2">
                Notes (optional)
                <textarea
                  value={editing.notes ?? ""}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  rows={2}
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                />
              </label>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  onClick={() => {
                    if (!editing.label.trim()) return toast.error("Label required");
                    if (editing.amount < 0) return toast.error("Amount must be ≥ 0");
                    upsertFee(editing);
                    toast.success(creating ? "Fee created" : "Fee updated");
                    setEditing(null);
                    setCreating(false);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                  className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          </Section>
        )}
      </main>
    </>
  );
}
