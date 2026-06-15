import { Section, StatCard, Badge } from "@/components/ui-bits";
import {
  createStaffMemoRecord,
  freezeLoanFollowupRecord,
  listMpesaReceiptAudit,
  unfreezeLoanFollowupRecord,
  unwaiveLoanFollowupPenaltyRecord,
  waiveLoanFollowupPenaltyRecord,
} from "@/lib/app-data.functions";
import { summarizeLegacyCarryoverLoan, type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import { dedupeMemberTransactions } from "@/lib/transaction-dedupe";
import { useStore, fmtKES, loanPenaltySummary, type Loan, type Transaction } from "@/lib/store";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, Phone, Building2, Home as HomeIcon, MapPin, ReceiptText, X } from "lucide-react";

function daysBetweenDates(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00`).getTime();
  const end = new Date(`${to.slice(0, 10)}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function dateFromDateTime(value?: string | null) {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : new Date().toISOString().slice(0, 10);
}

function receiptLoanRepayments(rows: any[]) {
  return rows.flatMap((row): Transaction[] => {
    const allocations = Array.isArray(row.allocations) ? row.allocations : [];
    const paidAt = row.exactReceivedAt ?? row.createdAt ?? row.date;
    return allocations
      .filter(
        (allocation: any) =>
          String(allocation.type ?? "") === "loan_repayment" &&
          String(allocation.loanId ?? "").trim() &&
          Number(allocation.amount ?? 0) > 0,
      )
      .map((allocation: any) => ({
        id: `mpesa-allocation-${allocation.id}`,
        date: dateFromDateTime(paidAt),
        createdAt: paidAt,
        type: "loan_repayment" as const,
        amount: Number(allocation.amount ?? 0),
        memberId: String(allocation.memberId ?? row.memberId ?? ""),
        loanId: String(allocation.loanId ?? ""),
        ref: row.mpesaRef ?? row.ref,
        by: "MPESA",
        note: allocation.note ?? row.note,
      }));
  });
}

export function FollowUps({ carryoverLoans = [] }: { carryoverLoans?: LegacyCarryoverLoan[] }) {
  const {
    loans,
    members,
    transactions,
    followups,
    addFollowup,
    currentUser,
    policySettings,
    reloadAppData,
  } = useStore();
  const sendNotice = useServerFn(createStaffMemoRecord);
  const fetchMpesaAudit = useServerFn(listMpesaReceiptAudit);
  const waiveLoanPenalty = useServerFn(waiveLoanFollowupPenaltyRecord);
  const unwaiveLoanPenalty = useServerFn(unwaiveLoanFollowupPenaltyRecord);
  const freezeLoan = useServerFn(freezeLoanFollowupRecord);
  const unfreezeLoan = useServerFn(unfreezeLoanFollowupRecord);
  const [query, setQuery] = useState("");
  const [historyLoanId, setHistoryLoanId] = useState<string | null>(null);
  const { data: mpesaAuditRows = [] } = useQuery({
    queryKey: ["followups-mpesa-repayment-audit"],
    queryFn: () => fetchMpesaAudit({ data: {} }),
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const accountingTransactions = useMemo(
    () => dedupeMemberTransactions([...transactions, ...receiptLoanRepayments(mpesaAuditRows)]),
    [mpesaAuditRows, transactions],
  );

  const items = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const uniqueTransactions = accountingTransactions;
    const uniqueLoanRepaymentTotals = new Map<string, number>();
    uniqueTransactions
      .filter((transaction) => transaction.type === "loan_repayment" && transaction.loanId)
      .forEach((transaction) => {
        uniqueLoanRepaymentTotals.set(
          transaction.loanId ?? "",
          (uniqueLoanRepaymentTotals.get(transaction.loanId ?? "") ?? 0) + transaction.amount,
        );
      });
    const displayLoanPaid = (loan: (typeof loans)[number]) => {
      const receiptBackedTotal = uniqueLoanRepaymentTotals.get(loan.id) ?? 0;
      return receiptBackedTotal > 0 ? receiptBackedTotal : loan.paid;
    };
    const liveItems = loans
      .filter((l) => !["pending", "rejected", "closed"].includes(l.status))
      .map((l) => {
        const summary = loanPenaltySummary({ ...l, paid: displayLoanPaid(l) }, uniqueTransactions);
        const isComplete = summary.totalOwedNow <= 0;
        const daysAfterFinalDueDate = Math.max(0, daysBetweenDates(summary.dueDate, today));
        const isOverdue = daysAfterFinalDueDate > 0;
        const dailyInstallment = summary.dailyExpected;
        const penalties = Math.ceil(summary.totalPenalty);
        const dailyPenalties = Math.ceil(summary.dailyPenalty);
        const dueDatePenalties = Math.ceil(summary.dueDatePenalty);
        const waivedPenalties = Math.ceil(summary.penaltyWaivedAmount);
        const dueNow = Math.ceil(summary.defaultedAmount);
        const missedDailyAmount = Math.max(0, dueNow - penalties);
        const outstanding = summary.totalOwedNow;
        const elapsedScheduledDays =
          l.startDate <= today ? Math.max(0, daysBetweenDates(l.startDate, today) + 1) : 0;
        const daysMissed = Math.min(
          elapsedScheduledDays,
          summary.repaymentLedger.filter(
            (row) => row.scheduledInstallment > 0 && row.dailyBalance > 0,
          ).length,
        );
        const daysPastDue = summary.daysPastDue;
        return {
          loan: l,
          loanKind: "live" as const,
          member: members.find((m) => m.id === l.memberId)!,
          dailyInstallment,
          defaulted: missedDailyAmount,
          outstanding,
          totalDue: dueNow,
          penalties,
          dailyPenalties,
          dueDatePenalties,
          waivedPenalties,
          daysMissed,
          daysPastDue: Math.max(daysPastDue, daysAfterFinalDueDate),
          dueDate: summary.dueDate,
          repaymentLedger: summary.repaymentLedger,
          totalPaid: summary.totalPaid,
          totalExpectedCollected: summary.totalExpectedCollected,
          frozen: Boolean(l.frozenAt),
          autoStopped: summary.autoStopped,
          include:
            !isComplete &&
            (Boolean(l.frozenAt) ||
              l.status === "defaulted" ||
              isOverdue ||
              missedDailyAmount > 0 ||
              penalties > 0),
        };
      })
      .filter((x) => x.member && x.include);
    const carryoverItems = carryoverLoans
      .filter((loan) => loan.status !== "closed" && !loan.finished)
      .map((loan) => {
        const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
        const isComplete = summary.totalOwedNow <= 0;
        const daysAfterFinalDueDate = Math.max(0, daysBetweenDates(summary.dueDate, today));
        const isOverdue = daysAfterFinalDueDate > 0;
        const dailyInstallment = summary.dailyInclusive;
        const arrears = summary.arrears;
        const defaulted = summary.defaultedAmount || arrears;
        const dailyPenalties = Math.ceil(summary.calculatedArrearsPenalty);
        const dueDatePenalties = Math.ceil(summary.overduePenalty);
        const waivedPenalties = Math.ceil(summary.penaltyWaivedAmount);
        const elapsedScheduledDays = summary.elapsedDays;
        const moneyMissedDays = dailyInstallment > 0 ? Math.ceil(arrears / dailyInstallment) : 0;
        const daysMissed = Math.min(elapsedScheduledDays, moneyMissedDays);
        const daysPastDue = summary.daysPastDue;
        return {
          loan: { ...loan, purpose: "carryover" },
          loanKind: "carryover" as const,
          member: members.find((m) => m.id === loan.memberId)!,
          dailyInstallment,
          defaulted,
          outstanding: summary.balance,
          totalDue: summary.totalOwedNow,
          penalties: summary.estimatedPenaltyNow,
          dailyPenalties,
          dueDatePenalties,
          waivedPenalties,
          daysMissed,
          daysPastDue: Math.max(daysPastDue, daysAfterFinalDueDate),
          dueDate: summary.dueDate,
          frozen: Boolean(summary.frozenAsOf),
          autoStopped: summary.autoStopped,
          include:
            !isComplete &&
            (Boolean(summary.frozenAsOf) ||
              loan.status === "defaulted" ||
              isOverdue ||
              arrears > 0 ||
              summary.estimatedPenaltyNow > 0),
        };
      })
      .filter((x) => x.member && x.include);
    const q = query.trim().toLowerCase();
    const list = [...liveItems, ...carryoverItems].filter((item) => {
      if (!q) return true;
      return [
        item.member?.name,
        item.member?.id,
        item.member?.phone,
        item.member?.businessName,
        item.loan.id,
        item.loan.purpose,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
    return list.sort((a, b) => {
      const byStartDate = String(b.loan.startDate ?? "").localeCompare(
        String(a.loan.startDate ?? ""),
      );
      if (byStartDate !== 0) return byStartDate;
      const byDueDate = String(b.dueDate ?? "").localeCompare(String(a.dueDate ?? ""));
      if (byDueDate !== 0) return byDueDate;
      return String(b.loan.id ?? "").localeCompare(String(a.loan.id ?? ""));
    });
  }, [accountingTransactions, carryoverLoans, loans, members, policySettings, query]);

  const totalDefaulted = items.reduce((s, i) => s + i.defaulted, 0);
  const totalDue = items.reduce((s, i) => s + i.totalDue, 0);
  const historyItem = items.find(
    (item): item is typeof item & { loanKind: "live"; loan: Loan } =>
      item.loanKind === "live" && item.loan.id === historyLoanId,
  );

  async function sendPaymentReminder(args: {
    memberId: string;
    memberName: string;
    loanId: string;
    amountDue: number;
    daysMissed: number;
    daysPastDue?: number;
    dueDate?: string;
  }) {
    await sendNotice({
      data: {
        title: "Payment reminder",
        body: `${args.memberName}, please pay ${fmtKES(args.amountDue)} for loan ${args.loanId}. ${
          args.daysPastDue && args.daysPastDue > 0
            ? `You are ${args.daysPastDue} day(s) after the final due date (${args.dueDate}).`
            : `You are ${args.daysMissed} day(s) behind.`
        } Contact your loan officer if you need help.`,
        by: currentUser.name,
        byStaffId: currentUser.id,
        date: new Date().toISOString().slice(0, 10),
        audience: "member",
        targetMemberId: args.memberId,
        kind: "warning",
      },
    });
    toast.success("Payment reminder sent to the member portal.");
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Clients Needing Follow-up" value={items.length} />
        <StatCard label="Defaulted Amount" value={fmtKES(totalDefaulted)} tone="destructive" />
        <StatCard label="Total Amount Due" value={fmtKES(totalDue)} tone="warning" />
        <StatCard label="Logged Follow-ups" value={followups.length} />
      </div>

      <Section title={`Loan Follow-ups (${items.length})`}>
        <div className="border-b border-border p-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search member, loan, phone, or business"
            className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm md:max-w-md"
          />
        </div>
        <div className="divide-y divide-border">
          {items.length === 0 && (
            <div className="px-5 py-8 text-sm text-muted-foreground">All loans are current.</div>
          )}
          {items.map(
            ({
              loan,
              loanKind,
              member,
              dailyInstallment,
              defaulted,
              outstanding,
              totalDue,
              penalties,
              dailyPenalties,
              dueDatePenalties,
              waivedPenalties,
              daysMissed,
              daysPastDue,
              dueDate,
              frozen,
              autoStopped,
            }) => {
              const memberFups = followups.filter((f) => f.loanId === loan.id);
              return (
                <div key={loan.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold uppercase">{member?.name}</h4>
                        <Badge tone="destructive">
                          {(daysPastDue ?? 0) > 0
                            ? `${daysPastDue} day(s) after final due date`
                            : `${daysMissed} day(s) missed`}
                        </Badge>
                        {frozen ? <Badge tone="warning">Frozen</Badge> : null}
                        {autoStopped ? <Badge tone="warning">Stopped at cap</Badge> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Member: {member?.id} · Loan {loan.id} · {loan.purpose ?? "—"}
                        {loanKind === "carryover" ? " · carryover" : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">Final due date {dueDate}</div>
                      <div className="text-xs">
                        <span className="font-medium">Phone:</span> {member?.phone}
                      </div>
                    </div>
                    <div className="text-xs text-right">
                      <div className="text-muted-foreground">Started</div>
                      <div className="font-medium">{loan.startDate}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2 text-xs">
                    <Cell label="Daily Installment" v={fmtKES(dailyInstallment)} />
                    <Cell label="Loan Portion / Day" v={fmtKES(dailyInstallment * 0.7)} />
                    <Cell label="Defaulted" v={fmtKES(defaulted)} tone="destructive" />
                    <Cell label="Outstanding" v={fmtKES(outstanding)} />
                    <Cell label="Penalties" v={fmtKES(penalties)} tone="warning" />
                    <Cell label="Daily Penalty" v={fmtKES(dailyPenalties)} tone="warning" />
                    <Cell label="Due Date Penalty" v={fmtKES(dueDatePenalties)} tone="warning" />
                    <Cell label="Total Due" v={fmtKES(totalDue)} tone="primary" />
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <a
                      href={`tel:${member?.phone}`}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted"
                    >
                      <Phone className="h-3 w-3" /> Call Client
                    </a>
                    <button
                      onClick={() =>
                        sendPaymentReminder({
                          memberId: member.id,
                          memberName: member.name,
                          loanId: loan.id,
                          amountDue: totalDue,
                          daysMissed,
                          daysPastDue,
                          dueDate,
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted"
                    >
                      <Bell className="h-3 w-3" /> Send Reminder
                    </button>
                    {loanKind === "live" ? (
                      <button
                        onClick={() => setHistoryLoanId(loan.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 hover:bg-muted"
                      >
                        <ReceiptText className="h-3 w-3" /> Repayment History
                      </button>
                    ) : null}
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted">
                      <Building2 className="h-3 w-3" /> Record Business Visit
                    </button>
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted">
                      <HomeIcon className="h-3 w-3" /> Record Home Visit
                    </button>
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted">
                      <MapPin className="h-3 w-3" /> Live Location
                    </button>
                    {currentUser.role === "director" ? (
                      <>
                        <button
                          onClick={async () => {
                            const amount = dailyPenalties;
                            if (amount <= 0) return toast.error("No daily penalty to waive.");
                            await waiveLoanPenalty({
                              data: {
                                loanId: loan.id,
                                loanKind,
                                amount,
                                note: "Director follow-up daily penalty waiver",
                              },
                            });
                            await reloadAppData();
                            toast.success("Daily penalty waiver saved.");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-warning/50 px-3 py-1.5 text-warning-foreground hover:bg-warning/10"
                        >
                          Waive Daily
                        </button>
                        <button
                          onClick={async () => {
                            const amount = dueDatePenalties;
                            if (amount <= 0) return toast.error("No due-date penalty to waive.");
                            await waiveLoanPenalty({
                              data: {
                                loanId: loan.id,
                                loanKind,
                                amount,
                                note: "Director follow-up due-date penalty waiver",
                              },
                            });
                            await reloadAppData();
                            toast.success("Due-date penalty waiver saved.");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-warning/50 px-3 py-1.5 text-warning-foreground hover:bg-warning/10"
                        >
                          Waive Due Date
                        </button>
                        <button
                          onClick={async () => {
                            if (penalties <= 0) return toast.error("No penalties to waive.");
                            await waiveLoanPenalty({
                              data: {
                                loanId: loan.id,
                                loanKind,
                                amount: penalties,
                                note: "Director follow-up full penalty waiver",
                              },
                            });
                            await reloadAppData();
                            toast.success("All current penalties waived.");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-warning/50 px-3 py-1.5 text-warning-foreground hover:bg-warning/10"
                        >
                          Waive All
                        </button>
                        <button
                          onClick={async () => {
                            if (waivedPenalties <= 0) {
                              toast.error("This loan has no waived penalties to restore.");
                              return;
                            }
                            const confirmed = window.confirm(
                              `Restore ${fmtKES(waivedPenalties)} waived penalties for loan ${loan.id}? This returns the member's lifetime penalties to the loan balance.`,
                            );
                            if (!confirmed) return;
                            await unwaiveLoanPenalty({
                              data: {
                                loanId: loan.id,
                                loanKind,
                                note: "Director follow-up unwaiver",
                              },
                            });
                            await reloadAppData();
                            toast.success("Waived penalties restored.");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-3 py-1.5 text-primary hover:bg-primary/10"
                        >
                          Unwaive {waivedPenalties > 0 ? fmtKES(waivedPenalties) : ""}
                        </button>
                        <button
                          onClick={async () => {
                            const confirmed = window.confirm(
                              `Freeze loan ${loan.id} at today's figures? Balances and penalties will stop aging from this date.`,
                            );
                            if (!confirmed) return;
                            await freezeLoan({
                              data: {
                                loanId: loan.id,
                                loanKind,
                                note: "Director stopped accrual from follow-ups",
                              },
                            });
                            await reloadAppData();
                            toast.success("Loan frozen at the current follow-up position.");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-3 py-1.5 text-destructive hover:bg-destructive/10"
                        >
                          Stop Loan
                        </button>
                        {frozen ? (
                          <button
                            onClick={async () => {
                              const confirmed = window.confirm(
                                `Resume penalty accrual for loan ${loan.id}? Penalties will recalculate from the current date context.`,
                              );
                              if (!confirmed) return;
                              await unfreezeLoan({
                                data: {
                                  loanId: loan.id,
                                  loanKind,
                                  note: "Director resumed accrual from follow-ups",
                                },
                              });
                              await reloadAppData();
                              toast.success("Penalty accrual resumed.");
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/50 px-3 py-1.5 text-primary hover:bg-primary/10"
                          >
                            Resume Penalties
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  <FollowupForm
                    loanId={loan.id}
                    memberId={member.id}
                    onAdd={async (note, outcome) => {
                      await addFollowup({
                        loanId: loan.id,
                        memberId: member.id,
                        note,
                        outcome,
                        by: currentUser.id,
                      });
                      toast.success("Follow-up logged");
                    }}
                  />
                  {memberFups.length > 0 && (
                    <div className="text-xs space-y-1 bg-muted/30 rounded-md p-3">
                      <div className="font-medium">Follow-up history ({memberFups.length})</div>
                      {memberFups.map((f) => (
                        <div key={f.id}>
                          · {f.date} —{" "}
                          <Badge
                            tone={
                              f.outcome === "paid"
                                ? "success"
                                : f.outcome === "promised"
                                  ? "default"
                                  : "warning"
                            }
                          >
                            {f.outcome}
                          </Badge>{" "}
                          {f.note}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            },
          )}
        </div>
      </Section>
      {historyItem ? (
        <RepaymentHistoryPanel item={historyItem} onClose={() => setHistoryLoanId(null)} />
      ) : null}
    </div>
  );
}

function RepaymentHistoryPanel({
  item,
  onClose,
}: {
  item: {
    member: { name: string; id: string; phone?: string };
    loan: Loan;
    dailyInstallment: number;
    repaymentLedger?: ReturnType<typeof loanPenaltySummary>["repaymentLedger"];
    totalPaid?: number;
    totalExpectedCollected?: number;
    outstanding: number;
    dueDate: string;
  };
  onClose: () => void;
}) {
  const rows = item.repaymentLedger ?? [];
  const paidDays = rows.filter(
    (row) => row.paidToday >= row.expectedToday && row.expectedToday > 0,
  );
  const shortDays = rows.filter((row) => row.expectedToday > 0 && row.dailyBalance > 0);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-5xl overflow-y-auto border-l border-border bg-card p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold">Loan Repayment History</h3>
            <p className="text-xs text-muted-foreground">
              {item.member.name} · {item.member.id} · Loan {item.loan.id} · final due {item.dueDate}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border p-2 hover:bg-muted"
            aria-label="Close repayment history"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          <Cell label="Daily Expected" v={fmtKES(item.dailyInstallment)} />
          <Cell label="Expected Total" v={fmtKES(item.totalExpectedCollected ?? 0)} />
          <Cell label="Paid So Far" v={fmtKES(item.totalPaid ?? 0)} />
          <Cell label="Short Days" v={String(shortDays.length)} tone="warning" />
          <Cell label="Outstanding" v={fmtKES(item.outstanding)} tone="destructive" />
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-border">
          <table className="min-w-[980px] w-full text-xs">
            <thead className="bg-muted/60 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Day</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Opening arrears</th>
                <th className="px-3 py-2 text-right">Expected today</th>
                <th className="px-3 py-2 text-right">Paid today</th>
                <th className="px-3 py-2 text-right">Short / over</th>
                <th className="px-3 py-2 text-right">Penalty</th>
                <th className="px-3 py-2 text-right">Total paid</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                    No scheduled repayment days have started yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const short = Math.max(0, row.dailyBalance);
                  const over = Math.max(0, row.paidToday - row.expectedToday);
                  const status =
                    row.scheduledInstallment <= 0
                      ? "After term"
                      : short > 0
                        ? "Short"
                        : row.paidToday > 0
                          ? "Paid"
                          : "No payment";
                  return (
                    <tr key={`${row.date}-${row.dayNumber}`}>
                      <td className="px-3 py-2">{row.dayNumber}</td>
                      <td className="px-3 py-2">{row.date}</td>
                      <td className="px-3 py-2 text-right">{fmtKES(row.openingCarryForward)}</td>
                      <td className="px-3 py-2 text-right">{fmtKES(row.expectedToday)}</td>
                      <td className="px-3 py-2 text-right">{fmtKES(row.paidToday)}</td>
                      <td className="px-3 py-2 text-right">
                        {short > 0 ? fmtKES(short) : over > 0 ? `+${fmtKES(over)}` : fmtKES(0)}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtKES(row.penalty)}</td>
                      <td className="px-3 py-2 text-right">{fmtKES(row.totalPaid)}</td>
                      <td className="px-3 py-2 text-right">{fmtKES(row.totalBalance)}</td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={short > 0 ? "warning" : row.paidToday > 0 ? "success" : "default"}
                        >
                          {status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Paid days: {paidDays.length}. A short day means the amount paid that day did not clear
          that day's expected amount plus any carried arrears.
        </div>
      </div>
    </div>
  );
}

function Cell({
  label,
  v,
  tone,
}: {
  label: string;
  v: string;
  tone?: "destructive" | "warning" | "primary";
}) {
  const cls =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning-foreground"
        : tone === "primary"
          ? "text-primary"
          : "";
  return (
    <div className="bg-muted/40 border border-border rounded-md p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-semibold mt-0.5 ${cls}`}>{v}</div>
    </div>
  );
}

function FollowupForm({
  onAdd,
}: {
  loanId: string;
  memberId: string;
  onAdd: (
    note: string,
    outcome: "promised" | "paid" | "no-show" | "dispute" | "other",
  ) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<"promised" | "paid" | "no-show" | "dispute" | "other">(
    "promised",
  );
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Quick follow-up note…"
        className="flex-1 min-w-[200px] bg-muted border border-border rounded-md px-3 py-2 text-sm"
      />
      <select
        value={outcome}
        onChange={(e) => setOutcome(e.target.value as any)}
        className="bg-muted border border-border rounded-md px-3 py-2 text-sm"
      >
        <option value="promised">Promised to pay</option>
        <option value="paid">Paid</option>
        <option value="no-show">No-show</option>
        <option value="dispute">Dispute</option>
        <option value="other">Other</option>
      </select>
      <button
        onClick={async () => {
          if (!note.trim()) return;
          await onAdd(note, outcome);
          setNote("");
        }}
        className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
      >
        Log
      </button>
    </div>
  );
}
