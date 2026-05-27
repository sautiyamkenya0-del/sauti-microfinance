import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import { useStore, fmtKES, hasMemberTag, isMemberCategory, loanPenaltySummary } from "@/lib/store";
import { listAllCarryoverLoans } from "@/lib/runtime-data.functions";
import { summarizeLegacyCarryoverLoan, type LegacyCarryoverLoan } from "@/lib/legacy-finance";
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
  head: () => ({ meta: [{ title: "Dashboard - Sauti Microfinance" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { members, loans, transactions, investors, sharePrice, pettyCash, policySettings } =
    useStore();
  const loadCarryoverLoans = useServerFn(listAllCarryoverLoans);
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);
  const memberAccounts = members.filter(
    (member) =>
      isMemberCategory(member.category) ||
      hasMemberTag(member.memberTags, "member", member.category),
  );

  useEffect(() => {
    loadCarryoverLoans()
      .then((rows) => setCarryoverLoans(rows as LegacyCarryoverLoan[]))
      .catch(() => setCarryoverLoans([]));
  }, [loadCarryoverLoans]);

  const liveLoanHealth = useMemo(
    () =>
      loans
        .filter((loan) => loan.status !== "pending" && loan.status !== "rejected")
        .map((loan) => ({
          key: loan.id,
          loanId: loan.id,
          memberId: loan.memberId,
          label: loan.loanKind ?? "financial",
          approved: loan.principal,
          termDays: loan.termDays,
          paid: loan.paid,
          total: loanPenaltySummary(loan, transactions).totalExpectedCollected,
          balance: loanPenaltySummary(loan, transactions).totalOwedNow,
          rate: loan.rate,
        }))
        .filter((row) => row.balance > 0),
    [loans, transactions],
  );
  const carryoverLoanHealth = useMemo(
    () =>
      carryoverLoans
        .map((loan) => {
          const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
          return {
            key: `carryover-${loan.id}`,
            loanId: loan.id,
            memberId: loan.memberId,
            label: `${loan.loanKind ?? "financial"} carryover`,
            approved: loan.principal,
            termDays: summary.termDays,
            paid: loan.paidToDate,
            total: summary.totalExpectedCollected,
            balance: summary.totalOwedNow,
            rate: summary.ratePct,
          };
        })
        .filter((row) => row.balance > 0),
    [carryoverLoans, policySettings],
  );
  const activeLoanRows = [...liveLoanHealth, ...carryoverLoanHealth];
  const portfolio = activeLoanRows.reduce((s, l) => s + l.balance, 0);
  const totalSavings = memberAccounts.reduce((s, m) => s + m.savingsBalance, 0);
  const totalShares = memberAccounts.reduce((s, m) => s + m.shares, 0) * sharePrice;
  const investorCapital = investors.reduce((s, i) => s + i.contributed, 0);
  const pettyTotal = pettyCash.reduce((s, p) => s + p.amount, 0);

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
                hint={`${activeLoanRows.length} active loans`}
                icon={<Banknote className="h-5 w-5" />}
              />
            </Link>
            <Link to="/savings" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Member Savings"
                value={fmtKES(totalSavings)}
                hint={`${memberAccounts.length} members`}
                icon={<PiggyBank className="h-5 w-5" />}
                tone="success"
              />
            </Link>
            <Link to="/shares" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Share Capital"
                value={fmtKES(totalShares)}
                hint={`${memberAccounts.reduce((s, m) => s + m.shares, 0)} units @ ${fmtKES(sharePrice)}`}
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

        <Section title="Quick Access">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 p-4">
            {[
              {
                to: "/approvals",
                label: "Director approvals",
                hint: "Loans, member requests, supplier follow-through",
              },
              {
                to: "/suppliers",
                label: "Supplier hub",
                hint: "Dispatch, inventory, fuel codes, supplier debt",
              },
              {
                to: "/savings",
                label: "Savings dockets",
                hint: "Compliance contribution, withdrawable and loan savings",
              },
              {
                to: "/withdrawals",
                label: "Withdrawals",
                hint: "Client, supplier, investor and staff outflows",
              },
            ].map((entry) => (
              <Link
                key={entry.to}
                to={entry.to}
                className="rounded-lg border border-border bg-card px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <div className="text-sm font-medium">{entry.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{entry.hint}</div>
              </Link>
            ))}
          </div>
        </Section>

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
                        {t.date} / {m?.name ?? t.note ?? "-"}
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
              {activeLoanRows.slice(0, 8).map((l) => {
                const m = members.find((x) => x.id === l.memberId);
                const pct = Math.min(100, Math.round((l.paid / Math.max(1, l.total)) * 100));
                return (
                  <div key={l.key} className="px-5 py-3">
                    <div className="flex justify-between items-center mb-1.5">
                      <div>
                        <div className="text-sm font-medium">
                          {m?.name}{" "}
                          <span className="text-xs text-muted-foreground">/ {l.loanId}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {fmtKES(l.approved)} @ {l.rate}% / {l.termDays} days / {l.label}
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
              {activeLoanRows.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No active loan balances found.
                </div>
              ) : null}
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
                value={memberAccounts.length}
                hint={`${memberAccounts.filter((m) => m.status === "active").length} active`}
                icon={<Users className="h-5 w-5" />}
              />
            </Link>
            <Link to="/loans" className="block hover:scale-[1.01] transition-transform">
              <StatCard
                label="Avg. Loan Size"
                value={fmtKES(
                  activeLoanRows.length
                    ? Math.round(
                        activeLoanRows.reduce((s, l) => s + l.approved, 0) / activeLoanRows.length,
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
