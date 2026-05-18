import { useEffect, useMemo, useState } from "react";

import { Section } from "@/components/ui-bits";
import { fmtKES, loanRateForTerm, roundUpKES, sbcDeductions, SBC_UPFRONT_TABLE, useStore } from "@/lib/store";

type LoanType = "standard" | "premium";

const LOAN_TYPES: { v: LoanType; l: string; min: number; max: number; hint: string }[] = [
  {
    v: "standard",
    l: "Standard",
    min: 1000,
    max: 5000,
    hint: "Standard loans: KSH 1,000 - 5,000. Terms: 7 / 14 / 30 days.",
  },
  {
    v: "premium",
    l: "Premium",
    min: 5001,
    max: 1000000,
    hint: "Premium loans: KSH 5,001+. Terms: 14 / 30 / 60 / 90 days.",
  },
];

const DAY_OPTIONS: Record<LoanType, number[]> = {
  standard: [7, 14, 30],
  premium: [14, 30, 60, 90],
};

const SAVINGS_OPTIONS = [50, 100];

function tierFor(amount: number) {
  return SBC_UPFRONT_TABLE.find((t) => amount >= t.min && amount <= t.max);
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function Simulator() {
  const { feePolicies, policySettings } = useStore();
  const [loanType, setLoanType] = useState<LoanType>("premium");
  const [amount, setAmount] = useState(30000);
  const [days, setDays] = useState<number>(30);
  const [dailySavings, setDailySavings] = useState(100);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stickerOn, setStickerOn] = useState(false);

  const dayOptions = useMemo(() => DAY_OPTIONS[loanType], [loanType]);

  useEffect(() => {
    if (!dayOptions.includes(days)) setDays(dayOptions[dayOptions.length - 1]);
  }, [dayOptions, days]);

  const calc = useMemo(() => {
    const ratePct = loanRateForTerm(days);
    const interest = amount * (ratePct / 100);
    const deductions = sbcDeductions(amount);
    const transaction = deductions.transactionCost;
    const registration = feePolicies.find((fee) => fee.key === "membership")?.amount ?? 500;
    const membership = feePolicies.find((fee) => fee.key === "card")?.amount ?? 500;
    const sticker = stickerOn ? (feePolicies.find((fee) => fee.key === "sticker")?.amount ?? 500) : 0;

    const totalRepayment = amount + interest + transaction;
    const rawDaily = totalRepayment / days;
    const dailyBeforeRound = rawDaily + dailySavings;
    const dailyInclusive = roundUpKES(dailyBeforeRound, 5);
    const roundOff = Math.max(0, dailyInclusive - dailyBeforeRound);
    const dailyLoan = dailyInclusive - dailySavings;
    const totalSavingsAccrued = dailySavings * days;
    const grandTotalCollected = dailyInclusive * days;

    const tier = tierFor(amount);
    const upfront = tier ? tier.minShares + tier.minSavings : 0;
    const totalUpfrontNow = upfront + registration + membership + sticker;
    const netDisbursed = amount - deductions.total;

    const dueDates = Array.from({ length: days }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return d;
    });

    return {
      interest,
      processing: deductions.processing,
      insurance: deductions.insurance,
      transaction,
      registration,
      membership,
      sticker,
      totalRepayment,
      rawDaily,
      dailyBeforeRound,
      dailyLoan,
      roundOff,
      dailyInclusive,
      totalSavingsAccrued,
      grandTotalCollected,
      upfront,
      totalUpfrontNow,
      netDisbursed,
      dueDates,
      tier,
    };
  }, [amount, dailySavings, days, feePolicies, startDate, stickerOn]);

  const lt = LOAN_TYPES.find((t) => t.v === loanType)!;

  const fmtKES2 = (n: number) =>
    new Intl.NumberFormat("en-KE", {
      style: "currency",
      currency: "KES",
      maximumFractionDigits: 2,
    }).format(n);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display text-2xl font-semibold">Loan Computation Simulator</h2>
          <p className="text-sm text-muted-foreground">
            Preview the exact loan terms before starting an application.
          </p>
        </div>
        <button className="px-4 py-2 rounded-md border border-primary text-primary text-sm font-medium hover:bg-primary/10">
          Open Loan Form
        </button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Simulation Inputs">
          <div className="p-5 space-y-4">
            <Field label="Loan Type">
              <select
                value={loanType}
                onChange={(e) => setLoanType(e.target.value as LoanType)}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              >
                {LOAN_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">{lt.hint}</p>
            </Field>

            <Field label={`Loan Amount (${fmtKES(lt.min)} - ${fmtKES(lt.max)})`}>
              <input
                type="number"
                min={lt.min}
                max={lt.max}
                value={amount}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  setAmount(v);
                  const matched = LOAN_TYPES.find((t) => v >= t.min && v <= t.max);
                  if (matched && matched.v !== loanType) {
                    setLoanType(matched.v);
                  } else if (!matched) {
                    if (v > LOAN_TYPES[LOAN_TYPES.length - 1].max) {
                      setLoanType(LOAN_TYPES[LOAN_TYPES.length - 1].v);
                    } else if (v < LOAN_TYPES[0].min) {
                      setLoanType(LOAN_TYPES[0].v);
                    }
                  }
                }}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
              {(amount < lt.min || amount > lt.max) && (
                <p className="text-xs text-destructive mt-1">Amount is outside the {lt.l} range.</p>
              )}
            </Field>

            <Field label="Days To Pay">
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Daily Savings Inclusive">
              <select
                value={dailySavings}
                onChange={(e) => setDailySavings(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              >
                {SAVINGS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} KSH / day
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Over {days} days: {fmtKES(dailySavings * days)} added to member savings.
              </p>
            </Field>

            <Field label="Repayment Start Date">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={stickerOn}
                onChange={(e) => setStickerOn(e.target.checked)}
              />
              Sticker fee applicable
            </label>
          </div>
        </Section>

        <Section title="Computation Preview">
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label="Interest"
                value={fmtKES(calc.interest)}
                sub={`Computed for ${days} days`}
              />
              <Tile
                label="Total Repayment"
                value={fmtKES(calc.totalRepayment)}
                sub="Principal + interest + transaction"
              />
              <Tile
                label="Daily Repayment Inclusive"
                value={fmtKES(calc.dailyInclusive)}
                sub={`${fmtKES2(calc.rawDaily)} loan + ${fmtKES(dailySavings)} savings = ${fmtKES2(calc.dailyBeforeRound)}; round up adds ${calc.roundOff.toFixed(2)}`}
              />
              <Tile
                label="Total Savings Accrued"
                value={fmtKES(calc.totalSavingsAccrued)}
                sub={`${fmtKES(dailySavings)} x ${days} days`}
              />
              <Tile
                label="Grand Total Collected"
                value={fmtKES(calc.grandTotalCollected)}
                sub="Repayment + savings over full term"
              />
              <Tile
                label="Upfront Required"
                value={fmtKES(calc.upfront)}
                sub={`Total upfront now: ${fmtKES(calc.totalUpfrontNow)}`}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Mini label="Processing Fee" value={fmtKES(calc.processing)} />
              <Mini label="Insurance Fee" value={fmtKES(calc.insurance)} />
              <Mini
                label={`Transaction Cost (${policySettings.percentages.transactionCostPct}%)`}
                value={fmtKES(calc.transaction)}
              />
              <Mini label="Net Disbursed" value={fmtKES(calc.netDisbursed)} />
              <Mini label="Membership Fee" value={fmtKES(calc.registration)} />
              <Mini label="Membership Card" value={fmtKES(calc.membership)} />
              <Mini label="Sticker Fee" value={fmtKES(calc.sticker)} />
            </div>

            <div className="bg-muted/40 border border-border rounded-md p-4">
              <div className="text-sm font-semibold mb-2">Due Dates</div>
              <div className="text-xs text-muted-foreground mb-2">
                Start: {fmtDate(calc.dueDates[0])} - Final:{" "}
                {fmtDate(calc.dueDates[calc.dueDates.length - 1])}
              </div>
              <ol className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
                {calc.dueDates.map((d, i) => (
                  <li key={i}>
                    {i + 1}. {fmtDate(d)} - {fmtKES(calc.dailyInclusive)}
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
      <span className="text-sm font-medium block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded-md p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-base font-semibold mt-0.5">{value}</div>
    </div>
  );
}
