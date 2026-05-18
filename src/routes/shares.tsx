import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard, DirectorOnly } from "@/components/ui-bits";
import { useStore, fmtKES } from "@/lib/store";
import { useState } from "react";
import { toast } from "sonner";
import { PieChart as PieIcon } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export const Route = createFileRoute("/shares")({
  head: () => ({ meta: [{ title: "Shares — Sauti Microfinance" }] }),
  component: SharesPage,
});

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-primary)",
];

function SharesPage() {
  const { members, sharePrice, recordTransaction, currentUser } = useStore();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [units, setUnits] = useState(1);

  const totalUnits = members.reduce((s, m) => s + m.shares, 0);
  const totalCapital = totalUnits * sharePrice;

  const data = members.filter((m) => m.shares > 0).map((m) => ({ name: m.name, value: m.shares }));

  return (
    <>
      <AppHeader title="Shares" subtitle="Member share capital and ownership distribution." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="capital" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Share Price"
            value={fmtKES(sharePrice)}
            icon={<PieIcon className="h-5 w-5" />}
            tone="accent"
          />
          <DirectorOnly>
            <StatCard label="Units Issued" value={totalUnits.toLocaleString()} />
            <StatCard label="Share Capital" value={fmtKES(totalCapital)} tone="success" />
          </DirectorOnly>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Section title="Issue shares">
            <div className="p-5 space-y-3">
              <select
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.shares} units
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                placeholder="Units"
                value={units}
                onChange={(e) => setUnits(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
              <div className="bg-muted/50 rounded-md px-3 py-2 text-sm flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-semibold">{fmtKES(units * sharePrice)}</span>
              </div>
              <button
                onClick={async () => {
                  if (units <= 0) return;
                  await recordTransaction({
                    type: "share_purchase",
                    amount: units * sharePrice,
                    memberId,
                    by: currentUser.id,
                  });
                  toast.success(`${units} share unit(s) issued`);
                  setUnits(1);
                }}
                className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-medium hover:bg-primary/90"
              >
                Issue
              </button>
            </div>
          </Section>

          <div className="lg:col-span-2">
            <Section title="Ownership Distribution">
              <div className="p-4 h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={110}
                      paddingAngle={2}
                    >
                      {data.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
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
          </div>
        </div>

        <Section title="Shareholder Register">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Member</th>
                <th className="px-5 py-3 text-right">Units</th>
                <th className="px-5 py-3 text-right">Value</th>
                <th className="px-5 py-3 text-right">% Stake</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members
                .filter((m) => m.shares > 0)
                .sort((a, b) => b.shares - a.shares)
                .map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 font-medium">{m.name}</td>
                    <td className="px-5 py-3 text-right">{m.shares}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(m.shares * sharePrice)}</td>
                    <td className="px-5 py-3 text-right">
                      {((m.shares / totalUnits) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
      </main>
    </>
  );
}
