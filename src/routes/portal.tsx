import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Section, StatCard, Badge } from "@/components/ui-bits";
import { useStore, fmtKES, joinName, loanSummary } from "@/lib/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  PiggyBank,
  Banknote,
  Coins,
  AlertTriangle,
  Smartphone,
  User,
  MessageSquare,
  ArrowLeftRight,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { MemberPayDialog } from "@/components/MemberPayDialog";
import { MemberAIChat } from "@/components/MemberAIChat";
import type { Member } from "@/lib/store";
import { submitApproval } from "@/lib/approvals";
import { useFeesPolicy, isFeeActive, scopeLabel } from "@/lib/fees-policy";

type Tab = "overview" | "profile" | "loans" | "transactions" | "fees" | "support";
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "overview", label: "Overview", icon: PiggyBank },
  { id: "profile", label: "My Profile", icon: User },
  { id: "loans", label: "My Loans", icon: Banknote },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight },
  { id: "fees", label: "Fees", icon: Receipt },
  { id: "support", label: "Help / Chat", icon: MessageSquare },
];

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: "Member Portal — Sauti Microfinance" }] }),
  component: Portal,
});

const KEY = "sauti_portal_v1";

function Portal() {
  const { members, loans, transactions, penalties, roundOffBalance, currentUser } = useStore();
  // The Member Portal route lives inside the staff app; every signed-in user here
  // is staff (director / manager / loan_officer). Render it as a staff "view-as"
  // surface, not as if the staff member were the customer.
  const isStaffView = true;
  const [memberId, setMemberId] = useState<string>(
    () => localStorage.getItem(KEY) ?? members[0]?.id ?? "",
  );
  useEffect(() => {
    if (memberId) localStorage.setItem(KEY, memberId);
  }, [memberId]);
  const [tab, setTab] = useState<Tab>("overview");

  const member = members.find((m) => m.id === memberId);
  const myLoans = loans.filter((l) => l.memberId === memberId);
  const myTx = transactions.filter((t) => t.memberId === memberId);
  const myPen = penalties.filter((p) => p.memberId === memberId);
  const fees = useFeesPolicy().filter(isFeeActive);

  const [phone, setPhone] = useState(member?.phone ?? "");
  const [pinOld, setPinOld] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [payMember, setPayMember] = useState<Member | null>(null);
  useEffect(() => {
    setPhone(member?.phone ?? "");
  }, [member]);

  return (
    <>
      <AppHeader
        title="Member Portal"
        subtitle="Staff view-as: audit a member's profile, loans, fees and support thread."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        {isStaffView && (
          <div className="bg-accent/15 border border-accent/30 rounded-xl p-4 flex items-start gap-3 text-sm">
            <ShieldCheck className="h-5 w-5 text-accent mt-0.5" />
            <div>
              <div className="font-semibold">
                Staff view — viewing the portal as <span className="font-mono">{memberId}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                You are <span className="font-medium text-foreground">{currentUser.name}</span> (
                {currentUser.role}). Use this view to{" "}
                <span className="font-medium">audit a member's portal</span>: profile, loans, fees
                and support thread. Member-only actions (PIN reset, phone change) still go through
                the approvals queue.
              </div>
            </div>
          </div>
        )}
        <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[280px]">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {isStaffView ? "View member" : "Member sign-in"}
            </span>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-muted-foreground">
            M-Pesa Paybill account: <span className="font-mono text-foreground">{memberId}</span>
          </div>
          {member && !isStaffView && (
            <button
              onClick={() => setPayMember(member)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Smartphone className="h-4 w-4" /> Pay via M-Pesa
            </button>
          )}
          {member && isStaffView && (
            <button
              onClick={() => setPayMember(member)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border border-border hover:bg-muted"
            >
              <Smartphone className="h-4 w-4" /> Post payment for member
            </button>
          )}
        </div>

        {member && (
          <>
            {/* Member-side tab bar */}
            <div className="bg-card border border-border rounded-xl p-1 flex flex-wrap gap-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {tab === "overview" && (
              <>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard
                    label="Savings"
                    value={fmtKES(member.savingsBalance)}
                    hint={
                      member.savingsBalance < 1000 ? "Below mandatory 1,000" : "Above threshold"
                    }
                    icon={<PiggyBank className="h-5 w-5" />}
                    tone={member.savingsBalance < 1000 ? "destructive" : "success"}
                  />
                  <StatCard
                    label="Shares"
                    value={`${member.shares}`}
                    hint="Owned units"
                    icon={<Coins className="h-5 w-5" />}
                  />
                  <StatCard
                    label="Active loans"
                    value={`${myLoans.filter((l) => l.status === "active").length}`}
                    icon={<Banknote className="h-5 w-5" />}
                  />
                  <StatCard
                    label="Round-off pool"
                    value={fmtKES(roundOffBalance(memberId))}
                    hint="Use to settle penalties"
                    icon={<Coins className="h-5 w-5" />}
                    tone="success"
                  />
                </div>
                <Section title="My Penalties">
                  <div className="p-5 space-y-2 text-sm">
                    {myPen.length === 0 && (
                      <div className="text-muted-foreground">None — keep it up 💪</div>
                    )}
                    {myPen.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between border-b border-border pb-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-3 w-3 text-accent" />
                          {p.reason}
                        </div>
                        <span>
                          {fmtKES(p.amount)}{" "}
                          <Badge tone={p.status === "outstanding" ? "destructive" : "success"}>
                            {p.status}
                          </Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            )}

            {tab === "profile" && (
              <Section title="My Profile">
                <div className="p-5 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <Field label="Membership No." value={member.id} mono />
                  <Field
                    label="Status"
                    value={
                      <Badge tone={member.status === "active" ? "success" : "muted"}>
                        {member.status}
                      </Badge>
                    }
                  />
                  <Field label="Full name" value={joinName(member) || member.name} />
                  <Field label="First name" value={member.firstName} />
                  <Field label="Second name" value={member.secondName} />
                  <Field label="Third name" value={member.thirdName ?? member.lastName} />
                  <Field label="Phone" value={member.phone} />
                  <Field label="Email" value={member.email} />
                  <Field label="Gender" value={member.gender} />
                  <Field label="Date of birth" value={member.dob} />
                  <Field label="County" value={member.county} />
                  <Field label="City" value={member.city} />
                  <Field label="Village" value={member.village} />
                  <Field label="Address" value={member.address} />
                  <Field label="Joined on" value={member.joinedAt} />
                  <Field label="Old system ID" value={member.oldSystemId} />
                  <div className="sm:col-span-2 mt-2 pt-3 border-t border-border">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                      Business
                    </div>
                  </div>
                  <Field label="Business name" value={member.businessName} />
                  <Field label="Business type" value={member.businessType} />
                  <Field label="Business address" value={member.businessAddress} />
                  <Field label="Field officer" value={member.fieldOfficerId} />

                  <div className="sm:col-span-2 mt-2 pt-3 border-t border-border space-y-3">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Update phone (requires staff approval)
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <button
                        onClick={() => {
                          submitApproval({
                            kind: "profile_update",
                            title: "Phone number change",
                            detail: `${member.name} requests phone update from ${member.phone} → ${phone}`,
                            requestedBy: member.id,
                            requestedByName: member.name,
                            payload: { field: "phone", from: member.phone, to: phone },
                          });
                          toast.success("Submitted for approval");
                        }}
                        className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                      >
                        Submit
                      </button>
                    </div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground pt-2">
                      Change PIN
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="password"
                        value={pinOld}
                        onChange={(e) => setPinOld(e.target.value)}
                        placeholder="Current PIN"
                        className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        type="password"
                        value={pinNew}
                        onChange={(e) => setPinNew(e.target.value)}
                        placeholder="New PIN"
                        className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <button
                        onClick={() => {
                          if (pinNew.length < 4) return toast.error("PIN must be ≥4 digits");
                          submitApproval({
                            kind: "pin_change",
                            title: "PIN reset request",
                            detail: `${member.name} requests a PIN change.`,
                            requestedBy: member.id,
                            requestedByName: member.name,
                          });
                          toast.success("PIN change submitted");
                          setPinOld("");
                          setPinNew("");
                        }}
                        className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm"
                      >
                        Update PIN
                      </button>
                    </div>
                  </div>
                </div>
              </Section>
            )}

            {tab === "loans" && (
              <Section title={isStaffView ? "Member Loans (staff view)" : "My Loans"}>
                <div className="p-5 space-y-3">
                  {myLoans.length === 0 && (
                    <div className="text-sm text-muted-foreground">No loans on file.</div>
                  )}
                  {myLoans.map((l) => {
                    const summary = loanSummary(l);
                    const balance = summary.balance;
                    const end = new Date(summary.dueDate);
                    const daysLeft = Math.max(
                      1,
                      Math.ceil((end.getTime() - Date.now()) / 86_400_000),
                    );
                    const dailyDue = Math.ceil(balance / daysLeft);
                    const loanPenalties = penalties.filter((p) => p.loanId === l.id);
                    const outstandingPen = loanPenalties
                      .filter((p) => p.status === "outstanding")
                      .reduce((s, p) => s + p.amount, 0);
                    return (
                      <div
                        key={l.id}
                        className="border border-border rounded-md p-4 text-sm space-y-2"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-mono text-xs text-muted-foreground">{l.id}</div>
                            <div className="font-semibold">
                              {fmtKES(summary.approved)} · {l.rate}% · {summary.termDays} days
                            </div>
                            {l.purpose && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                Purpose: {l.purpose}
                              </div>
                            )}
                          </div>
                          <Badge
                            tone={
                              l.status === "active"
                                ? "warning"
                                : l.status === "closed"
                                  ? "success"
                                  : "default"
                            }
                          >
                            {l.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                          <Stat label="Total payable" value={fmtKES(summary.total)} />
                          <Stat label="Paid so far" value={fmtKES(l.paid)} />
                          <Stat
                            label="Outstanding"
                            value={fmtKES(balance)}
                            tone={balance > 0 ? "warning" : "success"}
                          />
                          <Stat
                            label={
                              l.status === "active"
                                ? `Daily required (${daysLeft}d left)`
                                : "Daily required"
                            }
                            value={l.status === "active" ? fmtKES(dailyDue) : "—"}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Started {l.startDate} · ends {summary.dueDate}
                        </div>
                        {loanPenalties.length > 0 && (
                          <div className="border-t border-border pt-2 mt-2 space-y-1">
                            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              Penalties on this loan ({loanPenalties.length})
                            </div>
                            {loanPenalties.map((p) => (
                              <div key={p.id} className="flex justify-between text-xs">
                                <span className="flex items-center gap-1.5">
                                  <AlertTriangle className="h-3 w-3 text-accent" />
                                  {p.reason} · {p.date}
                                </span>
                                <span>
                                  {fmtKES(p.amount)}{" "}
                                  <Badge
                                    tone={p.status === "outstanding" ? "destructive" : "success"}
                                  >
                                    {p.status}
                                  </Badge>
                                </span>
                              </div>
                            ))}
                            {outstandingPen > 0 && (
                              <div className="text-xs font-medium text-destructive">
                                Outstanding penalties: {fmtKES(outstandingPen)}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {tab === "transactions" && (
              <Section title="My Transactions">
                <div className="overflow-x-auto max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
                      <tr>
                        <th className="px-5 py-2.5 text-left">Date</th>
                        <th className="text-left">Type</th>
                        <th className="text-left">Note</th>
                        <th className="text-right pr-5">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {myTx.map((t) => (
                        <tr key={t.id}>
                          <td className="px-5 py-2">{t.date}</td>
                          <td>{t.type.replace(/_/g, " ")}</td>
                          <td className="text-muted-foreground">{t.note ?? t.ref ?? "—"}</td>
                          <td className="text-right pr-5">{fmtKES(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {tab === "fees" && (
              <Section title="Active Fees Set by Sauti">
                <div className="p-5 space-y-2">
                  {fees.length === 0 && (
                    <div className="text-sm text-muted-foreground">No active fees.</div>
                  )}
                  {fees.map((f) => (
                    <div
                      key={f.key}
                      className="flex items-center justify-between border-b border-border pb-2 text-sm"
                    >
                      <div>
                        <div className="font-medium">{f.label}</div>
                        <div className="text-xs text-muted-foreground">
                          Applies to: {scopeLabel(f.scope)} ·{" "}
                          {f.permanence === "permanent"
                            ? "Permanent"
                            : `Until ${f.durationDays}d after ${f.effectiveFrom}`}
                        </div>
                      </div>
                      <div className="font-semibold">{fmtKES(f.amount)}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {tab === "support" && <MemberAIChat member={member} />}
          </>
        )}
      </main>
      {payMember && (
        <MemberPayDialog member={payMember} mode="member" onClose={() => setPayMember(null)} />
      )}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 ${mono ? "font-mono text-xs" : ""}`}>
        {value ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warning" | "success";
}) {
  const cls =
    tone === "warning"
      ? "text-warning-foreground"
      : tone === "success"
        ? "text-success"
        : "text-foreground";
  return (
    <div className="bg-muted/50 rounded-md p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-medium ${cls}`}>{value}</div>
    </div>
  );
}
