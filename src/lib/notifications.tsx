/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useStore } from "@/lib/store";
import { useStaffMemos } from "@/lib/memos-board";
import { useReadIds, useChatMessages } from "@/lib/read-state";
import { useSupportThreads, type SupportThread } from "@/lib/support-inbox";

export type Notice = {
  id: string;
  kind: "warning" | "info" | "alert";
  title: string;
  detail: string;
  href?: string;
};

type NotificationsContextValue = {
  all: Notice[];
  unread: Notice[];
  unreadChatCount: number;
  unreadCommunicationCount: number;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
const COMMUNICATION_PATHS = new Set(["/staff", "/memos", "/support-inbox"]);

function canSeeSupportThread(
  thread: SupportThread,
  currentUser: ReturnType<typeof useStore>["currentUser"],
) {
  return (
    thread.status !== "closed" &&
    (!thread.assignedStaffId ||
      thread.assignedStaffId === currentUser.id ||
      currentUser.role === "director" ||
      currentUser.role === "manager")
  );
}

function latestSupportMessage(thread: SupportThread) {
  return thread.messages[thread.messages.length - 1];
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { loans, members, penalties, transactions, currentUser, authMode, isAuthenticated } =
    useStore();
  const notificationsEnabled = isAuthenticated && authMode !== "member";
  const chat = useChatMessages();
  const { ids } = useReadIds();
  const { memos } = useStaffMemos(notificationsEnabled);
  const supportThreads = useSupportThreads(notificationsEnabled);

  const all = useMemo(() => {
    if (!notificationsEnabled) return [];
    const out: Notice[] = [];

    loans
      .filter((loan) => loan.status === "pending")
      .forEach((loan) => {
        const member = members.find((row) => row.id === loan.memberId);
        out.push({
          id: `pend-${loan.id}`,
          kind: "info",
          title: `Loan ${loan.id} pending review`,
          detail: `${member?.name ?? loan.memberId} · KSh ${loan.principal.toLocaleString()}`,
          href: "/loans",
        });
      });

    penalties
      .filter((penalty) => penalty.status === "outstanding")
      .forEach((penalty) => {
        const member = members.find((row) => row.id === penalty.memberId);
        out.push({
          id: `pen-${penalty.id}`,
          kind: "warning",
          title: "Penalty outstanding",
          detail: `${member?.name ?? penalty.memberId} · ${penalty.reason}`,
          href: "/loans",
        });
      });

    members
      .filter((member) => member.status === "active" && member.savingsBalance < 1000)
      .forEach((member) => {
        out.push({
          id: `sav-${member.id}`,
          kind: "alert",
          title: "Below mandatory savings",
          detail: `${member.name} (${member.id}) · KSh ${member.savingsBalance.toLocaleString()}`,
          href: "/savings",
        });
      });

    transactions.slice(0, 3).forEach((transaction) => {
      if (transaction.type === "investor_contribution" || transaction.type === "loan_repayment") {
        out.push({
          id: `tx-${transaction.id}`,
          kind: "info",
          title: `Inflow: ${transaction.type.replace(/_/g, " ")}`,
          detail: `KSh ${transaction.amount.toLocaleString()} · ${transaction.date}`,
          href: "/transactions",
        });
      }
    });

    chat
      .filter((message) => message.to === currentUser.id)
      .forEach((message) => {
        out.push({
          id: `msg-${message.id}`,
          kind: "alert",
          title: `New message from ${message.fromName}`,
          detail: message.text ?? `Attachment: ${message.att?.name ?? "file"}`,
          href: "/staff",
        });
      });

    memos
      .filter(
        (memo) =>
          memo.byStaffId !== currentUser.id && (!memo.byStaffId || memo.by !== currentUser.name),
      )
      .forEach((memo) => {
        out.push({
          id: `memo-${memo.id}`,
          kind: "info",
          title: `New memo: ${memo.title}`,
          detail: `${memo.by} · ${memo.date}`,
          href: "/memos",
        });
      });

    supportThreads
      .filter((thread) => canSeeSupportThread(thread, currentUser))
      .forEach((thread) => {
        const latest = latestSupportMessage(thread);
        if (!latest) return;
        if (latest.from === "staff" && latest.fromId === currentUser.id) return;

        out.push({
          id: `support-${thread.id}-${latest.id}`,
          kind: thread.status === "open" ? "alert" : "info",
          title:
            latest.from === "member"
              ? `Support message from ${thread.memberName}`
              : latest.from === "ai"
                ? `AI escalated ${thread.memberName}`
                : `Support update by ${latest.fromName}`,
          detail: `${thread.subject} · ${latest.text}`,
          href: "/support-inbox",
        });
      });

    return out;
  }, [
    chat,
    currentUser,
    loans,
    members,
    memos,
    notificationsEnabled,
    penalties,
    supportThreads,
    transactions,
  ]);

  const unread = useMemo(() => all.filter((notice) => !ids.has(notice.id)), [all, ids]);

  const unreadChatCount = useMemo(
    () =>
      !notificationsEnabled
        ? 0
        : chat.filter((message) => message.to === currentUser.id && !ids.has(`msg-${message.id}`))
            .length,
    [chat, currentUser.id, ids, notificationsEnabled],
  );

  const unreadCommunicationCount = useMemo(
    () => unread.filter((notice) => notice.href && COMMUNICATION_PATHS.has(notice.href)).length,
    [unread],
  );

  const value = useMemo<NotificationsContextValue>(
    () => ({
      all,
      unread,
      unreadChatCount,
      unreadCommunicationCount,
    }),
    [all, unread, unreadChatCount, unreadCommunicationCount],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

function useNotificationsContext() {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error("Notification hooks must be used within NotificationsProvider.");
  }
  return value;
}

export function useNotificationsRaw(): Notice[] {
  return useNotificationsContext().all;
}

export function useNotifications(): Notice[] {
  return useNotificationsContext().unread;
}

export function useUnreadChatCount(): number {
  return useNotificationsContext().unreadChatCount;
}

export function useUnreadCommunicationCount(): number {
  return useNotificationsContext().unreadCommunicationCount;
}
