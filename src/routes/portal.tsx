import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { Section, StatCard, Badge } from "@/components/ui-bits";
import {
  useStore,
  businessPermanenceLabel,
  fmtKES,
  joinName,
  loanSummary,
  memberNeedsSticker,
} from "@/lib/store";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  PiggyBank,
  Banknote,
  Coins,
  AlertTriangle,
  type LucideIcon,
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
import { useApprovalActions } from "@/lib/approvals";
import { feePolicyAppliesToMember, isFeeActive, scopeLabel } from "@/lib/fees-policy";
import {
  listMemberSupplierRequestsRecord,
  listSupplierWorkspaceRecord,
} from "@/lib/runtime-data.functions";

type Tab = "overview" | "profile" | "loans" | "transactions" | "fees" | "support";
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
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

function Portal() {
  const {
    staff,
    members,
    investors,
    loans,
    transactions,
    penalties,
    roundOffBalance,
    currentUser,
    authMode,
    portalMemberId,
    setPortalMemberId,
    logout,
    feePolicies,
  } = useStore();
  // The Member Portal route lives inside the staff app; every signed-in user here
  // is staff (director / manager / loan_officer). Render it as a staff "view-as"
  // surface, not as if the staff member were the customer.
  const isStaffView = authMode !== "member";
  const [memberId, setMemberId] = useState<string>(() => portalMemberId || members[0]?.id || "");
  useEffect(() => {
    if (authMode === "member") {
      setMemberId(portalMemberId);
      return;
    }
    if (!memberId && members[0]?.id) {
      setMemberId(members[0].id);
      setPortalMemberId(members[0].id);
    }
  }, [authMode, memberId, members, portalMemberId, setPortalMemberId]);
  useEffect(() => {
    if (!memberId) return;
    setPortalMemberId(memberId);
  }, [memberId, setPortalMemberId]);
  const [tab, setTab] = useState<Tab>("overview");

  const member = members.find((m) => m.id === memberId);
  const investorProfile = member
    ? investors.find((row) => row.id === member.investorId || row.memberId === member.id)
    : undefined;
  const fieldOfficerName =
    member?.fieldOfficerId && staff.find((person) => person.id === member.fieldOfficerId)?.name;
  const myLoans = loans.filter((l) => l.memberId === memberId);
  const myTx = transactions.filter(
    (t) =>
      t.memberId === memberId &&
      !String(t.note ?? "")
        .toLowerCase()
        .includes("purpose pool contribution"),
  );
  const myPen = penalties.filter((p) => p.memberId === memberId);
  const fees = feePolicies.filter(isFeeActive);
  const visibleFees = member
    ? fees.filter(
        (f) =>
          feePolicyAppliesToMember(
            f,
            {
              id: member.id,
              joinedAt: member.joinedAt,
              category: member.category,
              isInvestor: member.isInvestor,
            },
            {
              hasActiveLoan: myLoans.some((loan) => loan.status === "active"),
            },
          ) &&
          (f.key !== "sticker" || memberNeedsSticker(member)),
      )
    : fees;
  const { submit } = useApprovalActions();
  const loadMemberSupplierRequests = useServerFn(listMemberSupplierRequestsRecord);
  const loadSupplierWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const navigate = useNavigate();

  const [phone, setPhone] = useState(member?.phone ?? "");
  const [pinOld, setPinOld] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [payMember, setPayMember] = useState<Member | null>(null);
  const [supplierRequests, setSupplierRequests] = useState<any[]>([]);
  const [fuelLoanAmount, setFuelLoanAmount] = useState("");
  const [fuelLoanVehicle, setFuelLoanVehicle] = useState("");
  const [fuelLoanType, setFuelLoanType] = useState("");
  const [fuelLoanLitres, setFuelLoanLitres] = useState("");
  useEffect(() => {
    setPhone(member?.phone ?? "");
  }, [member]);
  useEffect(() => {
    if (authMode !== "member") return;
    loadSupplierWorkspace()
      .then(() => navigate({ to: "/suppliers" }))
      .catch(() => {});
  }, [authMode, loadSupplierWorkspace, navigate]);
  useEffect(() => {
    if (!memberId) {
      setSupplierRequests([]);
      return;
    }
    loadMemberSupplierRequests({
      data: isStaffView ? { memberId } : undefined,
    })
      .then((rows) => setSupplierRequests(rows))
      .catch(() => setSupplierRequests([]));
  }, [isStaffView, loadMemberSupplierRequests, memberId]);

  return (
    <>
      {isStaffView ? (
        <AppHeader
          title="Member Portal"
          subtitle="Staff view-as: audit a member's profile, loans, fees and support thread."
        />
      ) : (
        <header className="border-b border-border bg-card/70 px-6 py-5 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Sauti Microfinance
              </div>
              <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">
                Member Portal
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Track your daily compliance contribution, loans, fees, and support in one secure
                place.
              </p>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </header>
      )}
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
          {isStaffView ? (
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
          ) : (
            <div className="min-w-[280px] flex-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Signed in as
              </div>
              <div className="mt-1 rounded-md border border-border bg-muted/50 px-3 py-3 text-sm">
                <div className="font-medium text-foreground">{member?.name ?? "Member"}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{member?.id ?? memberId}</div>
              </div>
            </div>
          )}
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
                    label="Daily compliance contribution"
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
                {investorProfile && (
                  <Section title="My Investment">
                    <div className="grid gap-3 p-5 text-sm sm:grid-cols-4">
                      <Stat label="Investor ID" value={investorProfile.id} />
                      <Stat label="Contributed" value={fmtKES(investorProfile.contributed)} />
                      <Stat label="Equity" value={`${investorProfile.sharePct}%`} />
                      <Stat label="Joined" value={investorProfile.joinedAt} />
                    </div>
                  </Section>
                )}
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
                {supplierRequests.length > 0 && (
                  <Section title="Supplier-backed requests">
                    <div className="p-5 space-y-3 text-sm">
                      {supplierRequests.map((request) => (
                        <div key={request.id} className="rounded-md border border-border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium capitalize">
                              {request.kind} request / {request.supplierName}
                            </div>
                            <Badge
                              tone={
                                request.status === "fulfilled"
                                  ? "success"
                                  : request.status === "paid"
                                    ? "accent"
                                    : "warning"
                              }
                            >
                              {request.status}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {request.commodityName || request.fuelType || request.kind}
                            {request.vehiclePlate ? ` / ${request.vehiclePlate}` : ""}
                          </div>
                          {request.verificationCode ? (
                            <div className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                              Driver code:{" "}
                              <span className="font-mono font-semibold text-foreground">
                                {request.verificationCode}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
                {!isStaffView && member.category === "locomotive" && (
                  <Section title="Request fuel loan">
                    <div className="p-5 grid gap-3 sm:grid-cols-2">
                      <input
                        value={fuelLoanVehicle}
                        onChange={(event) => setFuelLoanVehicle(event.target.value)}
                        placeholder="Vehicle / plate"
                        className="bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        value={fuelLoanType}
                        onChange={(event) => setFuelLoanType(event.target.value)}
                        placeholder="Fuel type"
                        className="bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        value={fuelLoanLitres}
                        onChange={(event) => setFuelLoanLitres(event.target.value)}
                        placeholder="Litres requested"
                        className="bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <input
                        value={fuelLoanAmount}
                        onChange={(event) => setFuelLoanAmount(event.target.value)}
                        placeholder="Estimated amount"
                        className="bg-muted border border-border rounded-md px-3 py-2 text-sm"
                      />
                      <div className="sm:col-span-2">
                        <button
                          onClick={async () => {
                            await submit({
                              kind: "other",
                              title: "Fuel loan request",
                              detail: `${member.name} requests a fuel loan for ${fuelLoanVehicle || "vehicle"} / ${fuelLoanType || "fuel"} / ${fuelLoanLitres || "0"} litres / ${fuelLoanAmount || "0"} KES.`,
                              requestedBy: member.id,
                              requestedByName: member.name,
                              payload: {
                                requestType: "fuel_loan",
                                vehiclePlate: fuelLoanVehicle,
                                fuelType: fuelLoanType,
                                litres: fuelLoanLitres,
                                amount: fuelLoanAmount,
                              },
                            });
                            toast.success("Fuel loan request submitted for director approval");
                            setFuelLoanVehicle("");
                            setFuelLoanType("");
                            setFuelLoanLitres("");
                            setFuelLoanAmount("");
                          }}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Submit fuel request
                        </button>
                      </div>
                    </div>
                  </Section>
                )}
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
                  <Field
                    label="Business setup"
                    value={businessPermanenceLabel(member.businessPermanence)}
                  />
                  <Field label="Business address" value={member.businessAddress} />
                  <Field label="Field officer" value={fieldOfficerName ?? member.fieldOfficerId} />

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
                        onClick={async () => {
                          await submit({
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
                        onClick={async () => {
                          if (pinNew.length < 4) return toast.error("PIN must be ≥4 digits");
                          await submit({
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
                          <td className="px-5 py-2">
                            {t.createdAt ? new Date(t.createdAt).toLocaleString() : t.date}
                          </td>
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
                  {visibleFees.length === 0 && (
                    <div className="text-sm text-muted-foreground">No active fees.</div>
                  )}
                  {visibleFees.map((f) => (
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
