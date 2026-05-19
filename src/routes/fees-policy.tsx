import {
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
  Save,
  Target,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import {
  deleteFeePolicyRecord,
  deleteMemberCarryoverLoanRecord,
  upsertMemberCarryoverLoanRecord,
  upsertMemberCarryoverProfileRecord,
  upsertFeePolicyRecord,
  upsertPolicySettingRecord,
  waivePenaltyRecord,
} from "@/lib/app-data.functions";
import {
  type LegacyCarryoverLoan,
  type LegacyCarryoverProfile,
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
import { loadMemberCarryover } from "@/lib/runtime-data.functions";
import { fmtKES, loanSummary, useStore } from "@/lib/store";

type PolicyCenterTab = "fees" | "percentages" | "interest" | "waterfall" | "clients" | "targets";

type TargetDraft = {
  id?: string;
  metric: TargetMetric;
  period: TargetPeriod;
  expectedValue: number;
  startOn: string;
  notes: string;
};

const SCOPES: FeeScope[] = ["all", "new_only", "loan_holders", "investors"];
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
    transactions,
    reloadAppData,
  } = useStore();
  const saveFee = useServerFn(upsertFeePolicyRecord);
  const deleteFee = useServerFn(deleteFeePolicyRecord);
  const savePolicySetting = useServerFn(upsertPolicySettingRecord);
  const loadCarryover = useServerFn(loadMemberCarryover);
  const saveCarryoverProfile = useServerFn(upsertMemberCarryoverProfileRecord);
  const saveCarryoverLoan = useServerFn(upsertMemberCarryoverLoanRecord);
  const deleteCarryoverLoan = useServerFn(deleteMemberCarryoverLoanRecord);
  const waivePenalty = useServerFn(waivePenaltyRecord);
  const { rows: targetRows, upsertTarget, removeTarget } = usePerformanceTargetActions();

  const [tab, setTab] = useState<PolicyCenterTab>("fees");
  const [editingFee, setEditingFee] = useState<FeePolicy | null>(null);
  const [creatingFee, setCreatingFee] = useState(false);
  const [percentagesDraft, setPercentagesDraft] = useState(policySettings.percentages);
  const [interestDraft, setInterestDraft] = useState(policySettings.interestRates);
  const [waterfallDraft, setWaterfallDraft] = useState(policySettings.waterfallRules);
  const [waterfallScenario, setWaterfallScenario] = useState<WaterfallScenario>("member_with_loan");
  const [clientQuery, setClientQuery] = useState("");
  const memberAccounts = useMemo(
    () => members.filter((member) => member.category !== "investor"),
    [members],
  );
  const [clientId, setClientId] = useState<string>(memberAccounts[0]?.id ?? "");
  const [targetDraft, setTargetDraft] = useState<TargetDraft>(() => blankTarget());
  const [carryoverLoading, setCarryoverLoading] = useState(false);
  const [carryoverProfile, setCarryoverProfile] = useState<LegacyCarryoverProfile>(() =>
    blankCarryoverProfile(""),
  );
  const [carryoverLoans, setCarryoverLoans] = useState<LegacyCarryoverLoan[]>([]);
  const [carryoverLoanDraft, setCarryoverLoanDraft] = useState<LegacyCarryoverLoan>(() =>
    blankCarryoverLoan("", 1),
  );
  const [waiverNote, setWaiverNote] = useState("");
  const [waiverAmounts, setWaiverAmounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setPercentagesDraft(policySettings.percentages);
    setInterestDraft(policySettings.interestRates);
    setWaterfallDraft(policySettings.waterfallRules);
  }, [policySettings]);

  useEffect(() => {
    if (!clientId && memberAccounts[0]?.id) setClientId(memberAccounts[0].id);
  }, [clientId, memberAccounts]);

  useEffect(() => {
    if (!clientId) {
      setCarryoverProfile(blankCarryoverProfile(""));
      setCarryoverLoans([]);
      setCarryoverLoanDraft(blankCarryoverLoan("", 1));
      return;
    }

    let active = true;
    setCarryoverLoading(true);
    loadCarryover({ data: { memberId: clientId } })
      .then((result) => {
        if (!active) return;
        const profile = result.profile ?? blankCarryoverProfile(clientId);
        setCarryoverProfile(profile);
        setCarryoverLoans(result.loans);
        setCarryoverLoanDraft(blankCarryoverLoan(clientId, result.loans.length + 1));
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
  const combinedCollections = totalCollections + carryoverProfile.totalCollected;
  const combinedOutstandingBalance = totalBalance + carryoverBalance;
  const clientRating = selectedClient
    ? buildClientRating(selectedClient, selectedClientLoans, selectedClientPenalties)
    : null;

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
    await saveFee({ data: editingFee });
    await reloadAppData();
    toast.success(creatingFee ? "Fee created" : "Fee updated");
    setEditingFee(null);
    setCreatingFee(false);
  }

  async function persistPolicySettings(
    key: "percentages" | "interest_rates" | "waterfall_rules",
    value: unknown,
    message: string,
  ) {
    await savePolicySetting({ data: { key, value } });
    await reloadAppData();
    toast.success(message);
  }

  async function refreshCarryoverDetails(nextMemberId: string) {
    const result = await loadCarryover({ data: { memberId: nextMemberId } });
    setCarryoverProfile(result.profile ?? blankCarryoverProfile(nextMemberId));
    setCarryoverLoans(result.loans);
    setCarryoverLoanDraft(blankCarryoverLoan(nextMemberId, result.loans.length + 1));
  }

  async function saveCarryoverProfileDraft() {
    if (!selectedClient) return;
    await saveCarryoverProfile({ data: carryoverProfile });
    await reloadAppData();
    await refreshCarryoverDetails(selectedClient.id);
    toast.success("Carryover balances saved");
  }

  async function saveCarryoverLoanDraft() {
    if (!selectedClient) return;
    await saveCarryoverLoan({ data: carryoverLoanDraft });
    await refreshCarryoverDetails(selectedClient.id);
    toast.success(carryoverLoanDraft.id ? "Carryover loan updated" : "Carryover loan saved");
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
            label="Default Upfront"
            value={fmtKES(policySettings.percentages.firstUpfrontAmount)}
            icon={<Save className="h-5 w-5" />}
          />
          <StatCard
            label="Live Targets"
            value={enrichedTargets.length}
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
                        <td>{scopeLabel(fee.scope)}</td>
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
                        setEditingFee({ ...editingFee, scope: event.target.value as FeeScope })
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
            title="Percentages and fixed values"
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
                label="First Upfront (KES)"
                value={percentagesDraft.firstUpfrontAmount}
                onChange={(value) =>
                  setPercentagesDraft((current) => ({ ...current, firstUpfrontAmount: value }))
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
            <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
              These values now drive loan deductions, penalty previews, first-upfront prompts, and
              the M-Pesa round-off behavior across the app.
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
            <div className="grid gap-4 p-5 md:grid-cols-5">
              {[7, 14, 30, 60, 90].map((days) => (
                <NumberField
                  key={days}
                  label={`${days} day interest %`}
                  value={interestDraft[days as keyof typeof interestDraft]}
                  onChange={(value) =>
                    setInterestDraft((current) => ({
                      ...current,
                      [days]: value,
                    }))
                  }
                />
              ))}
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
                  The second dropdowns only show destinations allowed for the selected scenario.
                  This lets the flow change when you switch between a client with a loan, without a
                  loan, or an investor-only account.
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                  <div className="mb-1 font-medium text-foreground">Current path</div>
                  <div className="text-muted-foreground">
                    {currentWaterfall.steps
                      .map((step) => WATERFALL_DESTINATION_LABELS[step])
                      .join(" -> ")}
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
                </div>

                <Section title="Client balances and history">
                  <div className="grid gap-6 p-5 lg:grid-cols-[280px,1fr]">
                    <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4 text-sm">
                      <MetricRow label="Savings" value={fmtKES(selectedClient.savingsBalance)} />
                      <MetricRow label="Shares" value={`${selectedClient.shares} units`} />
                      <MetricRow label="Member ID" value={selectedClient.id} />
                      <MetricRow label="Phone" value={selectedClient.phone} />
                      <MetricRow label="Joined" value={selectedClient.joinedAt} />
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
                    <button
                      onClick={() => void saveCarryoverProfileDraft()}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save carryover
                    </button>
                  }
                >
                  <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
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
                      label="Fees paid total"
                      value={carryoverProfile.feesPaidTotal}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({ ...current, feesPaidTotal: value }))
                      }
                    />
                    <NumberField
                      label="Loan repayments total"
                      value={carryoverProfile.loanRepaymentsTotal}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          loanRepaymentsTotal: value,
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
                    <NumberField
                      label="Total collected"
                      value={carryoverProfile.totalCollected}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({ ...current, totalCollected: value }))
                      }
                    />
                    <NumberField
                      label="Pending balance"
                      value={carryoverProfile.pendingBalance}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({ ...current, pendingBalance: value }))
                      }
                    />
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
                    <NumberField
                      label="Completed loan cycles"
                      value={carryoverProfile.completedLoanCycles}
                      onChange={(value) =>
                        setCarryoverProfile((current) => ({
                          ...current,
                          completedLoanCycles: Math.max(0, Math.floor(value)),
                        }))
                      }
                    />
                    <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={carryoverProfile.membershipFeePaid}
                          onChange={(event) =>
                            setCarryoverProfile((current) => ({
                              ...current,
                              membershipFeePaid: event.target.checked,
                            }))
                          }
                        />
                        Membership fee already paid
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={carryoverProfile.cardFeePaid}
                          onChange={(event) =>
                            setCarryoverProfile((current) => ({
                              ...current,
                              cardFeePaid: event.target.checked,
                            }))
                          }
                        />
                        Card fee already paid
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={carryoverProfile.stickerFeePaid}
                          onChange={(event) =>
                            setCarryoverProfile((current) => ({
                              ...current,
                              stickerFeePaid: event.target.checked,
                            }))
                          }
                        />
                        Sticker fee already paid
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
                    Saving carryover balances also updates the member's live savings, share units,
                    and fee-status flags so the current system reflects the corrected starting
                    position.
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
                      label="Interest rate %"
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
                    <Field label="Due date">
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
                  </div>
                  <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
                    Use this like the simulator: principal + days + daily savings + amount already
                    paid. If the loan is not finished, the system shows the remaining balance,
                    arrears, penalty estimate, and what is owed now.
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
            <Section title="Create or edit progressive target">
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
                          No targets saved yet.
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
    effectiveFrom: new Date().toISOString().slice(0, 10),
    custom: true,
    updatedAt: new Date().toISOString(),
  };
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
    collectionBreakdown: {},
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
  };
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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
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
