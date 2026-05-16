import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  appendSupportMessageRecord,
  createSupportThreadRecord,
  loadAppData,
  updateSupportThreadRecord,
} from "@/lib/app-data.functions";

export type SupportMsg = {
  id: string;
  from: "member" | "ai" | "staff";
  fromName: string;
  fromId?: string;
  text: string;
  at: string;
};

export type SupportThread = {
  id: string;
  memberId: string;
  memberName: string;
  assignedStaffId?: string;
  status: "ai" | "open" | "claimed" | "closed";
  subject: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportMsg[];
};

export function useSupportThreads(enabled = true) {
  const load = useServerFn(loadAppData);
  const [rows, setRows] = useState<SupportThread[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRows([]);
      return;
    }
    const data = await load();
    setRows(data.supportThreads ?? []);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    refresh().catch(() => {});
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      refresh().catch(() => {});
    };
    const timer = window.setInterval(sync, 4000);
    window.addEventListener("focus", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
    };
  }, [enabled, refresh]);

  return rows;
}

export function useSupportInboxActions() {
  const load = useServerFn(loadAppData);
  const createThreadRecord = useServerFn(createSupportThreadRecord);
  const appendMessageRecord = useServerFn(appendSupportMessageRecord);
  const updateThreadRecord = useServerFn(updateSupportThreadRecord);
  const [rows, setRows] = useState<SupportThread[]>([]);

  const refresh = useCallback(async () => {
    const data = await load();
    setRows(data.supportThreads ?? []);
  }, [load]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const createThread = useCallback(
    async (args: {
      memberId: string;
      memberName: string;
      subject: string;
      initialMessages: SupportMsg[];
      assignedStaffId?: string;
    }) => {
      const result = await createThreadRecord({
        data: {
          memberId: args.memberId,
          memberName: args.memberName,
          subject: args.subject,
          assignedStaffId: args.assignedStaffId,
          initialMessages: args.initialMessages.map((message) => ({
            from: message.from,
            fromName: message.fromName,
            fromId: message.fromId,
            text: message.text,
          })),
        },
      });
      await refresh();
      return result.id;
    },
    [createThreadRecord, refresh],
  );

  const appendMessage = useCallback(
    async (threadId: string, msg: Omit<SupportMsg, "id" | "at">) => {
      await appendMessageRecord({
        data: {
          threadId,
          from: msg.from,
          fromName: msg.fromName,
          fromId: msg.fromId,
          text: msg.text,
        },
      });
      await refresh();
    },
    [appendMessageRecord, refresh],
  );

  const setThreadStatus = useCallback(
    async (threadId: string, status: SupportThread["status"], assignedStaffId?: string) => {
      await updateThreadRecord({
        data: {
          id: threadId,
          status,
          assignedStaffId,
        },
      });
      await refresh();
    },
    [refresh, updateThreadRecord],
  );

  return { rows, createThread, appendMessage, setThreadStatus, refresh };
}
