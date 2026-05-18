export type FeeScope = "all" | "new_only" | "loan_holders" | "investors";
export type FeePermanence = "permanent" | "semi";

export type FeePolicy = {
  key: string;
  label: string;
  amount: number;
  permanence: FeePermanence;
  durationDays?: number;
  effectiveFrom: string;
  scope: FeeScope;
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
  return s === "all"
    ? "All members"
    : s === "new_only"
      ? "New members only"
      : s === "loan_holders"
        ? "Members with loans"
        : "Investors";
}

export function normalizeFeePolicies(rows?: FeePolicy[] | null) {
  const merged = new Map(DEFAULT_FEE_POLICIES.map((row) => [row.key, row]));
  for (const row of rows ?? []) {
    merged.set(row.key, row);
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
