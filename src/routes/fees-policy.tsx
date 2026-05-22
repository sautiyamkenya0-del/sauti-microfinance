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
import { PaymentFlowTree } from "@/components/PaymentFlowTree";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import {
  deleteFeePolicyRecord,
  deleteMemberCarryoverLoanRecord,
  resetMemberCarryoverRecord,
  triggerPurposePoolRedistributionRecord,
  upsertMemberCarryoverLoanRecord,
  upsertMemberCarryoverProfileRecord,
  upsertFeePolicyRecord,
  upsertPolicySettingRecord,
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
  PREMIUM_POLICY_TERMS,
  STANDARD_POLICY_TERMS,
  WATERFALL_DESTINATION_LABELS,
  WATERFALL_SCENARIO_LABELS,
  waterfallOptionsForScenario,
  type WaterfallDestination,
  type WaterfallRule,
  type WaterfallScenario,
} from "@/lib/policy-settings";
import { listAllCarryoverLoans, loadMemberCarryover } from "@/lib/runtime-data.functions";
import {
  fmtKES,
  loanSummary,
  SBC_UPFRONT_TABLE,
  upfrontTotalsForAmount,
  useStore,
} from "@/lib/store";

type PolicyCenterTab = "fees" | "percentages" | "interest" | "waterfall" | "clients" | "targets";

type TargetDraft = {
  id?: string;
  metric: TargetMetric;
  period: TargetPeriod;
  expectedValue: number;
  startOn: string;
  notes: string;
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

const SCOPES: FeeScope[] = ["all", "new_only", "selected_members", "loan_holders", "investors"];
const SUBPAGES: { key: PolicyCenterTab; label: string }[] = [
  { key: "fees", label: "Fees" },
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

  const [tab, setTab] = useState<PolicyCenterTab>("fees");
  const [editingFee, setEditingFee] = useState<FeePolicy | null>(null);
  const [creatingFee, setCreatingFee] = useState(false);
  const [percentagesDraft, setPercentagesDraft] = useState(policySettings.percentages);
  const [interestDraft, setInterestDraft] = useState(policySettings.interestRates);
  const [waterfallDraft, setWaterfallDraft] = useState(policySettings.waterfallRules);
  const [transactionFeeBandsDraft, setTransactionFeeBandsDraft] = useState(
    policySettings.transactionFeeBands,
  );
  const [waterfallScenario, setWaterfallScenario] = useState<WaterfallScenario>("member_with_loan");
  const [clientQuery, setClientQuery] = useState("");
  const [feeMemberQuery, setFeeMemberQuery] = useState("");
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
  const [guidedClosedLoans, setGuidedClosedLoans] = useState<LegacyCarryoverLoan[]>([]);
  const [waiverNote, setWaiverNote] = useState("");
  const [waiverAmounts, setWaiverAmounts] = useState<Record<string, number>>({});
  const [isRedistributing, setIsRedistributing] = useState(false);
  const [carryoverResetting, setCarryoverResetting] = useState(false);

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
    setFeeMemberQuery("");
  }, [editingFee?.key]);

  const refreshAllCarryoverLoans = useCallback(async () => {
    setAllCarryoverLoans(await loadAllCarryoverLoans());
  }, [loadAllCarryoverLoans]);

  useEffect(() => {
    refreshAllCarryoverLoans().catch((error: any) => {
      toast.error(error?.message ?? "Failed to load carryover loan summaries.");
    });
  }, [refreshAllCarryoverLoans]);

  useEffect(() => {
    if (!clientId) {
      setCarryoverProfile(blankCarryoverProfile(""));
      setCarryoverLoans([]);
      setCarryoverLoanDraft(blankCarryoverLoan("", 1));
      setGuidedClosedLoans([]);
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
        const profile = hydrateCarryoverProfile(
          typedResult.profile ?? blankCarryoverProfile(clientId),
        );
        setCarryoverProfile(profile);
        setCarryoverLoans(typedResult.loans);
        setCarryoverLoanDraft(blankCarryoverLoan(clientId, typedResult.loans.length + 1));
        setGuidedClosedLoans(
          typedResult.loans.filter((loan) => loan.status === "closed" || loan.finished),
        );
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
  }, [clientId, loadCarryover]);

  const selectedClient = memberAccounts.find((member) => member.id === clientId) ?? null;
  const selectedClientLoans = loans.filter((loan) => loan.memberId === clientId);
  const selectedClientPenalties = penalties.filter((penalty) => penalty.memberId === clientId);
  const selectedClientTransactions = transactions.filter(
    (transaction) => transaction.memberId === clientId,
  );
  const feeRows = feePolicies.length > 0 ? feePolicies : DEFAULT_FEE_POLICIES;
  const activeFees = feeRows.filter(isFeeActive);
  const filteredClients = memberAccounts.filter((member) => {
    const q = clientQuery.trim().toLowerCase();
    if (!q) return true;
    return member.name.toLowerCase().includes(q) || member.id.toLowerCase().includes(q);
  });
  const currentWaterfall =
    waterfallDraft.find((rule) => rule.scenario === waterfallScenario) ??
    policySettings.waterfallRules.find((rule) => rule.scenario === waterfallScenario);

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
  const carryoverBreakdown = readCarryoverBreakdown(carryoverProfile.collectionBreakdown);
  const carryoverFeeBuckets = carryoverBreakdown.feeBuckets;
  const carryoverFeeTotal = Object.values(carryoverFeeBuckets).reduce(
    (sum, value) => sum + value,
    0,
  );
  const guidedClosedLoanSummaries = guidedClosedLoans.map((loan) => ({
    loan,
    summary: summarizeLegacyCarryoverLoan(loan, policySettings),
  }));
  const hasClosedCarryoverLoanRecords = carryoverLoans.some(
    (loan) => loan.status === "closed" || loan.finished,
  );
  const openCarryoverLoanSummaries = carryoverLoanSummaries.filter(
    ({ loan }) => loan.status !== "closed" && !loan.finished,
  );
  const carryoverLoanRepaymentsRecorded =
    hasClosedCarryoverLoanRecords || openCarryoverLoanSummaries.length > 0
      ? guidedClosedLoanSummaries.reduce((sum, row) => sum + row.summary.totalRepayment, 0) +
        openCarryoverLoanSummaries.reduce((sum, row) => sum + row.loan.paidToDate, 0)
      : carryoverProfile.loanRepaymentsTotal;
  const carryoverShareValue = carryoverProfile.shareUnits * sharePrice;
  const derivedCarryoverAllocatedTotal =
    carryoverProfile.savingsBalance +
    carryoverShareValue +
    carryoverFeeTotal +
    carryoverLoanRepaymentsRecorded +
    carryoverProfile.investmentBalance +
    carryoverBreakdown.purposePoolBalance +
    carryoverProfile.otherCollectedTotal;
  const derivedCarryoverTotalCollected = resolveRecordedCarryoverTotal(
    carryoverProfile,
    carryoverBreakdown,
    derivedCarryoverAllocatedTotal,
  );
  const carryoverUndistributedBalance =
    derivedCarryoverTotalCollected - derivedCarryoverAllocatedTotal;
  const carryoverCompletedCycles =
    hasClosedCarryoverLoanRecords || guidedClosedLoans.length > 0
      ? guidedClosedLoans.length
      : carryoverProfile.completedLoanCycles;
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
  const totalCollections = selectedClientTransactions
    .filter((transaction) =>
      [
        "deposit",
        "loan_repayment",
        "share_purchase",
        "fee_payment",
        "investor_contribution",
      ].includes(transaction.type),
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const selectedClientInflow = selectedClientTransactions
    .filter((transaction) =>
      [
        "deposit",
        "loan_repayment",
        "share_purchase",
        "fee_payment",
        "investor_contribution",
      ].includes(transaction.type),
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const selectedClientOutflow = selectedClientTransactions
    .filter((transaction) => ["withdrawal", "loan_disbursement"].includes(transaction.type))
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const selectedClientNet = selectedClientInflow - selectedClientOutflow;
  const combinedCollections = totalCollections + derivedCarryoverTotalCollected;
  const combinedOutstandingBalance = totalBalance + carryoverBalance;
  const clientLifetimeNet = selectedClientNet + derivedCarryoverTotalCollected;
  const selectedClientTransactionTotals = [
    {
      label: "Deposits",
      value: selectedClientTransactions
        .filter((transaction) => transaction.type === "deposit")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    },
    {
      label: "Withdrawals",
      value: selectedClientTransactions
        .filter((transaction) => transaction.type === "withdrawal")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    },
    {
      label: "Loan repayments",
      value: selectedClientTransactions
        .filter((transaction) => transaction.type === "loan_repayment")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    },
    {
      label: "Shares",
      value: selectedClientTransactions
        .filter((transaction) => transaction.type === "share_purchase")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
    },
    {
      label: "Fees",
      value: selectedClientTransactions
        .filter((transaction) => transaction.type === "fee_payment")
        .reduce((sum, transaction) => sum + transaction.amount, 0),
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
  const todayIso = new Date().toISOString().slice(0, 10);
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
    if (
      editingFee.scope === "selected_members" &&
      (editingFee.selectedMemberIds?.length ?? 0) === 0
    ) {
      return toast.error("Pick at least one member for a selected-members fee.");
    }
    await saveFee({ data: editingFee });
    await reloadAppData();
    toast.success(creatingFee ? "Fee created" : "Fee updated");
    setEditingFee(null);
    setCreatingFee(false);
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
    setCarryoverProfile(
      hydrateCarryoverProfile(result.profile ?? blankCarryoverProfile(nextMemberId)),
    );
    setCarryoverLoans(result.loans);
    setCarryoverLoanDraft(blankCarryoverLoan(nextMemberId, result.loans.length + 1));
    setGuidedClosedLoans(result.loans.filter((loan) => loan.status === "closed" || loan.finished));
  }

  async function saveCarryoverProfileDraft() {
    if (!selectedClient) return;
    const nextGuidedLoans = guidedClosedLoans.map((loan, index) => {
      const summary = summarizeLegacyCarryoverLoan(loan, policySettings);
      return {
        ...loan,
        memberId: selectedClient.id,
        label: loan.label || `Completed loan ${index + 1}`,
        loanCycleNumber: Math.max(1, loan.loanCycleNumber || index + 1),
        paidToDate: summary.totalRepayment,
        dueDate: loan.dueDate ?? summary.dueDate,
        closedOn: loan.closedOn ?? summary.dueDate,
        status: "closed" as const,
        finished: true,
      };
    });

    for (const loan of nextGuidedLoans) {
      await saveCarryoverLoan({ data: loan });
    }

    const keptClosedLoanIds = new Set(
      nextGuidedLoans.map((loan) => loan.id).filter((loanId): loanId is string => Boolean(loanId)),
    );
    const removedClosedLoanIds = carryoverLoans
      .filter((loan) => loan.status === "closed" || loan.finished)
      .map((loan) => loan.id)
      .filter((loanId) => loanId && !keptClosedLoanIds.has(loanId));
    for (const loanId of removedClosedLoanIds) {
      await deleteCarryoverLoan({ data: { id: loanId } });
    }

    const recordedTotalDeposits = resolveRecordedCarryoverTotal(
      carryoverProfile,
      carryoverBreakdown,
      derivedCarryoverAllocatedTotal,
    );

    const nextBreakdown = {
      ...readCarryoverBreakdown(carryoverProfile.collectionBreakdown),
      totalDepositsRecorded: recordedTotalDeposits,
      purposePoolBalance: carryoverBreakdown.purposePoolBalance,
      feeBuckets: carryoverFeeBuckets,
    };

    await saveCarryoverProfile({
      data: {
        ...carryoverProfile,
        feesPaidTotal: carryoverFeeTotal,
        loanRepaymentsTotal: carryoverLoanRepaymentsRecorded,
        totalCollected: recordedTotalDeposits,
        pendingBalance: carryoverLoanSummaries.reduce(
          (sum, row) => sum + row.summary.totalOwedNow,
          0,
        ),
        completedLoanCycles: nextGuidedLoans.length,
        collectionBreakdown: nextBreakdown,
      },
    });
    await reloadAppData();
    await refreshCarryoverDetails(selectedClient.id);
    await refreshAllCarryoverLoans();
    toast.success("Carryover balances saved");
  }

  async function saveCarryoverLoanDraft() {
    if (!selectedClient) return;
    await saveCarryoverLoan({ data: carryoverLoanDraft });
    await refreshCarryoverDetails(selectedClient.id);
    await refreshAllCarryoverLoans();
    toast.success(carryoverLoanDraft.id ? "Carryover loan updated" : "Carryover loan saved");
  }

  async function resetSelectedClientCarryover() {
    if (!selectedClient || carryoverResetting) return;
    const confirmed = window.confirm(
      `Reset all carryover balances and loans for ${selectedClient.name}? The live member balances will be restored from the pre-carryover snapshot when available, otherwise from this client's transaction history.`,
    );
    if (!confirmed) return;

    setCarryoverResetting(true);
    try {
      const result = await resetCarryover({ data: { memberId: selectedClient.id } });
      await reloadAppData();
      await refreshCarryoverDetails(selectedClient.id);
      await refreshAllCarryoverLoans();
      toast.success(
        result.restoredFrom === "snapshot"
          ? "Carryover reset and pre-carryover balances restored."
          : "Carryover reset and balances rebuilt from transaction history.",
      );
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

  const membershipAmount = feeRows.find((fee) => fee.key === "membership")?.amount ?? 0;
  const cardAmount = feeRows.find((fee) => fee.key === "card")?.amount ?? 0;
  const stickerAmount = feeRows.find((fee) => fee.key === "sticker")?.amount ?? 0;

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
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          <StatCard
            label="Active Fees"
            value={activeFees.length}
            icon={<Wallet className="h-5 w-5" />}
          />
          <StatCard
            label="Penalty Rate"
            value={`${policySettings.percentages.penaltyDailyPct}%`}
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

        <div className="flex flex-wrap items-center gap-1 border-b border-border">
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
            <Section
              title="Mandatory fee heads"
              action={
                <button
                  onClick={() => {
                    setEditingFee(blankFee());
                    setCreatingFee(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add fee
                </button>
              }
            >
              <div className="grid gap-4 p-5 md:grid-cols-3">
                <StatCard label="Membership" value={fmtKES(membershipAmount)} />
                <StatCard label="Card" value={fmtKES(cardAmount)} />
                <StatCard label="Sticker" value={fmtKES(stickerAmount)} />
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
                    {feeRows.map((fee) => (
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
                          {fee.custom && (
                            <button
                              onClick={async () => {
                                await deleteFee({ data: { key: fee.key } });
                                await reloadAppData();
                                toast.success("Fee removed");
                              }}
                              className="ml-2 inline-flex items-center gap-1 rounded-md border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
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
                    >
                      {SCOPES.map((scope) => (
                        <option key={scope} value={scope}>
                          {scopeLabel(scope)}
                        </option>
                      ))}
                    </select>
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
                          The separate `New members only` audience will automatically target anyone
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
                      onClick={() => void saveFeeDraft()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    >
                      <Save className="h-4 w-4" />
                      Save
                    </button>
                    <button
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
            title="Fixed interest by repayment term"
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
                <div className="grid gap-4 md:grid-cols-3">
                  {STANDARD_POLICY_TERMS.map((days) => (
                    <NumberField
                      key={`standard-${days}`}
                      label={`${days} day interest %`}
                      value={interestDraft.standard[days]}
                      onChange={(value) =>
                        setInterestDraft((current) => ({
                          ...current,
                          standard: { ...current.standard, [days]: value },
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <div className="text-sm font-medium">Premium loans</div>
                <div className="grid gap-4 md:grid-cols-4">
                  {PREMIUM_POLICY_TERMS.map((days) => (
                    <NumberField
                      key={`premium-${days}`}
                      label={`${days} day interest %`}
                      value={interestDraft.premium[days]}
                      onChange={(value) =>
                        setInterestDraft((current) => ({
                          ...current,
                          premium: { ...current.premium, [days]: value },
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
              New loan applications use these fixed rates immediately. Existing loans keep the rate
              already stored on the loan record.
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
                  loan-member collections always branch into a daily savings leg and a loan
                  repayment leg in parallel.
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
                      placeholder="Search by name or member ID"
                      className="input"
                    />
                  </Field>
                  <Field label="Client record">
                    <select
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      className="input"
                    >
                      {filteredClients.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.id} - {member.name}
                        </option>
                      ))}
                    </select>
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
                        onClick={() => void saveCarryoverProfileDraft()}
                        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save carryover
                      </button>
                    </div>
                  }
                >
                  <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
                    <NumberField
                      label="Total deposits ever recorded"
                      value={derivedCarryoverTotalCollected}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          collectionBreakdown: {
                            ...readCarryoverBreakdown(current.collectionBreakdown),
                            totalDepositsRecorded: value,
                          },
                        }))
                      }
                    />
                    <NumberField
                      label="Savings balance"
                      value={carryoverProfile.savingsBalance}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({ ...current, savingsBalance: value }))
                      }
                    />
                    <NumberField
                      label="Share units"
                      value={carryoverProfile.shareUnits}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          shareUnits: Math.max(0, Math.floor(value)),
                        }))
                      }
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
                        Waterfall fee buckets
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={carryoverProfile.membershipFeePaid}
                            onChange={(event) =>
                              setCarryoverProfile((current) => ({
                                ...current,
                                membershipFeePaid: event.target.checked,
                                collectionBreakdown: {
                                  ...readCarryoverBreakdown(current.collectionBreakdown),
                                  feeBuckets: {
                                    ...readCarryoverBreakdown(current.collectionBreakdown)
                                      .feeBuckets,
                                    membership: event.target.checked ? membershipAmount : 0,
                                  },
                                },
                              }))
                            }
                          />
                          Membership fee ({fmtKES(membershipAmount)})
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={carryoverProfile.cardFeePaid}
                            onChange={(event) =>
                              setCarryoverProfile((current) => ({
                                ...current,
                                cardFeePaid: event.target.checked,
                                collectionBreakdown: {
                                  ...readCarryoverBreakdown(current.collectionBreakdown),
                                  feeBuckets: {
                                    ...readCarryoverBreakdown(current.collectionBreakdown)
                                      .feeBuckets,
                                    card: event.target.checked ? cardAmount : 0,
                                  },
                                },
                              }))
                            }
                          />
                          Card fee ({fmtKES(cardAmount)})
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={carryoverProfile.stickerFeePaid}
                            onChange={(event) =>
                              setCarryoverProfile((current) => ({
                                ...current,
                                stickerFeePaid: event.target.checked,
                                collectionBreakdown: {
                                  ...readCarryoverBreakdown(current.collectionBreakdown),
                                  feeBuckets: {
                                    ...readCarryoverBreakdown(current.collectionBreakdown)
                                      .feeBuckets,
                                    sticker: event.target.checked ? stickerAmount : 0,
                                  },
                                },
                              }))
                            }
                          />
                          Sticker fee ({fmtKES(stickerAmount)})
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={carryoverProfile.firstUpfrontPaid}
                            onChange={(event) =>
                              setCarryoverProfile((current) => ({
                                ...current,
                                firstUpfrontPaid: event.target.checked,
                              }))
                            }
                          />
                          First upfront already covered
                        </label>
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
                      <MetricRow label="Share value" value={fmtKES(carryoverShareValue)} />
                      <MetricRow label="Fee buckets total" value={fmtKES(carryoverFeeTotal)} />
                      <MetricRow
                        label="Loan repayments derived"
                        value={fmtKES(carryoverLoanRepaymentsRecorded)}
                      />
                      <MetricRow
                        label="Purpose pool"
                        value={fmtKES(carryoverBreakdown.purposePoolBalance)}
                      />
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4 md:col-span-2 xl:col-span-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">
                            Completed loans in redistribution flow
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Choose how many finished loan cycles to account for, then fill each tile
                            independently.
                          </div>
                        </div>
                        <select
                          value={guidedClosedLoans.length}
                          onChange={(event) => {
                            const count = Number(event.target.value);
                            setGuidedClosedLoans((current) =>
                              Array.from({ length: count }, (_, index) => {
                                const existingLoan = current[index];
                                return existingLoan
                                  ? {
                                      ...existingLoan,
                                      memberId: selectedClient.id,
                                      loanCycleNumber: index + 1,
                                      status: "closed",
                                      finished: true,
                                    }
                                  : {
                                      ...blankCarryoverLoan(selectedClient.id, index + 1),
                                      label: `Completed loan ${index + 1}`,
                                      status: "closed",
                                      finished: true,
                                    };
                              }),
                            );
                          }}
                          className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
                        >
                          {Array.from({ length: 11 }, (_, index) => index).map((count) => (
                            <option key={count} value={count}>
                              {count} loan{count === 1 ? "" : "s"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-4 grid gap-4 xl:grid-cols-2">
                        {guidedClosedLoans.map((loan, index) => (
                          <GuidedCompletedLoanCard
                            key={loan.id || `${selectedClient.id}-guided-${index}`}
                            index={index}
                            loan={loan}
                            summary={
                              guidedClosedLoanSummaries[index]?.summary ??
                              summarizeLegacyCarryoverLoan(loan, policySettings)
                            }
                            onChange={(nextLoan) =>
                              setGuidedClosedLoans((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? nextLoan : item,
                                ),
                              )
                            }
                          />
                        ))}
                        {guidedClosedLoans.length === 0 && (
                          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                            Set the completed-loan count above to expand the loan tiles.
                          </div>
                        )}
                      </div>
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
                      <select
                        value={carryoverLoanDraft.termDays}
                        onChange={(event) =>
                          setCarryoverLoanDraft((current) => ({
                            ...current,
                            termDays: Number(event.target.value) as 7 | 14 | 30 | 60 | 90,
                          }))
                        }
                        className="input"
                      >
                        {[7, 14, 30, 60, 90].map((days) => (
                          <option key={days} value={days}>
                            {days} days
                          </option>
                        ))}
                      </select>
                    </Field>
                    <NumberField
                      label="Interest rate override %"
                      value={carryoverLoanDraft.interestRatePct}
                      onChange={(value) =>
                        setCarryoverLoanDraft((current) => ({
                          ...current,
                          interestRatePct: value,
                        }))
                      }
                    />
                    <NumberField
                      label="Daily savings amount"
                      value={carryoverLoanDraft.dailySavingsAmount}
                      onChange={(value) =>
                        setCarryoverLoanDraft((current) => ({
                          ...current,
                          dailySavingsAmount: value,
                        }))
                      }
                    />
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
                      label="Amount already paid"
                      value={carryoverLoanDraft.paidToDate}
                      onChange={(value) =>
                        setCarryoverLoanDraft((current) => ({ ...current, paidToDate: value }))
                      }
                    />
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
                      <MetricCard label="Auto due date" value={carryoverLoanDraftSummary.dueDate} />
                      <MetricCard
                        label="Repayment total"
                        value={fmtKES(carryoverLoanDraftSummary.totalRepayment)}
                      />
                      <MetricCard
                        label="Fees and subscriptions"
                        value={fmtKES(carryoverLoanDraftSummary.feeChargesTotal)}
                      />
                      <MetricCard
                        label="Owed now"
                        value={fmtKES(carryoverLoanDraftSummary.totalOwedNow)}
                      />
                    </div>
                  </div>
                  <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
                    Start with principal, term, daily savings, start date, and amount already paid.
                    Leave the override rate at 0 to use the current policy rate for that term. The
                    balance, penalties, due date, and completion status are calculated from the
                    saved carryover loan record.
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
                            label="Penalty Estimate"
                            value={fmtKES(summary.estimatedPenaltyNow)}
                          />
                          <MetricCard
                            label="Savings Accrued"
                            value={fmtKES(summary.totalSavingsAccrued)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

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
    key: `custom_${Date.now()}`,
    label: "",
    amount: 0,
    permanence: "permanent",
    scope: "all",
    selectedMemberIds: [],
    effectiveFrom: new Date().toISOString().slice(0, 10),
    custom: true,
    updatedAt: new Date().toISOString(),
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
    loanCycleNumber: Math.max(1, cycleNumber),
    principal: 0,
    interestRatePct: 0,
    termDays: 30,
    dailySavingsAmount: 0,
    startDate: new Date().toISOString().slice(0, 10),
    paidToDate: 0,
    status: "active",
    finished: false,
    penaltyWaivedAmount: 0,
    feeBreakdown: normalizeLegacyCarryoverLoanFeeBreakdown({}, Math.max(1, cycleNumber)),
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
    return `${steps} -> Parallel split: daily savings waterfall + loan repayment remainder`;
  }
  if (rule.scenario === "member_without_loan") {
    return `${steps} -> Threshold tree: savings, then shares, then purpose pool`;
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

function GuidedCompletedLoanCard({
  index,
  loan,
  summary,
  onChange,
}: {
  index: number;
  loan: LegacyCarryoverLoan;
  summary: ReturnType<typeof summarizeLegacyCarryoverLoan>;
  onChange: (loan: LegacyCarryoverLoan) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4">
      <div className="mb-3 text-sm font-medium">Completed loan {index + 1}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Label">
          <input
            value={loan.label}
            onChange={(event) => onChange({ ...loan, label: event.target.value })}
            className="input"
          />
        </Field>
        <NumberField
          label="Net disbursed"
          value={loan.principal}
          onChange={(value) => onChange({ ...loan, principal: value })}
        />
        <Field label="Term days">
          <select
            value={loan.termDays}
            onChange={(event) =>
              onChange({
                ...loan,
                termDays: Number(event.target.value) as 7 | 14 | 30 | 60 | 90,
              })
            }
            className="input"
          >
            {[7, 14, 30, 60, 90].map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </Field>
        <NumberField
          label="Interest override %"
          value={loan.interestRatePct}
          onChange={(value) => onChange({ ...loan, interestRatePct: value })}
        />
        <NumberField
          label="Daily savings"
          value={loan.dailySavingsAmount}
          onChange={(value) => onChange({ ...loan, dailySavingsAmount: value })}
        />
        <CarryoverLoanFeeFields loan={loan} summary={summary} onChange={onChange} compact />
        <Field label="Start date">
          <input
            type="date"
            value={loan.startDate}
            onChange={(event) => onChange({ ...loan, startDate: event.target.value })}
            className="input"
          />
        </Field>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Loan repayment total" value={fmtKES(summary.totalRepayment)} />
        <MetricCard label="Fees and subscriptions" value={fmtKES(summary.feeChargesTotal)} />
        <MetricCard label="Daily savings accrued" value={fmtKES(summary.totalSavingsAccrued)} />
        <MetricCard label="Cash through cycle" value={fmtKES(summary.totalExpectedCollected)} />
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        The redistribution deducts the closed loan repayment total from the client record. The daily
        savings leg should still be reflected in savings, shares, or purpose pool above.
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
      <NumberField
        label="Membership fee"
        value={feeBreakdown.membershipFeeAmount ?? 0}
        disabled={oneTimeLocked}
        onChange={(value) => updateFee("membershipFeeAmount", value)}
      />
      <NumberField
        label="Card fee"
        value={feeBreakdown.cardFeeAmount ?? 0}
        disabled={oneTimeLocked}
        onChange={(value) => updateFee("cardFeeAmount", value)}
      />
      <NumberField
        label="Sticker fee"
        value={feeBreakdown.stickerFeeAmount ?? 0}
        disabled={oneTimeLocked}
        onChange={(value) => updateFee("stickerFeeAmount", value)}
      />
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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        disabled={disabled}
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
