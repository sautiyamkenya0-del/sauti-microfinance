/**
 * Member ↔ Staff support inbox (in-house). Stored in localStorage so it works
 * without a backend. Threads are created when a member uses the AI chat in the
 * Member Portal and clicks "Talk to a real person".
 */
import { useEffect, useState } from "react";

export type SupportMsg = {
  id: string;
  from: "member" | "ai" | "staff";
  fromName: string;
  fromId?: string;
  text: string;
  at: string; // ISO
};

export type SupportThread = {
  id: string;
  memberId: string;
  memberName: string;
  assignedStaffId?: string; // field officer or fallback manager
  status: "ai" | "open" | "claimed" | "closed";
  subject: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportMsg[];
};

const KEY = "sauti_support_inbox_v1";
const EVT = "sauti:support-inbox-changed";

function read(): SupportThread[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function write(rows: SupportThread[]) {
  localStorage.setItem(KEY, JSON.stringify(rows));
  window.dispatchEvent(new Event(EVT));
}

export function listThreads(): SupportThread[] {
  return read();
}
export function getThread(id: string) {
  return read().find((t) => t.id === id);
}

export function upsertThread(t: SupportThread) {
  const rows = read();
  const i = rows.findIndex((x) => x.id === t.id);
  if (i >= 0) rows[i] = t;
  else rows.unshift(t);
  write(rows);
}

export function appendMessage(threadId: string, msg: Omit<SupportMsg, "id" | "at">) {
  const rows = read();
  const t = rows.find((x) => x.id === threadId);
  if (!t) return;
  t.messages.push({
    ...msg,
    id: `SM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
  });
  t.updatedAt = new Date().toISOString();
  write(rows);
}

export function setThreadStatus(
  threadId: string,
  status: SupportThread["status"],
  assignedStaffId?: string,
) {
  const rows = read();
  const t = rows.find((x) => x.id === threadId);
  if (!t) return;
  t.status = status;
  if (assignedStaffId !== undefined) t.assignedStaffId = assignedStaffId;
  t.updatedAt = new Date().toISOString();
  write(rows);
}

export function createThread(args: {
  memberId: string;
  memberName: string;
  subject: string;
  initialMessages: SupportMsg[];
  assignedStaffId?: string;
}): SupportThread {
  const id = `SUP-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const now = new Date().toISOString();
  const t: SupportThread = {
    id,
    memberId: args.memberId,
    memberName: args.memberName,
    assignedStaffId: args.assignedStaffId,
    status: "open",
    subject: args.subject,
    createdAt: now,
    updatedAt: now,
    messages: args.initialMessages,
  };
  upsertThread(t);
  // Ping the bell on staff side
  window.dispatchEvent(
    new CustomEvent("sauti:notify", {
      detail: {
        kind: "message",
        title: `New member support request from ${args.memberName}`,
        urgent: true,
      },
    }),
  );
  return t;
}

export function useSupportThreads() {
  const [rows, setRows] = useState<SupportThread[]>(() => read());
  useEffect(() => {
    const refresh = () => setRows(read());
    window.addEventListener(EVT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return rows;
}
