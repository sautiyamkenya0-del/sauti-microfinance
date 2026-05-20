import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Scale } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, DirectorOnly, Section, StatCard } from "@/components/ui-bits";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/transactions")({
  head: () => ({ meta: [{ title: "Transactions - Sauti Microfinance" }] }),
  component: TxPage,
});

const TYPES = [
  "all",
  "deposit",
  "withdrawal",
  "loan_disbursement",
  "loan_repayment",
  "share_purchase",
  "petty_cash",
  "investor_contribution",
  "fee_payment",
  "mpesa_unallocated",
] as const;

const INFLOWS: ReadonlyArray<string> = [
  "deposit",
  "loan_repayment",
  "share_purchase",
  "investor_contribution",
  "fee_payment",
  "mpesa_unallocated",
];
const OUTFLOWS: ReadonlyArray<string> = ["withdrawal", "loan_disbursement", "petty_cash"];

function TxPage() {
  const { transactions, members, staff } = useStore();
  const [filter, setFilter] = useState<(typeof TYPES)[number]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [memberFilter, setMemberFilter] = useState("");

  const list = useMemo(
    () =>
      transactions.filter((transaction) => {
        if (filter !== "all" && transaction.type !== filter) return false;
        if (from && transaction.date < from) return false;
        if (to && transaction.date > to) return false;
        if (memberFilter && transaction.memberId !== memberFilter) return false;
        return true;
      }),
    [transactions, filter, from, to, memberFilter],
  );

  const totals = useMemo(() => {
    const inflow = list
      .filter((transaction) => INFLOWS.includes(transaction.type))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const outflow = list
      .filter((transaction) => OUTFLOWS.includes(transaction.type))
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    return { inflow, outflow, net: inflow - outflow };
  }, [list]);

  const displayDateTime = (transaction: (typeof transactions)[number]) =>
    transaction.createdAt ? new Date(transaction.createdAt).toLocaleString() : transaction.date;

  return (
    <>
      <AppHeader title="Transactions" subtitle="Unified ledger across all financial activity." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="capital" />
        <DirectorOnly>
          <div className="grid md:grid-cols-3 gap-4">
            <StatCard
              label="Inflow"
              value={fmtKES(totals.inflow)}
              hint="Filtered period"
              icon={<ArrowDownCircle className="h-5 w-5" />}
              tone="success"
            />
            <StatCard
              label="Outflow"
              value={fmtKES(totals.outflow)}
              hint="Filtered period"
              icon={<ArrowUpCircle className="h-5 w-5" />}
              tone="warning"
            />
            <StatCard
              label="Net"
              value={fmtKES(totals.net)}
              hint="Inflow minus outflow"
              icon={<Scale className="h-5 w-5" />}
              tone={totals.net >= 0 ? "success" : "destructive"}
            />
          </div>
        </DirectorOnly>

        <div className="bg-card border border-border rounded-xl p-4 grid md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Member
            </span>
            <select
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            >
              <option value="">All members</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.id} - {member.name}
                </option>
              ))}
            </select>
          </label>
          <div />
        </div>

        <div className="flex flex-wrap gap-2">
          {TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              className={`px-3 py-1.5 rounded-full text-xs capitalize ${filter === type ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-muted"}`}
            >
              {type.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        <Section title={`Ledger (${list.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Name</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-left">From (Membership #)</th>
                  <th className="px-5 py-3 text-left">Ref (M-Pesa)</th>
                  <th className="px-5 py-3 text-left">Date / Time</th>
                  <th className="px-5 py-3 text-left">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                      No transactions found for the selected filters.
                    </td>
                  </tr>
                ) : null}
                {list.map((transaction) => {
                  const member = members.find((item) => item.id === transaction.memberId);
                  const staffMember = staff.find((item) => item.id === transaction.by);
                  const tone =
                    transaction.type === "mpesa_unallocated"
                      ? "warning"
                      : transaction.type.includes("withdrawal") || transaction.type === "petty_cash"
                        ? "warning"
                        : transaction.type.includes("repayment")
                          ? "success"
                          : transaction.type.includes("disbursement")
                            ? "destructive"
                            : "default";
                  const account = transaction.account ?? transaction.memberId ?? "-";
                  const displayName =
                    transaction.payerName ?? member?.name ?? transaction.note ?? "-";
                  return (
                    <tr key={transaction.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">
                        {displayName}
                        {transaction.loanId ? (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            - {transaction.loanId}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold">
                        {fmtKES(transaction.amount)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={tone}>{transaction.type.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">{account}</td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {transaction.ref ?? transaction.id}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground text-xs">
                        {displayDateTime(transaction)}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {staffMember?.name ?? transaction.by}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </>
  );
}
