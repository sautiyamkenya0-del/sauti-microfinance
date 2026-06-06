export type LoanDailyPaymentInput = {
  date: string;
  amount: number;
};

export type LoanDailyLedgerRow = {
  date: string;
  dayNumber: number;
  openingCarryForward: number;
  scheduledInstallment: number;
  expectedToday: number;
  paidToday: number;
  totalPaid: number;
  dailyBalance: number;
  penaltyRatePct: number;
  penaltyPhase: "daily" | "default";
  penalty: number;
  endingCarryForward: number;
  totalBalanceBeforePenalty: number;
  totalBalance: number;
  totalDue: number;
  defaultedAmount: number;
};

export type LoanDailyLedgerSummary = {
  rows: LoanDailyLedgerRow[];
  startDate: string;
  dueDate: string;
  defaultFromDate: string;
  asOfDate: string;
  termDays: number;
  dailyInstallment: number;
  totalExpected: number;
  totalPaid: number;
  scheduledCollectedToDate: number;
  currentDailyBalance: number;
  currentCarryForward: number;
  currentPenalty: number;
  penaltyDays: number;
  dailyPenaltyDays: number;
  defaultPenaltyDays: number;
  daysPastDue: number;
  priorPenaltyAmount: number;
  dailyPenaltyAmount: number;
  defaultPenaltyAmount: number;
  automaticPenaltyAmount: number;
  totalPenalty: number;
  totalDue: number;
  defaultedAmount: number;
  defaultedAmountCap: number;
  autoStopped: boolean;
  autoStoppedAt?: string;
  isFinished: boolean;
};

export const DEFAULT_DEFAULTED_AMOUNT_STOP_CAP = 500_000;
export const SIMPLE_REDUCING_PENALTY_START_DATE = "2026-05-29";

function dateOnly(value?: string) {
  return String(value ?? "").slice(0, 10);
}

export function addIsoDays(date: string, days: number) {
  const base = new Date(`${dateOnly(date)}T00:00:00`);
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

export function diffIsoDays(from: string, to: string) {
  const start = new Date(`${dateOnly(from)}T00:00:00`).getTime();
  const end = new Date(`${dateOnly(to)}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function money(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function penaltyCeil(value: number) {
  if (value <= 0) return 0;
  return Math.ceil(value);
}

function normalizePayments(
  payments: LoanDailyPaymentInput[] | undefined,
  startDate: string,
  termDays: number,
  dailyInstallment: number,
  fallbackPaid: number,
) {
  const byDate = new Map<string, number>();
  let explicitTotal = 0;

  for (const payment of payments ?? []) {
    const date = dateOnly(payment.date);
    const amount = money(payment.amount);
    if (!date || amount <= 0) continue;
    byDate.set(date, roundMoney((byDate.get(date) ?? 0) + amount));
    explicitTotal = roundMoney(explicitTotal + amount);
  }

  let remainingFallback = Math.max(0, roundMoney(fallbackPaid - explicitTotal));
  if (remainingFallback <= 0) return byDate;

  const safeTermDays = Math.max(1, Math.floor(Number(termDays) || 1));
  const safeDailyInstallment = Math.max(0, Number(dailyInstallment) || 0);
  for (let day = 1; day <= safeTermDays && remainingFallback > 0; day += 1) {
    const date = addIsoDays(startDate, day - 1);
    const scheduled = safeDailyInstallment > 0 ? safeDailyInstallment : remainingFallback;
    const amount = Math.min(remainingFallback, scheduled);
    byDate.set(date, roundMoney((byDate.get(date) ?? 0) + amount));
    remainingFallback = roundMoney(remainingFallback - amount);
  }

  if (remainingFallback > 0) {
    const date = addIsoDays(startDate, safeTermDays);
    byDate.set(date, roundMoney((byDate.get(date) ?? 0) + remainingFallback));
  }

  return byDate;
}

export function buildLoanDailyLedger(args: {
  startDate: string;
  termDays: number;
  dailyInstallment: number;
  totalExpected: number;
  asOfDate?: string;
  dueDate?: string;
  payments?: LoanDailyPaymentInput[];
  fallbackPaid?: number;
  penaltyPct?: number;
  defaultPenaltyPct?: number;
  priorPenaltyAmount?: number;
  defaultFromDate?: string;
  defaultedAmountCap?: number;
  simpleReducingPenaltyFromDate?: string;
}) {
  const startDate = dateOnly(args.startDate) || new Date().toISOString().slice(0, 10);
  const asOfDate = dateOnly(args.asOfDate) || new Date().toISOString().slice(0, 10);
  const termDays = Math.max(1, Math.floor(Number(args.termDays) || 1));
  const dailyInstallment = Math.max(0, Number(args.dailyInstallment) || 0);
  const totalExpected = Math.max(0, Number(args.totalExpected ?? 0) || dailyInstallment * termDays);
  const dueDate = dateOnly(args.dueDate) || addIsoDays(startDate, termDays);
  const defaultFromDate = dateOnly(args.defaultFromDate) || addIsoDays(dueDate, 1);
  const penaltyPct = Math.max(0, Number(args.penaltyPct ?? 0) || 0);
  const defaultPenaltyPct = Math.max(
    0,
    Number(args.defaultPenaltyPct ?? args.penaltyPct ?? 0) || 0,
  );
  const priorPenaltyAmount = money(args.priorPenaltyAmount);
  const defaultedAmountCap = Math.max(0, Number(args.defaultedAmountCap ?? 0) || 0);
  const paymentsByDate = normalizePayments(
    args.payments,
    startDate,
    termDays,
    dailyInstallment,
    money(args.fallbackPaid),
  );
  const elapsedDays = asOfDate >= startDate ? Math.max(0, diffIsoDays(startDate, asOfDate) + 1) : 0;
  const rows: LoanDailyLedgerRow[] = [];
  let carryForward = 0;
  let cumulativePaid = 0;
  let penaltyDays = 0;
  let dailyPenaltyDays = 0;
  let defaultPenaltyDays = 0;
  let scheduledCollectedToDate = 0;
  let currentDefaultedAmount = 0;

  for (let dayNumber = 1; dayNumber <= elapsedDays; dayNumber += 1) {
    const date = addIsoDays(startDate, dayNumber - 1);
    const isDefaultPhase = date >= defaultFromDate;
    const scheduledInstallment = dayNumber <= termDays ? dailyInstallment : 0;
    scheduledCollectedToDate = roundMoney(scheduledCollectedToDate + scheduledInstallment);
    const openingCarryForward = carryForward;
    const expectedToday = Math.max(0, roundMoney(openingCarryForward + scheduledInstallment));
    const paidToday = money(paymentsByDate.get(date));
    cumulativePaid = roundMoney(cumulativePaid + paidToday);
    const dailyBalance = roundMoney(expectedToday - paidToday);
    const unpaidToday = Math.max(0, dailyBalance);
    const totalBalanceBeforePenalty = Math.max(0, roundMoney(totalExpected - cumulativePaid));
    const penaltyRatePct = isDefaultPhase ? defaultPenaltyPct : penaltyPct;
    const penaltyBase = isDefaultPhase ? totalBalanceBeforePenalty : unpaidToday;
    const penalty =
      penaltyBase > 0 && penaltyRatePct > 0
        ? penaltyCeil(penaltyBase * (penaltyRatePct / 100))
        : 0;
    if (penalty > 0) {
      penaltyDays += 1;
      if (isDefaultPhase) {
        defaultPenaltyDays += 1;
      } else {
        dailyPenaltyDays += 1;
      }
    }
    carryForward = dailyBalance;
    const totalBalance = Math.max(0, roundMoney(totalExpected - cumulativePaid));
    const totalDue = Math.max(0, roundMoney(totalBalance + priorPenaltyAmount + penalty));
    const defaultedAmount = Math.max(
      0,
      roundMoney(scheduledCollectedToDate + priorPenaltyAmount + penalty - cumulativePaid),
    );
    currentDefaultedAmount = defaultedAmount;

    rows.push({
      date,
      dayNumber,
      openingCarryForward,
      scheduledInstallment,
      expectedToday,
      paidToday,
      totalPaid: cumulativePaid,
      dailyBalance,
      penaltyRatePct,
      penaltyPhase: isDefaultPhase ? "default" : "daily",
      penalty,
      endingCarryForward: carryForward,
      totalBalanceBeforePenalty,
      totalBalance,
      totalDue,
      defaultedAmount,
    });
  }

  const totalPaid = Array.from(paymentsByDate.values()).reduce(
    (sum, amount) => roundMoney(sum + amount),
    0,
  );
  const current = rows[rows.length - 1];
  const baseBalance = Math.max(0, roundMoney(totalExpected - totalPaid));
  const dailyPenaltyBase = Math.max(0, roundMoney(scheduledCollectedToDate - totalPaid));
  const dailyPenaltyAmount =
    dailyPenaltyBase > 0 && penaltyPct > 0 && dailyPenaltyDays > 0
      ? penaltyCeil(dailyPenaltyBase * (penaltyPct / 100))
      : 0;
  const daysPastDue = baseBalance <= 0 ? 0 : Math.max(0, diffIsoDays(dueDate, asOfDate));
  const defaultPenaltyBase = daysPastDue > 0 ? baseBalance : 0;
  const totalDueBeforeDefaultPenalty = roundMoney(
    baseBalance + priorPenaltyAmount + dailyPenaltyAmount,
  );
  const defaultCapRemaining =
    daysPastDue > 0 && defaultedAmountCap > 0
      ? Math.max(0, roundMoney(defaultedAmountCap - totalDueBeforeDefaultPenalty))
      : Number.POSITIVE_INFINITY;
  let defaultPenaltyAmount =
    defaultPenaltyBase > 0 && defaultPenaltyPct > 0 && defaultCapRemaining > 0
      ? penaltyCeil(defaultPenaltyBase * (defaultPenaltyPct / 100))
      : 0;
  if (Number.isFinite(defaultCapRemaining)) {
    defaultPenaltyAmount = Math.min(defaultPenaltyAmount, defaultCapRemaining);
  }
  const automaticPenaltyAmount = roundMoney(dailyPenaltyAmount + defaultPenaltyAmount);
  const totalPenalty = Math.max(0, roundMoney(priorPenaltyAmount + automaticPenaltyAmount));
  const totalDue = Math.max(0, roundMoney(baseBalance + totalPenalty));
  const autoStopped = daysPastDue > 0 && defaultedAmountCap > 0 && totalDue >= defaultedAmountCap;
  const autoStoppedAt = autoStopped ? defaultFromDate : undefined;
  const defaultedAmount = Math.max(
    0,
    roundMoney(scheduledCollectedToDate + totalPenalty - totalPaid),
  );

  return {
    rows,
    startDate,
    dueDate,
    defaultFromDate,
    asOfDate,
    termDays,
    dailyInstallment,
    totalExpected,
    totalPaid,
    scheduledCollectedToDate,
    currentDailyBalance: current ? Math.max(0, current.dailyBalance) : 0,
    currentCarryForward: carryForward,
    currentPenalty: current?.penalty ?? 0,
    penaltyDays,
    dailyPenaltyDays,
    defaultPenaltyDays,
    daysPastDue,
    priorPenaltyAmount,
    dailyPenaltyAmount,
    defaultPenaltyAmount,
    automaticPenaltyAmount,
    totalPenalty,
    totalDue,
    defaultedAmount: current ? defaultedAmount : currentDefaultedAmount,
    defaultedAmountCap,
    autoStopped,
    autoStoppedAt,
    isFinished: totalDue <= 0,
  } satisfies LoanDailyLedgerSummary;
}
