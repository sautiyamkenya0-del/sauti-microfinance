import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { createApprovalRequestRecord, decideApprovalRequestRecord } from "@/lib/app-data.functions";
import { listApprovalRequests } from "@/lib/runtime-data.functions";

export type ApprovalKind =
  | "profile_update"
  | "pin_change"
  | "withdrawal"
  | "fee_waiver"
  | "loan_topup"
  | "other";

export type ApprovalRequest = {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  requestedBy: string;
  requestedByName?: string;
  payload?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: string;
};

export function useApprovals() {
  const loadApprovals = useServerFn(listApprovalRequests);
  const createApproval = useServerFn(createApprovalRequestRecord);
  const decideApproval = useServerFn(decideApprovalRequestRecord);
  const [items, setItems] = useState<ApprovalRequest[]>([]);

  const refresh = useCallback(async () => {
    setItems(await loadApprovals());
  }, [loadApprovals]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const sync = () => {
      if (document.hidden) return;
      refresh().catch(() => {});
    };
    const timer = window.setInterval(sync, 45000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [refresh]);

  const submit = useCallback(
    async (req: Omit<ApprovalRequest, "id" | "status" | "createdAt">) => {
      const result = await createApproval({
        data: {
          kind: req.kind,
          title: req.title,
          detail: req.detail,
          requestedBy: req.requestedBy,
          requestedByName: req.requestedByName,
          payload: req.payload,
        },
      });
      await refresh();
      return result.id;
    },
    [createApproval, refresh],
  );

  const decide = useCallback(
    async (
      id: string,
      decision: "approved" | "rejected",
      by: string,
      note?: string,
      adjustedAmount?: number,
    ) => {
      await decideApproval({
        data: {
          id,
          decision,
          reviewedBy: by,
          note,
          adjustedAmount,
        },
      });
      await refresh();
    },
    [decideApproval, refresh],
  );

  return {
    items,
    submit,
    decide,
    pendingCount: items.filter((item) => item.status === "pending").length,
  };
}

export function useApprovalActions() {
  const createApproval = useServerFn(createApprovalRequestRecord);
  const decideApproval = useServerFn(decideApprovalRequestRecord);

  const submit = useCallback(
    async (req: Omit<ApprovalRequest, "id" | "status" | "createdAt">) => {
      const result = await createApproval({
        data: {
          kind: req.kind,
          title: req.title,
          detail: req.detail,
          requestedBy: req.requestedBy,
          requestedByName: req.requestedByName,
          payload: req.payload,
        },
      });
      return result.id;
    },
    [createApproval],
  );

  const decide = useCallback(
    async (
      id: string,
      decision: "approved" | "rejected",
      by: string,
      note?: string,
      adjustedAmount?: number,
    ) => {
      await decideApproval({
        data: {
          id,
          decision,
          reviewedBy: by,
          note,
          adjustedAmount,
        },
      });
    },
    [decideApproval],
  );

  return { submit, decide };
}
