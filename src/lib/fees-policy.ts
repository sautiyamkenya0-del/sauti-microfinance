import {
  isInvestorCategory,
  normalizeMemberTags,
  resolveMemberCategory,
  type MemberCategory,
} from "@/lib/membership";

export type FeeScope =
  | "all"
  | "new_only"
  | "selected_members"
  | "loan_holders"
  | "investors"
  | "financial_members"
  | "locomotive_members"
  | "stock_members"
  | "service_members"
  | "supplier_members";
export type FeePermanence = "permanent" | "semi";

export type FeePolicy = {
  key: string;
  label: string;
  amount: number;
  permanence: FeePermanence;
  durationDays?: number;
  effectiveFrom: string;
  scope: FeeScope;
  selectedMemberIds?: string[];
  custom?: boolean;
  notes?: string;
  updatedAt: string;
};

export const DEFAULT_FEE_POLICIES: FeePolicy[] = [
  {
    key: "membership",
    label: "Membership Fee",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: "2026-01-01",
    scope: "all",
    custom: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    key: "card",
    label: "Membership Card",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: "2026-01-01",
    scope: "all",
    custom: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    key: "sticker",
    label: "Sticker Fee",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: "2026-01-01",
    scope: "financial_members",
    custom: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    key: "fuel_buffer",
    label: "Fuel Buffer",
    amount: 1000,
    permanence: "permanent",
    effectiveFrom: "2026-01-01",
    scope: "locomotive_members",
    custom: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export function isFeeActive(p: FeePolicy): boolean {
  if (p.permanence === "permanent") return true;
  if (!p.durationDays) return true;
  const from = new Date(p.effectiveFrom).getTime();
  const ms = p.durationDays * 24 * 60 * 60 * 1000;
  return Date.now() <= from + ms;
}

export function scopeLabel(s: FeeScope): string {
  switch (s) {
    case "all":
      return "All members";
    case "new_only":
      return "New members only";
    case "selected_members":
      return "Selected members";
    case "loan_holders":
      return "Members with active loans";
    case "investors":
      return "Investors only";
    case "financial_members":
      return "Financial members only";
    case "locomotive_members":
      return "Locomotive members only";
    case "stock_members":
      return "Stock members only";
    case "service_members":
      return "Service members only";
    case "supplier_members":
      return "Supplier members only";
  }
}

function normalizeSelectedMemberIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.map((memberId) => String(memberId ?? "").trim()).filter(Boolean)),
  ].sort();
}

export function normalizeFeePolicies(rows?: FeePolicy[] | null) {
  const merged = new Map(DEFAULT_FEE_POLICIES.map((row) => [row.key, row]));
  for (const row of rows ?? []) {
    merged.set(row.key, {
      ...row,
      selectedMemberIds: normalizeSelectedMemberIds(row.selectedMemberIds),
    });
  }
  return Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function feePolicyAmount(
  rows: FeePolicy[] | undefined,
  key: string,
  fallback = 0,
  activeOnly = true,
) {
  const found = normalizeFeePolicies(rows).find((row) => row.key === key);
  if (!found) return fallback;
  if (activeOnly && !isFeeActive(found)) return fallback;
  return found.amount;
}

export type FeeTargetMember = {
  id: string;
  joinedAt?: string;
  category?: string;
  memberTags?: string[];
  isInvestor?: boolean;
};

function hasCategory(member: FeeTargetMember, category: MemberCategory) {
  return normalizeMemberTags(member.memberTags, member.category, member.isInvestor).includes(
    category,
  );
}

export function feePolicyAppliesToMember(
  policy: FeePolicy,
  member: FeeTargetMember,
  options?: {
    hasActiveLoan?: boolean;
    today?: string;
  },
) {
  if (!member?.id) return false;

  if (policy.scope === "all") return true;
  if (policy.scope === "selected_members") {
    return normalizeSelectedMemberIds(policy.selectedMemberIds).includes(member.id);
  }
  if (policy.scope === "new_only") {
    const joinedAt = String(member.joinedAt ?? "").slice(0, 10);
    const effectiveFrom = String(policy.effectiveFrom ?? "").slice(0, 10);
    return Boolean(joinedAt && effectiveFrom && joinedAt >= effectiveFrom);
  }
  if (policy.scope === "loan_holders") return options?.hasActiveLoan === true;

  const category = resolveMemberCategory(member.category, member.isInvestor);
  if (policy.scope === "financial_members") return hasCategory(member, "member");
  if (policy.scope === "locomotive_members") return hasCategory(member, "locomotive");
  if (policy.scope === "stock_members") return hasCategory(member, "stock");
  if (policy.scope === "service_members") return hasCategory(member, "service");
  if (policy.scope === "supplier_members") return hasCategory(member, "supplier");
  return isInvestorCategory(category);
}

export function feePolicyByKey(rows: FeePolicy[] | undefined, key: string) {
  return normalizeFeePolicies(rows).find((row) => row.key === key);
}
