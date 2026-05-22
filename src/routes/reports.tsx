import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import {
  fmtKES,
  isMemberCategory,
  loanSummary,
  sbcDeductions,
  transactionFeeAmountForLoan,
  useStore,
} from "@/lib/store";
import { createReportSnapshotRecord } from "@/lib/app-data.functions";
import {
  summarizeLegacyCarryoverLoan,
  type LegacyCarryoverLoan,
  type ReportSnapshot,
} from "@/lib/legacy-finance";
import { listAllCarryoverLoans, listReportSnapshots } from "@/lib/runtime-data.functions";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCallback, useEffect, useState } from "react";
import { Building2, Download, RefreshCw, Save, Scale, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports - Sauti Microfinance" }] }),
  component: ReportsPage,
});

type BookRow = {
  key: string;
  label: string;
  count: number;
  amount: number;
  note: string;
};

const PURPOSE_POOL_DISTRIBUTION = [
  {
    key: "levies_permits",
    label: "Levies & Permits Fund",
    pct: 35,
    purpose: "Enables members to pay business permits flexibly.",
  },
  {
    key: "biashara_boost",
    label: "Biashara Boost",
    pct: 20,
    purpose: "Business growth and expansion.",
  },
  {
    key: "welfare",
    label: "Welfare Fund",
    pct: 10,
    purpose: "Emergencies such as accidents, sickness, and funerals.",
  },
  {
    key: "legal",
    label: "Legal Fund",
    pct: 15,
    purpose: "Legal aid and representation.",
  },
  {
    key: "operations_admin",
    label: "Operations/Admin",
    pct: 20,
    purpose: "Running SBC, staff, IT systems, and growth.",
  },
];

function ReportsPage() {
  const saveReportSnapshot = useServerFn(createReportSnapshotRecord);
  const loadSnapshots = useServerFn(listReportSnapshots);
  const loadCarryoverLoans = useServerFn(listAllCarryoverLoans);
  const {
    loans,
    members,
    transactions,
    pettyCash,
    investors,
    sharePrice,
    penalties,
    roundOff,
    staff,
    policySettings,
  } = useStore();
  const [snapshots, setSnapshots] = useState<ReportSnapshot[]>([]);
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [purposePoolMemberId, setPurposePoolMemberId] = useState("");

  const refreshSnapshots = useCallback(async () => {
    try {
      setSnapshots(await loadSnapshots());
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load archived report snapshots.");
    }
  }, [loadSnapshots]);

  useEffect(() => {
    refreshSnapshots().catch(() => {});
  }, [refreshSnapshots]);

  const refreshCarryoverLoans = useCallback(async () => {
    try {
      setCarryoverLoans((await loadCarryoverLoans()) as LegacyCarryoverLoan[]);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load carryover loans.");
    }
  }, [loadCarryoverLoans]);

  useEffect(() => {
    refreshCarryoverLoans().catch(() => {});
  }, [refreshCarryoverLoans]);

  const memberAccounts = members.filter((member) => isMemberCategory(member.category));
  const disbursedLoans = loans.filter(
    (loan) => loan.status !== "pending" && loan.status !== "rejected",
  );
  const carryoverLoanRows = carryoverLoans.map((loan) => ({
    loan,
    summary: summarizeLegacyCarryoverLoan(loan, policySettings),
  }));
  const openCarryoverLoanRows = carryoverLoanRows.filter(
    ({ loan, summary }) => loan.status !== "closed" && !summary.isFinished,
  );
  const activeLoans = loans.filter((loan) => loan.status === "active");
  const feeTransactions = transactions.filter((transaction) => transaction.type === "fee_payment");
  const purposePoolTransactions = feeTransactions.filter((transaction) =>
    String(transaction.note ?? "")
      .toLowerCase()
      .includes("purpose pool"),
  );
  const mandatoryFeeTransactions = feeTransactions.filter(
    (transaction) =>
      !String(transaction.note ?? "")
        .toLowerCase()
        .includes("purpose pool"),
  );
  const paidPenalties = penalties.filter((penalty) => penalty.status === "paid");
  const outstandingPenalties = penalties.filter((penalty) => penalty.status === "outstanding");

  const portfolio =
    activeLoans.reduce((sum, loan) => sum + loanSummary(loan).balance, 0) +
    openCarryoverLoanRows.reduce((sum, row) => sum + row.summary.totalOwedNow, 0);
  const memberSavings = memberAccounts.reduce((sum, member) => sum + member.savingsBalance, 0);
  const shareCap = memberAccounts.reduce((sum, member) => sum + member.shares, 0) * sharePrice;
  const investorCap = investors.reduce((sum, investor) => sum + investor.contributed, 0);
  const expenses = pettyCash.reduce((sum, entry) => sum + entry.amount, 0);

  const liveInterestEarned = disbursedLoans.reduce((sum, loan) => {
    const summary = loanSummary(loan);
    const paidRatio = summary.total > 0 ? Math.min(1, loan.paid / summary.total) : 0;
    return sum + summary.interest * paidRatio;
  }, 0);
  const carryoverInterestEarned = carryoverLoanRows.reduce((sum, row) => {
    const paidRatio =
      row.summary.totalRepayment > 0
        ? Math.min(1, row.loan.paidToDate / row.summary.totalRepayment)
        : 0;
    return sum + row.summary.interest * paidRatio;
  }, 0);
  const interestEarned = liveInterestEarned + carryoverInterestEarned;
  const processingFees =
    disbursedLoans.reduce((sum, loan) => {
      const principal = loan.approvedAmount ?? loan.principal;
      return sum + sbcDeductions(principal).processing;
    }, 0) + carryoverLoans.reduce((sum, loan) => sum + sbcDeductions(loan.principal).processing, 0);
  const insuranceFees =
    disbursedLoans.reduce((sum, loan) => {
      const principal = loan.approvedAmount ?? loan.principal;
      return sum + sbcDeductions(principal).insurance;
    }, 0) + carryoverLoans.reduce((sum, loan) => sum + sbcDeductions(loan.principal).insurance, 0);
  const transactionCostFees =
    disbursedLoans.reduce((sum, loan) => {
      const principal = loan.approvedAmount ?? loan.principal;
      return sum + (loan.transactionFeeAmount ?? transactionFeeAmountForLoan(principal));
    }, 0) +
    carryoverLoans.reduce((sum, loan) => sum + transactionFeeAmountForLoan(loan.principal), 0);
  const transactionFees = processingFees + insuranceFees + transactionCostFees;
  const mandatoryFees = mandatoryFeeTransactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const purposePoolRevenue = purposePoolTransactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const filteredPurposePoolTransactions = purposePoolMemberId
    ? purposePoolTransactions.filter((transaction) => transaction.memberId === purposePoolMemberId)
    : purposePoolTransactions;
  const filteredPurposePoolRevenue = filteredPurposePoolTransactions.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const purposePoolRows = PURPOSE_POOL_DISTRIBUTION.map((row) => ({
    ...row,
    totalAmount: (purposePoolRevenue * row.pct) / 100,
    filteredAmount: (filteredPurposePoolRevenue * row.pct) / 100,
  }));
  const roundOffRevenue = roundOff.reduce((sum, entry) => sum + entry.amount, 0);
  const dailyPenaltyRevenue = paidPenalties
    .filter((penalty) => classifyPenalty(penalty.reason) === "daily")
    .reduce((sum, penalty) => sum + penalty.amount, 0);
  const dueDatePenaltyRevenue = paidPenalties
    .filter((penalty) => classifyPenalty(penalty.reason) === "due_date")
    .reduce((sum, penalty) => sum + penalty.amount, 0);
  const penaltiesCollected = dailyPenaltyRevenue + dueDatePenaltyRevenue;
  const outstandingPenaltyAmount = outstandingPenalties.reduce(
    (sum, penalty) => sum + penalty.amount,
    0,
  );

  const totalRevenue =
    interestEarned +
    transactionFees +
    mandatoryFees +
    purposePoolRevenue +
    penaltiesCollected +
    roundOffRevenue;
  const netOperating = totalRevenue - expenses;
  const liabilities = memberSavings + shareCap + investorCap;

  const companyBookRows: BookRow[] = [
    {
      key: "interest",
      label: "Interest earned",
      count: disbursedLoans.length + carryoverLoans.length,
      amount: interestEarned,
      note: "Recognized from the paid portion of live and carryover loans.",
    },
    {
      key: "transaction_fees",
      label: "Transaction fees",
      count: disbursedLoans.length + carryoverLoans.length,
      amount: transactionFees,
      note: "Processing, insurance, and transaction-cost deductions on live and carryover loans.",
    },
    {
      key: "mandatory_fees",
      label: "Mandatory fees",
      count: mandatoryFeeTransactions.length,
      amount: mandatoryFees,
      note: "Membership, card, sticker, and related fee payments.",
    },
    {
      key: "purpose_pool",
      label: "Purpose pool",
      count: purposePoolTransactions.length,
      amount: purposePoolRevenue,
      note: "Internal purpose-pool contributions separated from direct fee income.",
    },
    {
      key: "daily_penalties",
      label: "Daily penalties",
      count: paidPenalties.filter((penalty) => classifyPenalty(penalty.reason) === "daily").length,
      amount: dailyPenaltyRevenue,
      note: "Paid penalties inside the normal loan cycle.",
    },
    {
      key: "due_date_penalties",
      label: "Due-date penalties",
      count: paidPenalties.filter((penalty) => classifyPenalty(penalty.reason) === "due_date")
        .length,
      amount: dueDatePenaltyRevenue,
      note: "Paid penalties inferred as post-due-date or default penalties.",
    },
    {
      key: "round_off",
      label: "Round-offs",
      count: roundOff.length,
      amount: roundOffRevenue,
      note: "Rounding surplus captured in the round-off pool.",
    },
  ];

  const feeBookRows: BookRow[] = [
    {
      key: "processing_fees",
      label: "Processing fees",
      count: disbursedLoans.length + carryoverLoans.length,
      amount: processingFees,
      note: "Loan processing fees earned on live and carryover disbursements.",
    },
    {
      key: "insurance_fees",
      label: "Insurance fees",
      count: disbursedLoans.length + carryoverLoans.length,
      amount: insuranceFees,
      note: "Insurance deductions earned on live and carryover disbursements.",
    },
    {
      key: "transaction_cost_fees",
      label: "Transaction cost fees",
      count: disbursedLoans.length + carryoverLoans.length,
      amount: transactionCostFees,
      note: "Transaction-cost deductions earned on live and carryover disbursements.",
    },
    {
      key: "mandatory_fee_payments",
      label: "Membership and sticker fees",
      count: mandatoryFeeTransactions.length,
      amount: mandatoryFees,
      note: "Collected through fee-payment transactions.",
    },
    {
      key: "purpose_pool_income",
      label: "Purpose pool contributions",
      count: purposePoolTransactions.length,
      amount: purposePoolRevenue,
      note: "Amounts routed above the mandatory savings and shares thresholds.",
    },
    {
      key: "round_off_income",
      label: "Round-off income",
      count: roundOff.length,
      amount: roundOffRevenue,
      note: "Small rounding surpluses retained by the company.",
    },
  ];

  const penaltyBookRows: BookRow[] = [
    {
      key: "daily_penalty_book",
      label: "Daily penalties collected",
      count: paidPenalties.filter((penalty) => classifyPenalty(penalty.reason) === "daily").length,
      amount: dailyPenaltyRevenue,
      note: "Penalties collected before the loan tips into default behavior.",
    },
    {
      key: "due_penalty_book",
      label: "Due-date penalties collected",
      count: paidPenalties.filter((penalty) => classifyPenalty(penalty.reason) === "due_date")
        .length,
      amount: dueDatePenaltyRevenue,
      note: "Penalties collected after due date or default wording is detected.",
    },
    {
      key: "outstanding_penalties",
      label: "Outstanding penalties",
      count: outstandingPenalties.length,
      amount: outstandingPenaltyAmount,
      note: "Open penalty exposure still waiting for collection.",
    },
  ];

  const monthly = buildMonthlyBook({
    loans: disbursedLoans,
    carryoverLoans,
    policySettings,
    transactions,
    penalties: paidPenalties,
    roundOff,
    pettyCash,
  });
  const officerBreakdown = summarizeOfficerPerformance(loans, staff);
  const transactionSummary = [
    "deposit",
    "withdrawal",
    "loan_disbursement",
    "loan_repayment",
    "share_purchase",
    "petty_cash",
    "investor_contribution",
    "fee_payment",
  ].map((type) => {
    const rows = transactions.filter((transaction) => transaction.type === type);
    return {
      type,
      count: rows.length,
      total: rows.reduce((sum, transaction) => sum + transaction.amount, 0),
    };
  });

  return (
    <>
      <AppHeader
        title="Reports"
        subtitle="Full company book for revenue, penalties, fees, round-offs, and portfolio health."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="admin" />

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total Revenue"
            value={fmtKES(totalRevenue)}
            icon={<TrendingUp className="h-5 w-5" />}
          />
          <StatCard
            label="Net Operating"
            value={fmtKES(netOperating)}
            icon={<Scale className="h-5 w-5" />}
            tone={netOperating >= 0 ? "success" : "destructive"}
          />
          <StatCard
            label="Outstanding Portfolio"
            value={fmtKES(portfolio)}
            icon={<Building2 className="h-5 w-5" />}
            tone="accent"
          />
          <StatCard
            label="Operating Expenses"
            value={fmtKES(expenses)}
            icon={<Wallet className="h-5 w-5" />}
            tone="warning"
          />
        </div>

        <BookTable
          title="Company Book"
          rows={companyBookRows}
          totalLabel="Total revenue"
          totalCount={companyBookRows.reduce((sum, row) => sum + row.count, 0)}
          totalAmount={totalRevenue}
          totalNote="Combined company income across loans, fees, penalties, and round-offs."
          footer="Due-date penalties are inferred from penalty reason text until a dedicated penalty-type field is added to the database."
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <BookTable
            title="Fees Book"
            rows={feeBookRows}
            totalLabel="Total fee income"
            totalCount={feeBookRows.reduce((sum, row) => sum + row.count, 0)}
            totalAmount={feeBookRows.reduce((sum, row) => sum + row.amount, 0)}
            totalNote="Processing, insurance, mandatory fees, and round-off income."
          />
          <BookTable
            title="Penalty Book"
            rows={penaltyBookRows}
            totalLabel="Collected penalties"
            totalCount={penaltyBookRows
              .filter((row) => row.key !== "outstanding_penalties")
              .reduce((sum, row) => sum + row.count, 0)}
            totalAmount={penaltiesCollected}
            totalNote="Daily plus due-date penalties that are already paid."
          />
        </div>

        <Section
          title="Purpose Pool Distribution"
          action={
            <select
              value={purposePoolMemberId}
              onChange={(event) => setPurposePoolMemberId(event.target.value)}
              className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs"
            >
              <option value="">All clients</option>
              {memberAccounts.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.id} - {member.name}
                </option>
              ))}
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Allocation</th>
                  <th className="px-5 py-3 text-right">% of Pool</th>
                  <th className="px-5 py-3 text-right">All Clients</th>
                  <th className="px-5 py-3 text-right">Filtered Client</th>
                  <th className="px-5 py-3 text-left">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purposePoolRows.map((row) => (
                  <tr key={row.key}>
                    <td className="px-5 py-3 font-medium">{row.label}</td>
                    <td className="px-5 py-3 text-right">{row.pct}%</td>
                    <td className="px-5 py-3 text-right">{fmtKES(row.totalAmount)}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(row.filteredAmount)}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-medium">
                <tr>
                  <td className="px-5 py-3">Total purpose pool</td>
                  <td className="px-5 py-3 text-right">100%</td>
                  <td className="px-5 py-3 text-right">{fmtKES(purposePoolRevenue)}</td>
                  <td className="px-5 py-3 text-right">{fmtKES(filteredPurposePoolRevenue)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    Filter a client to view their Biashara Boost and other pool slices.
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Monthly Revenue vs Expenses">
            <div className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => fmtKES(value)}
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
            <div className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={officerBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="officer" stroke="var(--color-muted-foreground)" fontSize={12} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} />
                  <Tooltip
                    formatter={(value: number) => fmtKES(value)}
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

        <Section
          title="Archive snapshots"
          action={
            <div className="flex gap-2">
              <button
                onClick={() => void refreshSnapshots()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
              <button
                disabled={savingSnapshot}
                onClick={async () => {
                  try {
                    setSavingSnapshot(true);
                    const window = snapshotWindow();
                    await saveReportSnapshot({
                      data: {
                        title: `Reports snapshot ${new Date().toISOString().slice(0, 10)}`,
                        periodStart: window.start,
                        periodEnd: window.end,
                        filters: { source: "reports-page" },
                        summary: {
                          totalRevenue,
                          netOperating,
                          portfolio,
                          expenses,
                          memberSavings,
                          shareCap,
                          investorCap,
                          liabilities,
                          companyBookRows,
                          feeBookRows,
                          penaltyBookRows,
                          transactionSummary,
                          purposePoolRows,
                          purposePoolMemberId,
                        },
                        chartData: {
                          monthly,
                          officerBreakdown,
                        },
                      },
                    });
                    await refreshSnapshots();
                    toast.success("Report snapshot archived");
                  } catch (error: any) {
                    toast.error(error?.message ?? "Failed to archive the report snapshot.");
                  } finally {
                    setSavingSnapshot(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {savingSnapshot ? "Saving..." : "Archive current charts"}
              </button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Snapshot</th>
                  <th className="px-5 py-3 text-left">Period</th>
                  <th className="px-5 py-3 text-left">Created</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {snapshots.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted-foreground">
                      No archived report snapshots yet.
                    </td>
                  </tr>
                )}
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{snapshot.title}</div>
                      <div className="text-xs text-muted-foreground">{snapshot.reportKey}</div>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {snapshot.periodStart} {"->"} {snapshot.periodEnd}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {snapshot.createdAt}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => downloadReportSnapshot(snapshot)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download JSON
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
            Snapshots store compact report totals plus chart data, which keeps Supabase egress lower
            than archiving rendered images while still giving you a durable download years later.
          </div>
        </Section>

        <Section title="Balance Sheet Snapshot">
          <div className="grid divide-border gap-0 md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-5">
              <h3 className="mb-3 font-display font-semibold">Assets</h3>
              <Row label="Loans outstanding" value={portfolio} />
              <Row label="Round-off pool" value={roundOffRevenue} />
              <Row label="Cash after expenses" value={Math.max(0, totalRevenue - expenses)} />
              <Row
                label="Total assets"
                value={portfolio + roundOffRevenue + Math.max(0, totalRevenue - expenses)}
                bold
              />
            </div>
            <div className="p-5">
              <h3 className="mb-3 font-display font-semibold">Liabilities and Equity</h3>
              <Row label="Member savings" value={memberSavings} />
              <Row label="Share capital" value={shareCap} />
              <Row label="Investor capital" value={investorCap} />
              <Row label="Total liabilities and equity" value={liabilities} bold />
            </div>
          </div>
        </Section>

        <Section title="Transaction Summary by Type">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left">Type</th>
                <th className="px-5 py-3 text-right">Count</th>
                <th className="px-5 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactionSummary.map((row) => (
                <tr key={row.type}>
                  <td className="px-5 py-3 capitalize">{row.type.replace(/_/g, " ")}</td>
                  <td className="px-5 py-3 text-right">{row.count}</td>
                  <td className="px-5 py-3 text-right font-semibold">{fmtKES(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </main>
    </>
  );
}

function snapshotWindow() {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date();
  start.setDate(1);
  start.setMonth(start.getMonth() - 5);
  return {
    start: start.toISOString().slice(0, 10),
    end,
  };
}

function downloadReportSnapshot(snapshot: ReportSnapshot) {
  const payload = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${snapshot.reportKey}-${snapshot.periodStart}-to-${snapshot.periodEnd}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function BookTable({
  title,
  rows,
  totalLabel,
  totalCount,
  totalAmount,
  totalNote,
  footer,
}: {
  title: string;
  rows: BookRow[];
  totalLabel: string;
  totalCount: number;
  totalAmount: number;
  totalNote: string;
  footer?: string;
}) {
  return (
    <Section title={title}>
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Line</th>
            <th className="px-5 py-3 text-right">Entries</th>
            <th className="px-5 py-3 text-right">Amount</th>
            <th className="px-5 py-3 text-left">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="px-5 py-3 font-medium">{row.label}</td>
              <td className="px-5 py-3 text-right">{row.count}</td>
              <td className="px-5 py-3 text-right font-semibold">{fmtKES(row.amount)}</td>
              <td className="px-5 py-3 text-xs text-muted-foreground">{row.note}</td>
            </tr>
          ))}
          <tr className="bg-muted/20">
            <td className="px-5 py-3 font-semibold">{totalLabel}</td>
            <td className="px-5 py-3 text-right font-semibold">{totalCount}</td>
            <td className="px-5 py-3 text-right font-semibold">{fmtKES(totalAmount)}</td>
            <td className="px-5 py-3 text-xs text-muted-foreground">{totalNote}</td>
          </tr>
        </tbody>
      </table>
      {footer ? (
        <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Section>
  );
}

function classifyPenalty(reason: string) {
  const normalized = reason.trim().toLowerCase();
  if (normalized.includes("due") || normalized.includes("default")) return "due_date";
  return "daily";
}

function buildMonthlyBook(args: {
  loans: ReturnType<typeof useStore>["loans"];
  carryoverLoans: LegacyCarryoverLoan[];
  policySettings: ReturnType<typeof useStore>["policySettings"];
  transactions: ReturnType<typeof useStore>["transactions"];
  penalties: ReturnType<typeof useStore>["penalties"];
  roundOff: ReturnType<typeof useStore>["roundOff"];
  pettyCash: ReturnType<typeof useStore>["pettyCash"];
}) {
  const monthKeys = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - (5 - index));
    return date.toISOString().slice(0, 7);
  });

  const book = Object.fromEntries(
    monthKeys.map((key) => [
      key,
      {
        month: monthLabel(key),
        revenue: 0,
        expenses: 0,
      },
    ]),
  ) as Record<string, { month: string; revenue: number; expenses: number }>;

  args.loans.forEach((loan) => {
    const key = loan.startDate.slice(0, 7);
    if (!book[key]) return;
    const summary = loanSummary(loan);
    const deductions = sbcDeductions(loan.approvedAmount ?? loan.principal);
    book[key].revenue += summary.interest;
    book[key].revenue += deductions.total;
  });

  args.carryoverLoans.forEach((loan) => {
    const key = loan.startDate.slice(0, 7);
    if (!book[key]) return;
    const summary = summarizeLegacyCarryoverLoan(loan, args.policySettings);
    const paidRatio =
      summary.totalRepayment > 0 ? Math.min(1, loan.paidToDate / summary.totalRepayment) : 0;
    book[key].revenue += summary.interest * paidRatio;
    book[key].revenue += sbcDeductions(loan.principal).total;
  });

  args.transactions
    .filter((transaction) => transaction.type === "fee_payment")
    .forEach((transaction) => {
      const key = transaction.date.slice(0, 7);
      if (book[key]) book[key].revenue += transaction.amount;
    });

  args.penalties.forEach((penalty) => {
    const key = penalty.date.slice(0, 7);
    if (book[key]) book[key].revenue += penalty.amount;
  });

  args.roundOff.forEach((entry) => {
    const key = entry.date.slice(0, 7);
    if (book[key]) book[key].revenue += entry.amount;
  });

  args.pettyCash.forEach((entry) => {
    const key = entry.date.slice(0, 7);
    if (book[key]) book[key].expenses += entry.amount;
  });

  return monthKeys.map((key) => book[key]);
}

function summarizeOfficerPerformance(
  loans: ReturnType<typeof useStore>["loans"],
  staff: ReturnType<typeof useStore>["staff"],
) {
  const officerIds = Array.from(new Set(loans.map((loan) => loan.officerId).filter(Boolean)));
  return officerIds.map((officerId) => {
    const officerLoans = loans.filter((loan) => loan.officerId === officerId);
    const officerName = staff.find((member) => member.id === officerId)?.name ?? officerId;
    return {
      officer: officerName,
      disbursed: officerLoans.reduce(
        (sum, loan) => sum + (loan.approvedAmount ?? loan.principal),
        0,
      ),
      collected: officerLoans.reduce((sum, loan) => sum + loan.paid, 0),
    };
  });
}

function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-KE", { month: "short" }).format(new Date(year, month - 1, 1));
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div
      className={`flex justify-between py-2 ${bold ? "mt-2 border-t border-border font-semibold" : ""}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{fmtKES(value)}</span>
    </div>
  );
}
