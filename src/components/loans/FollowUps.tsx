import { Section, StatCard, Badge } from "@/components/ui-bits";
import {
  createStaffMemoRecord,
  freezeLoanFollowupRecord,
  waiveLoanFollowupPenaltyRecord,
} from "@/lib/app-data.functions";
import { summarizeLegacyCarryoverLoan, type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import { useStore, fmtKES, loanPenaltySummary, type Transaction } from "@/lib/store";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, Phone, Building2, Home as HomeIcon, MapPin } from "lucide-react";

function daysBetweenDates(from: string, to: string) {
  const start = new Date(`${from.slice(0, 10)}T00:00:00`).getTime();
  const end = new Date(`${to.slice(0, 10)}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function receiptKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function dedupeLoanRepayments(rows: Transaction[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (row.type !== "loan_repayment") return true;
    const ref = receiptKey(row.ref);
    const key = ref ? `${row.type}|${row.loanId ?? ""}|${row.amount}|${ref}` : `id|${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
  const waiveLoanPenalty = useServerFn(waiveLoanFollowupPenaltyRecord);
  const freezeLoan = useServerFn(freezeLoanFollowupRecord);
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const uniqueTransactions = dedupeLoanRepayments(transactions);
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
      return receiptBackedTotal > 0 && receiptBackedTotal < loan.paid
        ? receiptBackedTotal
        : loan.paid;
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
        const dueNow = Math.ceil(summary.defaultedAmount);
        const missedDailyAmount = Math.max(0, dueNow - penalties);
        const outstanding = summary.totalOwedNow;
        const elapsedScheduledDays =
          l.startDate <= today ? Math.max(0, daysBetweenDates(l.startDate, today) + 1) : 0;
        const moneyMissedDays =
          dailyInstallment > 0 ? Math.ceil(missedDailyAmount / dailyInstallment) : 0;
        const daysMissed = Math.min(
          elapsedScheduledDays,
          Math.max(summary.skippedPaymentDays, moneyMissedDays),
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
          daysMissed,
          daysPastDue: Math.max(daysPastDue, daysAfterFinalDueDate),
          dueDate: summary.dueDate,
          frozen: Boolean(l.frozenAt),
          autoStopped: summary.autoStopped,
          include:
            !isComplete &&
            (l.status === "defaulted" || isOverdue || missedDailyAmount > 0 || penalties > 0),
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
          daysMissed,
          daysPastDue: Math.max(daysPastDue, daysAfterFinalDueDate),
          dueDate: summary.dueDate,
          frozen: Boolean(summary.frozenAsOf),
          autoStopped: summary.autoStopped,
          include:
            !isComplete &&
            (loan.status === "defaulted" ||
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
  }, [carryoverLoans, loans, members, policySettings, query, transactions]);

  const totalDefaulted = items.reduce((s, i) => s + i.defaulted, 0);
  const totalDue = items.reduce((s, i) => s + i.totalDue, 0);

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

                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                    <Cell label="Daily Installment" v={fmtKES(dailyInstallment)} />
                    <Cell label="Loan Portion / Day" v={fmtKES(dailyInstallment * 0.7)} />
                    <Cell label="Defaulted" v={fmtKES(defaulted)} tone="destructive" />
                    <Cell label="Outstanding" v={fmtKES(outstanding)} />
                    <Cell label="Penalties" v={fmtKES(penalties)} tone="warning" />
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
                            const raw = window.prompt(
                              `Penalty amount to waive for ${loan.id}`,
                              String(Math.ceil(penalties)),
                            );
                            if (raw == null) return;
                            const amount = Number(raw);
                            if (!Number.isFinite(amount) || amount <= 0) {
                              toast.error("Enter a waiver amount above zero.");
                              return;
                            }
                            await waiveLoanPenalty({
                              data: {
                                loanId: loan.id,
                                loanKind,
                                amount,
                                note: "Director follow-up waiver",
                              },
                            });
                            await reloadAppData();
                            toast.success("Penalty waiver saved.");
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-warning/50 px-3 py-1.5 text-warning-foreground hover:bg-warning/10"
                        >
                          Waive Penalty
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
