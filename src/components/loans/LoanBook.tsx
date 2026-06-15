import { Section, Badge } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  loanProductChargeAmount,
  loanDailySavingsAmount,
  loanManualPenaltyAmount,
  loanPenaltySummary,
  loanSummary,
  loanTermDaysOf,
  type Loan,
  type LoanKind,
} from "@/lib/store";
import {
  listMpesaReceiptAudit,
  updateLoanRecord,
  upsertMemberCarryoverLoanRecord,
} from "@/lib/app-data.functions";
import { summarizeLegacyCarryoverLoan, type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import { trueLoanStatus, trueLoanStatusLabel, trueLoanStatusTone } from "@/lib/loan-status";
import { dedupeMemberTransactions } from "@/lib/transaction-dedupe";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  fuelEntryDayLabel,
  normalizeFuelJobCardRows,
  summarizeFuelJobCardRows,
  type FuelJobCardRow,
} from "./FuelJobCardFields";

type Filter =
  | "all"
  | "active"
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "defaulted"
  | "overdue";

type ProductFilter = "all" | LoanKind;

type LoanHistoryTarget = { source: "live" | "carryover"; id: string } | null;

type LoanDistributionRow = {
  id: string;
  dateTime: string;
  ref: string;
  payer: string;
  paidAmount: number;
  loanAmount: number;
  allocations: any[];
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All Loans" },
  { key: "active", label: "Active Loans" },
  { key: "pending", label: "Pending Applications" },
  { key: "approved", label: "Approved Loans" },
  { key: "rejected", label: "Rejected Loans" },
  { key: "completed", label: "Completed Loans" },
  { key: "defaulted", label: "Defaulted Loans" },
  { key: "overdue", label: "Overdue Loans" },
];

const PRODUCT_FILTERS: { key: ProductFilter; label: string }[] = [
  { key: "all", label: "All products" },
  { key: "financial", label: "Financial loans" },
  { key: "fuel", label: "Fuel loans" },
  { key: "stock", label: "Stock loans" },
  { key: "service", label: "Service loans" },
];

function loanKindLabel(kind?: LoanKind) {
  if (kind === "fuel") return "Fuel";
  if (kind === "stock") return "Stock";
  if (kind === "service") return "Service";
  return "Financial";
}

function allocationTypeLabel(value?: string | null, fallback?: string | null) {
  const raw = String(fallback ?? value ?? "allocation").trim();
  const labels: Record<string, string> = {
    carryover_loan_repayment: "carryover loan repayment",
    loan_repayment: "loan repayment",
    purpose_pool: "purpose pool",
    loan_savings: "loan savings",
    share_purchase: "share purchase",
    fee_payment: "fee payment",
    deposit: "savings deposit / wallet top-up",
  };
  return labels[raw] ?? raw.replace(/_/g, " ");
}

function termDaysOf(l: Loan): number {
  return loanTermDaysOf(l);
}

function dueDateOf(l: Loan): string {
  return loanSummary(l).dueDate;
}

function liveLoanCycleNumber(loan: Loan, loans: Loan[]) {
  return (
    loans
      .filter(
        (item) =>
          item.memberId === loan.memberId &&
          (item.loanKind ?? "financial") === (loan.loanKind ?? "financial"),
      )
      .sort((a, b) => `${a.startDate}-${a.id}`.localeCompare(`${b.startDate}-${b.id}`))
      .findIndex((item) => item.id === loan.id) + 1
  );
}

/** Daily compliance contribution tier as per common SBC plans. */
function dailyTotalOf(l: Loan): number {
  return loanSummary(l).dailyCollectionAmount;
}

type LoanBookRow =
  | { kind: "live"; loan: Loan; sortKey: string }
  | { kind: "carryover"; loan: LegacyCarryoverLoan; sortKey: string };

type FuelRecordRow = {
  loanId: string;
  source: "live" | "carryover";
  memberId: string;
  memberName: string;
  vehiclePlate: string;
  status: string;
  entry: FuelJobCardRow;
  entryIndex: number;
};

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function meaningfulFuelRows(rows: FuelJobCardRow[]) {
  return rows.filter(
    (row) =>
      row.date ||
      row.time ||
      row.fuelType ||
      row.attendantName ||
      row.liters > 0 ||
      row.pricePerLitre > 0 ||
      row.total > 0 ||
      row.fuelCharge > 0 ||
      row.odometerReading > 0,
  );
}

function fuelRowsFromLiveLoan(loan: Loan) {
  const payload = objectValue(loan.supplierPayload);
  const jobCard = objectValue(payload.jobCard);
  const rows = meaningfulFuelRows(normalizeFuelJobCardRows(jobCard.rows ?? payload.fuelEntries, 1));
  if (rows.length > 0) return rows;
  const fallbackTotal = numberValue(payload.estimatedTotal ?? loan.principal);
  const fallbackCharge = numberValue(payload.fuelCharge ?? payload.productChargeAmount);
  if (fallbackTotal <= 0 && fallbackCharge <= 0) return [];
  return normalizeFuelJobCardRows(
    [
      {
        date: loan.startDate,
        fuelType: textValue(payload.fuelType),
        liters: numberValue(payload.litres ?? payload.liters),
        pricePerLitre: numberValue(payload.unitPrice ?? payload.pricePerLitre),
        total: fallbackTotal,
        fuelCharge: fallbackCharge,
      },
    ],
    1,
  );
}

function fuelRowsFromCarryoverLoan(loan: LegacyCarryoverLoan) {
  const productMeta = objectValue(loan.feeBreakdown?.productMeta);
  const jobCard = objectValue(productMeta.jobCard);
  const rows = meaningfulFuelRows(
    normalizeFuelJobCardRows(productMeta.fuelEntries ?? jobCard.rows, 1),
  );
  if (rows.length > 0) return rows;
  const fallbackTotal = numberValue(productMeta.fuelAmount ?? loan.principal);
  const fallbackCharge = numberValue(
    productMeta.fuelCharge ?? loan.feeBreakdown?.processingFeeAmount,
  );
  if (fallbackTotal <= 0 && fallbackCharge <= 0) return [];
  return normalizeFuelJobCardRows(
    [
      {
        date: loan.startDate,
        total: fallbackTotal,
        fuelCharge: fallbackCharge,
      },
    ],
    1,
  );
}

function vehiclePlateForFuelLoan(
  loan: Loan | LegacyCarryoverLoan,
  member?: { vehiclePlate?: string },
) {
  if ("paid" in loan) {
    return textValue(loan.supplierPayload?.vehiclePlate) || member?.vehiclePlate || "";
  }
  return textValue(loan.feeBreakdown?.productMeta?.vehiclePlate) || member?.vehiclePlate || "";
}

function fuelRecordsForLiveLoan(
  loan: Loan,
  member?: { id: string; name: string; vehiclePlate?: string },
) {
  if ((loan.loanKind ?? "financial") !== "fuel") return [];
  return fuelRowsFromLiveLoan(loan).map<FuelRecordRow>((entry, entryIndex) => ({
    loanId: loan.id,
    source: "live",
    memberId: loan.memberId,
    memberName: member?.name ?? "",
    vehiclePlate: vehiclePlateForFuelLoan(loan, member),
    status: loan.status,
    entry,
    entryIndex,
  }));
}

function fuelRecordsForCarryoverLoan(
  loan: LegacyCarryoverLoan,
  member?: { id: string; name: string; vehiclePlate?: string },
) {
  if ((loan.loanKind ?? "financial") !== "fuel") return [];
  return fuelRowsFromCarryoverLoan(loan).map<FuelRecordRow>((entry, entryIndex) => ({
    loanId: loan.id,
    source: "carryover",
    memberId: loan.memberId,
    memberName: member?.name ?? "",
    vehiclePlate: vehiclePlateForFuelLoan(loan, member),
    status: loan.finished ? "closed" : loan.status,
    entry,
    entryIndex,
  }));
}

export function LoanBook({
  carryoverLoans = [],
  onSelectMember,
  tableOnly = false,
}: {
  carryoverLoans?: LegacyCarryoverLoan[];
  onSelectMember: (memberId: string) => void;
  tableOnly?: boolean;
}) {
  const { loans, members, staff, transactions, currentUser, recordTransaction, policySettings } =
    useStore();
  const fetchMpesaAudit = useServerFn(listMpesaReceiptAudit);
  const [filter, setFilter] = useState<Filter>("all");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [repayFor, setRepayFor] = useState<string | null>(null);
  const [repayAmt, setRepayAmt] = useState(0);
  const [historyFor, setHistoryFor] = useState<LoanHistoryTarget>(null);

  const { data: mpesaAuditRows = [], isLoading: mpesaAuditLoading } = useQuery({
    queryKey: ["mpesa-receipt-audit", "loan-book-history"],
    queryFn: () => fetchMpesaAudit({ data: {} }),
    enabled: Boolean(historyFor),
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const today = new Date().toISOString().slice(0, 10);
  const uniqueTransactions = useMemo(() => dedupeMemberTransactions(transactions), [transactions]);

  const visible = useMemo(() => {
    const liveLoans =
      currentUser.role === "loan_officer"
        ? loans.filter((l) => l.officerId === currentUser.id)
        : loans;
    let list: LoanBookRow[] = [
      ...liveLoans.map((loan) => ({ kind: "live" as const, loan, sortKey: loan.startDate })),
      ...carryoverLoans.map((loan) => ({
        kind: "carryover" as const,
        loan,
        sortKey: loan.startDate,
      })),
    ];

    list = list.filter((row) => {
      const rowLoanKind = row.loan.loanKind ?? "financial";
      if (!tableOnly && productFilter !== "all" && rowLoanKind !== productFilter) return false;

      const status = row.loan.status;
      const rowSummary =
        row.kind === "carryover"
          ? summarizeLegacyCarryoverLoan(row.loan, policySettings)
          : loanPenaltySummary(row.loan, uniqueTransactions);
      const balance =
        row.kind === "carryover"
          ? rowSummary.totalOwedNow
          : (rowSummary as ReturnType<typeof loanPenaltySummary>).totalOwedNow;
      const dueDate = rowSummary.dueDate;
      const logicalStatus = trueLoanStatus({ storedStatus: status, balance, dueDate, today });
      switch (tableOnly ? "all" : filter) {
        case "all":
          return true;
        case "active":
          return logicalStatus === "active";
        case "pending":
          return row.kind === "live" && status === "pending";
        case "approved":
          return logicalStatus === "active" || logicalStatus === "closed";
        case "rejected":
          return row.kind === "live" && status === "rejected";
        case "completed":
          return logicalStatus === "closed";
        case "defaulted":
          return logicalStatus === "defaulted";
        case "overdue":
          return balance > 0 && dueDate < today;
        default:
          return true;
      }
    });

    if (!tableOnly && activeQuery.trim()) {
      const q = activeQuery.trim().toLowerCase();
      list = list.filter((row) => {
        const m = members.find((x) => x.id === row.loan.memberId);
        const rowSummary =
          row.kind === "carryover"
            ? summarizeLegacyCarryoverLoan(row.loan, policySettings)
            : loanPenaltySummary(row.loan, uniqueTransactions);
        return [
          m?.id,
          m?.name,
          m?.phone,
          m?.businessName,
          row.loan.id,
          row.loan.startDate,
          rowSummary.dueDate,
          row.kind === "live"
            ? (rowSummary as ReturnType<typeof loanPenaltySummary>).totalOwedNow
            : (rowSummary as ReturnType<typeof summarizeLegacyCarryoverLoan>).totalOwedNow,
          row.kind === "live"
            ? (rowSummary as ReturnType<typeof loanPenaltySummary>).approved
            : row.loan.principal,
          row.kind === "carryover" ? row.loan.label : undefined,
        ]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      });
    }
    return list.sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
  }, [
    loans,
    members,
    filter,
    productFilter,
    activeQuery,
    currentUser,
    today,
    carryoverLoans,
    policySettings,
    uniqueTransactions,
    tableOnly,
  ]);

  const fuelRecords = useMemo(
    () => [
      ...loans.flatMap((loan) =>
        fuelRecordsForLiveLoan(
          loan,
          members.find((member) => member.id === loan.memberId),
        ),
      ),
      ...carryoverLoans.flatMap((loan) =>
        fuelRecordsForCarryoverLoan(
          loan,
          members.find((member) => member.id === loan.memberId),
        ),
      ),
    ],
    [carryoverLoans, loans, members],
  );

  const selectedHistoryLoan = useMemo(() => {
    if (!historyFor) return null;
    if (historyFor.source === "live") {
      const loan = loans.find((item) => item.id === historyFor.id);
      if (!loan) return null;
      const member = members.find((item) => item.id === loan.memberId);
      return {
        source: "live" as const,
        id: loan.id,
        memberId: loan.memberId,
        memberName: member?.name ?? loan.memberId,
        cycle: liveLoanCycleNumber(loan, loans),
        label: loanKindLabel(loan.loanKind ?? "financial"),
      };
    }
    const loan = carryoverLoans.find((item) => item.id === historyFor.id);
    if (!loan) return null;
    const member = members.find((item) => item.id === loan.memberId);
    return {
      source: "carryover" as const,
      id: loan.id,
      memberId: loan.memberId,
      memberName: member?.name ?? loan.memberId,
      cycle: loan.loanCycleNumber,
      label: `${loanKindLabel(loan.loanKind ?? "financial")} carryover`,
    };
  }, [carryoverLoans, historyFor, loans, members]);

  const selectedLoanDistribution = useMemo(() => {
    if (!historyFor) return [];

    const receiptRows = (mpesaAuditRows as any[]).flatMap((row) => {
      const allocations = Array.isArray(row.allocations)
        ? row.allocations.filter((allocation: any) => Number(allocation.amount ?? 0) > 0)
        : [];
      const loanAllocations = allocations.filter(
        (allocation: any) => String(allocation.loanId ?? "") === historyFor.id,
      );
      if (loanAllocations.length === 0) return [];
      return [
        {
          id: String(row.id),
          dateTime: row.exactReceivedAt ?? row.createdAt ?? row.date ?? "",
          ref: row.mpesaRef ?? row.ref ?? "-",
          payer: row.memberName ?? row.payerName ?? row.account ?? "-",
          paidAmount: Number(row.originalAmount ?? row.amount ?? 0),
          loanAmount: loanAllocations.reduce(
            (sum: number, allocation: any) => sum + Number(allocation.amount ?? 0),
            0,
          ),
          allocations,
        },
      ];
    });

    const manualRows = uniqueTransactions
      .filter((transaction) => transaction.by !== "MPESA" && transaction.loanId === historyFor.id)
      .map((transaction) => ({
        id: transaction.id,
        dateTime: transaction.createdAt ?? transaction.date,
        ref: transaction.ref ?? transaction.id,
        payer:
          members.find((member) => member.id === transaction.memberId)?.name ??
          transaction.memberId ??
          "-",
        paidAmount: Number(transaction.amount ?? 0),
        loanAmount: Number(transaction.amount ?? 0),
        allocations: [
          {
            id: transaction.id,
            amount: transaction.amount,
            type: transaction.type,
            typeLabel: allocationTypeLabel(transaction.type),
            loanId: transaction.loanId,
          },
        ],
      }));

    return [...receiptRows, ...manualRows].sort((a, b) =>
      String(b.dateTime).localeCompare(String(a.dateTime)),
    );
  }, [historyFor, members, mpesaAuditRows, uniqueTransactions]);

  const empty = loans.length === 0 && carryoverLoans.length === 0;

  return (
    <Section
      title="All Loans"
      action={
        <span className="text-xs text-muted-foreground font-normal">
          {visible.length} loan record(s) shown
        </span>
      }
    >
      {!tableOnly ? (
        <>
          {/* Filter chips */}
          <div className="px-5 pt-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium border transition ${active ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground hover:bg-muted"}`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          <div className="px-5 pt-3 flex flex-wrap gap-2">
            {PRODUCT_FILTERS.map((product) => {
              const active = productFilter === product.key;
              return (
                <button
                  key={product.key}
                  onClick={() => setProductFilter(product.key)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium border transition ${active ? "bg-accent text-accent-foreground border-accent" : "bg-card border-border text-foreground hover:bg-muted"}`}
                >
                  {product.label}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="px-5 pt-3 pb-4 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setActiveQuery(query)}
              placeholder="Search by member no, client name, business, or phone"
              className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => setActiveQuery(query)}
              className="px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
            >
              Search
            </button>
            <button
              onClick={() => {
                setQuery("");
                setActiveQuery("");
                setFilter("all");
                setProductFilter("all");
              }}
              className="px-4 py-2 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted"
            >
              Reset
            </button>
          </div>
        </>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Loan #</th>
              <th className="text-left px-5 py-3">Type</th>
              <th className="text-left px-5 py-3">Client</th>
              <th className="text-left px-5 py-3">Business</th>
              <th className="text-left px-5 py-3">Status</th>
              <th className="text-left px-5 py-3">Approved</th>
              <th className="text-left px-5 py-3">Balance</th>
              <th className="text-left px-5 py-3">Plan</th>
              <th className="text-left px-5 py-3">Due Date</th>
              <th className="text-left px-5 py-3">Officer</th>
              <th className="text-left px-5 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {empty && (
              <tr>
                <td colSpan={11} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No loans yet — applications you create will appear here.
                </td>
              </tr>
            )}
            {!empty && visible.length === 0 && (
              <tr>
                <td colSpan={11} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No loans match this filter.
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const l = row.loan;
              const m = members.find((x) => x.id === l.memberId);
              const liveLoan = row.loan as Loan;
              const legacyLoan = row.loan as LegacyCarryoverLoan;
              const o =
                row.kind === "live" ? staff.find((s) => s.id === liveLoan.officerId) : undefined;
              const summary =
                row.kind === "live"
                  ? loanPenaltySummary(liveLoan, uniqueTransactions)
                  : summarizeLegacyCarryoverLoan(legacyLoan, policySettings);
              const idNum = l.id.replace(/\D/g, "") || l.id;
              const currentBalance =
                row.kind === "live"
                  ? (summary as ReturnType<typeof loanPenaltySummary>).totalOwedNow
                  : (summary as ReturnType<typeof summarizeLegacyCarryoverLoan>).totalOwedNow;
              const statusLabel = trueLoanStatus({
                storedStatus: l.status,
                balance: currentBalance,
                dueDate: summary.dueDate,
                today,
              });
              const tone = trueLoanStatusTone(statusLabel);
              return (
                <tr key={`${row.kind}-${l.id}`} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">
                    {idNum}
                    {row.kind === "carryover" ? (
                      <div className="mt-1 text-[10px] uppercase text-muted-foreground">
                        Carryover
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-3">
                    <Badge
                      tone={
                        row.kind === "live" &&
                        liveLoan.loanKind &&
                        liveLoan.loanKind !== "financial"
                          ? "warning"
                          : "muted"
                      }
                    >
                      {loanKindLabel(row.loan.loanKind ?? "financial")}
                    </Badge>
                    <div className="mt-1 text-[10px] uppercase text-muted-foreground">
                      Cycle{" "}
                      {row.kind === "live"
                        ? liveLoanCycleNumber(liveLoan, loans)
                        : legacyLoan.loanCycleNumber}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium uppercase text-xs">
                      {(m?.name ?? "—").toUpperCase()}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {m?.id ?? "—"} | {m?.phone ?? "—"}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {m?.businessName ||
                      (m?.businessType ?? <span className="text-muted-foreground">N/A</span>)}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={tone as never}>{trueLoanStatusLabel(statusLabel)}</Badge>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {fmtKES(
                      row.kind === "live"
                        ? (summary as ReturnType<typeof loanSummary>).approved
                        : legacyLoan.principal,
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {fmtKES(
                      row.kind === "live"
                        ? (summary as ReturnType<typeof loanPenaltySummary>).totalOwedNow
                        : (summary as ReturnType<typeof summarizeLegacyCarryoverLoan>).totalOwedNow,
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs leading-tight">
                    <div>{summary.termDays} days</div>
                    <div className="text-[11px] text-muted-foreground">
                      Compliance{" "}
                      {fmtKES(
                        row.kind === "live"
                          ? loanDailySavingsAmount(
                              (summary as ReturnType<typeof loanSummary>).approved,
                            )
                          : legacyLoan.dailySavingsAmount,
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Daily total{" "}
                      {fmtKES(
                        row.kind === "live"
                          ? dailyTotalOf(liveLoan)
                          : (summary as ReturnType<typeof summarizeLegacyCarryoverLoan>)
                              .dailyInclusive,
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs">{summary.dueDate}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground truncate max-w-[120px]">
                    {o?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => setHistoryFor({ source: row.kind, id: l.id })}
                      className="text-xs px-3 py-1 rounded-md border border-primary/40 text-primary hover:bg-primary/5"
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!tableOnly && currentUser.role !== "loan_officer" && (
        <FuelRecordsPanel records={fuelRecords} />
      )}

      {historyFor ? (
        <LoanDistributionHistoryModal
          loan={selectedHistoryLoan}
          rows={selectedLoanDistribution}
          loading={mpesaAuditLoading}
          onClose={() => setHistoryFor(null)}
          onOpenMember={() => {
            if (selectedHistoryLoan) onSelectMember(selectedHistoryLoan.memberId);
            setHistoryFor(null);
          }}
        />
      ) : null}

      {repayFor && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4"
          onClick={() => setRepayFor(null)}
        >
          <div
            className="bg-card rounded-xl border border-border w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-semibold mb-4">
              Record Repayment · {repayFor}
            </h3>
            <input
              type="number"
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              value={repayAmt}
              onChange={(e) => setRepayAmt(Number(e.target.value))}
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setRepayFor(null)}
                className="px-3 py-1.5 text-sm rounded-md hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ln = loans.find((l) => l.id === repayFor);
                  if (!ln || repayAmt <= 0) return;
                  await recordTransaction({
                    type: "loan_repayment",
                    amount: repayAmt,
                    memberId: ln.memberId,
                    loanId: ln.id,
                    by: currentUser.id,
                  });
                  toast.success("Repayment recorded");
                  setRepayFor(null);
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function LoanDistributionHistoryModal({
  loan,
  rows,
  loading,
  onClose,
  onOpenMember,
}: {
  loan: {
    id: string;
    memberId: string;
    memberName: string;
    cycle: number;
    label: string;
  } | null;
  rows: LoanDistributionRow[];
  loading: boolean;
  onClose: () => void;
  onOpenMember: () => void;
}) {
  const totalApplied = rows.reduce((sum, row) => sum + row.loanAmount, 0);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="font-display text-lg font-semibold">Transaction distribution history</h3>
            <div className="mt-1 text-sm text-muted-foreground">
              {loan
                ? `${loan.memberName} - ${loan.label} loan ${loan.id} - cycle ${loan.cycle}`
                : "Loan record"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loan ? (
              <button
                type="button"
                onClick={onOpenMember}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                Open member
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Payments
              </div>
              <div className="mt-1 text-lg font-semibold">{rows.length}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Applied to this loan
              </div>
              <div className="mt-1 text-lg font-semibold">{fmtKES(totalApplied)}</div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Loan cycle
              </div>
              <div className="mt-1 text-lg font-semibold">{loan?.cycle ?? "-"}</div>
            </div>
          </div>

          {loading ? (
            <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Loading receipt allocations...
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No payment distribution has been recorded for this loan yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-[900px] w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Date / Time</th>
                    <th className="px-3 py-2 text-left">Ref</th>
                    <th className="px-3 py-2 text-left">Paid By</th>
                    <th className="px-3 py-2 text-right">Receipt</th>
                    <th className="px-3 py-2 text-right">This Loan</th>
                    <th className="px-3 py-2 text-left">Distribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.dateTime ? new Date(row.dateTime).toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 font-mono">{row.ref}</td>
                      <td className="px-3 py-2">{row.payer}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {fmtKES(row.paidAmount)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-primary">
                        {fmtKES(row.loanAmount)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          {row.allocations.map((allocation: any) => {
                            const isThisLoan = loan?.id
                              ? String(allocation.loanId ?? "") === loan.id
                              : false;
                            return (
                              <div
                                key={allocation.id ?? `${allocation.type}-${allocation.amount}`}
                                className={isThisLoan ? "font-semibold text-foreground" : ""}
                              >
                                {fmtKES(Number(allocation.amount ?? 0))} -{" "}
                                {allocationTypeLabel(allocation.type, allocation.typeLabel)}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function fuelEntryTotal(entry: FuelJobCardRow) {
  return entry.total > 0 ? entry.total : entry.liters * entry.pricePerLitre;
}

function FuelEntryTable({ records }: { records: FuelRecordRow[] }) {
  if (records.length === 0) {
    return <div className="text-xs text-muted-foreground">No detailed fuel entries saved.</div>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-[980px] w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-left">Fuel Type</th>
            <th className="px-3 py-2 text-right">Liters</th>
            <th className="px-3 py-2 text-right">Price/Litre</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Fuel Charge</th>
            <th className="px-3 py-2 text-left">Attendant Name</th>
            <th className="px-3 py-2 text-right">Odometer Reading</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {records.map((record) => (
            <tr key={`${record.loanId}-${record.entryIndex}`}>
              <td className="px-3 py-2">
                <div>{record.entry.date || "-"}</div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                  {fuelEntryDayLabel(record.entry, record.entryIndex)}
                </div>
              </td>
              <td className="px-3 py-2">{record.entry.time || "-"}</td>
              <td className="px-3 py-2">{record.entry.fuelType || "-"}</td>
              <td className="px-3 py-2 text-right">{record.entry.liters.toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{fmtKES(record.entry.pricePerLitre)}</td>
              <td className="px-3 py-2 text-right">{fmtKES(fuelEntryTotal(record.entry))}</td>
              <td className="px-3 py-2 text-right">{fmtKES(record.entry.fuelCharge)}</td>
              <td className="px-3 py-2">{record.entry.attendantName || "-"}</td>
              <td className="px-3 py-2 text-right">
                {record.entry.odometerReading > 0 ? record.entry.odometerReading.toFixed(0) : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FuelEntriesDetails({ records }: { records: FuelRecordRow[] }) {
  if (records.length === 0) return null;
  const summary = summarizeFuelJobCardRows(records.map((record) => record.entry));
  return (
    <details className="mt-3 rounded-md border border-border bg-muted/20 p-3">
      <summary className="cursor-pointer text-xs font-semibold">
        Fuel entries - {records.length} refill(s), {summary.totalLiters.toFixed(2)} liters,{" "}
        {fmtKES(summary.totalCost)}
      </summary>
      <div className="mt-3">
        <FuelEntryTable records={records} />
      </div>
    </details>
  );
}

function FuelRecordsPanel({ records }: { records: FuelRecordRow[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((record) =>
      [
        record.memberId,
        record.memberName,
        record.vehiclePlate,
        record.loanId,
        record.entry.fuelType,
        record.entry.attendantName,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [query, records]);
  const summary = summarizeFuelJobCardRows(filtered.map((record) => record.entry));

  if (records.length === 0) return null;

  return (
    <div className="border-t border-border px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Locomotive Fuel Records</div>
          <div className="text-xs text-muted-foreground">
            Filter by membership number, client name, vehicle plate, fuel type, attendant, or loan.
          </div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search plate or member no."
          className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm sm:w-72"
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <Stat label="Refills" v={String(filtered.length)} />
        <Stat label="Fuel Consumed" v={`${summary.totalLiters.toFixed(2)} L`} />
        <Stat label="Fuel Total" v={fmtKES(summary.totalCost)} />
        <Stat label="Fuel Charges" v={fmtKES(summary.totalFuelCharge)} />
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-border">
        <table className="min-w-[1180px] w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Member</th>
              <th className="px-3 py-2 text-left">Plate</th>
              <th className="px-3 py-2 text-left">Loan</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Fuel Type</th>
              <th className="px-3 py-2 text-right">Liters</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Charge</th>
              <th className="px-3 py-2 text-right">Odometer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((record) => (
              <tr key={`${record.source}-${record.loanId}-${record.entryIndex}`}>
                <td className="px-3 py-2">
                  <div className="font-medium">{record.memberName || "-"}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {record.memberId}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono">{record.vehiclePlate || "-"}</td>
                <td className="px-3 py-2">
                  {record.loanId}
                  <div className="text-[10px] uppercase text-muted-foreground">{record.source}</div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={record.status === "defaulted" ? "destructive" : "muted"}>
                    {record.status}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <div>{record.entry.date || "-"}</div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                    {fuelEntryDayLabel(record.entry, record.entryIndex)}
                  </div>
                </td>
                <td className="px-3 py-2">{record.entry.time || "-"}</td>
                <td className="px-3 py-2">{record.entry.fuelType || "-"}</td>
                <td className="px-3 py-2 text-right">{record.entry.liters.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{fmtKES(fuelEntryTotal(record.entry))}</td>
                <td className="px-3 py-2 text-right">{fmtKES(record.entry.fuelCharge)}</td>
                <td className="px-3 py-2 text-right">
                  {record.entry.odometerReading > 0 ? record.entry.odometerReading.toFixed(0) : "-"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">
                  No fuel records match that filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type LoanEditDraft = {
  principal: number;
  approvedAmount: number;
  rate: number;
  termDays: number;
  startDate: string;
  paid: number;
  status: "pending" | "active" | "closed" | "defaulted" | "rejected";
  purpose: string;
  productChargeAmount: number;
  manualPenaltyAmount: number;
  penaltyWaivedAmount: number;
  dailySavingsAmount: number;
};

function payloadPenaltyPart(payload: Record<string, unknown> | undefined, key: string) {
  const value = Number(payload?.[key] ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function ownManualPenaltyAmount(payload: Record<string, unknown> | undefined) {
  const manual = payloadPenaltyPart(payload, "manualPenaltyAmount");
  if (manual > 0) return manual;
  if (payloadPenaltyPart(payload, "carriedForwardPenaltyAmount") > 0) return 0;
  return payloadPenaltyPart(payload, "priorPenaltyAmount");
}

function safeMoney(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function liveLoanEditDraft(loan: Loan, transactions: ReturnType<typeof useStore>["transactions"]) {
  const summary = loanPenaltySummary(loan, transactions);
  return {
    principal: loan.principal,
    approvedAmount: summary.approved,
    rate: loan.rate,
    termDays: summary.termDays,
    startDate: loan.startDate,
    paid: summary.totalPaid,
    status: loan.status,
    purpose: loan.purpose ?? "",
    productChargeAmount: loanProductChargeAmount(loan),
    manualPenaltyAmount: ownManualPenaltyAmount(loan.supplierPayload),
    penaltyWaivedAmount: loan.penaltyWaivedAmount ?? 0,
    dailySavingsAmount: summary.dailySavingsAmount,
  } satisfies LoanEditDraft;
}

function carryoverLoanEditDraft(loan: LegacyCarryoverLoan) {
  return {
    principal: loan.principal,
    approvedAmount: loan.principal,
    rate: loan.interestRatePct,
    termDays: loan.termDays,
    startDate: loan.startDate,
    paid: loan.paidToDate,
    status: loan.status,
    purpose: loan.label,
    productChargeAmount: Number(loan.feeBreakdown?.processingFeeAmount ?? 0),
    manualPenaltyAmount: ownManualPenaltyAmount(loan.feeBreakdown),
    penaltyWaivedAmount: loan.penaltyWaivedAmount,
    dailySavingsAmount: loan.dailySavingsAmount,
  } satisfies LoanEditDraft;
}

export function MemberLoanHistory({
  memberId,
  carryoverLoans = [],
  onClose,
  onNewLoan,
  onCarryoverChanged,
}: {
  memberId: string;
  carryoverLoans?: LegacyCarryoverLoan[];
  onClose: () => void;
  onNewLoan: (memberId: string, isFirstTime: boolean) => void;
  onCarryoverChanged?: () => Promise<unknown>;
}) {
  const updateLiveLoan = useServerFn(updateLoanRecord);
  const updateCarryoverLoan = useServerFn(upsertMemberCarryoverLoanRecord);
  const {
    members,
    loans,
    transactions,
    appraisals,
    penalties,
    roundOff,
    roundOffBalance,
    settlePenaltyFromPool,
    currentUser,
    policySettings,
    reloadAppData,
  } = useStore();
  const [editing, setEditing] = useState<{ source: "live" | "carryover"; id: string } | null>(null);
  const [editDraft, setEditDraft] = useState<LoanEditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const member = members.find((m) => m.id === memberId);
  if (!member) return null;
  const memberLoans = loans.filter((l) => l.memberId === memberId);
  const memberCarryoverLoans = carryoverLoans.filter((loan) => loan.memberId === memberId);
  const repayments = transactions.filter(
    (t) => t.memberId === memberId && t.type === "loan_repayment",
  );
  const memberApraisals = appraisals.filter((a) => a.memberId === memberId);
  const allTx = transactions.filter((t) => t.memberId === memberId);
  const memberPenalties = penalties.filter((p) => p.memberId === memberId);
  const memberRoundOff = roundOff.filter((r) => r.memberId === memberId);
  const pool = roundOffBalance(memberId);
  const outstandingPen = memberPenalties.filter((p) => p.status === "outstanding");
  const totalLoanHistoryCount = memberLoans.length + memberCarryoverLoans.length;
  const isFirstTime = totalLoanHistoryCount === 0;
  const canEditLoans = currentUser.role === "director";
  const complianceAlerts = [
    ...memberCarryoverLoans
      .map((loan) => {
        const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
        return { source: "carryover" as const, loan, summary, balance: summary.totalOwedNow };
      })
      .filter(({ loan, balance }) => !loan.finished && balance > 0),
    ...memberLoans
      .map((loan) => {
        const summary = loanPenaltySummary(loan, transactions);
        return { source: "live" as const, loan, summary, balance: summary.totalOwedNow };
      })
      .filter(
        ({ loan, balance }) =>
          balance > 0 && (loan.status === "active" || loan.status === "defaulted"),
      ),
  ];

  function startLiveLoanEdit(loan: Loan) {
    setEditing({ source: "live", id: loan.id });
    setEditDraft(liveLoanEditDraft(loan, transactions));
  }

  function startCarryoverLoanEdit(loan: LegacyCarryoverLoan) {
    setEditing({ source: "carryover", id: loan.id });
    setEditDraft(carryoverLoanEditDraft(loan));
  }

  async function saveLoanEdit() {
    if (!editing || !editDraft) return;
    setSavingEdit(true);
    try {
      if (editing.source === "live") {
        await updateLiveLoan({
          data: {
            loanId: editing.id,
            principal: editDraft.principal,
            approvedAmount: editDraft.approvedAmount,
            rate: editDraft.rate,
            termDays: editDraft.termDays,
            startDate: editDraft.startDate,
            paid: editDraft.paid,
            status: editDraft.status,
            purpose: editDraft.purpose,
            productChargeAmount: editDraft.productChargeAmount,
            manualPenaltyAmount: editDraft.manualPenaltyAmount,
            penaltyWaivedAmount: editDraft.penaltyWaivedAmount,
            dailySavingsAmount: editDraft.dailySavingsAmount,
          },
        });
        await reloadAppData();
      } else {
        const loan = memberCarryoverLoans.find((item) => item.id === editing.id);
        if (!loan) throw new Error("Carryover loan not found.");
        await updateCarryoverLoan({
          data: {
            id: loan.id,
            memberId: loan.memberId,
            label: editDraft.purpose || loan.label,
            loanKind: loan.loanKind ?? "financial",
            loanCycleNumber: loan.loanCycleNumber,
            principal: editDraft.principal,
            interestRatePct: editDraft.rate,
            termDays: editDraft.termDays,
            dailySavingsAmount: editDraft.dailySavingsAmount,
            startDate: editDraft.startDate,
            paidToDate: editDraft.paid,
            status:
              editDraft.status === "closed"
                ? "closed"
                : editDraft.status === "defaulted"
                  ? "defaulted"
                  : "active",
            finished: editDraft.status === "closed",
            penaltyWaivedAmount: editDraft.penaltyWaivedAmount,
            feeBreakdown: {
              ...(loan.feeBreakdown ?? {}),
              processingFeeAmount: editDraft.productChargeAmount,
              manualPenaltyAmount: editDraft.manualPenaltyAmount,
              priorPenaltyAmount:
                editDraft.manualPenaltyAmount +
                Number(loan.feeBreakdown?.carriedForwardPenaltyAmount ?? 0),
            },
            notes: loan.notes,
          },
        });
        await onCarryoverChanged?.();
        await reloadAppData();
      }
      toast.success("Loan details updated");
      setEditing(null);
      setEditDraft(null);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to update loan.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div
        className="bg-card border-l border-border w-full max-w-2xl h-full overflow-y-auto p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">{member.name}</h2>
            <p className="text-xs text-muted-foreground">
              {member.id} · {member.phone} · joined {member.joinedAt}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label="Savings" v={fmtKES(member.savingsBalance)} />
          <Stat label="Shares" v={`${member.shares} units`} />
          <Stat label="Total Loans" v={String(totalLoanHistoryCount)} />
          <Stat label="Round-Off Pool" v={fmtKES(pool)} />
        </div>

        {complianceAlerts.length > 0 && (
          <div className="border border-amber-300/50 bg-amber-50 text-amber-950 rounded-md p-3 text-sm">
            <div className="font-semibold mb-2">Active compliance alerts</div>
            <div className="space-y-2">
              {complianceAlerts.map(({ source, loan, summary, balance }) => {
                const dailyCompliance =
                  source === "carryover"
                    ? loan.dailySavingsAmount
                    : (summary as ReturnType<typeof loanPenaltySummary>).dailySavingsAmount;
                const totalCompliance = dailyCompliance * summary.termDays;
                return (
                  <div
                    key={`${source}-${loan.id}`}
                    className="grid gap-2 rounded-md border border-amber-200 bg-white/60 p-2 sm:grid-cols-4"
                  >
                    <div>
                      <div className="text-[10px] uppercase text-amber-800">Loan</div>
                      <div className="font-medium">{loan.id}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-amber-800">Collections start</div>
                      <div className="font-medium">{loan.startDate}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-amber-800">Compliance</div>
                      <div className="font-medium">
                        {fmtKES(dailyCompliance)} / day · {fmtKES(totalCompliance)} total
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-amber-800">Balance</div>
                      <div className="font-medium">{fmtKES(balance)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {outstandingPen.length > 0 && (
          <div className="border border-destructive/30 bg-destructive/5 rounded-md p-3 text-sm">
            <div className="font-semibold text-destructive mb-2">
              Outstanding Penalties · {fmtKES(outstandingPen.reduce((s, p) => s + p.amount, 0))}
            </div>
            <div className="space-y-1.5">
              {outstandingPen.map((p) => (
                <div key={p.id} className="flex justify-between items-center text-xs">
                  <span>
                    {p.date} · {p.reason}{" "}
                    {p.loanId && <span className="text-muted-foreground">· {p.loanId}</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{fmtKES(p.amount)}</span>
                    {pool >= p.amount &&
                      (currentUser.role === "manager" || currentUser.role === "director") && (
                        <button
                          onClick={async () => {
                            if (await settlePenaltyFromPool(p.id)) {
                              toast.success("Settled from pool");
                            } else {
                              toast.error("Pool short");
                            }
                          }}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                        >
                          Pay from pool
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <button
            onClick={() => onNewLoan(memberId, isFirstTime)}
            className="w-full bg-primary text-primary-foreground px-4 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90"
          >
            {isFirstTime ? "Give Loan → First-Time Application" : "Give Loan → Repeat Application"}
          </button>
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-2">Loan History ({totalLoanHistoryCount})</h3>
          {totalLoanHistoryCount === 0 && (
            <div className="text-xs text-muted-foreground">
              No prior loans. This will be the member's first loan.
            </div>
          )}
          <div className="space-y-2">
            {memberCarryoverLoans.map((l) => {
              const summary = summarizeLegacyCarryoverLoan(l, policySettings);
              const carryoverExpected = Math.max(
                summary.totalExpectedCollected,
                summary.totalRepayment,
              );
              const carryoverPaid = Math.min(Math.max(0, l.paidToDate), carryoverExpected);
              const pct =
                carryoverExpected > 0
                  ? Math.min(100, Math.round((carryoverPaid / carryoverExpected) * 100))
                  : 0;
              const displayStatus = trueLoanStatus({
                storedStatus: l.status,
                balance: summary.totalOwedNow,
                dueDate: summary.dueDate,
              });
              const isEditing = editing?.source === "carryover" && editing.id === l.id;
              return (
                <div key={l.id} className="border border-border rounded-md p-3">
                  <div className="flex justify-between items-center">
                    <div className="text-sm font-medium">
                      {l.id} · {fmtKES(l.principal)}
                    </div>
                    <Badge tone={trueLoanStatusTone(displayStatus) as never}>
                      {trueLoanStatusLabel(displayStatus)} · carryover
                    </Badge>
                  </div>
                  {canEditLoans && (
                    <button
                      type="button"
                      onClick={() => startCarryoverLoanEdit(l)}
                      className="mt-2 rounded-md border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
                    >
                      Edit details
                    </button>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {l.startDate} · {summary.termDays} days · {l.label}
                  </div>
                  <div className="text-xs mt-1">
                    Paid {fmtKES(carryoverPaid)} / {fmtKES(carryoverExpected)}
                  </div>
                  <LoanDetails
                    rows={[
                      ["Day given", l.startDate],
                      ["Amount", fmtKES(l.principal)],
                      [
                        "Interest / charge",
                        fmtKES(safeMoney(summary.interest + summary.feeChargesTotal)),
                      ],
                      [
                        "Manual penalties",
                        fmtKES(
                          Number(l.feeBreakdown?.priorPenaltyAmount ?? 0) ||
                            ownManualPenaltyAmount(l.feeBreakdown),
                        ),
                      ],
                      ["Penalty waived", fmtKES(l.penaltyWaivedAmount)],
                      ["Daily compliance", fmtKES(l.dailySavingsAmount)],
                      ["Total compliance", fmtKES(l.dailySavingsAmount * summary.termDays)],
                      ["Amount collected", fmtKES(carryoverPaid)],
                      ["Defaulted balance", fmtKES(summary.defaultedAmount)],
                    ]}
                  />
                  {isEditing && editDraft ? (
                    <LoanEditPanel
                      draft={editDraft}
                      source="carryover"
                      saving={savingEdit}
                      onChange={setEditDraft}
                      onCancel={() => {
                        setEditing(null);
                        setEditDraft(null);
                      }}
                      onSave={() => void saveLoanEdit()}
                    />
                  ) : null}
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <FuelEntriesDetails records={fuelRecordsForCarryoverLoan(l, member)} />
                </div>
              );
            })}
            {memberLoans.map((l) => {
              const summary = loanPenaltySummary(l, transactions);
              const liveExpected = Math.max(summary.totalExpectedCollected, summary.totalPaid);
              const livePaid = Math.min(Math.max(0, summary.totalPaid), liveExpected);
              const pct = Math.min(
                100,
                liveExpected > 0 ? Math.round((livePaid / liveExpected) * 100) : 0,
              );
              const displayStatus = trueLoanStatus({
                storedStatus: l.status,
                balance: summary.totalOwedNow,
                dueDate: summary.dueDate,
              });
              const isEditing = editing?.source === "live" && editing.id === l.id;
              return (
                <div key={l.id} className="border border-border rounded-md p-3">
                  <div className="flex justify-between items-center">
                    <div className="text-sm font-medium">
                      {l.id} · {fmtKES(l.principal)}
                    </div>
                    <Badge tone={trueLoanStatusTone(displayStatus) as never}>
                      {trueLoanStatusLabel(displayStatus)}
                    </Badge>
                  </div>
                  {canEditLoans && (
                    <button
                      type="button"
                      onClick={() => startLiveLoanEdit(l)}
                      className="mt-2 rounded-md border border-primary/40 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5"
                    >
                      Edit details
                    </button>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {l.startDate} · {summary.termDays} days · purpose: {l.purpose ?? "—"}
                  </div>
                  <div className="text-xs mt-1">
                    Paid {fmtKES(livePaid)} / {fmtKES(liveExpected)}
                  </div>
                  <LoanDetails
                    rows={[
                      ["Day given", l.startDate],
                      ["Amount", fmtKES(summary.approved)],
                      [
                        "Interest / charges",
                        fmtKES(safeMoney(summary.interest + loanProductChargeAmount(l))),
                      ],
                      ["Manual penalties", fmtKES(loanManualPenaltyAmount(l))],
                      ["Penalty waived", fmtKES(l.penaltyWaivedAmount ?? 0)],
                      ["Daily compliance", fmtKES(summary.dailySavingsAmount)],
                      ["Total compliance", fmtKES(summary.dailySavingsAmount * summary.termDays)],
                      ["Amount collected", fmtKES(livePaid)],
                      ["Defaulted balance", fmtKES(summary.defaultedAmount)],
                    ]}
                  />
                  {isEditing && editDraft ? (
                    <LoanEditPanel
                      draft={editDraft}
                      source="live"
                      saving={savingEdit}
                      onChange={setEditDraft}
                      onCancel={() => {
                        setEditing(null);
                        setEditDraft(null);
                      }}
                      onSave={() => void saveLoanEdit()}
                    />
                  ) : null}
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <FuelEntriesDetails records={fuelRecordsForLiveLoan(l, member)} />
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-2">Repayment History ({repayments.length})</h3>
          <div className="divide-y divide-border max-h-48 overflow-y-auto border border-border rounded-md">
            {repayments.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">No repayments yet.</div>
            )}
            {repayments.map((t) => (
              <div key={t.id} className="flex justify-between text-xs px-3 py-2">
                <span>
                  {t.date} · {t.loanId}
                </span>
                <span className="font-medium">{fmtKES(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {memberApraisals.length > 0 && (
          <div>
            <h3 className="font-semibold text-sm mb-2">Appraisals ({memberApraisals.length})</h3>
            <div className="space-y-1 text-xs">
              {memberApraisals.map((a) => (
                <div
                  key={a.id}
                  className="flex justify-between border border-border rounded-md px-3 py-2"
                >
                  <span>
                    {a.date} · {a.loanId ?? "—"}
                  </span>
                  <span>
                    <Badge
                      tone={
                        a.decision === "Approve"
                          ? "success"
                          : a.decision === "Reject"
                            ? "destructive"
                            : "warning"
                      }
                    >
                      {a.totalScore}/100 · {a.decision}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="font-semibold text-sm mb-2">All Transactions ({allTx.length})</h3>
          <div className="divide-y divide-border max-h-72 overflow-y-auto border border-border rounded-md text-xs">
            {allTx.length === 0 && (
              <div className="px-3 py-3 text-muted-foreground">No transactions yet.</div>
            )}
            {allTx.map((t) => (
              <div key={t.id} className="flex justify-between px-3 py-2">
                <span>
                  {t.date} · <span className="capitalize">{t.type.replace(/_/g, " ")}</span>{" "}
                  {t.loanId && <span className="text-muted-foreground">· {t.loanId}</span>}
                </span>
                <span className="font-medium">{fmtKES(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        {memberRoundOff.length > 0 && (
          <div>
            <h3 className="font-semibold text-sm mb-2">Round-Off Pool Activity</h3>
            <div className="divide-y divide-border border border-border rounded-md text-xs max-h-40 overflow-y-auto">
              {memberRoundOff.map((r) => (
                <div key={r.id} className="flex justify-between px-3 py-2">
                  <span>
                    {r.date} · {r.source.replace(/_/g, " ")}{" "}
                    {r.ref && <span className="text-muted-foreground">· {r.ref}</span>}
                  </span>
                  <span className="text-success font-medium">+{fmtKES(r.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LoanDetails({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 rounded-md bg-muted/35 px-2 py-1.5">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-right font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}

function LoanEditPanel({
  draft,
  source,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  draft: LoanEditDraft;
  source: "live" | "carryover";
  saving: boolean;
  onChange: (draft: LoanEditDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof LoanEditDraft>(key: K, value: LoanEditDraft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <EditNumber
          label="Amount given"
          value={draft.principal}
          onChange={(v) => set("principal", v)}
        />
        {source === "live" && (
          <EditNumber
            label="Approved amount"
            value={draft.approvedAmount}
            onChange={(v) => set("approvedAmount", v)}
          />
        )}
        <EditNumber label="Interest %" value={draft.rate} onChange={(v) => set("rate", v)} />
        <EditNumber label="Term days" value={draft.termDays} onChange={(v) => set("termDays", v)} />
        <label className="block">
          <span className="text-[10px] uppercase text-muted-foreground">Day given</span>
          <input
            type="date"
            value={draft.startDate}
            onChange={(event) => set("startDate", event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          />
        </label>
        <EditNumber label="Amount collected" value={draft.paid} onChange={(v) => set("paid", v)} />
        <EditNumber
          label="Manual penalties"
          value={draft.manualPenaltyAmount}
          onChange={(v) => set("manualPenaltyAmount", v)}
        />
        <EditNumber
          label="Penalty waived"
          value={draft.penaltyWaivedAmount}
          onChange={(v) => set("penaltyWaivedAmount", v)}
        />
        <EditNumber
          label={source === "live" ? "Product charge" : "Processing / charge"}
          value={draft.productChargeAmount}
          onChange={(v) => set("productChargeAmount", v)}
        />
        <EditNumber
          label="Daily compliance"
          value={draft.dailySavingsAmount}
          onChange={(v) => set("dailySavingsAmount", v)}
        />
        <label className="block">
          <span className="text-[10px] uppercase text-muted-foreground">Status</span>
          <select
            value={draft.status}
            onChange={(event) => set("status", event.target.value as LoanEditDraft["status"])}
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          >
            {["active", "defaulted", "closed", "pending", "rejected"].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[10px] uppercase text-muted-foreground">
            {source === "live" ? "Purpose" : "Label"}
          </span>
          <input
            value={draft.purpose}
            onChange={(event) => set("purpose", event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function EditNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value || ""}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs"
      />
    </label>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="bg-muted/40 border border-border rounded-md p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold mt-0.5">{v}</div>
    </div>
  );
}
