import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, Badge, DirectorOnly, StatCard } from "@/components/ui-bits";
import { useStore, fmtKES } from "@/lib/store";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Scale, Smartphone } from "lucide-react";

export const Route = createFileRoute("/transactions")({
  head: () => ({ meta: [{ title: "Transactions — Sauti Microfinance" }] }),
  component: TxPage,
});

const TYPES = [
  "all",
  "deposit",
  "withdrawal",
  "loan_disbursement",
  "loan_repayment",
  "share_purchase",
  "petty_cash",
  "investor_contribution",
  "fee_payment",
] as const;

const INFLOWS: ReadonlyArray<string> = [
  "deposit",
  "loan_repayment",
  "share_purchase",
  "investor_contribution",
  "fee_payment",
];
const OUTFLOWS: ReadonlyArray<string> = ["withdrawal", "loan_disbursement", "petty_cash"];

function TxPage() {
  const { transactions, members, staff, applyMpesaPayment, currentUser } = useStore();
  const [filter, setFilter] = useState<(typeof TYPES)[number]>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [memberFilter, setMemberFilter] = useState<string>("");
  const [simOpen, setSimOpen] = useState(false);
  const [simAccount, setSimAccount] = useState("SBC001");
  const [simAmount, setSimAmount] = useState(2000);
  const [simName, setSimName] = useState("JOSEPH KARIUKI");

  const list = useMemo(
    () =>
      transactions.filter((t) => {
        if (filter !== "all" && t.type !== filter) return false;
        if (from && t.date < from) return false;
        if (to && t.date > to) return false;
        if (memberFilter && t.memberId !== memberFilter) return false;
        return true;
      }),
    [transactions, filter, from, to, memberFilter],
  );

  const totals = useMemo(() => {
    const inflow = list.filter((t) => INFLOWS.includes(t.type)).reduce((s, t) => s + t.amount, 0);
    const outflow = list.filter((t) => OUTFLOWS.includes(t.type)).reduce((s, t) => s + t.amount, 0);
    return { inflow, outflow, net: inflow - outflow };
  }, [list]);

  return (
    <>
      <AppHeader title="Transactions" subtitle="Unified ledger across all financial activity." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="capital" />
        <DirectorOnly>
          <div className="grid md:grid-cols-3 gap-4">
            <StatCard
              label="Inflow"
              value={fmtKES(totals.inflow)}
              hint="Filtered period"
              icon={<ArrowDownCircle className="h-5 w-5" />}
              tone="success"
            />
            <StatCard
              label="Outflow"
              value={fmtKES(totals.outflow)}
              hint="Filtered period"
              icon={<ArrowUpCircle className="h-5 w-5" />}
              tone="warning"
            />
            <StatCard
              label="Net"
              value={fmtKES(totals.net)}
              hint="Inflow − Outflow"
              icon={<Scale className="h-5 w-5" />}
              tone={totals.net >= 0 ? "success" : "destructive"}
            />
          </div>
        </DirectorOnly>

        <div className="bg-card border border-border rounded-xl p-4 grid md:grid-cols-4 gap-3 items-end">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Member
            </span>
            <select
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
            >
              <option value="">All members</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end justify-end gap-2">
            {(currentUser.role === "director" || currentUser.role === "manager") && (
              <button
                onClick={() => setSimOpen(true)}
                className="inline-flex items-center gap-2 bg-accent/30 hover:bg-accent/50 text-accent-foreground text-sm font-medium px-3 py-2 rounded-md"
              >
                <Smartphone className="h-4 w-4" /> Test M-Pesa inbound
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-full text-xs capitalize ${filter === t ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-muted"}`}
            >
              {t.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        <Section title={`Ledger (${list.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Name</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-left">From (Membership #)</th>
                  <th className="px-5 py-3 text-left">Ref (M-Pesa)</th>
                  <th className="px-5 py-3 text-left">Date / Time</th>
                  <th className="px-5 py-3 text-left">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((t) => {
                  const m = members.find((x) => x.id === t.memberId);
                  const s = staff.find((x) => x.id === t.by);
                  const tone =
                    t.type.includes("withdrawal") || t.type === "petty_cash"
                      ? "warning"
                      : t.type.includes("repayment")
                        ? "success"
                        : t.type.includes("disbursement")
                          ? "destructive"
                          : "default";
                  const account = t.account ?? t.memberId ?? "—";
                  const displayName = t.payerName ?? m?.name ?? t.note ?? "—";
                  return (
                    <tr key={t.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3 font-medium">
                        {displayName}
                        {t.loanId && (
                          <span className="text-xs text-muted-foreground"> · {t.loanId}</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold">{fmtKES(t.amount)}</td>
                      <td className="px-5 py-3">
                        <Badge tone={tone}>{t.type.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs">{account}</td>
                      <td className="px-5 py-3 font-mono text-xs">{t.ref ?? t.id}</td>
                      <td className="px-5 py-3 text-muted-foreground text-xs">{t.date}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{s?.name ?? t.by}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {simOpen && (
          <div
            className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4"
            onClick={() => setSimOpen(false)}
          >
            <div
              className="bg-card rounded-xl border border-border w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="font-display text-lg font-semibold mb-1">Simulate M-Pesa Paybill</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Mirrors the same allocation engine the live C2B callback will run.
              </p>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-[11px] uppercase text-muted-foreground">
                    Account number (e.g. SBC001)
                  </span>
                  <input
                    value={simAccount}
                    onChange={(e) => setSimAccount(e.target.value)}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase text-muted-foreground">Amount (KSh)</span>
                  <input
                    type="number"
                    value={simAmount}
                    onChange={(e) => setSimAmount(Number(e.target.value))}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase text-muted-foreground">Payer name</span>
                  <input
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setSimOpen(false)}
                  className="px-3 py-1.5 text-sm rounded-md hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const r = applyMpesaPayment(
                      simAccount,
                      simAmount,
                      simName,
                      `SIM${Date.now().toString().slice(-6)}`,
                    );
                    if (!r.matched) toast.error(r.notes.join(" "));
                    else toast.success(r.notes.join(" "));
                    setSimOpen(false);
                  }}
                  className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Run allocation
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
