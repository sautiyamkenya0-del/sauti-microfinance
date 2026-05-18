import { useEffect, useRef, useState, useCallback } from "react";

import { useStore } from "@/lib/store";

const EVT = "sauti:read-changed";
const readIdsState = new Set<string>();

function emitReadChange() {
  window.dispatchEvent(new Event(EVT));
}

function snapshotReadIds() {
  return new Set(readIdsState);
}

export function useReadIds() {
  const [ids, setIds] = useState<Set<string>>(() => snapshotReadIds());
  const sigRef = useRef<string>("");

  useEffect(() => {
    const refresh = () => {
      const next = snapshotReadIds();
      const sig = [...next].sort().join("|");
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setIds(next);
    };
    refresh();
    window.addEventListener(EVT, refresh);
    return () => window.removeEventListener(EVT, refresh);
  }, []);

  const markRead = useCallback((id: string | string[]) => {
    const arr = Array.isArray(id) ? id : [id];
    arr.forEach((item) => readIdsState.add(item));
    emitReadChange();
  }, []);

  const clearAll = useCallback((all: string[]) => {
    all.forEach((item) => readIdsState.add(item));
    emitReadChange();
  }, []);

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
