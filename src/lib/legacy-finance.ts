import { DEFAULT_POLICY_SETTINGS, type PolicySettings } from "@/lib/policy-settings";

export type LegacyTopupImport = {
  id: string;
  sourceRowKey: string;
  sourceTable: string;
  sourceCreatedAt?: string;
  sourceAccount?: string;
  sourceMemberHint?: string;
  sourcePayerName?: string;
  sourcePhone?: string;
  sourceAmount: number;
  sourceRef?: string;
  raw: Record<string, unknown>;
  matchedMemberId?: string;
  allocationStatus: "pending" | "applied" | "held" | "error";
  allocationNotes: string[];
  allocatedTransactionId?: string;
  allocatedAt?: string;
  syncRunId?: string;
  readOnly: boolean;
  lastSeenAt: string;
  createdAt: string;
};

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
  if (termDays === 7 || termDays === 14 || termDays === 30 || termDays === 60 || termDays === 90)
    return termDays;
  if ((termDays ?? 0) <= 10) return 7;
  if ((termDays ?? 0) <= 21) return 14;
  if ((termDays ?? 0) <= 45) return 30;
  if ((termDays ?? 0) <= 75) return 60;
  return 90;
}

export function effectiveLegacyInterestRate(
  loan: Pick<LegacyCarryoverLoan, "termDays" | "interestRatePct">,
  settings: PolicySettings = DEFAULT_POLICY_SETTINGS,
) {
  const configured = Number(loan.interestRatePct ?? 0);
  if (configured > 0) return configured;
  return settings.interestRates[normalizeTermDays(loan.termDays)];
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
  >,
  settings: PolicySettings = DEFAULT_POLICY_SETTINGS,
  asOfDate: string = new Date().toISOString().slice(0, 10),
) {
  const termDays = normalizeTermDays(loan.termDays);
  const ratePct = effectiveLegacyInterestRate(loan, settings);
  const principal = Number(loan.principal ?? 0);
  const paidToDate = Number(loan.paidToDate ?? 0);
  const dailySavingsAmount = Math.max(0, Number(loan.dailySavingsAmount ?? 0));
  const interest = principal * (ratePct / 100);
  const totalRepayment = principal + interest;
  const dailyLoanInstallment = termDays > 0 ? totalRepayment / termDays : totalRepayment;
  const dailyInclusive = dailyLoanInstallment + dailySavingsAmount;
  const totalSavingsAccrued = dailySavingsAmount * termDays;
  const totalExpectedCollected = dailyInclusive * termDays;
  const dueDate = toDateOnly(loan.dueDate) || addDays(loan.startDate, termDays);
  const elapsedDays = Math.max(0, Math.min(termDays, diffDays(loan.startDate, asOfDate) + 1));
  const scheduledCollectedToDate = elapsedDays * dailyInclusive;
  const arrears = Math.max(0, scheduledCollectedToDate - paidToDate);
  const balance = Math.max(0, totalRepayment - paidToDate);
  const daysPastDue = Math.max(0, diffDays(dueDate, asOfDate));
  const arrearsPenalty = arrears * (settings.percentages.penaltyDailyPct / 100);
  const overduePenalty =
    daysPastDue > 0 ? balance * (settings.percentages.defaultPenaltyPct / 100) * daysPastDue : 0;
  const penaltyWaivedAmount = Math.max(0, Number(loan.penaltyWaivedAmount ?? 0));
  const estimatedPenaltyNow = Math.max(0, arrearsPenalty + overduePenalty - penaltyWaivedAmount);
  const totalOwedNow = balance + estimatedPenaltyNow;
  const paidPct = totalRepayment > 0 ? (paidToDate / totalRepayment) * 100 : 0;
  const isFinished = loan.finished || loan.status === "closed" || balance <= 0;

  return {
    termDays,
    ratePct,
    interest,
    totalRepayment,
    dailyLoanInstallment,
    dailyInclusive,
    totalSavingsAccrued,
    totalExpectedCollected,
    scheduledCollectedToDate,
    arrears,
    balance,
    dueDate,
    elapsedDays,
    daysPastDue,
    arrearsPenalty,
    overduePenalty,
    estimatedPenaltyNow,
    totalOwedNow,
    paidPct,
    isFinished,
    penaltyWaivedAmount,
  };
}
