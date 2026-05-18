import { Section } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  loanRateForTerm,
  loanScheduleTotal,
  normalizeLoanTermDays,
  sbcDeductions,
  SBC_FEES,
  PREMIUM_LOAN_TERMS,
  STANDARD_LOAN_TERMS,
  termPeriodsFromDays,
} from "@/lib/store";
import { Input, Select, Snap, Row, inputCss } from "./atoms";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ReconfirmRow = [label: string, checked: boolean, onChange: (value: boolean) => void];

export function RepeatApplication({
  memberId,
  onSubmitted,
}: {
  memberId: string;
  onSubmitted?: (loanId: string) => void;
}) {
  const { members, loans, currentUser, addLoan } = useStore();
  const member = members.find((m) => m.id === memberId);
  const memberLoans = loans.filter((l) => l.memberId === memberId);
  const lastLoan = memberLoans[memberLoans.length - 1];
  const repaymentScore =
    memberLoans.length === 0
      ? 0
      : memberLoans.reduce(
          (s, l) => s + (l.status === "closed" ? 1 : l.status === "defaulted" ? -1 : 0.5),
          0,
        ) / memberLoans.length;

  const [loanCategory, setLoanCategory] = useState<"Normal" | "Premium">("Premium");
  const [loanAmount, setLoanAmount] = useState(10000);
  const [purpose, setPurpose] = useState("Stock/Goods");
  const [repaymentPlan, setRepaymentPlan] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const [repaymentDays, setRepaymentDays] = useState(30);
  const [savingsPlan, setSavingsPlan] = useState<"50" | "100">("100");
  const [confirmKYC, setConfirmKYC] = useState(false);
  const [confirmKin, setConfirmKin] = useState(false);
  const [confirmGuar, setConfirmGuar] = useState(false);
  const [confirmBiz, setConfirmBiz] = useState(false);
  const [changesSinceLast, setChangesSinceLast] = useState("");
  const repaymentOptions = loanCategory === "Premium" ? PREMIUM_LOAN_TERMS : STANDARD_LOAN_TERMS;

  useEffect(() => {
    if (repaymentOptions.includes(repaymentDays as (typeof repaymentOptions)[number])) return;
    setRepaymentDays(repaymentOptions[repaymentOptions.length - 1]);
  }, [repaymentDays, repaymentOptions]);

  const calc = useMemo(() => {
    const termDays = normalizeLoanTermDays(repaymentDays);
    const ratePct = loanRateForTerm(termDays);
    const { interest, total } = loanScheduleTotal(
      loanAmount,
      ratePct,
      termPeriodsFromDays(termDays),
    );
    const ded = sbcDeductions(loanAmount);
    return {
      ratePct,
      termDays,
      interest,
      total,
      ded,
      net: loanAmount - ded.total,
      daily: total / termDays,
    };
  }, [loanAmount, repaymentDays]);

  if (!member) return <div className="text-sm text-muted-foreground">Select a member first.</div>;

  const submit = async () => {
    if (!confirmKYC || !confirmKin || !confirmGuar || !confirmBiz)
      return toast.error("Confirm all KYC details first.");
    const loanId = await addLoan({
      memberId: member.id,
      principal: loanAmount,
      rate: calc.ratePct,
      termDays: calc.termDays,
      termMonths: termPeriodsFromDays(calc.termDays),
      startDate: new Date().toISOString().slice(0, 10),
      officerId: currentUser.id,
      status: "pending",
      purpose,
    });
    toast.success("Repeat application submitted for review.");
    onSubmitted?.(loanId);
  };

  return (
    <div className="space-y-6">
      <Section title="Member Snapshot (auto-loaded)">
        <div className="p-5 grid md:grid-cols-4 gap-4 text-sm">
          <Snap label="Member ID" v={member.id} />
          <Snap label="Full Name" v={member.name} />
          <Snap label="Phone" v={member.phone} />
          <Snap label="Joined" v={member.joinedAt} />
          <Snap label="Savings" v={fmtKES(member.savingsBalance)} />
          <Snap label="Shares" v={`${member.shares} units`} />
          <Snap label="Previous Loans" v={String(memberLoans.length)} />
          <Snap label="Repayment Track" v={`${(repaymentScore * 100).toFixed(0)}%`} />
          {lastLoan && (
            <Snap label="Last Loan" v={`${fmtKES(lastLoan.principal)} · ${lastLoan.status}`} />
          )}
        </div>
      </Section>

      <Section title="KYC Re-confirmation">
        <div className="p-5 space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Per SBC policy, repeat applications only re-confirm previously captured data.
          </p>
          {(
            [
              ["KYC details on file are still accurate", confirmKYC, setConfirmKYC],
              ["Next of Kin contact is still accurate", confirmKin, setConfirmKin],
              ["Guarantors are still willing & active SBC members", confirmGuar, setConfirmGuar],
              ["Business type & location are unchanged", confirmBiz, setConfirmBiz],
            ] as ReconfirmRow[]
          ).map(([label, v, on]) => (
            <label key={label} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={v}
                onChange={(e) => on(e.target.checked)}
                className="mt-0.5"
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="block pt-2">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Any changes since last loan? (optional)
            </span>
            <textarea
              rows={3}
              className="loan-input mt-1"
              value={changesSinceLast}
              onChange={(e) => setChangesSinceLast(e.target.value)}
            />
          </label>
        </div>
      </Section>

      <Section title="New Loan Details">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Select
            label="Loan Category"
            value={loanCategory}
            onChange={(v) => setLoanCategory(v as "Normal" | "Premium")}
            options={["Normal", "Premium"]}
          />
          <Input
            type="number"
            label="Amount Requested (KSh)"
            value={String(loanAmount)}
            onChange={(v) => setLoanAmount(Number(v))}
          />
          <Select
            label="Purpose"
            value={purpose}
            onChange={setPurpose}
            options={["Fuel Credit", "Spare Parts", "Stock/Goods", "Emergencies", "Other"]}
          />
          <Select
            label="Repayment Plan"
            value={repaymentPlan}
            onChange={(v) => setRepaymentPlan(v as "Daily" | "Weekly" | "Monthly")}
            options={["Daily", "Weekly", "Monthly"]}
          />
          <Select
            label="Repayment Period (days)"
            value={String(calc.termDays)}
            onChange={(v) => setRepaymentDays(Number(v))}
            options={repaymentOptions.map((d) => String(d))}
          />
          <Select
            label="Daily Savings Plan"
            value={savingsPlan}
            onChange={(v) => setSavingsPlan(v as "50" | "100")}
            options={["50", "100"]}
          />
        </div>
      </Section>

      <Section title="Disbursement Computation">
        <div className="p-5 grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Row label="Loan Amount" value={fmtKES(loanAmount)} />
            <Row label="Interest" value={fmtKES(calc.interest)} />
            <Row
              label={`Processing (${SBC_FEES.processingPct}%)`}
              value={fmtKES(calc.ded.processing)}
            />
            <Row
              label={`Insurance (${SBC_FEES.insurancePct}%)`}
              value={fmtKES(calc.ded.insurance)}
            />
            <Row
              label={`Transaction Cost (${SBC_FEES.transactionCostPct}%)`}
              value={fmtKES(calc.ded.transactionCost)}
            />
            <Row label="Total Deductions" value={fmtKES(calc.ded.total)} bold />
          </div>
          <div className="space-y-2">
            <Row label="Net Disbursable" value={fmtKES(calc.net)} bold />
            <Row label="Total Repayable" value={fmtKES(calc.total)} bold />
            <Row label="Daily Repayment" value={fmtKES(calc.daily)} />
            <Row label="Period" value={`${calc.termDays} days`} />
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <button
          onClick={submit}
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Submit Repeat Application
        </button>
      </div>
      <style>{inputCss}</style>
    </div>
  );
}
