import { isInvestorCategory, resolveMemberCategory } from "@/lib/membership";

export type FeeScope = "all" | "new_only" | "selected_members" | "loan_holders" | "investors";
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
    label: "Shop Sticker",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: "2026-01-01",
    scope: "all",
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
  isInvestor?: boolean;
};

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
  return isInvestorCategory(category);
}

export function feePolicyByKey(rows: FeePolicy[] | undefined, key: string) {
  return normalizeFeePolicies(rows).find((row) => row.key === key);
}
