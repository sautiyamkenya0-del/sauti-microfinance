import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, CheckCircle2, ClipboardList, Plus, RefreshCw, Truck } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { Section, StatCard, Badge } from "@/components/ui-bits";
import {
  createSupplierFulfillmentRequestRecord,
  createSupplierRecord,
  recordSystemOutflowRecord,
} from "@/lib/app-data.functions";
import { listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers - Sauti Microfinance" }] }),
  component: SuppliersPage,
});

type SupplierKind = "fuel" | "stock" | "service";
type SupplierClass = "normal" | "special_broker";
type SupplierType = "individual" | "company";
type RegistrationCategory = "goods" | "services" | "works";

function emptyRegisterForm() {
  return {
    supplierClass: "normal" as SupplierClass,
    supplierType: "individual" as SupplierType,
    registrationCategory: "goods" as RegistrationCategory,
    kind: "stock" as SupplierKind,
    name: "",
    individualFirstName: "",
    individualSecondName: "",
    individualThirdName: "",
    nationalId: "",
    phone: "",
    alternativePhone: "",
    email: "",
    contactPerson: "",
    contactPersonDesignation: "",
    businessRegistrationNumber: "",
    kraPin: "",
    bankName: "",
    bankBranch: "",
    accountName: "",
    accountNumber: "",
    mpesaPaybillTill: "",
    county: "",
    subCountyTown: "",
    physicalLocation: "",
    postalAddress: "",
    notes: "",
  };
}

function SuppliersPage() {
  const { currentUser } = useStore();
  const loadWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const registerSupplier = useServerFn(createSupplierRecord);
  const createSupplierRequest = useServerFn(createSupplierFulfillmentRequestRecord);
  const recordOutflow = useServerFn(recordSystemOutflowRecord);

  const [workspace, setWorkspace] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
  const [requestForm, setRequestForm] = useState({
    kind: "stock" as SupplierKind,
    supplierId: "",
    memberId: "",
    loanId: "",
    amount: 0,
    commodityName: "",
    quantity: 0,
    unit: "unit",
    unitPrice: 0,
    vehiclePlate: "",
    fuelType: "",
    notes: "",
  });

  async function refresh() {
    setBusy(true);
    try {
      const next = await loadWorkspace();
      setWorkspace(next);
      const suppliers = (next as any).suppliers ?? [];
      const members = (next as any).members ?? [];
      setRequestForm((current) => ({
        ...current,
        supplierId:
          current.supplierId ||
          suppliers.find((supplier: any) => supplier.supplier_class !== "special_broker")?.id ||
          "",
        memberId: current.memberId || members[0]?.id || "",
      }));
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load suppliers.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const suppliers = workspace?.suppliers ?? [];
  const normalSuppliers = suppliers.filter(
    (supplier: any) => supplier.supplier_class !== "special_broker",
  );
  const brokerSuppliers = suppliers.filter(
    (supplier: any) => supplier.supplier_class === "special_broker",
  );
  const requests = workspace?.requests ?? [];
  const outflows = workspace?.outflows ?? [];
  const members = workspace?.members ?? [];
  const loans = workspace?.loans ?? [];
  const supplierInventory = workspace?.supplierInventory ?? [];

  const supplierDebtById = useMemo(() => {
    const totals = new Map<string, number>();
    requests.forEach((request: any) => {
      if (request.status !== "fulfilled" && request.status !== "paid") return;
      const supplierId = String(request.supplier_id ?? "");
      totals.set(supplierId, (totals.get(supplierId) ?? 0) + Number(request.amount ?? 0));
    });
    return totals;
  }, [requests]);

  const supplierPaymentsById = useMemo(() => {
    const totals = new Map<string, number>();
    outflows.forEach((payment: any) => {
      const supplierId = String(payment.supplier_id ?? "");
      totals.set(supplierId, (totals.get(supplierId) ?? 0) + Number(payment.amount ?? 0));
    });
    return totals;
  }, [outflows]);

  const totalDebt = suppliers.reduce((sum: number, supplier: any) => {
    return (
      sum +
      Math.max(
        0,
        (supplierDebtById.get(supplier.id) ?? 0) - (supplierPaymentsById.get(supplier.id) ?? 0),
      )
    );
  }, 0);

  const filteredRequestSuppliers = normalSuppliers.filter(
    (supplier: any) => String(supplier.kind ?? "") === requestForm.kind,
  );
  const eligibleLoans = loans.filter(
    (loan: any) =>
      loan.member_id === requestForm.memberId &&
      (loan.loan_kind ?? "stock") === requestForm.kind &&
      loan.status !== "closed" &&
      loan.status !== "rejected",
  );
  const canPaySuppliers = currentUser.role === "director";

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setBusy(true);
      await action();
      toast.success(success);
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  function register() {
    const payload = {
      ...registerForm,
      kind: registerForm.supplierClass === "special_broker" ? "service" : registerForm.kind,
      registrationCategory:
        registerForm.supplierClass === "special_broker"
          ? "services"
          : registerForm.registrationCategory,
      name:
        registerForm.supplierClass === "special_broker"
          ? [
              registerForm.individualFirstName,
              registerForm.individualSecondName,
              registerForm.individualThirdName,
            ]
              .filter(Boolean)
              .join(" ")
              .trim()
          : registerForm.name,
      location: registerForm.physicalLocation || registerForm.subCountyTown,
      documentChecklist: {},
    };
    return runAction(async () => {
      await registerSupplier({ data: payload });
      setRegisterForm(emptyRegisterForm());
    }, "Supplier registered.");
  }

  function sendRequest() {
    return runAction(async () => {
      await createSupplierRequest({
        data: {
          supplierId: requestForm.supplierId,
          memberId: requestForm.memberId,
          loanId: requestForm.loanId || undefined,
          kind: requestForm.kind,
          amount: requestForm.amount,
          detail: {
            item: requestForm.commodityName,
            quantity: requestForm.quantity,
            unit: requestForm.unit,
            vehicle: requestForm.vehiclePlate,
            fuelType: requestForm.fuelType,
            unitPrice: requestForm.unitPrice,
            notes: requestForm.notes,
            driverMemberId: requestForm.memberId,
          },
        },
      });
      setRequestForm((current) => ({
        ...current,
        loanId: "",
        amount: 0,
        commodityName: "",
        quantity: 0,
        unitPrice: 0,
        vehiclePlate: "",
        fuelType: "",
        notes: "",
      }));
    }, "Supplier request sent.");
  }

  return (
    <>
      <AppHeader
        title="Suppliers"
        subtitle="Register normal suppliers and special broker suppliers. Supplier self-service lives in Supplier Portal."
      />
      <main className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Normal suppliers"
            value={normalSuppliers.length}
            icon={<Truck className="h-5 w-5" />}
          />
          <StatCard
            label="Special brokers"
            value={brokerSuppliers.length}
            icon={<Building2 className="h-5 w-5" />}
          />
          <StatCard
            label="Open requests"
            value={requests.filter((row: any) => row.status === "sent").length}
            icon={<ClipboardList className="h-5 w-5" />}
          />
          <StatCard
            label="Outstanding supplier debt"
            value={fmtKES(totalDebt)}
            tone="warning"
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

        <Section title="Register supplier">
          <div className="space-y-4 p-5">
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["normal", "Normal supplier"],
                  ["special_broker", "Special broker"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    setRegisterForm((current) => ({
                      ...current,
                      supplierClass: value,
                      supplierType:
                        value === "special_broker" ? "individual" : current.supplierType,
                      kind: value === "special_broker" ? "service" : current.kind,
                      registrationCategory:
                        value === "special_broker" ? "services" : current.registrationCategory,
                    }))
                  }
                  className={`rounded-md border px-3 py-2 text-left text-sm font-medium ${
                    registerForm.supplierClass === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {registerForm.supplierClass === "normal" ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Select
                  value={registerForm.supplierType}
                  onChange={(value) =>
                    setRegisterForm((current) => ({
                      ...current,
                      supplierType: value as SupplierType,
                    }))
                  }
                  options={[
                    ["individual", "Individual"],
                    ["company", "Company"],
                  ]}
                />
                <Select
                  value={registerForm.registrationCategory}
                  onChange={(value) =>
                    setRegisterForm((current) => ({
                      ...current,
                      registrationCategory: value as RegistrationCategory,
                      kind: value === "goods" ? current.kind : "service",
                    }))
                  }
                  options={[
                    ["goods", "Goods / products"],
                    ["services", "Services"],
                    ["works", "Works"],
                  ]}
                />
                <Select
                  value={registerForm.kind}
                  onChange={(value) =>
                    setRegisterForm((current) => ({ ...current, kind: value as SupplierKind }))
                  }
                  options={[
                    ["stock", "Stock / goods"],
                    ["fuel", "Fuel"],
                    ["service", "Service"],
                  ]}
                />
                {registerForm.supplierType === "company" ? (
                  <Input
                    value={registerForm.name}
                    onChange={(name) => setRegisterForm({ ...registerForm, name })}
                    placeholder="Company / business name"
                  />
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                Special brokers do not supply stock, fuel, or commodities. They register people in
                their supplier portal and keep each person's deposits, withdrawals, and balance.
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input
                value={registerForm.individualFirstName}
                onChange={(individualFirstName) =>
                  setRegisterForm({ ...registerForm, individualFirstName })
                }
                placeholder="First name"
              />
              <Input
                value={registerForm.individualSecondName}
                onChange={(individualSecondName) =>
                  setRegisterForm({ ...registerForm, individualSecondName })
                }
                placeholder="Second name"
              />
              <Input
                value={registerForm.individualThirdName}
                onChange={(individualThirdName) =>
                  setRegisterForm({ ...registerForm, individualThirdName })
                }
                placeholder="Third name"
              />
              <Input
                value={registerForm.nationalId}
                onChange={(nationalId) => setRegisterForm({ ...registerForm, nationalId })}
                placeholder="ID / passport number"
              />
              <Input
                value={registerForm.phone}
                onChange={(phone) => setRegisterForm({ ...registerForm, phone })}
                placeholder="Phone"
              />
              <Input
                value={registerForm.email}
                onChange={(email) => setRegisterForm({ ...registerForm, email })}
                placeholder="Email"
              />
              <Input
                value={registerForm.county}
                onChange={(county) => setRegisterForm({ ...registerForm, county })}
                placeholder="County"
              />
              <Input
                value={registerForm.physicalLocation}
                onChange={(physicalLocation) =>
                  setRegisterForm({ ...registerForm, physicalLocation })
                }
                placeholder={
                  registerForm.supplierClass === "special_broker"
                    ? "Area of work"
                    : "Physical location"
                }
              />
            </div>

            {registerForm.supplierClass === "normal" ? (
              <>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Input
                    value={registerForm.businessRegistrationNumber}
                    onChange={(businessRegistrationNumber) =>
                      setRegisterForm({ ...registerForm, businessRegistrationNumber })
                    }
                    placeholder="Business registration number"
                  />
                  <Input
                    value={registerForm.kraPin}
                    onChange={(kraPin) => setRegisterForm({ ...registerForm, kraPin })}
                    placeholder="KRA PIN"
                  />
                  <Input
                    value={registerForm.bankName}
                    onChange={(bankName) => setRegisterForm({ ...registerForm, bankName })}
                    placeholder="Bank name"
                  />
                  <Input
                    value={registerForm.bankBranch}
                    onChange={(bankBranch) => setRegisterForm({ ...registerForm, bankBranch })}
                    placeholder="Bank branch"
                  />
                  <Input
                    value={registerForm.accountName}
                    onChange={(accountName) => setRegisterForm({ ...registerForm, accountName })}
                    placeholder="Account name"
                  />
                  <Input
                    value={registerForm.accountNumber}
                    onChange={(accountNumber) =>
                      setRegisterForm({ ...registerForm, accountNumber })
                    }
                    placeholder="Account number"
                  />
                  <Input
                    value={registerForm.mpesaPaybillTill}
                    onChange={(mpesaPaybillTill) =>
                      setRegisterForm({ ...registerForm, mpesaPaybillTill })
                    }
                    placeholder="M-Pesa paybill / till"
                  />
                </div>
              </>
            ) : null}

            <Textarea
              value={registerForm.notes}
              onChange={(notes) => setRegisterForm({ ...registerForm, notes })}
              placeholder={
                registerForm.supplierClass === "special_broker"
                  ? "Broker notes, route, association, or driver network"
                  : "Supplier notes"
              }
            />
            <button
              onClick={register}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Save supplier
            </button>
          </div>
        </Section>

        <Section title="Send supplier-backed request">
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Select
              value={requestForm.kind}
              onChange={(kind) =>
                setRequestForm((current) => ({
                  ...current,
                  kind: kind as SupplierKind,
                  supplierId:
                    normalSuppliers.find((supplier: any) => supplier.kind === kind)?.id ?? "",
                  loanId: "",
                }))
              }
              options={[
                ["stock", "Stock"],
                ["fuel", "Fuel"],
                ["service", "Service"],
              ]}
            />
            <Select
              value={requestForm.memberId}
              onChange={(memberId) => setRequestForm({ ...requestForm, memberId, loanId: "" })}
              options={members.map((member: any) => [member.id, `${member.name} (${member.id})`])}
            />
            <Select
              value={requestForm.loanId}
              onChange={(loanId) => setRequestForm({ ...requestForm, loanId })}
              options={[
                ["", "No linked loan"],
                ...eligibleLoans.map((loan: any) => [
                  loan.id,
                  `${loan.id} - ${fmtKES(Number(loan.approved_amount ?? loan.principal ?? 0))}`,
                ]),
              ]}
            />
            <Select
              value={requestForm.supplierId}
              onChange={(supplierId) => setRequestForm({ ...requestForm, supplierId })}
              options={
                filteredRequestSuppliers.length
                  ? filteredRequestSuppliers.map((supplier: any) => [
                      supplier.id,
                      `${supplier.name} (${kindLabel(supplier.kind)})`,
                    ])
                  : [["", "No normal supplier for this kind"]]
              }
            />
            <Input
              value={requestForm.commodityName}
              onChange={(commodityName) => setRequestForm({ ...requestForm, commodityName })}
              placeholder={requestForm.kind === "fuel" ? "Vehicle / route" : "Commodity / service"}
            />
            {requestForm.kind === "fuel" ? (
              <>
                <Input
                  value={requestForm.vehiclePlate}
                  onChange={(vehiclePlate) => setRequestForm({ ...requestForm, vehiclePlate })}
                  placeholder="Vehicle plate"
                />
                <Input
                  value={requestForm.fuelType}
                  onChange={(fuelType) => setRequestForm({ ...requestForm, fuelType })}
                  placeholder="Fuel type"
                />
              </>
            ) : null}
            <Input
              type="number"
              value={requestForm.quantity || ""}
              onChange={(quantity) =>
                setRequestForm((current) => ({
                  ...current,
                  quantity: Number(quantity),
                  amount: Number(quantity) * current.unitPrice || current.amount,
                }))
              }
              placeholder={requestForm.kind === "fuel" ? "Litres" : "Quantity"}
            />
            <Input
              value={requestForm.unit}
              onChange={(unit) => setRequestForm({ ...requestForm, unit })}
              placeholder="Unit"
            />
            <Input
              type="number"
              value={requestForm.unitPrice || ""}
              onChange={(unitPrice) =>
                setRequestForm((current) => ({
                  ...current,
                  unitPrice: Number(unitPrice),
                  amount: current.quantity * Number(unitPrice) || current.amount,
                }))
              }
              placeholder="Unit price"
            />
            <Input
              type="number"
              value={requestForm.amount || ""}
              onChange={(amount) => setRequestForm({ ...requestForm, amount: Number(amount) })}
              placeholder="Total amount"
            />
            <Textarea
              value={requestForm.notes}
              onChange={(notes) => setRequestForm({ ...requestForm, notes })}
              placeholder="Request notes"
            />
            <button
              onClick={sendRequest}
              disabled={busy || !requestForm.supplierId}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Send request
            </button>
          </div>
        </Section>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
          <Section title={`Supplier directory (${suppliers.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left">Supplier</th>
                    <th className="px-5 py-3 text-left">Class</th>
                    <th className="px-5 py-3 text-left">Kind</th>
                    <th className="px-5 py-3 text-left">Contact</th>
                    <th className="px-5 py-3 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {suppliers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                        No suppliers registered yet.
                      </td>
                    </tr>
                  ) : null}
                  {suppliers.map((supplier: any) => {
                    const outstanding =
                      (supplierDebtById.get(supplier.id) ?? 0) -
                      (supplierPaymentsById.get(supplier.id) ?? 0);
                    return (
                      <tr key={supplier.id}>
                        <td className="px-5 py-3 font-medium">
                          {supplier.name}
                          <div className="text-xs text-muted-foreground">
                            Login account: {supplier.member_id || "Pending"}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <Badge
                            tone={
                              supplier.supplier_class === "special_broker" ? "accent" : "default"
                            }
                          >
                            {supplierClassLabel(supplier.supplier_class)}
                          </Badge>
                        </td>
                        <td className="px-5 py-3">{kindLabel(supplier.kind)}</td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {supplier.phone || supplier.location || "No contact"}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">
                          {fmtKES(Math.max(0, outstanding))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Supplier queue">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left">Client / supplier</th>
                    <th className="px-5 py-3 text-left">Request</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-left">Status</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {requests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                        No supplier requests yet.
                      </td>
                    </tr>
                  ) : null}
                  {requests.map((request: any) => {
                    const member = members.find((row: any) => row.id === request.member_id);
                    const supplier = suppliers.find((row: any) => row.id === request.supplier_id);
                    return (
                      <tr key={request.id}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{member?.name ?? request.member_id}</div>
                          <div className="text-xs text-muted-foreground">
                            {supplier?.name ?? request.supplier_id}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="capitalize">{request.kind}</div>
                          <div className="text-xs text-muted-foreground">
                            {request.commodity_name ||
                              request.fuel_type ||
                              request.detail?.item ||
                              "Request"}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">
                          {fmtKES(Number(request.amount ?? 0))}
                        </td>
                        <td className="px-5 py-3 capitalize">{request.status}</td>
                        <td className="px-5 py-3 text-right">
                          {request.status === "fulfilled" && canPaySuppliers ? (
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
                                      note: `Payment for ${request.kind} request ${request.id}`,
                                    },
                                  });
                                }, "Supplier payment recorded.")
                              }
                              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                            >
                              Pay supplier
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {request.status === "sent" ? "Supplier portal" : "-"}
                            </span>
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

        <Section title={`Supplier catalogue (${supplierInventory.length})`}>
          <InventoryTable rows={supplierInventory} suppliers={suppliers} />
        </Section>
      </main>
    </>
  );
}

function InventoryTable({ rows, suppliers }: { rows: any[]; suppliers: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Item</th>
            <th className="px-5 py-3 text-left">Supplier</th>
            <th className="px-5 py-3 text-left">Kind</th>
            <th className="px-5 py-3 text-right">Qty</th>
            <th className="px-5 py-3 text-right">Selling</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                No supplier catalogue items yet.
              </td>
            </tr>
          ) : null}
          {rows.map((row: any) => {
            const supplier = suppliers.find((item: any) => item.id === row.supplier_id);
            return (
              <tr key={row.id}>
                <td className="px-5 py-3 font-medium">
                  {row.item_name}
                  <div className="text-xs text-muted-foreground">
                    {[row.brand, row.quality, row.unit].filter(Boolean).join(" / ")}
                  </div>
                </td>
                <td className="px-5 py-3">{supplier?.name ?? row.supplier_id}</td>
                <td className="px-5 py-3">{kindLabel(row.item_kind)}</td>
                <td className="px-5 py-3 text-right">
                  {Number(row.quantity_available ?? 0).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right font-semibold">
                  {fmtKES(Number(row.selling_price ?? row.unit_price ?? 0))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function kindLabel(value: string) {
  if (value === "fuel") return "Fuel";
  if (value === "service") return "Service";
  return "Stock";
}

function supplierClassLabel(value: string) {
  return value === "special_broker" ? "Special broker" : "Normal";
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

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      rows={3}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-20 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm md:col-span-2 xl:col-span-4"
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
