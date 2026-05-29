import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Section, StatCard, Badge } from "@/components/ui-bits";
import { summarizeLegacyCarryoverLoan, type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import {
  useStore,
  businessPermanenceLabel,
  fmtKES,
  joinName,
  loanSummary,
  memberIsServiceOnly,
  memberNeedsSticker,
} from "@/lib/store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Bell,
  Wallet,
} from "lucide-react";
import { MemberPayDialog } from "@/components/MemberPayDialog";
import { MemberAIChat } from "@/components/MemberAIChat";
import { downloadLetterheadHtml, LetterheadDocument } from "@/components/LetterheadDocument";
import type { Member } from "@/lib/store";
import { useApprovalActions } from "@/lib/approvals";
import { feePolicyAppliesToMember, isFeeActive, scopeLabel } from "@/lib/fees-policy";
import { listMpesaReceiptAudit } from "@/lib/app-data.functions";
import {
  listClientNotices,
  listMemberSelfServiceWorkspaceRecord,
  listPortalCarryoverLoans,
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
const PORTAL_MENU_TABS = TABS.filter((tab) => tab.id !== "support");

type ClientNotice = {
  id: string;
  date: string;
  title: string;
  body: string;
  by: string;
  kind?: "info" | "warning" | "alert";
  expiresAt?: string;
  documentKind?: "memo" | "letter";
  letterMeta?: Record<string, unknown>;
};

type ClientAlert = {
  id: string;
  kind: "info" | "warning" | "alert";
  title: string;
  detail: string;
  tab?: Tab;
};

function noticeKind(value?: string): ClientAlert["kind"] {
  return value === "alert" || value === "warning" ? value : "info";
}

function alertTone(kind: ClientAlert["kind"]): "default" | "warning" | "destructive" {
  if (kind === "alert") return "destructive";
  if (kind === "warning") return "warning";
  return "default";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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
    policySettings,
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
  const [loanRequestAmount, setLoanRequestAmount] = useState("");
  const [loanRequestDays, setLoanRequestDays] = useState("30");
  const [loanRequestPurpose, setLoanRequestPurpose] = useState("");

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
  const canRequestLoans = member ? !memberIsServiceOnly(member) : false;
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
  const loadClientNotices = useServerFn(listClientNotices);
  const loadCarryoverLoans = useServerFn(listPortalCarryoverLoans);
  const loadSupplierWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const fetchMpesaAudit = useServerFn(listMpesaReceiptAudit);
  const navigate = useNavigate();

  const [phone, setPhone] = useState(member?.phone ?? "");
  const [pinOld, setPinOld] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [payMember, setPayMember] = useState<Member | null>(null);
  const [clientNotices, setClientNotices] = useState<ClientNotice[]>([]);
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);
  const [clientReadIds, setClientReadIds] = useState<Set<string>>(new Set());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification === "undefined" ? "denied" : Notification.permission,
  );
  const [serviceWorkspace, setServiceWorkspace] = useState<{
    services: any[];
    subscriptions: any[];
    stockItems: any[];
    requests: any[];
    serviceWalletBalance: number;
  }>({
    services: [],
    subscriptions: [],
    stockItems: [],
    requests: [],
    serviceWalletBalance: 0,
  });
  const loadServiceWorkspace = useServerFn(listMemberSelfServiceWorkspaceRecord);
  const [fuelLoanAmount, setFuelLoanAmount] = useState("");
  const [fuelLoanVehicle, setFuelLoanVehicle] = useState("");
  const [fuelLoanType, setFuelLoanType] = useState("");
  const [fuelLoanLitres, setFuelLoanLitres] = useState("");
  const [vehicleChangePlate, setVehicleChangePlate] = useState("");
  const [vehicleChangeReason, setVehicleChangeReason] = useState("");
  const [stockRequestItemId, setStockRequestItemId] = useState("");
  const [stockRequestQuantity, setStockRequestQuantity] = useState("");
  const [stockRequestPurpose, setStockRequestPurpose] = useState("");
  useEffect(() => {
    setPhone(member?.phone ?? "");
  }, [member]);
  useEffect(() => {
    if (!memberId || typeof window === "undefined") {
      setClientReadIds(new Set());
      return;
    }
    try {
      const raw = window.localStorage.getItem(`sauti-client-notifications:${memberId}`);
      setClientReadIds(new Set(raw ? JSON.parse(raw) : []));
    } catch {
      setClientReadIds(new Set());
    }
  }, [memberId]);
  useEffect(() => {
    const refreshNotices = () =>
      loadClientNotices({ data: isStaffView ? { memberId } : undefined })
        .then((rows) => setClientNotices(rows as ClientNotice[]))
        .catch(() => setClientNotices([]));
    refreshNotices();
    const timer = window.setInterval(refreshNotices, 60000);
    window.addEventListener("focus", refreshNotices);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshNotices);
    };
  }, [isStaffView, loadClientNotices, memberId]);
  useEffect(() => {
    if (!memberId) {
      setCarryoverLoans([]);
      setServiceWorkspace({
        services: [],
        subscriptions: [],
        stockItems: [],
        requests: [],
        serviceWalletBalance: 0,
      });
      return;
    }
    loadCarryoverLoans({ data: isStaffView ? { memberId } : {} })
      .then((rows) => setCarryoverLoans(rows as LegacyCarryoverLoan[]))
      .catch(() => setCarryoverLoans([]));
    loadServiceWorkspace({ data: isStaffView ? { memberId } : { memberId } })
      .then((workspace) =>
        setServiceWorkspace({
          services: (workspace as any).services ?? [],
          subscriptions: (workspace as any).subscriptions ?? [],
          stockItems: (workspace as any).stockItems ?? [],
          requests: (workspace as any).requests ?? [],
          serviceWalletBalance: Number((workspace as any).serviceWalletBalance ?? 0),
        }),
      )
      .catch(() =>
        setServiceWorkspace({
          services: [],
          subscriptions: [],
          stockItems: [],
          requests: [],
          serviceWalletBalance: 0,
        }),
      );
  }, [isStaffView, loadCarryoverLoans, loadServiceWorkspace, memberId]);
  useEffect(() => {
    setVehicleChangePlate(member?.vehiclePlate ?? "");
  }, [member?.vehiclePlate]);
  useEffect(() => {
    if (stockRequestItemId || !serviceWorkspace.stockItems[0]?.id) return;
    setStockRequestItemId(String(serviceWorkspace.stockItems[0].id));
  }, [serviceWorkspace.stockItems, stockRequestItemId]);
  useEffect(() => {
    if (authMode !== "member") return;
    loadSupplierWorkspace()
      .then(() => navigate({ to: "/supplier-portal" }))
      .catch(() => {});
  }, [authMode, loadSupplierWorkspace, navigate]);
  const { data: mpesaReceiptRows = [] } = useQuery({
    queryKey: ["portal-mpesa-receipts", memberId, isStaffView],
    queryFn: () => fetchMpesaAudit({ data: isStaffView ? { memberId } : {} }),
    enabled: !!memberId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
  const clientLetters = useMemo(
    () => clientNotices.filter((notice) => notice.documentKind === "letter"),
    [clientNotices],
  );
  const canRequestStock =
    !!member &&
    !memberIsServiceOnly(member) &&
    (member.category === "stock" || member.memberTags?.includes("stock"));
  const selectedStockItem = serviceWorkspace.stockItems.find(
    (item) => String(item.id) === stockRequestItemId,
  );

  const clientAlerts = useMemo<ClientAlert[]>(() => {
    if (!member) return [];
    const out: ClientAlert[] = [];
    const today = todayIso();

    clientNotices
      .filter((notice) => notice.documentKind !== "letter")
      .forEach((notice) => {
        out.push({
          id: `notice-${notice.id}`,
          kind: noticeKind(notice.kind),
          title: notice.title,
          detail: notice.body,
          tab: "overview",
        });
      });

    const compliancePaidToday = myTx.some(
      (transaction) =>
        transaction.date.slice(0, 10) === today &&
        (transaction.type === "deposit" || transaction.type === "loan_repayment"),
    );
    if (!compliancePaidToday) {
      out.push({
        id: `daily-compliance-${member.id}-${today}`,
        kind: "warning",
        title: "Daily compliance contribution not made",
        detail: "No deposit or loan repayment has been recorded for today.",
        tab: "transactions",
      });
    }

    myPen
      .filter((penalty) => penalty.status === "outstanding")
      .forEach((penalty) => {
        out.push({
          id: `penalty-${penalty.id}`,
          kind: "warning",
          title: "Penalty pending",
          detail: `${penalty.reason} / ${fmtKES(penalty.amount)}`,
          tab: "loans",
        });
      });

    myLoans
      .filter((loan) => loan.status === "active")
      .forEach((loan) => {
        const summary = loanSummary(loan);
        if (summary.balance <= 0) return;
        const dueDate = new Date(summary.dueDate);
        const daysLeft = Math.max(1, Math.ceil((dueDate.getTime() - Date.now()) / 86_400_000));
        const dailyDue = Math.ceil(summary.balance / daysLeft);
        const paidToday = myTx
          .filter(
            (transaction) =>
              transaction.type === "loan_repayment" &&
              transaction.loanId === loan.id &&
              transaction.date.slice(0, 10) === today,
          )
          .reduce((sum, transaction) => sum + transaction.amount, 0);
        if (paidToday >= dailyDue) return;
        out.push({
          id: `daily-loan-${loan.id}-${today}`,
          kind: "alert",
          title: "Daily loan repayment not completed",
          detail: `${loan.id}: ${fmtKES(Math.max(0, dailyDue - paidToday))} still due today`,
          tab: "loans",
        });
      });

    myTx
      .filter(
        (transaction) =>
          transaction.date.slice(0, 10) === today &&
          ["deposit", "loan_repayment", "fee_payment", "share_purchase"].includes(transaction.type),
      )
      .slice(0, 5)
      .forEach((transaction) => {
        out.push({
          id: `receipt-${transaction.id}`,
          kind: "info",
          title: "Payment received",
          detail: `${transaction.type.replace(/_/g, " ")} / ${fmtKES(transaction.amount)}`,
          tab: "transactions",
        });
      });

    return out;
  }, [clientNotices, member, myLoans, myPen, myTx]);

  async function downloadClientLetter(notice: ClientNotice) {
    if (notice.documentKind !== "letter") return;
    const meta = notice.letterMeta ?? {};
    await downloadLetterheadHtml({
      title: notice.title,
      body: notice.body,
      date: notice.date,
      recipientName: String(meta.recipientName ?? ""),
      recipientId: String(meta.recipientId ?? notice.by),
      facts: Array.isArray(meta.facts) ? (meta.facts as any[]) : [],
      filename: `${notice.date}-${notice.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "letter"}`,
    });
  }
  const unreadClientAlerts = useMemo(
    () => clientAlerts.filter((alert) => !clientReadIds.has(alert.id)),
    [clientAlerts, clientReadIds],
  );
  const myCarryoverLoans = carryoverLoans.filter((loan) => loan.memberId === memberId);
  const announcedClientIdsRef = useRef(new Set<string>());
  const markClientAlertsRead = useCallback(
    (ids: string | string[]) => {
      if (!memberId || typeof window === "undefined") return;
      const values = Array.isArray(ids) ? ids : [ids];
      setClientReadIds((current) => {
        const next = new Set(current);
        values.forEach((id) => next.add(id));
        window.localStorage.setItem(
          `sauti-client-notifications:${memberId}`,
          JSON.stringify([...next]),
        );
        return next;
      });
    },
    [memberId],
  );
  const enablePhoneAlerts = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  }, []);

  useEffect(() => {
    if (isStaffView || typeof window === "undefined") return;
    const incoming = unreadClientAlerts.filter(
      (alert) => !announcedClientIdsRef.current.has(alert.id),
    );
    if (!incoming.length) return;
    incoming.forEach((alert) => announcedClientIdsRef.current.add(alert.id));
    const lead = incoming.find((alert) => alert.kind === "alert") ?? incoming[0];
    toast(lead.title, {
      description:
        incoming.length > 1 ? `${lead.detail} (+${incoming.length - 1} more)` : lead.detail,
    });
    navigator.vibrate?.(lead.kind === "alert" ? [180, 80, 180] : [120]);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(lead.title, {
        body: lead.detail,
        icon: "/favicon.png",
        tag: lead.id,
      });
    }
  }, [isStaffView, unreadClientAlerts]);

  return (
    <>
      {isStaffView ? (
        <AppHeader
          title="Member Portal"
          subtitle="Staff view-as: audit a member's profile, loans, fees and support thread."
        />
      ) : (
        <header className="border-b border-border bg-card/70 px-4 pb-4 pt-0 backdrop-blur sm:px-6">
          <div className="safe-area-spacer md:hidden" />
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 pt-3 sm:pt-5">
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
            <div className="flex flex-wrap items-center gap-2">
              {notificationPermission === "default" ? (
                <button
                  onClick={() => void enablePhoneAlerts()}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  <Bell className="h-4 w-4" /> Enable alerts
                </button>
              ) : null}
              <button
                onClick={() => {
                  setTab("overview");
                  markClientAlertsRead(unreadClientAlerts.map((alert) => alert.id));
                }}
                className="relative inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Bell className="h-4 w-4" />
                Alerts
                {unreadClientAlerts.length > 0 ? (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                    {unreadClientAlerts.length}
                  </span>
                ) : null}
              </button>
              <button
                onClick={() => void logout()}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>
      )}
      <main className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
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
            <div className="rounded-xl border border-border bg-card p-3 sm:hidden">
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Menu
                </span>
                <select
                  value={tab === "support" ? "overview" : tab}
                  onChange={(event) => setTab(event.target.value as Tab)}
                  className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                >
                  {PORTAL_MENU_TABS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => setTab("support")}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <MessageSquare className="h-4 w-4" /> Help / Chat
              </button>
            </div>
            <div className="hidden bg-card border border-border rounded-xl p-1 sm:flex flex-wrap gap-1">
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
                <Section
                  title={`My Notifications (${unreadClientAlerts.length} unread)`}
                  action={
                    clientAlerts.length > 0 ? (
                      <button
                        onClick={() => markClientAlertsRead(clientAlerts.map((alert) => alert.id))}
                        className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        Mark all read
                      </button>
                    ) : null
                  }
                >
                  <div className="space-y-2 p-5 text-sm">
                    {clientAlerts.length === 0 ? (
                      <div className="text-muted-foreground">
                        No client notifications right now.
                      </div>
                    ) : null}
                    {clientAlerts.map((alert) => (
                      <button
                        key={alert.id}
                        type="button"
                        onClick={() => {
                          if (alert.tab) setTab(alert.tab);
                          markClientAlertsRead(alert.id);
                        }}
                        className={`flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left hover:bg-muted ${
                          clientReadIds.has(alert.id)
                            ? "border-border bg-background"
                            : "border-primary/40 bg-primary/5"
                        }`}
                      >
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            alert.kind === "alert"
                              ? "bg-destructive"
                              : alert.kind === "warning"
                                ? "bg-accent"
                                : "bg-primary"
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{alert.title}</span>
                            <Badge tone={alertTone(alert.kind)}>{alert.kind}</Badge>
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {alert.detail}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </Section>
                {clientLetters.length > 0 ? (
                  <Section
                    title="Official letters"
                    action={
                      <button
                        onClick={() =>
                          clientLetters.forEach((letter) => void downloadClientLetter(letter))
                        }
                        className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      >
                        Download all
                      </button>
                    }
                  >
                    <div className="space-y-2 p-5 text-sm">
                      {clientLetters.map((letter) => (
                        <div
                          key={letter.id}
                          className="rounded-md border border-border bg-card p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold">{letter.title}</div>
                              <div className="text-xs text-muted-foreground">{letter.date}</div>
                            </div>
                            <button
                              onClick={() => void downloadClientLetter(letter)}
                              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                            >
                              Download letter
                            </button>
                          </div>
                          <div className="mt-3 max-w-3xl">
                            <LetterheadDocument
                              title={letter.title}
                              body={letter.body}
                              date={letter.date}
                              recipientName={String(
                                letter.letterMeta?.recipientName ?? member.name,
                              )}
                              recipientId={String(letter.letterMeta?.recipientId ?? member.id)}
                              facts={
                                Array.isArray(letter.letterMeta?.facts)
                                  ? (letter.letterMeta.facts as any[])
                                  : []
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                ) : null}
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
                {serviceWorkspace.serviceWalletBalance > 0 ||
                serviceWorkspace.subscriptions.length > 0 ? (
                  <Section title="Service wallet">
                    <div className="grid gap-3 p-5 sm:grid-cols-3">
                      <StatCard
                        label="Service wallet"
                        value={fmtKES(serviceWorkspace.serviceWalletBalance)}
                        icon={<Wallet className="h-5 w-5" />}
                        tone={serviceWorkspace.serviceWalletBalance > 0 ? "success" : "default"}
                      />
                      <StatCard
                        label="Active services"
                        value={`${serviceWorkspace.subscriptions.length}`}
                        icon={<ShieldCheck className="h-5 w-5" />}
                      />
                      <StatCard
                        label="Service requests"
                        value={`${serviceWorkspace.requests.length}`}
                        icon={<MessageSquare className="h-5 w-5" />}
                      />
                    </div>
                    {serviceWorkspace.subscriptions.length > 0 ? (
                      <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2">
                        {serviceWorkspace.subscriptions.map((subscription: any) => {
                          const service =
                            serviceWorkspace.services.find(
                              (row) =>
                                String(row.id) ===
                                String(subscription.service_id ?? subscription.serviceId),
                            ) ?? subscription.service;
                          return (
                            <div
                              key={subscription.id}
                              className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                            >
                              <div className="font-medium">
                                {service?.name ?? subscription.service_id ?? "Service"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fmtKES(Number(service?.price ?? 0))} /{" "}
                                {String(
                                  service?.billingFrequency ??
                                    service?.billing_frequency ??
                                    "monthly",
                                ).replace(/_/g, " ")}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </Section>
                ) : null}
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
                {!isStaffView && canRequestLoans && (
                  <Section title="Request loan">
                    <div className="grid gap-3 p-5 sm:grid-cols-3">
                      <input
                        value={loanRequestAmount}
                        onChange={(event) => setLoanRequestAmount(event.target.value)}
                        placeholder="Amount"
                        type="number"
                        min={1}
                        className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
                      />
                      <input
                        value={loanRequestDays}
                        onChange={(event) => setLoanRequestDays(event.target.value)}
                        placeholder="Repayment days"
                        type="number"
                        min={1}
                        className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
                      />
                      <input
                        value={loanRequestPurpose}
                        onChange={(event) => setLoanRequestPurpose(event.target.value)}
                        placeholder="Purpose"
                        className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
                      />
                      <div className="sm:col-span-3">
                        <button
                          onClick={async () => {
                            await submit({
                              kind: "other",
                              title: "Loan request",
                              detail: `${member.name} requests ${loanRequestAmount || "0"} KES for ${loanRequestDays || "0"} days. Purpose: ${loanRequestPurpose || "not stated"}.`,
                              requestedBy: member.id,
                              requestedByName: member.name,
                              payload: {
                                requestType: "loan",
                                amount: loanRequestAmount,
                                termDays: loanRequestDays,
                                purpose: loanRequestPurpose,
                              },
                            });
                            toast.success("Loan request submitted for staff review");
                            setLoanRequestAmount("");
                            setLoanRequestDays("30");
                            setLoanRequestPurpose("");
                          }}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Submit loan request
                        </button>
                      </div>
                    </div>
                  </Section>
                )}
                {!isStaffView && !canRequestLoans && (
                  <Section title="Loan requests">
                    <div className="p-5 text-sm text-muted-foreground">
                      Service-only accounts can view records and support, but cannot request loans.
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
                {!isStaffView && canRequestStock && (
                  <Section title="Request stock">
                    <div className="grid gap-3 p-5 sm:grid-cols-2">
                      <select
                        value={stockRequestItemId}
                        onChange={(event) => setStockRequestItemId(event.target.value)}
                        className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
                      >
                        <option value="">Choose stock item</option>
                        {serviceWorkspace.stockItems.map((item: any) => (
                          <option key={item.id} value={item.id}>
                            {item.item_name ?? item.itemName ?? item.name} -{" "}
                            {fmtKES(Number(item.unit_price ?? item.unitPrice ?? 0))}
                          </option>
                        ))}
                      </select>
                      <input
                        value={stockRequestQuantity}
                        onChange={(event) => setStockRequestQuantity(event.target.value)}
                        type="number"
                        min={1}
                        placeholder="Quantity"
                        className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
                      />
                      <input
                        value={stockRequestPurpose}
                        onChange={(event) => setStockRequestPurpose(event.target.value)}
                        placeholder="Purpose / note"
                        className="rounded-md border border-border bg-muted px-3 py-2 text-sm sm:col-span-2"
                      />
                      <div className="sm:col-span-2">
                        <button
                          onClick={async () => {
                            if (!selectedStockItem) return toast.error("Choose a stock item.");
                            const quantity = Math.max(1, Number(stockRequestQuantity) || 1);
                            const unitPrice = Number(
                              selectedStockItem.unit_price ?? selectedStockItem.unitPrice ?? 0,
                            );
                            const itemName =
                              selectedStockItem.item_name ??
                              selectedStockItem.itemName ??
                              selectedStockItem.name ??
                              "Stock item";
                            await submit({
                              kind: "other",
                              title: "Stock request",
                              detail: `${member.name} requests ${quantity} x ${itemName}. Purpose: ${stockRequestPurpose || "not stated"}.`,
                              requestedBy: member.id,
                              requestedByName: member.name,
                              payload: {
                                requestType: "stock_request",
                                itemId: selectedStockItem.id,
                                itemName,
                                quantity,
                                estimatedAmount: unitPrice * quantity,
                                purpose: stockRequestPurpose,
                              },
                            });
                            toast.success("Stock request submitted for approval");
                            setStockRequestQuantity("");
                            setStockRequestPurpose("");
                          }}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          Submit stock request
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
                  {(member.category === "locomotive" ||
                    member.memberTags?.includes("locomotive") ||
                    member.vehiclePlate) && (
                    <div className="sm:col-span-2 rounded-md border border-border bg-muted/20 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                        Vehicle change request
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          value={vehicleChangePlate}
                          onChange={(event) =>
                            setVehicleChangePlate(event.target.value.toUpperCase())
                          }
                          placeholder="Vehicle / plate"
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                        />
                        <input
                          value={vehicleChangeReason}
                          onChange={(event) => setVehicleChangeReason(event.target.value)}
                          placeholder="Reason"
                          className="rounded-md border border-border bg-card px-3 py-2 text-sm"
                        />
                        <button
                          onClick={async () => {
                            if (!vehicleChangePlate.trim()) {
                              return toast.error("Enter the vehicle plate.");
                            }
                            await submit({
                              kind: "profile_update",
                              title: "Vehicle change request",
                              detail: `${member.name} requests vehicle change from ${member.vehiclePlate || "none"} to ${vehicleChangePlate}. Reason: ${vehicleChangeReason || "not stated"}.`,
                              requestedBy: member.id,
                              requestedByName: member.name,
                              payload: {
                                field: "vehicle_plate",
                                from: member.vehiclePlate,
                                to: vehicleChangePlate,
                                reason: vehicleChangeReason,
                              },
                            });
                            toast.success("Vehicle change submitted for approval");
                            setVehicleChangeReason("");
                          }}
                          className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}

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
                  {myLoans.length === 0 && myCarryoverLoans.length === 0 && (
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
                  {myCarryoverLoans.map((loan) => {
                    const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
                    const balance = summary.balance;
                    return (
                      <div
                        key={loan.id}
                        className="border border-border rounded-md p-4 text-sm space-y-2"
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {loan.id} · carryover
                            </div>
                            <div className="font-semibold">
                              {fmtKES(loan.principal)} · {summary.ratePct}% · {summary.termDays}{" "}
                              days
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">{loan.label}</div>
                          </div>
                          <Badge
                            tone={
                              loan.status === "active"
                                ? "warning"
                                : loan.status === "closed"
                                  ? "success"
                                  : "destructive"
                            }
                          >
                            {loan.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                          <Stat label="Total payable" value={fmtKES(summary.totalRepayment)} />
                          <Stat label="Paid so far" value={fmtKES(loan.paidToDate)} />
                          <Stat
                            label="Outstanding"
                            value={fmtKES(balance)}
                            tone={balance > 0 ? "warning" : "success"}
                          />
                          <Stat label="Due date" value={summary.dueDate} />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1">
                          <Stat label="Daily inclusive" value={fmtKES(summary.dailyInclusive)} />
                          <Stat label="Arrears" value={fmtKES(summary.arrears)} />
                          <Stat
                            label="Penalty estimate"
                            value={fmtKES(summary.estimatedPenaltyNow)}
                          />
                          <Stat label="Owed now" value={fmtKES(summary.totalOwedNow)} />
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Started {loan.startDate} · ends {summary.dueDate}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {tab === "transactions" && (
              <Section title="My Transactions">
                <div className="border-b border-border p-4 text-xs text-muted-foreground">
                  Original M-Pesa receipts are shown from the same receipt audit used in Capital
                  Operations.
                </div>
                <div className="max-h-[60vh] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left">Date / Time</th>
                        <th className="text-left">Receipt</th>
                        <th className="text-left">Receipt detail</th>
                        <th className="text-left">Account</th>
                        <th className="text-right pr-5">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {mpesaReceiptRows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                            No original M-Pesa receipts found for this member yet.
                          </td>
                        </tr>
                      )}
                      {mpesaReceiptRows.map((t: any) => (
                        <tr key={t.id}>
                          <td className="px-5 py-2">
                            {t.exactReceivedAt || t.createdAt
                              ? new Date(t.exactReceivedAt ?? t.createdAt).toLocaleString()
                              : "-"}
                          </td>
                          <td className="font-mono text-xs">{t.mpesaRef ?? t.id}</td>
                          <td className="text-muted-foreground">{t.note ?? t.ref ?? "—"}</td>
                          <td className="font-mono text-xs">{t.account ?? memberId}</td>
                          <td className="text-right pr-5">
                            {fmtKES(Number(t.originalAmount ?? t.amount ?? 0))}
                          </td>
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
