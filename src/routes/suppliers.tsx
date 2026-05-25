import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Boxes,
  Building2,
  CheckCircle2,
  Eye,
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
type SupplierType = "individual" | "company";
type SupplierRegistrationCategory = "goods" | "services" | "works";
type AgpoCategory = "youth" | "women" | "pwd" | "not_applicable";

const emptySupplierDocuments = {
  nationalId: false,
  businessRegistrationCertificate: false,
  kraPinCertificate: false,
  taxComplianceCertificate: false,
  cr12: false,
  agpoCertificate: false,
};

function emptyRegisterForm() {
  return {
    supplierType: "individual" as SupplierType,
    registrationCategory: "goods" as SupplierRegistrationCategory,
    name: "",
    kind: "stock" as SupplierKind,
    individualFirstName: "",
    individualSecondName: "",
    individualThirdName: "",
    nationalId: "",
    gender: "Male" as "Male" | "Female",
    dateOfBirth: "",
    businessRegistrationNumber: "",
    registrationDate: "",
    contactPerson: "",
    contactPersonDesignation: "",
    phone: "",
    alternativePhone: "",
    email: "",
    postalAddress: "",
    postalCodeTown: "",
    county: "",
    subCountyTown: "",
    physicalLocation: "",
    kraPin: "",
    taxComplianceCertificateNumber: "",
    agpoCategory: "not_applicable" as AgpoCategory,
    regulatoryLicenseNumber: "",
    bankName: "",
    bankBranch: "",
    accountName: "",
    accountNumber: "",
    mpesaPaybillTill: "",
    documentChecklist: { ...emptySupplierDocuments },
    notes: "",
  };
}

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
  const [simulationPickId, setSimulationPickId] = useState("");
  const [simulatedSupplierId, setSimulatedSupplierId] = useState("");
  const [registerForm, setRegisterForm] = useState(emptyRegisterForm);
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
    unitPrice: 0,
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
      const nextSuppliers = next.suppliers ?? [];
      setSimulationPickId((current) => current || nextSuppliers[0]?.id || "");
      setSimulatedSupplierId((current) =>
        current && nextSuppliers.some((supplier: any) => supplier.id === current) ? current : "",
      );
      setInventoryForm((current) => ({
        ...current,
        supplierId: current.supplierId || next.signedSupplierId || next.suppliers?.[0]?.id || "",
      }));
      setStoreForm((current) => ({
        ...current,
        preferredSupplierId:
          current.preferredSupplierId ||
          next.suppliers?.find((row: any) => row.kind === "stock")?.id ||
          "",
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

  const serverMode = workspace?.mode === "supplier" ? "supplier" : "staff";
  const activeSimulatedSupplierId = serverMode === "staff" ? simulatedSupplierId : "";
  const mode = serverMode === "supplier" || activeSimulatedSupplierId ? "supplier" : "staff";
  const signedSupplierId =
    serverMode === "supplier" ? (workspace?.signedSupplierId ?? "") : activeSimulatedSupplierId;
  const allSuppliers = workspace?.suppliers ?? [];
  const allRequests = workspace?.requests ?? [];
  const allSupplierInventory = workspace?.supplierInventory ?? [];
  const allInternalStore = workspace?.internalStore ?? [];
  const allLoans = workspace?.loans ?? [];
  const allOutflows = workspace?.outflows ?? [];
  const suppliers =
    mode === "supplier" && signedSupplierId
      ? allSuppliers.filter((supplier: any) => supplier.id === signedSupplierId)
      : allSuppliers;
  const members = workspace?.members ?? [];
  const requests =
    mode === "supplier" && signedSupplierId
      ? allRequests.filter((request: any) => request.supplier_id === signedSupplierId)
      : allRequests;
  const supplierInventory =
    mode === "supplier" && signedSupplierId
      ? allSupplierInventory.filter((item: any) => item.supplier_id === signedSupplierId)
      : allSupplierInventory;
  const internalStore = mode === "supplier" ? [] : allInternalStore;
  const loans =
    mode === "supplier" && signedSupplierId
      ? allLoans.filter((loan: any) => loan.supplier_id === signedSupplierId)
      : allLoans;
  const outflows =
    mode === "supplier" && signedSupplierId
      ? allOutflows.filter((outflow: any) => outflow.supplier_id === signedSupplierId)
      : allOutflows;
  const simulatedSupplier = allSuppliers.find(
    (supplier: any) => supplier.id === activeSimulatedSupplierId,
  );
  const activeSupplierName = simulatedSupplier?.name || signedSupplierId || "selected supplier";
  const canPaySuppliers = authMode === "staff" && currentUser.role === "director";

  const supplierDebt = requests
    .filter((request: any) => request.status === "fulfilled" || request.status === "paid")
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
        const sameName = String(item.item_name ?? "")
          .toLowerCase()
          .includes(search);
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
            String(item.item_name ?? "")
              .toLowerCase()
              .includes(search),
        )
        .map((item: any) => String(item.supplier_id ?? "")),
    );
    return sameKindSuppliers.filter((supplier: any) => matchingIds.has(String(supplier.id ?? "")));
  }, [requestForm.commodityName, requestForm.kind, supplierInventory, suppliers]);

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

  async function runAction(action: () => Promise<void>, success: string) {
    try {
      setBusy(true);
      await action();
      if (success) toast.success(success);
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
                {authMode === "staff" ? "Supplier Portal Simulation" : "Supplier Portal"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {authMode === "staff"
                  ? `Viewing as ${activeSupplierName}. Confirm requests, maintain stock, and inspect supplier debt from the portal view.`
                  : "Confirm requests, maintain your stock list, and track what Sauti still owes you."}
              </p>
            </div>
            {authMode === "staff" ? (
              <button
                onClick={() => setSimulatedSupplierId("")}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Back to supplier hub
              </button>
            ) : (
              <button
                onClick={() => void logout()}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Sign out
              </button>
            )}
          </div>
        </header>
      )}

      <main className="flex-1 space-y-6 p-6 lg:p-8">
        {mode === "staff" ? <SectionTabs section="members" /> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={mode === "staff" ? "Suppliers" : "Open requests"}
            value={
              mode === "staff"
                ? suppliers.length
                : requests.filter((row: any) => row.status === "sent").length
            }
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

        {serverMode === "staff" && mode === "staff" ? (
          <Section title="Simulate supplier portal">
            <div className="flex flex-wrap items-end gap-3 p-5">
              <label className="min-w-[260px] flex-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Supplier portal to view
                </span>
                <Select
                  value={simulationPickId}
                  onChange={setSimulationPickId}
                  options={
                    allSuppliers.length
                      ? allSuppliers.map((supplier: any) => [
                          supplier.id,
                          `${supplier.name} (${kindLabel(supplier.kind)})`,
                        ])
                      : [["", "No suppliers registered"]]
                  }
                />
              </label>
              <button
                disabled={busy || !simulationPickId}
                onClick={() => setSimulatedSupplierId(simulationPickId)}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <Eye className="h-4 w-4" /> Simulate portal
              </button>
            </div>
          </Section>
        ) : null}

        {mode === "staff" ? (
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <Section title="Register supplier">
                <div className="space-y-4 p-5">
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["individual", "Individual / Sole Proprietor"],
                        ["company", "Limited Company / Partnership"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setRegisterForm((current) => ({ ...current, supplierType: value }))
                        }
                        className={`rounded-md border px-3 py-2 text-left text-xs font-medium ${
                          registerForm.supplierType === value
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={registerForm.registrationCategory}
                      onChange={(value) =>
                        setRegisterForm((current) => ({
                          ...current,
                          registrationCategory: value as SupplierRegistrationCategory,
                          kind: value === "goods" ? current.kind : "service",
                        }))
                      }
                      options={[
                        ["goods", "Goods / Products"],
                        ["services", "Services"],
                        ["works", "Works / Construction"],
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
                        ["service", "Service / works"],
                      ]}
                    />
                  </div>

                  {registerForm.supplierType === "individual" ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          value={registerForm.individualFirstName}
                          onChange={(value) =>
                            setRegisterForm((current) => ({
                              ...current,
                              individualFirstName: value,
                            }))
                          }
                          placeholder="First name"
                        />
                        <Input
                          value={registerForm.individualSecondName}
                          onChange={(value) =>
                            setRegisterForm((current) => ({
                              ...current,
                              individualSecondName: value,
                            }))
                          }
                          placeholder="Second name"
                        />
                        <Input
                          value={registerForm.individualThirdName}
                          onChange={(value) =>
                            setRegisterForm((current) => ({
                              ...current,
                              individualThirdName: value,
                            }))
                          }
                          placeholder="Third name"
                        />
                      </div>
                      <Input
                        value={registerForm.nationalId}
                        onChange={(value) =>
                          setRegisterForm((current) => ({ ...current, nationalId: value }))
                        }
                        placeholder="National ID / Passport No."
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Select
                          value={registerForm.gender}
                          onChange={(value) =>
                            setRegisterForm((current) => ({
                              ...current,
                              gender: value as "Male" | "Female",
                            }))
                          }
                          options={[
                            ["Male", "Male"],
                            ["Female", "Female"],
                          ]}
                        />
                        <Input
                          type="date"
                          value={registerForm.dateOfBirth}
                          onChange={(value) =>
                            setRegisterForm((current) => ({ ...current, dateOfBirth: value }))
                          }
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Input
                        value={registerForm.name}
                        onChange={(value) =>
                          setRegisterForm((current) => ({ ...current, name: value }))
                        }
                        placeholder="Registered business / company name"
                      />
                      <Input
                        value={registerForm.businessRegistrationNumber}
                        onChange={(value) =>
                          setRegisterForm((current) => ({
                            ...current,
                            businessRegistrationNumber: value,
                          }))
                        }
                        placeholder="Business registration / certificate No."
                      />
                      <Input
                        type="date"
                        value={registerForm.registrationDate}
                        onChange={(value) =>
                          setRegisterForm((current) => ({ ...current, registrationDate: value }))
                        }
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          value={registerForm.contactPerson}
                          onChange={(value) =>
                            setRegisterForm((current) => ({ ...current, contactPerson: value }))
                          }
                          placeholder="Primary contact person"
                        />
                        <Input
                          value={registerForm.contactPersonDesignation}
                          onChange={(value) =>
                            setRegisterForm((current) => ({
                              ...current,
                              contactPersonDesignation: value,
                            }))
                          }
                          placeholder="Designation"
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={registerForm.phone}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, phone: value }))
                      }
                      placeholder="Phone number"
                    />
                    <Input
                      value={registerForm.alternativePhone}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, alternativePhone: value }))
                      }
                      placeholder="Alternative phone"
                    />
                  </div>
                  <Input
                    type="email"
                    value={registerForm.email}
                    onChange={(value) =>
                      setRegisterForm((current) => ({ ...current, email: value }))
                    }
                    placeholder="Email address"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={registerForm.postalAddress}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, postalAddress: value }))
                      }
                      placeholder="Postal address / P.O. Box"
                    />
                    <Input
                      value={registerForm.postalCodeTown}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, postalCodeTown: value }))
                      }
                      placeholder="Postal code & town"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={registerForm.county}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, county: value }))
                      }
                      placeholder="County"
                    />
                    <Input
                      value={registerForm.subCountyTown}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, subCountyTown: value }))
                      }
                      placeholder="Sub-county / town"
                    />
                  </div>
                  <Input
                    value={registerForm.physicalLocation}
                    onChange={(value) =>
                      setRegisterForm((current) => ({ ...current, physicalLocation: value }))
                    }
                    placeholder="Physical location"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={registerForm.kraPin}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, kraPin: value.toUpperCase() }))
                      }
                      placeholder="KRA PIN number"
                    />
                    <Input
                      value={registerForm.taxComplianceCertificateNumber}
                      onChange={(value) =>
                        setRegisterForm((current) => ({
                          ...current,
                          taxComplianceCertificateNumber: value,
                        }))
                      }
                      placeholder="Tax compliance certificate No."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={registerForm.agpoCategory}
                      onChange={(value) =>
                        setRegisterForm((current) => ({
                          ...current,
                          agpoCategory: value as AgpoCategory,
                        }))
                      }
                      options={[
                        ["not_applicable", "AGPO: Not applicable"],
                        ["youth", "AGPO: Youth"],
                        ["women", "AGPO: Women"],
                        ["pwd", "AGPO: PWD"],
                      ]}
                    />
                    <Input
                      value={registerForm.regulatoryLicenseNumber}
                      onChange={(value) =>
                        setRegisterForm((current) => ({
                          ...current,
                          regulatoryLicenseNumber: value,
                        }))
                      }
                      placeholder="Regulatory license No."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={registerForm.bankName}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, bankName: value }))
                      }
                      placeholder="Bank name"
                    />
                    <Input
                      value={registerForm.bankBranch}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, bankBranch: value }))
                      }
                      placeholder="Bank branch"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={registerForm.accountName}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, accountName: value }))
                      }
                      placeholder="Account name"
                    />
                    <Input
                      value={registerForm.accountNumber}
                      onChange={(value) =>
                        setRegisterForm((current) => ({ ...current, accountNumber: value }))
                      }
                      placeholder="Account number"
                    />
                  </div>
                  <Input
                    value={registerForm.mpesaPaybillTill}
                    onChange={(value) =>
                      setRegisterForm((current) => ({ ...current, mpesaPaybillTill: value }))
                    }
                    placeholder="M-Pesa Paybill / Till (optional)"
                  />

                  <div className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                    {supplierDocumentOptions(registerForm.supplierType).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!registerForm.documentChecklist[key]}
                          onChange={(event) =>
                            setRegisterForm((current) => ({
                              ...current,
                              documentChecklist: {
                                ...current.documentChecklist,
                                [key]: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>

                  <button
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        const result = await registerSupplier({
                          data: registerForm,
                        });
                        setRegisterForm(emptyRegisterForm());
                        toast.success(`Supplier SBC number: ${result.memberId}`);
                      }, "")
                    }
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" /> Save supplier
                  </button>
                </div>
              </Section>
            </div>

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
                    onChange={(value) =>
                      setInventoryForm((current) => ({ ...current, unit: value }))
                    }
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
                        quantity: 0,
                        unit: value === "fuel" ? "litres" : "unit",
                        unitPrice: 0,
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
                    <Input
                      type="number"
                      value={requestForm.quantity || ""}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, quantity: Number(value) }))
                      }
                      placeholder="Litres requested"
                    />
                    <Input
                      type="number"
                      value={requestForm.unitPrice || ""}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, unitPrice: Number(value) }))
                      }
                      placeholder="Price per litre"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      value={requestForm.commodityName}
                      onChange={(value) =>
                        setRequestForm((current) => ({ ...current, commodityName: value }))
                      }
                      placeholder={requestForm.kind === "service" ? "Service needed" : "Commodity"}
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
                            unitPrice: requestForm.unitPrice,
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
                        unitPrice: 0,
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
                      No matching internal stock is currently enough for this request, so the system
                      should source it from a supplier.
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
                            Owed{" "}
                            {fmtKES(
                              Math.max(
                                0,
                                (supplierDebtById.get(supplier.id) ?? 0) -
                                  (supplierPaymentsById.get(supplier.id) ?? 0),
                              ),
                            )}
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
                      <th className="px-5 py-3 text-left">SBC supplier No.</th>
                      <th className="px-5 py-3 text-left">Kind</th>
                      <th className="px-5 py-3 text-left">Contact</th>
                      <th className="px-5 py-3 text-right">Outstanding debt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {suppliers.map((supplier: any) => {
                      const outstanding =
                        (supplierDebtById.get(supplier.id) ?? 0) -
                        (supplierPaymentsById.get(supplier.id) ?? 0);
                      return (
                        <tr key={supplier.id}>
                          <td className="px-5 py-3 font-medium">{supplier.name}</td>
                          <td className="px-5 py-3 text-xs text-muted-foreground">
                            {supplier.member_id || "Pending"}
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
                                    runAction(
                                      async () => {
                                        await markFulfilled({
                                          data: {
                                            requestId: request.id,
                                            verificationCode:
                                              request.kind === "fuel"
                                                ? verificationValue
                                                : undefined,
                                          },
                                        });
                                      },
                                      request.kind === "fuel"
                                        ? "Fuel delivery confirmed."
                                        : "Supplier request fulfilled.",
                                    )
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
        onChange={(value) =>
          setForm((current) => ({ ...current, itemKind: value as SupplierKind }))
        }
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

function supplierDocumentOptions(
  supplierType: SupplierType,
): Array<[keyof typeof emptySupplierDocuments, string]> {
  const shared: Array<[keyof typeof emptySupplierDocuments, string]> = [
    ["kraPinCertificate", "Valid KRA PIN certificate"],
    ["taxComplianceCertificate", "Valid tax compliance certificate"],
  ];
  if (supplierType === "company") {
    return [
      ["businessRegistrationCertificate", "Certificate of incorporation / registration"],
      ...shared,
      ["cr12", "CR12 form"],
      ["agpoCertificate", "AGPO certificate, if applicable"],
    ];
  }
  return [
    ["nationalId", "Copy of national ID / passport"],
    ...shared,
    ["agpoCertificate", "AGPO certificate, if applicable"],
  ];
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
