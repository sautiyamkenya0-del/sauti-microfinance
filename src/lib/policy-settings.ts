export type PolicyLoanTerm = 7 | 14 | 30 | 60 | 90;

export type PolicyPercentages = {
  processingPct: number;
  insurancePct: number;
  transactionCostPct: number;
  penaltyDailyPct: number;
  defaultPenaltyPct: number;
  firstUpfrontAmount: number;
  mandatorySavingsThreshold: number;
  roundOffStep: number;
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

export type PolicySettings = {
  percentages: PolicyPercentages;
  interestRates: Record<PolicyLoanTerm, number>;
  waterfallRules: WaterfallRule[];
};

export type PolicySettingKey = "percentages" | "interest_rates" | "waterfall_rules";

export type PolicySettingRow = {
  key: string;
  label: string;
  value: unknown;
  notes?: string;
  updatedAt?: string;
};

export const POLICY_SETTING_LABELS: Record<PolicySettingKey, string> = {
  percentages: "Percentages and fixed values",
  interest_rates: "Interest rates by term",
  waterfall_rules: "Payment waterfall rules",
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
  savings: "Savings deposit",
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
    mandatorySavingsThreshold: 1000,
    roundOffStep: 1,
  },
  interestRates: {
    7: 10,
    14: 15,
    30: 20,
    60: 25,
    90: 30,
  },
  waterfallRules: [
    {
      scenario: "member_with_loan",
      steps: [
        "membership_fee",
        "card_fee",
        "sticker_fee",
        "penalties",
        "active_loan_repayment",
        "savings",
      ],
    },
    {
      scenario: "member_without_loan",
      steps: ["membership_fee", "card_fee", "sticker_fee", "penalties", "savings"],
    },
    {
      scenario: "investor_only",
      steps: ["investment"],
    },
  ],
};

let activePolicySettings: PolicySettings = clonePolicySettings(DEFAULT_POLICY_SETTINGS);

export function clonePolicySettings(settings: PolicySettings): PolicySettings {
  return {
    percentages: { ...settings.percentages },
    interestRates: { ...settings.interestRates },
    waterfallRules: settings.waterfallRules.map((rule) => ({
      scenario: rule.scenario,
      steps: [...rule.steps],
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
  return value === "member_with_loan" || value === "member_without_loan" || value === "investor_only";
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

export function waterfallOptionsForScenario(
  scenario: WaterfallScenario,
): WaterfallDestination[] {
  if (scenario === "member_with_loan") {
    return [
      "membership_fee",
      "card_fee",
      "sticker_fee",
      "penalties",
      "active_loan_repayment",
      "savings",
    ];
  }
  if (scenario === "member_without_loan") {
    return ["membership_fee", "card_fee", "sticker_fee", "penalties", "savings"];
  }
  return ["investment"];
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
      roundOffStep: Math.max(
        1,
        Math.round(
          toFiniteNumber(
            percentagesRow.value.roundOffStep,
            DEFAULT_POLICY_SETTINGS.percentages.roundOffStep,
          ),
        ),
      ),
    };
  }

  const interestRow = byKey.get("interest_rates");
  if (interestRow && isPlainObject(interestRow.value)) {
    next.interestRates = {
      7: toFiniteNumber(interestRow.value["7"], DEFAULT_POLICY_SETTINGS.interestRates[7]),
      14: toFiniteNumber(interestRow.value["14"], DEFAULT_POLICY_SETTINGS.interestRates[14]),
      30: toFiniteNumber(interestRow.value["30"], DEFAULT_POLICY_SETTINGS.interestRates[30]),
      60: toFiniteNumber(interestRow.value["60"], DEFAULT_POLICY_SETTINGS.interestRates[60]),
      90: toFiniteNumber(interestRow.value["90"], DEFAULT_POLICY_SETTINGS.interestRates[90]),
    };
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
        7: settings.interestRates[7],
        14: settings.interestRates[14],
        30: settings.interestRates[30],
        60: settings.interestRates[60],
        90: settings.interestRates[90],
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
