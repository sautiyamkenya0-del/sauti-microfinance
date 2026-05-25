import {
  DEFAULT_POLICY_SETTINGS,
  normalizePolicyTermDays,
  policyInterestRateForTerm,
  transactionFeeForAmount,
  type PolicySettings,
} from "@/lib/policy-settings";

export type LegacyCarryoverProfile = {
  memberId: string;
  savingsBalance: number;
  shareUnits: number;
  feesPaidTotal: number;
  loanRepaymentsTotal: number;
  investmentBalance: number;
  otherCollectedTotal: number;
  totalCollected: number;
  pendingBalance: number;
  penaltiesOutstanding: number;
  penaltiesWaivedTotal: number;
  membershipFeePaid: boolean;
  cardFeePaid: boolean;
  stickerFeePaid: boolean;
  firstUpfrontPaid: boolean;
  completedLoanCycles: number;
  firstLoanStartDate?: string;
  lastLoanEndDate?: string;
  collectionBreakdown: Record<string, unknown>;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type LegacyCarryoverLoanStatus = "active" | "closed" | "defaulted";

export type LegacyCarryoverLoanFeeBreakdown = {
  membershipFeeAmount?: number;
  cardFeeAmount?: number;
  stickerFeeAmount?: number;
  processingFeeAmount?: number;
  insuranceFeeAmount?: number;
  transactionFeeAmount?: number;
  monthlySubscriptionAmount?: number;
  subscriptionMonths?: number;
  subscriptionWaived?: boolean;
  dailyPenaltyDays?: number;
  dailyPenaltyAmount?: number;
  dueDatePenaltyDays?: number;
};

export type LegacyCarryoverLoan = {
  id: string;
  memberId: string;
  label: string;
  loanCycleNumber: number;
  principal: number;
  interestRatePct: number;
  termDays: 7 | 14 | 30 | 60 | 90;
  dailySavingsAmount: number;
  startDate: string;
  dueDate?: string;
  closedOn?: string;
  paidToDate: number;
  status: LegacyCarryoverLoanStatus;
  finished: boolean;
  penaltyWaivedAmount: number;
  feeBreakdown?: LegacyCarryoverLoanFeeBreakdown;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type ReportSnapshot = {
  id: string;
  reportKey: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  filters: Record<string, unknown>;
  summary: Record<string, unknown>;
  chartData: Record<string, unknown>;
  generatedBy?: string;
  createdAt: string;
};

function toDateOnly(value?: string) {
  if (!value) return "";
  return value.slice(0, 10);
}

function addDays(date: string, days: number) {
  const next = new Date(`${toDateOnly(date)}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string) {
  const start = new Date(`${toDateOnly(from)}T00:00:00`).getTime();
  const end = new Date(`${toDateOnly(to)}T00:00:00`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function normalizeTermDays(termDays?: number): 7 | 14 | 30 | 60 | 90 {
  return normalizePolicyTermDays(termDays);
}

function moneyValue(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function wholeDaysValue(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
}

function roundUpKES(amount: number, step: number) {
  if (amount <= 0) return 0;
  const normalizedStep = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.ceil(amount / normalizedStep) * normalizedStep;
}

function compoundedDailyPenalty(baseAmount: number, pct: number, days: number) {
  const principal = Math.max(0, Number(baseAmount ?? 0));
  const normalizedDays = wholeDaysValue(days);
  const dailyRate = Math.max(0, Number(pct ?? 0)) / 100;
  if (principal <= 0 || dailyRate <= 0 || normalizedDays <= 0) return 0;
  return principal * (Math.pow(1 + dailyRate, normalizedDays) - 1);
}

function termPeriodsFromDays(termDays: number) {
  return Math.max(1, Math.ceil(normalizeTermDays(termDays) / 30));
}

function defaultLoanServiceFees(principal: number, settings: PolicySettings) {
  const normalizedPrincipal = Math.max(0, Number(principal ?? 0));
  const processingFeeAmount = normalizedPrincipal * (settings.percentages.processingPct / 100);
  const insuranceFeeAmount = normalizedPrincipal * (settings.percentages.insurancePct / 100);
  const configuredTransactionFee = transactionFeeForAmount(normalizedPrincipal, settings);
  const transactionFeeAmount =
    configuredTransactionFee > 0
      ? configuredTransactionFee
      : normalizedPrincipal * (settings.percentages.transactionCostPct / 100);
  return {
    processingFeeAmount,
    insuranceFeeAmount,
    transactionFeeAmount,
  };
}

export function normalizeLegacyCarryoverLoanFeeBreakdown(
  value?: LegacyCarryoverLoanFeeBreakdown | Record<string, unknown> | null,
  loanCycleNumber: number = 1,
): LegacyCarryoverLoanFeeBreakdown {
  const source = value && typeof value === "object" ? value : {};
  const isFirstLoan = Math.max(1, Math.floor(Number(loanCycleNumber || 1))) === 1;
  return {
    membershipFeeAmount: isFirstLoan ? moneyValue(source.membershipFeeAmount) : 0,
    cardFeeAmount: isFirstLoan ? moneyValue(source.cardFeeAmount) : 0,
    stickerFeeAmount: isFirstLoan ? moneyValue(source.stickerFeeAmount) : 0,
    processingFeeAmount: moneyValue(source.processingFeeAmount),
    insuranceFeeAmount: moneyValue(source.insuranceFeeAmount),
    transactionFeeAmount: moneyValue(source.transactionFeeAmount),
    monthlySubscriptionAmount: moneyValue(source.monthlySubscriptionAmount),
    subscriptionMonths: Math.max(0, Math.floor(Number(source.subscriptionMonths ?? 0))),
    subscriptionWaived: source.subscriptionWaived === true,
    dailyPenaltyDays: wholeDaysValue(source.dailyPenaltyDays),
    dailyPenaltyAmount: moneyValue(source.dailyPenaltyAmount),
    dueDatePenaltyDays: wholeDaysValue(source.dueDatePenaltyDays),
  };
}

export function effectiveLegacyInterestRate(
  loan: Pick<LegacyCarryoverLoan, "termDays" | "interestRatePct" | "principal">,
  settings: PolicySettings = DEFAULT_POLICY_SETTINGS,
) {
  const configured = Number(loan.interestRatePct ?? 0);
  if (configured > 0) return configured;
  const loanType = Number(loan.principal ?? 0) > 5000 ? "premium" : "standard";
  return policyInterestRateForTerm(loan.termDays, loanType, settings);
}

export function summarizeLegacyCarryoverLoan(
  loan: Pick<
    LegacyCarryoverLoan,
    | "principal"
    | "interestRatePct"
    | "termDays"
    | "dailySavingsAmount"
    | "startDate"
    | "dueDate"
    | "paidToDate"
    | "status"
    | "finished"
    | "penaltyWaivedAmount"
    | "loanCycleNumber"
    | "feeBreakdown"
  >,
  settings: PolicySettings = DEFAULT_POLICY_SETTINGS,
  asOfDate: string = new Date().toISOString().slice(0, 10),
) {
  const termDays = normalizeTermDays(loan.termDays);
  const ratePct = effectiveLegacyInterestRate(loan, settings);
  const principal = Number(loan.principal ?? 0);
  const paidToDate = Number(loan.paidToDate ?? 0);
  const dailySavingsAmount = Math.max(0, Number(loan.dailySavingsAmount ?? 0));
  const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
    loan.feeBreakdown,
    loan.loanCycleNumber,
  );
  const oneTimeFees =
    (feeBreakdown.membershipFeeAmount ?? 0) +
    (feeBreakdown.cardFeeAmount ?? 0) +
    (feeBreakdown.stickerFeeAmount ?? 0);
  const loanServiceFees =
    (feeBreakdown.processingFeeAmount ?? 0) +
    (feeBreakdown.insuranceFeeAmount ?? 0) +
    (feeBreakdown.transactionFeeAmount ?? 0);
  const defaultServiceFees = defaultLoanServiceFees(principal, settings);
  const financedLoanServiceFees =
    loanServiceFees > 0
      ? loanServiceFees
      : defaultServiceFees.processingFeeAmount +
        defaultServiceFees.insuranceFeeAmount +
        defaultServiceFees.transactionFeeAmount;
  const subscriptionTotalBeforeWaiver =
    (feeBreakdown.monthlySubscriptionAmount ?? 0) * (feeBreakdown.subscriptionMonths ?? 0);
  const subscriptionDeducted = feeBreakdown.subscriptionWaived ? 0 : subscriptionTotalBeforeWaiver;
  const subscriptionWaivedAmount = feeBreakdown.subscriptionWaived
    ? subscriptionTotalBeforeWaiver
    : 0;
  const feeChargesTotal = oneTimeFees + financedLoanServiceFees + subscriptionDeducted;
  const financedPrincipal = principal + feeChargesTotal;
  const periods = termPeriodsFromDays(termDays);
  const interest = financedPrincipal * (ratePct / 100) * periods;
  const totalRepayment = financedPrincipal + interest;
  const dailyLoanInstallment = termDays > 0 ? totalRepayment / termDays : totalRepayment;
  const rawDailyInclusive = dailyLoanInstallment + dailySavingsAmount;
  const dailyInclusive = roundUpKES(rawDailyInclusive, settings.percentages.roundOffStep);
  const totalSavingsAccrued = dailySavingsAmount * termDays;
  const totalExpectedCollected = dailyInclusive * termDays;
  const dueDate = toDateOnly(loan.dueDate) || addDays(loan.startDate, termDays);
  const elapsedDays = Math.max(0, Math.min(termDays, diffDays(loan.startDate, asOfDate) + 1));
  const scheduledCollectedToDate = elapsedDays * dailyInclusive;
  const arrears = Math.max(0, scheduledCollectedToDate - paidToDate);
  const balance = Math.max(0, totalExpectedCollected - paidToDate);
  const dailyPenaltyDays = feeBreakdown.dailyPenaltyDays ?? 0;
  const dailyPenaltyAmount = feeBreakdown.dailyPenaltyAmount ?? 0;
  const dueDatePenaltyDays = feeBreakdown.dueDatePenaltyDays ?? 0;
  const calculatedArrearsPenalty =
    dailyInclusive * dailyPenaltyDays * (settings.percentages.penaltyDailyPct / 100);
  const arrearsPenalty = dailyPenaltyAmount > 0 ? dailyPenaltyAmount : calculatedArrearsPenalty;
  const automaticDaysPastDue = Math.max(0, diffDays(dueDate, asOfDate));
  const daysPastDue =
    loan.status === "active"
      ? 0
      : loan.status === "defaulted"
        ? automaticDaysPastDue
        : dueDatePenaltyDays;
  const dueDatePenaltyBase = Math.max(0, totalExpectedCollected + arrearsPenalty - paidToDate);
  const overduePenalty = compoundedDailyPenalty(
    dueDatePenaltyBase,
    settings.percentages.defaultPenaltyPct,
    daysPastDue,
  );
  const penaltyWaivedAmount = Math.max(0, Number(loan.penaltyWaivedAmount ?? 0));
  const estimatedPenaltyNow = Math.max(0, arrearsPenalty + overduePenalty - penaltyWaivedAmount);
  const totalOwedNow = balance + estimatedPenaltyNow;
  const paidPct = totalExpectedCollected > 0 ? (paidToDate / totalExpectedCollected) * 100 : 0;
  const isFinished = loan.finished || loan.status === "closed" || balance <= 0;

  return {
    termDays,
    ratePct,
    periods,
    financedPrincipal,
    interest,
    feeBreakdown,
    defaultServiceFees,
    oneTimeFees,
    loanServiceFees: financedLoanServiceFees,
    subscriptionDeducted,
    subscriptionWaivedAmount,
    feeChargesTotal,
    totalRepayment,
    dailyLoanInstallment,
    dailyInclusive,
    roundOff: Math.max(0, dailyInclusive - rawDailyInclusive),
    totalSavingsAccrued,
    totalExpectedCollected,
    scheduledCollectedToDate,
    arrears,
    balance,
    dueDate,
    elapsedDays,
    daysPastDue,
    dailyPenaltyDays,
    dailyPenaltyAmount,
    dueDatePenaltyDays,
    dailyPenaltyBase: dailyInclusive,
    calculatedArrearsPenalty,
    dueDatePenaltyBase,
    arrearsPenalty,
    overduePenalty,
    estimatedPenaltyNow,
    totalOwedNow,
    paidPct,
    isFinished,
    penaltyWaivedAmount,
  };
}
