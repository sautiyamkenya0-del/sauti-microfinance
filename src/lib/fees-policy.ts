import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { deleteFeePolicyRecord, upsertFeePolicyRecord } from "@/lib/app-data.functions";
import { listFeePolicies } from "@/lib/runtime-data.functions";

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
  const loadFeePolicies = useServerFn(listFeePolicies);
  const [rows, setRows] = useState<FeePolicy[]>([]);

  const refresh = useCallback(async () => {
    setRows(await loadFeePolicies());
  }, [loadFeePolicies]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const sync = () => {
      if (document.hidden) return;
      refresh().catch(() => {});
    };
    const timer = window.setInterval(sync, 60000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refresh]);

  return rows;
}

export function useFeePolicyActions() {
  const saveFee = useServerFn(upsertFeePolicyRecord);
  const removeFeeRecord = useServerFn(deleteFeePolicyRecord);
  const loadFeePolicies = useServerFn(listFeePolicies);
  const [rows, setRows] = useState<FeePolicy[]>([]);

  const refresh = useCallback(async () => {
    setRows(await loadFeePolicies());
  }, [loadFeePolicies]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const upsertFee = useCallback(
    async (fee: FeePolicy) => {
      await saveFee({
        data: {
          key: fee.key,
          label: fee.label,
          amount: fee.amount,
          permanence: fee.permanence,
          durationDays: fee.durationDays,
          effectiveFrom: fee.effectiveFrom,
          scope: fee.scope,
          custom: fee.custom,
          notes: fee.notes,
        },
      });
      await refresh();
    },
    [refresh, saveFee],
  );

  const removeFee = useCallback(
    async (key: string) => {
      await removeFeeRecord({ data: { key } });
      await refresh();
    },
    [refresh, removeFeeRecord],
  );

  return { rows, upsertFee, removeFee, refresh };
}
