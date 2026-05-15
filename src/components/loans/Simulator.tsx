import { Section } from "@/components/ui-bits";
import {
  fmtKES,
  loanRateForTerm,
  roundUpKES,
  SBC_LOAN_TERMS,
  SBC_UPFRONT_TABLE,
} from "@/lib/store";
import { useEffect, useMemo, useState } from "react";

type LoanType = "standard" | "premium";

const LOAN_TYPES: { v: LoanType; l: string; min: number; max: number; hint: string }[] = [
  {
    v: "standard",
    l: "Standard",
    min: 1000,
    max: 5000,
    hint: "Standard loans: KSH 1,000 – 5,000. Terms: 7 / 14 / 30 days.",
  },
  {
    v: "premium",
    l: "Premium",
    min: 5001,
    max: 1000000,
    hint: "Premium loans: KSH 5,001+. Terms: 7 / 14 / 30 days.",
  },
];

const SAVINGS_OPTIONS = [50, 100];

const FEES = {
  processingPct: 2,
  insurancePct: 1.5,
  transactionCost: 50,
  registration: 500,
  membership: 500,
  sticker: 100,
};

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
  const [loanType, setLoanType] = useState<LoanType>("premium");
  const [amount, setAmount] = useState(30000);
  const [days, setDays] = useState<number>(30);
  const [dailySavings, setDailySavings] = useState(100);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [stickerOn, setStickerOn] = useState(false);

  const dayOptions = useMemo(() => SBC_LOAN_TERMS, []);

  // Snap days/amount whenever loan type changes so they stay valid
  useEffect(() => {
    if (!dayOptions.includes(days)) setDays(dayOptions[dayOptions.length - 1]);
    const lt = LOAN_TYPES.find((t) => t.v === loanType)!;
    if (amount < lt.min) setAmount(lt.min);
    if (amount > lt.max) setAmount(lt.max);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanType]);

  const calc = useMemo(() => {
    const ratePct = loanRateForTerm(days);
    const interest = amount * (ratePct / 100);
    const processing = amount * (FEES.processingPct / 100);
    const insurance = amount * (FEES.insurancePct / 100);
    const transaction = FEES.transactionCost;
    const registration = FEES.registration;
    const membership = FEES.membership;
    const sticker = stickerOn ? FEES.sticker : 0;

    const totalRepayment = amount + interest + transaction;
    const rawDaily = totalRepayment / days;
    const dailyLoan = roundUpKES(rawDaily, 5);
    const roundOff = dailyLoan - rawDaily;
    const dailyInclusive = dailyLoan + dailySavings;
    const totalSavingsAccrued = dailySavings * days;
    const grandTotalCollected = dailyInclusive * days;

    const tier = tierFor(amount);
    const upfront = tier ? tier.minShares + tier.minSavings : 0;
    const totalUpfrontNow = upfront + registration + membership + sticker;
    const netDisbursed = amount;

    const dueDates = Array.from({ length: days }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return d;
    });

    return {
      ratePct,
      interest,
      processing,
      insurance,
      transaction,
      registration,
      membership,
      sticker,
      totalRepayment,
      rawDaily,
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
  }, [loanType, amount, days, dailySavings, startDate, stickerOn]);

  const lt = LOAN_TYPES.find((t) => t.v === loanType)!;

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
        {/* Inputs */}
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

            <Field label={`Loan Amount (${fmtKES(lt.min)} – ${fmtKES(lt.max)})`}>
              <input
                type="number"
                min={lt.min}
                max={lt.max}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
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
                    {d} days · {loanRateForTerm(d)}% interest
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {dayOptions.map((d) => `${d}d (${loanRateForTerm(d)}%)`).join(" · ")}
              </p>
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

        {/* Preview */}
        <Section title="Computation Preview">
          <div className="p-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Tile
                label="Interest"
                value={fmtKES(calc.interest)}
                sub={`${calc.ratePct}% interest for ${days} days`}
              />
              <Tile
                label="Total Repayment"
                value={fmtKES(calc.totalRepayment)}
                sub="Principal + interest + transaction"
              />
              <Tile
                label="Daily Repayment Inclusive"
                value={fmtKES(calc.dailyInclusive)}
                sub={`${fmtKES(calc.dailyLoan)} loan + ${fmtKES(dailySavings)} savings · round-off ${calc.roundOff.toFixed(2)}`}
              />
              <Tile
                label="Total Savings Accrued"
                value={fmtKES(calc.totalSavingsAccrued)}
                sub={`${fmtKES(dailySavings)} × ${days} days`}
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
              <Mini label="Transaction Cost" value={fmtKES(calc.transaction)} />
              <Mini label="Net Disbursed" value={fmtKES(calc.netDisbursed)} />
              <Mini label="Registration Fee" value={fmtKES(calc.registration)} />
              <Mini label="Membership Card" value={fmtKES(calc.membership)} />
              <Mini label="Sticker Fee" value={fmtKES(calc.sticker)} />
            </div>

            <div className="bg-muted/40 border border-border rounded-md p-4">
              <div className="text-sm font-semibold mb-2">Due Dates</div>
              <div className="text-xs text-muted-foreground mb-2">
                Start: {fmtDate(calc.dueDates[0])} · Final:{" "}
                {fmtDate(calc.dueDates[calc.dueDates.length - 1])}
              </div>
              <ol className="text-xs space-y-0.5 max-h-48 overflow-y-auto">
                {calc.dueDates.map((d, i) => (
                  <li key={i}>
                    {i + 1}. {fmtDate(d)} — {fmtKES(calc.dailyInclusive)}
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
