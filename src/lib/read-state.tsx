import { useEffect, useRef, useState, useCallback } from "react";

const KEY = "sauti_notif_read_v1";

function load(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function save(s: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...s]));
  window.dispatchEvent(new Event("sauti:read-changed"));
}

export function useReadIds() {
  const [ids, setIds] = useState<Set<string>>(() => load());
  const sigRef = useRef<string>("");
  useEffect(() => {
    const refresh = () => {
      const next = load();
      // Skip state updates when nothing actually changed — avoids cascading
      // re-renders across header/sidebar that depend on useReadIds.
      const sig = [...next].sort().join("|");
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setIds(next);
    };
    refresh();
    window.addEventListener("sauti:read-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("sauti:read-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const markRead = useCallback((id: string | string[]) => {
    const arr = Array.isArray(id) ? id : [id];
    const next = load();
    arr.forEach((x) => next.add(x));
    save(next);
  }, []);
  const clearAll = useCallback((all: string[]) => {
    const n = load();
    all.forEach((x) => n.add(x));
    save(n);
  }, []);
  return { ids, markRead, clearAll };
}

const CHAT_KEY = "sauti_staff_chat_v2";
type ChatMsg = {
  id: string;
  from: string;
  fromName: string;
  to: string;
  text?: string;
  att?: { name: string; type: string };
  at: string;
};

export function useChatMessages(): ChatMsg[] {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const sigRef = useRef<string>("");
  useEffect(() => {
    const refresh = () => {
      try {
        const raw = localStorage.getItem(CHAT_KEY) ?? "[]";
        // Cheap signature check (string compare) to avoid parsing + new array
        // identity on every tick when nothing changed.
        if (raw === sigRef.current) return;
        sigRef.current = raw;
        setMsgs(JSON.parse(raw));
      } catch {
        /**/
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("sauti:chat-changed", refresh);
    // Event-driven only — the previous 1.5s polling was forcing re-renders
    // across the entire app every 1.5s and caused noticeable lag.
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("sauti:chat-changed", refresh);
    };
  }, []);
  return msgs;
}
