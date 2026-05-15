import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore, fmtKES, loanSummary } from "@/lib/store";
import { AppHeader } from "@/components/AppHeader";
import { StatCard, Section, Badge, DirectorOnly, RestrictedNotice } from "@/components/ui-bits";
import { Banknote, Users, PiggyBank, TrendingUp, Wallet, PieChart } from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — Sauti Microfinance" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { members, loans, transactions, investors, sharePrice, pettyCash } = useStore();

  const activeLoans = loans.filter((l) => l.status === "active");
  const portfolio = activeLoans.reduce((s, l) => s + loanSummary(l).balance, 0);
  const totalSavings = members.reduce((s, m) => s + m.savingsBalance, 0);
  const totalShares = members.reduce((s, m) => s + m.shares, 0) * sharePrice;
  const investorCapital = investors.reduce((s, i) => s + i.contributed, 0);
  const pettyTotal = pettyCash.reduce((s, p) => s + p.amount, 0);

  // last 6 months series (mock)
  const months = ["Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  const series = months.map((m, i) => ({
    month: m,
    disbursed: 80000 + i * 24000 + (i % 2 ? 15000 : 0),
    repaid: 60000 + i * 22000,
  }));

  const txByType = [
    "deposit",
    "withdrawal",
    "loan_disbursement",
    "loan_repayment",
    "share_purchase",
  ].map((t) => ({
    name: t.replace("_", " "),
    value: transactions.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0),
  }));

  return (
    <>
      <AppHeader
        title="Dashboard"
        subtitle="Operational overview across loans, savings and shares."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <DirectorOnly fallback={<RestrictedNotice label="Company-wide totals are restricted" />}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Link to="/loans" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Loan Portfolio"
                value={fmtKES(portfolio)}
                hint={`${activeLoans.length} active loans`}
                icon={<Banknote className="h-5 w-5" />}
              />
            </Link>
            <Link to="/savings" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Member Savings"
                value={fmtKES(totalSavings)}
                hint={`${members.length} members`}
                icon={<PiggyBank className="h-5 w-5" />}
                tone="success"
              />
            </Link>
            <Link to="/shares" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Share Capital"
                value={fmtKES(totalShares)}
                hint={`${members.reduce((s, m) => s + m.shares, 0)} units @ ${fmtKES(sharePrice)}`}
                icon={<PieChart className="h-5 w-5" />}
                tone="accent"
              />
            </Link>
            <Link to="/investors" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Investor Capital"
                value={fmtKES(investorCapital)}
                hint={`${investors.length} investors`}
                icon={<TrendingUp className="h-5 w-5" />}
                tone="warning"
              />
            </Link>
          </div>
        </DirectorOnly>

        <DirectorOnly>
          <div className="grid lg:grid-cols-3 gap-6">
            <Section title="Disbursements vs Repayments">
              <div className="p-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ left: -10, right: 10, top: 10 }}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
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
                    <Area
                      type="monotone"
                      dataKey="disbursed"
                      stroke="var(--color-primary)"
                      fill="url(#g1)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="repaid"
                      stroke="var(--color-accent)"
                      fill="url(#g2)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Section>

            <Section title="Transaction Mix">
              <div className="p-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={txByType} margin={{ left: -10, right: 10, top: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={10} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="value" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
        </DirectorOnly>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="Recent Transactions">
            <div className="divide-y divide-border">
              {transactions.slice(0, 6).map((t) => {
                const m = members.find((x) => x.id === t.memberId);
                return (
                  <div key={t.id} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <div className="text-sm font-medium capitalize">
                        {t.type.replace(/_/g, " ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.date} · {m?.name ?? t.note ?? "—"}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">{fmtKES(t.amount)}</div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Active Loan Health">
            <div className="divide-y divide-border">
              {activeLoans.map((l) => {
                const m = members.find((x) => x.id === l.memberId);
                const summary = loanSummary(l);
                const pct = Math.min(100, Math.round((l.paid / summary.total) * 100));
                return (
                  <div key={l.id} className="px-5 py-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <div>
                        <div className="text-sm font-medium">
                          {m?.name} <span className="text-xs text-muted-foreground">· {l.id}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtKES(summary.approved)} @ {l.rate}% · {summary.termDays} days
                        </div>
                      </div>
                      <Badge tone={pct > 70 ? "success" : pct > 30 ? "default" : "warning"}>
                        {pct}% paid
                      </Badge>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <DirectorOnly>
          <div className="grid sm:grid-cols-3 gap-4">
            <Link to="/pettycash" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Petty Cash Spent"
                value={fmtKES(pettyTotal)}
                hint={`${pettyCash.length} entries this month`}
                icon={<Wallet className="h-5 w-5" />}
                tone="warning"
              />
            </Link>
            <Link to="/members" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Members"
                value={members.length}
                hint={`${members.filter((m) => m.status === "active").length} active`}
                icon={<Users className="h-5 w-5" />}
              />
            </Link>
            <Link to="/loans" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Avg. Loan Size"
                value={fmtKES(
                  activeLoans.length
                    ? Math.round(
                        activeLoans.reduce((s, l) => s + l.principal, 0) / activeLoans.length,
                      )
                    : 0,
                )}
                icon={<Banknote className="h-5 w-5" />}
                tone="accent"
              />
            </Link>
          </div>
        </DirectorOnly>
      </main>
    </>
  );
}
