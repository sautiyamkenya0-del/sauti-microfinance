/**
 * Director-controlled fee policy. Stored in localStorage so the demo
 * persists without a backend. Each fee has:
 *   - amount (KES)
 *   - permanence: "permanent" | "semi" (with durationDays + effectiveFrom)
 *   - scope: who the new amount applies to
 */
import { useEffect, useState } from "react";

export type FeeScope = "all" | "new_only" | "loan_holders" | "investors";
export type FeePermanence = "permanent" | "semi";

export type FeePolicy = {
  key: string; // stable key e.g. "membership", "card", "sticker"
  label: string;
  amount: number;
  permanence: FeePermanence;
  durationDays?: number; // when semi
  effectiveFrom: string; // ISO date
  scope: FeeScope;
  custom?: boolean; // true for newly imposed fees by director
  notes?: string;
  updatedAt: string;
};

const KEY = "sauti_fees_policy_v1";
const EVT = "sauti:fees-policy-changed";

const DEFAULTS: FeePolicy[] = [
  {
    key: "membership",
    label: "Membership Fee",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    scope: "all",
    updatedAt: new Date().toISOString(),
  },
  {
    key: "card",
    label: "Membership Card",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    scope: "all",
    updatedAt: new Date().toISOString(),
  },
  {
    key: "sticker",
    label: "Shop Sticker",
    amount: 500,
    permanence: "permanent",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    scope: "all",
    updatedAt: new Date().toISOString(),
  },
];

function read(): FeePolicy[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const rows = JSON.parse(raw) as FeePolicy[];
    // ensure defaults always present
    const merged = [...rows];
    for (const d of DEFAULTS) if (!merged.find((r) => r.key === d.key)) merged.push(d);
    return merged;
  } catch {
    return DEFAULTS;
  }
}
function write(rows: FeePolicy[]) {
  localStorage.setItem(KEY, JSON.stringify(rows));
  window.dispatchEvent(new Event(EVT));
}

export function listFees(): FeePolicy[] {
  return read();
}

export function upsertFee(p: FeePolicy) {
  const rows = read();
  const i = rows.findIndex((r) => r.key === p.key);
  const next = { ...p, updatedAt: new Date().toISOString() };
  if (i >= 0) rows[i] = next;
  else rows.push(next);
  write(rows);
}

export function removeFee(key: string) {
  const rows = read().filter((r) => r.key !== key || !r.custom);
  write(rows);
}

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

export function useFeesPolicy() {
  const [rows, setRows] = useState<FeePolicy[]>(() => read());
  useEffect(() => {
    const refresh = () => setRows(read());
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return rows;
}
