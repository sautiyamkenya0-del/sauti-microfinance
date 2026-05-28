import {
  DEFAULT_POLICY_SETTINGS,
  normalizePolicyTermDays,
  policyInterestRateForTerm,
  transactionFeeForAmount,
  type PolicySettings,
} from "@/lib/policy-settings";
import {
  DEFAULT_DEFAULTED_AMOUNT_STOP_CAP,
  addIsoDays,
  buildLoanDailyLedger,
} from "@/lib/loan-calculations";

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
  manualPenaltyAmount?: number;
  carriedForwardPenaltyAmount?: number;
  priorPenaltyAmount?: number;
  totalPenaltiesBeforeLastLoan?: number;
  dailyPenaltyDays?: number;
  dailyPenaltyAmount?: number;
  dueDatePenaltyDays?: number;
  productMeta?: Record<string, unknown>;
};

export type LegacyCarryoverLoan = {
  id: string;
  memberId: string;
  label: string;
  loanKind?: "financial" | "fuel" | "stock" | "service";
  loanCycleNumber: number;
  principal: number;
  interestRatePct: number;
  termDays: number;
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

function optionalDateValue(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function roundUpKES(amount: number, step: number) {
  if (amount <= 0) return 0;
  const normalizedStep = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.ceil(amount / normalizedStep) * normalizedStep;
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
  const manualPenaltyAmount = moneyValue(source.manualPenaltyAmount);
  const carriedForwardPenaltyAmount = moneyValue(source.carriedForwardPenaltyAmount);
  const legacyPriorPenaltyAmount = moneyValue(
    source.priorPenaltyAmount ?? source.totalPenaltiesBeforeLastLoan,
  );
  const priorPenaltyAmount =
    manualPenaltyAmount > 0 || carriedForwardPenaltyAmount > 0
      ? manualPenaltyAmount + carriedForwardPenaltyAmount
      : legacyPriorPenaltyAmount;
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
    manualPenaltyAmount,
    carriedForwardPenaltyAmount,
    priorPenaltyAmount,
    dailyPenaltyDays: wholeDaysValue(source.dailyPenaltyDays),
    dailyPenaltyAmount: moneyValue(source.dailyPenaltyAmount),
    dueDatePenaltyDays: wholeDaysValue(source.dueDatePenaltyDays),
    productMeta:
      source.productMeta && typeof source.productMeta === "object"
        ? (source.productMeta as Record<string, unknown>)
        : {},
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
    | "loanKind"
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
  const sourceFeeBreakdown =
    loan.feeBreakdown && typeof loan.feeBreakdown === "object" ? loan.feeBreakdown : {};
  const frozenAsOf = optionalDateValue(
    (sourceFeeBreakdown.productMeta as Record<string, unknown> | undefined)?.frozenAsOf,
  );
  const effectiveAsOfDate = frozenAsOf ?? asOfDate;
  const loanKind =
    loan.loanKind === "fuel" || loan.loanKind === "stock" || loan.loanKind === "service"
      ? loan.loanKind
      : "financial";
  const supplierBacked = loanKind === "fuel" || loanKind === "stock" || loanKind === "service";
  const requestedTermDays = Math.max(1, Math.floor(Number(loan.termDays ?? 0)));
  const termDays = supplierBacked
    ? requestedTermDays || (loanKind === "fuel" ? 1 : 14)
    : normalizeTermDays(loan.termDays);
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
  const productMeta = feeBreakdown.productMeta ?? {};
  const productCharge =
    loanKind === "fuel"
      ? moneyValue(productMeta.fuelCharge ?? productMeta.charge ?? feeBreakdown.processingFeeAmount)
      : loanKind === "stock"
        ? moneyValue(
            productMeta.stockCharge ?? productMeta.charge ?? feeBreakdown.processingFeeAmount,
          )
        : supplierBacked
          ? moneyValue(
              productMeta.serviceCharge ?? productMeta.charge ?? feeBreakdown.processingFeeAmount,
            )
          : 0;
  const loanServiceFees = supplierBacked
    ? 0
    : (feeBreakdown.processingFeeAmount ?? 0) +
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
  const feeChargesTotal = supplierBacked
    ? productCharge
    : oneTimeFees + financedLoanServiceFees + subscriptionDeducted;
  const financedPrincipal = principal + feeChargesTotal;
  const periods = termPeriodsFromDays(termDays);
  const interest = supplierBacked ? 0 : financedPrincipal * (ratePct / 100) * periods;
  const totalRepayment = financedPrincipal + interest;
  const dailyLoanInstallment = termDays > 0 ? totalRepayment / termDays : totalRepayment;
  const effectiveDailySavingsAmount = supplierBacked ? 0 : dailySavingsAmount;
  const rawDailyInclusive = dailyLoanInstallment + effectiveDailySavingsAmount;
  const dailyInclusive = roundUpKES(
    rawDailyInclusive,
    Math.max(5, settings.percentages.roundOffStep || 5),
  );
  const totalSavingsAccrued = effectiveDailySavingsAmount * termDays;
  const totalExpectedCollected = dailyInclusive * termDays;
  const dueDate = toDateOnly(loan.dueDate) || addIsoDays(loan.startDate, termDays);
  const priorPenaltyAmount =
    (feeBreakdown.priorPenaltyAmount ?? 0) > 0
      ? (feeBreakdown.priorPenaltyAmount ?? 0)
      : (feeBreakdown.dailyPenaltyAmount ?? 0);
  const ledger = buildLoanDailyLedger({
    startDate: loan.startDate,
    termDays,
    dailyInstallment: dailyInclusive,
    totalExpected: totalExpectedCollected,
    asOfDate: effectiveAsOfDate,
    fallbackPaid: paidToDate,
    penaltyPct: settings.percentages.penaltyDailyPct,
    defaultPenaltyPct: settings.percentages.defaultPenaltyPct,
    priorPenaltyAmount,
    defaultFromDate: addIsoDays(dueDate, 1),
    defaultedAmountCap: DEFAULT_DEFAULTED_AMOUNT_STOP_CAP,
  });
  const elapsedDays = Math.max(0, Math.min(termDays, diffDays(loan.startDate, effectiveAsOfDate)));
  const scheduledCollectedToDate = ledger.scheduledCollectedToDate;
  const arrears = ledger.currentDailyBalance;
  const balance = Math.max(0, totalExpectedCollected - ledger.totalPaid);
  const dailyPenaltyDays = ledger.dailyPenaltyDays;
  const dailyPenaltyAmount = priorPenaltyAmount;
  const dueDatePenaltyDays = ledger.daysPastDue;
  const calculatedArrearsPenalty = ledger.dailyPenaltyAmount;
  const arrearsPenalty = priorPenaltyAmount + ledger.dailyPenaltyAmount;
  const daysPastDue = ledger.daysPastDue;
  const dueDatePenaltyBase = ledger.currentDailyBalance;
  const overduePenalty = ledger.defaultPenaltyAmount;
  const penaltyWaivedAmount = Math.max(0, Number(loan.penaltyWaivedAmount ?? 0));
  const estimatedPenaltyNow = Math.max(0, ledger.totalPenalty - penaltyWaivedAmount);
  const totalOwedNow = Math.max(0, totalExpectedCollected + estimatedPenaltyNow - ledger.totalPaid);
  const autoStopped =
    daysPastDue > 0 &&
    DEFAULT_DEFAULTED_AMOUNT_STOP_CAP > 0 &&
    totalOwedNow >= DEFAULT_DEFAULTED_AMOUNT_STOP_CAP;
  const paidPct = totalExpectedCollected > 0 ? (paidToDate / totalExpectedCollected) * 100 : 0;
  const isFinished = totalOwedNow <= 0;

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
    productCharge,
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
    priorPenaltyAmount,
    dueDatePenaltyDays,
    dailyPenaltyBase: dailyInclusive,
    calculatedArrearsPenalty,
    dueDatePenaltyBase,
    arrearsPenalty,
    overduePenalty,
    estimatedPenaltyNow,
    totalOwedNow,
    defaultedAmount: daysPastDue > 0 && totalOwedNow > 0 ? totalOwedNow : 0,
    autoStopped,
    autoStoppedAt: autoStopped ? ledger.autoStoppedAt : undefined,
    paidPct,
    isFinished,
    penaltyWaivedAmount,
    frozenAsOf,
    repaymentLedger: ledger.rows,
  };
}
