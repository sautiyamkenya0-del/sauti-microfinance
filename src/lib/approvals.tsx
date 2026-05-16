import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  createApprovalRequestRecord,
  decideApprovalRequestRecord,
  loadAppData,
} from "@/lib/app-data.functions";

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
  const load = useServerFn(loadAppData);
  const createApproval = useServerFn(createApprovalRequestRecord);
  const decideApproval = useServerFn(decideApprovalRequestRecord);
  const [items, setItems] = useState<ApprovalRequest[]>([]);

  const refresh = useCallback(async () => {
    const data = await load();
    setItems(data.approvals ?? []);
  }, [load]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const sync = () => {
      refresh().catch(() => {});
    };
    const timer = window.setInterval(sync, 8000);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
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
    async (id: string, decision: "approved" | "rejected", by: string, note?: string) => {
      await decideApproval({
        data: {
          id,
          decision,
          reviewedBy: by,
          note,
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
