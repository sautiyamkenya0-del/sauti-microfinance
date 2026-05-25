import { useEffect, useMemo, useState } from "react";

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
import { SectionTabs } from "@/components/SectionTabs";
import { type LegacyCarryoverLoan } from "@/lib/legacy-finance";
import { listAllCarryoverLoans } from "@/lib/runtime-data.functions";
import { isMemberCategory, useStore, type LoanKind } from "@/lib/store";
import { toast } from "sonner";

type Tab = "book" | "new" | "appraisal" | "simulator" | "review" | "followups" | "visits";

const LOAN_KIND_OPTIONS: { value: LoanKind; label: string; memberHint: string }[] = [
  { value: "financial", label: "Financial loan", memberHint: "All member categories" },
  { value: "fuel", label: "Fuel loan", memberHint: "Locomotive members only" },
  { value: "stock", label: "Stock loan", memberHint: "Stock members only" },
  { value: "service", label: "Service loan", memberHint: "Service members only" },
];

function memberMatchesLoanKind(member: { category?: string }, loanKind: LoanKind) {
  if (loanKind === "financial") return true;
  if (loanKind === "fuel") return member.category === "locomotive" || !member.category;
  if (loanKind === "stock") return member.category === "stock" || !member.category;
  if (loanKind === "service") return member.category === "service" || !member.category;
  return true;
}

export const Route = createFileRoute("/loans")({
  head: () => ({ meta: [{ title: "Loans - Sauti Microfinance" }] }),
  component: LoansHub,
});

function LoansHub() {
  const { currentUser, memberLoanCount, members, loans } = useStore();
  const loadCarryoverLoans = useServerFn(listAllCarryoverLoans);
  const [tab, setTab] = useState<Tab>("book");
  const [selectedLoanKind, setSelectedLoanKind] = useState<LoanKind>("financial");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null);
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);

  useEffect(() => {
    loadCarryoverLoans()
      .then((rows) => setCarryoverLoans(rows as LegacyCarryoverLoan[]))
      .catch((error: any) => {
        toast.error(error?.message ?? "Failed to load carryover loan records.");
      });
  }, [loadCarryoverLoans]);

  const carryoverLoanCount = (memberId: string) =>
    carryoverLoans.filter((loan) => loan.memberId === memberId).length;
  const totalLoanCount = (memberId: string) =>
    memberLoanCount(memberId) + carryoverLoanCount(memberId);
  const isFirstTime = selectedMemberId ? totalLoanCount(selectedMemberId) === 0 : true;
  const reviewerOnly = currentUser.role === "loan_officer";
  const loanKindCounts = useMemo(
    () =>
      LOAN_KIND_OPTIONS.reduce<Record<LoanKind, number>>(
        (counts, option) => ({
          ...counts,
          [option.value]: loans.filter((loan) => (loan.loanKind ?? "financial") === option.value)
            .length,
        }),
        { financial: 0, fuel: 0, stock: 0, service: 0 },
      ),
    [loans],
  );
  const memberAccounts = members.filter((member) => isMemberCategory(member.category));
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

  const tabs: { key: Tab; label: string; hidden?: boolean }[] = [
    { key: "book", label: "Loan Book" },
    { key: "new", label: "New / Repeat Application" },
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
