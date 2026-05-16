import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  createStaffMemoRecord,
  deleteStaffMemoRecord,
  loadAppData,
} from "@/lib/app-data.functions";

export type StaffMemo = {
  id: string;
  date: string;
  title: string;
  body: string;
  by: string;
  byStaffId?: string;
  createdAt: string;
};

export function useStaffMemos() {
  const load = useServerFn(loadAppData);
  const createMemo = useServerFn(createStaffMemoRecord);
  const deleteMemoRecord = useServerFn(deleteStaffMemoRecord);
  const [memos, setMemos] = useState<StaffMemo[]>([]);

  const refresh = useCallback(async () => {
    const data = await load();
    setMemos(data.memos ?? []);
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

  const postMemo = useCallback(
    async (memo: { title: string; body: string; by: string; byStaffId?: string; date?: string }) => {
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
