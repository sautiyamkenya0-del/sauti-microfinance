import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  Percent,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { OperationProgress } from "@/components/OperationProgress";
import {
  FuelJobCardFields,
  normalizeFuelJobCardRows,
  summarizeFuelJobCardRows,
} from "@/components/loans/FuelJobCardFields";
import { PaymentFlowTree } from "@/components/PaymentFlowTree";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import {
  deleteFeePolicyRecord,
  deleteMemberCarryoverLoanRecord,
  deleteServiceCatalogRecord,
  listMpesaReceiptAudit,
  resetMemberCarryoverRecord,
  triggerPurposePoolRedistributionRecord,
  upsertMemberCarryoverLoanRecord,
  upsertMemberCarryoverProfileRecord,
  upsertFeePolicyRecord,
  upsertPolicySettingRecord,
  upsertServiceApplicationRecord,
  upsertServiceCatalogRecord,
  waivePenaltyRecord,
} from "@/lib/app-data.functions";
import {
  type LegacyCarryoverLoan,
  type LegacyCarryoverProfile,
  normalizeLegacyCarryoverLoanFeeBreakdown,
  summarizeLegacyCarryoverLoan,
} from "@/lib/legacy-finance";
import {
  DEFAULT_FEE_POLICIES,
  isFeeActive,
  scopeLabel,
  type FeePermanence,
  type FeePolicy,
  type FeeScope,
} from "@/lib/fees-policy";
import {
  TARGET_METRIC_META,
  TARGET_PERIOD_LABELS,
  usePerformanceTargetActions,
  type PerformanceTarget,
  type TargetMetric,
  type TargetPeriod,
} from "@/lib/performance-targets";
import {
  WATERFALL_DESTINATION_LABELS,
  WATERFALL_SCENARIO_LABELS,
  waterfallOptionsForScenario,
  type WaterfallDestination,
  type WaterfallRule,
  type WaterfallScenario,
} from "@/lib/policy-settings";
import {
  listAllCarryoverLoans,
  listCountyChargeSchedules,
  listServiceApplications,
  listServiceCatalog,
  loadMemberCarryover,
} from "@/lib/runtime-data.functions";
import {
  fmtKES,
  loanSummary,
  memberNeedsSticker,
  SBC_UPFRONT_TABLE,
  upfrontRequirementForAmount,
  upfrontTotalsForAmount,
  useStore,
  type LoanKind,
} from "@/lib/store";

type PolicyCenterTab =
  | "fees"
  | "services"
  | "percentages"
  | "interest"
  | "waterfall"
  | "clients"
  | "targets";

type TargetDraft = {
  id?: string;
  metric: TargetMetric;
  period: TargetPeriod;
  expectedValue: number;
  startOn: string;
  notes: string;
};

type ServiceDraft = {
  id?: string;
  name: string;
  serviceCategory: string;
  description: string;
  price: number;
  billingFrequency:
    | "one_time"
    | "daily"
    | "weekly"
    | "monthly"
    | "quarterly"
    | "semi_annual"
    | "annual"
    | "yearly"
    | "seasonal"
    | "custom";
  scope: "all_members" | "sbc_members" | "service_members" | "selected_members";
  selectedMemberIds: string[];
  deductionMode: "normal" | "override_all" | "amended_override";
  feeOverridesText: string;
  effectiveDate: string;
  expiryDate: string;
  registrationFee: number;
  processingFee: number;
  serviceCharge: number;
  waiverAmount: number;
  penaltyAmount: number;
  customChargesText: string;
  negotiatedDiscountAmount: number;
  normalDeductionsText: string;
  gracePeriodDays: number;
  renewalRulesText: string;
  active: boolean;
};

type ServiceApplicationDraft = {
  id?: string;
  applicationNumber?: string;
  memberId: string;
  serviceId: string;
  applicationKind: "new" | "repeat";
  serviceType: string;
  caseType: "normal" | "overcharged_invoice" | "invoice_with_penalty" | "confiscated_items";
  priority: "low" | "normal" | "high" | "urgent";
  problemReason: string;
  notes: string;
  county: string;
  subcounty: string;
  ward: string;
  town: string;
  scheduleId: string;
  invoiceReference: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceAmountCharged: number;
  issueDate: string;
  expiryDate: string;
  renewalWindowDays: number;
  gracePeriodDays: number;
  confiscationReference: string;
  inventorySheetNumber: string;
  confiscationDate: string;
  status: string;
  paymentStatus: string;
  workflowStage: string;
  manualCountyCharges: number;
  waiverAmount: number;
  penaltyAmount: number;
};

type CarryoverFeeBuckets = {
  membership: number;
  card: number;
  sticker: number;
  processing: number;
  insurance: number;
  transaction: number;
};

type CarryoverCollectionBreakdown = {
  totalDepositsRecorded: number;
  purposePoolBalance: number;
  feeBuckets: CarryoverFeeBuckets;
  preCarryoverLiveState?: Record<string, unknown>;
};

type CarryoverMemberMode = "loan" | "none";

const CARRYOVER_DAILY_COMPLIANCE_OPTIONS = [50, 100] as const;

function normalizeCarryoverDailyCompliance(value?: number | null) {
  return CARRYOVER_DAILY_COMPLIANCE_OPTIONS.includes(value as 50 | 100) ? Number(value) : 100;
}

const SCOPES: FeeScope[] = [
  "all",
  "new_only",
  "selected_members",
  "loan_holders",
  "financial_members",
  "locomotive_members",
  "stock_members",
  "service_members",
  "supplier_members",
  "investors",
];
const SUBPAGES: { key: PolicyCenterTab; label: string }[] = [
  { key: "fees", label: "Fees" },
  { key: "services", label: "Services" },
  { key: "percentages", label: "Percentages" },
  { key: "interest", label: "Interest" },
  { key: "waterfall", label: "Waterfall Flow" },
  { key: "clients", label: "Client Records" },
  { key: "targets", label: "Targets" },
];

export const Route = createFileRoute("/fees-policy")({
  head: () => ({ meta: [{ title: "Policy Center - Sauti Microfinance" }] }),
  component: PolicyCenterPage,
});

function PolicyCenterPage() {
  const {
    currentUser,
    feePolicies,
    policySettings,
    members,
    loans,
    penalties,
    sharePrice,
    transactions,
    reloadAppData,
  } = useStore();
  const saveFee = useServerFn(upsertFeePolicyRecord);
  const deleteFee = useServerFn(deleteFeePolicyRecord);
  const loadServices = useServerFn(listServiceCatalog);
  const loadCountySchedules = useServerFn(listCountyChargeSchedules);
  const loadServiceApplications = useServerFn(listServiceApplications);
  const saveService = useServerFn(upsertServiceCatalogRecord);
  const saveServiceApplication = useServerFn(upsertServiceApplicationRecord);
  const deleteService = useServerFn(deleteServiceCatalogRecord);
  const fetchMpesaAudit = useServerFn(listMpesaReceiptAudit);
  const savePolicySetting = useServerFn(upsertPolicySettingRecord);
  const loadCarryover = useServerFn(loadMemberCarryover);
  const loadAllCarryoverLoans = useServerFn(listAllCarryoverLoans);
  const saveCarryoverProfile = useServerFn(upsertMemberCarryoverProfileRecord);
  const saveCarryoverLoan = useServerFn(upsertMemberCarryoverLoanRecord);
  const deleteCarryoverLoan = useServerFn(deleteMemberCarryoverLoanRecord);
  const resetCarryover = useServerFn(resetMemberCarryoverRecord);
  const triggerRedistribution = useServerFn(triggerPurposePoolRedistributionRecord);
  const waivePenalty = useServerFn(waivePenaltyRecord);
  const { rows: targetRows, upsertTarget, removeTarget } = usePerformanceTargetActions();

  const [tab, setTab] = useState<PolicyCenterTab>(() =>
    typeof window !== "undefined" && window.location.hash === "#clients" ? "clients" : "fees",
  );
  const [editingFee, setEditingFee] = useState<FeePolicy | null>(null);
  const [creatingFee, setCreatingFee] = useState(false);
  const [feeBusy, setFeeBusy] = useState(false);
  const [serviceRows, setServiceRows] = useState<any[]>([]);
  const [countyScheduleRows, setCountyScheduleRows] = useState<any[]>([]);
  const [serviceApplicationRows, setServiceApplicationRows] = useState<any[]>([]);
  const [serviceDraft, setServiceDraft] = useState<ServiceDraft>(() => blankServiceDraft());
  const [serviceApplicationDraft, setServiceApplicationDraft] = useState<ServiceApplicationDraft>(
    () => blankServiceApplicationDraft(""),
  );
  const [serviceBusy, setServiceBusy] = useState(false);
  const [serviceApplicationBusy, setServiceApplicationBusy] = useState(false);
  const [percentagesDraft, setPercentagesDraft] = useState(policySettings.percentages);
  const [interestDraft, setInterestDraft] = useState(policySettings.interestRates);
  const [waterfallDraft, setWaterfallDraft] = useState(policySettings.waterfallRules);
  const [transactionFeeBandsDraft, setTransactionFeeBandsDraft] = useState(
    policySettings.transactionFeeBands,
  );
  const [waterfallScenario, setWaterfallScenario] = useState<WaterfallScenario>("member_with_loan");
  const [clientQuery, setClientQuery] = useState("");
  const [feeMemberQuery, setFeeMemberQuery] = useState("");
  const [serviceMemberQuery, setServiceMemberQuery] = useState("");
  const memberAccounts = useMemo(
    () => members.filter((member) => member.category !== "investor"),
    [members],
  );
  const feeSelectableMembers = useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );
  const activeLoanMemberIds = useMemo(
    () => new Set(loans.filter((loan) => loan.status === "active").map((loan) => loan.memberId)),
    [loans],
  );
  const filteredFeeSelectableMembers = useMemo(() => {
    const query = feeMemberQuery.trim().toLowerCase();
    if (!query) return feeSelectableMembers;
    return feeSelectableMembers.filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        member.id.toLowerCase().includes(query) ||
        member.phone.toLowerCase().includes(query),
    );
  }, [feeMemberQuery, feeSelectableMembers]);
  const filteredServiceMembers = useMemo(() => {
    const query = serviceMemberQuery.trim().toLowerCase();
    if (!query) return memberAccounts;
    return memberAccounts.filter(
      (member) =>
        member.name.toLowerCase().includes(query) ||
        member.id.toLowerCase().includes(query) ||
        member.phone.toLowerCase().includes(query),
    );
  }, [memberAccounts, serviceMemberQuery]);
  const newFeeSelectableMembers = useMemo(() => {
    if (!editingFee) return [];
    const effectiveFrom = String(editingFee.effectiveFrom ?? "").slice(0, 10);
    if (!effectiveFrom) return [];
    return feeSelectableMembers.filter(
      (member) => String(member.joinedAt ?? "").slice(0, 10) >= effectiveFrom,
    );
  }, [editingFee, feeSelectableMembers]);
  const [clientId, setClientId] = useState<string>(memberAccounts[0]?.id ?? "");
  const [targetDraft, setTargetDraft] = useState<TargetDraft>(() => blankTarget());
  const [carryoverLoading, setCarryoverLoading] = useState(false);
  const [carryoverProfile, setCarryoverProfile] = useState<LegacyCarryoverProfile>(() =>
    blankCarryoverProfile(""),
  );
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);
  const [allCarryoverLoans, setAllCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);
  const [carryoverLoanDraft, setCarryoverLoanDraft] = useState<LegacyCarryoverLoan>(() =>
    blankCarryoverLoan("", 1),
  );
  const [hasCarryoverProfile, setHasCarryoverProfile] = useState(false);
  const [carryoverMemberMode, setCarryoverMemberMode] = useState<CarryoverMemberMode>("none");
  const [guidedLoanKind, setGuidedLoanKind] = useState<LoanKind>("financial");
  const [guidedLoanEntries, setGuidedLoanEntries] = useState<LegacyCarryoverLoan[]>([]);
  const [waiverNote, setWaiverNote] = useState("");
  const [waiverAmounts, setWaiverAmounts] = useState<Record<string, number>>({});
  const [isRedistributing, setIsRedistributing] = useState(false);
  const [carryoverResetting, setCarryoverResetting] = useState(false);
  const [carryoverSaving, setCarryoverSaving] = useState(false);
  const [showCarryoverAdvanced, setShowCarryoverAdvanced] = useState(false);
  const [selectedClientMpesaAuditRows, setSelectedClientMpesaAuditRows] = useState<any[]>([]);

  useEffect(() => {
    setPercentagesDraft(policySettings.percentages);
    setInterestDraft(policySettings.interestRates);
    setWaterfallDraft(policySettings.waterfallRules);
    setTransactionFeeBandsDraft(policySettings.transactionFeeBands);
  }, [policySettings]);

  useEffect(() => {
    if (!clientId && memberAccounts[0]?.id) setClientId(memberAccounts[0].id);
  }, [clientId, memberAccounts]);

  useEffect(() => {
    setServiceApplicationDraft((current) =>
      current.memberId || !memberAccounts[0]?.id
        ? current
        : { ...current, memberId: memberAccounts[0].id },
    );
  }, [memberAccounts]);

  useEffect(() => {
    setFeeMemberQuery("");
  }, [editingFee?.key]);

  const refreshServices = useCallback(async () => {
    setServiceRows((await loadServices()) as any[]);
  }, [loadServices]);

  const refreshServiceApplications = useCallback(async () => {
    const [schedules, applications] = await Promise.all([
      loadCountySchedules(),
      loadServiceApplications(),
    ]);
    setCountyScheduleRows(schedules as any[]);
    setServiceApplicationRows(applications as any[]);
  }, [loadCountySchedules, loadServiceApplications]);

  useEffect(() => {
    refreshServices().catch((error: any) => {
      toast.error(error?.message ?? "Failed to load service catalog.");
    });
  }, [refreshServices]);

  useEffect(() => {
    refreshServiceApplications().catch((error: any) => {
      toast.error(error?.message ?? "Failed to load service applications.");
    });
  }, [refreshServiceApplications]);

  const refreshAllCarryoverLoans = useCallback(async () => {
    setAllCarryoverLoans(await loadAllCarryoverLoans());
  }, [loadAllCarryoverLoans]);

  useEffect(() => {
    refreshAllCarryoverLoans().catch((error: any) => {
      toast.error(error?.message ?? "Failed to load carryover loan summaries.");
    });
  }, [refreshAllCarryoverLoans]);

  useEffect(() => {
    setShowCarryoverAdvanced(false);
    if (!clientId) {
      setCarryoverProfile(blankCarryoverProfile(""));
      setCarryoverLoans([]);
      setCarryoverLoanDraft(blankCarryoverLoan("", 1));
      setHasCarryoverProfile(false);
      setCarryoverMemberMode("none");
      setGuidedLoanKind("financial");
      setGuidedLoanEntries([]);
      return;
    }

    let active = true;
    setCarryoverLoading(true);
    loadCarryover({ data: { memberId: clientId } })
      .then((result) => {
        if (!active) return;
        const typedResult = result as {
          profile: LegacyCarryoverProfile | null;
          loans: LegacyCarryoverLoan[];
        };
        const selectedMember = memberAccounts.find((member) => member.id === clientId);
        const blankProfile = blankCarryoverProfile(clientId);
        if (selectedMember) {
          blankProfile.membershipFeePaid = !!selectedMember.fees.membership;
          blankProfile.cardFeePaid = !!selectedMember.fees.card;
          blankProfile.stickerFeePaid = !!selectedMember.fees.sticker;
          blankProfile.firstUpfrontPaid = !!selectedMember.fees.firstUpfrontPaid;
        }
        const profile = hydrateCarryoverProfile(typedResult.profile ?? blankProfile);
        setHasCarryoverProfile(Boolean(typedResult.profile));
        setCarryoverProfile(profile);
        setCarryoverLoans(typedResult.loans);
        setCarryoverLoanDraft(blankCarryoverLoan(clientId, typedResult.loans.length + 1));
        setCarryoverMemberMode(typedResult.loans.length > 0 ? "loan" : "none");
        setGuidedLoanKind(normalizeGuidedLoanKind(typedResult.loans[0]?.loanKind));
        setGuidedLoanEntries(typedResult.loans);
      })
      .catch((error: any) => {
        if (!active) return;
        toast.error(error?.message ?? "Failed to load legacy carryover details.");
      })
      .finally(() => {
        if (active) setCarryoverLoading(false);
      });

    return () => {
      active = false;
    };
  }, [clientId, loadCarryover, memberAccounts]);

  useEffect(() => {
    if (!clientId) {
      setSelectedClientMpesaAuditRows([]);
      return;
    }

    let active = true;
    fetchMpesaAudit({ data: { memberId: clientId } })
      .then((rows) => {
        if (active) setSelectedClientMpesaAuditRows(Array.isArray(rows) ? rows : []);
      })
      .catch((error: any) => {
        if (active) {
          setSelectedClientMpesaAuditRows([]);
          toast.error(error?.message ?? "Failed to load selected client M-Pesa totals.");
        }
      });

    return () => {
      active = false;
    };
  }, [clientId, fetchMpesaAudit]);

  const todayIso = new Date().toISOString().slice(0, 10);
  const selectedClient = memberAccounts.find((member) => member.id === clientId) ?? null;
  const selectedClientLoans = loans.filter((loan) => loan.memberId === clientId);
  const selectedClientPenalties = penalties.filter((penalty) => penalty.memberId === clientId);
  const selectedClientTransactions = transactions.filter(
    (transaction) => transaction.memberId === clientId,
  );
  const selectedClientMpesaTransactionIds = new Set(
    selectedClientMpesaAuditRows.flatMap((row) => row.transactionIds ?? []),
  );
  const selectedClientLedgerTransactions = selectedClientTransactions.filter(
    (transaction) =>
      transaction.by !== "MPESA" &&
      !selectedClientMpesaTransactionIds.has(transaction.id) &&
      !isInternalSyntheticTransaction(transaction),
  );
  const feeRows = feePolicies.length > 0 ? feePolicies : DEFAULT_FEE_POLICIES;
  const activeFees = feeRows.filter(isFeeActive);
  const nonLoanServiceDeductionFees = activeFees.filter(
    (fee) => fee.scope !== "loan_holders" && fee.scope !== "investors",
  );
  const membershipAmount = feeRows.find((fee) => fee.key === "membership")?.amount ?? 0;
  const cardAmount = feeRows.find((fee) => fee.key === "card")?.amount ?? 0;
  const stickerAmount = feeRows.find((fee) => fee.key === "sticker")?.amount ?? 0;
  const fuelBufferFeeAmount = feeRows.find((fee) => fee.key === "fuel_buffer")?.amount ?? 0;
  const monthlySubscriptionAmount =
    feeRows.find((fee) => fee.key === "monthly_member_subscription")?.amount ?? 0;
  const annualSubscriptionAmount =
    feeRows.find((fee) => fee.key === "annual_member_subscription")?.amount ?? 0;
  const filteredClients = memberAccounts.filter((member) => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      member.name.toLowerCase().includes(q) ||
      member.id.toLowerCase().includes(q) ||
      member.phone.toLowerCase().includes(q)
    );
  });
  const currentWaterfall =
    waterfallDraft.find((rule) => rule.scenario === waterfallScenario) ??
    policySettings.waterfallRules.find((rule) => rule.scenario === waterfallScenario);
  const selectedClientMpesaInflow = selectedClientMpesaAuditRows
    .filter((row) => row.direction === "in")
    .reduce((sum, row) => sum + Number(row.originalAmount ?? row.amount ?? 0), 0);
  const selectedClientMpesaOutflow = selectedClientMpesaAuditRows
    .filter((row) => row.direction === "out")
    .reduce((sum, row) => sum + Number(row.originalAmount ?? row.amount ?? 0), 0);
  const selectedClientInflow =
    selectedClientLedgerTransactions
      .filter((transaction) => isClientInflowTransactionType(transaction.type))
      .reduce((sum, transaction) => sum + transaction.amount, 0) + selectedClientMpesaInflow;
  const selectedClientOutflow =
    selectedClientLedgerTransactions
      .filter((transaction) => isClientOutflowTransactionType(transaction.type))
      .reduce((sum, transaction) => sum + transaction.amount, 0) + selectedClientMpesaOutflow;
  const selectedClientNet = selectedClientInflow - selectedClientOutflow;

  const clientLoansSummary = selectedClientLoans.map((loan) => ({
    loan,
    summary: loanSummary(loan),
  }));
  const carryoverLoanSummaries = carryoverLoans.map((loan) => ({
    loan,
    summary: summarizeLegacyCarryoverLoan(loan, policySettings),
  }));
  const allCarryoverLoanSummaries = allCarryoverLoans.map((loan) => ({
    loan,
    summary: summarizeLegacyCarryoverLoan(loan, policySettings),
  }));
  const carryoverLoanDraftSummary = summarizeLegacyCarryoverLoan(
    carryoverLoanDraft,
    policySettings,
  );
  const carryoverLoanDraftFuelRows = carryoverFuelRows(carryoverLoanDraft);
  const carryoverBreakdown = readCarryoverBreakdown(carryoverProfile.collectionBreakdown);
  const lifetimeNetAvailableForCarryover = Math.max(
    0,
    selectedClientNet,
    carryoverProfile.totalCollected,
    carryoverBreakdown.totalDepositsRecorded,
  );
  const carryoverLoanInputs = guidedLoanEntries;
  const carryoverHasDraftData =
    hasCarryoverProfile ||
    carryoverLoans.length > 0 ||
    carryoverMemberMode === "loan" ||
    carryoverProfile.savingsBalance > 0 ||
    carryoverProfile.shareUnits > 0 ||
    carryoverProfile.investmentBalance > 0 ||
    carryoverProfile.otherCollectedTotal > 0 ||
    carryoverProfile.penaltiesOutstanding > 0 ||
    carryoverProfile.penaltiesWaivedTotal > 0 ||
    carryoverBreakdown.purposePoolBalance > 0;
  const automaticCarryoverDeductions = deriveAutomaticCarryoverDeductions({
    available: carryoverHasDraftData ? lifetimeNetAvailableForCarryover : 0,
    member: selectedClient ?? undefined,
    loans: carryoverLoanInputs.length > 0 ? carryoverLoanInputs : carryoverLoans,
    membershipAmount,
    cardAmount,
    stickerAmount,
    sharePrice,
  });
  const carryoverFeeBuckets = {
    ...carryoverBreakdown.feeBuckets,
    membership: automaticCarryoverDeductions.feeBuckets.membership,
    card: automaticCarryoverDeductions.feeBuckets.card,
    sticker: automaticCarryoverDeductions.feeBuckets.sticker,
  };
  const carryoverFeeTotal = Object.values(carryoverFeeBuckets).reduce(
    (sum, value) => sum + value,
    0,
  );
  const carryoverLoanPaymentBudget = Math.max(
    0,
    lifetimeNetAvailableForCarryover -
      carryoverFeeTotal -
      automaticCarryoverDeductions.upfrontSavingsAmount -
      automaticCarryoverDeductions.upfrontShareAmount,
  );
  const derivedGuidedLoanRows = deriveGuidedCarryoverLoanRows(
    guidedLoanEntries,
    policySettings,
    todayIso,
    carryoverLoanPaymentBudget,
  );
  const guidedClosedLoanSummaries = derivedGuidedLoanRows.filter((row) => row.status === "closed");
  const guidedDefaultedLoanSummaries = derivedGuidedLoanRows.filter(
    (row) => row.status === "defaulted",
  );
  const guidedActiveLoanSummaries = derivedGuidedLoanRows.filter((row) => row.status === "active");
  const guidedOpenLoanSummaries = [...guidedDefaultedLoanSummaries, ...guidedActiveLoanSummaries];
  const completedLoanComplianceTotal = guidedClosedLoanSummaries.reduce(
    (sum, row) => sum + row.summary.totalSavingsAccrued,
    0,
  );
  const guidedComplianceAllocation = allocateComplianceContribution(
    completedLoanComplianceTotal,
    policySettings.percentages.mandatorySavingsThreshold,
    policySettings.percentages.mandatorySharesThreshold,
    sharePrice,
  );
  const hasClosedCarryoverLoanRecords = carryoverLoans.some(
    (loan) => loan.status === "closed" || loan.finished,
  );
  const openCarryoverLoanSummaries = carryoverLoanSummaries.filter(
    ({ loan }) => loan.status !== "closed" && !loan.finished,
  );
  const carryoverLoanRepaymentsRecorded =
    hasClosedCarryoverLoanRecords ||
    openCarryoverLoanSummaries.length > 0 ||
    guidedLoanEntries.length > 0 ||
    guidedOpenLoanSummaries.length > 0
      ? derivedGuidedLoanRows.reduce((sum, row) => sum + row.loan.paidToDate, 0)
      : carryoverProfile.loanRepaymentsTotal;
  const effectiveCarryoverSavingsBalance = Math.max(
    carryoverProfile.savingsBalance,
    automaticCarryoverDeductions.upfrontSavingsAmount,
  );
  const effectiveCarryoverShareUnits = Math.max(
    carryoverProfile.shareUnits,
    automaticCarryoverDeductions.upfrontShareUnits,
  );
  const effectiveCarryoverShareValue = effectiveCarryoverShareUnits * sharePrice;
  const derivedCarryoverAllocatedTotal =
    effectiveCarryoverSavingsBalance +
    effectiveCarryoverShareValue +
    carryoverFeeTotal +
    carryoverLoanRepaymentsRecorded +
    carryoverProfile.investmentBalance +
    carryoverBreakdown.purposePoolBalance +
    carryoverProfile.otherCollectedTotal;
  const derivedCarryoverTotalCollected = carryoverHasDraftData
    ? lifetimeNetAvailableForCarryover
    : 0;
  const carryoverUndistributedBalance =
    derivedCarryoverTotalCollected - derivedCarryoverAllocatedTotal;
  const carryoverCompletedCycles =
    hasClosedCarryoverLoanRecords || guidedClosedLoanSummaries.length > 0
      ? guidedClosedLoanSummaries.length
      : carryoverProfile.completedLoanCycles;

  useEffect(() => {
    if (
      carryoverMemberMode !== "loan" ||
      completedLoanComplianceTotal <= 0 ||
      guidedOpenLoanSummaries.length > 0
    )
      return;
    setCarryoverProfile((current) => {
      const breakdown = readCarryoverBreakdown(current.collectionBreakdown);
      const nextSavingsBalance = Math.max(
        current.savingsBalance,
        guidedComplianceAllocation.savingsAmount,
      );
      const nextShareUnits = Math.max(current.shareUnits, guidedComplianceAllocation.shareUnits);
      const nextPurposePool = Math.max(
        breakdown.purposePoolBalance,
        guidedComplianceAllocation.purposePoolAmount,
      );
      if (
        nextSavingsBalance === current.savingsBalance &&
        nextShareUnits === current.shareUnits &&
        nextPurposePool === breakdown.purposePoolBalance
      ) {
        return current;
      }
      return {
        ...current,
        savingsBalance: nextSavingsBalance,
        shareUnits: nextShareUnits,
        collectionBreakdown: {
          ...breakdown,
          purposePoolBalance: nextPurposePool,
        },
      };
    });
  }, [
    carryoverMemberMode,
    completedLoanComplianceTotal,
    guidedComplianceAllocation.purposePoolAmount,
    guidedComplianceAllocation.savingsAmount,
    guidedComplianceAllocation.shareUnits,
    guidedOpenLoanSummaries.length,
  ]);

  const totalBorrowed = clientLoansSummary.reduce(
    (sum, row) => sum + (row.loan.approvedAmount ?? row.loan.principal),
    0,
  );
  const carryoverBorrowed = carryoverLoans.reduce((sum, loan) => sum + loan.principal, 0);
  const totalInterest = clientLoansSummary.reduce((sum, row) => sum + row.summary.interest, 0);
  const carryoverInterest = carryoverLoanSummaries.reduce(
    (sum, row) => sum + row.summary.interest,
    0,
  );
  const totalBalance = clientLoansSummary.reduce((sum, row) => sum + row.summary.balance, 0);
  const carryoverBalance = carryoverLoanSummaries.reduce(
    (sum, row) => sum + row.summary.totalOwedNow,
    0,
  );
  const penaltiesPaid = selectedClientPenalties
    .filter((penalty) => penalty.status === "paid")
    .reduce((sum, penalty) => sum + penalty.amount, 0);
  const penaltiesWaived = selectedClientPenalties
    .filter((penalty) => penalty.status === "waived")
    .reduce((sum, penalty) => sum + penalty.amount, 0);
  const penaltiesOutstanding = selectedClientPenalties
    .filter((penalty) => penalty.status === "outstanding")
    .reduce((sum, penalty) => sum + penalty.amount, 0);
  const totalCollections = selectedClientInflow;
  const combinedCollections = Math.max(totalCollections, derivedCarryoverTotalCollected);
  const combinedOutstandingBalance = totalBalance + carryoverBalance;
  const clientLifetimeNet = Math.max(selectedClientNet, derivedCarryoverTotalCollected);
  const selectedClientTransactionTotals = [
    {
      label: "Deposits",
      value: selectedClientTransactionTotal(
        selectedClientLedgerTransactions,
        selectedClientMpesaAuditRows,
        "deposit",
      ),
    },
    {
      label: "Withdrawals",
      value: selectedClientTransactionTotal(
        selectedClientLedgerTransactions,
        selectedClientMpesaAuditRows,
        "withdrawal",
      ),
    },
    {
      label: "Loan repayments",
      value: selectedClientTransactionTotal(
        selectedClientLedgerTransactions,
        selectedClientMpesaAuditRows,
        "loan_repayment",
      ),
    },
    {
      label: "Shares",
      value: selectedClientTransactionTotal(
        selectedClientLedgerTransactions,
        selectedClientMpesaAuditRows,
        "share_purchase",
      ),
    },
    {
      label: "Fees",
      value: selectedClientTransactionTotal(
        selectedClientLedgerTransactions,
        selectedClientMpesaAuditRows,
        "fee_payment",
      ),
    },
    {
      label: "Purpose pool",
      value: selectedClientTransactionTotal(
        selectedClientLedgerTransactions,
        selectedClientMpesaAuditRows,
        "purpose_pool",
      ),
    },
  ];
  const clientRating = selectedClient
    ? buildClientRating(selectedClient, selectedClientLoans, selectedClientPenalties)
    : null;
  const selectedClientDailyTarget =
    clientLoansSummary
      .filter(({ loan }) => loan.status === "active")
      .reduce((sum, row) => sum + row.summary.dailyCollectionAmount, 0) +
    carryoverLoanSummaries
      .filter(({ loan, summary }) => loan.status !== "closed" && !summary.isFinished)
      .reduce((sum, row) => sum + row.summary.dailyInclusive, 0);
  const openLiveLoans = loans.filter(
    (loan) => loan.status === "active" || loan.status === "defaulted",
  );
  const openLiveLoanSummaries = openLiveLoans.map((loan) => ({
    loan,
    summary: loanSummary(loan),
  }));
  const openCarryoverPortfolio = allCarryoverLoanSummaries.filter(
    ({ loan, summary }) => loan.status !== "closed" && !summary.isFinished,
  );
  const portfolioRemainingCollections =
    openLiveLoanSummaries.reduce((sum, row) => sum + row.summary.balance, 0) +
    openCarryoverPortfolio.reduce((sum, row) => sum + row.summary.totalOwedNow, 0);
  const systemTargetRows = useMemo(
    () =>
      [
        { label: "Today", period: "daily" as const },
        { label: "Next 7 days", period: "weekly" as const },
        { label: "Next 30 days", period: "monthly" as const },
      ].map(({ label, period }) => {
        const window = targetWindow(period, todayIso);
        const expectedValue = scheduledRepaymentsForWindow(
          window.start,
          window.end,
          openLiveLoanSummaries,
          openCarryoverPortfolio,
        );
        const actualValue = calculateTargetActual(
          {
            id: `system-${period}`,
            metric: "loan_repayments",
            period,
            expectedValue,
            startOn: todayIso,
            createdAt: todayIso,
            updatedAt: todayIso,
          },
          { members, loans, transactions },
        );
        const progressPct = expectedValue > 0 ? (actualValue / expectedValue) * 100 : 0;
        return {
          key: period,
          label,
          window,
          expectedValue,
          actualValue,
          gap: actualValue - expectedValue,
          progressPct,
        };
      }),
    [loans, members, openCarryoverPortfolio, openLiveLoanSummaries, todayIso, transactions],
  );
  const collectionsToday = calculateTargetActual(
    {
      id: "system-collections-today",
      metric: "collections_total",
      period: "daily",
      expectedValue: 0,
      startOn: todayIso,
      createdAt: todayIso,
      updatedAt: todayIso,
    },
    { members, loans, transactions },
  );
  const suggestedTargetValue = suggestTargetExpectedValue(
    targetDraft.metric,
    targetDraft.period,
    systemTargetRows,
    openLiveLoanSummaries.length + openCarryoverPortfolio.length,
  );
  const serviceCustomCharges = useMemo(
    () => parseServiceCustomChargesDraft(serviceDraft.customChargesText),
    [serviceDraft.customChargesText],
  );
  const serviceNormalDeductions = useMemo(
    () => parseServiceObjectDraft(serviceDraft.normalDeductionsText),
    [serviceDraft.normalDeductionsText],
  );
  const serviceRenewalRules = useMemo(
    () => parseServiceRenewalRulesDraft(serviceDraft.renewalRulesText),
    [serviceDraft.renewalRulesText],
  );
  const selectedApplicationService = useMemo(
    () => serviceRows.find((service) => service.id === serviceApplicationDraft.serviceId),
    [serviceApplicationDraft.serviceId, serviceRows],
  );
  const selectedApplicationSchedule = useMemo(
    () => countyScheduleRows.find((schedule) => schedule.id === serviceApplicationDraft.scheduleId),
    [countyScheduleRows, serviceApplicationDraft.scheduleId],
  );
  const serviceApplicationChargePreview = useMemo(() => {
    const customCharges = Array.isArray(selectedApplicationService?.customCharges)
      ? selectedApplicationService.customCharges.reduce(
          (sum: number, row: any) => sum + Math.max(0, Number(row?.amount ?? 0)),
          0,
        )
      : 0;
    const countyCharges = selectedApplicationSchedule
      ? Number(selectedApplicationSchedule.totalAmount ?? 0)
      : Number(serviceApplicationDraft.manualCountyCharges ?? 0);
    const serviceFee = Number(
      selectedApplicationService?.serviceCharge ?? selectedApplicationService?.price ?? 0,
    );
    const processingFee = Number(selectedApplicationService?.processingFee ?? 0);
    const registrationFee = Number(selectedApplicationService?.registrationFee ?? 0);
    const penaltyAmount = Math.max(
      Number(selectedApplicationService?.penaltyAmount ?? 0),
      Number(serviceApplicationDraft.penaltyAmount ?? 0),
    );
    const waiverAmount = Math.max(
      Number(selectedApplicationService?.waiverAmount ?? 0),
      Number(serviceApplicationDraft.waiverAmount ?? 0),
    );
    const discountAmount = Number(selectedApplicationService?.negotiatedDiscountAmount ?? 0);
    const expectedAmount =
      countyCharges + serviceFee + processingFee + registrationFee + customCharges;
    const finalAmount = Math.max(0, expectedAmount + penaltyAmount - waiverAmount - discountAmount);
    return {
      countyCharges,
      serviceFee,
      processingFee,
      registrationFee,
      customCharges,
      penaltyAmount,
      waiverAmount,
      discountAmount,
      finalAmount,
      overchargeAmount: Math.max(
        0,
        Number(serviceApplicationDraft.invoiceAmountCharged ?? 0) - finalAmount,
      ),
    };
  }, [
    selectedApplicationSchedule,
    selectedApplicationService,
    serviceApplicationDraft.invoiceAmountCharged,
    serviceApplicationDraft.manualCountyCharges,
    serviceApplicationDraft.penaltyAmount,
    serviceApplicationDraft.waiverAmount,
  ]);

  const enrichedTargets = useMemo(
    () =>
      targetRows.map((row) => {
        const actualValue = calculateTargetActual(row, { members, loans, transactions });
        const progressPct = row.expectedValue > 0 ? (actualValue / row.expectedValue) * 100 : 0;
        const window = targetWindow(row.period, row.startOn);
        return { ...row, actualValue, progressPct, window };
      }),
    [loans, members, targetRows, transactions],
  );

  if (currentUser.role !== "director") return <Navigate to="/" />;

  async function saveFeeDraft() {
    if (!editingFee) return;
    if (!editingFee.label.trim()) return toast.error("Label required.");
    if (editingFee.amount < 0) return toast.error("Amount must be 0 or more.");
    if (!isCoreFeePolicy(editingFee)) {
      return toast.error(
        "Only membership, card, sticker, fuel buffer, monthly, and annual fees are managed here.",
      );
    }
    const nextFee = {
      ...editingFee,
      custom: false,
      scope:
        editingFee.key === "fuel_buffer"
          ? "locomotive_members"
          : editingFee.key === "sticker"
            ? "financial_members"
            : editingFee.key === "monthly_member_subscription" ||
                editingFee.key === "annual_member_subscription"
              ? "loan_holders"
              : editingFee.scope,
    } satisfies FeePolicy;
    if (nextFee.scope === "selected_members" && (nextFee.selectedMemberIds?.length ?? 0) === 0) {
      return toast.error("Pick at least one member for a selected-members fee.");
    }
    setFeeBusy(true);
    try {
      await saveFee({
        data: nextFee,
      });
      await reloadAppData();
      toast.success("Fee updated");
      setEditingFee(null);
      setCreatingFee(false);
    } catch (error: any) {
      toast.error(error?.message ?? "Fee could not be saved.");
    } finally {
      setFeeBusy(false);
    }
  }

  async function saveServiceDraft() {
    if (!serviceDraft.name.trim()) return toast.error("Service name required.");
    if (serviceDraft.scope === "selected_members" && serviceDraft.selectedMemberIds.length === 0) {
      return toast.error("Pick at least one member for a selected-members service.");
    }
    const feeOverrides = parseServiceOverridesDraft(serviceDraft.feeOverridesText);
    const normalDeductions = parseServiceObjectDraft(serviceDraft.normalDeductionsText);
    const renewalRules = parseServiceObjectDraft(serviceDraft.renewalRulesText);
    const customCharges = parseServiceCustomChargesDraft(serviceDraft.customChargesText);
    setServiceBusy(true);
    try {
      await saveService({
        data: {
          id: serviceDraft.id,
          name: serviceDraft.name,
          serviceCategory: serviceDraft.serviceCategory,
          description: serviceDraft.description,
          price: serviceDraft.price,
          billingFrequency: serviceDraft.billingFrequency,
          scope: serviceDraft.scope,
          selectedMemberIds: serviceDraft.selectedMemberIds,
          deductionMode: serviceDraft.deductionMode,
          feeOverrides,
          effectiveDate: serviceDraft.effectiveDate,
          expiryDate: serviceDraft.expiryDate,
          registrationFee: serviceDraft.registrationFee,
          processingFee: serviceDraft.processingFee,
          serviceCharge: serviceDraft.serviceCharge,
          waiverAmount: serviceDraft.waiverAmount,
          penaltyAmount: serviceDraft.penaltyAmount,
          customCharges,
          negotiatedDiscountAmount: serviceDraft.negotiatedDiscountAmount,
          normalDeductions,
          gracePeriodDays: serviceDraft.gracePeriodDays,
          renewalRules,
          active: serviceDraft.active,
        },
      });
      await refreshServices();
      setServiceDraft(blankServiceDraft());
      toast.success("Service saved.");
    } catch (error: any) {
      toast.error(error?.message ?? "Could not save service.");
    } finally {
      setServiceBusy(false);
    }
  }

  async function saveServiceApplicationDraft() {
    if (!serviceApplicationDraft.memberId) return toast.error("Select a member.");
    setServiceApplicationBusy(true);
    try {
      const result = await saveServiceApplication({ data: serviceApplicationDraft });
      await refreshServiceApplications();
      setServiceApplicationDraft(blankServiceApplicationDraft(serviceApplicationDraft.memberId));
      toast.success(`Application ${result.applicationNumber} saved.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Could not save service application.");
    } finally {
      setServiceApplicationBusy(false);
    }
  }

  function loadServiceApplicationDraft(row: any) {
    setServiceApplicationDraft({
      id: row.id,
      applicationNumber: row.applicationNumber,
      memberId: row.memberId ?? "",
      serviceId: row.serviceId ?? "",
      applicationKind: row.applicationKind === "repeat" ? "repeat" : "new",
      serviceType: row.serviceType ?? "",
      caseType: row.caseType ?? "normal",
      priority: row.priority ?? "normal",
      problemReason: row.problemReason ?? "",
      notes: row.notes ?? "",
      county: row.county ?? "Kiambu",
      subcounty: row.subcounty ?? "",
      ward: row.ward ?? "",
      town: row.town ?? "",
      scheduleId: row.scheduleId ?? "",
      invoiceReference: row.invoiceReference ?? "",
      invoiceNumber: row.invoiceNumber ?? "",
      invoiceDate: row.invoiceDate ?? "",
      invoiceAmountCharged: Number(row.invoiceAmountCharged ?? 0),
      issueDate: row.issueDate ?? "",
      expiryDate: row.expiryDate ?? "",
      renewalWindowDays: Number(row.renewalWindowDays ?? 0),
      gracePeriodDays: Number(row.gracePeriodDays ?? 0),
      confiscationReference: row.confiscationReference ?? "",
      inventorySheetNumber: row.inventorySheetNumber ?? "",
      confiscationDate: row.confiscationDate ?? "",
      status: row.status ?? "submitted",
      paymentStatus: row.paymentStatus ?? "pending",
      workflowStage: row.workflowStage ?? "application_submitted",
      manualCountyCharges: Number(row.calculatedCharges?.countyCharges ?? 0),
      waiverAmount: Number(row.calculatedCharges?.waiverAmount ?? 0),
      penaltyAmount: Number(row.calculatedCharges?.penaltyAmount ?? 0),
    });
  }

  async function transitionServiceApplication(row: any, status: string, workflowStage: string) {
    setServiceApplicationBusy(true);
    try {
      await saveServiceApplication({
        data: {
          ...blankServiceApplicationDraft(row.memberId ?? ""),
          id: row.id,
          applicationNumber: row.applicationNumber,
          memberId: row.memberId ?? "",
          serviceId: row.serviceId ?? "",
          applicationKind: row.applicationKind === "repeat" ? "repeat" : "new",
          serviceType: row.serviceType ?? "",
          caseType: row.caseType ?? "normal",
          priority: row.priority ?? "normal",
          problemReason: row.problemReason ?? "",
          notes: row.notes ?? "",
          county: row.county ?? "Kiambu",
          subcounty: row.subcounty ?? "",
          ward: row.ward ?? "",
          town: row.town ?? "",
          scheduleId: row.scheduleId ?? "",
          invoiceReference: row.invoiceReference ?? "",
          invoiceNumber: row.invoiceNumber ?? "",
          invoiceDate: row.invoiceDate ?? "",
          invoiceAmountCharged: Number(row.invoiceAmountCharged ?? 0),
          issueDate: row.issueDate ?? "",
          expiryDate: row.expiryDate ?? "",
          renewalWindowDays: Number(row.renewalWindowDays ?? 0),
          gracePeriodDays: Number(row.gracePeriodDays ?? 0),
          confiscationReference: row.confiscationReference ?? "",
          inventorySheetNumber: row.inventorySheetNumber ?? "",
          confiscationDate: row.confiscationDate ?? "",
          status,
          paymentStatus:
            status === "approved" && row.paymentStatus === "pending"
              ? "pending"
              : (row.paymentStatus ?? "pending"),
          workflowStage,
          manualCountyCharges: Number(row.calculatedCharges?.countyCharges ?? 0),
          waiverAmount: Number(row.calculatedCharges?.waiverAmount ?? 0),
          penaltyAmount: Number(row.calculatedCharges?.penaltyAmount ?? 0),
        },
      });
      await refreshServiceApplications();
      toast.success(
        status === "approved"
          ? "Application approved and wallet prepared."
          : "Application sent to review.",
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to update application.");
    } finally {
      setServiceApplicationBusy(false);
    }
  }

  function updateServiceDeductionOverride(fee: FeePolicy, checked: boolean, amount?: number) {
    setServiceDraft((current) => {
      const overrides = parseServiceOverridesDraft(current.feeOverridesText);
      const deductions = {
        ...((overrides.deductions as Record<string, unknown> | undefined) ?? {}),
      };
      if (!checked) {
        delete deductions[fee.key];
      } else {
        deductions[fee.key] = {
          label: fee.label,
          amount: Math.max(0, Number(amount ?? fee.amount) || 0),
        };
      }
      const nextOverrides = { ...overrides, deductions };
      return { ...current, feeOverridesText: JSON.stringify(nextOverrides, null, 2) };
    });
  }

  function updateServiceCustomCharges(
    next:
      | Array<{ label: string; amount: number }>
      | ((
          current: Array<{ label: string; amount: number }>,
        ) => Array<{ label: string; amount: number }>),
  ) {
    setServiceDraft((current) => {
      const currentCharges = parseServiceCustomChargesDraft(current.customChargesText);
      const nextCharges = typeof next === "function" ? next(currentCharges) : next;
      return {
        ...current,
        customChargesText: JSON.stringify(
          nextCharges
            .map((charge) => ({
              label: charge.label.trim(),
              amount: Math.max(0, Number(charge.amount) || 0),
            }))
            .filter((charge) => charge.label || charge.amount > 0),
          null,
          2,
        ),
      };
    });
  }

  function updateServiceNormalDeduction(fee: FeePolicy, checked: boolean, amount?: number) {
    setServiceDraft((current) => {
      const deductions = parseServiceObjectDraft(current.normalDeductionsText);
      const nextDeductions = { ...deductions };
      if (!checked) {
        delete nextDeductions[fee.key];
      } else {
        nextDeductions[fee.key] = {
          label: fee.label,
          amount: Math.max(0, Number(amount ?? fee.amount) || 0),
        };
      }
      return { ...current, normalDeductionsText: JSON.stringify(nextDeductions, null, 2) };
    });
  }

  function updateServiceRenewalRules(patch: Record<string, unknown>) {
    setServiceDraft((current) => {
      const nextRules = {
        ...parseServiceRenewalRulesDraft(current.renewalRulesText),
        ...patch,
      };
      return { ...current, renewalRulesText: JSON.stringify(nextRules, null, 2) };
    });
  }

  async function persistPolicySettings(
    key: "percentages" | "interest_rates" | "waterfall_rules" | "transaction_fee_bands",
    value: unknown,
    message: string,
  ) {
    await savePolicySetting({ data: { key, value } });
    await reloadAppData();
    toast.success(message);
  }

  async function runManualRedistribution() {
    setIsRedistributing(true);
    try {
      const result = await triggerRedistribution();
      await reloadAppData();
      const redistribution = result.redistribution ?? {};
      toast.success(
        `Redistribution complete: ${redistribution.redistributedMembers ?? 0} member(s), ${
          redistribution.createdTransactions ?? 0
        } ledger movement(s).`,
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Redistribution failed.");
    } finally {
      setIsRedistributing(false);
    }
  }

  async function refreshCarryoverDetails(nextMemberId: string) {
    const result = (await loadCarryover({ data: { memberId: nextMemberId } })) as {
      profile: LegacyCarryoverProfile | null;
      loans: LegacyCarryoverLoan[];
    };
    setHasCarryoverProfile(Boolean(result.profile));
    setCarryoverProfile(
      hydrateCarryoverProfile(result.profile ?? blankCarryoverProfile(nextMemberId)),
    );
    setCarryoverLoans(result.loans);
    setCarryoverLoanDraft(blankCarryoverLoan(nextMemberId, result.loans.length + 1));
    setCarryoverMemberMode(result.loans.length > 0 ? "loan" : "none");
    setGuidedLoanKind(normalizeGuidedLoanKind(result.loans[0]?.loanKind));
    setGuidedLoanEntries(result.loans);
  }

  async function saveCarryoverProfileDraft() {
    if (!selectedClient || carryoverSaving) return;
    const nextGuidedLoans = derivedGuidedLoanRows.map(({ loan, summary, status }, index) => {
      const normalizedLoan = normalizeCarryoverLoanCompliancePlan(loan);
      return {
        ...normalizedLoan,
        memberId: selectedClient.id,
        label:
          normalizedLoan.label ||
          `${guidedLoanKindLabel(normalizedLoan.loanKind ?? guidedLoanKind)} loan ${index + 1}`,
        dueDate: normalizedLoan.dueDate ?? summary.dueDate,
        closedOn: status === "closed" ? (normalizedLoan.closedOn ?? summary.dueDate) : undefined,
        status,
        finished: status === "closed",
        loanCycleNumber: index + 1,
      };
    });
    const nextClosedLoans = nextGuidedLoans.filter((loan) => loan.status === "closed");
    const nextOpenLoans = nextGuidedLoans.filter((loan) => loan.status !== "closed");

    const incompleteLoan = nextGuidedLoans.find((loan) => loan.principal <= 0);
    if (incompleteLoan) {
      toast.error("Every guided carryover loan needs a net disbursed amount above zero.");
      return;
    }

    const duplicateOpenKind = nextOpenLoans.find((loan, index) =>
      nextOpenLoans.some(
        (otherLoan, otherIndex) =>
          otherIndex !== index &&
          (otherLoan.loanKind ?? "financial") === (loan.loanKind ?? "financial"),
      ),
    );
    if (duplicateOpenKind) {
      toast.error(
        `Only one ${guidedLoanKindLabel(duplicateOpenKind.loanKind ?? "financial").toLowerCase()} carryover loan can remain active/defaulted.`,
      );
      return;
    }

    const savedGuidedLoans = nextGuidedLoans.map((loan, index) => ({
      ...loan,
      loanCycleNumber: index + 1,
    }));

    setCarryoverSaving(true);
    try {
      for (const loan of savedGuidedLoans) {
        await saveCarryoverLoan({ data: loan });
      }

      const keptGuidedLoanIds = new Set(
        savedGuidedLoans
          .map((loan) => loan.id)
          .filter((loanId): loanId is string => Boolean(loanId)),
      );
      const removedGuidedLoanIds = carryoverLoans
        .map((loan) => loan.id)
        .filter((loanId) => loanId && !keptGuidedLoanIds.has(loanId));
      for (const loanId of removedGuidedLoanIds) {
        await deleteCarryoverLoan({ data: { id: loanId } });
      }

      const recordedTotalDeposits = lifetimeNetAvailableForCarryover;

      const nextBreakdown = {
        ...readCarryoverBreakdown(carryoverProfile.collectionBreakdown),
        totalDepositsRecorded: recordedTotalDeposits,
        purposePoolBalance: carryoverBreakdown.purposePoolBalance,
        feeBuckets: carryoverFeeBuckets,
      };

      await saveCarryoverProfile({
        data: {
          ...carryoverProfile,
          memberId: selectedClient.id,
          savingsBalance: effectiveCarryoverSavingsBalance,
          shareUnits: effectiveCarryoverShareUnits,
          feesPaidTotal: carryoverFeeTotal,
          loanRepaymentsTotal: carryoverLoanRepaymentsRecorded,
          totalCollected: recordedTotalDeposits,
          pendingBalance: nextOpenLoans.reduce(
            (sum, loan) => sum + summarizeLegacyCarryoverLoan(loan, policySettings).totalOwedNow,
            0,
          ),
          completedLoanCycles: nextClosedLoans.length,
          membershipFeePaid: automaticCarryoverDeductions.membershipFeePaid,
          cardFeePaid: automaticCarryoverDeductions.cardFeePaid,
          stickerFeePaid: automaticCarryoverDeductions.stickerFeePaid,
          firstUpfrontPaid: automaticCarryoverDeductions.firstUpfrontPaid,
          collectionBreakdown: nextBreakdown,
        },
      });
      setHasCarryoverProfile(true);
      await reloadAppData();
      await refreshCarryoverDetails(selectedClient.id);
      await refreshAllCarryoverLoans();
      toast.success("Carryover balances saved");
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to save carryover balances.");
    } finally {
      setCarryoverSaving(false);
    }
  }

  async function saveCarryoverLoanDraft() {
    if (!selectedClient) return;
    const normalizedDraft = normalizeCarryoverLoanCompliancePlan(carryoverLoanDraft);
    const nextDraft =
      carryoverLoanDraft.loanKind === "fuel"
        ? withCarryoverFuelRows(normalizedDraft, carryoverFuelRows(normalizedDraft))
        : normalizedDraft;
    await saveCarryoverLoan({ data: nextDraft });
    await refreshCarryoverDetails(selectedClient.id);
    await refreshAllCarryoverLoans();
    toast.success(carryoverLoanDraft.id ? "Carryover loan updated" : "Carryover loan saved");
  }

  async function resetSelectedClientCarryover() {
    if (!selectedClient || carryoverResetting) return;
    const confirmed = window.confirm(
      `Reset all carryover balances, loans, locked savings, shares, and carryover fee flags for ${selectedClient.name}?`,
    );
    if (!confirmed) return;

    setCarryoverResetting(true);
    try {
      await resetCarryover({ data: { memberId: selectedClient.id } });
      await reloadAppData();
      setHasCarryoverProfile(false);
      await refreshCarryoverDetails(selectedClient.id);
      await refreshAllCarryoverLoans();
      toast.success("Carryover reset and locked balances cleared.");
    } catch (error: any) {
      toast.error(error?.message ?? "Carryover reset failed.");
    } finally {
      setCarryoverResetting(false);
    }
  }

  function beginEditCarryoverLoan(loan: LegacyCarryoverLoan) {
    setCarryoverLoanDraft(loan);
  }

  function clearCarryoverLoanDraft(memberId: string) {
    setCarryoverLoanDraft(blankCarryoverLoan(memberId, carryoverLoans.length + 1));
  }

  function changeGuidedLoanKind(nextKind: LoanKind) {
    const normalized = normalizeGuidedLoanKind(nextKind);
    setGuidedLoanKind(normalized);
    setGuidedLoanEntries((current) =>
      current.map((loan) => applyGuidedCarryoverLoanKind(loan, normalized)),
    );
  }

  async function applyPenaltyWaiver(penaltyId: string, fullAmount: number) {
    const waiveAmount = waiverAmounts[penaltyId] ?? fullAmount;
    await waivePenalty({
      data: {
        penaltyId,
        amount: waiveAmount,
        note: waiverNote || undefined,
      },
    });
    await reloadAppData();
    if (selectedClient) await refreshCarryoverDetails(selectedClient.id);
    toast.success("Penalty waiver saved");
  }

  function applyCarryoverWaterfallDraft() {
    const available = Math.max(0, carryoverUndistributedBalance);
    if (available <= 0) {
      toast.info("No undistributed carryover balance to apply.");
      return;
    }

    setCarryoverProfile((current) => {
      let remaining = available;
      const breakdown = readCarryoverBreakdown(current.collectionBreakdown);
      const feeBuckets = { ...breakdown.feeBuckets };
      const next = { ...current };
      const consume = (amount: number) => {
        const applied = Math.min(remaining, Math.max(0, amount));
        remaining -= applied;
        return applied;
      };
      const fillFee = (
        flag: "membershipFeePaid" | "cardFeePaid" | "stickerFeePaid",
        bucket: keyof CarryoverFeeBuckets,
        amount: number,
      ) => {
        if (next[flag] || amount <= 0 || remaining <= 0) return;
        const gap = Math.max(0, amount - feeBuckets[bucket]);
        feeBuckets[bucket] += consume(gap);
        if (feeBuckets[bucket] >= amount) next[flag] = true;
      };

      fillFee("membershipFeePaid", "membership", membershipAmount);
      fillFee("cardFeePaid", "card", cardAmount);
      fillFee("stickerFeePaid", "sticker", stickerAmount);

      if (next.penaltiesOutstanding > 0 && remaining > 0) {
        next.penaltiesOutstanding = Math.max(
          0,
          next.penaltiesOutstanding - consume(next.penaltiesOutstanding),
        );
      }

      const savingsGap = Math.max(
        0,
        policySettings.percentages.mandatorySavingsThreshold - next.savingsBalance,
      );
      if (savingsGap > 0 && remaining > 0) next.savingsBalance += consume(savingsGap);

      const shareValue = next.shareUnits * sharePrice;
      const shareGap = Math.max(
        0,
        policySettings.percentages.mandatorySharesThreshold - shareValue,
      );
      if (shareGap > 0 && remaining > 0 && sharePrice > 0) {
        const units = Math.floor(Math.min(remaining, shareGap) / sharePrice);
        if (units > 0) {
          next.shareUnits += units;
          remaining -= units * sharePrice;
        }
      }

      const purposePoolBalance = breakdown.purposePoolBalance + remaining;
      remaining = 0;
      return {
        ...next,
        collectionBreakdown: {
          ...breakdown,
          purposePoolBalance,
          feeBuckets,
        },
      };
    });
    toast.success("Remaining carryover balance applied through the waterfall.");
  }

  return (
    <>
      <AppHeader
        title="Policy Center"
        subtitle="Director controls for fees, interest, percentages, waterfall logic, client financial records, and progressive targets."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="admin" />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <div className="text-sm font-medium">Purpose pool redistribution</div>
            <div className="text-xs text-muted-foreground">
              Re-apply current fee, waterfall, savings, shares, and penalty policies to existing
              purpose-pool balances.
            </div>
          </div>
          <button
            type="button"
            onClick={runManualRedistribution}
            disabled={isRedistributing}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRedistributing ? "animate-spin" : ""}`} />
            {isRedistributing ? "Redistributing..." : "Redistribute now"}
          </button>
          <div className="basis-full">
            <OperationProgress
              active={isRedistributing}
              label="Redistributing purpose-pool balances through current policy waterfall"
              estimateSeconds={90}
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <StatCard
            label="Active Fees"
            value={activeFees.length}
            icon={<Wallet className="h-5 w-5" />}
          />
          <StatCard
            label="Penalty Rates"
            value={`${policySettings.percentages.penaltyDailyPct}% / ${policySettings.percentages.defaultPenaltyPct}%`}
            icon={<Percent className="h-5 w-5" />}
            tone="warning"
          />
          <StatCard
            label="Upfront Bands"
            value={`${SBC_UPFRONT_TABLE.length} tiers`}
            icon={<Save className="h-5 w-5" />}
          />
          <StatCard
            label="Tracked Targets"
            value={enrichedTargets.length + systemTargetRows.length}
            icon={<Target className="h-5 w-5" />}
            tone="accent"
          />
        </div>

        <div className="md:hidden">
          <select
            value={tab}
            onChange={(event) => setTab(event.target.value as PolicyCenterTab)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            {SUBPAGES.map((subpage) => (
              <option key={subpage.key} value={subpage.key}>
                {subpage.label}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden flex-wrap items-center gap-1 border-b border-border md:flex">
          {SUBPAGES.map((subpage) => (
            <button
              key={subpage.key}
              onClick={() => setTab(subpage.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
                tab === subpage.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {subpage.label}
            </button>
          ))}
        </div>

        {tab === "fees" && (
          <>
            <Section title="Mandatory fee heads">
              <div className="grid gap-4 p-5 md:grid-cols-6">
                <StatCard label="Membership" value={fmtKES(membershipAmount)} />
                <StatCard label="Card" value={fmtKES(cardAmount)} />
                <StatCard label="Sticker (financial)" value={fmtKES(stickerAmount)} />
                <StatCard label="Fuel buffer (locomotive)" value={fmtKES(fuelBufferFeeAmount)} />
                <StatCard
                  label="Monthly (loan holders)"
                  value={fmtKES(monthlySubscriptionAmount)}
                />
                <StatCard label="Annual (loan holders)" value={fmtKES(annualSubscriptionAmount)} />
              </div>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2.5 text-left">Fee</th>
                      <th className="text-right">Amount</th>
                      <th className="pl-5 text-left">Permanence</th>
                      <th className="text-left">Applies to</th>
                      <th className="text-left">Status</th>
                      <th className="pr-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {feeRows.filter(isCoreFeePolicy).map((fee) => (
                      <tr key={fee.key}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{fee.label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {fee.key}
                            {fee.custom ? " - custom" : ""}
                          </div>
                        </td>
                        <td className="text-right font-semibold">{fmtKES(fee.amount)}</td>
                        <td className="pl-5">
                          {fee.permanence === "permanent" ? (
                            <Badge tone="success">Permanent</Badge>
                          ) : (
                            <Badge tone="warning">
                              Semi - {fee.durationDays}d from {fee.effectiveFrom}
                            </Badge>
                          )}
                        </td>
                        <td>{describeFeeScope(fee, members)}</td>
                        <td>
                          {isFeeActive(fee) ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge tone="muted">Expired</Badge>
                          )}
                        </td>
                        <td className="pr-5 text-right whitespace-nowrap">
                          <button
                            onClick={() => {
                              setEditingFee(fee);
                              setCreatingFee(false);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            {editingFee && (
              <Section
                title={creatingFee ? "New fee" : `Edit - ${editingFee.label || editingFee.key}`}
              >
                <div className="grid max-w-3xl gap-4 p-5 sm:grid-cols-2">
                  <Field label="Label">
                    <input
                      value={editingFee.label}
                      onChange={(event) =>
                        setEditingFee({ ...editingFee, label: event.target.value })
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Amount (KES)">
                    <input
                      type="number"
                      value={editingFee.amount}
                      onChange={(event) =>
                        setEditingFee({ ...editingFee, amount: Number(event.target.value) })
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Permanence">
                    <select
                      value={editingFee.permanence}
                      onChange={(event) =>
                        setEditingFee({
                          ...editingFee,
                          permanence: event.target.value as FeePermanence,
                        })
                      }
                      className="input"
                    >
                      <option value="permanent">Permanent</option>
                      <option value="semi">Semi-permanent</option>
                    </select>
                  </Field>
                  {editingFee.permanence === "semi" && (
                    <Field label="Duration">
                      <select
                        value={editingFee.durationDays ?? 30}
                        onChange={(event) =>
                          setEditingFee({
                            ...editingFee,
                            durationDays: Number(event.target.value),
                          })
                        }
                        className="input"
                      >
                        <option value={7}>1 week</option>
                        <option value={14}>2 weeks</option>
                        <option value={30}>1 month</option>
                        <option value={60}>2 months</option>
                        <option value={90}>3 months</option>
                        <option value={180}>6 months</option>
                        <option value={365}>1 year</option>
                      </select>
                    </Field>
                  )}
                  <Field label="Effective from">
                    <input
                      type="date"
                      value={editingFee.effectiveFrom}
                      onChange={(event) =>
                        setEditingFee({ ...editingFee, effectiveFrom: event.target.value })
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Applies to">
                    <select
                      value={editingFee.scope}
                      onChange={(event) =>
                        setEditingFee({
                          ...editingFee,
                          scope: event.target.value as FeeScope,
                          selectedMemberIds:
                            event.target.value === "selected_members"
                              ? (editingFee.selectedMemberIds ?? [])
                              : [],
                        })
                      }
                      className="input"
                      disabled={
                        editingFee.key === "fuel_buffer" ||
                        editingFee.key === "sticker" ||
                        editingFee.key === "monthly_member_subscription" ||
                        editingFee.key === "annual_member_subscription"
                      }
                    >
                      {SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {scopeLabel(scope)}
                        </option>
                      ))}
                    </select>
                    {editingFee.key === "fuel_buffer" ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Fuel buffer is fixed to locomotive members.
                      </div>
                    ) : null}
                    {editingFee.key === "sticker" ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Sticker fee is fixed to financial members.
                      </div>
                    ) : null}
                    {editingFee.key === "monthly_member_subscription" ||
                    editingFee.key === "annual_member_subscription" ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        This fee is fixed to members with active loan accounts.
                      </div>
                    ) : null}
                  </Field>
                  {editingFee.scope === "new_only" && (
                    <div className="sm:col-span-2 rounded-xl border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                      New-member fees automatically apply to members whose join date is on or after{" "}
                      <span className="font-medium text-foreground">
                        {editingFee.effectiveFrom}
                      </span>
                      .
                    </div>
                  )}
                  {editingFee.scope === "selected_members" && (
                    <Field label="Selected members" className="sm:col-span-2">
                      <div className="rounded-xl border border-border bg-muted/20 p-3">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-muted-foreground">
                            Tick the members who should carry this fee requirement.
                            <div className="mt-1">
                              {editingFee.selectedMemberIds?.length ?? 0} selected |{" "}
                              {filteredFeeSelectableMembers.length} shown
                            </div>
                          </div>
                          <div className="inline-flex flex-wrap gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() =>
                                setEditingFee({
                                  ...editingFee,
                                  selectedMemberIds: feeSelectableMembers.map(
                                    (member) => member.id,
                                  ),
                                })
                              }
                              className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingFee({
                                  ...editingFee,
                                  selectedMemberIds: newFeeSelectableMembers.map(
                                    (member) => member.id,
                                  ),
                                })
                              }
                              className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                            >
                              Select new
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingFee({
                                  ...editingFee,
                                  selectedMemberIds: [],
                                })
                              }
                              className="rounded-md border border-border px-2 py-1 hover:bg-muted"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <input
                          value={feeMemberQuery}
                          onChange={(event) => setFeeMemberQuery(event.target.value)}
                          placeholder="Search by name, member number, or phone"
                          className="input mb-3"
                        />
                        <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                          {filteredFeeSelectableMembers.map((member) => {
                            const checked = (editingFee.selectedMemberIds ?? []).includes(
                              member.id,
                            );
                            const isNewMember =
                              String(member.joinedAt ?? "").slice(0, 10) >=
                              String(editingFee.effectiveFrom ?? "").slice(0, 10);
                            return (
                              <label
                                key={member.id}
                                className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) =>
                                    setEditingFee({
                                      ...editingFee,
                                      selectedMemberIds: event.target.checked
                                        ? [
                                            ...new Set([
                                              ...(editingFee.selectedMemberIds ?? []),
                                              member.id,
                                            ]),
                                          ]
                                        : (editingFee.selectedMemberIds ?? []).filter(
                                            (candidate) => candidate !== member.id,
                                          ),
                                    })
                                  }
                                />
                                <span>
                                  <span className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                                    <span>{member.name}</span>
                                    {isNewMember ? (
                                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                                        New
                                      </span>
                                    ) : null}
                                    {activeLoanMemberIds.has(member.id) ? (
                                      <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground">
                                        Loan
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {member.id} | {member.phone} | joined {member.joinedAt}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                        {filteredFeeSelectableMembers.length === 0 && (
                          <div className="mt-3 text-xs text-muted-foreground">
                            No members match that search yet.
                          </div>
                        )}
                        <div className="mt-3 text-[11px] text-muted-foreground">
                          The separate New members only audience will automatically target anyone
                          whose join date is on or after the effective date above.
                        </div>
                      </div>
                    </Field>
                  )}
                  <Field label="Notes" className="sm:col-span-2">
                    <textarea
                      rows={2}
                      value={editingFee.notes ?? ""}
                      onChange={(event) =>
                        setEditingFee({ ...editingFee, notes: event.target.value })
                      }
                      className="input"
                    />
                  </Field>
                  <div className="sm:col-span-2 flex gap-2">
                    <button
                      type="button"
                      disabled={feeBusy}
                      onClick={() => void saveFeeDraft()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      {feeBusy ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingFee(null);
                        setCreatingFee(false);
                      }}
                      className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </Section>
            )}
          </>
        )}

        {tab === "services" && (
          <div className="space-y-6">
            <Section
              title="Service catalog"
              action={
                <button
                  onClick={() => setServiceDraft(blankServiceDraft())}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New service
                </button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left">Service</th>
                      <th className="px-5 py-3 text-right">Price</th>
                      <th className="px-5 py-3 text-left">Frequency</th>
                      <th className="px-5 py-3 text-left">Subjected to</th>
                      <th className="px-5 py-3 text-left">Deduction mode</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {serviceRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                          No services have been created yet.
                        </td>
                      </tr>
                    ) : null}
                    {serviceRows.map((service) => {
                      const selectedMemberIds =
                        service.selectedMemberIds ?? service.selected_member_ids ?? [];
                      const feeOverrides = service.feeOverrides ?? service.fee_overrides ?? {};
                      const active = service.active ?? service.is_active ?? true;
                      return (
                        <tr key={service.id}>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{service.name}</span>
                              <Badge tone={active ? "success" : "muted"}>
                                {active ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {service.description || "No description"}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right font-semibold">
                            {fmtKES(Number(service.price ?? 0))}
                          </td>
                          <td className="px-5 py-3 capitalize">
                            {String(
                              service.billingFrequency ?? service.billing_frequency ?? "monthly",
                            ).replace(/_/g, " ")}
                          </td>
                          <td className="px-5 py-3 capitalize">
                            {String(service.scope ?? "all_members").replace(/_/g, " ")}
                            {selectedMemberIds.length ? ` (${selectedMemberIds.length})` : ""}
                          </td>
                          <td className="px-5 py-3 capitalize">
                            {String(
                              service.deductionMode ?? service.deduction_mode ?? "normal",
                            ).replace(/_/g, " ")}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() =>
                                setServiceDraft({
                                  id: service.id,
                                  name: service.name ?? "",
                                  serviceCategory:
                                    service.serviceCategory ?? service.service_category ?? "",
                                  description: service.description ?? "",
                                  price: Number(service.price ?? 0),
                                  billingFrequency:
                                    service.billingFrequency ??
                                    service.billing_frequency ??
                                    "monthly",
                                  scope: service.scope ?? "all_members",
                                  selectedMemberIds,
                                  deductionMode:
                                    service.deductionMode ?? service.deduction_mode ?? "normal",
                                  feeOverridesText: JSON.stringify(feeOverrides, null, 2),
                                  effectiveDate:
                                    service.effectiveDate ??
                                    service.effective_date ??
                                    new Date().toISOString().slice(0, 10),
                                  expiryDate: service.expiryDate ?? service.expiry_date ?? "",
                                  registrationFee: Number(
                                    service.registrationFee ?? service.registration_fee ?? 0,
                                  ),
                                  processingFee: Number(
                                    service.processingFee ?? service.processing_fee ?? 0,
                                  ),
                                  serviceCharge: Number(
                                    service.serviceCharge ??
                                      service.service_charge ??
                                      service.price ??
                                      0,
                                  ),
                                  waiverAmount: Number(
                                    service.waiverAmount ?? service.waiver_amount ?? 0,
                                  ),
                                  penaltyAmount: Number(
                                    service.penaltyAmount ?? service.penalty_amount ?? 0,
                                  ),
                                  customChargesText: JSON.stringify(
                                    service.customCharges ?? service.custom_charges ?? [],
                                    null,
                                    2,
                                  ),
                                  negotiatedDiscountAmount: Number(
                                    service.negotiatedDiscountAmount ??
                                      service.negotiated_discount_amount ??
                                      0,
                                  ),
                                  normalDeductionsText: JSON.stringify(
                                    service.normalDeductions ?? service.normal_deductions ?? {},
                                    null,
                                    2,
                                  ),
                                  gracePeriodDays: Number(
                                    service.gracePeriodDays ?? service.grace_period_days ?? 0,
                                  ),
                                  renewalRulesText: JSON.stringify(
                                    service.renewalRules ?? service.renewal_rules ?? {},
                                    null,
                                    2,
                                  ),
                                  active,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                await deleteService({ data: { id: service.id } });
                                await refreshServices();
                                toast.success("Service deactivated");
                              }}
                              className="ml-2 inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title={serviceDraft.id ? "Edit service" : "Create service"}>
              <div className="grid max-w-5xl gap-4 p-5 sm:grid-cols-2">
                <Field label="Service name">
                  <input
                    value={serviceDraft.name}
                    onChange={(event) =>
                      setServiceDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    className="input"
                  />
                </Field>
                <Field label="Service category">
                  <input
                    value={serviceDraft.serviceCategory}
                    onChange={(event) =>
                      setServiceDraft((current) => ({
                        ...current,
                        serviceCategory: event.target.value,
                      }))
                    }
                    placeholder="Permit, transport, compliance..."
                    className="input"
                  />
                </Field>
                <NumberField
                  label="Display price (KES)"
                  value={serviceDraft.price}
                  onChange={(value) =>
                    setServiceDraft((current) => ({ ...current, price: Math.max(0, value) }))
                  }
                />
                <NumberField
                  label="Registration fee"
                  value={serviceDraft.registrationFee}
                  onChange={(value) =>
                    setServiceDraft((current) => ({
                      ...current,
                      registrationFee: Math.max(0, value),
                    }))
                  }
                />
                <NumberField
                  label="Processing fee"
                  value={serviceDraft.processingFee}
                  onChange={(value) =>
                    setServiceDraft((current) => ({
                      ...current,
                      processingFee: Math.max(0, value),
                    }))
                  }
                />
                <NumberField
                  label="Service charge"
                  value={serviceDraft.serviceCharge}
                  onChange={(value) =>
                    setServiceDraft((current) => ({
                      ...current,
                      serviceCharge: Math.max(0, value),
                      price: Math.max(current.price, value),
                    }))
                  }
                />
                <NumberField
                  label="Penalty amount"
                  value={serviceDraft.penaltyAmount}
                  onChange={(value) =>
                    setServiceDraft((current) => ({
                      ...current,
                      penaltyAmount: Math.max(0, value),
                    }))
                  }
                />
                <NumberField
                  label="Waiver amount"
                  value={serviceDraft.waiverAmount}
                  onChange={(value) =>
                    setServiceDraft((current) => ({ ...current, waiverAmount: Math.max(0, value) }))
                  }
                />
                <NumberField
                  label="Negotiated discount"
                  value={serviceDraft.negotiatedDiscountAmount}
                  onChange={(value) =>
                    setServiceDraft((current) => ({
                      ...current,
                      negotiatedDiscountAmount: Math.max(0, value),
                    }))
                  }
                />
                <Field label="Billing frequency">
                  <select
                    value={serviceDraft.billingFrequency}
                    onChange={(event) =>
                      setServiceDraft((current) => ({
                        ...current,
                        billingFrequency: event.target.value as ServiceDraft["billingFrequency"],
                      }))
                    }
                    className="input"
                  >
                    <option value="one_time">One time</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="semi_annual">Semi-annual</option>
                    <option value="annual">Annual</option>
                    <option value="yearly">Yearly</option>
                    <option value="seasonal">Seasonal</option>
                    <option value="custom">Custom period</option>
                  </select>
                </Field>
                <Field label="Effective date">
                  <input
                    type="date"
                    value={serviceDraft.effectiveDate}
                    onChange={(event) =>
                      setServiceDraft((current) => ({
                        ...current,
                        effectiveDate: event.target.value,
                      }))
                    }
                    className="input"
                  />
                </Field>
                <Field label="Expiry date">
                  <input
                    type="date"
                    value={serviceDraft.expiryDate}
                    onChange={(event) =>
                      setServiceDraft((current) => ({ ...current, expiryDate: event.target.value }))
                    }
                    className="input"
                  />
                </Field>
                <NumberField
                  label="Grace period days"
                  value={serviceDraft.gracePeriodDays}
                  onChange={(value) =>
                    setServiceDraft((current) => ({
                      ...current,
                      gracePeriodDays: Math.max(0, Math.floor(value)),
                    }))
                  }
                />
                <Field label="Subjected to">
                  <select
                    value={serviceDraft.scope}
                    onChange={(event) =>
                      setServiceDraft((current) => ({
                        ...current,
                        scope: event.target.value as ServiceDraft["scope"],
                        selectedMemberIds:
                          event.target.value === "selected_members"
                            ? current.selectedMemberIds
                            : [],
                      }))
                    }
                    className="input"
                  >
                    <option value="all_members">All members</option>
                    <option value="sbc_members">SBC members only</option>
                    <option value="service_members">Service members only</option>
                    <option value="selected_members">Specific members</option>
                  </select>
                </Field>
                <Field label="Deduction behavior">
                  <select
                    value={serviceDraft.deductionMode}
                    onChange={(event) =>
                      setServiceDraft((current) => ({
                        ...current,
                        deductionMode: event.target.value as ServiceDraft["deductionMode"],
                      }))
                    }
                    className="input"
                  >
                    <option value="normal">Apply with all deductions</option>
                    <option value="override_all">Override all deductions</option>
                    <option value="amended_override">Amended override</option>
                  </select>
                </Field>
                <Field label="Status">
                  <label className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={serviceDraft.active}
                      onChange={(event) =>
                        setServiceDraft((current) => ({
                          ...current,
                          active: event.target.checked,
                        }))
                      }
                    />
                    Active and visible during registration
                  </label>
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <textarea
                    rows={2}
                    value={serviceDraft.description}
                    onChange={(event) =>
                      setServiceDraft((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className="input"
                  />
                </Field>
                <Field label="Additional charges" className="sm:col-span-2">
                  <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                    {serviceCustomCharges.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No extra charges added for this service.
                      </div>
                    ) : null}
                    {serviceCustomCharges.map((charge, index) => (
                      <div key={index} className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                        <input
                          value={charge.label}
                          onChange={(event) =>
                            updateServiceCustomCharges((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, label: event.target.value } : item,
                              ),
                            )
                          }
                          placeholder="Charge name"
                          className="input"
                        />
                        <input
                          type="number"
                          min={0}
                          value={charge.amount}
                          onChange={(event) =>
                            updateServiceCustomCharges((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, amount: Number(event.target.value) }
                                  : item,
                              ),
                            )
                          }
                          className="input"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateServiceCustomCharges((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                          className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateServiceCustomCharges((current) => [
                          ...current,
                          { label: "", amount: 0 },
                        ])
                      }
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add charge
                    </button>
                  </div>
                </Field>
                <Field label="Normal deductions" className="sm:col-span-2">
                  <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-2">
                    {activeFees.filter(isCoreFeePolicy).map((fee) => {
                      const deduction = serviceNormalDeductions[fee.key] as
                        | { amount?: number }
                        | undefined;
                      const checked = deduction != null;
                      const amount = Number(deduction?.amount ?? fee.amount);
                      return (
                        <label
                          key={fee.key}
                          className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                updateServiceNormalDeduction(fee, event.target.checked, amount)
                              }
                            />
                            <span className="font-medium">{fee.label}</span>
                          </span>
                          <input
                            type="number"
                            min={0}
                            value={amount}
                            disabled={!checked}
                            onChange={(event) =>
                              updateServiceNormalDeduction(fee, true, Number(event.target.value))
                            }
                            className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs disabled:opacity-50"
                          />
                        </label>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Renewal rules" className="sm:col-span-2">
                  <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-3">
                    <label className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={serviceRenewalRules.autoRenew}
                        onChange={(event) =>
                          updateServiceRenewalRules({ autoRenew: event.target.checked })
                        }
                      />
                      Auto-renew
                    </label>
                    <label className="block text-sm">
                      <span className="text-xs text-muted-foreground">Reminder days</span>
                      <input
                        type="number"
                        min={0}
                        value={serviceRenewalRules.reminderDays}
                        onChange={(event) =>
                          updateServiceRenewalRules({
                            reminderDays: Math.max(0, Math.floor(Number(event.target.value) || 0)),
                          })
                        }
                        className="input mt-1"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-xs text-muted-foreground">Renewal window</span>
                      <input
                        type="number"
                        min={0}
                        value={serviceRenewalRules.renewalWindowDays}
                        onChange={(event) =>
                          updateServiceRenewalRules({
                            renewalWindowDays: Math.max(
                              0,
                              Math.floor(Number(event.target.value) || 0),
                            ),
                          })
                        }
                        className="input mt-1"
                      />
                    </label>
                  </div>
                </Field>
                {serviceDraft.scope === "selected_members" ? (
                  <Field label="Specific members" className="sm:col-span-2">
                    <div className="rounded-xl border border-border bg-muted/20 p-3">
                      <input
                        value={serviceMemberQuery}
                        onChange={(event) => setServiceMemberQuery(event.target.value)}
                        placeholder="Search by name, member number, or phone"
                        className="input mb-3"
                      />
                      <div className="grid max-h-72 gap-2 overflow-y-auto md:grid-cols-2">
                        {filteredServiceMembers.map((member) => {
                          const checked = serviceDraft.selectedMemberIds.includes(member.id);
                          return (
                            <label
                              key={member.id}
                              className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setServiceDraft((current) => ({
                                    ...current,
                                    selectedMemberIds: event.target.checked
                                      ? Array.from(
                                          new Set([...current.selectedMemberIds, member.id]),
                                        )
                                      : current.selectedMemberIds.filter((id) => id !== member.id),
                                  }))
                                }
                              />
                              <span>
                                <span className="font-medium">{member.name}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {member.id} | {member.phone}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {filteredServiceMembers.length === 0 ? (
                        <div className="mt-3 text-xs text-muted-foreground">
                          No members match that search.
                        </div>
                      ) : null}
                    </div>
                  </Field>
                ) : null}
                {serviceDraft.deductionMode !== "normal" ? (
                  <Field label="Override deductions" className="sm:col-span-2">
                    <div className="rounded-md border border-border bg-muted/20 p-3">
                      <div className="mb-3 text-xs text-muted-foreground">
                        Tick the normal non-loan deductions this service should include, then set
                        the amount to increase or reduce what the service removes.
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {nonLoanServiceDeductionFees.map((fee) => {
                          const overrides = parseServiceOverridesDraft(
                            serviceDraft.feeOverridesText,
                          );
                          const deductions =
                            (overrides.deductions as Record<string, any> | undefined) ?? {};
                          const checked = deductions[fee.key] != null;
                          const amount = Number(deductions[fee.key]?.amount ?? fee.amount);
                          return (
                            <label
                              key={fee.key}
                              className="grid gap-2 rounded-md border border-border bg-card p-3 text-sm"
                            >
                              <span className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) =>
                                    updateServiceDeductionOverride(
                                      fee,
                                      event.target.checked,
                                      amount,
                                    )
                                  }
                                />
                                <span className="font-medium">{fee.label}</span>
                              </span>
                              <input
                                type="number"
                                min={0}
                                value={amount}
                                disabled={!checked}
                                onChange={(event) =>
                                  updateServiceDeductionOverride(
                                    fee,
                                    true,
                                    Number(event.target.value),
                                  )
                                }
                                className="rounded-md border border-border bg-muted px-3 py-1.5 text-xs disabled:opacity-50"
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </Field>
                ) : null}
                <div className="sm:col-span-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={serviceBusy}
                    onClick={() => void saveServiceDraft()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {serviceBusy ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setServiceDraft(blankServiceDraft())}
                    className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </Section>

            <Section
              title="New / repeat service application"
              action={
                <button
                  type="button"
                  disabled={serviceApplicationBusy}
                  onClick={() => void saveServiceApplicationDraft()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  {serviceApplicationBusy ? "Saving..." : "Save application"}
                </button>
              }
            >
              <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Member">
                    <MemberSearchSelect
                      members={memberAccounts}
                      value={serviceApplicationDraft.memberId}
                      onChange={(memberId) =>
                        setServiceApplicationDraft((current) => ({ ...current, memberId }))
                      }
                    />
                  </Field>
                  <Field label="Application flow">
                    <select
                      value={serviceApplicationDraft.applicationKind}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          applicationKind: event.target.value as "new" | "repeat",
                        }))
                      }
                      className="input"
                    >
                      <option value="new">New application</option>
                      <option value="repeat">Repeat application</option>
                    </select>
                  </Field>
                  <Field label="Requested service">
                    <select
                      value={serviceApplicationDraft.serviceId}
                      onChange={(event) => {
                        const service = serviceRows.find((item) => item.id === event.target.value);
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          serviceId: event.target.value,
                          serviceType:
                            service?.serviceCategory ??
                            service?.service_category ??
                            current.serviceType,
                        }));
                      }}
                      className="input"
                    >
                      <option value="">Select service</option>
                      {serviceRows
                        .filter(
                          (service) => (service.active ?? service.is_active ?? true) !== false,
                        )
                        .map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Service type">
                    <input
                      value={serviceApplicationDraft.serviceType}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          serviceType: event.target.value,
                        }))
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Case type">
                    <select
                      value={serviceApplicationDraft.caseType}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          caseType: event.target.value as ServiceApplicationDraft["caseType"],
                        }))
                      }
                      className="input"
                    >
                      <option value="normal">Normal / regular</option>
                      <option value="overcharged_invoice">Overcharged invoice</option>
                      <option value="invoice_with_penalty">Invoice with penalty</option>
                      <option value="confiscated_items">Confiscated items</option>
                    </select>
                  </Field>
                  <Field label="Revenue schedule">
                    <select
                      value={serviceApplicationDraft.scheduleId}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          scheduleId: event.target.value,
                        }))
                      }
                      className="input"
                    >
                      <option value="">Manual county charge</option>
                      {countyScheduleRows.map((schedule) => (
                        <option key={schedule.id} value={schedule.id}>
                          {schedule.code} - {schedule.description}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <NumberField
                    label="Manual county charges"
                    value={serviceApplicationDraft.manualCountyCharges}
                    onChange={(value) =>
                      setServiceApplicationDraft((current) => ({
                        ...current,
                        manualCountyCharges: Math.max(0, value),
                      }))
                    }
                  />
                  <NumberField
                    label="Invoice amount charged"
                    value={serviceApplicationDraft.invoiceAmountCharged}
                    onChange={(value) =>
                      setServiceApplicationDraft((current) => ({
                        ...current,
                        invoiceAmountCharged: Math.max(0, value),
                      }))
                    }
                  />
                  <Field label="Invoice number">
                    <input
                      value={serviceApplicationDraft.invoiceNumber}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          invoiceNumber: event.target.value,
                        }))
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Invoice date">
                    <input
                      type="date"
                      value={serviceApplicationDraft.invoiceDate}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          invoiceDate: event.target.value,
                        }))
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Workflow stage">
                    <select
                      value={serviceApplicationDraft.workflowStage}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          workflowStage: event.target.value,
                        }))
                      }
                      className="input"
                    >
                      <option value="application_submitted">Application submitted</option>
                      <option value="verification">Verification</option>
                      <option value="financial_review">Financial review</option>
                      <option value="waiver_approval">Waiver approval</option>
                      <option value="final_approval">Final approval</option>
                      <option value="billing">Billing</option>
                      <option value="service_processing">Service processing</option>
                      <option value="completed">Completed</option>
                    </select>
                  </Field>
                  <Field label="Status">
                    <select
                      value={serviceApplicationDraft.status}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          status: event.target.value,
                        }))
                      }
                      className="input"
                    >
                      <option value="submitted">Submitted</option>
                      <option value="under_review">Under review</option>
                      <option value="approved">Approved</option>
                      <option value="billing">Billing</option>
                      <option value="processing">Processing</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </Field>
                  <Field label="Problem / reason" className="md:col-span-2">
                    <textarea
                      rows={2}
                      value={serviceApplicationDraft.problemReason}
                      onChange={(event) =>
                        setServiceApplicationDraft((current) => ({
                          ...current,
                          problemReason: event.target.value,
                        }))
                      }
                      className="input"
                    />
                  </Field>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-4">
                  <div className="text-sm font-medium">Payable preview</div>
                  <div className="mt-4 space-y-2 text-sm">
                    <MetricRow
                      label="County charges"
                      value={fmtKES(serviceApplicationChargePreview.countyCharges)}
                    />
                    <MetricRow
                      label="Service fee"
                      value={fmtKES(serviceApplicationChargePreview.serviceFee)}
                    />
                    <MetricRow
                      label="Processing"
                      value={fmtKES(serviceApplicationChargePreview.processingFee)}
                    />
                    <MetricRow
                      label="Registration"
                      value={fmtKES(serviceApplicationChargePreview.registrationFee)}
                    />
                    <MetricRow
                      label="Other charges"
                      value={fmtKES(serviceApplicationChargePreview.customCharges)}
                    />
                    <MetricRow
                      label="Penalties"
                      value={fmtKES(serviceApplicationChargePreview.penaltyAmount)}
                    />
                    <MetricRow
                      label="Waivers / discounts"
                      value={fmtKES(
                        serviceApplicationChargePreview.waiverAmount +
                          serviceApplicationChargePreview.discountAmount,
                      )}
                    />
                    <div className="border-t border-border pt-3">
                      <MetricRow
                        label="Final bill"
                        value={fmtKES(serviceApplicationChargePreview.finalAmount)}
                      />
                      <MetricRow
                        label="Overcharge detected"
                        value={fmtKES(serviceApplicationChargePreview.overchargeAmount)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Application review and approval queue">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left">Application</th>
                      <th className="px-5 py-3 text-left">Member</th>
                      <th className="px-5 py-3 text-left">Service</th>
                      <th className="px-5 py-3 text-right">Final bill</th>
                      <th className="px-5 py-3 text-left">Stage</th>
                      <th className="px-5 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {serviceApplicationRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                          No service applications yet.
                        </td>
                      </tr>
                    ) : null}
                    {serviceApplicationRows.map((row) => {
                      const member = members.find((item) => item.id === row.memberId);
                      const service = serviceRows.find((item) => item.id === row.serviceId);
                      const finalAmount = Number(row.calculatedCharges?.finalAmount ?? 0);
                      const approved =
                        row.status === "approved" || row.workflowStage === "final_approval";
                      return (
                        <tr key={row.id}>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{row.applicationNumber}</span>
                              <Badge tone={approved ? "success" : "muted"}>
                                {String(row.applicationKind ?? "new")}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {String(row.caseType ?? "normal").replace(/_/g, " ")}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="font-medium">{member?.name ?? row.memberId}</div>
                            <div className="text-xs text-muted-foreground">{row.memberId}</div>
                          </td>
                          <td className="px-5 py-3">{service?.name ?? row.serviceType ?? "-"}</td>
                          <td className="px-5 py-3 text-right font-semibold">
                            {fmtKES(finalAmount)}
                          </td>
                          <td className="px-5 py-3 capitalize">
                            {String(row.workflowStage ?? row.status).replace(/_/g, " ")}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => loadServiceApplicationDraft(row)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                            >
                              <Pencil className="h-3 w-3" />
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={serviceApplicationBusy}
                              onClick={() =>
                                void transitionServiceApplication(
                                  row,
                                  "under_review",
                                  "financial_review",
                                )
                              }
                              className="ml-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                            >
                              <ClipboardList className="h-3 w-3" />
                              Review
                            </button>
                            <button
                              type="button"
                              disabled={serviceApplicationBusy || approved}
                              onClick={() =>
                                void transitionServiceApplication(row, "approved", "final_approval")
                              }
                              className="ml-2 inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Approve
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {tab === "percentages" && (
          <Section
            title="Percentages and thresholds"
            action={
              <button
                onClick={() =>
                  void persistPolicySettings(
                    "percentages",
                    percentagesDraft,
                    "System percentages updated",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Save className="h-3.5 w-3.5" />
                Save values
              </button>
            }
          >
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
              <NumberField
                label="Processing %"
                value={percentagesDraft.processingPct}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({ ...current, processingPct: value }))
                }
              />
              <NumberField
                label="Insurance %"
                value={percentagesDraft.insurancePct}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({ ...current, insurancePct: value }))
                }
              />
              <NumberField
                label="Transaction Cost %"
                value={percentagesDraft.transactionCostPct}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({ ...current, transactionCostPct: value }))
                }
              />
              <NumberField
                label="Daily Penalty %"
                value={percentagesDraft.penaltyDailyPct}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({ ...current, penaltyDailyPct: value }))
                }
              />
              <NumberField
                label="Default Penalty %"
                value={percentagesDraft.defaultPenaltyPct}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({ ...current, defaultPenaltyPct: value }))
                }
              />
              <NumberField
                label="Savings Threshold (KES)"
                value={percentagesDraft.mandatorySavingsThreshold}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({
                    ...current,
                    mandatorySavingsThreshold: value,
                  }))
                }
              />
              <NumberField
                label="Shares Threshold (KES)"
                value={percentagesDraft.mandatorySharesThreshold}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({
                    ...current,
                    mandatorySharesThreshold: value,
                  }))
                }
              />
              <NumberField
                label="Round-off Step (KES)"
                value={percentagesDraft.roundOffStep}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({
                    ...current,
                    roundOffStep: Math.max(1, value),
                  }))
                }
              />
              <NumberField
                label="Fuel Buffer (KES)"
                value={percentagesDraft.fuelBufferAmount}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({
                    ...current,
                    fuelBufferAmount: Math.max(0, value),
                  }))
                }
              />
              <NumberField
                label="Fuel Charge (KES)"
                value={percentagesDraft.fuelChargeAmount}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({
                    ...current,
                    fuelChargeAmount: Math.max(0, value),
                  }))
                }
              />
              <NumberField
                label="Stock Charge (KES)"
                value={percentagesDraft.stockChargeAmount}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({
                    ...current,
                    stockChargeAmount: Math.max(0, value),
                  }))
                }
              />
            </div>
            <div className="border-t border-border px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Fixed transaction fee bands</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    These brackets replace one global transaction percentage. The app now prices
                    each loan using the matching amount band.
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setTransactionFeeBandsDraft((current) => [
                        ...current,
                        {
                          id: `tx-band-${current.length + 1}`,
                          minAmount:
                            current.length > 0
                              ? (current[current.length - 1].maxAmount ??
                                  current[current.length - 1].minAmount) + 1
                              : 0,
                          maxAmount: undefined,
                          feeAmount: 0,
                          label: "",
                        },
                      ])
                    }
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    Add band
                  </button>
                  <button
                    onClick={() =>
                      void persistPolicySettings(
                        "transaction_fee_bands",
                        transactionFeeBandsDraft,
                        "Transaction fee bands updated",
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  >
                    <Save className="h-3.5 w-3.5" />
                    Save bands
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {transactionFeeBandsDraft.map((band, index) => (
                  <div
                    key={band.id}
                    className="grid gap-3 rounded-lg border border-border bg-muted/15 p-3 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto]"
                  >
                    <Field label="Label">
                      <input
                        value={band.label ?? ""}
                        onChange={(event) =>
                          setTransactionFeeBandsDraft((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, label: event.target.value } : item,
                            ),
                          )
                        }
                        className="input"
                      />
                    </Field>
                    <NumberField
                      label="Min amount"
                      value={band.minAmount}
                      onChange={(value) =>
                        setTransactionFeeBandsDraft((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, minAmount: Math.max(0, value) } : item,
                          ),
                        )
                      }
                    />
                    <NumberField
                      label="Max amount"
                      value={band.maxAmount ?? 0}
                      onChange={(value) =>
                        setTransactionFeeBandsDraft((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, maxAmount: value > 0 ? value : undefined }
                              : item,
                          ),
                        )
                      }
                    />
                    <NumberField
                      label="Fixed fee"
                      value={band.feeAmount}
                      onChange={(value) =>
                        setTransactionFeeBandsDraft((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, feeAmount: Math.max(0, value) } : item,
                          ),
                        )
                      }
                    />
                    <div className="flex items-end">
                      <button
                        onClick={() =>
                          setTransactionFeeBandsDraft((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                        className="rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-border px-5 py-4">
              <div className="text-sm font-medium">Tiered upfront reference</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Premium upfront is no longer treated as one fixed figure here. It follows the shared
                SBC loan bands already used by the simulator and first-time application flow, and
                the full prompt total now includes membership, card, and sticker fees where
                applicable.
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {SBC_UPFRONT_TABLE.map((tier) => {
                  const totals = upfrontTotalsForAmount(tier.min, {
                    membershipFeeAmount: membershipAmount,
                    cardFeeAmount: cardAmount,
                    stickerFeeAmount: stickerAmount,
                    includeSticker: true,
                  });
                  return (
                    <div
                      key={tier.range}
                      className="rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {tier.range}
                      </div>
                      <div className="mt-1 font-medium">{fmtKES(totals.totalUpfrontNow)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Upfront {fmtKES(totals.total)} · fees {fmtKES(totals.mandatoryFeesTotal)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Shares {fmtKES(totals.sharesAmount)} · Savings{" "}
                        {fmtKES(totals.savingsAmount)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
              These values now drive loan deductions, penalty previews, savings and shares
              qualification, and the M-Pesa round-off behavior across the app. Premium upfront
              values are derived from the shared loan-band table instead of a fixed policy-center
              amount.
            </div>
          </Section>
        )}

        {tab === "interest" && (
          <Section
            title="Interest by loan category and days"
            action={
              <button
                onClick={() =>
                  void persistPolicySettings(
                    "interest_rates",
                    interestDraft,
                    "Interest rates updated",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Save className="h-3.5 w-3.5" />
                Save rates
              </button>
            }
          >
            <div className="grid gap-6 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="text-sm font-medium">Standard loans</div>
                {[7, 14, 30].map((term) => (
                  <NumberField
                    key={term}
                    label={`${term} days interest %`}
                    value={interestDraft.standard[term as 7 | 14 | 30]}
                    onChange={(value) =>
                      setInterestDraft((current) => ({
                        ...current,
                        standard: { ...current.standard, [term]: value },
                      }))
                    }
                  />
                ))}
              </div>
              <div className="space-y-3">
                <div className="text-sm font-medium">Premium loans</div>
                {[14, 30, 60, 90].map((term) => (
                  <NumberField
                    key={term}
                    label={`${term} days interest %`}
                    value={interestDraft.premium[term as 14 | 30 | 60 | 90]}
                    onChange={(value) =>
                      setInterestDraft((current) => ({
                        ...current,
                        premium: { ...current.premium, [term]: value },
                      }))
                    }
                  />
                ))}
              </div>
            </div>
            <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
              New loan applications use the configured rate for the selected repayment-day bucket as
              a percentage of net disbursed. Existing loans keep the rate already stored on the loan
              record.
            </div>
          </Section>
        )}

        {tab === "waterfall" && currentWaterfall && (
          <Section
            title="Waterfall flow editor"
            action={
              <button
                onClick={() =>
                  void persistPolicySettings(
                    "waterfall_rules",
                    waterfallDraft,
                    "Waterfall rules updated",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                <Save className="h-3.5 w-3.5" />
                Save waterfall
              </button>
            }
          >
            <div className="border-b border-border p-5">
              <PaymentFlowTree
                membershipFeeAmount={membershipAmount}
                cardFeeAmount={cardAmount}
                stickerFeeAmount={stickerAmount}
                mandatorySavingsThreshold={percentagesDraft.mandatorySavingsThreshold}
                mandatorySharesThreshold={percentagesDraft.mandatorySharesThreshold}
              />
            </div>
            <div className="grid gap-6 p-5 lg:grid-cols-[280px,1fr]">
              <div className="space-y-3">
                <Field label="Scenario">
                  <select
                    value={waterfallScenario}
                    onChange={(event) =>
                      setWaterfallScenario(event.target.value as WaterfallScenario)
                    }
                    className="input"
                  >
                    {Object.entries(WATERFALL_SCENARIO_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  The editor below now controls the preprocessing order before the fixed split
                  happens. Required fees and penalties can still be re-ordered by scenario, but
                  loan-member collections reserve the KSh 50 or KSh 100 compliance contribution,
                  then send the remainder to loan repayment.
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                  <div className="mb-1 font-medium text-foreground">Current path</div>
                  <div className="text-muted-foreground">
                    {describeWaterfallPreview(currentWaterfall)}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {currentWaterfall.steps.map((step, index) => (
                  <div
                    key={`${currentWaterfall.scenario}-${index}`}
                    className="grid gap-3 rounded-xl border border-border p-4 md:grid-cols-[80px,1fr,auto]"
                  >
                    <div className="text-xs text-muted-foreground">
                      Position
                      <div className="mt-1 text-lg font-semibold text-foreground">{index + 1}</div>
                    </div>
                    <Field label="Destination">
                      <select
                        value={step}
                        onChange={(event) =>
                          setWaterfallDraft((current) =>
                            current.map((rule) =>
                              rule.scenario !== waterfallScenario
                                ? rule
                                : {
                                    ...rule,
                                    steps: rule.steps.map((candidate, stepIndex) =>
                                      stepIndex === index
                                        ? (event.target.value as WaterfallDestination)
                                        : candidate,
                                    ),
                                  },
                            ),
                          )
                        }
                        className="input"
                      >
                        {waterfallOptionsForScenario(waterfallScenario).map((option) => (
                          <option key={option} value={option}>
                            {WATERFALL_DESTINATION_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="flex items-end gap-2">
                      <button
                        onClick={() =>
                          moveWaterfallStep(waterfallScenario, index, -1, setWaterfallDraft)
                        }
                        disabled={index === 0}
                        className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted disabled:opacity-40"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          moveWaterfallStep(waterfallScenario, index, 1, setWaterfallDraft)
                        }
                        disabled={index === currentWaterfall.steps.length - 1}
                        className="rounded-md border border-border px-2 py-2 text-xs hover:bg-muted disabled:opacity-40"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          removeWaterfallStep(waterfallScenario, index, setWaterfallDraft)
                        }
                        disabled={currentWaterfall.steps.length <= 1}
                        className="rounded-md border border-destructive/30 px-2 py-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => addWaterfallStep(waterfallScenario, setWaterfallDraft)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                  Add destination
                </button>
              </div>
            </div>
          </Section>
        )}

        {tab === "clients" && (
          <>
            <Section title="Client selector">
              <div className="grid gap-4 p-5 lg:grid-cols-[320px,1fr]">
                <div className="space-y-3">
                  <Field label="Search client">
                    <input
                      value={clientQuery}
                      onChange={(event) => setClientQuery(event.target.value)}
                      placeholder="Search by name, member ID, or phone"
                      className="input"
                    />
                  </Field>
                  {clientQuery.trim() && (
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border bg-card p-1">
                      {filteredClients.slice(0, 8).map((member) => {
                        const active = member.id === clientId;
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => setClientId(member.id)}
                            className={`w-full rounded px-2 py-2 text-left text-sm transition ${
                              active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                            }`}
                          >
                            <span className="block font-medium">{member.name}</span>
                            <span className="block text-xs opacity-75">
                              {member.id} - {member.phone}
                            </span>
                          </button>
                        );
                      })}
                      {filteredClients.length === 0 && (
                        <div className="px-2 py-2 text-sm text-muted-foreground">
                          No matching clients.
                        </div>
                      )}
                    </div>
                  )}
                  <Field label="Client record">
                    <MemberSearchSelect
                      members={filteredClients}
                      value={clientId}
                      onChange={setClientId}
                      emptyLabel="Select client"
                      describeMember={(member) =>
                        `${member.id} - ${member.name} - ${member.phone ?? ""}`
                      }
                    />
                  </Field>
                </div>
                {selectedClient && clientRating && (
                  <div className="rounded-xl border border-border bg-muted/20 p-4">
                    <div className="text-sm font-semibold">{selectedClient.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Rating:{" "}
                      <span className="font-medium text-foreground">{clientRating.label}</span> -{" "}
                      {clientRating.detail}
                    </div>
                  </div>
                )}
              </div>
            </Section>

            {selectedClient && (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <StatCard
                    label="Total Loans"
                    value={selectedClientLoans.length + carryoverLoans.length}
                  />
                  <StatCard
                    label="Total Borrowed"
                    value={fmtKES(totalBorrowed + carryoverBorrowed)}
                  />
                  <StatCard
                    label="Total Interest"
                    value={fmtKES(totalInterest + carryoverInterest)}
                  />
                  <StatCard
                    label="Outstanding Balance"
                    value={fmtKES(combinedOutstandingBalance)}
                    tone="warning"
                  />
                  <StatCard
                    label="Penalties"
                    value={`${fmtKES(penaltiesOutstanding)} open / ${fmtKES(penaltiesPaid)} paid / ${fmtKES(penaltiesWaived)} waived`}
                    tone={penaltiesOutstanding > 0 ? "destructive" : "success"}
                  />
                  <StatCard
                    label="Collections Logged"
                    value={fmtKES(combinedCollections)}
                    tone="accent"
                  />
                  <StatCard
                    label="Lifetime Net"
                    value={fmtKES(clientLifetimeNet)}
                    hint={`${fmtKES(selectedClientInflow)} in / ${fmtKES(selectedClientOutflow)} out`}
                    tone={clientLifetimeNet >= 0 ? "success" : "destructive"}
                  />
                  <StatCard
                    label="Daily target"
                    value={fmtKES(selectedClientDailyTarget)}
                    tone="warning"
                  />
                </div>

                <Section title="Client balances and history">
                  <div className="grid gap-6 p-5 lg:grid-cols-[280px,1fr]">
                    <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4 text-sm">
                      <MetricRow label="Savings" value={fmtKES(selectedClient.savingsBalance)} />
                      <MetricRow label="Shares" value={`${selectedClient.shares} units`} />
                      <MetricRow label="Member ID" value={selectedClient.id} />
                      <MetricRow label="Phone" value={selectedClient.phone} />
                      <MetricRow label="Joined" value={selectedClient.joinedAt} />
                      <div className="border-t border-border pt-3">
                        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                          Transaction totals
                        </div>
                        <div className="space-y-2">
                          {selectedClientTransactionTotals.map((row) => (
                            <MetricRow
                              key={row.label}
                              label={row.label}
                              value={fmtKES(row.value)}
                            />
                          ))}
                          <MetricRow label="Live net" value={fmtKES(selectedClientNet)} />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {clientLoansSummary.length === 0 && (
                        <div className="text-sm text-muted-foreground">
                          No loans recorded for this client.
                        </div>
                      )}
                      {clientLoansSummary.map(({ loan, summary }) => (
                        <div key={loan.id} className="rounded-xl border border-border p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{loan.id}</div>
                              <div className="text-xs text-muted-foreground">
                                {fmtKES(summary.approved)} - {loan.rate}% - {summary.termDays} days
                              </div>
                            </div>
                            <Badge
                              tone={
                                loan.status === "closed"
                                  ? "success"
                                  : loan.status === "active"
                                    ? "warning"
                                    : loan.status === "defaulted"
                                      ? "destructive"
                                      : "muted"
                              }
                            >
                              {loan.status}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-4">
                            <MetricCard label="Principal" value={fmtKES(summary.approved)} />
                            <MetricCard label="Interest" value={fmtKES(summary.interest)} />
                            <MetricCard label="Balance" value={fmtKES(summary.balance)} />
                            <MetricCard label="Due Date" value={summary.dueDate} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>

                <Section
                  title="Carryover balances"
                  action={
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void resetSelectedClientCarryover()}
                        disabled={carryoverResetting}
                        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {carryoverResetting ? "Resetting..." : "Reset carryover"}
                      </button>
                      <button
                        onClick={() => void runManualRedistribution()}
                        disabled={isRedistributing}
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isRedistributing ? "animate-spin" : ""}`}
                        />
                        {isRedistributing ? "Redistributing..." : "Redistribute"}
                      </button>
                      <button
                        onClick={() => void saveCarryoverProfileDraft()}
                        disabled={carryoverSaving}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {carryoverSaving ? "Saving..." : "Save carryover"}
                      </button>
                    </div>
                  }
                >
                  <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-4 rounded-xl border border-border bg-muted/10 p-4 md:col-span-2 xl:col-span-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <MetricCard label="Lifetime net" value={fmtKES(clientLifetimeNet)} />
                        <MetricCard
                          label="Locked live savings"
                          value={fmtKES(selectedClient.savingsBalance)}
                        />
                        <MetricCard
                          label="Locked live shares"
                          value={`${selectedClient.shares} units / ${fmtKES(
                            selectedClient.shares * sharePrice,
                          )}`}
                        />
                        <MetricCard
                          label="Remaining undistributed"
                          value={fmtKES(carryoverUndistributedBalance)}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { key: "loan" as const, label: "Loan member" },
                          { key: "none" as const, label: "Non-loan member" },
                        ].map((option) => {
                          const active = carryoverMemberMode === option.key;
                          return (
                            <button
                              key={option.key}
                              type="button"
                              onClick={() => setCarryoverMemberMode(option.key)}
                              className={`rounded-md border px-3 py-2 text-sm font-medium transition ${
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-card hover:bg-muted"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      {carryoverMemberMode === "loan" && (
                        <label className="block max-w-xs">
                          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                            Loan category
                          </span>
                          <select
                            value={guidedLoanKind}
                            onChange={(event) =>
                              changeGuidedLoanKind(event.target.value as LoanKind)
                            }
                            className="input mt-1"
                          >
                            <option value="financial">Financial</option>
                            <option value="fuel">Fuel</option>
                            <option value="stock">Stock</option>
                          </select>
                        </label>
                      )}
                      {carryoverMemberMode === "loan" && (
                        <div className="space-y-4">
                          <div className="grid gap-3 md:grid-cols-3">
                            <NumberField
                              label="Loan entries"
                              value={guidedLoanEntries.length}
                              onChange={(value) =>
                                setGuidedLoanEntries((current) =>
                                  resizeGuidedCarryoverLoans(
                                    current,
                                    value,
                                    selectedClient.id,
                                    "active",
                                    guidedLoanKind,
                                  ),
                                )
                              }
                            />
                            <MetricCard
                              label="Finished"
                              value={`${guidedClosedLoanSummaries.length}`}
                            />
                            <MetricCard label="Open" value={`${guidedOpenLoanSummaries.length}`} />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <MetricCard
                              label="Completed-loan compliance contribution"
                              value={fmtKES(completedLoanComplianceTotal)}
                            />
                            <MetricCard
                              label="Mandatory compliance savings"
                              value={fmtKES(guidedComplianceAllocation.savingsAmount)}
                            />
                            <MetricCard
                              label="Mandatory shares"
                              value={`${guidedComplianceAllocation.shareUnits} units / ${fmtKES(
                                guidedComplianceAllocation.shareAmount,
                              )}`}
                            />
                            <MetricCard
                              label="Purpose pool overflow"
                              value={fmtKES(guidedComplianceAllocation.purposePoolAmount)}
                            />
                          </div>
                          <div className="grid gap-4 xl:grid-cols-2">
                            {derivedGuidedLoanRows.map(({ loan, summary, status }, index) => (
                              <GuidedCarryoverLoanCard
                                key={loan.id || `loan-entry-${index}`}
                                status={status}
                                index={index}
                                loan={loan}
                                summary={summary}
                                calculatedPaidToDate={
                                  derivedGuidedLoanRows[index]?.calculatedPaidToDate ?? 0
                                }
                                onChange={(nextLoan) =>
                                  setGuidedLoanEntries((current) =>
                                    current.map((item, itemIndex) =>
                                      itemIndex === index ? nextLoan : item,
                                    ),
                                  )
                                }
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <MetricCard
                      label="Lifetime net used"
                      value={fmtKES(derivedCarryoverTotalCollected)}
                    />
                    <MetricCard
                      label="Automatic upfront savings"
                      value={fmtKES(automaticCarryoverDeductions.upfrontSavingsAmount)}
                    />
                    <MetricCard
                      label="Automatic upfront shares"
                      value={`${automaticCarryoverDeductions.upfrontShareUnits} units / ${fmtKES(
                        automaticCarryoverDeductions.upfrontShareAmount,
                      )}`}
                    />
                    <NumberField
                      label="Purpose pool balance"
                      value={carryoverBreakdown.purposePoolBalance}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          collectionBreakdown: {
                            ...readCarryoverBreakdown(current.collectionBreakdown),
                            purposePoolBalance: value,
                          },
                        }))
                      }
                    />
                    <NumberField
                      label="Investment balance"
                      value={carryoverProfile.investmentBalance}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          investmentBalance: value,
                        }))
                      }
                    />
                    <NumberField
                      label="Other collected"
                      value={carryoverProfile.otherCollectedTotal}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          otherCollectedTotal: value,
                        }))
                      }
                    />
                    <div className="rounded-xl border border-border bg-muted/20 p-4 md:col-span-2 xl:col-span-2">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Automatic fees and loan charges
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <MetricCard
                          label="Membership fee"
                          value={fmtKES(carryoverFeeBuckets.membership)}
                        />
                        <MetricCard label="Card fee" value={fmtKES(carryoverFeeBuckets.card)} />
                        <MetricCard
                          label="Sticker fee"
                          value={fmtKES(carryoverFeeBuckets.sticker)}
                        />
                        <MetricCard
                          label="Premium upfront"
                          value={fmtKES(
                            automaticCarryoverDeductions.upfrontSavingsAmount +
                              automaticCarryoverDeductions.upfrontShareAmount,
                          )}
                        />
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <NumberField
                          label="Processing fees"
                          value={carryoverFeeBuckets.processing}
                          onChange={(value) =>
                            setCarryoverProfile((current) => ({
                              ...current,
                              collectionBreakdown: {
                                ...readCarryoverBreakdown(current.collectionBreakdown),
                                feeBuckets: {
                                  ...readCarryoverBreakdown(current.collectionBreakdown).feeBuckets,
                                  processing: value,
                                },
                              },
                            }))
                          }
                        />
                        <NumberField
                          label="Insurance fees"
                          value={carryoverFeeBuckets.insurance}
                          onChange={(value) =>
                            setCarryoverProfile((current) => ({
                              ...current,
                              collectionBreakdown: {
                                ...readCarryoverBreakdown(current.collectionBreakdown),
                                feeBuckets: {
                                  ...readCarryoverBreakdown(current.collectionBreakdown).feeBuckets,
                                  insurance: value,
                                },
                              },
                            }))
                          }
                        />
                        <NumberField
                          label="Transaction fees"
                          value={carryoverFeeBuckets.transaction}
                          onChange={(value) =>
                            setCarryoverProfile((current) => ({
                              ...current,
                              collectionBreakdown: {
                                ...readCarryoverBreakdown(current.collectionBreakdown),
                                feeBuckets: {
                                  ...readCarryoverBreakdown(current.collectionBreakdown).feeBuckets,
                                  transaction: value,
                                },
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                    <NumberField
                      label="Penalties outstanding"
                      value={carryoverProfile.penaltiesOutstanding}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          penaltiesOutstanding: value,
                        }))
                      }
                    />
                    <NumberField
                      label="Penalties waived total"
                      value={carryoverProfile.penaltiesWaivedTotal}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          penaltiesWaivedTotal: value,
                        }))
                      }
                    />
                    <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4">
                      <MetricRow label="Share value" value={fmtKES(effectiveCarryoverShareValue)} />
                      <MetricRow label="Fee buckets total" value={fmtKES(carryoverFeeTotal)} />
                      <MetricRow
                        label="Loan repayments derived"
                        value={fmtKES(carryoverLoanRepaymentsRecorded)}
                      />
                      <MetricRow
                        label="Purpose pool"
                        value={fmtKES(carryoverBreakdown.purposePoolBalance)}
                      />
                      <button
                        type="button"
                        onClick={applyCarryoverWaterfallDraft}
                        className="mt-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        Apply remaining balance through waterfall
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-4 md:col-span-2 xl:col-span-4">
                      <div>
                        <div className="text-sm font-medium">Advanced carryover loan editor</div>
                        <div className="text-xs text-muted-foreground">
                          Use this for one-off edits after the guided loan counts above are saved.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowCarryoverAdvanced((current) => !current)}
                        className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        {showCarryoverAdvanced
                          ? "Hide legacy loan tools"
                          : "Show legacy loan tools"}
                      </button>
                    </div>
                    <Field label="First loan start date">
                      <input
                        type="date"
                        value={carryoverProfile.firstLoanStartDate ?? ""}
                        onChange={(event) =>
                          setCarryoverProfile((current) => ({
                            ...current,
                            firstLoanStartDate: event.target.value || undefined,
                          }))
                        }
                        className="input"
                      />
                    </Field>
                    <Field label="Last loan end date">
                      <input
                        type="date"
                        value={carryoverProfile.lastLoanEndDate ?? ""}
                        onChange={(event) =>
                          setCarryoverProfile((current) => ({
                            ...current,
                            lastLoanEndDate: event.target.value || undefined,
                          }))
                        }
                        className="input"
                      />
                    </Field>
                    <div className="md:col-span-2 xl:col-span-4 grid gap-3 sm:grid-cols-3">
                      <MetricCard
                        label="Derived total collected"
                        value={fmtKES(derivedCarryoverTotalCollected)}
                      />
                      <MetricCard
                        label="Undistributed balance"
                        value={fmtKES(carryoverUndistributedBalance)}
                      />
                      <MetricCard
                        label="Derived pending balance"
                        value={fmtKES(
                          carryoverLoanSummaries.reduce(
                            (sum, row) => sum + row.summary.totalOwedNow,
                            0,
                          ),
                        )}
                      />
                      <MetricCard
                        label="Completed carryover cycles"
                        value={carryoverCompletedCycles.toFixed(0)}
                      />
                    </div>
                    <Field label="Notes" className="md:col-span-2 xl:col-span-4">
                      <textarea
                        rows={3}
                        value={carryoverProfile.notes ?? ""}
                        onChange={(event) =>
                          setCarryoverProfile((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className="input"
                      />
                    </Field>
                  </div>
                  <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
                    Saving carryover balances updates the member's live savings, share units, and
                    fee-status flags. The total deposit figure now includes savings, share value,
                    completed-loan collections, fee buckets, investments, purpose pool, and other
                    collected money so every client coin stays visible in one guided view.
                  </div>
                </Section>

                {showCarryoverAdvanced && (
                  <Section
                    title="Carryover loans"
                    action={
                      <div className="flex gap-2">
                        <button
                          onClick={() => clearCarryoverLoanDraft(selectedClient.id)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => void saveCarryoverLoanDraft()}
                          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                        >
                          <Save className="h-3.5 w-3.5" />
                          Save loan
                        </button>
                      </div>
                    }
                  >
                    <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                      <Field label="Label">
                        <input
                          value={carryoverLoanDraft.label}
                          onChange={(event) =>
                            setCarryoverLoanDraft((current) => ({
                              ...current,
                              label: event.target.value,
                            }))
                          }
                          className="input"
                        />
                      </Field>
                      <Field label="Carryover product">
                        <select
                          value={carryoverLoanDraft.loanKind ?? "financial"}
                          onChange={(event) =>
                            setCarryoverLoanDraft((current) => ({
                              ...current,
                              loanKind: event.target.value as LoanKind,
                              termDays: Math.max(1, Number(current.termDays) || 30),
                              label:
                                current.label === "Legacy loan" || !current.label
                                  ? `${event.target.value === "fuel" ? "Fuel" : event.target.value === "stock" ? "Stock" : "Financial"} carryover`
                                  : current.label,
                            }))
                          }
                          className="input"
                        >
                          <option value="financial">Financial</option>
                          <option value="fuel">Fuel</option>
                          <option value="stock">Stock</option>
                          <option value="service">Service</option>
                        </select>
                      </Field>
                      {carryoverLoanDraft.loanKind === "fuel" && (
                        <>
                          <Field label="Vehicle / plate">
                            <input
                              value={String(
                                carryoverLoanDraft.feeBreakdown?.productMeta?.vehiclePlate ?? "",
                              )}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                    {
                                      ...current.feeBreakdown,
                                      productMeta: {
                                        ...(current.feeBreakdown?.productMeta ?? {}),
                                        vehiclePlate: event.target.value,
                                      },
                                    },
                                    current.loanCycleNumber,
                                  ),
                                }))
                              }
                              className="input"
                            />
                          </Field>
                          <div className="md:col-span-2 xl:col-span-4">
                            <FuelJobCardFields
                              rows={carryoverLoanDraftFuelRows}
                              onChange={(rows) =>
                                setCarryoverLoanDraft((current) =>
                                  withCarryoverFuelRows(current, rows),
                                )
                              }
                            />
                          </div>
                          <NumberField
                            label="Total Penalties Before Last Loan"
                            value={Number(carryoverLoanDraft.feeBreakdown?.priorPenaltyAmount ?? 0)}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                  {
                                    ...current.feeBreakdown,
                                    priorPenaltyAmount: Math.max(0, value),
                                  },
                                  current.loanCycleNumber,
                                ),
                              }))
                            }
                          />
                        </>
                      )}
                      {carryoverLoanDraft.loanKind === "stock" && (
                        <>
                          <Field label="Stock item">
                            <input
                              value={String(
                                carryoverLoanDraft.feeBreakdown?.productMeta?.stockItem ?? "",
                              )}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                    {
                                      ...current.feeBreakdown,
                                      productMeta: {
                                        ...(current.feeBreakdown?.productMeta ?? {}),
                                        stockItem: event.target.value,
                                      },
                                    },
                                    current.loanCycleNumber,
                                  ),
                                }))
                              }
                              className="input"
                            />
                          </Field>
                          <NumberField
                            label="Stock amount"
                            value={Number(
                              carryoverLoanDraft.feeBreakdown?.productMeta?.stockAmount ??
                                carryoverLoanDraft.principal,
                            )}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                principal: value,
                                feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                  {
                                    ...current.feeBreakdown,
                                    productMeta: {
                                      ...(current.feeBreakdown?.productMeta ?? {}),
                                      stockAmount: value,
                                    },
                                  },
                                  current.loanCycleNumber,
                                ),
                              }))
                            }
                          />
                          <NumberField
                            label="Stock charge"
                            value={Number(
                              carryoverLoanDraft.feeBreakdown?.productMeta?.stockCharge ?? 0,
                            )}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                interestRatePct: 0,
                                feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                  {
                                    ...current.feeBreakdown,
                                    processingFeeAmount: value,
                                    productMeta: {
                                      ...(current.feeBreakdown?.productMeta ?? {}),
                                      stockCharge: value,
                                    },
                                  },
                                  current.loanCycleNumber,
                                ),
                              }))
                            }
                          />
                        </>
                      )}
                      {carryoverLoanDraft.loanKind !== "fuel" && (
                        <>
                          <NumberField
                            label="Loan cycle #"
                            value={carryoverLoanDraft.loanCycleNumber}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                loanCycleNumber: Math.max(1, Math.floor(value)),
                                feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                  current.feeBreakdown,
                                  Math.max(1, Math.floor(value)),
                                ),
                              }))
                            }
                          />
                          <NumberField
                            label="Principal"
                            value={carryoverLoanDraft.principal}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({ ...current, principal: value }))
                            }
                          />
                          <Field label="Term days">
                            <input
                              type="number"
                              min={1}
                              value={carryoverLoanDraft.termDays}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  termDays: Math.max(1, Number(event.target.value) || 1),
                                }))
                              }
                              className="input"
                            />
                          </Field>
                          <NumberField
                            label="Daily penalty missed days"
                            value={carryoverLoanDraftSummary.dailyPenaltyDays}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                  {
                                    ...current.feeBreakdown,
                                    dailyPenaltyDays: Math.max(0, Math.floor(value)),
                                  },
                                  current.loanCycleNumber,
                                ),
                              }))
                            }
                          />
                          <NumberField
                            label="Daily penalty amount"
                            value={carryoverLoanDraftSummary.dailyPenaltyAmount}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                  {
                                    ...current.feeBreakdown,
                                    dailyPenaltyAmount: Math.max(0, value),
                                  },
                                  current.loanCycleNumber,
                                ),
                              }))
                            }
                          />
                          {carryoverLoanDraft.loanKind === "financial" ? (
                            <Field label="Daily compliance contribution amount">
                              <select
                                value={normalizeCarryoverDailyCompliance(
                                  carryoverLoanDraft.dailySavingsAmount,
                                )}
                                onChange={(event) =>
                                  setCarryoverLoanDraft((current) => ({
                                    ...current,
                                    dailySavingsAmount: Number(event.target.value),
                                  }))
                                }
                                className="input"
                              >
                                {CARRYOVER_DAILY_COMPLIANCE_OPTIONS.map((amount) => (
                                  <option key={amount} value={amount}>
                                    {amount} KSh / day
                                  </option>
                                ))}
                              </select>
                            </Field>
                          ) : (
                            <NumberField
                              label="Daily compliance contribution amount"
                              value={0}
                              readOnly
                            />
                          )}
                          <CarryoverLoanFeeFields
                            loan={carryoverLoanDraft}
                            summary={carryoverLoanDraftSummary}
                            onChange={setCarryoverLoanDraft}
                          />
                          <Field label="Start date">
                            <input
                              type="date"
                              value={carryoverLoanDraft.startDate}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  startDate: event.target.value,
                                }))
                              }
                              className="input"
                            />
                          </Field>
                          <Field label="Due date override">
                            <input
                              type="date"
                              value={carryoverLoanDraft.dueDate ?? ""}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  dueDate: event.target.value || undefined,
                                }))
                              }
                              className="input"
                            />
                          </Field>
                          <NumberField
                            label="Penalty waived"
                            value={carryoverLoanDraft.penaltyWaivedAmount}
                            onChange={(value) =>
                              setCarryoverLoanDraft((current) => ({
                                ...current,
                                penaltyWaivedAmount: value,
                              }))
                            }
                          />
                          <Field label="Status">
                            <select
                              value={carryoverLoanDraft.status}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  status: event.target.value as "active" | "closed" | "defaulted",
                                }))
                              }
                              className="input"
                            >
                              <option value="active">Active</option>
                              <option value="closed">Closed</option>
                              <option value="defaulted">Defaulted</option>
                            </select>
                          </Field>
                          {carryoverLoanDraft.status === "closed" || carryoverLoanDraft.finished ? (
                            <NumberField
                              label="Days after due date"
                              value={carryoverLoanDraftSummary.dueDatePenaltyDays}
                              onChange={(value) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                                    {
                                      ...current.feeBreakdown,
                                      dueDatePenaltyDays: Math.max(0, Math.floor(value)),
                                    },
                                    current.loanCycleNumber,
                                  ),
                                }))
                              }
                            />
                          ) : carryoverLoanDraft.status === "defaulted" ? (
                            <MetricCard
                              label="Due-date days to today"
                              value={`${carryoverLoanDraftSummary.daysPastDue}`}
                            />
                          ) : null}
                          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={carryoverLoanDraft.finished}
                                onChange={(event) =>
                                  setCarryoverLoanDraft((current) => ({
                                    ...current,
                                    finished: event.target.checked,
                                    status: event.target.checked ? "closed" : current.status,
                                  }))
                                }
                              />
                              Mark this legacy loan as finished
                            </label>
                            <Field label="Closed on">
                              <input
                                type="date"
                                value={carryoverLoanDraft.closedOn ?? ""}
                                onChange={(event) =>
                                  setCarryoverLoanDraft((current) => ({
                                    ...current,
                                    closedOn: event.target.value || undefined,
                                  }))
                                }
                                className="input"
                              />
                            </Field>
                          </div>
                          <Field label="Notes" className="md:col-span-2 xl:col-span-4">
                            <textarea
                              rows={3}
                              value={carryoverLoanDraft.notes ?? ""}
                              onChange={(event) =>
                                setCarryoverLoanDraft((current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              className="input"
                            />
                          </Field>
                          <div className="md:col-span-2 xl:col-span-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <MetricCard
                              label="Rate used"
                              value={`${carryoverLoanDraftSummary.ratePct.toFixed(1)}%`}
                            />
                            <MetricCard
                              label="Auto due date"
                              value={carryoverLoanDraftSummary.dueDate}
                            />
                            <MetricCard
                              label="Repayment total"
                              value={fmtKES(carryoverLoanDraftSummary.totalRepayment)}
                            />
                            <MetricCard
                              label="Daily installment"
                              value={fmtKES(carryoverLoanDraftSummary.dailyInclusive)}
                            />
                            <MetricCard
                              label="Grand total collected"
                              value={fmtKES(carryoverLoanDraftSummary.totalExpectedCollected)}
                            />
                            <MetricCard
                              label="Round-off basket"
                              value={fmtKES(
                                carryoverLoanDraftSummary.roundOff *
                                  carryoverLoanDraftSummary.termDays,
                              )}
                            />
                            <MetricCard
                              label="Fees and subscriptions"
                              value={fmtKES(carryoverLoanDraftSummary.feeChargesTotal)}
                            />
                            <MetricCard
                              label="Daily penalty"
                              value={fmtKES(carryoverLoanDraftSummary.arrearsPenalty)}
                            />
                            <MetricCard
                              label="Due-date penalty"
                              value={fmtKES(carryoverLoanDraftSummary.overduePenalty)}
                            />
                            <MetricCard
                              label="Owed now"
                              value={fmtKES(carryoverLoanDraftSummary.totalOwedNow)}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
                      Start with principal, term, daily compliance contribution, start date, and
                      status. Leave the override rate at 0 to use the current policy rate for that
                      term. Paid-to-date is derived from the client's lifetime net.
                    </div>
                    <div className="space-y-4 border-t border-border p-5">
                      {carryoverLoading && (
                        <div className="text-sm text-muted-foreground">
                          Loading carryover loans...
                        </div>
                      )}
                      {!carryoverLoading && carryoverLoanSummaries.length === 0 && (
                        <div className="text-sm text-muted-foreground">
                          No legacy loans saved for this client yet.
                        </div>
                      )}
                      {carryoverLoanSummaries.map(({ loan, summary }) => (
                        <div key={loan.id} className="rounded-xl border border-border p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">
                                {loan.label} · Cycle {loan.loanCycleNumber}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fmtKES(loan.principal)} · {summary.ratePct}% · {summary.termDays}{" "}
                                days · start {loan.startDate}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Badge
                                tone={
                                  loan.status === "closed"
                                    ? "success"
                                    : loan.status === "defaulted"
                                      ? "destructive"
                                      : "warning"
                                }
                              >
                                {loan.status}
                              </Badge>
                              <button
                                onClick={() => beginEditCarryoverLoan(loan)}
                                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                              >
                                Edit
                              </button>
                              <button
                                onClick={async () => {
                                  await deleteCarryoverLoan({ data: { id: loan.id } });
                                  await refreshCarryoverDetails(selectedClient.id);
                                  await refreshAllCarryoverLoans();
                                  toast.success("Carryover loan deleted");
                                }}
                                className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                            <MetricCard
                              label="Total Repayment"
                              value={fmtKES(summary.totalRepayment)}
                            />
                            <MetricCard
                              label="Daily Inclusive"
                              value={fmtKES(summary.dailyInclusive)}
                            />
                            <MetricCard label="Paid To Date" value={fmtKES(loan.paidToDate)} />
                            <MetricCard label="Balance" value={fmtKES(summary.balance)} />
                            <MetricCard label="Due Date" value={summary.dueDate} />
                            <MetricCard label="Owed Now" value={fmtKES(summary.totalOwedNow)} />
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-4">
                            <MetricCard label="Arrears" value={fmtKES(summary.arrears)} />
                            <MetricCard label="Past Due Days" value={`${summary.daysPastDue}`} />
                            <MetricCard
                              label="Daily Penalty"
                              value={fmtKES(summary.arrearsPenalty)}
                            />
                            <MetricCard
                              label="Due-Date Penalty"
                              value={fmtKES(summary.overduePenalty)}
                            />
                            <MetricCard
                              label="Penalty Estimate"
                              value={fmtKES(summary.estimatedPenaltyNow)}
                            />
                            <MetricCard
                              label="Compliance contribution accrued"
                              value={fmtKES(summary.totalSavingsAccrued)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}

                <Section title="Penalty control">
                  <div className="grid gap-4 p-5 lg:grid-cols-[280px,1fr]">
                    <div className="space-y-3">
                      <Field label="Waiver note">
                        <textarea
                          rows={4}
                          value={waiverNote}
                          onChange={(event) => setWaiverNote(event.target.value)}
                          placeholder="Reason for the waiver"
                          className="input"
                        />
                      </Field>
                    </div>
                    <div className="space-y-3">
                      {selectedClientPenalties.length === 0 && (
                        <div className="text-sm text-muted-foreground">
                          No penalties recorded for this client.
                        </div>
                      )}
                      {selectedClientPenalties.map((penalty) => (
                        <div key={penalty.id} className="rounded-xl border border-border p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{penalty.reason}</div>
                              <div className="text-xs text-muted-foreground">
                                {penalty.id} · {penalty.date}
                              </div>
                            </div>
                            <Badge
                              tone={
                                penalty.status === "paid"
                                  ? "success"
                                  : penalty.status === "waived"
                                    ? "accent"
                                    : "warning"
                              }
                            >
                              {penalty.status}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-[1fr,180px,auto]">
                            <MetricCard label="Amount" value={fmtKES(penalty.amount)} />
                            <Field label="Waive amount">
                              <input
                                type="number"
                                value={waiverAmounts[penalty.id] ?? penalty.amount}
                                onChange={(event) =>
                                  setWaiverAmounts((current) => ({
                                    ...current,
                                    [penalty.id]: Number(event.target.value),
                                  }))
                                }
                                className="input"
                              />
                            </Field>
                            <div className="flex items-end">
                              <button
                                disabled={penalty.status !== "outstanding"}
                                onClick={() => void applyPenaltyWaiver(penalty.id, penalty.amount)}
                                className="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40"
                              >
                                Waive penalty
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>
              </>
            )}
          </>
        )}

        {tab === "targets" && (
          <>
            <Section title="Live loan-book baseline">
              <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Open live loans" value={openLiveLoanSummaries.length} />
                <StatCard label="Open carryover loans" value={openCarryoverPortfolio.length} />
                <StatCard
                  label="Remaining collectible"
                  value={fmtKES(portfolioRemainingCollections)}
                  tone="accent"
                />
                <StatCard
                  label="Due today"
                  value={fmtKES(systemTargetRows[0]?.expectedValue ?? 0)}
                  tone="warning"
                />
              </div>
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left">Window</th>
                      <th className="px-5 py-3 text-right">Scheduled</th>
                      <th className="px-5 py-3 text-right">Actual repayments</th>
                      <th className="px-5 py-3 text-right">Gap</th>
                      <th className="px-5 py-3 text-right">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {systemTargetRows.map((target) => (
                      <tr key={target.key}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{target.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {target.window.start} {"->"} {target.window.end}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-medium">
                          {fmtKES(target.expectedValue)}
                        </td>
                        <td className="px-5 py-3 text-right">{fmtKES(target.actualValue)}</td>
                        <td
                          className={`px-5 py-3 text-right font-medium ${
                            target.gap >= 0 ? "text-success" : "text-destructive"
                          }`}
                        >
                          {target.gap >= 0 ? "+" : ""}
                          {fmtKES(target.gap)}
                        </td>
                        <td className="px-5 py-3 text-right">{target.progressPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
                These targets are auto-generated from the current live and carryover loan book so
                the policy center always shows what should be collectible now before any manual
                director targets are added.
              </div>
            </Section>

            <Section title="Create or edit manual target">
              <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5">
                <Field label="Metric">
                  <select
                    value={targetDraft.metric}
                    onChange={(event) =>
                      setTargetDraft((current) => ({
                        ...current,
                        metric: event.target.value as TargetMetric,
                      }))
                    }
                    className="input"
                  >
                    {Object.entries(TARGET_METRIC_META).map(([value, meta]) => (
                      <option key={value} value={value}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Period">
                  <select
                    value={targetDraft.period}
                    onChange={(event) =>
                      setTargetDraft((current) => ({
                        ...current,
                        period: event.target.value as TargetPeriod,
                      }))
                    }
                    className="input"
                  >
                    {Object.entries(TARGET_PERIOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Expected value">
                  <input
                    type="number"
                    value={targetDraft.expectedValue}
                    onChange={(event) =>
                      setTargetDraft((current) => ({
                        ...current,
                        expectedValue: Number(event.target.value),
                      }))
                    }
                    className="input"
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    Suggested from the live book:{" "}
                    {formatTargetValue(targetDraft.metric, suggestedTargetValue)}
                  </div>
                </Field>
                <Field label="Start date">
                  <input
                    type="date"
                    value={targetDraft.startOn}
                    onChange={(event) =>
                      setTargetDraft((current) => ({ ...current, startOn: event.target.value }))
                    }
                    className="input"
                  />
                </Field>
                <Field label="Notes">
                  <input
                    value={targetDraft.notes}
                    onChange={(event) =>
                      setTargetDraft((current) => ({ ...current, notes: event.target.value }))
                    }
                    className="input"
                  />
                </Field>
              </div>
              <div className="flex gap-2 border-t border-border px-5 py-4">
                <button
                  onClick={async () => {
                    await upsertTarget({
                      id: targetDraft.id,
                      metric: targetDraft.metric,
                      period: targetDraft.period,
                      expectedValue: targetDraft.expectedValue,
                      startOn: targetDraft.startOn,
                      notes: targetDraft.notes || undefined,
                    });
                    toast.success(targetDraft.id ? "Target updated" : "Target created");
                    setTargetDraft(blankTarget());
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                >
                  <Save className="h-4 w-4" />
                  Save target
                </button>
                <button
                  onClick={() => setTargetDraft(blankTarget())}
                  className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
                >
                  Clear
                </button>
              </div>
            </Section>

            <Section title="Actual vs expected performance">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left">Target</th>
                      <th className="px-5 py-3 text-left">Window</th>
                      <th className="px-5 py-3 text-right">Expected</th>
                      <th className="px-5 py-3 text-right">Actual</th>
                      <th className="px-5 py-3 text-right">Progress</th>
                      <th className="px-5 py-3 text-left">Notes</th>
                      <th className="px-5 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {enrichedTargets.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-5 py-8 text-center text-sm text-muted-foreground"
                        >
                          No manual targets saved yet. The live loan-book baseline above is still
                          updating automatically.
                        </td>
                      </tr>
                    )}
                    {enrichedTargets.map((target) => (
                      <tr key={target.id}>
                        <td className="px-5 py-3">
                          <div className="font-medium">
                            {TARGET_METRIC_META[target.metric].label}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {TARGET_PERIOD_LABELS[target.period]}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {target.window.start} {"->"} {target.window.end}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {formatTargetValue(target.metric, target.expectedValue)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {formatTargetValue(target.metric, target.actualValue)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex min-w-[120px] flex-col items-end gap-1">
                            <div className="text-xs font-medium">
                              {target.progressPct.toFixed(1)}%
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted">
                              <div
                                className={`h-2 rounded-full ${
                                  target.progressPct >= 100
                                    ? "bg-success"
                                    : target.progressPct >= 70
                                      ? "bg-primary"
                                      : "bg-warning"
                                }`}
                                style={{
                                  width: `${Math.min(100, Math.max(0, target.progressPct))}%`,
                                }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {target.notes || TARGET_METRIC_META[target.metric].description}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="inline-flex gap-1">
                            <button
                              onClick={() =>
                                setTargetDraft({
                                  id: target.id,
                                  metric: target.metric,
                                  period: target.period,
                                  expectedValue: target.expectedValue,
                                  startOn: target.startOn,
                                  notes: target.notes ?? "",
                                })
                              }
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                            >
                              Edit
                            </button>
                            <button
                              onClick={async () => {
                                await removeTarget(target.id);
                                toast.success("Target removed");
                              }}
                              className="rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
                Sticker issued currently follows recorded sticker fee payments until a dedicated
                issue timestamp is added to the database.
              </div>
            </Section>
          </>
        )}
      </main>
    </>
  );
}

function blankFee(): FeePolicy {
  return {
    key: "membership",
    label: "Membership Fee",
    amount: 0,
    permanence: "permanent",
    scope: "all",
    selectedMemberIds: [],
    effectiveFrom: new Date().toISOString().slice(0, 10),
    custom: false,
    updatedAt: new Date().toISOString(),
  };
}

function isCoreFeePolicy(fee: Pick<FeePolicy, "key">) {
  return [
    "membership",
    "card",
    "sticker",
    "fuel_buffer",
    "monthly_member_subscription",
    "annual_member_subscription",
  ].includes(fee.key);
}

function blankServiceDraft(): ServiceDraft {
  return {
    name: "",
    serviceCategory: "",
    description: "",
    price: 0,
    billingFrequency: "monthly",
    scope: "all_members",
    selectedMemberIds: [],
    deductionMode: "normal",
    feeOverridesText: "{}",
    effectiveDate: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    registrationFee: 0,
    processingFee: 0,
    serviceCharge: 0,
    waiverAmount: 0,
    penaltyAmount: 0,
    customChargesText: "[]",
    negotiatedDiscountAmount: 0,
    normalDeductionsText: "{}",
    gracePeriodDays: 0,
    renewalRulesText: "{}",
    active: true,
  };
}

function blankServiceApplicationDraft(memberId: string): ServiceApplicationDraft {
  return {
    memberId,
    serviceId: "",
    applicationKind: "new",
    serviceType: "",
    caseType: "normal",
    priority: "normal",
    problemReason: "",
    notes: "",
    county: "Kiambu",
    subcounty: "",
    ward: "",
    town: "",
    scheduleId: "",
    invoiceReference: "",
    invoiceNumber: "",
    invoiceDate: "",
    invoiceAmountCharged: 0,
    issueDate: "",
    expiryDate: "",
    renewalWindowDays: 0,
    gracePeriodDays: 0,
    confiscationReference: "",
    inventorySheetNumber: "",
    confiscationDate: "",
    status: "submitted",
    paymentStatus: "pending",
    workflowStage: "application_submitted",
    manualCountyCharges: 0,
    waiverAmount: 0,
    penaltyAmount: 0,
  };
}

function parseServiceOverridesDraft(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseServiceObjectDraft(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseServiceCustomChargesDraft(value: string): Array<{ label: string; amount: number }> {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        label: String(row.label ?? row.name ?? `Charge ${index + 1}`),
        amount: Math.max(0, Number(row.amount ?? 0) || 0),
      };
    });
  } catch {
    return [];
  }
}

function parseServiceRenewalRulesDraft(value: string) {
  const parsed = parseServiceObjectDraft(value);
  return {
    autoRenew: parsed.autoRenew === true,
    reminderDays: Math.max(0, Math.floor(Number(parsed.reminderDays ?? 0) || 0)),
    renewalWindowDays: Math.max(0, Math.floor(Number(parsed.renewalWindowDays ?? 0) || 0)),
  };
}

function describeFeeScope(fee: FeePolicy, members: Array<{ id: string }>) {
  if (fee.scope === "new_only") return `New members from ${fee.effectiveFrom}`;
  if (fee.scope !== "selected_members") return scopeLabel(fee.scope);
  const selectedIds = fee.selectedMemberIds ?? [];
  const selectedCount = selectedIds.filter((memberId) =>
    members.some((member) => member.id === memberId),
  ).length;
  return `Selected members (${selectedCount})`;
}

function blankTarget(): TargetDraft {
  return {
    metric: "collections_total",
    period: "daily",
    expectedValue: 0,
    startOn: new Date().toISOString().slice(0, 10),
    notes: "",
  };
}

function blankCarryoverProfile(memberId: string): LegacyCarryoverProfile {
  return {
    memberId,
    savingsBalance: 0,
    shareUnits: 0,
    feesPaidTotal: 0,
    loanRepaymentsTotal: 0,
    investmentBalance: 0,
    otherCollectedTotal: 0,
    totalCollected: 0,
    pendingBalance: 0,
    penaltiesOutstanding: 0,
    penaltiesWaivedTotal: 0,
    membershipFeePaid: false,
    cardFeePaid: false,
    stickerFeePaid: false,
    firstUpfrontPaid: false,
    completedLoanCycles: 0,
    collectionBreakdown: defaultCarryoverBreakdown(),
  };
}

function blankCarryoverLoan(memberId: string, cycleNumber: number): LegacyCarryoverLoan {
  return {
    id: "",
    memberId,
    label: "Legacy loan",
    loanKind: "financial",
    loanCycleNumber: Math.max(1, cycleNumber),
    principal: 0,
    interestRatePct: 0,
    termDays: 30,
    dailySavingsAmount: 100,
    startDate: new Date().toISOString().slice(0, 10),
    paidToDate: 0,
    status: "active",
    finished: false,
    penaltyWaivedAmount: 0,
    feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown({}, Math.max(1, cycleNumber)),
  };
}

function normalizeGuidedLoanKind(value?: string | null): LoanKind {
  return value === "fuel" || value === "stock" || value === "service" ? value : "financial";
}

function guidedLoanKindLabel(value: LoanKind) {
  return value === "fuel"
    ? "Fuel"
    : value === "stock"
      ? "Stock"
      : value === "service"
        ? "Service"
        : "Financial";
}

function carryoverFuelRows(loan: LegacyCarryoverLoan, fallbackCount = 1) {
  const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
    loan.feeBreakdown,
    loan.loanCycleNumber,
  );
  const productMeta = feeBreakdown.productMeta ?? {};
  const jobCard =
    productMeta.jobCard && typeof productMeta.jobCard === "object"
      ? (productMeta.jobCard as Record<string, unknown>)
      : {};
  return normalizeFuelJobCardRows(
    productMeta.fuelEntries ?? jobCard.rows,
    Math.max(1, fallbackCount),
  );
}

function firstFuelEntryDate(rows: Array<{ date?: string }>, fallback: string) {
  const firstDate = rows
    .map((row) => String(row.date ?? "").slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort((left, right) => left.localeCompare(right))[0];
  return firstDate ?? fallback;
}

function withCarryoverFuelRows(
  loan: LegacyCarryoverLoan,
  rows: ReturnType<typeof carryoverFuelRows>,
) {
  const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
    loan.feeBreakdown,
    loan.loanCycleNumber,
  );
  const summary = summarizeFuelJobCardRows(rows);
  const fuelAmount = summary.totalCost > 0 ? summary.totalCost : loan.principal;
  const fuelCharge =
    summary.totalFuelCharge > 0
      ? summary.totalFuelCharge
      : Number(feeBreakdown.productMeta?.fuelCharge ?? feeBreakdown.processingFeeAmount ?? 0);
  return {
    ...loan,
    principal: fuelAmount,
    startDate: firstFuelEntryDate(rows, loan.startDate),
    feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
      {
        ...feeBreakdown,
        processingFeeAmount: fuelCharge,
        productMeta: {
          ...(feeBreakdown.productMeta ?? {}),
          fuelAmount,
          fuelCharge,
          fuelEntries: rows,
          jobCard: {
            rows,
            totals: summary,
          },
        },
      },
      loan.loanCycleNumber,
    ),
  };
}

function applyGuidedCarryoverLoanKind(
  loan: LegacyCarryoverLoan,
  loanKind: LoanKind,
): LegacyCarryoverLoan {
  const nextKind = normalizeGuidedLoanKind(loanKind);
  const existingLabel = String(loan.label ?? "").trim();
  const shouldReplaceLabel =
    !existingLabel ||
    /^(legacy loan|(completed|defaulted|active) loan\s*\d*|financial carryover|fuel carryover|stock carryover|service carryover)$/i.test(
      existingLabel,
    );
  return {
    ...loan,
    loanKind: nextKind,
    label: shouldReplaceLabel ? `${guidedLoanKindLabel(nextKind)} carryover` : loan.label,
    interestRatePct: nextKind === "financial" ? loan.interestRatePct : 0,
    dailySavingsAmount:
      nextKind === "financial" ? normalizeCarryoverDailyCompliance(loan.dailySavingsAmount) : 0,
    termDays:
      nextKind === "fuel" || nextKind === "stock" || nextKind === "service"
        ? Math.max(1, Number(loan.termDays) || (nextKind === "fuel" ? 1 : 14))
        : loan.termDays,
  };
}

function normalizeCarryoverLoanCompliancePlan(loan: LegacyCarryoverLoan): LegacyCarryoverLoan {
  if (loan.loanKind === "fuel" || loan.loanKind === "stock" || loan.loanKind === "service") {
    return { ...loan, dailySavingsAmount: 0 };
  }
  return {
    ...loan,
    loanKind: "financial",
    dailySavingsAmount: normalizeCarryoverDailyCompliance(loan.dailySavingsAmount),
  };
}

function resizeGuidedCarryoverLoans(
  current: LegacyCarryoverLoan[],
  countValue: number,
  memberId: string,
  status: "closed" | "defaulted" | "active",
  loanKind: LoanKind = "financial",
) {
  const count = Math.max(0, Math.floor(Number(countValue) || 0));
  const labelPrefix =
    status === "closed"
      ? "Completed loan"
      : status === "defaulted"
        ? "Defaulted loan"
        : "Active loan";
  return Array.from({ length: count }, (_, index) => {
    const existing = current[index];
    return applyGuidedCarryoverLoanKind(
      {
        ...(existing ?? blankCarryoverLoan(memberId, index + 1)),
        memberId,
        label: existing?.label || `${labelPrefix} ${index + 1}`,
        loanCycleNumber: index + 1,
        status,
        finished: status === "closed",
      },
      loanKind,
    );
  });
}

function deriveGuidedCarryoverLoanRows(
  loans: LegacyCarryoverLoan[],
  policySettings: Parameters<typeof summarizeLegacyCarryoverLoan>[1],
  asOfDate: string,
  paymentBudget = 0,
) {
  let remainingPaymentBudget = Math.max(0, Number(paymentBudget) || 0);
  const derived = new Map<
    number,
    {
      loan: LegacyCarryoverLoan;
      summary: ReturnType<typeof summarizeLegacyCarryoverLoan>;
      status: "closed" | "defaulted" | "active";
      calculatedPaidToDate: number;
    }
  >();
  const sortedLoans = loans
    .map((loan, index) => ({ loan: normalizeCarryoverLoanCompliancePlan(loan), index }))
    .sort((left, right) => {
      const byDate = String(left.loan.startDate ?? "").localeCompare(
        String(right.loan.startDate ?? ""),
      );
      if (byDate !== 0) return byDate;
      return left.index - right.index;
    });

  sortedLoans.forEach(({ loan, index }) => {
    const unpaidSummary = summarizeLegacyCarryoverLoan(
      { ...loan, paidToDate: 0 },
      policySettings,
      asOfDate,
    );
    const calculatedPaidToDate = Math.min(
      remainingPaymentBudget,
      Math.max(0, unpaidSummary.totalExpectedCollected),
    );
    const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
      loan.feeBreakdown,
      loan.loanCycleNumber,
    );
    const autoPaidToDate =
      feeBreakdown.cashThroughCycleOverrideEnabled === true
        ? Math.max(0, feeBreakdown.cashThroughCycleOverrideAmount ?? 0)
        : calculatedPaidToDate;
    remainingPaymentBudget = Math.max(0, remainingPaymentBudget - autoPaidToDate);
    const paidLoan = { ...loan, paidToDate: autoPaidToDate };
    const summary = summarizeLegacyCarryoverLoan(paidLoan, policySettings, asOfDate);
    const status =
      summary.totalOwedNow <= 0
        ? "closed"
        : summary.dueDate < asOfDate || paidLoan.status === "defaulted"
          ? "defaulted"
          : "active";
    derived.set(index, {
      loan: {
        ...paidLoan,
        status,
        finished: status === "closed",
        closedOn: status === "closed" ? (paidLoan.closedOn ?? summary.dueDate) : undefined,
      },
      summary,
      status,
      calculatedPaidToDate,
    });
  });

  return loans.map((rawLoan, index) => {
    const loan = normalizeCarryoverLoanCompliancePlan(rawLoan);
    const row = derived.get(index);
    if (row) return row;
    const summary = summarizeLegacyCarryoverLoan(loan, policySettings, asOfDate);
    const status =
      summary.totalOwedNow <= 0
        ? "closed"
        : summary.dueDate < asOfDate || loan.status === "defaulted"
          ? "defaulted"
          : "active";
    return {
      loan: { ...loan, status, finished: status === "closed" },
      summary,
      status,
      calculatedPaidToDate: Math.max(0, loan.paidToDate),
    };
  });
}

function deriveAutomaticCarryoverDeductions({
  available,
  member,
  loans,
  membershipAmount,
  cardAmount,
  stickerAmount,
  sharePrice,
}: {
  available: number;
  member?: ReturnType<typeof useStore>["members"][number];
  loans: LegacyCarryoverLoan[];
  membershipAmount: number;
  cardAmount: number;
  stickerAmount: number;
  sharePrice: number;
}) {
  let remaining = Math.max(0, Number(available) || 0);
  const consume = (amount: number) => {
    const applied = Math.min(remaining, Math.max(0, Number(amount) || 0));
    remaining -= applied;
    return applied;
  };
  const feeBuckets = defaultCarryoverFeeBuckets();
  feeBuckets.membership = consume(membershipAmount);
  feeBuckets.card = consume(cardAmount);
  feeBuckets.sticker = member && memberNeedsSticker(member) ? consume(stickerAmount) : 0;

  const premiumLoan = loans.find((loan) => Number(loan.principal ?? 0) > 5000);
  const upfront = premiumLoan ? upfrontRequirementForAmount(premiumLoan.principal) : undefined;
  const upfrontSavingsAmount = consume(upfront?.savingsAmount ?? 0);
  const upfrontShareTarget = consume(upfront?.sharesAmount ?? 0);
  const upfrontShareUnits =
    sharePrice > 0 ? Math.floor(upfrontShareTarget / Math.max(1, Number(sharePrice) || 1)) : 0;
  const upfrontShareAmount = upfrontShareUnits * Math.max(0, Number(sharePrice) || 0);
  remaining += Math.max(0, upfrontShareTarget - upfrontShareAmount);

  return {
    feeBuckets,
    upfrontSavingsAmount,
    upfrontShareUnits,
    upfrontShareAmount,
    firstUpfrontRequired: Boolean(upfront && upfront.total > 0),
    membershipFeePaid: membershipAmount <= 0 || feeBuckets.membership >= membershipAmount,
    cardFeePaid: cardAmount <= 0 || feeBuckets.card >= cardAmount,
    stickerFeePaid:
      !member ||
      !memberNeedsSticker(member) ||
      stickerAmount <= 0 ||
      feeBuckets.sticker >= stickerAmount,
    firstUpfrontPaid:
      !upfront ||
      upfront.total <= 0 ||
      (upfrontSavingsAmount >= upfront.savingsAmount && upfrontShareAmount >= upfront.sharesAmount),
  };
}

function allocateComplianceContribution(
  amount: number,
  savingsThreshold: number,
  sharesThreshold: number,
  sharePrice: number,
) {
  const available = Math.max(0, Number(amount) || 0);
  const savingsAmount = Math.min(available, Math.max(0, Number(savingsThreshold) || 0));
  const remainingAfterSavings = Math.max(0, available - savingsAmount);
  const shareTargetAmount = Math.min(
    remainingAfterSavings,
    Math.max(0, Number(sharesThreshold) || 0),
  );
  const shareUnits =
    sharePrice > 0 ? Math.floor(shareTargetAmount / Math.max(1, Number(sharePrice) || 1)) : 0;
  const shareAmount = shareUnits * Math.max(0, Number(sharePrice) || 0);
  const purposePoolAmount = Math.max(0, remainingAfterSavings - shareAmount);
  return {
    savingsAmount,
    shareUnits,
    shareAmount,
    purposePoolAmount,
  };
}

function defaultCarryoverFeeBuckets(): CarryoverFeeBuckets {
  return {
    membership: 0,
    card: 0,
    sticker: 0,
    processing: 0,
    insurance: 0,
    transaction: 0,
  };
}

function defaultCarryoverBreakdown(): CarryoverCollectionBreakdown {
  return {
    totalDepositsRecorded: 0,
    purposePoolBalance: 0,
    feeBuckets: defaultCarryoverFeeBuckets(),
  };
}

function readCarryoverBreakdown(
  value: Record<string, unknown> | undefined,
): CarryoverCollectionBreakdown {
  const next = value && typeof value === "object" ? value : {};
  const feeBuckets =
    next.feeBuckets && typeof next.feeBuckets === "object"
      ? (next.feeBuckets as Record<string, unknown>)
      : {};
  return {
    totalDepositsRecorded: Number(next.totalDepositsRecorded ?? 0) || 0,
    purposePoolBalance: Number(next.purposePoolBalance ?? 0) || 0,
    preCarryoverLiveState:
      next.preCarryoverLiveState && typeof next.preCarryoverLiveState === "object"
        ? (next.preCarryoverLiveState as Record<string, unknown>)
        : undefined,
    feeBuckets: {
      membership: Number(feeBuckets.membership ?? 0) || 0,
      card: Number(feeBuckets.card ?? 0) || 0,
      sticker: Number(feeBuckets.sticker ?? 0) || 0,
      processing: Number(feeBuckets.processing ?? 0) || 0,
      insurance: Number(feeBuckets.insurance ?? 0) || 0,
      transaction: Number(feeBuckets.transaction ?? 0) || 0,
    },
  };
}

const CLIENT_INFLOW_TRANSACTION_TYPES = new Set([
  "deposit",
  "loan_repayment",
  "share_purchase",
  "investor_contribution",
  "fee_payment",
  "purpose_pool",
  "mpesa_unallocated",
]);

const CLIENT_OUTFLOW_TRANSACTION_TYPES = new Set([
  "withdrawal",
  "loan_disbursement",
  "petty_cash",
  "staff_payroll",
]);

function isClientInflowTransactionType(type: string) {
  return CLIENT_INFLOW_TRANSACTION_TYPES.has(String(type ?? ""));
}

function isClientOutflowTransactionType(type: string) {
  return CLIENT_OUTFLOW_TRANSACTION_TYPES.has(String(type ?? ""));
}

function isInternalSyntheticTransaction(transaction: { note?: string }) {
  const note = String(transaction.note ?? "")
    .trim()
    .toLowerCase();
  return (
    note.startsWith("policy redistribution:") ||
    note.startsWith("purpose pool reallocation ->") ||
    note.startsWith("round-off captured from m-pesa receipt")
  );
}

function selectedClientTransactionTotal(
  ledgerTransactions: Array<{ type: string; amount: number }>,
  mpesaAuditRows: any[],
  type: string,
) {
  const ledgerTotal = ledgerTransactions
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const mpesaTotal = mpesaAuditRows
    .filter((row) => String(row.type ?? "") === type)
    .reduce((sum, row) => sum + Number(row.originalAmount ?? row.amount ?? 0), 0);
  return ledgerTotal + mpesaTotal;
}

function hydrateCarryoverProfile(profile: LegacyCarryoverProfile): LegacyCarryoverProfile {
  return {
    ...profile,
    collectionBreakdown: readCarryoverBreakdown(profile.collectionBreakdown),
  };
}

function resolveRecordedCarryoverTotal(
  profile: Pick<LegacyCarryoverProfile, "totalCollected">,
  breakdown: CarryoverCollectionBreakdown,
  allocatedTotal: number,
) {
  if (breakdown.totalDepositsRecorded > 0) return breakdown.totalDepositsRecorded;
  if (profile.totalCollected > 0) return Math.max(profile.totalCollected, allocatedTotal);
  return allocatedTotal;
}

function addWaterfallStep(
  scenario: WaterfallScenario,
  setDraft: Dispatch<SetStateAction<WaterfallRule[]>>,
) {
  setDraft((current) =>
    current.map((rule) => {
      if (rule.scenario !== scenario) return rule;
      const choices = waterfallOptionsForScenario(scenario);
      const next =
        choices.find((choice) => !rule.steps.includes(choice)) ?? choices[choices.length - 1];
      return { ...rule, steps: [...rule.steps, next] };
    }),
  );
}

function moveWaterfallStep(
  scenario: WaterfallScenario,
  index: number,
  direction: -1 | 1,
  setDraft: Dispatch<SetStateAction<WaterfallRule[]>>,
) {
  setDraft((current) =>
    current.map((rule) => {
      if (rule.scenario !== scenario) return rule;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= rule.steps.length) return rule;
      const steps = [...rule.steps];
      [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
      return { ...rule, steps };
    }),
  );
}

function removeWaterfallStep(
  scenario: WaterfallScenario,
  index: number,
  setDraft: Dispatch<SetStateAction<WaterfallRule[]>>,
) {
  setDraft((current) =>
    current.map((rule) => {
      if (rule.scenario !== scenario || rule.steps.length <= 1) return rule;
      return { ...rule, steps: rule.steps.filter((_, stepIndex) => stepIndex !== index) };
    }),
  );
}

function describeWaterfallPreview(rule: WaterfallRule) {
  const steps =
    rule.steps.map((step) => WATERFALL_DESTINATION_LABELS[step]).join(" -> ") ||
    "No pre-processing deductions";
  if (rule.scenario === "member_with_loan") {
    return `${steps} -> Premium upfront if needed -> Compliance basket -> Loan repayment remainder`;
  }
  if (rule.scenario === "member_without_loan") {
    return `${steps} -> 60/40 compliance basket -> 80/20 post-compliance split`;
  }
  return steps || WATERFALL_SCENARIO_LABELS[rule.scenario];
}

function calculateTargetActual(
  target: PerformanceTarget,
  data: {
    members: ReturnType<typeof useStore>["members"];
    loans: ReturnType<typeof useStore>["loans"];
    transactions: ReturnType<typeof useStore>["transactions"];
  },
) {
  const window = targetWindow(target.period, target.startOn);
  const inWindow = (date: string) => {
    const value = date.slice(0, 10);
    return value >= window.start && value <= window.end;
  };
  const feeNotes = (note?: string) => (note ?? "").trim().toLowerCase();

  switch (target.metric) {
    case "collections_total":
      return data.transactions
        .filter((transaction) =>
          [
            "deposit",
            "loan_repayment",
            "share_purchase",
            "fee_payment",
            "investor_contribution",
          ].includes(transaction.type),
        )
        .filter((transaction) => inWindow(transaction.date))
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    case "loan_repayments":
      return data.transactions
        .filter(
          (transaction) => transaction.type === "loan_repayment" && inWindow(transaction.date),
        )
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    case "loan_disbursements":
      return data.transactions
        .filter(
          (transaction) => transaction.type === "loan_disbursement" && inWindow(transaction.date),
        )
        .reduce((sum, transaction) => sum + transaction.amount, 0);
    case "new_loans_count":
      return data.loans.filter(
        (loan) =>
          loan.status !== "pending" && loan.status !== "rejected" && inWindow(loan.startDate),
      ).length;
    case "registrations":
      return data.members.filter((member) => inWindow(member.joinedAt)).length;
    case "cards_paid":
      return data.transactions.filter(
        (transaction) =>
          transaction.type === "fee_payment" &&
          feeNotes(transaction.note).includes("card") &&
          inWindow(transaction.date),
      ).length;
    case "stickers_paid":
    case "stickers_issued":
      return data.transactions.filter(
        (transaction) =>
          transaction.type === "fee_payment" &&
          feeNotes(transaction.note).includes("sticker") &&
          inWindow(transaction.date),
      ).length;
  }
}

function targetWindow(period: TargetPeriod, startOn: string) {
  const start = new Date(`${startOn}T00:00:00`);
  const end = new Date(start);
  if (period === "daily") {
    end.setDate(start.getDate());
  } else if (period === "weekly") {
    end.setDate(start.getDate() + 6);
  } else if (period === "monthly") {
    end.setMonth(start.getMonth() + 1);
    end.setDate(end.getDate() - 1);
  } else {
    end.setFullYear(start.getFullYear() + 1);
    end.setDate(end.getDate() - 1);
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function formatTargetValue(metric: TargetMetric, value: number) {
  return TARGET_METRIC_META[metric].unit === "amount" ? fmtKES(value) : value.toFixed(0);
}

function dateOnlyValue(value: string) {
  return value.slice(0, 10);
}

function overlapDaysInclusive(
  startDate: string,
  endDate: string,
  windowStart: string,
  windowEnd: string,
) {
  const start = dateOnlyValue(startDate);
  const end = dateOnlyValue(endDate);
  const overlapStart = start > windowStart ? start : windowStart;
  const overlapEnd = end < windowEnd ? end : windowEnd;
  if (overlapStart > overlapEnd) return 0;

  const startMs = new Date(`${overlapStart}T00:00:00`).getTime();
  const endMs = new Date(`${overlapEnd}T00:00:00`).getTime();
  return Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
}

function scheduledRepaymentsForWindow(
  windowStart: string,
  windowEnd: string,
  liveLoans: Array<{
    loan: ReturnType<typeof useStore>["loans"][number];
    summary: ReturnType<typeof loanSummary>;
  }>,
  carryoverLoans: Array<{
    loan: LegacyCarryoverLoan;
    summary: ReturnType<typeof summarizeLegacyCarryoverLoan>;
  }>,
) {
  const liveDue = liveLoans.reduce((sum, row) => {
    const activeDays = overlapDaysInclusive(
      row.loan.startDate,
      row.summary.dueDate,
      windowStart,
      windowEnd,
    );
    return sum + activeDays * row.summary.dailyCollectionAmount;
  }, 0);

  const carryoverDue = carryoverLoans.reduce((sum, row) => {
    const activeDays = overlapDaysInclusive(
      row.loan.startDate,
      row.summary.dueDate,
      windowStart,
      windowEnd,
    );
    return sum + activeDays * row.summary.dailyInclusive;
  }, 0);

  return liveDue + carryoverDue;
}

function suggestTargetExpectedValue(
  metric: TargetMetric,
  period: TargetPeriod,
  systemTargets: Array<{ key: string; expectedValue: number }>,
  activeLoanCount: number,
) {
  if (metric === "loan_repayments" || metric === "collections_total") {
    const match = systemTargets.find((target) => target.key === period);
    return match?.expectedValue ?? 0;
  }
  if (metric === "new_loans_count") return activeLoanCount;
  return 0;
}

function buildClientRating(
  member: ReturnType<typeof useStore>["members"][number],
  loans: ReturnType<typeof useStore>["loans"],
  penalties: ReturnType<typeof useStore>["penalties"],
) {
  let score = 100;
  const closedLoans = loans.filter((loan) => loan.status === "closed").length;
  const defaultedLoans = loans.filter((loan) => loan.status === "defaulted").length;
  const overdueLoans = loans.filter((loan) => loanSummary(loan).isOverdue).length;
  const outstandingPenalties = penalties.filter(
    (penalty) => penalty.status === "outstanding",
  ).length;

  score -= defaultedLoans * 25;
  score -= overdueLoans * 15;
  score -= outstandingPenalties * 8;
  if (member.savingsBalance >= 1000) score += 5;
  if (closedLoans > 0) score += 5;

  if (score >= 90) return { label: "A - Strong", detail: "Good history, low current risk." };
  if (score >= 75)
    return { label: "B - Stable", detail: "Mostly healthy, keep watching collections." };
  if (score >= 55) return { label: "C - Watch", detail: "Emerging repayment or penalty pressure." };
  return { label: "D - High Risk", detail: "Frequent arrears, penalties, or unresolved balances." };
}

function GuidedCarryoverLoanCard({
  status,
  index,
  loan,
  summary,
  calculatedPaidToDate,
  onChange,
}: {
  status: "closed" | "defaulted" | "active";
  index: number;
  loan: LegacyCarryoverLoan;
  summary: ReturnType<typeof summarizeLegacyCarryoverLoan>;
  calculatedPaidToDate: number;
  onChange: (loan: LegacyCarryoverLoan) => void;
}) {
  const title =
    status === "closed"
      ? `Finished loan ${index + 1}`
      : status === "defaulted"
        ? `Defaulted loan ${index + 1}`
        : `Active loan ${index + 1}`;
  const showPaidFields = status !== "closed";
  const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
    loan.feeBreakdown,
    loan.loanCycleNumber,
  );
  const updateFee = (
    key: keyof NonNullable<LegacyCarryoverLoan["feeBreakdown"]>,
    value: number | boolean,
  ) => {
    onChange({
      ...loan,
      feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
        {
          ...feeBreakdown,
          [key]: value,
        },
        loan.loanCycleNumber,
      ),
    });
  };
  const updateProductMeta = (nextMeta: Record<string, unknown>) => {
    onChange({
      ...loan,
      feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
        {
          ...feeBreakdown,
          productMeta: {
            ...(feeBreakdown.productMeta ?? {}),
            ...nextMeta,
          },
        },
        loan.loanCycleNumber,
      ),
    });
  };
  const fuelRows = carryoverFuelRows(loan);
  const cashThroughCycleOverrideEnabled = feeBreakdown.cashThroughCycleOverrideEnabled === true;
  const cashThroughCycleOverrideAmount = Math.max(
    0,
    Number(feeBreakdown.cashThroughCycleOverrideAmount ?? 0) || 0,
  );

  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{title}</div>
        <Badge
          tone={
            status === "closed" ? "success" : status === "defaulted" ? "destructive" : "warning"
          }
        >
          {status === "closed" ? "finished" : status}
        </Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Label">
          <input
            value={loan.label}
            onChange={(event) => onChange({ ...loan, label: event.target.value })}
            className="input"
          />
        </Field>
        <Field label="Carryover product">
          <select
            value={loan.loanKind ?? "financial"}
            onChange={(event) => {
              const loanKind = event.target.value as LoanKind;
              onChange({
                ...loan,
                loanKind,
                label:
                  !loan.label || /^(Legacy|Financial|Fuel|Stock) loan/i.test(loan.label)
                    ? `${loanKind === "fuel" ? "Fuel" : loanKind === "stock" ? "Stock" : "Financial"} carryover`
                    : loan.label,
              });
            }}
            className="input"
          >
            <option value="financial">Financial</option>
            <option value="fuel">Fuel</option>
            <option value="stock">Stock</option>
            <option value="service">Service</option>
          </select>
        </Field>
        {loan.loanKind === "fuel" ? (
          <>
            <Field label="Vehicle / plate">
              <input
                value={String(feeBreakdown.productMeta?.vehiclePlate ?? "")}
                onChange={(event) => updateProductMeta({ vehiclePlate: event.target.value })}
                className="input"
              />
            </Field>
            <div className="md:col-span-2">
              <FuelJobCardFields
                rows={fuelRows}
                onChange={(rows) => onChange(withCarryoverFuelRows(loan, rows))}
              />
            </div>
          </>
        ) : null}
        {loan.loanKind === "stock" ? (
          <>
            <Field label="Stock item">
              <input
                value={String(feeBreakdown.productMeta?.stockItem ?? "")}
                onChange={(event) => updateProductMeta({ stockItem: event.target.value })}
                className="input"
              />
            </Field>
            <NumberField
              label="Stock amount"
              value={Number(feeBreakdown.productMeta?.stockAmount ?? loan.principal)}
              onChange={(value) =>
                onChange({
                  ...loan,
                  principal: value,
                  feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                    {
                      ...feeBreakdown,
                      productMeta: { ...(feeBreakdown.productMeta ?? {}), stockAmount: value },
                    },
                    loan.loanCycleNumber,
                  ),
                })
              }
            />
            <NumberField
              label="Stock charge"
              value={Number(
                feeBreakdown.productMeta?.stockCharge ?? feeBreakdown.processingFeeAmount ?? 0,
              )}
              onChange={(value) =>
                onChange({
                  ...loan,
                  feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
                    {
                      ...feeBreakdown,
                      processingFeeAmount: value,
                      productMeta: { ...(feeBreakdown.productMeta ?? {}), stockCharge: value },
                    },
                    loan.loanCycleNumber,
                  ),
                })
              }
            />
          </>
        ) : null}
        <NumberField
          label="Net disbursed"
          value={loan.principal}
          onChange={(value) => onChange({ ...loan, principal: value })}
        />
        <Field label="Term days">
          <input
            type="number"
            min={1}
            value={loan.termDays}
            onChange={(event) =>
              onChange({ ...loan, termDays: Math.max(1, Number(event.target.value) || 1) })
            }
            className="input"
          />
        </Field>
        <NumberField
          label="Daily penalty missed days"
          value={summary.dailyPenaltyDays}
          onChange={(value) => updateFee("dailyPenaltyDays", Math.max(0, Math.floor(value)))}
        />
        <NumberField
          label="Daily penalty amount"
          value={summary.dailyPenaltyAmount}
          onChange={(value) => updateFee("dailyPenaltyAmount", Math.max(0, value))}
        />
        {loan.loanKind === "financial" ? (
          <Field label="Daily compliance contribution">
            <select
              value={normalizeCarryoverDailyCompliance(loan.dailySavingsAmount)}
              onChange={(event) =>
                onChange({ ...loan, dailySavingsAmount: Number(event.target.value) })
              }
              className="input"
            >
              {CARRYOVER_DAILY_COMPLIANCE_OPTIONS.map((amount) => (
                <option key={amount} value={amount}>
                  {amount} KSh / day
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <NumberField label="Daily compliance contribution" value={0} readOnly />
        )}
        <Field label="Start date">
          <input
            type="date"
            value={loan.startDate}
            onChange={(event) => onChange({ ...loan, startDate: event.target.value })}
            className="input"
          />
        </Field>
        {showPaidFields && (
          <>
            <Field label="Due date override">
              <input
                type="date"
                value={loan.dueDate ?? ""}
                onChange={(event) =>
                  onChange({ ...loan, dueDate: event.target.value || undefined })
                }
                className="input"
              />
            </Field>
            <NumberField label="Paid from transaction ledger" value={loan.paidToDate} readOnly />
            <NumberField
              label="Penalty waived"
              value={loan.penaltyWaivedAmount}
              onChange={(value) => onChange({ ...loan, penaltyWaivedAmount: value })}
            />
            {status === "defaulted" ? (
              <MetricCard label="Due-date days to today" value={`${summary.daysPastDue}`} />
            ) : null}
          </>
        )}
        {status === "closed" ? (
          <NumberField
            label="Days after due date"
            value={summary.dueDatePenaltyDays}
            onChange={(value) => updateFee("dueDatePenaltyDays", Math.max(0, Math.floor(value)))}
          />
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Loan repayment total" value={fmtKES(summary.totalRepayment)} />
        <MetricCard
          label={status === "closed" ? "Saved as paid" : "Paid to date"}
          value={fmtKES(
            cashThroughCycleOverrideEnabled || status !== "closed"
              ? loan.paidToDate
              : summary.totalExpectedCollected,
          )}
        />
        <MetricCard
          label="Daily compliance contribution accrued"
          value={fmtKES(summary.totalSavingsAccrued)}
        />
        <MetricCard
          label={
            cashThroughCycleOverrideEnabled
              ? "Owed now"
              : status === "closed"
                ? "Cash through cycle"
                : "Owed now"
          }
          value={fmtKES(
            cashThroughCycleOverrideEnabled
              ? 0
              : status === "closed"
                ? summary.totalExpectedCollected
                : summary.totalOwedNow,
          )}
        />
        <MetricCard label="Daily penalty" value={fmtKES(summary.arrearsPenalty)} />
        <MetricCard label="Due-date penalty" value={fmtKES(summary.overduePenalty)} />
      </div>
      <div
        className={`mt-4 space-y-3 rounded-xl border p-4 ${
          cashThroughCycleOverrideEnabled
            ? "border-primary bg-primary/5"
            : "border-border bg-background/40"
        }`}
      >
        <button
          type="button"
          aria-pressed={cashThroughCycleOverrideEnabled}
          onClick={() =>
            updateFee("cashThroughCycleOverrideEnabled", !cashThroughCycleOverrideEnabled)
          }
          className="flex w-full items-start justify-between gap-3 text-left"
        >
          <span>
            <span className="block text-sm font-medium">Cash through cycle override</span>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Use a manual cash-through-cycle amount for this loan only.
            </span>
          </span>
          <span
            className={`inline-flex h-7 min-w-14 items-center justify-center rounded-md border px-2 text-xs font-semibold ${
              cashThroughCycleOverrideEnabled
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            {cashThroughCycleOverrideEnabled ? "On" : "Off"}
          </span>
        </button>
        {cashThroughCycleOverrideEnabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label="Override amount"
              value={cashThroughCycleOverrideAmount}
              onChange={(value) => updateFee("cashThroughCycleOverrideAmount", Math.max(0, value))}
            />
            <div className="rounded-lg border border-border bg-background/50 p-3 text-sm">
              <MetricRow label="Calculated" value={fmtKES(calculatedPaidToDate)} />
              <MetricRow label="Deducting" value={fmtKES(loan.paidToDate)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CarryoverLoanFeeFields({
  loan,
  summary,
  onChange,
  compact = false,
}: {
  loan: LegacyCarryoverLoan;
  summary: ReturnType<typeof summarizeLegacyCarryoverLoan>;
  onChange: (loan: LegacyCarryoverLoan) => void;
  compact?: boolean;
}) {
  const feeBreakdown = normalizeLegacyCarryoverLoanFeeBreakdown(
    loan.feeBreakdown,
    loan.loanCycleNumber,
  );
  const oneTimeLocked = loan.loanCycleNumber > 1;
  const updateFee = (
    key: keyof NonNullable<LegacyCarryoverLoan["feeBreakdown"]>,
    value: number | boolean,
  ) => {
    onChange({
      ...loan,
      feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown(
        {
          ...feeBreakdown,
          [key]: value,
        },
        loan.loanCycleNumber,
      ),
    });
  };

  return (
    <div
      className={
        compact
          ? "md:col-span-2 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 md:grid-cols-2 xl:grid-cols-4"
          : "md:col-span-2 xl:col-span-4 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-4"
      }
    >
      {!oneTimeLocked ? (
        <>
          <NumberField
            label="Membership fee"
            value={feeBreakdown.membershipFeeAmount ?? 0}
            onChange={(value) => updateFee("membershipFeeAmount", value)}
          />
          <NumberField
            label="Card fee"
            value={feeBreakdown.cardFeeAmount ?? 0}
            onChange={(value) => updateFee("cardFeeAmount", value)}
          />
          <NumberField
            label="Sticker fee"
            value={feeBreakdown.stickerFeeAmount ?? 0}
            onChange={(value) => updateFee("stickerFeeAmount", value)}
          />
        </>
      ) : null}
      <NumberField
        label="Processing fee"
        value={feeBreakdown.processingFeeAmount ?? 0}
        onChange={(value) => updateFee("processingFeeAmount", value)}
      />
      <NumberField
        label="Insurance fee"
        value={feeBreakdown.insuranceFeeAmount ?? 0}
        onChange={(value) => updateFee("insuranceFeeAmount", value)}
      />
      <NumberField
        label="Transaction fee"
        value={feeBreakdown.transactionFeeAmount ?? 0}
        onChange={(value) => updateFee("transactionFeeAmount", value)}
      />
      <NumberField
        label="Monthly subscription"
        value={feeBreakdown.monthlySubscriptionAmount ?? 0}
        onChange={(value) => updateFee("monthlySubscriptionAmount", value)}
      />
      <NumberField
        label="Subscription months"
        value={feeBreakdown.subscriptionMonths ?? 0}
        onChange={(value) => updateFee("subscriptionMonths", Math.max(0, Math.floor(value)))}
      />
      <label className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-3 py-2 text-sm">
        <input
          type="checkbox"
          checked={feeBreakdown.subscriptionWaived === true}
          onChange={(event) => updateFee("subscriptionWaived", event.target.checked)}
        />
        Waive subscriptions
      </label>
      <MetricCard label="One-time fees" value={fmtKES(summary.oneTimeFees)} />
      <MetricCard label="Loan fees" value={fmtKES(summary.loanServiceFees)} />
      <MetricCard
        label={feeBreakdown.subscriptionWaived ? "Subscriptions waived" : "Subscriptions due"}
        value={fmtKES(
          feeBreakdown.subscriptionWaived
            ? summary.subscriptionWaivedAmount
            : summary.subscriptionDeducted,
        )}
      />
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1 [&_.input]:w-full [&_.input]:rounded-md [&_.input]:border [&_.input]:border-border [&_.input]:bg-muted [&_.input]:px-3 [&_.input]:py-2 [&_.input]:text-sm [&_.input]:focus:outline-none [&_.input]:focus:ring-2 [&_.input]:focus:ring-primary/40">
        {children}
      </div>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  label: string;
  value: number;
  onChange?: (value: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange?.(Number(event.target.value))}
        disabled={disabled}
        readOnly={readOnly}
        className="input"
      />
    </Field>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
