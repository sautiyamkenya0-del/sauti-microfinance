import { Section, Badge } from "@/components/ui-bits";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { useStore, fmtKES, scoreLoan } from "@/lib/store";
import { Input, Select, Snap, inputCss } from "./atoms";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function daysBetween(from: string, to = new Date().toISOString().slice(0, 10)) {
  const start = new Date(`${String(from).slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function clampScore(value: number, max: number) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function premiumMultiplierForScore(score: number) {
  if (score < 60) return 0;
  if (score < 70) return 1;
  if (score < 75) return 2;
  if (score < 80) return 3;
  if (score < 85) return 4;
  if (score < 90) return 5;
  if (score < 93) return 6;
  if (score < 96) return 7;
  if (score < 98) return 8;
  if (score < 100) return 9;
  return 10;
}

function businessMultiplierForScore(score: number) {
  if (score < 50) return 0;
  if (score < 60) return 1;
  if (score < 70) return 2;
  if (score < 80) return 3;
  if (score < 90) return 4;
  return 5;
}

function riskRatingForScore(score: number) {
  if (score >= 90) return "Very Low Risk";
  if (score >= 80) return "Low Risk";
  if (score >= 70) return "Moderate Risk";
  if (score >= 60) return "High Risk";
  return "Very High Risk";
}

export function AppraisalForm({
  memberId: presetMember,
  loanId: presetLoan,
}: {
  memberId?: string;
  loanId?: string;
}) {
  const { members, loans, transactions, currentUser, addAppraisal, appraisals } = useStore();
  const [memberId, setMemberId] = useState(presetMember ?? "");
  const [loanId, setLoanId] = useState(presetLoan ?? "");
  const [amountApplied, setAmountApplied] = useState(20000);
  const [loanTermDays, setLoanTermDays] = useState(60);
  const [proposedInstallment, setProposedInstallment] = useState(450);
  const [goodDay, setGoodDay] = useState(2500);
  const [averageDay, setAverageDay] = useState(1500);
  const [badDay, setBadDay] = useState(700);
  const [opEx, setOpEx] = useState(400);
  const [existingDebt, setExistingDebt] = useState(0);
  const [monthlyRepay, setMonthlyRepay] = useState(0);
  const [crbStatus, setCRB] = useState<"Positive" | "Negative" | "No Record" | "Unknown">(
    "Positive",
  );
  const [totalIncome, setTotalIncome] = useState(45000);
  const [totalExpenses, setTotalExpenses] = useState(28000);
  const [savingsConsistency, setSavingsConsistency] = useState<"Good" | "Average" | "Poor">("Good");
  const [existingBurden, setExistingBurden] = useState<"Manageable" | "Moderate" | "Overburdened">(
    "Manageable",
  );
  const [documentation, setDocumentation] = useState<"Strong" | "Partial" | "Weak">("Strong");
  const [cooperation, setCooperation] = useState<"Strong" | "Moderate" | "Poor">("Strong");
  const [approvedAmount, setApprovedAmount] = useState(20000);
  const [approvedTerm, setApprovedTerm] = useState("60 days");
  const [specialConditions, setSpecialConditions] = useState("");
  const [officerJustification, setOfficerJustification] = useState("");

  const ratios = useMemo(() => {
    const netCashFlow = averageDay - opEx;
    const dicr = proposedInstallment > 0 ? netCashFlow / proposedInstallment : 0;
    const bdsr = proposedInstallment > 0 ? (badDay - opEx) / proposedInstallment : 0;
    const member = members.find((m) => m.id === memberId);
    const savings = member?.savingsBalance ?? 0;
    const lsr = amountApplied > 0 ? savings / amountApplied : 0;
    const buffer = proposedInstallment > 0 ? savings / proposedInstallment : 0;
    const dti = totalIncome > 0 ? (monthlyRepay / totalIncome) * 100 : 0;
    return { netCashFlow, dicr, bdsr, lsr, buffer, dti };
  }, [
    averageDay,
    opEx,
    badDay,
    proposedInstallment,
    amountApplied,
    members,
    memberId,
    totalIncome,
    monthlyRepay,
  ]);

  const scoring = useMemo(
    () =>
      scoreLoan({
        dicr: ratios.dicr,
        bdsr: ratios.bdsr,
        savingsConsistency,
        crbStatus,
        existingBurden,
        documentation,
        cooperation,
      }),
    [
      ratios.dicr,
      ratios.bdsr,
      savingsConsistency,
      crbStatus,
      existingBurden,
      documentation,
      cooperation,
    ],
  );

  const member = members.find((m) => m.id === memberId);
  const memberLoans = member ? loans.filter((l) => l.memberId === member.id) : [];
  const selectedLoan = loans.find((row) => row.id === loanId);
  const multiplierAppraisal = useMemo(() => {
    if (!member) return undefined;
    const memberTransactions = transactions.filter((tx) => tx.memberId === member.id);
    const today = new Date();
    const eightWeeksAgo = new Date(today);
    eightWeeksAgo.setDate(today.getDate() - 56);
    const recentSavingsTx = memberTransactions.filter((tx) => {
      const date = new Date(`${tx.date.slice(0, 10)}T00:00:00`);
      return date >= eightWeeksAgo && (tx.type === "deposit" || tx.type === "withdrawal");
    });
    const weeklyNet = Array.from({ length: 8 }, (_, index) => {
      const start = new Date(eightWeeksAgo);
      start.setDate(eightWeeksAgo.getDate() + index * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      return recentSavingsTx.reduce((sum, tx) => {
        const date = new Date(`${tx.date.slice(0, 10)}T00:00:00`);
        if (date < start || date >= end) return sum;
        return sum + (tx.type === "withdrawal" ? -tx.amount : tx.amount);
      }, 0);
    });
    const activeLoans = memberLoans.filter((loan) => loan.status === "active");
    const defaultedLoans = memberLoans.filter((loan) => loan.status === "defaulted");
    const closedLoans = memberLoans.filter((loan) => loan.status === "closed");
    const loanRepayments = memberTransactions.filter((tx) => tx.type === "loan_repayment");
    const shareValue =
      Math.max(0, member.shares) * 100 + Math.max(0, Number(member.shareReserveBalance ?? 0));
    const complianceBalance = Math.max(0, member.savingsBalance);
    const qualifiedSavings = Math.max(
      0,
      weeklyNet.reduce((sum, value) => sum + Math.max(0, value), 0) / 8,
    );
    const contributionConsistency =
      weeklyNet.length > 0
        ? (weeklyNet.filter((value) => value > 0).length / weeklyNet.length) * 100
        : 0;
    const membershipDays = daysBetween(member.joinedAt);
    const repaymentSuccess =
      memberLoans.length > 0 ? (closedLoans.length / memberLoans.length) * 100 : 100;
    const onTimeRate =
      loanRepayments.length > 0
        ? Math.min(100, (loanRepayments.length / Math.max(loanTermDays, 1)) * 100)
        : closedLoans.length > 0
          ? 80
          : 50;
    const defaultSeverity =
      defaultedLoans.length === 0
        ? "No Default"
        : defaultedLoans.length === 1
          ? "Minor Default"
          : defaultedLoans.length <= 3
            ? "Major Default"
            : "Chronic Default";
    const monthlyNetIncome = Math.max(0, totalIncome - totalExpenses);
    const debtServiceRatio =
      monthlyNetIncome > 0 ? (proposedInstallment * 30) / monthlyNetIncome : 1;

    const complianceScore = clampScore(
      (complianceBalance >= 5000 ? 10 : (complianceBalance / 5000) * 10) +
        (contributionConsistency / 100) * 10,
      20,
    );
    const sharesScore = clampScore(shareValue >= 3000 ? 10 : (shareValue / 3000) * 10, 10);
    const savingsScore = clampScore(
      (qualifiedSavings >= 1000 ? 7 : (qualifiedSavings / 1000) * 7) +
        (weeklyNet[7] >= weeklyNet[0] ? 3 : weeklyNet[7] >= qualifiedSavings ? 2 : 1),
      10,
    );
    const performanceScore = clampScore((repaymentSuccess / 100) * 12 + (onTimeRate / 100) * 8, 20);
    const defaultScore = clampScore(
      defaultSeverity === "No Default"
        ? 15
        : defaultSeverity === "Minor Default"
          ? 10
          : defaultSeverity === "Major Default"
            ? 5
            : 0,
      15,
    );
    const businessScore = clampScore(
      (member.businessType ? 3 : 0) +
        (member.businessName ? 2 : 0) +
        (member.businessAddress ? 2 : 0) +
        (debtServiceRatio <= 0.35 ? 3 : debtServiceRatio <= 0.5 ? 2 : debtServiceRatio <= 0.7 ? 1 : 0),
      10,
    );
    const walletScore = clampScore(
      Math.min(5, loanRepayments.length) +
        Math.min(3, recentSavingsTx.length / 4) +
        (member.status === "active" ? 2 : 0),
      10,
    );
    const assetScore = 5;
    const totalScore =
      complianceScore +
      sharesScore +
      savingsScore +
      performanceScore +
      defaultScore +
      businessScore +
      walletScore +
      assetScore;
    const isPremium = amountApplied > 5000 || selectedLoan?.principal > 5000;
    const multiplier = isPremium
      ? premiumMultiplierForScore(totalScore)
      : businessMultiplierForScore(totalScore);
    const maxAmount = Math.floor(qualifiedSavings * multiplier);
    const conditions = [
      complianceBalance >= 5000 ? "" : "Increase compliance balance to KSh 5,000.",
      shareValue >= 3000 ? "" : "Increase shares to KSh 3,000.",
      contributionConsistency >= 100 ? "" : "Complete 8 weeks of consistent savings.",
      defaultedLoans.length === 0 ? "" : "Clear active default before disbursement.",
      maxAmount >= amountApplied ? "" : `Downsize request to ${fmtKES(maxAmount)}.`,
    ].filter(Boolean);

    return {
      isPremium,
      membershipDuration: `${Math.floor(membershipDays / 365)} years ${Math.floor((membershipDays % 365) / 30)} months`,
      complianceBalance,
      shareValue,
      qualifiedSavings,
      contributionConsistency,
      repaymentSuccess,
      onTimeRate,
      activeLoans: activeLoans.length,
      defaults: defaultedLoans.length,
      defaultSeverity,
      debtServiceRatio,
      scores: {
        complianceScore,
        sharesScore,
        savingsScore,
        performanceScore,
        defaultScore,
        businessScore,
        walletScore,
        assetScore,
      },
      totalScore,
      riskRating: riskRatingForScore(totalScore),
      multiplier,
      maxAmount,
      recommendation:
        multiplier <= 0 || conditions.length >= 3
          ? "Declined"
          : conditions.length > 0
            ? "Conditionally Approved"
            : "Approved",
      recommendedTerm: `${loanTermDays} days`,
      conditions,
    };
  }, [
    amountApplied,
    loanTermDays,
    member,
    memberLoans,
    proposedInstallment,
    selectedLoan?.principal,
    totalExpenses,
    totalIncome,
    transactions,
  ]);
  const pendingAppraisalLoans = useMemo(
    () =>
      loans.filter(
        (loan) =>
          loan.status === "pending" &&
          !appraisals.some((appraisal) => appraisal.loanId === loan.id),
      ),
    [appraisals, loans],
  );

  function loadLoanForAppraisal(nextLoanId: string) {
    const loan = loans.find((row) => row.id === nextLoanId);
    if (!loan) return;
    const termDays = loan.termDays ?? loan.termMonths * 30;
    setLoanId(loan.id);
    setMemberId(loan.memberId);
    setAmountApplied(loan.principal);
    setApprovedAmount(loan.principal);
    setLoanTermDays(termDays);
    setApprovedTerm(`${termDays} days`);
  }

  useEffect(() => {
    if (presetMember) setMemberId(presetMember);
  }, [presetMember]);

  useEffect(() => {
    if (presetLoan) loadLoanForAppraisal(presetLoan);
  }, [presetLoan, loans]);

  const decisionTone =
    scoring.decision === "Approve"
      ? "success"
      : scoring.decision === "Approve with Adjustments"
        ? "warning"
        : scoring.decision === "Refer / Downsize"
          ? "warning"
          : "destructive";

  const submit = async () => {
    if (!member) return toast.error("Select a member.");
    await addAppraisal({
      memberId: member.id,
      loanId: loanId || undefined,
      officerId: currentUser.id,
      goodDay,
      averageDay,
      badDay,
      operatingExpenses: opEx,
      nonEarningDays: 1,
      existingDebt,
      monthlyDebtRepayment: monthlyRepay,
      crbStatus,
      reschedulesLast12: 0,
      dti: ratios.dti,
      dicr: ratios.dicr,
      bdsr: ratios.bdsr,
      lsr: ratios.lsr,
      savingsBuffer: ratios.buffer,
      scoreDICR: scoring.sDICR,
      scoreBDSR: scoring.sBDSR,
      scoreSavings: scoring.sSav,
      scoreCRB: scoring.sCRB,
      scoreBurden: scoring.sBurden,
      scoreDocs: scoring.sDocs,
      scoreCoop: scoring.sCoop,
      totalScore: scoring.total,
      decision: scoring.decision,
      riskLevel: scoring.riskLevel,
      approvedAmount,
      approvedTerm,
      specialConditions,
      notes: officerJustification,
    });
    toast.success(`Appraisal saved · Score ${scoring.total}/100 · ${scoring.decision}`);
  };

  return (
    <div className="space-y-6">
      <Section title={`Completed Applications Pending Appraisal (${pendingAppraisalLoans.length})`}>
        <div className="divide-y divide-border">
          {pendingAppraisalLoans.length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No completed applications are waiting for appraisal.
            </div>
          ) : null}
          {pendingAppraisalLoans.map((loan) => {
            const applicant = members.find((row) => row.id === loan.memberId);
            const termDays = loan.termDays ?? loan.termMonths * 30;
            return (
              <div
                key={loan.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {applicant?.name ?? loan.memberId}{" "}
                    <span className="font-mono text-xs text-muted-foreground">{loan.id}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {loan.loanKind ?? "financial"} - {fmtKES(loan.principal)} - {termDays} days
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => loadLoanForAppraisal(loan.id)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Do appraisal
                </button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="1. Client & Loan">
        <div className="p-5 grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Member
            </span>
            <div className="mt-1">
              <MemberSearchSelect
                members={members}
                value={memberId}
                onChange={setMemberId}
                emptyLabel="Select member"
                describeMember={(m) => `${m.id} - ${m.name} - ${m.phone ?? ""}`}
              />
            </div>
            <select
              className="hidden"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
            >
              <option value="">— Select —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Pending loan
            </span>
            <select
              className="loan-input mt-1"
              value={loanId}
              onChange={(e) => setLoanId(e.target.value)}
            >
              <option value="">—</option>
              {memberLoans.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} · {fmtKES(l.principal)} · {l.status}
                </option>
              ))}
            </select>
          </label>
          {member && <Snap label="Savings on file" v={fmtKES(member.savingsBalance)} />}
        </div>
      </Section>

      {multiplierAppraisal ? (
        <Section title="SBC Multiplier Appraisal (Auto)">
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
              <Snap label="Membership age" v={multiplierAppraisal.membershipDuration} />
              <Snap label="Compliance balance" v={fmtKES(multiplierAppraisal.complianceBalance)} />
              <Snap label="Share value" v={fmtKES(multiplierAppraisal.shareValue)} />
              <Snap label="8-week qualified savings" v={fmtKES(multiplierAppraisal.qualifiedSavings)} />
              <Snap
                label="Consistency"
                v={`${multiplierAppraisal.contributionConsistency.toFixed(1)}%`}
              />
              <Snap
                label="Repayment success"
                v={`${multiplierAppraisal.repaymentSuccess.toFixed(1)}%`}
              />
              <Snap label="Default status" v={multiplierAppraisal.defaultSeverity} />
              <Snap
                label="Debt service ratio"
                v={`${(multiplierAppraisal.debtServiceRatio * 100).toFixed(1)}%`}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <ScoreSnap label="Compliance" value={multiplierAppraisal.scores.complianceScore} max={20} />
              <ScoreSnap label="Shares" value={multiplierAppraisal.scores.sharesScore} max={10} />
              <ScoreSnap label="Savings" value={multiplierAppraisal.scores.savingsScore} max={10} />
              <ScoreSnap
                label="Loan performance"
                value={multiplierAppraisal.scores.performanceScore}
                max={20}
              />
              <ScoreSnap label="Default history" value={multiplierAppraisal.scores.defaultScore} max={15} />
              <ScoreSnap label="Business" value={multiplierAppraisal.scores.businessScore} max={10} />
              <ScoreSnap label="Wallet" value={multiplierAppraisal.scores.walletScore} max={10} />
              <ScoreSnap label="Asset security" value={multiplierAppraisal.scores.assetScore} max={5} />
            </div>

            <div className="grid gap-3 md:grid-cols-5">
              <Snap label="Final score" v={`${multiplierAppraisal.totalScore}/100`} />
              <Snap label="Risk rating" v={multiplierAppraisal.riskRating} />
              <Snap label="Multiplier" v={`${multiplierAppraisal.multiplier}x`} />
              <Snap label="Max amount" v={fmtKES(multiplierAppraisal.maxAmount)} />
              <Snap label="Recommendation" v={multiplierAppraisal.recommendation} />
            </div>

            {multiplierAppraisal.conditions.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {multiplierAppraisal.conditions.join(" ")}
              </div>
            ) : null}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setApprovedAmount(Math.min(amountApplied, multiplierAppraisal.maxAmount));
                  setApprovedTerm(multiplierAppraisal.recommendedTerm);
                  setSpecialConditions(multiplierAppraisal.conditions.join("\n"));
                  setOfficerJustification(
                    `Auto multiplier appraisal: ${multiplierAppraisal.totalScore}/100, ${multiplierAppraisal.riskRating}, ${multiplierAppraisal.multiplier}x.`,
                  );
                }}
                className="rounded-md border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              >
                Use recommendation
              </button>
            </div>
          </div>
        </Section>
      ) : null}

      <Section title="2. Loan Details">
        <div className="p-5 grid md:grid-cols-3 gap-3">
          <Input
            type="number"
            label="Amount Applied (KSh)"
            value={String(amountApplied)}
            onChange={(v) => setAmountApplied(Number(v))}
          />
          <Input
            type="number"
            label="Term (days)"
            value={String(loanTermDays)}
            onChange={(v) => setLoanTermDays(Number(v))}
          />
          <Input
            type="number"
            label="Proposed Daily Installment"
            value={String(proposedInstallment)}
            onChange={(v) => setProposedInstallment(Number(v))}
          />
        </div>
      </Section>

      <Section title="3. Cash Flow Analysis">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input
            type="number"
            label="Good Day Sales"
            value={String(goodDay)}
            onChange={(v) => setGoodDay(Number(v))}
          />
          <Input
            type="number"
            label="Average Day Sales"
            value={String(averageDay)}
            onChange={(v) => setAverageDay(Number(v))}
          />
          <Input
            type="number"
            label="Bad Day Sales"
            value={String(badDay)}
            onChange={(v) => setBadDay(Number(v))}
          />
          <Input
            type="number"
            label="Daily Operating Expenses"
            value={String(opEx)}
            onChange={(v) => setOpEx(Number(v))}
          />
        </div>
      </Section>

      <Section title="4. Existing Credit">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input
            type="number"
            label="Outstanding Debt"
            value={String(existingDebt)}
            onChange={(v) => setExistingDebt(Number(v))}
          />
          <Input
            type="number"
            label="Monthly Debt Repayment"
            value={String(monthlyRepay)}
            onChange={(v) => setMonthlyRepay(Number(v))}
          />
          <Select
            label="CRB Status"
            value={crbStatus}
            onChange={(v) => setCRB(v as any)}
            options={["Positive", "Negative", "No Record", "Unknown"]}
          />
          <Input
            type="number"
            label="Monthly Income"
            value={String(totalIncome)}
            onChange={(v) => setTotalIncome(Number(v))}
          />
          <Input
            type="number"
            label="Monthly Expenses"
            value={String(totalExpenses)}
            onChange={(v) => setTotalExpenses(Number(v))}
          />
        </div>
      </Section>

      <Section title="5. Affordability Ratios (auto)">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Snap label="DTI" v={`${ratios.dti.toFixed(1)}%`} />
          <Snap label="DICR" v={ratios.dicr.toFixed(2)} />
          <Snap label="BDSR" v={ratios.bdsr.toFixed(2)} />
          <Snap label="LSR" v={ratios.lsr.toFixed(2)} />
          <Snap label="Savings Buffer (days)" v={ratios.buffer.toFixed(1)} />
          <Snap label="Net Daily Cash Flow" v={fmtKES(ratios.netCashFlow)} />
        </div>
      </Section>

      <Section title="6. Officer Judgement">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select
            label="Savings Consistency"
            value={savingsConsistency}
            onChange={(v) => setSavingsConsistency(v as any)}
            options={["Good", "Average", "Poor"]}
          />
          <Select
            label="Existing Burden"
            value={existingBurden}
            onChange={(v) => setExistingBurden(v as any)}
            options={["Manageable", "Moderate", "Overburdened"]}
          />
          <Select
            label="Documentation"
            value={documentation}
            onChange={(v) => setDocumentation(v as any)}
            options={["Strong", "Partial", "Weak"]}
          />
          <Select
            label="Cooperation"
            value={cooperation}
            onChange={(v) => setCooperation(v as any)}
            options={["Strong", "Moderate", "Poor"]}
          />
        </div>
      </Section>

      <Section title="7. Auto Risk Score">
        <div className="p-5 grid md:grid-cols-4 gap-3 text-sm">
          <Snap label="DICR" v={`${scoring.sDICR}/25`} />
          <Snap label="BDSR" v={`${scoring.sBDSR}/15`} />
          <Snap label="Savings" v={`${scoring.sSav}/10`} />
          <Snap label="CRB" v={`${scoring.sCRB}/15`} />
          <Snap label="Burden" v={`${scoring.sBurden}/10`} />
          <Snap label="Docs" v={`${scoring.sDocs}/5`} />
          <Snap label="Cooperation" v={`${scoring.sCoop}/5`} />
          <div className="bg-primary/10 border border-primary/30 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total Score
            </div>
            <div className="text-2xl font-bold text-primary">
              {scoring.total}
              <span className="text-sm font-normal text-muted-foreground">/100</span>
            </div>
            <div className="mt-1">
              <Badge tone={decisionTone as any}>{scoring.decision}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Risk: <span className="font-medium text-foreground">{scoring.riskLevel}</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="8. Officer Decision (recommendation)">
        <div className="p-5 grid md:grid-cols-3 gap-3">
          <Input
            type="number"
            label="Recommended Amount"
            value={String(approvedAmount)}
            onChange={(v) => setApprovedAmount(Number(v))}
          />
          <Input label="Recommended Term" value={approvedTerm} onChange={setApprovedTerm} />
          <Input
            label="Special Conditions"
            value={specialConditions}
            onChange={setSpecialConditions}
          />
          <label className="md:col-span-3 block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Officer Justification
            </span>
            <textarea
              rows={3}
              className="loan-input mt-1"
              value={officerJustification}
              onChange={(e) => setOfficerJustification(e.target.value)}
            />
          </label>
        </div>
      </Section>

      <div className="flex justify-end">
        <button
          onClick={() => void submit()}
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Save Appraisal → Send for Review
        </button>
      </div>
      <style>{inputCss}</style>
    </div>
  );
}

function ScoreSnap({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">
        {value}/{max}
      </div>
    </div>
  );
}
