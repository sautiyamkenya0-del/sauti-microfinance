import { Section, StatCard, Badge } from "@/components/ui-bits";
import { useStore, fmtKES, loanSummary, SBC_FEES } from "@/lib/store";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, Building2, Home as HomeIcon, MapPin } from "lucide-react";

export function FollowUps() {
  const { loans, members, transactions, followups, addFollowup, currentUser } = useStore();

  const items = useMemo(() => {
    return loans
      .filter((l) => l.status === "active")
      .map((l) => {
        const summary = loanSummary(l);
        const days = summary.termDays;
        const total = summary.total;
        const dailyInstallment = total / days;
        const start = new Date(l.startDate);
        const today = new Date();
        const elapsedDays = Math.max(
          0,
          Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
        );
        const expected = Math.min(total, dailyInstallment * Math.min(days, elapsedDays));
        const defaulted = Math.max(0, expected - l.paid);
        const outstanding = summary.balance;
        const daysMissed = dailyInstallment > 0 ? Math.floor(defaulted / dailyInstallment) : 0;
        const penalties = defaulted * (SBC_FEES.penaltyDailyPct / 100);
        return {
          loan: l,
          member: members.find((m) => m.id === l.memberId)!,
          dailyInstallment,
          defaulted,
          outstanding,
          totalDue: outstanding + penalties,
          penalties,
          daysMissed,
        };
      })
      .filter((x) => x.defaulted > 0)
      .sort((a, b) => b.daysMissed - a.daysMissed);
  }, [loans, members, transactions]);

  const totalDefaulted = items.reduce((s, i) => s + i.defaulted, 0);
  const totalDue = items.reduce((s, i) => s + i.totalDue, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Clients Needing Follow-up" value={items.length} />
        <StatCard label="Defaulted Amount" value={fmtKES(totalDefaulted)} tone="destructive" />
        <StatCard label="Total Amount Due" value={fmtKES(totalDue)} tone="warning" />
        <StatCard label="Logged Follow-ups" value={followups.length} />
      </div>

      <Section title={`Loan Follow-ups (${items.length})`}>
        <div className="divide-y divide-border">
          {items.length === 0 && (
            <div className="px-5 py-8 text-sm text-muted-foreground">All loans are current.</div>
          )}
          {items.map(
            ({
              loan,
              member,
              dailyInstallment,
              defaulted,
              outstanding,
              totalDue,
              penalties,
              daysMissed,
            }) => {
              const memberFups = followups.filter((f) => f.loanId === loan.id);
              return (
                <div key={loan.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold uppercase">{member?.name}</h4>
                        <Badge tone="destructive">{daysMissed} day(s) missed</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Member: {member?.id} · Loan {loan.id} · {loan.purpose ?? "—"}
                      </div>
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
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted">
                      <Building2 className="h-3 w-3" /> Record Business Visit
                    </button>
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted">
                      <HomeIcon className="h-3 w-3" /> Record Home Visit
                    </button>
                    <button className="inline-flex items-center gap-1 px-3 py-1.5 border border-border rounded-md hover:bg-muted">
                      <MapPin className="h-3 w-3" /> Live Location
                    </button>
                  </div>

                  <FollowupForm
                    loanId={loan.id}
                    memberId={member.id}
                    onAdd={(note, outcome) => {
                      addFollowup({
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
  onAdd: (note: string, outcome: "promised" | "paid" | "no-show" | "dispute" | "other") => void;
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
        onClick={() => {
          if (!note.trim()) return;
          onAdd(note, outcome);
          setNote("");
        }}
        className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
      >
        Log
      </button>
    </div>
  );
}
