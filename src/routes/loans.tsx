import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { isMemberCategory, useStore } from "@/lib/store";
import { LoanBook, MemberLoanHistory } from "@/components/loans/LoanBook";
import { FirstTimeApplication } from "@/components/loans/FirstTimeApplication";
import { RepeatApplication } from "@/components/loans/RepeatApplication";
import { AppraisalForm } from "@/components/loans/AppraisalForm";
import { Simulator } from "@/components/loans/Simulator";
import { PendingReview } from "@/components/loans/PendingReview";
import { FollowUps } from "@/components/loans/FollowUps";
import { FieldVisits } from "@/components/loans/FieldVisits";
import { useState } from "react";

type Tab = "book" | "new" | "appraisal" | "simulator" | "review" | "followups" | "visits";

export const Route = createFileRoute("/loans")({
  head: () => ({ meta: [{ title: "Loans — Sauti Microfinance" }] }),
  component: LoansHub,
});

function LoansHub() {
  const { currentUser, memberLoanCount, members } = useStore();
  const [tab, setTab] = useState<Tab>("book");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null);

  const isFirstTime = selectedMemberId ? memberLoanCount(selectedMemberId) === 0 : true;
  const reviewerOnly = currentUser.role === "loan_officer";
  const memberAccounts = members.filter((member) => isMemberCategory(member.category));

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
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="lending" />
        {/* Tab nav */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border">
          {tabs
            .filter((t) => !t.hidden)
            .map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
        </div>

        {tab === "book" && <LoanBook onSelectMember={(id) => setHistoryMemberId(id)} />}

        {tab === "new" && (
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-[280px]">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  Select Member
                </span>
                <select
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                >
                  <option value="">— New / Walk-in (capture full details) —</option>
                  {memberAccounts.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id} · {m.name} · {m.phone} · ({memberLoanCount(m.id)} loans)
                    </option>
                  ))}
                </select>
              </label>
              {selectedMemberId && (
                <div className="text-xs text-muted-foreground">
                  {isFirstTime
                    ? "First-time borrower — full application form below."
                    : "Repeat borrower — short-form below (KYC re-confirmation only)."}
                </div>
              )}
            </div>

            {!selectedMemberId || isFirstTime ? (
              <FirstTimeApplication
                memberId={selectedMemberId || undefined}
                onSubmitted={() => setTab("appraisal")}
              />
            ) : (
              <RepeatApplication memberId={selectedMemberId} onSubmitted={() => setTab("review")} />
            )}
          </div>
        )}

        {tab === "appraisal" && <AppraisalForm memberId={selectedMemberId || undefined} />}
        {tab === "review" && <PendingReview />}
        {tab === "followups" && <FollowUps />}
        {tab === "visits" && <FieldVisits />}
        {tab === "simulator" && <Simulator />}

        {historyMemberId && (
          <MemberLoanHistory
            memberId={historyMemberId}
            onClose={() => setHistoryMemberId(null)}
            onNewLoan={(id, first) => {
              setSelectedMemberId(id);
              setHistoryMemberId(null);
              setTab(first ? "new" : "new");
            }}
          />
        )}
      </main>
    </>
  );
}
