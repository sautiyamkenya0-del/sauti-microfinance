import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import { createStaffMemoRecord, deleteStaffMemoRecord } from "@/lib/app-data.functions";
import { listStaffMemos } from "@/lib/runtime-data.functions";

export type StaffMemo = {
  id: string;
  date: string;
  title: string;
  body: string;
  by: string;
  byStaffId?: string;
  audience?: "staff" | "members" | "all";
  kind?: "info" | "warning" | "alert";
  expiresAt?: string;
  createdAt: string;
};

export function useStaffMemos(enabled = true) {
  const loadMemos = useServerFn(listStaffMemos);
  const createMemo = useServerFn(createStaffMemoRecord);
  const deleteMemoRecord = useServerFn(deleteStaffMemoRecord);
  const [memos, setMemos] = useState<StaffMemo[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setMemos([]);
      return;
    }
    setMemos(await loadMemos());
  }, [enabled, loadMemos]);

  useEffect(() => {
    if (!enabled) {
      setMemos([]);
      return;
    }
    refresh().catch(() => {});
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, refresh]);

  const postMemo = useCallback(
    async (memo: {
      title: string;
      body: string;
      by: string;
      byStaffId?: string;
      date?: string;
      audience?: "staff" | "members" | "all";
      kind?: "info" | "warning" | "alert";
      expiresAt?: string;
    }) => {
      const result = await createMemo({ data: memo });
      await refresh();
      return result.id;
    },
    [createMemo, refresh],
  );

  const removeMemo = useCallback(
    async (id: string) => {
      await deleteMemoRecord({ data: { id } });
      await refresh();
    },
    [deleteMemoRecord, refresh],
  );

  return { memos, postMemo, removeMemo, refresh };
}
