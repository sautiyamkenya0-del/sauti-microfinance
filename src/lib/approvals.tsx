import { useEffect, useState, useCallback } from "react";

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
  requestedBy: string; // member or staff id
  requestedByName?: string;
  payload?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: string;
};

const KEY = "sauti:approvals";
const EVT = "sauti:approvals-changed";

function read(): ApprovalRequest[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function write(items: ApprovalRequest[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVT));
}

export function submitApproval(req: Omit<ApprovalRequest, "id" | "status" | "createdAt">) {
  const items = read();
  const id = `AR${Date.now().toString(36)}`;
  items.unshift({ ...req, id, status: "pending", createdAt: new Date().toISOString() });
  write(items);
  return id;
}

export function decideApproval(
  id: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
  note?: string,
) {
  const items = read().map((r) =>
    r.id === id
      ? {
          ...r,
          status: decision,
          reviewedBy,
          reviewNote: note,
          reviewedAt: new Date().toISOString(),
        }
      : r,
  );
  write(items);
}

export function useApprovals() {
  const [items, setItems] = useState<ApprovalRequest[]>(() =>
    typeof window !== "undefined" ? read() : [],
  );
  useEffect(() => {
    const refresh = () => setItems(read());
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const submit = useCallback(
    (req: Omit<ApprovalRequest, "id" | "status" | "createdAt">) => submitApproval(req),
    [],
  );
  const decide = useCallback(
    (id: string, decision: "approved" | "rejected", by: string, note?: string) =>
      decideApproval(id, decision, by, note),
    [],
  );
  return {
    items,
    submit,
    decide,
    pendingCount: items.filter((i) => i.status === "pending").length,
  };
}
