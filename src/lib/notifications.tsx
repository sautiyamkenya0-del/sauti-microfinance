import { useStore } from "@/lib/store";
import { useMemo } from "react";
import { useReadIds, useChatMessages } from "@/lib/read-state";

export type Notice = {
  id: string;
  kind: "warning" | "info" | "alert";
  title: string;
  detail: string;
  href?: string;
};

export function useNotificationsRaw(): Notice[] {
  const { loans, members, penalties, transactions, currentUser } = useStore();
  const chat = useChatMessages();
  return useMemo(() => {
    const out: Notice[] = [];
    loans
      .filter((l) => l.status === "pending")
      .forEach((l) => {
        const m = members.find((x) => x.id === l.memberId);
        out.push({
          id: `pend-${l.id}`,
          kind: "info",
          title: `Loan ${l.id} pending review`,
          detail: `${m?.name ?? l.memberId} · KSh ${l.principal.toLocaleString()}`,
          href: "/loans",
        });
      });
    penalties
      .filter((p) => p.status === "outstanding")
      .forEach((p) => {
        const m = members.find((x) => x.id === p.memberId);
        out.push({
          id: `pen-${p.id}`,
          kind: "warning",
          title: `Penalty outstanding`,
          detail: `${m?.name ?? p.memberId} · ${p.reason}`,
          href: "/loans",
        });
      });
    members
      .filter((m) => m.status === "active" && m.savingsBalance < 1000)
      .forEach((m) => {
        out.push({
          id: `sav-${m.id}`,
          kind: "alert",
          title: "Below mandatory savings",
          detail: `${m.name} (${m.id}) · KSh ${m.savingsBalance.toLocaleString()}`,
          href: "/savings",
        });
      });
    transactions.slice(0, 3).forEach((t) => {
      if (t.type === "investor_contribution" || t.type === "loan_repayment") {
        out.push({
          id: `tx-${t.id}`,
          kind: "info",
          title: `Inflow: ${t.type.replace(/_/g, " ")}`,
          detail: `KSh ${t.amount.toLocaleString()} · ${t.date}`,
          href: "/transactions",
        });
      }
    });
    chat
      .filter((m) => m.to === currentUser.id)
      .forEach((m) => {
        out.push({
          id: `msg-${m.id}`,
          kind: "alert",
          title: `New message from ${m.fromName}`,
          detail: m.text ?? `📎 ${m.att?.name ?? "attachment"}`,
          href: "/staff",
        });
      });
    return out;
  }, [loans, members, penalties, transactions, chat, currentUser.id]);
}

export function useNotifications(): Notice[] {
  const all = useNotificationsRaw();
  const { ids } = useReadIds();
  return useMemo(() => all.filter((n) => !ids.has(n.id)), [all, ids]);
}

export function useUnreadChatCount(): number {
  const chat = useChatMessages();
  const { currentUser } = useStore();
  const { ids } = useReadIds();
  return useMemo(
    () => chat.filter((m) => m.to === currentUser.id && !ids.has(`msg-${m.id}`)).length,
    [chat, currentUser.id, ids],
  );
}
