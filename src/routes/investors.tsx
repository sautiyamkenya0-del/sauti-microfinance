import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard, DirectorOnly, RestrictedNotice } from "@/components/ui-bits";
import { useStore, fmtKES } from "@/lib/store";
import { Building2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/investors")({
  head: () => ({ meta: [{ title: "Investors — Sauti Microfinance" }] }),
  component: InvPage,
});

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
];

function InvPage() {
  return (
    <>
      <AppHeader
        title="Investors"
        subtitle="Equity holders and capital contributions — Director access only."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="members" />
        <DirectorOnly
          fallback={<RestrictedNotice label="Investor records are restricted to Directors" />}
        >
          <InvestorsContent />
        </DirectorOnly>
      </main>
    </>
  );
}

function InvestorsContent() {
  const { investors, addInvestor } = useStore();
  const total = investors.reduce((s, i) => s + i.contributed, 0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", contributed: 0, sharePct: 0, notes: "" });

  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={() => setOpen(true)}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          + Add Investor
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Total Investor Capital"
          value={fmtKES(total)}
          icon={<Building2 className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard label="Investors" value={investors.length} />
        <StatCard
          label="Avg. Contribution"
          value={fmtKES(investors.length ? total / investors.length : 0)}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Capital Mix">
          <div className="p-4 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={investors} dataKey="contributed" nameKey="name" outerRadius={120}>
                  {investors.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => fmtKES(v)}
                  contentStyle={{
                    background: "var(--color-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Investor Register">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-right">Contributed</th>
                <th className="px-5 py-3 text-right">Equity</th>
                <th className="px-5 py-3 text-right">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {investors.map((i) => (
                <tr key={i.id}>
                  <td className="px-5 py-3 font-medium">
                    {i.name}
                    {i.phone && (
                      <div className="text-xs text-muted-foreground font-normal">{i.phone}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">{fmtKES(i.contributed)}</td>
                  <td className="px-5 py-3 text-right">{i.sharePct}%</td>
                  <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                    {i.joinedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card rounded-xl border border-border w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-semibold mb-4">Add Investor</h3>
            <div className="space-y-3">
              <input
                placeholder="Investor name / entity"
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                placeholder="Phone (optional)"
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  placeholder="Contribution (KES)"
                  className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  value={form.contributed}
                  onChange={(e) => setForm({ ...form, contributed: Number(e.target.value) })}
                />
                <input
                  type="number"
                  placeholder="Equity %"
                  className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  value={form.sharePct}
                  onChange={(e) => setForm({ ...form, sharePct: Number(e.target.value) })}
                />
              </div>
              <textarea
                placeholder="Notes (optional)"
                rows={2}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!form.name || form.contributed <= 0)
                    return toast.error("Name & contribution required");
                  addInvestor(form);
                  toast.success("Investor added");
                  setOpen(false);
                  setForm({ name: "", phone: "", contributed: 0, sharePct: 0, notes: "" });
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
