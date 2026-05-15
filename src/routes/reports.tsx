import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import { useStore, fmtKES, loanSummary } from "@/lib/store";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  LineChart,
  Line,
} from "recharts";
import { TrendingUp } from "lucide-react";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports — Sauti Microfinance" }] }),
  component: ReportsPage,
});

function ReportsPage() {
  const { loans, members, transactions, pettyCash, investors, sharePrice } = useStore();

  const portfolio = loans
    .filter((l) => l.status === "active")
    .reduce((s, l) => s + loanSummary(l).balance, 0);
  const interestEarned = loans.reduce((sum, loan) => {
    const summary = loanSummary(loan);
    const paidRatio = summary.total > 0 ? Math.min(1, loan.paid / summary.total) : 0;
    return sum + summary.interest * paidRatio;
  }, 0);
  const savings = members.reduce((s, m) => s + m.savingsBalance, 0);
  const shareCap = members.reduce((s, m) => s + m.shares, 0) * sharePrice;
  const investorCap = investors.reduce((s, i) => s + i.contributed, 0);
  const expenses = pettyCash.reduce((s, p) => s + p.amount, 0);

  const officerBreakdown = ["S3", "S4"].map((id) => {
    const ll = loans.filter((l) => l.officerId === id);
    return {
      officer: id === "S3" ? "Cynthia W." : "Daniel M.",
      disbursed: ll.reduce((s, l) => s + l.principal, 0),
      collected: ll.reduce((s, l) => s + l.paid, 0),
    };
  });

  const monthly = ["Dec", "Jan", "Feb", "Mar", "Apr", "May"].map((m, i) => ({
    month: m,
    revenue: 35000 + i * 8000,
    expenses: 18000 + i * 3000,
  }));

  return (
    <>
      <AppHeader
        title="Reports"
        subtitle="Financial performance, portfolio quality and operations."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="admin" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Outstanding Portfolio"
            value={fmtKES(portfolio)}
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <StatCard label="Interest Earned" value={fmtKES(interestEarned)} tone="success" />
          <StatCard
            label="Total Liabilities"
            value={fmtKES(savings + shareCap + investorCap)}
            tone="accent"
          />
          <StatCard label="Operating Expenses" value={fmtKES(expenses)} tone="warning" />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Revenue vs Expenses (6 months)">
            <div className="p-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="var(--color-success)"
                    strokeWidth={2.5}
                  />
                  <Line
                    type="monotone"
                    dataKey="expenses"
                    stroke="var(--color-destructive)"
                    strokeWidth={2.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="Loan Officer Performance">
            <div className="p-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={officerBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="officer" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                  <Tooltip
                    formatter={(v: number) => fmtKES(v)}
                    contentStyle={{
                      background: "var(--color-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="disbursed" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="collected" fill="var(--color-accent)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        </div>

        <Section title="Balance Sheet Snapshot">
          <div className="grid md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-border">
            <div className="p-5">
              <h3 className="font-display font-semibold mb-3">Assets</h3>
              <Row label="Loans outstanding" v={portfolio} />
              <Row label="Cash & equivalents" v={savings + investorCap - portfolio - expenses} />
              <Row label="Total" v={savings + investorCap - expenses} bold />
            </div>
            <div className="p-5">
              <h3 className="font-display font-semibold mb-3">Liabilities & Equity</h3>
              <Row label="Member savings" v={savings} />
              <Row label="Share capital" v={shareCap} />
              <Row label="Investor capital" v={investorCap} />
              <Row label="Total" v={savings + shareCap + investorCap} bold />
            </div>
          </div>
        </Section>

        <Section title="Transaction Summary by Type">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-right">Count</th>
                <th className="px-5 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                "deposit",
                "withdrawal",
                "loan_disbursement",
                "loan_repayment",
                "share_purchase",
                "petty_cash",
                "investor_contribution",
              ].map((t) => {
                const ts = transactions.filter((x) => x.type === t);
                return (
                  <tr key={t}>
                    <td className="px-5 py-3 capitalize">{t.replace(/_/g, " ")}</td>
                    <td className="px-5 py-3 text-right">{ts.length}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {fmtKES(ts.reduce((s, x) => s + x.amount, 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      </main>
    </>
  );
}

function Row({ label, v, bold }: { label: string; v: number; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between py-2 ${bold ? "border-t border-border mt-2 font-semibold" : ""}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{fmtKES(v)}</span>
    </div>
  );
}
