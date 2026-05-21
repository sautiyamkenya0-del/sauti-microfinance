import { useMemo, useState } from "react";

import { Section } from "@/components/ui-bits";
import { feePolicyAppliesToMember } from "@/lib/fees-policy";
import {
  fmtKES,
  isMemberCategory,
  loanPricingPreview,
  normalizeLoanTermDaysForType,
  upfrontRequirementForAmount,
  useStore,
  type BusinessPermanence,
  type LoanChargeMode,
  type LoanProductType,
} from "@/lib/store";

const LOAN_TYPES: { value: LoanProductType; label: string; min: number; max: number; hint: string }[] = [
  {
    value: "standard",
    label: "Standard",
    min: 1000,
    max: 5000,
    hint: "Standard loans: KSh 1,000 - 5,000. Terms: 7 / 14 / 30 days.",
  },
  {
    value: "premium",
    label: "Premium",
    min: 5001,
    max: 1000000,
    hint: "Premium loans: KSh 5,001+. Terms: 14 / 30 / 60 / 90 days.",
  },
];

const DAY_OPTIONS: Record<LoanProductType, number[]> = {
  standard: [7, 14, 30],
  premium: [14, 30, 60, 90],
};

const SAVINGS_OPTIONS = [50, 100];

function fmtDate(date: Date) {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function Simulator() {
  const { members, feePolicies } = useStore();
  const [loanType, setLoanType] = useState<LoanProductType>("premium");
  const [amount, setAmount] = useState(30000);
  const [requestedDays, setRequestedDays] = useState<number>(30);
  const [dailySavings, setDailySavings] = useState(100);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [processingMode, setProcessingMode] = useState<LoanChargeMode>("financed");
  const [insuranceMode, setInsuranceMode] = useState<LoanChargeMode>("financed");
  const [registrationMode, setRegistrationMode] = useState<LoanChargeMode>("upfront");
  const [cardMode, setCardMode] = useState<LoanChargeMode>("upfront");
  const [stickerMode, setStickerMode] = useState<LoanChargeMode>("upfront");
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [walkInBusinessPermanence, setWalkInBusinessPermanence] =
    useState<BusinessPermanence>("permanent");

  const memberAccounts = useMemo(
    () => members.filter((member) => isMemberCategory(member.category)),
    [members],
  );
  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLowerCase();
    if (!query) return memberAccounts;
    return memberAccounts.filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        member.id.toLowerCase().includes(query) ||
        member.phone.toLowerCase().includes(query),
    );
  }, [memberAccounts, memberQuery]);
  const selectedMember = memberAccounts.find((member) => member.id === selectedMemberId);
  const requestedTermBucket = normalizeLoanTermDaysForType(requestedDays, loanType);
  const stickerApplicable =
    (selectedMember?.businessPermanence ?? walkInBusinessPermanence) === "permanent";
  const previewMember = useMemo(
    () => ({
      id: selectedMember?.id ?? "SIM-WALK-IN",
      joinedAt: selectedMember?.joinedAt ?? new Date().toISOString().slice(0, 10),
      category: selectedMember?.category ?? "member",
      isInvestor: selectedMember?.isInvestor ?? false,
    }),
    [selectedMember],
  );
  const membershipPolicy = feePolicies.find((fee) => fee.key === "membership");
  const cardPolicy = feePolicies.find((fee) => fee.key === "card");
  const stickerPolicy = feePolicies.find((fee) => fee.key === "sticker");
  const registrationFeeAmount =
    membershipPolicy &&
    feePolicyAppliesToMember(membershipPolicy, previewMember, { hasActiveLoan: false }) &&
    !selectedMember?.fees.membership
      ? membershipPolicy.amount
      : selectedMember
        ? 0
        : membershipPolicy?.amount ?? 500;
  const cardFeeAmount =
    cardPolicy &&
    feePolicyAppliesToMember(cardPolicy, previewMember, { hasActiveLoan: false }) &&
    !selectedMember?.fees.card
      ? cardPolicy.amount
      : selectedMember
        ? 0
        : cardPolicy?.amount ?? 500;
  const stickerFeeAmount =
    stickerApplicable &&
    stickerPolicy &&
    feePolicyAppliesToMember(stickerPolicy, previewMember, { hasActiveLoan: false }) &&
    !selectedMember?.fees.sticker
      ? stickerPolicy.amount
      : 0;

  const pricing = useMemo(
    () =>
      loanPricingPreview({
        loanType,
        netAmount: amount,
        termDays: requestedDays,
        processingFeeMode: processingMode,
        insuranceFeeMode: insuranceMode,
        dailySavingsAmount: dailySavings,
        fixedFees: {
          membershipFeeAmount: registrationFeeAmount,
          membershipFeeMode: registrationMode,
          cardFeeAmount,
          cardFeeMode: cardMode,
          stickerFeeAmount,
          stickerFeeMode: stickerMode,
        },
      }),
    [
      amount,
      cardFeeAmount,
      cardMode,
      dailySavings,
      insuranceMode,
      loanType,
      processingMode,
      registrationFeeAmount,
      registrationMode,
      requestedDays,
      stickerFeeAmount,
      stickerMode,
    ],
  );
  const baseUpfront = upfrontRequirementForAmount(amount);

  const dueDates = Array.from({ length: pricing.termDays }, (_, index) => {
    const dueDate = new Date(startDate);
    dueDate.setDate(dueDate.getDate() + index);
    return dueDate;
  });

  const currentLoanType = LOAN_TYPES.find((item) => item.value === loanType)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold">Loan Computation Simulator</h2>
          <p className="text-sm text-muted-foreground">
            Preview the exact loan terms before starting an application.
          </p>
        </div>
        <button className="rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary hover:bg-primary/10">
          Open Loan Form
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Simulation Inputs">
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-[220px,1fr]">
              <Field label="Search Member">
                <input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="Search name, member no., or phone"
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Member">
                <select
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                >
                  <option value="">Walk-in / new applicant</option>
                  {filteredMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.id} - {member.name} - {member.phone}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {!selectedMember && (
              <Field label="Business Setup">
                <select
                  value={walkInBusinessPermanence}
                  onChange={(event) =>
                    setWalkInBusinessPermanence(event.target.value as BusinessPermanence)
                  }
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                >
                  <option value="permanent">Permanent</option>
                  <option value="semi">Semi-permanent</option>
                </select>
              </Field>
            )}

            <Field label="Loan Type">
              <select
                value={loanType}
                onChange={(event) => setLoanType(event.target.value as LoanProductType)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                {LOAN_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{currentLoanType.hint}</p>
            </Field>

            <Field label={`Loan Amount (${fmtKES(currentLoanType.min)} - ${fmtKES(currentLoanType.max)})`}>
              <input
                type="number"
                min={currentLoanType.min}
                max={currentLoanType.max}
                value={amount}
                onChange={(event) => {
                  const nextAmount = Number(event.target.value) || 0;
                  setAmount(nextAmount);
                  const matched = LOAN_TYPES.find(
                    (item) => nextAmount >= item.min && nextAmount <= item.max,
                  );
                  if (matched) setLoanType(matched.value);
                }}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
              {(amount < currentLoanType.min || amount > currentLoanType.max) && (
                <p className="mt-1 text-xs text-destructive">
                  Amount is outside the {currentLoanType.label} range.
                </p>
              )}
            </Field>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Repayment Days">
                <input
                  type="number"
                  min={1}
                  value={requestedDays}
                  onChange={(event) => setRequestedDays(Math.max(1, Number(event.target.value) || 0))}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Quick Term Picker">
                <select
                  value={String(requestedTermBucket)}
                  onChange={(event) => setRequestedDays(Number(event.target.value))}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                >
                  {DAY_OPTIONS[loanType].map((days) => (
                    <option key={days} value={days}>
                      {days} days
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">
              Manual {requestedDays} day entry uses the {pricing.termDays}-day {loanType} interest
              band at {pricing.ratePct}% for pricing.
            </p>

            <Field label="Daily Savings Inclusive">
              <select
                value={dailySavings}
                onChange={(event) => setDailySavings(Number(event.target.value))}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                {SAVINGS_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} KSh / day
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Over {pricing.termDays} days: {fmtKES(dailySavings * pricing.termDays)} added to
                member savings.
              </p>
            </Field>

            <Field label="Repayment Start Date">
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Processing Fee">
              <select
                value={processingMode}
                onChange={(event) => setProcessingMode(event.target.value as LoanChargeMode)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="financed">Finance in loan</option>
                <option value="upfront">Pay upfront</option>
              </select>
            </Field>

            <Field label="Insurance Fee">
              <select
                value={insuranceMode}
                onChange={(event) => setInsuranceMode(event.target.value as LoanChargeMode)}
                className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="financed">Finance in loan</option>
                <option value="upfront">Pay upfront</option>
              </select>
            </Field>

            <div className="grid gap-3 md:grid-cols-3">
              <FeeModeField
                amount={registrationFeeAmount}
                label="Registration"
                value={registrationMode}
                onChange={setRegistrationMode}
              />
              <FeeModeField amount={cardFeeAmount} label="Membership Card" value={cardMode} onChange={setCardMode} />
              <FeeModeField
                amount={stickerFeeAmount}
                label="Sticker"
                value={stickerMode}
                onChange={setStickerMode}
              />
            </div>
          </div>
        </Section>

        <Section title="Computation Preview">
          <div className="space-y-3 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label="Interest"
                value={fmtKES(pricing.interest)}
                sub={`Computed on ${pricing.termDays} days at ${pricing.ratePct}%`}
              />
              <Tile
                label="Total Repayment"
                value={fmtKES(pricing.totalRepayment)}
                sub="Financed principal + interest"
              />
              <Tile
                label="Daily Repayment Inclusive"
                value={fmtKES(pricing.dailyInclusive)}
                sub={`${fmtKES(pricing.dailyLoanInstallment)} loan + ${fmtKES(dailySavings)} savings`}
              />
              <Tile
                label="Grand Total Collected"
                value={fmtKES(pricing.grandTotalCollected)}
                sub="Repayment + savings over full term"
              />
              <Tile
                label="Tiered Upfront"
                value={fmtKES(baseUpfront.total)}
                sub={baseUpfront.tier?.range ?? "No upfront band"}
              />
              <Tile
                label="Pay Upfront Now"
                value={fmtKES(baseUpfront.total + pricing.totalUpfrontCharges)}
                sub="Tiered upfront + any charges marked upfront"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Mini label="Processing Fee" value={fmtKES(pricing.deductions.processing)} />
              <Mini label="Insurance Fee" value={fmtKES(pricing.deductions.insurance)} />
              <Mini label="Transaction Fee" value={fmtKES(pricing.deductions.transactionCost)} />
              <Mini label="Financed Principal" value={fmtKES(pricing.financedPrincipal)} />
              <Mini label="Registration Fee" value={fmtKES(registrationFeeAmount)} />
              <Mini label="Membership Card" value={fmtKES(cardFeeAmount)} />
              <Mini label="Sticker Fee" value={fmtKES(stickerFeeAmount)} />
              <Mini label="Financed Charges" value={fmtKES(pricing.totalFinancedCharges)} />
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-4">
              <div className="mb-2 text-sm font-semibold">Fee split</div>
              <div className="space-y-2 text-xs text-muted-foreground">
                {pricing.fixedFees.rows.map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3">
                    <span>{row.label}</span>
                    <span>
                      {fmtKES(row.amount)} {row.amount > 0 ? `(${row.mode})` : "(not due)"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/40 p-4">
              <div className="mb-2 text-sm font-semibold">Due Dates</div>
              <div className="mb-2 text-xs text-muted-foreground">
                Start: {fmtDate(dueDates[0])} - Final: {fmtDate(dueDates[dueDates.length - 1])}
              </div>
              <ol className="max-h-48 space-y-0.5 overflow-y-auto text-xs">
                {dueDates.map((dueDate, index) => (
                  <li key={index}>
                    {index + 1}. {fmtDate(dueDate)} - {fmtKES(pricing.dailyInclusive)}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function FeeModeField({
  amount,
  label,
  value,
  onChange,
}: {
  amount: number;
  label: string;
  value: LoanChargeMode;
  onChange: (value: LoanChargeMode) => void;
}) {
  return (
    <Field label={`${label} (${fmtKES(amount)})`}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as LoanChargeMode)}
        disabled={amount <= 0}
        className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm disabled:opacity-60"
      >
        <option value="upfront">Pay upfront</option>
        <option value="financed">Finance in loan</option>
      </select>
    </Field>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-base font-semibold">{value}</div>
    </div>
  );
}
