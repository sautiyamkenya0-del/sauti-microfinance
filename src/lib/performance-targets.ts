import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  deletePerformanceTargetRecord,
  upsertPerformanceTargetRecord,
} from "@/lib/app-data.functions";
import { listPerformanceTargets } from "@/lib/runtime-data.functions";

export type TargetPeriod = "daily" | "weekly" | "monthly" | "annual";

export type TargetMetric =
  | "collections_total"
  | "loan_repayments"
  | "loan_disbursements"
  | "new_loans_count"
  | "registrations"
  | "cards_paid"
  | "stickers_paid"
  | "stickers_issued";

export type PerformanceTarget = {
  id: string;
  metric: TargetMetric;
  period: TargetPeriod;
  expectedValue: number;
  startOn: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export const TARGET_PERIOD_LABELS: Record<TargetPeriod, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

export const TARGET_METRIC_META: Record<
  TargetMetric,
  { label: string; unit: "amount" | "count"; description: string }
> = {
  collections_total: {
    label: "Collections",
    unit: "amount",
    description: "All member money collected across repayments, savings, shares, fees, and investment.",
  },
  loan_repayments: {
    label: "Loan repayments",
    unit: "amount",
    description: "Collections applied directly to active loans.",
  },
  loan_disbursements: {
    label: "Loan disbursements",
    unit: "amount",
    description: "Money expected to go out as newly issued loans.",
  },
  new_loans_count: {
    label: "New loans",
    unit: "count",
    description: "Count of loans expected to be disbursed in the period.",
  },
  registrations: {
    label: "Registrations",
    unit: "count",
    description: "New member registrations captured in the period.",
  },
  cards_paid: {
    label: "Cards",
    unit: "count",
    description: "Membership card fee collections recorded in the period.",
  },
  stickers_paid: {
    label: "Stickers paid",
    unit: "count",
    description: "Sticker fee payments collected in the period.",
  },
  stickers_issued: {
    label: "Stickers issued",
    unit: "count",
    description: "Sticker issuances, currently inferred from sticker fee payments.",
  },
};

export function usePerformanceTargets() {
  const loadTargets = useServerFn(listPerformanceTargets);
  const [rows, setRows] = useState<PerformanceTarget[]>([]);

  const refresh = useCallback(async () => {
    setRows(await loadTargets());
  }, [loadTargets]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return { rows, refresh };
}

export function usePerformanceTargetActions() {
  const saveTarget = useServerFn(upsertPerformanceTargetRecord);
  const deleteTarget = useServerFn(deletePerformanceTargetRecord);
  const { rows, refresh } = usePerformanceTargets();

  const upsertTarget = useCallback(
    async (
      target: Omit<PerformanceTarget, "id" | "createdAt" | "updatedAt"> & { id?: string },
    ) => {
      await saveTarget({ data: target });
      await refresh();
    },
    [refresh, saveTarget],
  );

  const removeTarget = useCallback(
    async (id: string) => {
      await deleteTarget({ data: { id } });
      await refresh();
    },
    [deleteTarget, refresh],
  );

  return { rows, upsertTarget, removeTarget, refresh };
}
