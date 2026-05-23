import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Boxes,
  Building2,
  CheckCircle2,
  Fuel,
  KeyRound,
  Package,
  Plus,
  RefreshCw,
  Store,
  Truck,
  Wrench,
} from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import {
  createSupplierFulfillmentRequestRecord,
  createSupplierRecord,
  issueInternalStoreLoanRecord,
  markSupplierFulfilledRecord,
  recordSystemOutflowRecord,
  saveInternalStoreItemRecord,
  saveSupplierInventoryItemRecord,
} from "@/lib/app-data.functions";
import { listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";
import { fmtKES, memberCategoryLabel, useStore } from "@/lib/store";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers - Sauti Microfinance" }] }),
  component: SuppliersPage,
});

type SupplierKind = "fuel" | "stock" | "service";

function SuppliersPage() {
  const { authMode, currentUser, logout } = useStore();
  const loadWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const registerSupplier = useServerFn(createSupplierRecord);
  const saveSupplierInventory = useServerFn(saveSupplierInventoryItemRecord);
  const saveInternalStoreItem = useServerFn(saveInternalStoreItemRecord);
  const createSupplierRequest = useServerFn(createSupplierFulfillmentRequestRecord);
  const markFulfilled = useServerFn(markSupplierFulfilledRecord);
  const recordOutflow = useServerFn(recordSystemOutflowRecord);
  const issueInternalStoreLoan = useServerFn(issueInternalStoreLoanRecord);

  const [workspace, setWorkspace] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    memberId: "",
    name: "",
    kind: "stock" as SupplierKind,
    phone: "",
    location: "",
  });
  const [inventoryForm, setInventoryForm] = useState({
    supplierId: "",
    itemKind: "stock" as SupplierKind,
    itemName: "",
    unit: "unit",
    quantityAvailable: 0,
    unitPrice: 0,
  });
  const [storeForm, setStoreForm] = useState({
    itemKind: "stock" as SupplierKind,
    itemName: "",
    unit: "unit",
    quantityAvailable: 0,
    reorderLevel: 0,
    unitPrice: 0,
    preferredSupplierId: "",
  });
  const [requestForm, setRequestForm] = useState({
    kind: "stock" as SupplierKind,
    supplierId: "",
    memberId: "",
    loanId: "",
    amount: 0,
    commodityName: "",
    quantity: 0,
    unit: "unit",
    vehiclePlate: "",
    fuelType: "",
    notes: "",
  });
  const [verificationInputs, setVerificationInputs] = useState<Record<string, string>>({});

  const refresh = async () => {
    setBusy(true);
    try {
      const next = await loadWorkspace();
      setWorkspace(next);
      setRegisterForm((current) => ({
        ...current,
        memberId: current.memberId || next.members?.[0]?.id || "",
      }));
      setInventoryForm((current) => ({
        ...current,
        supplierId: current.supplierId || next.signedSupplierId || next.suppliers?.[0]?.id || "",
      }));
      setStoreForm((current) => ({
        ...current,
        preferredSupplierId:
          current.preferredSupplierId || next.suppliers?.find((row: any) => row.kind === "stock")?.id || "",
      }));
      setRequestForm((current) => ({
        ...current,
        supplierId: current.supplierId || next.suppliers?.[0]?.id || "",
        memberId: current.memberId || next.members?.[0]?.id || "",
      }));
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load the supplier workspace.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const mode = workspace?.mode === "supplier" ? "supplier" : "staff";
  const suppliers = workspace?.suppliers ?? [];
  const members = workspace?.members ?? [];
  const requests = workspace?.requests ?? [];
  const supplierInventory = workspace?.supplierInventory ?? [];
  const internalStore = workspace?.internalStore ?? [];
  const loans = workspace?.loans ?? [];
  const outflows = workspace?.outflows ?? [];
  const canPaySuppliers = authMode === "staff" && currentUser.role === "director";

  const supplierDebt = requests
    .filter((request: any) => request.status === "fulfilled")
    .reduce((sum: number, request: any) => sum + Number(request.amount ?? 0), 0);
  const supplierPayments = outflows.reduce(
    (sum: number, payment: any) => sum + Number(payment.amount ?? 0),
    0,
  );

  const eligibleLoans = useMemo(
    () =>
      loans.filter(
        (loan: any) =>
          loan.member_id === requestForm.memberId &&
          (loan.loan_kind ?? "stock") === requestForm.kind &&
          loan.status !== "closed" &&
          loan.status !== "rejected",
      ),
    [loans, requestForm.kind, requestForm.memberId],
  );

  const internalMatch = useMemo(() => {
    if (requestForm.kind !== "stock" || !requestForm.commodityName || requestForm.quantity <= 0) {
      return null;
    }
    const search = requestForm.commodityName.trim().toLowerCase();
    return (
      internalStore.find((item: any) => {
        const sameKind = String(item.item_kind ?? "") === "stock";
        const sameName = String(item.item_name ?? "").toLowerCase().includes(search);
        const enough = Number(item.quantity_available ?? 0) >= requestForm.quantity;
        return sameKind && sameName && enough;
      }) ?? null
    );
  }, [internalStore, requestForm.commodityName, requestForm.kind, requestForm.quantity]);

  const matchingSuppliers = useMemo(() => {
    const sameKindSuppliers = suppliers.filter(
      (supplier: any) => String(supplier.kind ?? "") === requestForm.kind,
    );
    if (requestForm.kind !== "stock" || !requestForm.commodityName.trim()) {
      return sameKindSuppliers;
    }
    const search = requestForm.commodityName.trim().toLowerCase();
    const matchingIds = new Set(
      supplierInventory
        .filter(
          (item: any) =>
            String(item.item_kind ?? "") === "stock" &&
            String(item.item_name ?? "").toLowerCase().includes(search),
        )
        .map((item: any) => String(item.supplier_id ?? "")),
    );
    return sameKindSuppliers.filter((supplier: any) => matchingIds.has(String(supplier.id ?? "")));
  }, [requestForm.commodityName, requestForm.kind, supplierInventory, suppliers]);

  const supplierDebtById = useMemo(() => {
    const totals = new Map<string, number>();
    requests.forEach((request: any) => {
      if (request.status !== "fulfilled") return;
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
      {mode === "staff" ? (
        <AppHeader
          title="Supplier Hub"
          subtitle="Register suppliers, check store stock first, dispatch supplier-backed loans, and clear supplier debt."
        />
      ) : (
        <header className="border-b border-border bg-card/70 px-6 py-5 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Sauti Microfinance
              </div>
              <h1 className="mt-1 font-display text-2xl font-semibold text-foreground">
                Supplier Portal
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Confirm requests, maintain your stock list, and track what Sauti still owes you.
              </p>
            </div>
            <button
              onClick={() => void logout()}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </header>
      )}

      <main className="flex-1 space-y-6 p-6 lg:p-8">
        {mode === "staff" ? <SectionTabs section="members" /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={mode === "staff" ? "Suppliers" : "Open requests"}
            value={mode === "staff" ? suppliers.length : requests.filter((row: any) => row.status === "sent").length}
            icon={<Building2 className="h-5 w-5" />}
          />
          <StatCard
            label="Outstanding supplier debt"
            value={fmtKES(Math.max(0, supplierDebt - supplierPayments))}
            icon={<Truck className="h-5 w-5" />}
            tone="warning"
          />
          <StatCard
            label="Supplier payments"
            value={fmtKES(supplierPayments)}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="success"
          />
          <StatCard
            label={mode === "staff" ? "Internal store SKUs" : "Inventory lines"}
            value={mode === "staff" ? internalStore.length : supplierInventory.length}
            icon={<Boxes className="h-5 w-5" />}
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

        {mode === "staff" ? (
          <div className="grid gap-6 xl:grid-cols-3">
            <Section title="Register supplier">
              <div className="space-y-3 p-5">
                <Select
                  value={registerForm.memberId}
                  onChange={(value) => setRegisterForm((current) => ({ ...current, memberId: value }))}
                  options={members.map((member: any) => [
                    member.id,
                    `${member.id} - ${member.name} (${memberCategoryLabel(member.member_category)})`,
                  ])}
                />
                <Input
                  value={registerForm.name}
                  onChange={(value) => setRegisterForm((current) => ({ ...current, name: value }))}
                  placeholder="Supplier / business name"
                />
                <Select
                  value={registerForm.kind}
                  onChange={(value) =>
                    setRegisterForm((current) => ({ ...current, kind: value as SupplierKind }))
                  }
                  options={[
                    ["stock", "Stock supplier"],
                    ["fuel", "Fuel supplier"],
                    ["service", "Service supplier"],
                  ]}
                />
                <Input
                  value={registerForm.phone}
                  onChange={(value) => setRegisterForm((current) => ({ ...current, phone: value }))}
                  placeholder="Supplier phone"
                />
                <Input
                  value={registerForm.location}
                  onChange={(value) =>
                    setRegisterForm((current) => ({ ...current, location: value }))
                  }
                  placeholder="Location / station / workshop"
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await registerSupplier({
                        data: {
                          memberId: registerForm.memberId,
                          name: registerForm.name,
                          kind: registerForm.kind,
                          phone: registerForm.phone,
                          location: registerForm.location,
                        },
                      });
                      setRegisterForm({
                        memberId: members[0]?.id ?? "",
                        name: "",
                        kind: "stock",
                        phone: "",
                        location: "",
                      });
                    }, "Supplier registered.")
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Save supplier
                </button>
              </div>
            </Section>

            <Section title="Load supplier inventory">
              <div className="space-y-3 p-5">
                <Select
                  value={inventoryForm.supplierId}
                  onChange={(value) =>
                    setInventoryForm((current) => ({ ...current, supplierId: value }))
                  }
                  options={suppliers.map((supplier: any) => [
                    supplier.id,
                    `${supplier.name} (${kindLabel(supplier.kind)})`,
                  ])}
                />
                <Select
                  value={inventoryForm.itemKind}
                  onChange={(value) =>
                    setInventoryForm((current) => ({ ...current, itemKind: value as SupplierKind }))
                  }
                  options={[
                    ["stock", "Stock"],
                    ["fuel", "Fuel"],
                    ["service", "Service"],
                  ]}
                />
                <Input
                  value={inventoryForm.itemName}
                  onChange={(value) =>
                    setInventoryForm((current) => ({ ...current, itemName: value }))
                  }
                  placeholder="Commodity / service name"
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    value={inventoryForm.unit}
                    onChange={(value) => setInventoryForm((current) => ({ ...current, unit: value }))}
                    placeholder="Unit"
                  />
                  <Input
                    type="number"
                    value={inventoryForm.quantityAvailable || ""}
                    onChange={(value) =>
                      setInventoryForm((current) => ({
                        ...current,
                        quantityAvailable: Number(value),
                      }))
                    }
                    placeholder="Qty"
                  />
                  <Input
                    type="number"
                    value={inventoryForm.unitPrice || ""}
                    onChange={(value) =>
                      setInventoryForm((current) => ({ ...current, unitPrice: Number(value) }))
                    }
                    placeholder="Unit price"
                  />
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await saveSupplierInventory({
                        data: inventoryForm,
                      });
                      setInventoryForm((current) => ({
                        ...current,
                        itemName: "",
                        quantityAvailable: 0,
                        unitPrice: 0,
                      }));
                    }, "Supplier inventory saved.")
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <Package className="h-4 w-4" /> Save inventory line
                </button>
              </div>
            </Section>

            <Section title="Load internal store">
              <div className="space-y-3 p-5">
                <Select
                  value={storeForm.itemKind}
                  onChange={(value) =>
                    setStoreForm((current) => ({ ...current, itemKind: value as SupplierKind }))
                  }
                  options={[
                    ["stock", "Stock"],
                    ["fuel", "Fuel"],
                    ["service", "Service"],
                  ]}
                />
                <Input
                  value={storeForm.itemName}
                  onChange={(value) => setStoreForm((current) => ({ ...current, itemName: value }))}
                  placeholder="Store item name"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={storeForm.unit}
                    onChange={(value) => setStoreForm((current) => ({ ...current, unit: value }))}
                    placeholder="Unit"
                  />
                  <Input
                    type="number"
                    value={storeForm.unitPrice || ""}
                    onChange={(value) =>
                      setStoreForm((current) => ({ ...current, unitPrice: Number(value) }))
                    }
                    placeholder="Unit price"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    value={storeForm.quantityAvailable || ""}
                    onChange={(value) =>
                      setStoreForm((current) => ({
                        ...current,
                        quantityAvailable: Number(value),
                      }))
                    }
                    placeholder="Available"
                  />
                  <Input
                    type="number"
                    value={storeForm.reorderLevel || ""}
                    onChange={(value) =>
                      setStoreForm((current) => ({ ...current, reorderLevel: Number(value) }))
                    }
                    placeholder="Reorder level"
                  />
                </div>
                <Select
                  value={storeForm.preferredSupplierId}
                  onChange={(value) =>
                    setStoreForm((current) => ({ ...current, preferredSupplierId: value }))
                  }
                  options={[
                    ["", "No preferred supplier"],
                    ...suppliers.map((supplier: any) => [supplier.id, supplier.name]),
                  ]}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await saveInternalStoreItem({ data: storeForm });
                      setStoreForm((current) => ({
                        ...current,
                        itemName: "",
                        quantityAvailable: 0,
                        reorderLevel: 0,
                        unitPrice: 0,
                      }));
                    }, "Internal store item saved.")
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <Store className="h-4 w-4" /> Save store item
                </button>
              </div>
            </Section>
          </div>
        ) : (
          <Section title="Your supplier profile">
            <div className="p-5 text-sm text-muted-foreground">
              Requests assigned to this supplier can be fulfilled here. Fuel requests require the
              driver's verification code before the loan activates in Sauti.
            </div>
          </Section>
        )}

        {mode === "staff" ? (
          <Section title="Source stock, fuel, or service">
            <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_1fr]">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={requestForm.kind}
                    onChange={(value) =>
                      setRequestForm((current) => ({
                        ...current,
                        kind: value as SupplierKind,
                        supplierId: "",
                        commodityName: "",
                        vehiclePlate: "",
                        fuelType: "",
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
                    onChange={(value) =>
                      setRequestForm((current) => ({ ...current, memberId: value, loanId: "" }))
                    }
                    options={members.map((member: any) => [
                      member.id,
                      `${member.id} - ${member.name} (${memberCategoryLabel(member.member_category)})`,
                    ])}
                  />
                </div>
                <Select
                  value={requestForm.loanId}
                  onChange={(value) => setRequestForm((current) => ({ ...current, loanId: value }))}
                  options={[
                    ["", "No linked loan selected"],
                    ...eligibleLoans.map((loan: any) => [
                      loan.id,
                      `${loan.id} - ${String(loan.supplier_request_status ?? loan.status)} - ${fmtKES(Number(loan.approved_amount ?? loan.principal ?? 0))}`,
                    ]),
                  ]}
                />
                {requestForm.kind === "fuel" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={requestForm.vehiclePlate}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, vehiclePlate: value }))
                      }
                      placeholder="Vehicle / plate"
                    />
                    <Input
                      value={requestForm.fuelType}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, fuelType: value }))
                      }
                      placeholder="Fuel type"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      value={requestForm.commodityName}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, commodityName: value }))
                      }
                      placeholder={
                        requestForm.kind === "service" ? "Service needed" : "Commodity"
                      }
                    />
                    <Input
                      type="number"
                      value={requestForm.quantity || ""}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, quantity: Number(value) }))
                      }
                      placeholder="Qty"
                    />
                    <Input
                      value={requestForm.unit}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, unit: value }))
                      }
                      placeholder="Unit"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    value={requestForm.amount || ""}
                    onChange={(value) =>
                      setRequestForm((current) => ({ ...current, amount: Number(value) }))
                    }
                    placeholder="Amount to charge"
                  />
                  <Select
                    value={requestForm.supplierId}
                    onChange={(value) =>
                      setRequestForm((current) => ({ ...current, supplierId: value }))
                    }
                    options={[
                      ["", "Select supplier"],
                      ...matchingSuppliers.map((supplier: any) => [
                        supplier.id,
                        `${supplier.name} (${kindLabel(supplier.kind)})`,
                      ]),
                    ]}
                  />
                </div>
                <Input
                  value={requestForm.notes}
                  onChange={(value) => setRequestForm((current) => ({ ...current, notes: value }))}
                  placeholder="Notes"
                />
                <button
                  disabled={busy || !requestForm.supplierId}
                  onClick={() =>
                    runAction(async () => {
                      const result = await createSupplierRequest({
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
                            notes: requestForm.notes,
                            driverMemberId: requestForm.memberId,
                          },
                        },
                      });
                      if (result.verificationCode) {
                        toast.success(`Fuel verification code: ${result.verificationCode}`);
                      }
                      setRequestForm((current) => ({
                        ...current,
                        supplierId: "",
                        loanId: "",
                        amount: 0,
                        commodityName: "",
                        quantity: 0,
                        notes: "",
                        vehiclePlate: "",
                        fuelType: "",
                      }));
                    }, "Supplier request sent.")
                  }
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Truck className="h-4 w-4" /> Send to supplier
                </button>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <div className="font-medium">Internal store check</div>
                  {internalMatch ? (
                    <div className="mt-2 space-y-2">
                      <div className="text-muted-foreground">
                        {internalMatch.item_name} is already in stock:{" "}
                        <span className="font-medium text-foreground">
                          {Number(internalMatch.quantity_available ?? 0)} {internalMatch.unit}
                        </span>
                        .
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          runAction(async () => {
                            await issueInternalStoreLoan({
                              data: {
                                itemId: internalMatch.id,
                                memberId: requestForm.memberId,
                                loanId: requestForm.loanId || undefined,
                                quantity: requestForm.quantity,
                                note: requestForm.notes || `Issued ${internalMatch.item_name}`,
                              },
                            });
                          }, "Issued from internal store.")
                        }
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <Store className="h-4 w-4" /> Issue from store
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 text-muted-foreground">
                      No matching internal stock is currently enough for this request, so the
                      system should source it from a supplier.
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                  <div className="font-medium">Matching suppliers</div>
                  <div className="mt-2 space-y-2">
                    {matchingSuppliers.length === 0 ? (
                      <div className="text-muted-foreground">
                        No supplier match yet for this commodity or service.
                      </div>
                    ) : (
                      matchingSuppliers.map((supplier: any) => (
                        <div
                          key={supplier.id}
                          className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
                        >
                          <div>
                            <div className="font-medium">{supplier.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {supplier.location || supplier.phone || kindLabel(supplier.kind)}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Owed {fmtKES(Math.max(0, (supplierDebtById.get(supplier.id) ?? 0) - (supplierPaymentsById.get(supplier.id) ?? 0)))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
          <Section title={mode === "staff" ? "Supplier directory" : "Your inventory"}>
            <div className="overflow-x-auto">
              {mode === "staff" ? (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 text-left">Supplier</th>
                      <th className="px-5 py-3 text-left">Linked member</th>
                      <th className="px-5 py-3 text-left">Kind</th>
                      <th className="px-5 py-3 text-left">Contact</th>
                      <th className="px-5 py-3 text-right">Outstanding debt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {suppliers.map((supplier: any) => {
                      const linkedMember = members.find((member: any) => member.id === supplier.member_id);
                      const outstanding =
                        (supplierDebtById.get(supplier.id) ?? 0) -
                        (supplierPaymentsById.get(supplier.id) ?? 0);
                      return (
                        <tr key={supplier.id}>
                          <td className="px-5 py-3 font-medium">{supplier.name}</td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {linkedMember
                              ? `${linkedMember.id} - ${linkedMember.name}`
                              : supplier.member_id || "Not linked"}
                          </td>
                          <td className="px-5 py-3 capitalize">{supplier.kind}</td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {supplier.phone || supplier.location || "No contact yet"}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold">
                            {fmtKES(Math.max(0, outstanding))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="space-y-4 p-5">
                  <SupplierInventoryForm
                    busy={busy}
                    supplierId={workspace?.signedSupplierId ?? suppliers[0]?.id ?? ""}
                    onSave={async (payload) => {
                      await runAction(async () => {
                        await saveSupplierInventory({ data: payload });
                      }, "Inventory saved.");
                    }}
                  />
                  <InventoryTable rows={supplierInventory} />
                </div>
              )}
            </div>
          </Section>

          <Section title="Supplier queue">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left">Client / loan</th>
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
                        No supplier work is waiting here.
                      </td>
                    </tr>
                  ) : null}
                  {requests.map((request: any) => {
                    const member = members.find((row: any) => row.id === request.member_id);
                    const supplier = suppliers.find((row: any) => row.id === request.supplier_id);
                    const requestSummary = summarizeRequest(request);
                    const verificationValue = verificationInputs[request.id] ?? "";
                    return (
                      <tr key={request.id}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{member?.name ?? request.member_id}</div>
                          <div className="text-xs text-muted-foreground">
                            {request.loan_id || supplier?.name || "No loan linked"}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            {request.kind === "fuel" ? (
                              <Fuel className="h-3.5 w-3.5" />
                            ) : request.kind === "service" ? (
                              <Wrench className="h-3.5 w-3.5" />
                            ) : (
                              <Package className="h-3.5 w-3.5" />
                            )}
                            {requestSummary}
                          </div>
                          {request.verification_code ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Driver code: {request.verification_code}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right font-semibold">
                          {fmtKES(Number(request.amount ?? 0))}
                        </td>
                        <td className="px-5 py-3 capitalize">{request.status}</td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            {request.status === "sent" ? (
                              <>
                                {request.kind === "fuel" ? (
                                  <input
                                    value={verificationValue}
                                    onChange={(event) =>
                                      setVerificationInputs((current) => ({
                                        ...current,
                                        [request.id]: event.target.value,
                                      }))
                                    }
                                    placeholder="Driver code"
                                    className="w-28 rounded-md border border-border bg-muted px-2 py-1 text-xs"
                                  />
                                ) : null}
                                <button
                                  onClick={() =>
                                    runAction(async () => {
                                      await markFulfilled({
                                        data: {
                                          requestId: request.id,
                                          verificationCode:
                                            request.kind === "fuel"
                                              ? verificationValue
                                              : undefined,
                                        },
                                      });
                                    }, request.kind === "fuel"
                                      ? "Fuel delivery confirmed."
                                      : "Supplier request fulfilled.")
                                  }
                                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
                                >
                                  {request.kind === "fuel" ? (
                                    <>
                                      <KeyRound className="mr-1 inline h-3.5 w-3.5" />
                                      Confirm code
                                    </>
                                  ) : (
                                    "Mark fulfilled"
                                  )}
                                </button>
                              </>
                            ) : null}
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
        </div>

        {mode === "staff" ? (
          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Internal store levels">
              <InventoryTable rows={internalStore} />
            </Section>
            <Section title="Supplier catalogue">
              <InventoryTable rows={supplierInventory} />
            </Section>
          </div>
        ) : null}
      </main>
    </>
  );
}

function SupplierInventoryForm({
  supplierId,
  busy,
  onSave,
}: {
  supplierId: string;
  busy: boolean;
  onSave: (payload: {
    supplierId: string;
    itemKind: SupplierKind;
    itemName: string;
    unit: string;
    quantityAvailable: number;
    unitPrice: number;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    itemKind: "stock" as SupplierKind,
    itemName: "",
    unit: "unit",
    quantityAvailable: 0,
    unitPrice: 0,
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
      <div className="font-medium">Add inventory line</div>
      <Select
        value={form.itemKind}
        onChange={(value) => setForm((current) => ({ ...current, itemKind: value as SupplierKind }))}
        options={[
          ["stock", "Stock"],
          ["fuel", "Fuel"],
          ["service", "Service"],
        ]}
      />
      <Input
        value={form.itemName}
        onChange={(value) => setForm((current) => ({ ...current, itemName: value }))}
        placeholder="Commodity / service"
      />
      <div className="grid grid-cols-3 gap-2">
        <Input
          value={form.unit}
          onChange={(value) => setForm((current) => ({ ...current, unit: value }))}
          placeholder="Unit"
        />
        <Input
          type="number"
          value={form.quantityAvailable || ""}
          onChange={(value) =>
            setForm((current) => ({ ...current, quantityAvailable: Number(value) }))
          }
          placeholder="Qty"
        />
        <Input
          type="number"
          value={form.unitPrice || ""}
          onChange={(value) => setForm((current) => ({ ...current, unitPrice: Number(value) }))}
          placeholder="Unit price"
        />
      </div>
      <button
        disabled={busy}
        onClick={() =>
          onSave({
            supplierId,
            ...form,
          }).then(() =>
            setForm({
              itemKind: "stock",
              itemName: "",
              unit: "unit",
              quantityAvailable: 0,
              unitPrice: 0,
            }),
          )
        }
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Save inventory
      </button>
    </div>
  );
}

function InventoryTable({ rows }: { rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Item</th>
            <th className="px-5 py-3 text-left">Kind</th>
            <th className="px-5 py-3 text-right">Qty</th>
            <th className="px-5 py-3 text-right">Unit price</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                No inventory loaded yet.
              </td>
            </tr>
          ) : null}
          {rows.map((row: any) => (
            <tr key={row.id}>
              <td className="px-5 py-3 font-medium">
                {row.item_name}
                <div className="text-xs text-muted-foreground">{row.unit || "unit"}</div>
              </td>
              <td className="px-5 py-3 capitalize">{row.item_kind}</td>
              <td className="px-5 py-3 text-right">
                {Number(row.quantity_available ?? 0).toLocaleString()}
              </td>
              <td className="px-5 py-3 text-right font-semibold">
                {fmtKES(Number(row.unit_price ?? 0))}
              </td>
            </tr>
          ))}
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

function summarizeRequest(request: any) {
  if (request.kind === "fuel") {
    return `${request.fuel_type || "Fuel"} for ${request.vehicle_plate || "vehicle"}`;
  }
  if (request.kind === "service") {
    return request.commodity_name || request.detail?.serviceType || "Service request";
  }
  return `${request.commodity_name || request.detail?.item || "Stock"} ${request.quantity_requested ? `x ${request.quantity_requested}` : ""}`.trim();
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
