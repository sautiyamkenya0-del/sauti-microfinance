import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import {
  createSupplierFulfillmentRequestRecord,
  createSupplierRecord,
  listWithdrawalOperationsRecord,
  markSupplierFulfilledRecord,
  recordProtectedDocketDepositRecord,
  recordSystemOutflowRecord,
  transferMemberDocketRecord,
} from "@/lib/app-data.functions";
import { fmtKES, memberCategoryLabel } from "@/lib/store";
import {
  Building2,
  CheckCircle2,
  Fuel,
  HandCoins,
  Package,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/withdrawals")({
  head: () => ({ meta: [{ title: "Withdrawals - Sauti Microfinance" }] }),
  component: WithdrawalsPage,
});

type Docket =
  | "withdrawable_savings"
  | "mandatory_savings"
  | "loan_savings"
  | "shares"
  | "share_reserve"
  | "purpose_pool"
  | "investment"
  | "penalty_payment";

const DOCKETS: { value: Docket; label: string }[] = [
  { value: "withdrawable_savings", label: "Withdrawable savings" },
  { value: "mandatory_savings", label: "Compliance savings" },
  { value: "loan_savings", label: "Loan / multiplier savings" },
  { value: "shares", label: "Shares" },
  { value: "share_reserve", label: "Share reserve" },
  { value: "purpose_pool", label: "Purpose pool" },
  { value: "investment", label: "Investment" },
  { value: "penalty_payment", label: "Pay penalties" },
];

const SUPPLIER_KINDS = [
  { value: "fuel", label: "Fuel supplier" },
  { value: "stock", label: "Stock supplier" },
  { value: "service", label: "Service supplier" },
] as const;

function WithdrawalsPage() {
  const loadOps = useServerFn(listWithdrawalOperationsRecord);
  const transferDocket = useServerFn(transferMemberDocketRecord);
  const protectedDeposit = useServerFn(recordProtectedDocketDepositRecord);
  const createSupplier = useServerFn(createSupplierRecord);
  const createSupplierRequest = useServerFn(createSupplierFulfillmentRequestRecord);
  const markFulfilled = useServerFn(markSupplierFulfilledRecord);
  const recordOutflow = useServerFn(recordSystemOutflowRecord);

  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const members = data?.members ?? [];
  const suppliers = data?.suppliers ?? [];
  const requests = data?.supplierRequests ?? [];
  const loans = data?.loans ?? [];
  const outflows = data?.outflows ?? [];
  const docketBalances = data?.docketBalances ?? [];
  const movements = data?.docketMovements ?? [];
  const penalties = data?.penalties ?? [];

  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [fromDocket, setFromDocket] = useState<Docket>("mandatory_savings");
  const [toDocket, setToDocket] = useState<Docket>("withdrawable_savings");
  const [docketAmount, setDocketAmount] = useState(0);
  const [docketReason, setDocketReason] = useState("");

  const [depositMemberId, setDepositMemberId] = useState("");
  const [depositDocket, setDepositDocket] = useState<Docket>("withdrawable_savings");
  const [depositAmount, setDepositAmount] = useState(0);
  const [depositReason, setDepositReason] = useState("");

  const [outflowKind, setOutflowKind] = useState("client_withdrawal");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [outflowAmount, setOutflowAmount] = useState(0);
  const [outflowMethod, setOutflowMethod] = useState("cash");
  const [outflowNote, setOutflowNote] = useState("");

  const [supplierName, setSupplierName] = useState("");
  const [supplierKind, setSupplierKind] = useState<"fuel" | "stock" | "service">("fuel");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierLocation, setSupplierLocation] = useState("");

  const [requestSupplierId, setRequestSupplierId] = useState("");
  const [supplierPortalId, setSupplierPortalId] = useState("");
  const [requestMemberId, setRequestMemberId] = useState("");
  const [requestLoanId, setRequestLoanId] = useState("");
  const [requestKind, setRequestKind] = useState<"fuel" | "stock" | "service">("fuel");
  const [requestAmount, setRequestAmount] = useState(0);
  const [requestDetail, setRequestDetail] = useState({
    item: "",
    quantity: "",
    unitPrice: "",
    vehicle: "",
    fuelType: "",
    notes: "",
  });

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await loadOps();
      setData(next);
      const firstMember = next.members?.[0]?.id ?? "";
      const firstSupplier = next.suppliers?.[0]?.id ?? "";
      setSelectedMemberId((current) => current || firstMember);
      setDepositMemberId((current) => current || firstMember);
      setRequestMemberId((current) => current || firstMember);
      setRequestSupplierId((current) => current || firstSupplier);
      setSupplierPortalId((current) => current || firstSupplier);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load withdrawal operations.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const cashSummary = data?.cashSummary ?? { available: 0, inflow: 0, outflow: 0, pending: 0 };
  const supplierDebt = requests
    .filter((row: any) => row.status === "fulfilled")
    .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
  const paidSuppliers = outflows
    .filter((row: any) => row.kind === "supplier_payment")
    .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
  const selectedMember = members.find((member: any) => member.id === selectedMemberId);
  const depositMember = members.find((member: any) => member.id === depositMemberId);
  const depositPenaltyTotal = penalties
    .filter(
      (penalty: any) => penalty.member_id === depositMemberId && penalty.status === "outstanding",
    )
    .reduce((sum: number, penalty: any) => sum + Number(penalty.amount ?? 0), 0);
  const depositActiveLoan = loans.find(
    (loan: any) =>
      loan.member_id === depositMemberId &&
      (loan.status === "defaulted" || loan.status === "active"),
  );
  const depositDailyDue = depositActiveLoan ? estimateDailyLoanDue(depositActiveLoan) : 0;
  const memberDocketRows = useMemo(() => {
    if (!selectedMember) return [];
    const fromTable = new Map(
      docketBalances
        .filter((row: any) => row.member_id === selectedMember.id)
        .map((row: any) => [row.docket, Number(row.amount ?? 0)]),
    );
    return DOCKETS.map((docket) => {
      let amount = Number(fromTable.get(docket.value) ?? 0);
      if (docket.value === "mandatory_savings")
        amount = Number(selectedMember.savings_balance ?? 0);
      if (docket.value === "shares") amount = Number(selectedMember.shares ?? 0) * 100;
      if (docket.value === "share_reserve")
        amount = Number(selectedMember.share_reserve_balance ?? 0);
      return { ...docket, amount };
    });
  }, [docketBalances, selectedMember]);

  const memberLoans = loans.filter((loan: any) => loan.member_id === requestMemberId);
  const supplierPortalRequests = requests.filter(
    (request: any) => request.supplier_id === supplierPortalId,
  );

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setBusy(true);
      await action();
      toast.success(success);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Withdrawals & Supplier Operations"
        subtitle="Director outflows, protected member dockets, and supplier-backed loan fulfillment."
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
            label="Supplier debt"
            value={fmtKES(supplierDebt)}
            icon={<Building2 className="h-5 w-5" />}
            tone="destructive"
          />
          <StatCard
            label="Suppliers paid"
            value={fmtKES(paidSuppliers)}
            icon={<CheckCircle2 className="h-5 w-5" />}
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

        <div className="grid gap-6 xl:grid-cols-3">
          <Section title="Record outflow">
            <div className="space-y-3 p-5">
              <Select
                value={outflowKind}
                onChange={setOutflowKind}
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
              <Input placeholder="Receiver name" value={receiverName} onChange={setReceiverName} />
              <Input
                placeholder="Receiver phone"
                value={receiverPhone}
                onChange={setReceiverPhone}
              />
              <Input
                type="number"
                placeholder="Amount"
                value={outflowAmount || ""}
                onChange={(value) => setOutflowAmount(Number(value))}
              />
              <Select
                value={outflowMethod}
                onChange={setOutflowMethod}
                options={[
                  ["cash", "Cash"],
                  ["mpesa", "M-Pesa"],
                  ["bank", "Bank"],
                  ["internal", "Internal transfer"],
                ]}
              />
              <Input placeholder="Note" value={outflowNote} onChange={setOutflowNote} />
              <button
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    await recordOutflow({
                      data: {
                        kind: outflowKind,
                        amount: outflowAmount,
                        receiverName,
                        receiverPhone,
                        method: outflowMethod,
                        note: outflowNote,
                      },
                    });
                    setOutflowAmount(0);
                    setReceiverName("");
                    setReceiverPhone("");
                    setOutflowNote("");
                  }, "Outflow recorded.")
                }
                className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Record outflow
              </button>
            </div>
          </Section>

          <Section title="Protected deposit">
            <div className="space-y-3 p-5">
              <MemberSelect
                members={members}
                value={depositMemberId}
                onChange={setDepositMemberId}
              />
              <DocketSelect value={depositDocket} onChange={setDepositDocket} />
              <Input
                type="number"
                placeholder="Amount"
                value={depositAmount || ""}
                onChange={(value) => setDepositAmount(Number(value))}
              />
              <Input
                placeholder="Reason / source"
                value={depositReason}
                onChange={setDepositReason}
              />
              {depositMember ? (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {depositDocket === "penalty_payment" ? (
                    <>
                      Penalties due {fmtKES(depositPenaltyTotal)}. Include today's loan repayment{" "}
                      {fmtKES(depositDailyDue)} when the member is clearing penalties.
                    </>
                  ) : (
                    <>
                      Targeted money stays in this docket and is not redistributed by carryover
                      resets or purpose-pool redistribution.
                    </>
                  )}
                </div>
              ) : null}
              {depositDocket === "penalty_payment" && depositPenaltyTotal + depositDailyDue > 0 ? (
                <button
                  type="button"
                  onClick={() => setDepositAmount(depositPenaltyTotal + depositDailyDue)}
                  className="w-full rounded-md border border-border py-2 text-sm hover:bg-muted"
                >
                  Use penalty + daily due total
                </button>
              ) : null}
              <button
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    await protectedDeposit({
                      data: {
                        memberId: depositMemberId,
                        docket: depositDocket,
                        amount: depositAmount,
                        reason: depositReason,
                      },
                    });
                    setDepositAmount(0);
                    setDepositReason("");
                  }, "Protected deposit recorded.")
                }
                className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Deposit to docket
              </button>
            </div>
          </Section>

          <Section title="Move member money">
            <div className="space-y-3 p-5">
              <MemberSelect
                members={members}
                value={selectedMemberId}
                onChange={setSelectedMemberId}
              />
              <div className="grid grid-cols-2 gap-2">
                <DocketSelect value={fromDocket} onChange={setFromDocket} />
                <DocketSelect value={toDocket} onChange={setToDocket} />
              </div>
              <Input
                type="number"
                placeholder="Amount"
                value={docketAmount || ""}
                onChange={(value) => setDocketAmount(Number(value))}
              />
              <Input placeholder="Reason" value={docketReason} onChange={setDocketReason} />
              <button
                disabled={busy}
                onClick={() =>
                  runAction(async () => {
                    await transferDocket({
                      data: {
                        memberId: selectedMemberId,
                        fromDocket,
                        toDocket,
                        amount: docketAmount,
                        reason: docketReason,
                      },
                    });
                    setDocketAmount(0);
                    setDocketReason("");
                  }, "Docket transfer completed.")
                }
                className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Move funds
              </button>
            </div>
          </Section>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <Section title="Member dockets">
            <div className="p-5">
              <div className="mb-3">
                <MemberSelect
                  members={members}
                  value={selectedMemberId}
                  onChange={setSelectedMemberId}
                />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Docket</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {memberDocketRows.map((row) => (
                      <tr key={row.value}>
                        <td className="px-4 py-3">{row.label}</td>
                        <td className="px-4 py-3 text-right font-medium">{fmtKES(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          <Section title="Supplier requests">
            <div className="grid gap-5 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                <div className="text-sm font-semibold">Register supplier</div>
                <Input
                  placeholder="Supplier name"
                  value={supplierName}
                  onChange={setSupplierName}
                />
                <Select
                  value={supplierKind}
                  onChange={(value) => setSupplierKind(value as typeof supplierKind)}
                  options={SUPPLIER_KINDS.map((row) => [row.value, row.label])}
                />
                <Input placeholder="Phone" value={supplierPhone} onChange={setSupplierPhone} />
                <Input
                  placeholder="Location"
                  value={supplierLocation}
                  onChange={setSupplierLocation}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await createSupplier({
                        data: {
                          name: supplierName,
                          kind: supplierKind,
                          phone: supplierPhone,
                          location: supplierLocation,
                        },
                      });
                      setSupplierName("");
                      setSupplierPhone("");
                      setSupplierLocation("");
                    }, "Supplier registered.")
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Add supplier
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-semibold">Forward loan to supplier</div>
                <Select
                  value={requestSupplierId}
                  onChange={setRequestSupplierId}
                  options={suppliers.map((row: any) => [row.id, `${row.name} (${row.kind})`])}
                />
                <MemberSelect
                  members={members}
                  value={requestMemberId}
                  onChange={setRequestMemberId}
                />
                <Select
                  value={requestLoanId}
                  onChange={setRequestLoanId}
                  options={[
                    ["", "No linked loan"],
                    ...memberLoans.map((row: any) => [
                      row.id,
                      `${row.id} - ${row.status} - ${fmtKES(row.approved_amount ?? row.principal)}`,
                    ]),
                  ]}
                />
                <Select
                  value={requestKind}
                  onChange={(value) => setRequestKind(value as typeof requestKind)}
                  options={SUPPLIER_KINDS.map((row) => [row.value, row.label])}
                />
                <Input
                  type="number"
                  placeholder="Amount to supplier"
                  value={requestAmount || ""}
                  onChange={(value) => setRequestAmount(Number(value))}
                />
                {requestKind === "fuel" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Vehicle / plate"
                      value={requestDetail.vehicle}
                      onChange={(value) =>
                        setRequestDetail((current) => ({ ...current, vehicle: value }))
                      }
                    />
                    <Input
                      placeholder="Fuel type"
                      value={requestDetail.fuelType}
                      onChange={(value) =>
                        setRequestDetail((current) => ({ ...current, fuelType: value }))
                      }
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="Stock item"
                      value={requestDetail.item}
                      onChange={(value) =>
                        setRequestDetail((current) => ({ ...current, item: value }))
                      }
                    />
                    <Input
                      placeholder="Quantity"
                      value={requestDetail.quantity}
                      onChange={(value) =>
                        setRequestDetail((current) => ({ ...current, quantity: value }))
                      }
                    />
                  </div>
                )}
                <Input
                  placeholder="Unit price / agreed price"
                  value={requestDetail.unitPrice}
                  onChange={(value) =>
                    setRequestDetail((current) => ({ ...current, unitPrice: value }))
                  }
                />
                <Input
                  placeholder="Notes"
                  value={requestDetail.notes}
                  onChange={(value) =>
                    setRequestDetail((current) => ({ ...current, notes: value }))
                  }
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await createSupplierRequest({
                        data: {
                          supplierId: requestSupplierId,
                          memberId: requestMemberId,
                          loanId: requestLoanId || undefined,
                          kind: requestKind,
                          amount: requestAmount,
                          detail: requestDetail,
                        },
                      });
                      setRequestAmount(0);
                    }, "Supplier request sent.")
                  }
                  className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Forward to supplier
                </button>
              </div>
            </div>
          </Section>
        </div>

        <Section title="Supplier portal view">
          <div className="space-y-4 p-5">
            <div className="max-w-xl">
              <Select
                value={supplierPortalId}
                onChange={setSupplierPortalId}
                options={suppliers.map((row: any) => [row.id, `${row.name} (${row.kind})`])}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left">Client</th>
                    <th className="px-5 py-3 text-left">Request</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Supplier action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {supplierPortalRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                        No requests for this supplier.
                      </td>
                    </tr>
                  ) : null}
                  {supplierPortalRequests.map((request: any) => {
                    const member = members.find((row: any) => row.id === request.member_id);
                    const detail = request.detail ?? {};
                    const requestText =
                      request.kind === "fuel"
                        ? `${detail.fuelType ?? "Fuel"} for ${detail.vehicle ?? detail.vehiclePlate ?? "vehicle"}`
                        : `${detail.item ?? detail.serviceType ?? request.kind} ${detail.quantity ?? ""}`;
                    return (
                      <tr key={request.id}>
                        <td className="px-5 py-3 font-medium">
                          {member?.name ?? request.member_id}
                        </td>
                        <td className="px-5 py-3">
                          <div>{requestText}</div>
                          <div className="text-xs text-muted-foreground">
                            {detail.notes ?? request.loan_id ?? ""}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">
                          {fmtKES(request.amount)}
                        </td>
                        <td className="px-5 py-3 capitalize">{request.status}</td>
                        <td className="px-5 py-3 text-right">
                          {request.status === "sent" ? (
                            <button
                              onClick={() =>
                                runAction(async () => {
                                  await markFulfilled({ data: { requestId: request.id } });
                                }, "Supplier fulfillment approved.")
                              }
                              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
                            >
                              Approve fulfilled
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">No action</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section title="Fulfillment and payment queue">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Supplier</th>
                  <th className="px-5 py-3 text-left">Client / Loan</th>
                  <th className="px-5 py-3 text-left">Type</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {requests.map((request: any) => {
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
                          {request.loan_id ?? "No loan linked"}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1">
                          {request.kind === "fuel" ? (
                            <Fuel className="h-3.5 w-3.5" />
                          ) : (
                            <Package className="h-3.5 w-3.5" />
                          )}
                          {request.kind}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-semibold">
                        {fmtKES(request.amount)}
                      </td>
                      <td className="px-5 py-3 capitalize">{request.status}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          {request.status === "sent" ? (
                            <button
                              onClick={() =>
                                runAction(async () => {
                                  await markFulfilled({ data: { requestId: request.id } });
                                }, "Supplier fulfillment approved.")
                              }
                              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                            >
                              Fulfilled
                            </button>
                          ) : null}
                          {request.status === "fulfilled" ? (
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
                                      note: `Payment for ${request.kind} fulfillment`,
                                    },
                                  });
                                }, "Supplier payment recorded.")
                              }
                              className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                            >
                              Pay supplier
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <RecentTable
            title="Recent outflows"
            rows={outflows.map((row: any) => ({
              id: row.id,
              left: row.receiver_name,
              mid: row.kind,
              right: fmtKES(row.amount),
              sub: row.note,
            }))}
          />
          <RecentTable
            title="Recent docket movements"
            rows={movements.map((row: any) => ({
              id: row.id,
              left: `${row.from_docket ?? "deposit"} -> ${row.to_docket ?? "-"}`,
              mid: row.member_id,
              right: fmtKES(row.amount),
              sub: row.reason,
            }))}
          />
        </div>
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
      options={members.map((member) => [
        member.id,
        `${member.id} - ${member.name} (${memberCategoryLabel(member.member_category)})`,
      ])}
    />
  );
}

function DocketSelect({ value, onChange }: { value: Docket; onChange: (value: Docket) => void }) {
  return (
    <Select
      value={value}
      onChange={(next) => onChange(next as Docket)}
      options={DOCKETS.map((row) => [row.value, row.label])}
    />
  );
}

function estimateDailyLoanDue(loan: any) {
  const approved = Number(loan.approved_amount ?? loan.principal ?? 0);
  const financedPrincipal = Number(loan.financed_principal_amount ?? approved);
  const termDays = Math.max(1, Number(loan.term_days ?? (loan.term_months || 1) * 30));
  const periods = Math.max(1, Math.ceil(termDays / 30));
  const total = financedPrincipal + financedPrincipal * (Number(loan.rate ?? 0) / 100) * periods;
  const balance = Math.max(0, total - Number(loan.paid ?? 0));
  return Math.min(balance, total / termDays);
}

function RecentTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; left: string; mid: string; right: string; sub?: string }>;
}) {
  return (
    <Section title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Type</th>
              <th className="px-5 py-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 12).map((row) => (
              <tr key={row.id}>
                <td className="px-5 py-3">
                  <div className="font-medium">{row.left}</div>
                  {row.sub ? <div className="text-xs text-muted-foreground">{row.sub}</div> : null}
                </td>
                <td className="px-5 py-3">{row.mid}</td>
                <td className="px-5 py-3 text-right font-semibold">{row.right}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
