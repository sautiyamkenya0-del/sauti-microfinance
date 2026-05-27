import { useCallback, useEffect, useMemo, useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { AppHeader } from "@/components/AppHeader";
import { AppraisalForm } from "@/components/loans/AppraisalForm";
import { FieldVisits } from "@/components/loans/FieldVisits";
import { FirstTimeApplication } from "@/components/loans/FirstTimeApplication";
import { FollowUps } from "@/components/loans/FollowUps";
import { LoanBook, MemberLoanHistory } from "@/components/loans/LoanBook";
import { PendingReview } from "@/components/loans/PendingReview";
import { RepeatApplication } from "@/components/loans/RepeatApplication";
import { Simulator } from "@/components/loans/Simulator";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { SectionTabs } from "@/components/SectionTabs";
import { type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import { upsertMemberCarryoverLoanRecord } from "@/lib/app-data.functions";
import { listAllCarryoverLoans } from "@/lib/runtime-data.functions";
import { fmtKES, hasMemberTag, isMemberCategory, useStore, type LoanKind } from "@/lib/store";
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

function memberMatchesLoanKind(member: { category?: string; memberTags?: string[] }, loanKind: LoanKind) {
  if (loanKind === "financial") return true;
  if (loanKind === "fuel") return hasMemberTag(member.memberTags, "locomotive", member.category as never) || !member.category;
  if (loanKind === "stock") return hasMemberTag(member.memberTags, "stock", member.category as never) || !member.category;
  if (loanKind === "service") return hasMemberTag(member.memberTags, "service", member.category as never) || !member.category;
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

export const Route = createFileRoute("/loans")({
  head: () => ({ meta: [{ title: "Loans - Sauti Microfinance" }] }),
  component: LoansHub,
});

function LoansHub() {
  const { currentUser, memberLoanCount, members, loans } = useStore();
  const loadCarryoverLoans = useServerFn(listAllCarryoverLoans);
  const saveCarryoverLoan = useServerFn(upsertMemberCarryoverLoanRecord);
  const [tab, setTab] = useState<Tab>("book");
  const [selectedLoanKind, setSelectedLoanKind] = useState<LoanKind>("financial");
  const [selectedMemberId, setSelectedMemberId] = useState("");
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
          [option.value]: loans.filter((loan) => (loan.loanKind ?? "financial") === option.value)
            .length + carryoverLoans.filter((loan) => (loan.loanKind ?? "financial") === option.value).length,
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
                      <option key={member.id} value={member.id}>
                        {member.id} - {member.name} - {member.phone} - ({totalLoanCount(member.id)}{" "}
                        loans)
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

            {!selectedMemberId || isFirstTime ? (
              <FirstTimeApplication
                memberId={selectedMemberId || undefined}
                initialLoanKind={selectedLoanKind}
                onSubmitted={() => setTab("appraisal")}
              />
            ) : (
              <RepeatApplication
                memberId={selectedMemberId}
                initialLoanKind={selectedLoanKind}
                onSubmitted={() => setTab("review")}
              />
            )}
          </div>
        )}

        {tab === "carryover" && (
          <CarryoverEntry
            members={memberAccounts}
            initialLoanKind={selectedLoanKind === "financial" ? "fuel" : selectedLoanKind}
            saveCarryoverLoan={saveCarryoverLoan}
            onSaved={refreshCarryoverLoans}
          />
        )}
        {tab === "appraisal" && <AppraisalForm memberId={selectedMemberId || undefined} />}
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
  saveCarryoverLoan,
  onSaved,
}: {
  members: ReturnType<typeof useStore>["members"];
  initialLoanKind: LoanKind;
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
  const [termDays, setTermDays] = useState<7 | 14 | 30 | 60 | 90>(30);
  const [paidToDate, setPaidToDate] = useState(0);
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [stockItem, setStockItem] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eligibleMembers.some((member) => member.id === memberId)) {
      setMemberId(eligibleMembers[0]?.id ?? "");
    }
  }, [eligibleMembers, memberId]);

  const selectedMember = members.find((member) => member.id === memberId);
  const totalOpeningBalance = amount + charge;

  async function saveDraft() {
    if (!memberId) return toast.error("Select a member first.");
    if (amount <= 0) return toast.error("Enter the carryover amount.");
    if (loanKind === "fuel" && !vehiclePlate.trim()) {
      return toast.error("Enter the vehicle plate for fuel carryover.");
    }
    if (loanKind === "stock" && !stockItem.trim()) {
      return toast.error("Enter the stock item.");
    }

    setSaving(true);
    try {
      const productMeta =
        loanKind === "fuel"
          ? { vehiclePlate: vehiclePlate.trim(), fuelAmount: amount, fuelCharge: charge }
          : loanKind === "stock"
            ? { stockItem: stockItem.trim(), stockAmount: amount, stockCharge: charge }
            : {};
      await saveCarryoverLoan({
        data: {
          memberId,
          label:
            loanKind === "fuel"
              ? `Fuel carryover - ${vehiclePlate.trim()}`
              : loanKind === "stock"
                ? `Stock carryover - ${stockItem.trim()}`
                : "Financial carryover",
          loanKind,
          loanCycleNumber: 1,
          principal: amount,
          interestRatePct: ratePct,
          termDays,
          dailySavingsAmount: 0,
          startDate: date,
          paidToDate,
          status: "active",
          finished: false,
          penaltyWaivedAmount: 0,
          feeBreakdown: {
            processingFeeAmount: charge,
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
      setVehiclePlate("");
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
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Date
            </span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
            />
          </label>
          {loanKind === "fuel" ? (
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
          <NumberInput
            label={loanKind === "fuel" ? "Fuel Amount" : loanKind === "stock" ? "Stock Amount" : "Amount"}
            value={amount}
            onChange={setAmount}
          />
          <NumberInput
            label={loanKind === "fuel" ? "Fuel Charge" : loanKind === "stock" ? "Stock Charge" : "Charge"}
            value={charge}
            onChange={setCharge}
          />
          <NumberInput label="Override %" value={ratePct} onChange={setRatePct} />
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Term
            </span>
            <select
              value={termDays}
              onChange={(event) => setTermDays(Number(event.target.value) as 7 | 14 | 30 | 60 | 90)}
              className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
            >
              {[7, 14, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </label>
          <NumberInput label="Paid To Date" value={paidToDate} onChange={setPaidToDate} />
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
            <span>{fmtKES(amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Charge</span>
            <span>{fmtKES(charge)}</span>
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
