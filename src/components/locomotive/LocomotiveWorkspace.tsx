import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { listLocomotiveBusinessWorkspace } from "@/lib/runtime-data.functions";

export type LocomotiveWorkspace = {
  actorMemberId: string;
  actorMember: any | null;
  selectedAdminStaffId?: string;
  selectedAdmin?: any | null;
  locomotiveAdmins: any[];
  members: any[];
  allocations: any[];
  services: any[];
  deposits: any[];
  depositTotal: number;
  allocatedTotal: number;
  pendingTotal: number;
  cashTotal: number;
  availableBalance: number;
  withdrawableSavingsBalance: number;
  loanSavingsBalance: number;
};

const emptyWorkspace: LocomotiveWorkspace = {
  actorMemberId: "",
  actorMember: null,
  selectedAdminStaffId: "",
  selectedAdmin: null,
  locomotiveAdmins: [],
  members: [],
  allocations: [],
  services: [],
  deposits: [],
  depositTotal: 0,
  allocatedTotal: 0,
  pendingTotal: 0,
  cashTotal: 0,
  availableBalance: 0,
  withdrawableSavingsBalance: 0,
  loanSavingsBalance: 0,
};

export function useLocomotiveWorkspace(options?: { adminStaffId?: string }) {
  const loadWorkspace = useServerFn(listLocomotiveBusinessWorkspace);
  const [workspace, setWorkspace] = useState<LocomotiveWorkspace>(emptyWorkspace);
  const [urlAdminStaffId] = useState(() => getAdminStaffIdFromLocation());
  const adminStaffId = options?.adminStaffId ?? urlAdminStaffId;

  const refresh = useCallback(async () => {
    try {
      setWorkspace(
        await loadWorkspace({
          data: adminStaffId ? { adminStaffId } : {},
        }),
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load locomotive workspace.");
    }
  }, [adminStaffId, loadWorkspace]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return { workspace, refresh };
}

export function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-5 py-3 text-left">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-5 py-8 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-5 py-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export const inputCls =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";

export function getAdminStaffIdFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("adminStaffId") ?? "";
}
