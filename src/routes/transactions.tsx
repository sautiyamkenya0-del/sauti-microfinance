import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, ListOrdered, Scale } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, DirectorOnly, Section, StatCard } from "@/components/ui-bits";
import { listMpesaReceiptAudit } from "@/lib/app-data.functions";
import { membershipIdCandidates } from "@/lib/membership";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/transactions")({
  head: () => ({ meta: [{ title: "Transactions - Sauti Microfinance" }] }),
  component: TxPage,
});

const TYPES = [
  "all",
  "mpesa",
  "deposit",
  "withdrawal",
  "loan_disbursement",
  "loan_repayment",
  "share_purchase",
  "petty_cash",
  "investor_contribution",
  "fee_payment",
  "purpose_pool",
  "mpesa_unallocated",
  "staff_payroll",
] as const;

const INFLOWS: ReadonlyArray<string> = [
  "deposit",
  "loan_repayment",
  "share_purchase",
  "investor_contribution",
  "fee_payment",
  "purpose_pool",
  "mpesa_unallocated",
];
const OUTFLOWS: ReadonlyArray<string> = [
  "withdrawal",
  "loan_disbursement",
  "petty_cash",
  "staff_payroll",
];

function isInternalSyntheticTransaction(transaction: { by?: string; note?: string }) {
  const note = String(transaction.note ?? "")
    .trim()
    .toLowerCase();
  return (
    note.startsWith("policy redistribution:") ||
    note.startsWith("purpose pool reallocation ->") ||
    note.startsWith("round-off captured from m-pesa receipt")
  );
}

function TxPage() {
  const { appMode, transactions, members, staff, reloadAppData, resolveMpesaAccount } = useStore();
  const fetchMpesaAudit = useServerFn(listMpesaReceiptAudit);
  const [filter, setFilter] = useState<(typeof TYPES)[number]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [query, setQuery] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const {
    data: mpesaAuditRows = [],
    refetch: refetchMpesaAudit,
    isLoading: mpesaAuditLoading,
  } = useQuery({
    queryKey: ["mpesa-receipt-audit"],
    queryFn: () => fetchMpesaAudit({ data: {} }),
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const refetchAudit = () => {
      void refetchMpesaAudit();
    };
    window.addEventListener("sauti:data-changed", refetchAudit);
    return () => window.removeEventListener("sauti:data-changed", refetchAudit);
  }, [refetchMpesaAudit]);

  const hiddenTransactionIds = useMemo(
    () => new Set(mpesaAuditRows.flatMap((row: any) => row.transactionIds ?? [])),
    [mpesaAuditRows],
  );

  const ledgerRows = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            transaction.by !== "MPESA" &&
            !hiddenTransactionIds.has(transaction.id) &&
            !isInternalSyntheticTransaction(transaction),
        )
        .map((transaction) => {
          const resolvedMember =
            resolveMpesaAccount(transaction.memberId ?? "") ??
            resolveMpesaAccount(transaction.account ?? "");
          return {
            id: transaction.id,
            date: transaction.date,
            createdAt: transaction.createdAt,
            type: transaction.type,
            amount: transaction.amount,
            memberId: resolvedMember?.id ?? transaction.memberId,
            loanId: transaction.loanId,
            ref: transaction.ref,
            by: transaction.by,
            note: transaction.note,
            account: transaction.account ?? transaction.memberId ?? "-",
            displayName: transaction.payerName ?? resolvedMember?.name ?? transaction.note ?? "-",
            direction: OUTFLOWS.includes(transaction.type) ? "out" : "in",
            status: undefined as string | undefined,
            isMpesaAudit: false,
          };
        }),
    [hiddenTransactionIds, resolveMpesaAccount, transactions],
  );

  const mpesaRows = useMemo(
    () =>
      mpesaAuditRows.map((row: any) => ({
        id: row.id,
        date: String(row.exactReceivedAt ?? row.createdAt ?? "").slice(0, 10),
        createdAt: row.exactReceivedAt ?? row.createdAt ?? undefined,
        type: row.type,
        amount: Number(row.originalAmount ?? row.amount ?? 0),
        memberId: row.memberId ?? undefined,
        loanId: undefined,
        ref: row.mpesaRef ?? undefined,
        by: row.direction === "out" ? "M-Pesa Payout" : "MPESA",
        note: row.note ?? undefined,
        account: row.account ?? row.memberId ?? "-",
        displayName: row.memberName ?? row.payerName ?? row.note ?? "-",
        direction: row.direction === "out" ? "out" : "in",
        status: row.status ?? undefined,
        isMpesaAudit: true,
      })),
    [mpesaAuditRows],
  );

  const rows = useMemo(() => {
    if (mpesaAuditLoading) return [];
    return [...ledgerRows, ...mpesaRows].sort((a, b) =>
      String(b.createdAt ?? b.date).localeCompare(String(a.createdAt ?? a.date)),
    );
  }, [ledgerRows, mpesaAuditLoading, mpesaRows]);

  const liteMode = appMode === "lite";
  const list = useMemo(
    () =>
      rows.filter((transaction) => {
        if (liteMode) return true;
        if (filter === "mpesa") {
          if (!transaction.isMpesaAudit && transaction.by !== "MPESA") return false;
        } else if (filter !== "all" && transaction.type !== filter) {
          return false;
        }
        if (from && transaction.date < from) return false;
        if (to && transaction.date > to) return false;
        if (
          memberFilter &&
          transaction.memberId !== memberFilter &&
          !membershipIdCandidates(transaction.account).includes(memberFilter)
        ) {
          return false;
        }
        const q = query.trim().toLowerCase();
        if (q) {
          const haystack = [
            transaction.displayName,
            transaction.memberId,
            transaction.account,
            transaction.ref,
            transaction.type,
            transaction.note,
            transaction.by,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      }),
    [rows, filter, from, liteMode, to, memberFilter, query],
  );

  const totals = useMemo(() => {
    const inflow = list
      .filter(
        (transaction) =>
          transaction.direction === "in" ||
          (!transaction.isMpesaAudit && INFLOWS.includes(transaction.type)),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const outflow = list
      .filter(
        (transaction) =>
          transaction.direction === "out" ||
          (!transaction.isMpesaAudit && OUTFLOWS.includes(transaction.type)),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0);
    const gross = list.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
    return { inflow, outflow, net: inflow - outflow, gross };
  }, [list]);

  async function handleRefreshTransactions() {
    setIsSyncing(true);
    try {
      const response = await fetch("/api/mpesa/queue", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Failed to refresh transactions.");
      }
      const result = await response.json();
      await reloadAppData();
      await refetchMpesaAudit();
      toast.success(
        `Transactions refreshed. Processed ${result.processed} M-Pesa confirmation(s) and cleaned ${
          result.duplicatesRemoved ?? 0
        } duplicate ref(s).`,
      );
      setLastRefreshedAt(new Date().toLocaleString());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to refresh transactions.");
    } finally {
      setIsSyncing(false);
    }
  }

  const displayDateTime = (transaction: (typeof rows)[number]) =>
    transaction.createdAt ? new Date(transaction.createdAt).toLocaleString() : transaction.date;

  return (
    <>
      <AppHeader
        title="Transactions"
        subtitle={
          liteMode
            ? "All capital operation transactions in one table."
            : "Original receipts stay intact while allocations live in a separate audit trail."
        }
      />
      <main className={`flex-1 space-y-6 ${liteMode ? "p-4 lg:p-6" : "p-6 lg:p-8"}`}>
        <SectionTabs section="capital" />
        {!liteMode ? (
          <DirectorOnly>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Filtered Records"
                value={list.length}
                hint={
                  mpesaAuditLoading
                    ? "Loading original M-Pesa receipts"
                    : `Of ${rows.length} visible total`
                }
                icon={<ListOrdered className="h-5 w-5" />}
              />
              <StatCard
                label="Inflow"
                value={fmtKES(totals.inflow)}
                hint={`Gross moved ${fmtKES(totals.gross)}`}
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
        ) : null}

        {!liteMode ? (
          <div className="grid items-end gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-5">
            <label className="block md:col-span-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Search
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, member no, M-Pesa ref..."
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                From
              </span>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">To</span>
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Member
              </span>
              <div className="mt-1">
                <MemberSearchSelect
                  members={members}
                  value={memberFilter}
                  onChange={setMemberFilter}
                  emptyLabel="All members"
                  describeMember={(member) =>
                    `${member.id} - ${member.name} - ${member.phone ?? ""}`
                  }
                />
              </div>
            </label>
          </div>
        ) : null}

        {!liteMode ? (
          <div className="flex flex-wrap items-center gap-2">
            {TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`rounded-full px-3 py-1.5 text-xs capitalize ${filter === type ? "bg-primary text-primary-foreground" : "border border-border bg-card hover:bg-muted"}`}
              >
                {type === "mpesa" ? "M-Pesa" : type.replace(/_/g, " ")}
              </button>
            ))}
            <button
              type="button"
              onClick={handleRefreshTransactions}
              disabled={isSyncing}
              className="ml-auto rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSyncing ? "Refreshing..." : "Refresh transactions"}
            </button>
          </div>
        ) : null}
        {!liteMode && lastRefreshedAt ? (
          <p className="text-xs text-muted-foreground">Last refreshed: {lastRefreshedAt}</p>
        ) : null}

        <Section
          title={
            liteMode
              ? `All Transactions (${list.length})`
              : `Filtered Ledger (${list.length} of ${rows.length})`
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
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
                      {mpesaAuditLoading
                        ? "Loading original M-Pesa receipts..."
                        : "No transactions found for the selected filters."}
                    </td>
                  </tr>
                ) : null}
                {list.map((transaction) => {
                  const staffMember = staff.find((item) => item.id === transaction.by);
                  const tone =
                    transaction.type === "mpesa_unallocated"
                      ? "warning"
                      : transaction.type.includes("withdrawal") ||
                          transaction.type === "petty_cash" ||
                          transaction.type === "staff_payroll"
                        ? "warning"
                        : transaction.type.includes("repayment")
                          ? "success"
                          : transaction.type.includes("disbursement")
                            ? "destructive"
                            : "default";
                  return (
                    <tr key={transaction.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">{transaction.displayName}</td>
                      <td className="px-5 py-3 text-right font-semibold">
                        {fmtKES(transaction.amount)}
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone={tone}>{transaction.type.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">{transaction.account}</td>
                      <td className="px-5 py-3 font-mono text-xs">
                        {transaction.ref ?? transaction.id}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {displayDateTime(transaction)}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        {transaction.isMpesaAudit
                          ? transaction.status
                            ? `${transaction.by} - ${transaction.status}`
                            : transaction.by
                          : (staffMember?.name ?? transaction.by)}
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
