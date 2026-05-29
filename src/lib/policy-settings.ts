export type PolicyLoanTerm = 7 | 14 | 30 | 60 | 90;
export type StandardPolicyLoanTerm = 7 | 14 | 30;
export type PremiumPolicyLoanTerm = 14 | 30 | 60 | 90;
export type PolicyLoanType = "standard" | "premium";

export const STANDARD_POLICY_TERMS: StandardPolicyLoanTerm[] = [7, 14, 30];
export const PREMIUM_POLICY_TERMS: PremiumPolicyLoanTerm[] = [14, 30, 60, 90];
export const ALL_POLICY_TERMS: PolicyLoanTerm[] = [7, 14, 30, 60, 90];

export type PolicyInterestRates = {
  standard: Record<StandardPolicyLoanTerm, number>;
  premium: Record<PremiumPolicyLoanTerm, number>;
};

export type PolicyPercentages = {
  processingPct: number;
  insurancePct: number;
  transactionCostPct: number;
  penaltyDailyPct: number;
  defaultPenaltyPct: number;
  firstUpfrontAmount: number;
  mandatorySavingsThreshold: number;
  mandatorySharesThreshold: number;
  roundOffStep: number;
  fuelBufferAmount: number;
  fuelChargeAmount: number;
  stockChargeAmount: number;
};

export type WaterfallScenario = "member_with_loan" | "member_without_loan" | "investor_only";

export type WaterfallDestination =
  | "membership_fee"
  | "card_fee"
  | "sticker_fee"
  | "penalties"
  | "active_loan_repayment"
  | "savings"
  | "investment";

export type WaterfallRule = {
  scenario: WaterfallScenario;
  steps: WaterfallDestination[];
};

export type TransactionFeeBand = {
  id: string;
  minAmount: number;
  maxAmount?: number;
  feeAmount: number;
  label?: string;
};

export type PolicySettings = {
  percentages: PolicyPercentages;
  interestRates: PolicyInterestRates;
  waterfallRules: WaterfallRule[];
  transactionFeeBands: TransactionFeeBand[];
};

export type PolicySettingKey =
  | "percentages"
  | "interest_rates"
  | "waterfall_rules"
  | "transaction_fee_bands";

export type PolicySettingRow = {
  key: string;
  label: string;
  value: unknown;
  notes?: string;
  updatedAt?: string;
};

export const POLICY_SETTING_LABELS: Record<PolicySettingKey, string> = {
  percentages: "Percentages and fixed values",
  interest_rates: "Interest rates by loan category",
  waterfall_rules: "Payment waterfall rules",
  transaction_fee_bands: "Transaction fee bands",
};

export const WATERFALL_SCENARIO_LABELS: Record<WaterfallScenario, string> = {
  member_with_loan: "Member with loan",
  member_without_loan: "Member without loan",
  investor_only: "Investor-only account",
};

export const WATERFALL_DESTINATION_LABELS: Record<WaterfallDestination, string> = {
  membership_fee: "Membership fee",
  card_fee: "Membership card",
  sticker_fee: "Sticker fee",
  penalties: "Outstanding penalties",
  active_loan_repayment: "Active loan repayment",
  savings: "Daily compliance contribution",
  investment: "Investment top-up",
};

export const DEFAULT_POLICY_SETTINGS: PolicySettings = {
  percentages: {
    processingPct: 2,
    insurancePct: 1.5,
    transactionCostPct: 0,
    penaltyDailyPct: 5,
    defaultPenaltyPct: 2,
    firstUpfrontAmount: 500,
    mandatorySavingsThreshold: 5000,
    mandatorySharesThreshold: 3000,
    roundOffStep: 5,
    fuelBufferAmount: 3000,
    fuelChargeAmount: 100,
    stockChargeAmount: 100,
  },
  interestRates: {
    standard: {
      7: 10,
      14: 10,
      30: 10,
    },
    premium: {
      14: 15,
      30: 15,
      60: 15,
      90: 15,
    },
  },
  waterfallRules: [
    {
      scenario: "member_with_loan",
      steps: ["membership_fee", "card_fee", "sticker_fee", "penalties"],
    },
    {
      scenario: "member_without_loan",
      steps: ["membership_fee", "card_fee", "sticker_fee", "penalties"],
    },
    {
      scenario: "investor_only",
      steps: ["investment"],
    },
  ],
  transactionFeeBands: [
    {
      id: "tx-001",
      minAmount: 0,
      maxAmount: 100,
      feeAmount: 0,
      label: "0 - 100",
    },
    {
      id: "tx-002",
      minAmount: 101,
      maxAmount: 500,
      feeAmount: 7,
      label: "101 - 500",
    },
    {
      id: "tx-003",
      minAmount: 501,
      maxAmount: 1000,
      feeAmount: 13,
      label: "501 - 1,000",
    },
    {
      id: "tx-004",
      minAmount: 1001,
      maxAmount: 1500,
      feeAmount: 23,
      label: "1,001 - 1,500",
    },
    {
      id: "tx-005",
      minAmount: 1501,
      maxAmount: 2500,
      feeAmount: 33,
      label: "1,501 - 2,500",
    },
    {
      id: "tx-006",
      minAmount: 2501,
      maxAmount: 3500,
      feeAmount: 53,
      label: "2,501 - 3,500",
    },
    {
      id: "tx-007",
      minAmount: 3501,
      maxAmount: 5000,
      feeAmount: 57,
      label: "3,501 - 5,000",
    },
    {
      id: "tx-008",
      minAmount: 5001,
      maxAmount: 7500,
      feeAmount: 78,
      label: "5,001 - 7,500",
    },
    {
      id: "tx-009",
      minAmount: 7501,
      maxAmount: 10000,
      feeAmount: 90,
      label: "7,501 - 10,000",
    },
    {
      id: "tx-010",
      minAmount: 10001,
      maxAmount: 15000,
      feeAmount: 100,
      label: "10,001 - 15,000",
    },
    {
      id: "tx-011",
      minAmount: 15001,
      maxAmount: 20000,
      feeAmount: 105,
      label: "15,001 - 20,000",
    },
    {
      id: "tx-012",
      minAmount: 20001,
      maxAmount: 35000,
      feeAmount: 108,
      label: "20,001 - 35,000",
    },
    {
      id: "tx-013",
      minAmount: 35001,
      maxAmount: 50000,
      feeAmount: 108,
      label: "35,001 - 50,000",
    },
    {
      id: "tx-014",
      minAmount: 50001,
      maxAmount: 250000,
      feeAmount: 108,
      label: "50,001 - 250,000",
    },
  ],
};

let activePolicySettings: PolicySettings = clonePolicySettings(DEFAULT_POLICY_SETTINGS);

export function clonePolicySettings(settings: PolicySettings): PolicySettings {
  return {
    percentages: { ...settings.percentages },
    interestRates: {
      standard: { ...settings.interestRates.standard },
      premium: { ...settings.interestRates.premium },
    },
    waterfallRules: settings.waterfallRules.map((rule) => ({
      scenario: rule.scenario,
      steps: [...rule.steps],
    })),
    transactionFeeBands: settings.transactionFeeBands.map((band) => ({
      ...band,
    })),
  };
}

function toFiniteNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWaterfallScenario(value: unknown): value is WaterfallScenario {
  return (
    value === "member_with_loan" || value === "member_without_loan" || value === "investor_only"
  );
}

function isWaterfallDestination(value: unknown): value is WaterfallDestination {
  return (
    value === "membership_fee" ||
    value === "card_fee" ||
    value === "sticker_fee" ||
    value === "penalties" ||
    value === "active_loan_repayment" ||
    value === "savings" ||
    value === "investment"
  );
}

function normalizeTransactionFeeBandId(value: unknown, index: number) {
  const raw = String(value ?? "").trim();
  return raw || `tx-band-${index + 1}`;
}

function sanitizeTransactionFeeBands(value: unknown): TransactionFeeBand[] {
  const bands = Array.isArray(value) ? value : [];
  const sanitized: TransactionFeeBand[] = [];
  bands.forEach((candidate, index) => {
    if (!isPlainObject(candidate)) return;
    const minAmount = Math.max(0, Math.floor(toFiniteNumber(candidate.minAmount, 0)));
    const rawMax = candidate.maxAmount;
    const maxAmount =
      rawMax == null || rawMax === ""
        ? undefined
        : Math.max(minAmount, Math.floor(toFiniteNumber(rawMax, minAmount)));
    sanitized.push({
      id: normalizeTransactionFeeBandId(candidate.id, index),
      minAmount,
      maxAmount,
      feeAmount: Math.max(0, toFiniteNumber(candidate.feeAmount, 0)),
      label: String(candidate.label ?? "").trim() || undefined,
    });
  });
  return sanitized.sort((a, b) => a.minAmount - b.minAmount);
}

function sanitizeSteps(
  scenario: WaterfallScenario,
  value: unknown,
  fallback: WaterfallDestination[],
): WaterfallDestination[] {
  const allowed = new Set(waterfallOptionsForScenario(scenario));
  const seen = new Set<WaterfallDestination>();
  const steps = Array.isArray(value) ? value : [];
  const next = steps.filter(isWaterfallDestination).filter((step) => {
    if (!allowed.has(step) || seen.has(step)) return false;
    seen.add(step);
    return true;
  });
  return next.length > 0 ? next : [...fallback];
}

export function waterfallOptionsForScenario(scenario: WaterfallScenario): WaterfallDestination[] {
  if (scenario === "member_with_loan") {
    return ["membership_fee", "card_fee", "sticker_fee", "penalties"];
  }
  if (scenario === "member_without_loan") {
    return ["membership_fee", "card_fee", "sticker_fee", "penalties"];
  }
  return ["investment"];
}

function sanitizeInterestRates(value: unknown): PolicyInterestRates {
  if (!isPlainObject(value)) {
    return {
      standard: { ...DEFAULT_POLICY_SETTINGS.interestRates.standard },
      premium: { ...DEFAULT_POLICY_SETTINGS.interestRates.premium },
    };
  }

  const standardCandidate = isPlainObject(value.standard) ? value.standard : value;
  const premiumCandidate = isPlainObject(value.premium) ? value.premium : value;

  return {
    standard: {
      7: Math.max(
        0,
        toFiniteNumber(standardCandidate["7"], DEFAULT_POLICY_SETTINGS.interestRates.standard[7]),
      ),
      14: Math.max(
        0,
        toFiniteNumber(standardCandidate["14"], DEFAULT_POLICY_SETTINGS.interestRates.standard[14]),
      ),
      30: Math.max(
        0,
        toFiniteNumber(standardCandidate["30"], DEFAULT_POLICY_SETTINGS.interestRates.standard[30]),
      ),
    },
    premium: {
      14: Math.max(
        0,
        toFiniteNumber(premiumCandidate["14"], DEFAULT_POLICY_SETTINGS.interestRates.premium[14]),
      ),
      30: Math.max(
        0,
        toFiniteNumber(premiumCandidate["30"], DEFAULT_POLICY_SETTINGS.interestRates.premium[30]),
      ),
      60: Math.max(
        0,
        toFiniteNumber(premiumCandidate["60"], DEFAULT_POLICY_SETTINGS.interestRates.premium[60]),
      ),
      90: Math.max(
        0,
        toFiniteNumber(premiumCandidate["90"], DEFAULT_POLICY_SETTINGS.interestRates.premium[90]),
      ),
    },
  };
}

export function mergePolicySettings(rows?: PolicySettingRow[] | null): PolicySettings {
  const next = clonePolicySettings(DEFAULT_POLICY_SETTINGS);
  const byKey = new Map((rows ?? []).map((row) => [row.key, row]));

  const percentagesRow = byKey.get("percentages");
  if (percentagesRow && isPlainObject(percentagesRow.value)) {
    next.percentages = {
      processingPct: toFiniteNumber(
        percentagesRow.value.processingPct,
        DEFAULT_POLICY_SETTINGS.percentages.processingPct,
      ),
      insurancePct: toFiniteNumber(
        percentagesRow.value.insurancePct,
        DEFAULT_POLICY_SETTINGS.percentages.insurancePct,
      ),
      transactionCostPct: toFiniteNumber(
        percentagesRow.value.transactionCostPct,
        DEFAULT_POLICY_SETTINGS.percentages.transactionCostPct,
      ),
      penaltyDailyPct: toFiniteNumber(
        percentagesRow.value.penaltyDailyPct,
        DEFAULT_POLICY_SETTINGS.percentages.penaltyDailyPct,
      ),
      defaultPenaltyPct: toFiniteNumber(
        percentagesRow.value.defaultPenaltyPct,
        DEFAULT_POLICY_SETTINGS.percentages.defaultPenaltyPct,
      ),
      firstUpfrontAmount: toFiniteNumber(
        percentagesRow.value.firstUpfrontAmount,
        DEFAULT_POLICY_SETTINGS.percentages.firstUpfrontAmount,
      ),
      mandatorySavingsThreshold: toFiniteNumber(
        percentagesRow.value.mandatorySavingsThreshold,
        DEFAULT_POLICY_SETTINGS.percentages.mandatorySavingsThreshold,
      ),
      mandatorySharesThreshold: toFiniteNumber(
        percentagesRow.value.mandatorySharesThreshold,
        DEFAULT_POLICY_SETTINGS.percentages.mandatorySharesThreshold,
      ),
      roundOffStep: Math.max(
        1,
        Math.round(
          toFiniteNumber(
            percentagesRow.value.roundOffStep,
            DEFAULT_POLICY_SETTINGS.percentages.roundOffStep,
          ),
        ),
      ),
      fuelBufferAmount: toFiniteNumber(
        percentagesRow.value.fuelBufferAmount,
        DEFAULT_POLICY_SETTINGS.percentages.fuelBufferAmount,
      ),
      fuelChargeAmount: toFiniteNumber(
        percentagesRow.value.fuelChargeAmount,
        DEFAULT_POLICY_SETTINGS.percentages.fuelChargeAmount,
      ),
      stockChargeAmount: toFiniteNumber(
        percentagesRow.value.stockChargeAmount,
        DEFAULT_POLICY_SETTINGS.percentages.stockChargeAmount,
      ),
    };
  }

  const interestRow = byKey.get("interest_rates");
  if (interestRow) {
    next.interestRates = sanitizeInterestRates(interestRow.value);
  }

  const waterfallRow = byKey.get("waterfall_rules");
  if (waterfallRow && Array.isArray(waterfallRow.value)) {
    const rulesByScenario = new Map<WaterfallScenario, WaterfallRule>();
    for (const candidate of waterfallRow.value) {
      if (!isPlainObject(candidate) || !isWaterfallScenario(candidate.scenario)) continue;
      const fallback =
        DEFAULT_POLICY_SETTINGS.waterfallRules.find((rule) => rule.scenario === candidate.scenario)
          ?.steps ?? [];
      rulesByScenario.set(candidate.scenario, {
        scenario: candidate.scenario,
        steps: sanitizeSteps(candidate.scenario, candidate.steps, fallback),
      });
    }
    next.waterfallRules = DEFAULT_POLICY_SETTINGS.waterfallRules.map(
      (rule) =>
        rulesByScenario.get(rule.scenario) ?? {
          scenario: rule.scenario,
          steps: [...rule.steps],
        },
    );
  }

  const transactionFeeBandsRow = byKey.get("transaction_fee_bands");
  if (transactionFeeBandsRow && Array.isArray(transactionFeeBandsRow.value)) {
    const nextBands = sanitizeTransactionFeeBands(transactionFeeBandsRow.value);
    if (nextBands.length > 0) {
      next.transactionFeeBands = nextBands;
    }
  }

  return next;
}

export function policySettingsRowsFromConfig(settings: PolicySettings): PolicySettingRow[] {
  return [
    {
      key: "percentages",
      label: POLICY_SETTING_LABELS.percentages,
      value: { ...settings.percentages },
    },
    {
      key: "interest_rates",
      label: POLICY_SETTING_LABELS.interest_rates,
      value: {
        standard: {
          7: settings.interestRates.standard[7],
          14: settings.interestRates.standard[14],
          30: settings.interestRates.standard[30],
        },
        premium: {
          14: settings.interestRates.premium[14],
          30: settings.interestRates.premium[30],
          60: settings.interestRates.premium[60],
          90: settings.interestRates.premium[90],
        },
      },
    },
    {
      key: "waterfall_rules",
      label: POLICY_SETTING_LABELS.waterfall_rules,
      value: settings.waterfallRules.map((rule) => ({
        scenario: rule.scenario,
        steps: [...rule.steps],
      })),
    },
    {
      key: "transaction_fee_bands",
      label: POLICY_SETTING_LABELS.transaction_fee_bands,
      value: settings.transactionFeeBands.map((band) => ({
        id: band.id,
        minAmount: band.minAmount,
        maxAmount: band.maxAmount ?? null,
        feeAmount: band.feeAmount,
        label: band.label ?? "",
      })),
    },
  ];
}

export function setActivePolicySettings(settings: PolicySettings) {
  activePolicySettings = clonePolicySettings(settings);
}

export function getActivePolicySettings() {
  return activePolicySettings;
}

export function waterfallRuleForScenario(
  scenario: WaterfallScenario,
  settings: PolicySettings = activePolicySettings,
) {
  return (
    settings.waterfallRules.find((rule) => rule.scenario === scenario) ??
    DEFAULT_POLICY_SETTINGS.waterfallRules.find((rule) => rule.scenario === scenario) ?? {
      scenario,
      steps: waterfallOptionsForScenario(scenario),
    }
  );
}

export function transactionFeeForAmount(
  amount: number,
  settings: PolicySettings = activePolicySettings,
) {
  const normalizedAmount = Math.max(0, Number(amount ?? 0));
  const bands = settings.transactionFeeBands
    .map((band) => ({
      ...band,
      minAmount: Math.max(0, Math.floor(Number(band.minAmount ?? 0))),
      maxAmount:
        band.maxAmount == null ? undefined : Math.max(0, Math.floor(Number(band.maxAmount ?? 0))),
      feeAmount: Math.max(0, Number(band.feeAmount ?? 0)),
    }))
    .sort((a, b) => a.minAmount - b.minAmount);

  for (const band of bands) {
    if (normalizedAmount < band.minAmount) continue;
    if (band.maxAmount != null && normalizedAmount > band.maxAmount) continue;
    return band.feeAmount;
  }

  const openEndedBand = [...bands].reverse().find((band) => band.maxAmount == null);
  if (openEndedBand && normalizedAmount >= openEndedBand.minAmount) {
    return openEndedBand.feeAmount;
  }

  return 0;
}

export function normalizePolicyTermDays(
  termDays?: number,
  loanType?: PolicyLoanType,
): PolicyLoanTerm {
  const normalized = Math.max(0, Math.floor(Number(termDays ?? 0)));
  const terms =
    loanType === "standard"
      ? STANDARD_POLICY_TERMS
      : loanType === "premium"
        ? PREMIUM_POLICY_TERMS
        : ALL_POLICY_TERMS;

  for (const term of terms) {
    if (normalized <= term) return term;
  }

  return terms[terms.length - 1];
}

export function policyInterestRateForTerm(
  termDays: number | undefined,
  loanType: PolicyLoanType,
  settings: PolicySettings = activePolicySettings,
) {
  const bucket = normalizePolicyTermDays(termDays, loanType);
  if (loanType === "standard") {
    return settings.interestRates.standard[bucket as StandardPolicyLoanTerm];
  }
  return settings.interestRates.premium[bucket as PremiumPolicyLoanTerm];
}
