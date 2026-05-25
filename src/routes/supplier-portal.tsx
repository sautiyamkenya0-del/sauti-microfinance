import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import {
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  Plus,
  RefreshCw,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import {
  createSupplierBrokerClientRecord,
  markSupplierFulfilledRecord,
  recordSupplierBrokerClientTransactionRecord,
  saveSupplierInventoryItemRecord,
} from "@/lib/app-data.functions";
import { listSupplierNotices, listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/supplier-portal")({
  head: () => ({ meta: [{ title: "Supplier Portal - Sauti Microfinance" }] }),
  component: SupplierPortalPage,
});

type SupplierKind = "fuel" | "stock" | "service";
type Tab = "overview" | "requests" | "inventory" | "payments" | "profile";

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Overview", icon: Truck },
  { id: "requests", label: "Requests", icon: ClipboardList },
  { id: "inventory", label: "Inventory / People", icon: Boxes },
  { id: "payments", label: "Payments", icon: Wallet },
  { id: "profile", label: "Profile", icon: Users },
];

function SupplierPortalPage() {
  const { logout } = useStore();
  const loadWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const loadNotices = useServerFn(listSupplierNotices);
  const saveInventory = useServerFn(saveSupplierInventoryItemRecord);
  const markFulfilled = useServerFn(markSupplierFulfilledRecord);
  const createBrokerClient = useServerFn(createSupplierBrokerClientRecord);
  const recordBrokerTransaction = useServerFn(recordSupplierBrokerClientTransactionRecord);

  const [workspace, setWorkspace] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [notices, setNotices] = useState<any[]>([]);
  const [verificationInputs, setVerificationInputs] = useState<Record<string, string>>({});

  async function refresh() {
    setBusy(true);
    try {
      const next = await loadWorkspace();
      const suppliers = ((next as any).suppliers ?? []) as any[];
      setWorkspace(next);
      if ((next as any).mode === "supplier") {
        setSelectedSupplierId((next as any).signedSupplierId ?? "");
      } else {
        const requestedSupplierId = new URLSearchParams(window.location.search).get("supplierId");
        setSelectedSupplierId((current) => {
          if (current && suppliers.some((supplier) => supplier.id === current)) return current;
          if (
            requestedSupplierId &&
            suppliers.some((supplier) => supplier.id === requestedSupplierId)
          ) {
            return requestedSupplierId;
          }
          return suppliers[0]?.id ?? "";
        });
      }
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load supplier portal.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const serverMode = workspace?.mode === "supplier" ? "supplier" : "staff";
  const allSuppliers = workspace?.suppliers ?? [];
  const effectiveSupplierId =
    serverMode === "supplier" ? (workspace?.signedSupplierId ?? "") : selectedSupplierId;
  const supplier = allSuppliers.find((row: any) => row.id === effectiveSupplierId);
  const isBroker = supplier?.supplier_class === "special_broker";
  const requests = (workspace?.requests ?? []).filter(
    (row: any) => row.supplier_id === effectiveSupplierId,
  );
  const inventory = (workspace?.supplierInventory ?? []).filter(
    (row: any) => row.supplier_id === effectiveSupplierId,
  );
  const outflows = (workspace?.outflows ?? []).filter(
    (row: any) => row.supplier_id === effectiveSupplierId,
  );
  const members = workspace?.members ?? [];
  const brokerClients = (workspace?.brokerClients ?? []).filter(
    (row: any) => row.supplier_id === effectiveSupplierId,
  );
  const brokerTransactions = (workspace?.brokerTransactions ?? []).filter(
    (row: any) => row.supplier_id === effectiveSupplierId,
  );

  useEffect(() => {
    if (!effectiveSupplierId) {
      setNotices([]);
      return;
    }
    loadNotices({ data: { supplierId: effectiveSupplierId } })
      .then((rows) => setNotices(rows as any[]))
      .catch(() => setNotices([]));
  }, [effectiveSupplierId, loadNotices]);

  const requestAmount = requests
    .filter((row: any) => row.status === "fulfilled" || row.status === "paid")
    .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
  const paidAmount = outflows.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
  const outstanding = Math.max(0, requestAmount - paidAmount);
  const openRequests = requests.filter((row: any) => row.status === "sent").length;

  const brokerTotals = useMemo(() => {
    const opening = brokerClients.reduce(
      (sum: number, client: any) => sum + Number(client.opening_balance ?? 0),
      0,
    );
    const deposits = brokerTransactions
      .filter((row: any) => row.kind === "deposit")
      .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
    const withdrawals = brokerTransactions
      .filter((row: any) => row.kind === "withdrawal")
      .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
    const clientBalances = brokerClients.reduce(
      (sum: number, client: any) => sum + Number(client.current_balance ?? 0),
      0,
    );
    return {
      opening,
      deposits,
      withdrawals,
      ledgerNet: opening + deposits - withdrawals,
      clientBalances,
    };
  }, [brokerClients, brokerTransactions]);

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

  return (
    <>
      {serverMode === "staff" ? (
        <AppHeader
          title="Supplier Portal"
          subtitle="Choose a supplier and simulate the exact portal experience they see."
        />
      ) : (
        <PortalHeader
          supplierName={supplier?.name ?? "Supplier"}
          isBroker={isBroker}
          onLogout={() => void logout()}
        />
      )}

      <main className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
        {serverMode === "staff" ? (
          <Section title="Choose supplier to simulate">
            <div className="flex flex-wrap items-end gap-3 p-5">
              <label className="min-w-[260px] flex-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Supplier
                </span>
                <Select
                  value={selectedSupplierId}
                  onChange={(value) => {
                    setSelectedSupplierId(value);
                    setTab("overview");
                    const nextUrl = new URL(window.location.href);
                    if (value) nextUrl.searchParams.set("supplierId", value);
                    else nextUrl.searchParams.delete("supplierId");
                    window.history.replaceState(null, "", nextUrl.toString());
                  }}
                  options={
                    allSuppliers.length
                      ? allSuppliers.map((row: any) => [
                          row.id,
                          `${row.name} (${supplierClassLabel(row.supplier_class)})`,
                        ])
                      : [["", "No suppliers registered"]]
                  }
                />
              </label>
              <button
                onClick={() => refresh()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
            </div>
          </Section>
        ) : null}

        {!supplier ? (
          <div className="rounded-md border border-border bg-card p-6 text-sm text-muted-foreground">
            Choose a supplier to open the portal.
          </div>
        ) : (
          <>
            {serverMode === "staff" ? (
              <div className="rounded-md border border-accent/40 bg-accent/10 p-4 text-sm">
                Staff simulation - viewing as <span className="font-semibold">{supplier.name}</span>
              </div>
            ) : null}

            <PortalTabs tab={tab} onTab={setTab} />

            {tab === "overview" ? (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label={isBroker ? "Registered people" : "Open requests"}
                    value={isBroker ? brokerClients.length : openRequests}
                    icon={
                      isBroker ? (
                        <Users className="h-5 w-5" />
                      ) : (
                        <ClipboardList className="h-5 w-5" />
                      )
                    }
                  />
                  <StatCard
                    label={isBroker ? "Client balances" : "Outstanding payment"}
                    value={isBroker ? fmtKES(brokerTotals.clientBalances) : fmtKES(outstanding)}
                    tone="warning"
                    icon={<Wallet className="h-5 w-5" />}
                  />
                  <StatCard
                    label={isBroker ? "Deposits recorded" : "Inventory lines"}
                    value={isBroker ? fmtKES(brokerTotals.deposits) : inventory.length}
                    icon={<Boxes className="h-5 w-5" />}
                  />
                  <StatCard
                    label={isBroker ? "Math check" : "Payments received"}
                    value={
                      isBroker
                        ? Math.abs(brokerTotals.ledgerNet - brokerTotals.clientBalances) < 0.01
                          ? "Balanced"
                          : fmtKES(brokerTotals.ledgerNet - brokerTotals.clientBalances)
                        : fmtKES(paidAmount)
                    }
                    tone={
                      isBroker &&
                      Math.abs(brokerTotals.ledgerNet - brokerTotals.clientBalances) >= 0.01
                        ? "destructive"
                        : "success"
                    }
                    icon={<CheckCircle2 className="h-5 w-5" />}
                  />
                </div>

                <Section title={`Notices (${notices.length})`}>
                  <div className="space-y-3 p-5">
                    {notices.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No supplier notices yet.</div>
                    ) : null}
                    {notices.map((notice) => (
                      <div key={notice.id} className="rounded-md border border-border p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{notice.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {notice.date} by {notice.by}
                            </div>
                          </div>
                          <Badge
                            tone={
                              notice.kind === "alert"
                                ? "destructive"
                                : notice.kind === "warning"
                                  ? "warning"
                                  : "default"
                            }
                          >
                            {notice.kind ?? "info"}
                          </Badge>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm">{notice.body}</p>
                      </div>
                    ))}
                  </div>
                </Section>
              </div>
            ) : null}

            {tab === "requests" ? (
              <SupplierRequests
                requests={requests}
                members={members}
                busy={busy}
                verificationInputs={verificationInputs}
                setVerificationInputs={setVerificationInputs}
                onFulfill={(requestId, verificationCode) =>
                  runAction(async () => {
                    await markFulfilled({
                      data: {
                        requestId,
                        verificationCode: verificationCode || undefined,
                      },
                    });
                  }, "Request fulfilled.")
                }
              />
            ) : null}

            {tab === "inventory" ? (
              isBroker ? (
                <BrokerPeopleLedger
                  clients={brokerClients}
                  transactions={brokerTransactions}
                  totals={brokerTotals}
                  busy={busy}
                  onCreateClient={(payload) =>
                    runAction(async () => {
                      await createBrokerClient({ data: { supplierId: supplier.id, ...payload } });
                    }, "Person added.")
                  }
                  onRecordTransaction={(payload) =>
                    runAction(async () => {
                      await recordBrokerTransaction({
                        data: { supplierId: supplier.id, ...payload },
                      });
                    }, "Ledger updated.")
                  }
                />
              ) : (
                <Section title="Supplier inventory">
                  <div className="space-y-4 p-5">
                    <SupplierInventoryForm
                      supplierId={supplier.id}
                      defaultKind={(supplier.kind ?? "stock") as SupplierKind}
                      busy={busy}
                      onSave={(payload) =>
                        runAction(async () => {
                          await saveInventory({ data: payload });
                        }, "Inventory saved.")
                      }
                    />
                    <InventoryTable rows={inventory} />
                  </div>
                </Section>
              )
            ) : null}

            {tab === "payments" ? (
              <Section title={isBroker ? "Broker totals" : "Supplier payments"}>
                {isBroker ? (
                  <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard label="Opening balances" value={fmtKES(brokerTotals.opening)} />
                    <StatCard
                      label="Deposits"
                      value={fmtKES(brokerTotals.deposits)}
                      tone="success"
                    />
                    <StatCard
                      label="Withdrawals"
                      value={fmtKES(brokerTotals.withdrawals)}
                      tone="warning"
                    />
                    <StatCard
                      label="Current client balances"
                      value={fmtKES(brokerTotals.clientBalances)}
                    />
                  </div>
                ) : (
                  <PaymentsTable requests={requests} outflows={outflows} />
                )}
              </Section>
            ) : null}

            {tab === "profile" ? <SupplierProfile supplier={supplier} isBroker={isBroker} /> : null}
          </>
        )}
      </main>
    </>
  );
}

function PortalHeader({
  supplierName,
  isBroker,
  onLogout,
}: {
  supplierName: string;
  isBroker: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="border-b border-border bg-card/70 px-4 pb-4 pt-0 backdrop-blur sm:px-6">
      <div className="safe-area-spacer md:hidden" />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 pt-3 sm:pt-5">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Sauti Microfinance
          </div>
          <h1 className="mt-1 truncate font-display text-xl font-semibold text-foreground sm:text-2xl">
            Supplier Portal
          </h1>
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
            {supplierName} - {isBroker ? "special broker people ledger" : "requests and inventory"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <button
            onClick={onLogout}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function PortalTabs({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  return (
    <>
      <div className="rounded-md border border-border bg-card p-3 sm:hidden">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Menu</span>
        <select
          value={tab}
          onChange={(event) => onTab(event.target.value as Tab)}
          className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          {TABS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="hidden flex-wrap gap-2 rounded-md border border-border bg-card p-2 sm:flex">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTab(item.id)}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                tab === item.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {item.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

function SupplierRequests({
  requests,
  members,
  busy,
  verificationInputs,
  setVerificationInputs,
  onFulfill,
}: {
  requests: any[];
  members: any[];
  busy: boolean;
  verificationInputs: Record<string, string>;
  setVerificationInputs: Dispatch<SetStateAction<Record<string, string>>>;
  onFulfill: (requestId: string, verificationCode?: string) => void;
}) {
  return (
    <Section title={`Requests (${requests.length})`}>
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
                  No supplier requests are waiting here.
                </td>
              </tr>
            ) : null}
            {requests.map((request) => {
              const member = members.find((row) => row.id === request.member_id);
              const verificationValue = verificationInputs[request.id] ?? "";
              return (
                <tr key={request.id}>
                  <td className="px-5 py-3">
                    <div className="font-medium">{member?.name ?? request.member_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {request.loan_id || "No loan linked"}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium">{summarizeRequest(request)}</div>
                    {request.verification_code ? (
                      <div className="mt-1 text-xs text-muted-foreground">Driver code required</div>
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
                            disabled={busy}
                            onClick={() => onFulfill(request.id, verificationValue)}
                            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
                      ) : (
                        <span className="text-xs text-muted-foreground">No action</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function SupplierInventoryForm({
  supplierId,
  defaultKind,
  busy,
  onSave,
}: {
  supplierId: string;
  defaultKind: SupplierKind;
  busy: boolean;
  onSave: (payload: {
    supplierId: string;
    itemKind: SupplierKind;
    itemName: string;
    unit: string;
    quantityAvailable: number;
    unitPrice: number;
    buyingPrice: number;
    sellingPrice: number;
    brand?: string;
    quality?: string;
  }) => Promise<void>;
}) {
  const [form, setForm] = useState({
    itemKind: defaultKind,
    itemName: "",
    unit: "unit",
    quantityAvailable: 0,
    buyingPrice: 0,
    sellingPrice: 0,
    brand: "",
    quality: "",
  });

  return (
    <div className="grid gap-3 rounded-md border border-border bg-muted/30 p-4 md:grid-cols-2 xl:grid-cols-4">
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
        onChange={(itemName) => setForm({ ...form, itemName })}
        placeholder="Commodity / service"
      />
      <Input
        value={form.brand}
        onChange={(brand) => setForm({ ...form, brand })}
        placeholder="Brand"
      />
      <Input
        value={form.quality}
        onChange={(quality) => setForm({ ...form, quality })}
        placeholder="Quality / grade"
      />
      <Input value={form.unit} onChange={(unit) => setForm({ ...form, unit })} placeholder="Unit" />
      <Input
        type="number"
        value={form.quantityAvailable || ""}
        onChange={(quantityAvailable) =>
          setForm({ ...form, quantityAvailable: Number(quantityAvailable) })
        }
        placeholder="Quantity"
      />
      <Input
        type="number"
        value={form.buyingPrice || ""}
        onChange={(buyingPrice) => setForm({ ...form, buyingPrice: Number(buyingPrice) })}
        placeholder="Buying price"
      />
      <Input
        type="number"
        value={form.sellingPrice || ""}
        onChange={(sellingPrice) => setForm({ ...form, sellingPrice: Number(sellingPrice) })}
        placeholder="Selling price"
      />
      <button
        disabled={busy}
        onClick={() =>
          onSave({
            supplierId,
            itemKind: form.itemKind,
            itemName: form.itemName,
            unit: form.unit,
            quantityAvailable: form.quantityAvailable,
            unitPrice: form.sellingPrice || form.buyingPrice,
            buyingPrice: form.buyingPrice,
            sellingPrice: form.sellingPrice,
            brand: form.brand || undefined,
            quality: form.quality || undefined,
          }).then(() =>
            setForm({
              itemKind: defaultKind,
              itemName: "",
              unit: "unit",
              quantityAvailable: 0,
              buyingPrice: 0,
              sellingPrice: 0,
              brand: "",
              quality: "",
            }),
          )
        }
        className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Save inventory
      </button>
    </div>
  );
}

function BrokerPeopleLedger({
  clients,
  transactions,
  totals,
  busy,
  onCreateClient,
  onRecordTransaction,
}: {
  clients: any[];
  transactions: any[];
  totals: {
    opening: number;
    deposits: number;
    withdrawals: number;
    ledgerNet: number;
    clientBalances: number;
  };
  busy: boolean;
  onCreateClient: (payload: {
    firstName: string;
    secondName?: string;
    thirdName?: string;
    nationalId?: string;
    role?: string;
    phone?: string;
    openingBalance?: number;
  }) => Promise<void>;
  onRecordTransaction: (payload: {
    clientId: string;
    kind: "deposit" | "withdrawal";
    amount: number;
    note?: string;
  }) => Promise<void>;
}) {
  const [personForm, setPersonForm] = useState({
    firstName: "",
    secondName: "",
    thirdName: "",
    nationalId: "",
    role: "Driver",
    phone: "",
    openingBalance: 0,
  });
  const [moneyForm, setMoneyForm] = useState({
    clientId: "",
    kind: "deposit" as "deposit" | "withdrawal",
    amount: 0,
    note: "",
  });

  useEffect(() => {
    if (!moneyForm.clientId && clients[0]?.id) {
      setMoneyForm((current) => ({ ...current, clientId: clients[0].id }));
    }
  }, [clients, moneyForm.clientId]);

  return (
    <div className="space-y-6">
      <Section title="Register person">
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
          <Input
            value={personForm.firstName}
            onChange={(firstName) => setPersonForm({ ...personForm, firstName })}
            placeholder="First name"
          />
          <Input
            value={personForm.secondName}
            onChange={(secondName) => setPersonForm({ ...personForm, secondName })}
            placeholder="Second name"
          />
          <Input
            value={personForm.thirdName}
            onChange={(thirdName) => setPersonForm({ ...personForm, thirdName })}
            placeholder="Third name"
          />
          <Input
            value={personForm.nationalId}
            onChange={(nationalId) => setPersonForm({ ...personForm, nationalId })}
            placeholder="ID number"
          />
          <Input
            value={personForm.role}
            onChange={(role) => setPersonForm({ ...personForm, role })}
            placeholder="Role"
          />
          <Input
            value={personForm.phone}
            onChange={(phone) => setPersonForm({ ...personForm, phone })}
            placeholder="Phone number"
          />
          <Input
            type="number"
            value={personForm.openingBalance || ""}
            onChange={(openingBalance) =>
              setPersonForm({ ...personForm, openingBalance: Number(openingBalance) })
            }
            placeholder="Deposit balance"
          />
          <button
            disabled={busy}
            onClick={() =>
              onCreateClient(personForm).then(() =>
                setPersonForm({
                  firstName: "",
                  secondName: "",
                  thirdName: "",
                  nationalId: "",
                  role: "Driver",
                  phone: "",
                  openingBalance: 0,
                }),
              )
            }
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add person
          </button>
        </div>
      </Section>

      <Section title="Deposits and withdrawals">
        <div className="grid gap-3 border-b border-border p-5 md:grid-cols-2 xl:grid-cols-5">
          <Select
            value={moneyForm.clientId}
            onChange={(clientId) => setMoneyForm({ ...moneyForm, clientId })}
            options={
              clients.length
                ? clients.map((client) => [client.id, brokerClientName(client)])
                : [["", "No people registered"]]
            }
          />
          <Select
            value={moneyForm.kind}
            onChange={(kind) =>
              setMoneyForm({ ...moneyForm, kind: kind as "deposit" | "withdrawal" })
            }
            options={[
              ["deposit", "Deposit"],
              ["withdrawal", "Withdrawal"],
            ]}
          />
          <Input
            type="number"
            value={moneyForm.amount || ""}
            onChange={(amount) => setMoneyForm({ ...moneyForm, amount: Number(amount) })}
            placeholder="Amount"
          />
          <Input
            value={moneyForm.note}
            onChange={(note) => setMoneyForm({ ...moneyForm, note })}
            placeholder="Note"
          />
          <button
            disabled={busy || !moneyForm.clientId}
            onClick={() =>
              onRecordTransaction(moneyForm).then(() =>
                setMoneyForm((current) => ({ ...current, amount: 0, note: "" })),
              )
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Update balance
          </button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Opening balances" value={fmtKES(totals.opening)} />
          <StatCard label="Deposits" value={fmtKES(totals.deposits)} tone="success" />
          <StatCard label="Withdrawals" value={fmtKES(totals.withdrawals)} tone="warning" />
          <StatCard label="Client balances" value={fmtKES(totals.clientBalances)} />
          <StatCard
            label="System math"
            value={
              Math.abs(totals.ledgerNet - totals.clientBalances) < 0.01
                ? "Balanced"
                : fmtKES(totals.ledgerNet - totals.clientBalances)
            }
            tone={
              Math.abs(totals.ledgerNet - totals.clientBalances) < 0.01 ? "success" : "destructive"
            }
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left">Person</th>
                <th className="px-5 py-3 text-left">ID / role</th>
                <th className="px-5 py-3 text-left">Phone</th>
                <th className="px-5 py-3 text-right">Opening</th>
                <th className="px-5 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No people registered yet.
                  </td>
                </tr>
              ) : null}
              {clients.map((client) => (
                <tr key={client.id}>
                  <td className="px-5 py-3 font-medium">{brokerClientName(client)}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {client.national_id || "-"} / {client.role || "-"}
                  </td>
                  <td className="px-5 py-3">{client.phone || "-"}</td>
                  <td className="px-5 py-3 text-right">
                    {fmtKES(Number(client.opening_balance ?? 0))}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold">
                    {fmtKES(Number(client.current_balance ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Recent ledger movements">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-left">Person</th>
                <th className="px-5 py-3 text-left">Kind</th>
                <th className="px-5 py-3 text-right">Amount</th>
                <th className="px-5 py-3 text-right">Balance after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions.slice(0, 20).map((tx) => {
                const client = clients.find((row) => row.id === tx.supplier_client_id);
                return (
                  <tr key={tx.id}>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {tx.created_at ? new Date(tx.created_at).toLocaleString() : "-"}
                    </td>
                    <td className="px-5 py-3">
                      {client ? brokerClientName(client) : tx.supplier_client_id}
                    </td>
                    <td className="px-5 py-3 capitalize">{tx.kind}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(Number(tx.amount ?? 0))}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {fmtKES(Number(tx.balance_after ?? 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
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
            <th className="px-5 py-3 text-right">Buying</th>
            <th className="px-5 py-3 text-right">Selling</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                No inventory loaded yet.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-5 py-3 font-medium">
                {row.item_name}
                <div className="text-xs text-muted-foreground">
                  {[row.brand, row.quality, row.unit].filter(Boolean).join(" / ")}
                </div>
              </td>
              <td className="px-5 py-3">{kindLabel(row.item_kind)}</td>
              <td className="px-5 py-3 text-right">
                {Number(row.quantity_available ?? 0).toLocaleString()}
              </td>
              <td className="px-5 py-3 text-right">
                {fmtKES(Number(row.buying_price ?? row.unit_price ?? 0))}
              </td>
              <td className="px-5 py-3 text-right font-semibold">
                {fmtKES(Number(row.selling_price ?? row.unit_price ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentsTable({ requests, outflows }: { requests: any[]; outflows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-3 text-left">Reference</th>
            <th className="px-5 py-3 text-left">Status</th>
            <th className="px-5 py-3 text-right">Request amount</th>
            <th className="px-5 py-3 text-right">Paid</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {requests.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                No payment rows yet.
              </td>
            </tr>
          ) : null}
          {requests.map((request) => {
            const paid =
              request.status === "paid"
                ? Number(request.amount ?? 0)
                : outflows
                    .filter((outflow) => outflow.loan_id && outflow.loan_id === request.loan_id)
                    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
            return (
              <tr key={request.id}>
                <td className="px-5 py-3 font-mono text-xs">{request.id}</td>
                <td className="px-5 py-3 capitalize">{request.status}</td>
                <td className="px-5 py-3 text-right">{fmtKES(Number(request.amount ?? 0))}</td>
                <td className="px-5 py-3 text-right font-semibold">{fmtKES(paid)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SupplierProfile({ supplier, isBroker }: { supplier: any; isBroker: boolean }) {
  return (
    <Section title="Supplier profile">
      <div className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
        <Field label="Name" value={supplier.name} />
        <Field label="Class" value={supplierClassLabel(supplier.supplier_class)} />
        <Field label="Kind" value={isBroker ? "People broker" : kindLabel(supplier.kind)} />
        <Field label="Phone" value={supplier.phone} />
        <Field label="Email" value={supplier.email} />
        <Field label="Location" value={supplier.location || supplier.physical_location} />
        <Field label="Linked login account" value={supplier.member_id} />
        <Field label="Status" value={supplier.status} />
      </div>
    </Section>
  );
}

function Field({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value || <span className="text-muted-foreground">-</span>}</div>
    </div>
  );
}

function summarizeRequest(request: any) {
  if (request.kind === "fuel") {
    return `${request.fuel_type || "Fuel"} for ${request.vehicle_plate || request.commodity_name || "vehicle"}`;
  }
  if (request.kind === "service") {
    return request.commodity_name || request.detail?.serviceType || "Service request";
  }
  return `${request.commodity_name || request.detail?.item || "Stock"} ${
    request.quantity_requested ? `x ${request.quantity_requested}` : ""
  }`.trim();
}

function brokerClientName(client: any) {
  return [client.first_name, client.second_name, client.third_name].filter(Boolean).join(" ");
}

function supplierClassLabel(value?: string) {
  return value === "special_broker" ? "Special broker" : "Normal supplier";
}

function kindLabel(value?: string) {
  if (value === "fuel") return "Fuel";
  if (value === "service") return "Service";
  return "Stock";
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
      className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
    >
      {options.map(([optionValue, label]) => (
        <option key={optionValue || label} value={optionValue}>
          {label}
        </option>
      ))}
    </select>
  );
}
