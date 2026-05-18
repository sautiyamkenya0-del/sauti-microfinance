import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";

import { listNotificationReads, markNotificationReads } from "@/lib/notification-reads.functions";
import { useStore } from "@/lib/store";

const EVT = "sauti:read-changed";
const readIdsByStaff = new Map<string, Set<string>>();
const hydratedStaffIds = new Set<string>();
const hydrationRequests = new Map<string, Promise<void>>();

function emitReadChange() {
  window.dispatchEvent(new Event(EVT));
}

function snapshotReadIds(staffId: string) {
  return new Set(readIdsByStaff.get(staffId) ?? []);
}

function mergeReadIds(staffId: string, ids: Iterable<string>) {
  const next = readIdsByStaff.get(staffId) ?? new Set<string>();
  let changed = false;
  for (const id of ids) {
    const value = String(id ?? "").trim();
    if (!value || next.has(value)) continue;
    next.add(value);
    changed = true;
  }
  readIdsByStaff.set(staffId, next);
  return changed;
}

export function useReadIds() {
  const { currentUser, authMode, isAuthenticated } = useStore();
  const loadNotificationReads = useServerFn(listNotificationReads);
  const persistNotificationReads = useServerFn(markNotificationReads);
  const staffId = isAuthenticated && authMode === "staff" ? currentUser.id : "";
  const [ids, setIds] = useState<Set<string>>(() => snapshotReadIds(staffId));
  const sigRef = useRef<string>("");

  useEffect(() => {
    const refresh = () => {
      const next = snapshotReadIds(staffId);
      const sig = [...next].sort().join("|");
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setIds(next);
    };
    refresh();
    window.addEventListener(EVT, refresh);
    return () => window.removeEventListener(EVT, refresh);
  }, [staffId]);

  useEffect(() => {
    if (!staffId || hydratedStaffIds.has(staffId)) return;

    const pending =
      hydrationRequests.get(staffId) ??
      loadNotificationReads()
        .then((result) => {
          if (mergeReadIds(staffId, result.ids)) emitReadChange();
          hydratedStaffIds.add(staffId);
        })
        .catch(() => undefined)
        .finally(() => {
          hydrationRequests.delete(staffId);
        });

    hydrationRequests.set(staffId, pending);
  }, [loadNotificationReads, staffId]);

  const markRead = useCallback(
    (id: string | string[]) => {
      if (!staffId) return;
      const arr = Array.isArray(id) ? id : [id];
      if (!arr.length) return;
      if (mergeReadIds(staffId, arr)) emitReadChange();
      void persistNotificationReads({ data: { ids: arr } }).catch(() => {});
    },
    [persistNotificationReads, staffId],
  );

  const clearAll = useCallback(
    (all: string[]) => {
      markRead(all);
    },
    [markRead],
  );

  return { ids, markRead, clearAll };
}

export function useChatMessages() {
  const { staffMessages } = useStore();
  return staffMessages.map((message) => ({
    id: message.id,
    from: message.senderId,
    fromName: message.senderName,
    to: message.receiverId,
    text: message.content,
    att: message.attachment
      ? { name: message.attachment.name, type: message.attachment.type }
      : undefined,
    at: message.createdAt,
  }));
}
