import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore, fmtKES, loanSummary } from "@/lib/store";
import { AppHeader } from "@/components/AppHeader";
import { StatCard, Section, Badge, DirectorOnly, RestrictedNotice } from "@/components/ui-bits";
import {
  Activity,
  ArrowUpRight,
  Banknote,
  PiggyBank,
  PieChart,
  Radar,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard - Sauti Microfinance" }] }),
  component: Dashboard,
});

function TelemetryReadout({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/[0.02] p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="data-readout mt-2 text-xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Dashboard() {
  const { members, loans, transactions, investors, sharePrice, pettyCash } = useStore();

  const activeMembers = members.filter((member) => member.status === "active").length;
  const activeLoans = loans.filter((loan) => loan.status === "active");
  const portfolio = activeLoans.reduce((sum, loan) => sum + loanSummary(loan).balance, 0);
  const totalSavings = members.reduce((sum, member) => sum + member.savingsBalance, 0);
  const totalShares = members.reduce((sum, member) => sum + member.shares, 0) * sharePrice;
  const investorCapital = investors.reduce((sum, investor) => sum + investor.contributed, 0);
  const pettyTotal = pettyCash.reduce((sum, item) => sum + item.amount, 0);
  const recoveryRate = activeLoans.length
    ? Math.round(
        (activeLoans.reduce((sum, loan) => sum + loan.paid / loanSummary(loan).total, 0) /
          activeLoans.length) *
          100,
      )
    : 0;
  const latestLedgerStamp = transactions[0]?.date ?? "No activity";
  const capitalBuffer = totalSavings + totalShares + investorCapital - portfolio;

  const months = ["Dec", "Jan", "Feb", "Mar", "Apr", "May"];
  const series = months.map((month, index) => ({
    month,
    disbursed: 80000 + index * 24000 + (index % 2 ? 15000 : 0),
    repaid: 60000 + index * 22000,
  }));

  const txByType = [
    "deposit",
    "withdrawal",
    "loan_disbursement",
    "loan_repayment",
    "share_purchase",
  ].map((type) => ({
    name: type.replace(/_/g, " "),
    value: transactions
      .filter((transaction) => transaction.type === type)
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  }));
  const maxTxValue = Math.max(...txByType.map((item) => item.value), 1);

  return (
    <>
      <AppHeader
        title="Dashboard"
        subtitle="A high-density command view across lending, savings, shares, and cash movement."
      />
      <main className="flex-1 space-y-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <section className="surface-panel overflow-hidden rounded-sm">
          <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]">
            <div className="rounded-sm border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent_90%)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Command Center
                </div>
                <Badge tone="default">Live stack</Badge>
              </div>
              <div className="mt-4 max-w-3xl">
                <h2 className="text-2xl font-semibold text-foreground sm:text-[2rem]">
                  Portfolio telemetry, ledger motion, and member activity framed like an instrument
                  cluster instead of a generic admin screen.
                </h2>
                <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                  The view below prioritizes capital flow, lending pressure, and transaction rhythm
                  so approvals and cash decisions feel immediate.
                </p>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <TelemetryReadout
                  label="Active Members"
                  value={activeMembers.toLocaleString()}
                  hint={`${members.length.toLocaleString()} total registered`}
                />
                <TelemetryReadout
                  label="Open Loans"
                  value={activeLoans.length.toLocaleString()}
                  hint={`${recoveryRate}% mean repayment progress`}
                />
                <TelemetryReadout
                  label="Ledger Events"
                  value={transactions.length.toLocaleString()}
                  hint={`Latest stamp ${latestLedgerStamp}`}
                />
              </div>
            </div>

            <div className="grid gap-3">
              <TelemetryReadout
                label="Capital Buffer"
                value={fmtKES(capitalBuffer)}
                hint="Savings + shares + investor float minus live portfolio exposure"
              />
              <TelemetryReadout
                label="Petty Cash Draw"
                value={fmtKES(pettyTotal)}
                hint={`${pettyCash.length} operating entries captured`}
              />
              <TelemetryReadout
                label="Investor Rail"
                value={fmtKES(investorCapital)}
                hint={`${investors.length} investor accounts funding the system`}
              />
            </div>
          </div>
        </section>

        <DirectorOnly
          fallback={<RestrictedNotice label="Company-wide capital totals are restricted" />}
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Link to="/loans" className="block">
              <StatCard
                label="Loan Portfolio"
                value={fmtKES(portfolio)}
                hint={`${activeLoans.length} live accounts under management`}
                icon={<Banknote className="h-5 w-5" />}
              />
            </Link>
            <Link to="/savings" className="block">
              <StatCard
                label="Member Savings"
                value={fmtKES(totalSavings)}
                hint={`${activeMembers} active savers on the rail`}
                icon={<PiggyBank className="h-5 w-5" />}
                tone="success"
              />
            </Link>
            <Link to="/shares" className="block">
              <StatCard
                label="Share Capital"
                value={fmtKES(totalShares)}
                hint={`${members.reduce((sum, member) => sum + member.shares, 0)} units at ${fmtKES(sharePrice)}`}
                icon={<PieChart className="h-5 w-5" />}
                tone="accent"
              />
            </Link>
            <Link to="/investors" className="block">
              <StatCard
                label="Investor Capital"
                value={fmtKES(investorCapital)}
                hint="External liquidity backing active operations"
                icon={<TrendingUp className="h-5 w-5" />}
                tone="warning"
              />
            </Link>
          </div>
        </DirectorOnly>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.95fr)]">
          <DirectorOnly>
            <Section
              title="Portfolio Flow"
              action={
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                  Six-month signal model
                </div>
              }
            >
              <div className="p-5">
                <div className="rounded-sm border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(45,212,191,0.12),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_88%)] p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Disbursements vs collections
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Radial glow highlights the primary lending rail and repayment catch-up.
                      </div>
                    </div>
                    <Badge tone="accent">Telemetry view</Badge>
                  </div>
                  <div className="h-[22rem]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={series}
                        margin={{ left: -10, right: 10, top: 10, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="portfolio-disbursed" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.42} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="portfolio-repaid" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.36} />
                            <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgb(226 232 240 / 0.08)" vertical={false} />
                        <XAxis
                          dataKey="month"
                          stroke="var(--color-muted-foreground)"
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                        />
                        <YAxis
                          stroke="var(--color-muted-foreground)"
                          tickLine={false}
                          axisLine={false}
                          fontSize={11}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-popover)",
                            border: "1px solid rgb(255 255 255 / 0.08)",
                            borderRadius: 4,
                          }}
                          formatter={(value: number) => fmtKES(Number(value))}
                        />
                        <Area
                          type="monotone"
                          dataKey="disbursed"
                          stroke="var(--color-primary)"
                          fill="url(#portfolio-disbursed)"
                          strokeWidth={2}
                        />
                        <Area
                          type="monotone"
                          dataKey="repaid"
                          stroke="var(--color-chart-2)"
                          fill="url(#portfolio-repaid)"
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </Section>
          </DirectorOnly>

          <Section
            title="Signal Matrix"
            action={
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Radar className="h-3.5 w-3.5 text-primary" />
                Transaction mix
              </div>
            }
          >
            <div className="space-y-4 p-5">
              {txByType.map((item) => (
                <div key={item.name} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {item.name}
                    </div>
                    <div className="data-readout text-xs text-foreground">{fmtKES(item.value)}</div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary/75 via-primary to-white/85 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{
                        width: `${Math.max(8, Math.round((item.value / maxTxValue) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}

              <div className="grid gap-3 pt-2 sm:grid-cols-2 xl:grid-cols-1">
                <TelemetryReadout
                  label="Share Price"
                  value={fmtKES(sharePrice)}
                  hint="Reference multiplier used in member equity calculations"
                />
                <TelemetryReadout
                  label="Recovery Bias"
                  value={`${recoveryRate}%`}
                  hint="Mean repayment completion across active loans"
                />
              </div>
            </div>
          </Section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section
            title="Recent Transactions"
            action={
              <Link
                to="/transactions"
                className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:text-foreground"
              >
                View ledger <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            <div className="divide-y divide-white/6">
              {transactions.slice(0, 6).map((transaction) => {
                const member = members.find((item) => item.id === transaction.memberId);
                return (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="telemetry-dot telemetry-dot-online mt-1 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium capitalize text-foreground">
                          {transaction.type.replace(/_/g, " ")}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {transaction.date} / {member?.name ?? transaction.note ?? "No reference"}
                        </div>
                      </div>
                    </div>
                    <div className="data-readout text-sm font-semibold text-foreground">
                      {fmtKES(transaction.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Active Loan Health">
            <div className="divide-y divide-white/6">
              {activeLoans.map((loan) => {
                const member = members.find((item) => item.id === loan.memberId);
                const summary = loanSummary(loan);
                const pct = Math.min(100, Math.round((loan.paid / summary.total) * 100));
                return (
                  <div key={loan.id} className="px-5 py-4">
                    <div className="mb-3 flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {member?.name}
                          <span className="data-readout ml-2 text-[11px] text-muted-foreground">
                            {loan.id}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {fmtKES(summary.approved)} @ {loan.rate}% / {summary.termDays} days
                        </div>
                      </div>
                      <Badge tone={pct > 70 ? "success" : pct > 30 ? "default" : "warning"}>
                        {pct}% paid
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary via-primary to-white/80 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="data-readout text-xs text-muted-foreground">
                        {fmtKES(summary.balance)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <DirectorOnly>
          <div className="grid gap-4 sm:grid-cols-3">
            <Link to="/pettycash" className="block">
              <StatCard
                label="Petty Cash Spent"
                value={fmtKES(pettyTotal)}
                hint={`${pettyCash.length} operating entries this month`}
                icon={<Wallet className="h-5 w-5" />}
                tone="warning"
              />
            </Link>
            <Link to="/members" className="block">
              <StatCard
                label="Members"
                value={members.length}
                hint={`${activeMembers} active and visible on the live grid`}
                icon={<Users className="h-5 w-5" />}
              />
            </Link>
            <Link to="/loans" className="block">
              <StatCard
                label="Avg. Loan Size"
                value={fmtKES(
                  activeLoans.length
                    ? Math.round(
                        activeLoans.reduce((sum, loan) => sum + loan.principal, 0) /
                          activeLoans.length,
                      )
                    : 0,
                )}
                hint="Current active-book mean principal"
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
