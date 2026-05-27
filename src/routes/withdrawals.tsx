import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, HandCoins, RefreshCw, WalletCards } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import {
  listWithdrawalOperationsRecord,
  recordSystemOutflowRecord,
} from "@/lib/app-data.functions";
import { fmtKES, memberCategoryLabel, useStore } from "@/lib/store";

export const Route = createFileRoute("/withdrawals")({
  head: () => ({ meta: [{ title: "Withdrawals - Sauti Microfinance" }] }),
  component: WithdrawalsPage,
});

function WithdrawalsPage() {
  const { currentUser } = useStore();
  const loadOps = useServerFn(listWithdrawalOperationsRecord);
  const recordOutflow = useServerFn(recordSystemOutflowRecord);

  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [outflowForm, setOutflowForm] = useState({
    kind: "client_withdrawal",
    memberId: "",
    supplierId: "",
    supplierRequestId: "",
    investorId: "",
    staffId: "",
    loanId: "",
    receiverName: "",
    receiverPhone: "",
    amount: 0,
    method: "cash",
    note: "",
  });

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await loadOps();
      setData(next);
      setOutflowForm((current) => ({
        ...current,
        memberId: current.memberId || next.members?.[0]?.id || "",
        supplierId: current.supplierId || next.suppliers?.[0]?.id || "",
        investorId: current.investorId || next.investors?.[0]?.id || "",
        staffId: current.staffId || next.staff?.[0]?.id || "",
      }));
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load withdrawal operations.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const members = data?.members ?? [];
  const suppliers = data?.suppliers ?? [];
  const investors = data?.investors ?? [];
  const staff = data?.staff ?? [];
  const outflows = data?.outflows ?? [];
  const supplierRequests = data?.supplierRequests ?? [];
  const loans = data?.loans ?? [];
  const cashSummary = data?.cashSummary ?? { available: 0, inflow: 0, outflow: 0, pending: 0 };

  const supplierPaymentQueue = useMemo(
    () => supplierRequests.filter((request: any) => request.status === "fulfilled"),
    [supplierRequests],
  );

  const selectedMember = members.find((member: any) => member.id === outflowForm.memberId);
  const selectedSupplier = suppliers.find(
    (supplier: any) => supplier.id === outflowForm.supplierId,
  );
  const selectedInvestor = investors.find(
    (investor: any) => investor.id === outflowForm.investorId,
  );
  const selectedStaff = staff.find((person: any) => person.id === outflowForm.staffId);

  const totalOutflows = outflows.reduce(
    (sum: number, row: any) => sum + Number(row.amount ?? 0),
    0,
  );
  const supplierDebt = supplierPaymentQueue.reduce(
    (sum: number, row: any) => sum + Number(row.amount ?? 0),
    0,
  );

  useEffect(() => {
    if (outflowForm.kind === "client_withdrawal" && selectedMember) {
      setOutflowForm((current) => ({
        ...current,
        receiverName: selectedMember.name,
        receiverPhone: selectedMember.phone ?? "",
      }));
    }
  }, [outflowForm.kind, selectedMember]);

  useEffect(() => {
    if (outflowForm.kind === "supplier_payment" && selectedSupplier) {
      setOutflowForm((current) => ({
        ...current,
        receiverName: selectedSupplier.name,
        receiverPhone: selectedSupplier.phone ?? "",
      }));
    }
  }, [outflowForm.kind, selectedSupplier]);

  useEffect(() => {
    if (outflowForm.kind === "investor_withdrawal" && selectedInvestor) {
      setOutflowForm((current) => ({
        ...current,
        receiverName: selectedInvestor.name,
        receiverPhone: selectedInvestor.phone ?? "",
      }));
    }
  }, [outflowForm.kind, selectedInvestor]);

  useEffect(() => {
    if (
      (outflowForm.kind === "staff_payment" || outflowForm.kind === "petty_cash") &&
      selectedStaff
    ) {
      setOutflowForm((current) => ({
        ...current,
        receiverName: selectedStaff.name,
        receiverPhone: selectedStaff.phone ?? "",
      }));
    }
  }, [outflowForm.kind, selectedStaff]);

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setBusy(true);
      await action();
      toast.success(success);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "That outflow could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Withdrawals & Outflows"
        subtitle="Director control for client withdrawals, supplier payments, investor cash-outs, staff payments, and loan disbursement outflows."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="capital" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Available cash"
            value={fmtKES(cashSummary.available)}
            icon={<WalletCards className="h-5 w-5" />}
            tone="success"
          />
          <StatCard
            label="Pending payouts"
            value={fmtKES(cashSummary.pending)}
            icon={<HandCoins className="h-5 w-5" />}
            tone="warning"
          />
          <StatCard
            label="Outstanding supplier payments"
            value={fmtKES(supplierDebt)}
            icon={<Building2 className="h-5 w-5" />}
            tone="destructive"
          />
          <StatCard
            label="Recorded outflows"
            value={fmtKES(totalOutflows)}
            icon={<HandCoins className="h-5 w-5" />}
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => refresh()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
          <Section title="Record outflow">
            <div className="space-y-3 p-5">
              <Select
                value={outflowForm.kind}
                onChange={(value) =>
                  setOutflowForm((current) => ({
                    ...current,
                    kind: value,
                    supplierRequestId: "",
                    loanId: "",
                  }))
                }
                options={[
                  ["client_withdrawal", "Client withdrawal"],
                  ["supplier_payment", "Supplier payment"],
                  ["investor_withdrawal", "Investor withdrawal"],
                  ["staff_payment", "Staff payment"],
                  ["loan_disbursement", "Loan disbursement"],
                  ["petty_cash", "Petty cash"],
                  ["other", "Other"],
                ]}
              />

              {outflowForm.kind === "client_withdrawal" ? (
                <MemberSearchSelect
                  members={members}
                  value={outflowForm.memberId}
                  onChange={(value) =>
                    setOutflowForm((current) => ({ ...current, memberId: value }))
                  }
                  describeMember={(member: any) =>
                    `${member.id} - ${member.name} (${memberCategoryLabel(member.member_category)})`
                  }
                />
              ) : null}

              {outflowForm.kind === "supplier_payment" ? (
                <>
                  <Select
                    value={outflowForm.supplierId}
                    onChange={(value) =>
                      setOutflowForm((current) => ({
                        ...current,
                        supplierId: value,
                        supplierRequestId: "",
                      }))
                    }
                    options={suppliers.map((supplier: any) => [
                      supplier.id,
                      `${supplier.name} (${supplier.kind})`,
                    ])}
                  />
                  <Select
                    value={outflowForm.supplierRequestId}
                    onChange={(value) => {
                      const request = supplierPaymentQueue.find((row: any) => row.id === value);
                      setOutflowForm((current) => ({
                        ...current,
                        supplierRequestId: value,
                        amount: request ? Number(request.amount ?? 0) : current.amount,
                        loanId: request?.loan_id ?? "",
                        memberId: request?.member_id ?? current.memberId,
                      }));
                    }}
                    options={[
                      ["", "Select fulfilled supplier request"],
                      ...supplierPaymentQueue
                        .filter((request: any) => request.supplier_id === outflowForm.supplierId)
                        .map((request: any) => [
                          request.id,
                          `${request.id} - ${fmtKES(Number(request.amount ?? 0))}`,
                        ]),
                    ]}
                  />
                </>
              ) : null}

              {outflowForm.kind === "investor_withdrawal" ? (
                <Select
                  value={outflowForm.investorId}
                  onChange={(value) =>
                    setOutflowForm((current) => ({ ...current, investorId: value }))
                  }
                  options={investors.map((investor: any) => [
                    investor.id,
                    `${investor.id} - ${investor.name}`,
                  ])}
                />
              ) : null}

              {outflowForm.kind === "staff_payment" || outflowForm.kind === "petty_cash" ? (
                <Select
                  value={outflowForm.staffId}
                  onChange={(value) =>
                    setOutflowForm((current) => ({ ...current, staffId: value }))
                  }
                  options={staff.map((person: any) => [
                    person.id,
                    `${person.name} (${person.role})`,
                  ])}
                />
              ) : null}

              {outflowForm.kind === "loan_disbursement" ? (
                <>
                  <MemberSearchSelect
                    members={members}
                    value={outflowForm.memberId}
                    onChange={(value) =>
                      setOutflowForm((current) => ({ ...current, memberId: value, loanId: "" }))
                    }
                    describeMember={(member: any) => `${member.id} - ${member.name}`}
                  />
                  <Select
                    value={outflowForm.loanId}
                    onChange={(value) =>
                      setOutflowForm((current) => ({ ...current, loanId: value }))
                    }
                    options={[
                      ["", "Select loan"],
                      ...loans
                        .filter((loan: any) => loan.member_id === outflowForm.memberId)
                        .map((loan: any) => [
                          loan.id,
                          `${loan.id} - ${loan.status} - ${fmtKES(Number(loan.approved_amount ?? loan.principal ?? 0))}`,
                        ]),
                    ]}
                  />
                </>
              ) : null}

              <Input
                value={outflowForm.receiverName}
                onChange={(value) =>
                  setOutflowForm((current) => ({ ...current, receiverName: value }))
                }
                placeholder="Receiver name"
              />
              <Input
                value={outflowForm.receiverPhone}
                onChange={(value) =>
                  setOutflowForm((current) => ({ ...current, receiverPhone: value }))
                }
                placeholder="Receiver phone"
              />
              <Input
                type="number"
                value={outflowForm.amount || ""}
                onChange={(value) =>
                  setOutflowForm((current) => ({ ...current, amount: Number(value) }))
                }
                placeholder="Amount"
              />
              <Select
                value={outflowForm.method}
                onChange={(value) => setOutflowForm((current) => ({ ...current, method: value }))}
                options={[
                  ["cash", "Cash"],
                  ["mpesa", "M-Pesa"],
                  ["bank", "Bank"],
                  ["internal", "Internal transfer"],
                ]}
              />
              <Input
                value={outflowForm.note}
                onChange={(value) => setOutflowForm((current) => ({ ...current, note: value }))}
                placeholder="Reason / note"
              />
              <button
                disabled={busy || currentUser.role !== "director"}
                onClick={() =>
                  runAction(async () => {
                    await recordOutflow({
                      data: {
                        kind: outflowForm.kind,
                        amount: outflowForm.amount,
                        receiverName: outflowForm.receiverName,
                        receiverPhone: outflowForm.receiverPhone || undefined,
                        method: outflowForm.method,
                        memberId: outflowForm.memberId || undefined,
                        investorId: outflowForm.investorId || undefined,
                        staffId: outflowForm.staffId || undefined,
                        supplierId: outflowForm.supplierId || undefined,
                        loanId: outflowForm.loanId || undefined,
                        supplierRequestId: outflowForm.supplierRequestId || undefined,
                        note: outflowForm.note || undefined,
                      },
                    });
                    setOutflowForm((current) => ({
                      ...current,
                      amount: 0,
                      note: "",
                      supplierRequestId: "",
                    }));
                  }, "Outflow recorded.")
                }
                className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Record outflow
              </button>
              {currentUser.role !== "director" ? (
                <div className="text-xs text-muted-foreground">
                  Only the director can finalize outgoing cash and supplier payments.
                </div>
              ) : null}
            </div>
          </Section>

          <Section title="Supplier payments waiting">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left">Supplier</th>
                    <th className="px-5 py-3 text-left">Client / loan</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {supplierPaymentQueue.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                        No supplier payments are waiting right now.
                      </td>
                    </tr>
                  ) : null}
                  {supplierPaymentQueue.map((request: any) => {
                    const supplier = suppliers.find((row: any) => row.id === request.supplier_id);
                    const member = members.find((row: any) => row.id === request.member_id);
                    return (
                      <tr key={request.id}>
                        <td className="px-5 py-3 font-medium">
                          {supplier?.name ?? request.supplier_id}
                        </td>
                        <td className="px-5 py-3">
                          <div>{member?.name ?? request.member_id}</div>
                          <div className="text-xs text-muted-foreground">
                            {request.loan_id || request.id}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">
                          {fmtKES(Number(request.amount ?? 0))}
                        </td>
                        <td className="px-5 py-3 capitalize">{request.status}</td>
                        <td className="px-5 py-3 text-right">
                          {currentUser.role === "director" ? (
                            <button
                              onClick={() =>
                                runAction(async () => {
                                  await recordOutflow({
                                    data: {
                                      kind: "supplier_payment",
                                      amount: Number(request.amount ?? 0),
                                      receiverName: supplier?.name ?? "Supplier",
                                      receiverPhone: supplier?.phone ?? undefined,
                                      method: "cash",
                                      supplierId: request.supplier_id,
                                      loanId: request.loan_id ?? undefined,
                                      memberId: request.member_id ?? undefined,
                                      supplierRequestId: request.id,
                                      note: `Payment for supplier request ${request.id}`,
                                    },
                                  });
                                }, "Supplier payment recorded.")
                              }
                              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                            >
                              Pay supplier
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Director action</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <Section title="Recent outflows">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Receiver</th>
                  <th className="px-5 py-3 text-left">Kind</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-left">Method</th>
                  <th className="px-5 py-3 text-left">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {outflows.slice(0, 20).map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-5 py-3 font-medium">{row.receiver_name}</td>
                    <td className="px-5 py-3 capitalize">
                      {String(row.kind ?? "").replace(/_/g, " ")}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {fmtKES(Number(row.amount ?? 0))}
                    </td>
                    <td className="px-5 py-3">{row.method}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{row.note || "-"}</td>
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
