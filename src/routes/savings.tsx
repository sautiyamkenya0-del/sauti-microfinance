import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, PiggyBank, ShieldCheck, Wallet } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import {
  listWithdrawalOperationsRecord,
  recordProtectedDocketDepositRecord,
  transferMemberDocketRecord,
} from "@/lib/app-data.functions";
import { fmtKES, memberCategoryLabel, useStore } from "@/lib/store";

export const Route = createFileRoute("/savings")({
  head: () => ({ meta: [{ title: "Savings - Sauti Microfinance" }] }),
  component: SavingsPage,
});

type MoneyDocket =
  | "mandatory_savings"
  | "withdrawable_savings"
  | "loan_savings"
  | "shares"
  | "share_reserve"
  | "purpose_pool"
  | "investment"
  | "penalty_payment";

const MONEY_DOCKETS: Array<[MoneyDocket, string]> = [
  ["mandatory_savings", "Daily compliance contribution"],
  ["withdrawable_savings", "Withdrawable savings"],
  ["loan_savings", "Loan savings"],
  ["shares", "Shares"],
  ["share_reserve", "Share reserve"],
  ["purpose_pool", "Full purpose pool"],
  ["investment", "Investment"],
  ["penalty_payment", "Penalty payment reserve"],
];

const DEPOSIT_DOCKETS = MONEY_DOCKETS;
const TRANSFER_DOCKETS = MONEY_DOCKETS;

function SavingsPage() {
  const { policySettings } = useStore();
  const loadCapitalAccounts = useServerFn(listWithdrawalOperationsRecord);
  const protectedDeposit = useServerFn(recordProtectedDocketDepositRecord);
  const transferDocket = useServerFn(transferMemberDocketRecord);

  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [depositForm, setDepositForm] = useState({
    memberId: "",
    docket: "mandatory_savings" as MoneyDocket,
    amount: 0,
    reason: "",
  });
  const [transferForm, setTransferForm] = useState({
    memberId: "",
    fromDocket: "mandatory_savings" as MoneyDocket,
    toDocket: "withdrawable_savings" as MoneyDocket,
    amount: 0,
    reason: "",
  });

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await loadCapitalAccounts();
      setData(next);
      const firstMember = next.members?.[0]?.id ?? "";
      setDepositForm((current) => ({ ...current, memberId: current.memberId || firstMember }));
      setTransferForm((current) => ({ ...current, memberId: current.memberId || firstMember }));
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load savings accounts.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const members = data?.members ?? [];
  const docketBalances = data?.docketBalances ?? [];
  const movements = data?.docketMovements ?? [];

  const selectedDepositMember = members.find((member: any) => member.id === depositForm.memberId);
  const selectedTransferMember = members.find((member: any) => member.id === transferForm.memberId);

  const policyThreshold = policySettings.percentages.mandatorySavingsThreshold;
  const shareThreshold = policySettings.percentages.mandatorySharesThreshold;

  const balancesByMember = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const member of members) {
      map.set(String(member.id ?? ""), {
        mandatory_savings: Number(member.savings_balance ?? 0),
        withdrawable_savings: 0,
        loan_savings: 0,
        shares: Number(member.shares ?? 0) * 100,
        share_reserve: Number(member.share_reserve_balance ?? 0),
        purpose_pool: 0,
        investment: 0,
        penalty_payment: 0,
      });
    }
    for (const row of docketBalances) {
      const memberId = String(row.member_id ?? "");
      const entry = map.get(memberId) ?? {
        mandatory_savings: 0,
        withdrawable_savings: 0,
        loan_savings: 0,
        shares: 0,
        share_reserve: 0,
        purpose_pool: 0,
        investment: 0,
        penalty_payment: 0,
      };
      entry[String(row.docket ?? "withdrawable_savings")] = Number(row.amount ?? 0);
      map.set(memberId, entry);
    }
    return map;
  }, [docketBalances, members]);

  const complianceTotal = members.reduce(
    (sum: number, member: any) => sum + Number(member.savings_balance ?? 0),
    0,
  );
  const withdrawableTotal = Array.from(balancesByMember.values()).reduce(
    (sum, row) => sum + Number(row.withdrawable_savings ?? 0),
    0,
  );
  const loanSavingsTotal = Array.from(balancesByMember.values()).reduce(
    (sum, row) => sum + Number(row.loan_savings ?? 0),
    0,
  );
  const purposePoolTotal = Array.from(balancesByMember.values()).reduce(
    (sum, row) => sum + Number(row.purpose_pool ?? 0),
    0,
  );
  const investmentTotal = Array.from(balancesByMember.values()).reduce(
    (sum, row) => sum + Number(row.investment ?? 0),
    0,
  );
  const penaltyPaymentTotal = Array.from(balancesByMember.values()).reduce(
    (sum, row) => sum + Number(row.penalty_payment ?? 0),
    0,
  );

  const memberRows = members.map((member: any) => {
    const balances = balancesByMember.get(member.id) ?? {};
    const compliance = Number(member.savings_balance ?? 0);
    const withdrawable = Number(balances.withdrawable_savings ?? 0);
    const loanSavings = Number(balances.loan_savings ?? 0);
    const purposePool = Number(balances.purpose_pool ?? 0);
    const investment = Number(balances.investment ?? 0);
    const penaltyPayment = Number(balances.penalty_payment ?? 0);
    const shareValue =
      Number(member.shares ?? 0) * 100 + Number(member.share_reserve_balance ?? 0);
    const lastMovement = movements.find((row: any) => row.member_id === member.id);
    return {
      member,
      compliance,
      thresholdGap: Math.max(0, policyThreshold - compliance),
      withdrawable,
      loanSavings,
      purposePool,
      investment,
      penaltyPayment,
      shareValue,
      shareGap: Math.max(0, shareThreshold - shareValue),
      lastMovement,
    };
  });

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setBusy(true);
      await action();
      toast.success(success);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Savings & Money Dockets"
        subtitle="Daily compliance contribution, withdrawable savings, loan savings, purpose pool, investments, and director-controlled docket movement."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="capital" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Daily compliance contribution"
            value={fmtKES(complianceTotal)}
            icon={<ShieldCheck className="h-5 w-5" />}
            tone="success"
          />
          <StatCard
            label="Mandatory threshold"
            value={`${fmtKES(policyThreshold)} / ${fmtKES(shareThreshold)}`}
            icon={<PiggyBank className="h-5 w-5" />}
          />
          <StatCard
            label="Withdrawable savings"
            value={fmtKES(withdrawableTotal)}
            icon={<Wallet className="h-5 w-5" />}
            tone="warning"
          />
          <StatCard
            label="Loan savings"
            value={fmtKES(loanSavingsTotal)}
            icon={<ArrowRightLeft className="h-5 w-5" />}
          />
          <StatCard label="Full purpose pool" value={fmtKES(purposePoolTotal)} />
          <StatCard label="Investment docket" value={fmtKES(investmentTotal)} />
          <StatCard label="Penalty reserve" value={fmtKES(penaltyPaymentTotal)} />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Post direct docket deposit">
            <div className="space-y-3 p-5">
              <MemberSelect
                members={members}
                value={depositForm.memberId}
                onChange={(value) => setDepositForm((current) => ({ ...current, memberId: value }))}
              />
              <Select
                value={depositForm.docket}
                onChange={(value) =>
                  setDepositForm((current) => ({ ...current, docket: value as MoneyDocket }))
                }
                options={DEPOSIT_DOCKETS}
              />
              <Input
                type="number"
                value={depositForm.amount || ""}
                onChange={(value) =>
                  setDepositForm((current) => ({ ...current, amount: Number(value) }))
                }
                placeholder="Amount"
              />
              <Input
                value={depositForm.reason}
                onChange={(value) => setDepositForm((current) => ({ ...current, reason: value }))}
                placeholder="Source / note"
              />
              <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                {depositForm.docket === "mandatory_savings"
                  ? `Posts as a direct daily compliance contribution. Threshold target is ${fmtKES(policyThreshold)} before loan savings can open.`
                  : depositForm.docket === "withdrawable_savings"
                    ? "Targeted withdrawable savings stays in that docket and will not be redistributed by carryover resets or automatic redistribution."
                    : depositForm.docket === "loan_savings"
                      ? `Loan savings opens only after compliance contribution ${fmtKES(policyThreshold)} and share threshold ${fmtKES(shareThreshold)} are both met.`
                      : depositForm.docket === "purpose_pool"
                        ? "Receiving into full purpose pool includes Operations/Admin as part of the pool."
                        : depositForm.docket === "shares"
                          ? "Share deposits must be in exact share-price increments."
                          : depositForm.docket === "penalty_payment"
                            ? "Penalty payment can clear outstanding penalties first, then include the daily loan obligation where policy requires it."
                            : "Posts directly to the selected money-holding docket."}
              </div>
              {selectedDepositMember ? (
                <div className="text-xs text-muted-foreground">
                  {selectedDepositMember.id} - {selectedDepositMember.name}
                </div>
              ) : null}
              <button
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    await protectedDeposit({
                      data: {
                        memberId: depositForm.memberId,
                        docket: depositForm.docket,
                        amount: depositForm.amount,
                        reason: depositForm.reason,
                      },
                    });
                    setDepositForm((current) => ({ ...current, amount: 0, reason: "" }));
                  }, "Targeted deposit posted.")
                }
                className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Post deposit
              </button>
            </div>
          </Section>

          <Section title="Move money between dockets">
            <div className="space-y-3 p-5">
              <MemberSelect
                members={members}
                value={transferForm.memberId}
                onChange={(value) =>
                  setTransferForm((current) => ({ ...current, memberId: value }))
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={transferForm.fromDocket}
                  onChange={(value) =>
                    setTransferForm((current) => ({
                      ...current,
                      fromDocket: value as MoneyDocket,
                    }))
                  }
                  options={TRANSFER_DOCKETS}
                />
                <Select
                  value={transferForm.toDocket}
                  onChange={(value) =>
                    setTransferForm((current) => ({ ...current, toDocket: value as MoneyDocket }))
                  }
                  options={TRANSFER_DOCKETS}
                />
              </div>
              <Input
                type="number"
                value={transferForm.amount || ""}
                onChange={(value) =>
                  setTransferForm((current) => ({ ...current, amount: Number(value) }))
                }
                placeholder="Amount"
              />
              <Input
                value={transferForm.reason}
                onChange={(value) =>
                  setTransferForm((current) => ({ ...current, reason: value }))
                }
                placeholder="Reason for transfer"
              />
              {selectedTransferMember ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Admin-controlled transfer for {selectedTransferMember.name}. Use this when moving
                  funds between any money-holding docket. If Full purpose pool is the source,
                  Operations/Admin is excluded and remains reserved; if Full purpose pool is
                  receiving, Operations/Admin is included.
                </div>
              ) : null}
              <button
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    await transferDocket({
                      data: {
                        memberId: transferForm.memberId,
                        fromDocket: transferForm.fromDocket,
                        toDocket: transferForm.toDocket,
                        amount: transferForm.amount,
                        reason: transferForm.reason,
                      },
                    });
                    setTransferForm((current) => ({ ...current, amount: 0, reason: "" }));
                  }, "Docket transfer completed.")
                }
                className="w-full rounded-md border border-border py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Move funds
              </button>
            </div>
          </Section>
        </div>

        <Section title="Member docket positions">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Member</th>
                  <th className="px-5 py-3 text-right">Compliance contribution</th>
                  <th className="px-5 py-3 text-right">Gap to threshold</th>
                  <th className="px-5 py-3 text-right">Withdrawable savings</th>
                  <th className="px-5 py-3 text-right">Loan savings</th>
                  <th className="px-5 py-3 text-right">Shares basket</th>
                  <th className="px-5 py-3 text-right">Other dockets</th>
                  <th className="px-5 py-3 text-left">Last docket movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {memberRows.map((row) => (
                  <tr key={row.member.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{row.member.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.member.id} - {memberCategoryLabel(row.member.member_category)}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {fmtKES(row.compliance)}
                    </td>
                    <td className="px-5 py-3 text-right text-xs">
                      {row.thresholdGap > 0 ? fmtKES(row.thresholdGap) : "Met"}
                    </td>
                    <td className="px-5 py-3 text-right">{fmtKES(row.withdrawable)}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(row.loanSavings)}</td>
                    <td className="px-5 py-3 text-right">
                      <div>{fmtKES(row.shareValue)}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.shareGap > 0 ? `Gap ${fmtKES(row.shareGap)}` : "Threshold met"}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-xs">
                      <div>Purpose {fmtKES(row.purposePool)}</div>
                      <div>Investment {fmtKES(row.investment)}</div>
                      <div>Penalty {fmtKES(row.penaltyPayment)}</div>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {row.lastMovement
                        ? `${row.lastMovement.from_docket ?? "deposit"} -> ${row.lastMovement.to_docket ?? "-"}`
                        : "No movement recorded"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<readonly [string, string]>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue || label} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}

function MemberSelect({
  members,
  value,
  onChange,
}: {
  members: any[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={members.map((member: any) => [
        member.id,
        `${member.id} - ${member.name} (${memberCategoryLabel(member.member_category)})`,
      ])}
    />
  );
}
