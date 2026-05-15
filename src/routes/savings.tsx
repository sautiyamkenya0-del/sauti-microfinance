import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard, DirectorOnly } from "@/components/ui-bits";
import { useStore, fmtKES } from "@/lib/store";
import { useState } from "react";
import { toast } from "sonner";
import { PiggyBank, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

export const Route = createFileRoute("/savings")({
  head: () => ({ meta: [{ title: "Savings — Sauti Microfinance" }] }),
  component: SavingsPage,
});

function SavingsPage() {
  const { members, transactions, recordTransaction, currentUser } = useStore();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [amount, setAmount] = useState(0);
  const [type, setType] = useState<"deposit" | "withdrawal">("deposit");

  const total = members.reduce((s, m) => s + m.savingsBalance, 0);
  const deposits = transactions
    .filter((t) => t.type === "deposit")
    .reduce((s, t) => s + t.amount, 0);
  const withdrawals = transactions
    .filter((t) => t.type === "withdrawal")
    .reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <AppHeader title="Savings" subtitle="Member deposit accounts and movements." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="capital" />
        <DirectorOnly>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              label="Total Savings"
              value={fmtKES(total)}
              icon={<PiggyBank className="h-5 w-5" />}
              tone="success"
            />
            <StatCard
              label="Lifetime Deposits"
              value={fmtKES(deposits)}
              icon={<ArrowDownToLine className="h-5 w-5" />}
            />
            <StatCard
              label="Lifetime Withdrawals"
              value={fmtKES(withdrawals)}
              icon={<ArrowUpFromLine className="h-5 w-5" />}
              tone="warning"
            />
          </div>
        </DirectorOnly>

        <div className="grid lg:grid-cols-3 gap-6">
          <Section title="Record movement">
            <div className="p-5 space-y-3">
              <div className="flex gap-2">
                {(["deposit", "withdrawal"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`flex-1 py-2 text-sm rounded-md capitalize ${type === t ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <select
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {fmtKES(m.savingsBalance)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
              <button
                onClick={() => {
                  if (amount <= 0) return;
                  recordTransaction({ type, amount, memberId, by: currentUser.id });
                  toast.success(`${type === "deposit" ? "Deposit" : "Withdrawal"} recorded`);
                  setAmount(0);
                }}
                className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-medium hover:bg-primary/90"
              >
                Submit
              </button>
            </div>
          </Section>

          <div className="lg:col-span-2">
            <Section title="Member Balances">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                    <tr>
                      <th className="px-5 py-3 text-left">Member</th>
                      <th className="px-5 py-3 text-right">Balance</th>
                      <th className="px-5 py-3 text-right">Last Deposit</th>
                      <th className="px-5 py-3 text-right">Last Withdrawal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {members.map((m) => {
                      const d = transactions.find(
                        (t) => t.memberId === m.id && t.type === "deposit",
                      );
                      const w = transactions.find(
                        (t) => t.memberId === m.id && t.type === "withdrawal",
                      );
                      return (
                        <tr key={m.id}>
                          <td className="px-5 py-3 font-medium">{m.name}</td>
                          <td className="px-5 py-3 text-right font-semibold">
                            {fmtKES(m.savingsBalance)}
                          </td>
                          <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                            {d ? `${fmtKES(d.amount)} · ${d.date}` : "—"}
                          </td>
                          <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                            {w ? `${fmtKES(w.amount)} · ${w.date}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        </div>
      </main>
    </>
  );
}
