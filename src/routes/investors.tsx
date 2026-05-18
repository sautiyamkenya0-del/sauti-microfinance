import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard, DirectorOnly, RestrictedNotice } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  formatMembershipNumber,
  memberCategoryLabel,
  type Investor,
} from "@/lib/store";
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
  const { investors, members, recordTransaction, currentUser } = useStore();
  const nav = useNavigate();
  const total = investors.reduce((s, i) => s + i.contributed, 0);
  const memberInvestors = investors.filter((investor) => {
    const member = members.find((row) => row.id === investor.memberId);
    return member?.category === "both";
  }).length;
  const investorOnly = investors.filter((investor) => {
    const member = members.find((row) => row.id === investor.memberId);
    return member?.category === "investor";
  }).length;
  const [topUpInvestor, setTopUpInvestor] = useState<Investor | null>(null);
  const [topUpAmount, setTopUpAmount] = useState(0);
  const [topUpNote, setTopUpNote] = useState("");

  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={() => nav({ to: "/members" })}
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Register From Members Page
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Investor Capital"
          value={fmtKES(total)}
          icon={<Building2 className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard label="Investors" value={investors.length} />
        <StatCard label="Investor Only" value={investorOnly} />
        <StatCard label="Member + Investor" value={memberInvestors} />
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
                <th className="px-5 py-3 text-left">Membership #</th>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-right">Contributed</th>
                <th className="px-5 py-3 text-left">Category</th>
                <th className="px-5 py-3 text-right">Equity</th>
                <th className="px-5 py-3 text-right">Joined</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {investors.map((i) => {
                const linkedMember = members.find((row) => row.id === i.memberId);
                return (
                  <tr key={i.id}>
                    <td className="px-5 py-3 font-mono text-xs">
                      {i.memberId ? formatMembershipNumber(i.memberId) : "Unlinked"}
                    </td>
                    <td className="px-5 py-3 font-medium">
                      {i.name}
                      {i.phone && (
                        <div className="text-xs text-muted-foreground font-normal">{i.phone}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">{fmtKES(i.contributed)}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {linkedMember ? memberCategoryLabel(linkedMember.category) : "Investor"}
                    </td>
                    <td className="px-5 py-3 text-right">{i.sharePct}%</td>
                    <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                      {i.joinedAt}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => {
                          if (!i.memberId) {
                            toast.error("This investor is missing a linked membership number.");
                            return;
                          }
                          setTopUpInvestor(i);
                          setTopUpAmount(0);
                          setTopUpNote("");
                        }}
                        className="px-3 py-1.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20"
                      >
                        Add Investment
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      </div>

      {topUpInvestor && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4"
          onClick={() => setTopUpInvestor(null)}
        >
          <div
            className="bg-card rounded-xl border border-border w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-semibold mb-4">Add Investment</h3>
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <div className="font-medium text-foreground">{topUpInvestor.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {topUpInvestor.memberId
                    ? formatMembershipNumber(topUpInvestor.memberId)
                    : "No membership number"}
                </div>
              </div>
              <input
                type="number"
                placeholder="Contribution (KES)"
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={topUpAmount || ""}
                onChange={(e) => setTopUpAmount(Number(e.target.value))}
              />
              <textarea
                placeholder="Notes (optional)"
                rows={2}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={topUpNote}
                onChange={(e) => setTopUpNote(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setTopUpInvestor(null)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!topUpInvestor.memberId || topUpAmount <= 0) {
                    return toast.error("Enter a valid investment amount.");
                  }
                  try {
                    await recordTransaction({
                      type: "investor_contribution",
                      amount: topUpAmount,
                      memberId: topUpInvestor.memberId,
                      account: formatMembershipNumber(topUpInvestor.memberId),
                      by: currentUser.id,
                      note: topUpNote || `Investor top-up: ${topUpInvestor.name}`,
                    });
                    toast.success("Investment recorded");
                    setTopUpInvestor(null);
                    setTopUpAmount(0);
                    setTopUpNote("");
                  } catch (error: any) {
                    toast.error(error?.message ?? "Failed to record investment.");
                  }
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
