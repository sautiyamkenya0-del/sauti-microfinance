import { Section, Badge } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  loanDailySavingsAmount,
  loanSummary,
  loanTermDaysOf,
  type Loan,
} from "@/lib/store";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Filter =
  | "all"
  | "active"
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "defaulted"
  | "overdue";

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

function termDaysOf(l: Loan): number {
  return loanTermDaysOf(l);
}

function dueDateOf(l: Loan): string {
  return loanSummary(l).dueDate;
}

/** Daily savings tier as per common SBC plans: small loans → 50/day, larger → 100/day. */
function dailyTotalOf(l: Loan): number {
  return loanSummary(l).dailyCollectionAmount;
}

export function LoanBook({ onSelectMember }: { onSelectMember: (memberId: string) => void }) {
  const { loans, members, staff, currentUser, recordTransaction } = useStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [repayFor, setRepayFor] = useState<string | null>(null);
  const [repayAmt, setRepayAmt] = useState(0);

  const today = new Date().toISOString().slice(0, 10);

  const visible = useMemo(() => {
    let list =
      currentUser.role === "loan_officer"
        ? loans.filter((l) => l.officerId === currentUser.id)
        : loans;

    list = list.filter((l) => {
      switch (filter) {
        case "all":
          return true;
        case "active":
          return l.status === "active";
        case "pending":
          return l.status === "pending";
        case "approved":
          return l.status === "active" || l.status === "closed";
        case "rejected":
          return l.status === "rejected";
        case "completed":
          return l.status === "closed";
        case "defaulted":
          return l.status === "defaulted";
        case "overdue":
          return l.status === "active" && dueDateOf(l) < today;
        default:
          return true;
      }
    });

    if (activeQuery.trim()) {
      const q = activeQuery.trim().toLowerCase();
      list = list.filter((l) => {
        const m = members.find((x) => x.id === l.memberId);
        return [m?.id, m?.name, m?.phone, m?.businessName, l.id]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      });
    }
    return list.sort((a, b) => Number(b.id.replace(/\D/g, "")) - Number(a.id.replace(/\D/g, "")));
  }, [loans, members, filter, activeQuery, currentUser, today]);

  const empty = loans.length === 0;

  return (
    <Section
      title="All Loans"
      action={
        <span className="text-xs text-muted-foreground font-normal">
          {visible.length} loan record(s) shown
        </span>
      }
    >
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
          }}
          className="px-4 py-2 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted"
        >
          Reset
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Loan #</th>
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
                <td colSpan={10} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No loans yet — applications you create will appear here.
                </td>
              </tr>
            )}
            {!empty && visible.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No loans match this filter.
                </td>
              </tr>
            )}
            {visible.map((l) => {
              const m = members.find((x) => x.id === l.memberId);
              const o = staff.find((s) => s.id === l.officerId);
              const summary = loanSummary(l);
              const idNum = l.id.replace(/\D/g, "");
              const tone =
                l.status === "active"
                  ? "success"
                  : l.status === "closed"
                    ? "default"
                    : l.status === "pending"
                      ? "warning"
                      : l.status === "rejected"
                        ? "destructive"
                        : "destructive";
              return (
                <tr key={l.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{idNum}</td>
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
                    <Badge tone={tone as never}>
                      {l.status === "closed"
                        ? "Completed"
                        : l.status[0].toUpperCase() + l.status.slice(1)}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-xs">{fmtKES(summary.approved)}</td>
                  <td className="px-5 py-3 text-xs">{fmtKES(summary.balance)}</td>
                  <td className="px-5 py-3 text-xs leading-tight">
                    <div>{summary.termDays} days</div>
                    <div className="text-[11px] text-muted-foreground">
                      Savings {fmtKES(loanDailySavingsAmount(summary.approved))}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Daily total {fmtKES(dailyTotalOf(l))}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs">{summary.dueDate}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground truncate max-w-[120px]">
                    {o?.name ?? "—"}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => m && onSelectMember(m.id)}
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

export function MemberLoanHistory({
  memberId,
  onClose,
  onNewLoan,
}: {
  memberId: string;
  onClose: () => void;
  onNewLoan: (memberId: string, isFirstTime: boolean) => void;
}) {
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
  } = useStore();
  const member = members.find((m) => m.id === memberId);
  if (!member) return null;
  const memberLoans = loans.filter((l) => l.memberId === memberId);
  const repayments = transactions.filter(
    (t) => t.memberId === memberId && t.type === "loan_repayment",
  );
  const memberApraisals = appraisals.filter((a) => a.memberId === memberId);
  const allTx = transactions.filter((t) => t.memberId === memberId);
  const memberPenalties = penalties.filter((p) => p.memberId === memberId);
  const memberRoundOff = roundOff.filter((r) => r.memberId === memberId);
  const pool = roundOffBalance(memberId);
  const outstandingPen = memberPenalties.filter((p) => p.status === "outstanding");
  const isFirstTime = memberLoans.length === 0;

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
          <Stat label="Total Loans" v={String(memberLoans.length)} />
          <Stat label="Round-Off Pool" v={fmtKES(pool)} />
        </div>

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
          <h3 className="font-semibold text-sm mb-2">Loan History ({memberLoans.length})</h3>
          {memberLoans.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No prior loans. This will be the member's first loan.
            </div>
          )}
          <div className="space-y-2">
            {memberLoans.map((l) => {
              const summary = loanSummary(l);
              const pct = Math.min(100, Math.round((l.paid / summary.total) * 100));
              return (
                <div key={l.id} className="border border-border rounded-md p-3">
                  <div className="flex justify-between items-center">
                    <div className="text-sm font-medium">
                      {l.id} · {fmtKES(l.principal)}
                    </div>
                    <Badge
                      tone={
                        l.status === "active"
                          ? "default"
                          : l.status === "closed"
                            ? "success"
                            : l.status === "pending"
                              ? "warning"
                              : "destructive"
                      }
                    >
                      {l.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {l.startDate} · {summary.termDays} days · purpose: {l.purpose ?? "—"}
                  </div>
                  <div className="text-xs mt-1">
                    Paid {fmtKES(l.paid)} / {fmtKES(summary.total)}
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
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

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="bg-muted/40 border border-border rounded-md p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold mt-0.5">{v}</div>
    </div>
  );
}
