import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { AppHeader } from "@/components/AppHeader";
import { AppraisalForm } from "@/components/loans/AppraisalForm";
import { FieldVisits } from "@/components/loans/FieldVisits";
import { FirstTimeApplication } from "@/components/loans/FirstTimeApplication";
import { FollowUps } from "@/components/loans/FollowUps";
import {
  FuelJobCardFields,
  blankFuelJobCardRows,
  resizeFuelJobCardRows,
  summarizeFuelJobCardRows,
} from "@/components/loans/FuelJobCardFields";
import { LoanBook, MemberLoanHistory } from "@/components/loans/LoanBook";
import { PendingReview } from "@/components/loans/PendingReview";
import { RepeatApplication } from "@/components/loans/RepeatApplication";
import { Simulator } from "@/components/loans/Simulator";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { SectionTabs } from "@/components/SectionTabs";
import { summarizeLegacyCarryoverLoan, type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import { upsertMemberCarryoverLoanRecord } from "@/lib/app-data.functions";
import { listAllCarryoverLoans } from "@/lib/runtime-data.functions";
import {
  fmtKES,
  hasMemberTag,
  isMemberCategory,
  loanSummary,
  useStore,
  type LoanKind,
} from "@/lib/store";
import { toast } from "sonner";

type Tab =
  | "book"
  | "new"
  | "carryover"
  | "appraisal"
  | "simulator"
  | "review"
  | "followups"
  | "visits";

const LOAN_KIND_OPTIONS: { value: LoanKind; label: string; memberHint: string }[] = [
  { value: "financial", label: "Financial loan", memberHint: "All member categories" },
  { value: "fuel", label: "Fuel loan", memberHint: "Locomotive members only" },
  { value: "stock", label: "Stock loan", memberHint: "Stock members only" },
  { value: "service", label: "Service loan", memberHint: "Service members only" },
];

function memberMatchesLoanKind(
  member: { category?: string; memberTags?: string[] },
  loanKind: LoanKind,
) {
  if (loanKind === "financial") return true;
  if (loanKind === "fuel")
    return (
      hasMemberTag(member.memberTags, "locomotive", member.category as never) || !member.category
    );
  if (loanKind === "stock")
    return hasMemberTag(member.memberTags, "stock", member.category as never) || !member.category;
  if (loanKind === "service")
    return hasMemberTag(member.memberTags, "service", member.category as never) || !member.category;
  return true;
}

function isLoanMemberAccount(member: { category?: string; memberTags?: string[] }) {
  return (
    isMemberCategory(member.category as never) ||
    hasMemberTag(member.memberTags, "member", member.category as never) ||
    hasMemberTag(member.memberTags, "locomotive", member.category as never) ||
    hasMemberTag(member.memberTags, "stock", member.category as never) ||
    hasMemberTag(member.memberTags, "service", member.category as never)
  );
}

function loanKindLabel(kind?: LoanKind) {
  if (kind === "fuel") return "Fuel";
  if (kind === "stock") return "Stock";
  if (kind === "service") return "Service";
  return "Financial";
}

function openLoanStatusLabel(status: string) {
  if (status === "pending") return "pending";
  if (status === "defaulted") return "defaulted";
  return "active";
}

export const Route = createFileRoute("/loans")({
  head: () => ({ meta: [{ title: "Loans - Sauti Microfinance" }] }),
  component: LoansHub,
});

function LoansHub() {
  const { currentUser, memberLoanCount, members, loans, policySettings } = useStore();
  const loadCarryoverLoans = useServerFn(listAllCarryoverLoans);
  const saveCarryoverLoan = useServerFn(upsertMemberCarryoverLoanRecord);
  const [tab, setTab] = useState<Tab>("book");
  const [selectedLoanKind, setSelectedLoanKind] = useState<LoanKind>("financial");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [appraisalLoanId, setAppraisalLoanId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null);
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);

  const refreshCarryoverLoans = useCallback(async () => {
    return loadCarryoverLoans()
      .then((rows) => setCarryoverLoans(rows as LegacyCarryoverLoan[]))
      .catch((error: any) => {
        toast.error(error?.message ?? "Failed to load carryover loan records.");
      });
  }, [loadCarryoverLoans]);

  useEffect(() => {
    void refreshCarryoverLoans();
  }, [refreshCarryoverLoans]);

  const carryoverLoanCount = (memberId: string) =>
    carryoverLoans.filter((loan) => loan.memberId === memberId).length;
  const totalLoanCount = (memberId: string) =>
    memberLoanCount(memberId) + carryoverLoanCount(memberId);
  const isFirstTime = selectedMemberId ? totalLoanCount(selectedMemberId) === 0 : true;
  const reviewerOnly = currentUser.role === "loan_officer";
  const directorOnly = currentUser.role === "director";
  const loanKindCounts = useMemo(
    () =>
      LOAN_KIND_OPTIONS.reduce<Record<LoanKind, number>>(
        (counts, option) => ({
          ...counts,
          [option.value]:
            loans.filter((loan) => (loan.loanKind ?? "financial") === option.value).length +
            carryoverLoans.filter((loan) => (loan.loanKind ?? "financial") === option.value).length,
        }),
        { financial: 0, fuel: 0, stock: 0, service: 0 },
      ),
    [carryoverLoans, loans],
  );
  const memberAccounts = members.filter((member) => isLoanMemberAccount(member));
  const eligibleMemberAccounts = useMemo(
    () => memberAccounts.filter((member) => memberMatchesLoanKind(member, selectedLoanKind)),
    [memberAccounts, selectedLoanKind],
  );
  const openLoanBlocker = useCallback(
    (memberId: string, loanKind: LoanKind) => {
      const today = new Date().toISOString().slice(0, 10);
      const live = loans.find((loan) => {
        if (loan.memberId !== memberId) return false;
        if ((loan.loanKind ?? "financial") !== loanKind) return false;
        if (loan.status === "rejected") return false;
        if (loan.status === "pending") return true;
        const summary = loanSummary(loan);
        const balance = summary.balance;
        if (balance <= 0) return false;
        return loan.status === "active" || loan.status === "defaulted" || summary.dueDate < today;
      });
      if (live)
        return `${openLoanStatusLabel(live.status)} ${loanKindLabel(loanKind)} loan ${live.id}`;

      const carryover = carryoverLoans.find((loan) => {
        if (loan.memberId !== memberId) return false;
        if ((loan.loanKind ?? "financial") !== loanKind) return false;
        const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
        return loan.status !== "closed" && !summary.isFinished && summary.totalOwedNow > 0;
      });
      if (carryover) {
        const summary = summarizeLegacyCarryoverLoan(carryover, policySettings);
        const status = summary.dueDate < today ? "defaulted" : "active";
        return `${status} ${loanKindLabel(loanKind)} carryover ${carryover.id}`;
      }

      return "";
    },
    [carryoverLoans, loans, policySettings],
  );
  const selectedOpenLoanBlocker = selectedMemberId
    ? openLoanBlocker(selectedMemberId, selectedLoanKind)
    : "";
  const filteredMemberAccounts = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return eligibleMemberAccounts;
    return eligibleMemberAccounts.filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        member.id.toLowerCase().includes(query) ||
        member.phone.toLowerCase().includes(query),
    );
  }, [eligibleMemberAccounts, memberQuery]);

  useEffect(() => {
    if (
      selectedMemberId &&
      !eligibleMemberAccounts.some((member) => member.id === selectedMemberId)
    ) {
      setSelectedMemberId("");
    }
  }, [eligibleMemberAccounts, selectedMemberId]);

  useEffect(() => {
    if (!directorOnly && tab === "carryover") setTab("book");
  }, [directorOnly, tab]);

  const tabs: { key: Tab; label: string; hidden?: boolean }[] = [
    { key: "book", label: "Loan Book" },
    { key: "new", label: "New / Repeat Application" },
    { key: "carryover", label: "Carryover Entry", hidden: !directorOnly },
    { key: "appraisal", label: "Appraisal & Risk" },
    { key: "review", label: "Pending Review", hidden: reviewerOnly },
    { key: "followups", label: "Follow-ups" },
    { key: "visits", label: "Field Visits" },
    { key: "simulator", label: "Simulator" },
  ];

  return (
    <>
      <AppHeader
        title="Loans"
        subtitle="One workspace for the full loan lifecycle: application, appraisal, review, disbursement, follow-up."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="lending" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {LOAN_KIND_OPTIONS.map((option) => {
            const active = selectedLoanKind === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setSelectedLoanKind(option.value);
                  setSelectedMemberId("");
                  setTab("new");
                }}
                className={`rounded-lg border p-4 text-left transition ${active ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50"}`}
              >
                <div className="text-sm font-semibold">{option.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{option.memberHint}</div>
                <div className="mt-3 text-xs font-medium">
                  {loanKindCounts[option.value]} record(s)
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b border-border">
          {tabs
            .filter((item) => !item.hidden)
            .map((item) => (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === item.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {item.label}
              </button>
            ))}
        </div>

        {tab === "book" && (
          <LoanBook
            carryoverLoans={carryoverLoans}
            onSelectMember={(id) => setHistoryMemberId(id)}
          />
        )}

        {tab === "new" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
              <div className="grid min-w-[320px] flex-1 gap-3 lg:grid-cols-[220px_220px_1fr]">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Loan Type
                  </span>
                  <select
                    value={selectedLoanKind}
                    onChange={(event) => {
                      setSelectedLoanKind(event.target.value as LoanKind);
                      setSelectedMemberId("");
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                  >
                    {LOAN_KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {LOAN_KIND_OPTIONS.find((option) => option.value === selectedLoanKind)
                      ?.memberHint ?? ""}
                  </span>
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Search Member
                  </span>
                  <input
                    value={memberQuery}
                    onChange={(event) => setMemberQuery(event.target.value)}
                    placeholder="Search name, member no., or phone"
                    className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Select Member
                  </span>
                  <select
                    value={selectedMemberId}
                    onChange={(event) => setSelectedMemberId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                  >
                    <option value="">- New / Walk-in (capture full details) -</option>
                    {filteredMemberAccounts.map((member) => (
                      <option
                        key={member.id}
                        value={member.id}
                        disabled={!!openLoanBlocker(member.id, selectedLoanKind)}
                      >
                        {member.id} - {member.name} - {member.phone} - ({totalLoanCount(member.id)}{" "}
                        loans)
                        {openLoanBlocker(member.id, selectedLoanKind)
                          ? ` - blocked: ${openLoanBlocker(member.id, selectedLoanKind)}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  {filteredMemberAccounts.length === 0 ? (
                    <span className="mt-1 block text-[11px] text-destructive">
                      No eligible members found for this loan type.
                    </span>
                  ) : null}
                </label>
              </div>
              {selectedMemberId && (
                <div className="text-xs text-muted-foreground">
                  {isFirstTime
                    ? "First-time borrower - full application form below."
                    : "Repeat borrower - short form below (KYC re-confirmation only)."}
                </div>
              )}
            </div>

            {selectedOpenLoanBlocker ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                <div className="font-semibold text-destructive">Loan category already open</div>
                <div className="mt-1 text-muted-foreground">
                  This member already has {selectedOpenLoanBlocker}. Close or clear that record
                  before creating another {loanKindLabel(selectedLoanKind).toLowerCase()} loan.
                </div>
              </div>
            ) : !selectedMemberId || isFirstTime ? (
              <FirstTimeApplication
                memberId={selectedMemberId || undefined}
                initialLoanKind={selectedLoanKind}
                onSubmitted={(loanId, nextMemberId) => {
                  setAppraisalLoanId(loanId);
                  setSelectedMemberId(nextMemberId);
                  setTab("appraisal");
                }}
              />
            ) : (
              <RepeatApplication
                memberId={selectedMemberId}
                initialLoanKind={selectedLoanKind}
                onSubmitted={(loanId, nextMemberId) => {
                  setAppraisalLoanId(loanId);
                  setSelectedMemberId(nextMemberId);
                  setTab("appraisal");
                }}
              />
            )}
          </div>
        )}

        {tab === "carryover" && (
          <CarryoverEntry
            members={memberAccounts}
            initialLoanKind={selectedLoanKind === "financial" ? "fuel" : selectedLoanKind}
            loans={loans}
            carryoverLoans={carryoverLoans}
            policySettings={policySettings}
            saveCarryoverLoan={(args) => saveCarryoverLoan({ data: args.data as never })}
            onSaved={refreshCarryoverLoans}
          />
        )}
        {tab === "appraisal" && (
          <AppraisalForm
            memberId={selectedMemberId || undefined}
            loanId={appraisalLoanId || undefined}
          />
        )}
        {tab === "review" && <PendingReview />}
        {tab === "followups" && <FollowUps carryoverLoans={carryoverLoans} />}
        {tab === "visits" && <FieldVisits />}
        {tab === "simulator" && <Simulator />}

        {historyMemberId && (
          <MemberLoanHistory
            memberId={historyMemberId}
            carryoverLoans={carryoverLoans}
            onClose={() => setHistoryMemberId(null)}
            onNewLoan={(id) => {
              setSelectedMemberId(id);
              setHistoryMemberId(null);
              setTab("new");
            }}
          />
        )}
      </main>
    </>
  );
}

function CarryoverEntry({
  members,
  initialLoanKind,
  loans,
  carryoverLoans,
  policySettings,
  saveCarryoverLoan,
  onSaved,
}: {
  members: ReturnType<typeof useStore>["members"];
  initialLoanKind: LoanKind;
  loans: ReturnType<typeof useStore>["loans"];
  carryoverLoans: LegacyCarryoverLoan[];
  policySettings: ReturnType<typeof useStore>["policySettings"];
  saveCarryoverLoan: (args: { data: unknown }) => Promise<unknown>;
  onSaved: () => Promise<unknown>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultKind = initialLoanKind === "service" ? "fuel" : initialLoanKind;
  const [loanKind, setLoanKind] = useState<LoanKind>(
    defaultKind === "financial" ? "fuel" : defaultKind,
  );
  const eligibleMembers = useMemo(
    () => members.filter((member) => memberMatchesLoanKind(member, loanKind)),
    [loanKind, members],
  );
  const [memberId, setMemberId] = useState(eligibleMembers[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState(0);
  const [charge, setCharge] = useState(0);
  const [ratePct, setRatePct] = useState(0);
  const [termDays, setTermDays] = useState(loanKind === "fuel" ? 1 : 30);
  const [paidToDate, setPaidToDate] = useState(0);
  const [priorPenaltyAmount, setPriorPenaltyAmount] = useState(0);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [fuelEntryCount, setFuelEntryCount] = useState(1);
  const [fuelJobCardRows, setFuelJobCardRows] = useState(() => blankFuelJobCardRows(1));
  const [stockItem, setStockItem] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eligibleMembers.some((member) => member.id === memberId)) {
      setMemberId(eligibleMembers[0]?.id ?? "");
    }
  }, [eligibleMembers, memberId]);

  useEffect(() => {
    if (loanKind === "fuel" && termDays !== 1) setTermDays(1);
    if (loanKind === "stock" && termDays < 1) setTermDays(14);
  }, [loanKind, termDays]);

  const selectedMember = members.find((member) => member.id === memberId);
  const fuelJobCardSummary = useMemo(
    () => summarizeFuelJobCardRows(fuelJobCardRows),
    [fuelJobCardRows],
  );
  const selectedVehiclePlate = selectedMember?.vehiclePlate || vehiclePlate.trim().toUpperCase();
  const fuelAmount = fuelJobCardSummary.totalCost;
  const fuelCharge = fuelJobCardSummary.totalFuelCharge;
  const effectiveAmount = loanKind === "fuel" ? fuelAmount : amount;
  const effectiveCharge = loanKind === "fuel" ? fuelCharge : charge;
  const totalOpeningBalance = effectiveAmount + effectiveCharge;
  const carryoverBlocker = useMemo(() => {
    if (!memberId) return "";
    const todayIso = new Date().toISOString().slice(0, 10);
    const live = loans.find((loan) => {
      if (loan.memberId !== memberId) return false;
      if ((loan.loanKind ?? "financial") !== loanKind) return false;
      if (loan.status === "pending") return true;
      if (loan.status === "rejected") return false;
      const summary = loanSummary(loan);
      return summary.balance > 0 && (loan.status !== "closed" || summary.dueDate < todayIso);
    });
    if (live)
      return `${openLoanStatusLabel(live.status)} ${loanKindLabel(loanKind)} loan ${live.id}`;
    const existingCarryover = carryoverLoans.find((loan) => {
      if (loan.memberId !== memberId) return false;
      if ((loan.loanKind ?? "financial") !== loanKind) return false;
      const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
      return loan.status !== "closed" && !summary.isFinished && summary.totalOwedNow > 0;
    });
    if (!existingCarryover) return "";
    const summary = summarizeLegacyCarryoverLoan(existingCarryover, policySettings);
    return `${summary.dueDate < todayIso ? "defaulted" : "active"} ${loanKindLabel(loanKind)} carryover ${existingCarryover.id}`;
  }, [carryoverLoans, loanKind, loans, memberId, policySettings]);

  async function saveDraft() {
    if (!memberId) return toast.error("Select a member first.");
    if (carryoverBlocker) {
      return toast.error(
        `This member already has ${carryoverBlocker}. Clear it before adding another ${loanKindLabel(loanKind).toLowerCase()} carryover.`,
      );
    }
    if (effectiveAmount <= 0) {
      return toast.error(
        loanKind === "fuel"
          ? "Enter at least one fuel refill entry."
          : "Enter the carryover amount.",
      );
    }
    if (loanKind === "fuel" && !selectedVehiclePlate) {
      return toast.error("Add a vehicle plate to this locomotive profile or this carryover entry.");
    }
    if (loanKind === "stock" && !stockItem.trim()) {
      return toast.error("Enter the stock item.");
    }

    setSaving(true);
    try {
      const productMeta =
        loanKind === "fuel"
          ? {
              vehiclePlate: selectedVehiclePlate,
              fuelAmount: effectiveAmount,
              fuelCharge: effectiveCharge,
              fuelEntries: fuelJobCardRows,
              jobCard: {
                rows: fuelJobCardRows,
                totals: fuelJobCardSummary,
              },
            }
          : loanKind === "stock"
            ? { stockItem: stockItem.trim(), stockAmount: effectiveAmount, stockCharge: charge }
            : {};
      const savedPaidToDate = paidToDate;
      await saveCarryoverLoan({
        data: {
          memberId,
          label:
            loanKind === "fuel"
              ? `Fuel carryover - ${selectedVehiclePlate}`
              : loanKind === "stock"
                ? `Stock carryover - ${stockItem.trim()}`
                : "Financial carryover",
          loanKind,
          loanCycleNumber: 1,
          principal: effectiveAmount,
          interestRatePct: ratePct,
          termDays: Math.max(1, Math.floor(termDays)),
          dailySavingsAmount: 0,
          startDate: date,
          paidToDate: savedPaidToDate,
          status: "active",
          finished: false,
          penaltyWaivedAmount: 0,
          feeBreakdown: {
            processingFeeAmount: effectiveCharge,
            priorPenaltyAmount,
            productMeta,
          },
          notes: `${loanKindLabel(loanKind)} carryover entered from Lending page. Opening balance ${totalOpeningBalance}.`,
        },
      });
      await onSaved();
      toast.success("Carryover loan saved and added to the loan book.");
      setAmount(0);
      setCharge(0);
      setPaidToDate(0);
      setPriorPenaltyAmount(0);
      setVehiclePlate("");
      setFuelEntryCount(1);
      setFuelJobCardRows(blankFuelJobCardRows(1));
      setStockItem("");
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to save carryover loan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Carryover Type
            </span>
            <select
              value={loanKind}
              onChange={(event) => setLoanKind(event.target.value as LoanKind)}
              className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
            >
              <option value="fuel">Fuel</option>
              <option value="stock">Stock</option>
              <option value="financial">Financial</option>
              <option value="service">Service</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Member
            </span>
            <div className="mt-1">
              <MemberSearchSelect
                members={eligibleMembers}
                value={memberId}
                onChange={setMemberId}
                describeMember={(member) => `${member.id} - ${member.name} - ${member.phone ?? ""}`}
              />
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
            />
          </label>
          {carryoverBlocker ? (
            <div className="md:col-span-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Existing open record: {carryoverBlocker}
            </div>
          ) : null}
          {loanKind === "fuel" ? (
            <>
              {selectedMember?.vehiclePlate ? (
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Vehicle Plate
                  </div>
                  <div className="mt-1 font-mono font-semibold">{selectedMember.vehiclePlate}</div>
                </div>
              ) : (
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Vehicle Plate
                  </span>
                  <input
                    value={vehiclePlate}
                    onChange={(event) => setVehiclePlate(event.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                  />
                </label>
              )}
              <NumberInput
                label="Fuel Entries"
                value={fuelEntryCount}
                onChange={(value) => {
                  const count = Math.max(1, Math.floor(Number(value) || 1));
                  setFuelEntryCount(count);
                  setFuelJobCardRows((current) => resizeFuelJobCardRows(current, count));
                }}
              />
            </>
          ) : null}
          {loanKind === "stock" ? (
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Stock Item
              </span>
              <input
                value={stockItem}
                onChange={(event) => setStockItem(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </label>
          ) : null}
          {loanKind !== "fuel" ? (
            <>
              <NumberInput
                label={loanKind === "stock" ? "Stock Amount" : "Amount"}
                value={amount}
                onChange={setAmount}
              />
              <NumberInput
                label={loanKind === "stock" ? "Stock Charge" : "Charge"}
                value={charge}
                onChange={setCharge}
              />
              <NumberInput label="Override %" value={ratePct} onChange={setRatePct} />
              <label className="block">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Term
                </span>
                <input
                  type="number"
                  min={1}
                  value={termDays}
                  onChange={(event) => setTermDays(Math.max(1, Number(event.target.value) || 1))}
                  className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                />
              </label>
            </>
          ) : null}
          <NumberInput label="Paid To Date" value={paidToDate} onChange={setPaidToDate} />
          <NumberInput
            label="Total Penalties Before This Loan"
            value={priorPenaltyAmount}
            onChange={setPriorPenaltyAmount}
          />
          {loanKind === "fuel" ? (
            <FuelJobCardFields rows={fuelJobCardRows} onChange={setFuelJobCardRows} />
          ) : null}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void saveDraft()}
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save carryover loan"}
          </button>
        </div>
      </section>
      <aside className="rounded-lg border border-border bg-card p-5 text-sm">
        <div className="font-semibold">Opening Summary</div>
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Client</span>
            <span className="text-right font-medium">{selectedMember?.name ?? "-"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span>{fmtKES(effectiveAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Charge</span>
            <span>{fmtKES(effectiveCharge)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total opening balance</span>
            <span>{fmtKES(totalOpeningBalance)}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

function NumberInput({
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
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
      />
    </label>
  );
}
