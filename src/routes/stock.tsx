import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Package, RefreshCw, Save } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard } from "@/components/ui-bits";
import { saveInternalStoreItemRecord } from "@/lib/app-data.functions";
import { listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";
import { fmtKES } from "@/lib/store";

export const Route = createFileRoute("/stock")({
  head: () => ({ meta: [{ title: "Stock - Sauti Microfinance" }] }),
  component: StockPage,
});

function StockPage() {
  const loadWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const saveStock = useServerFn(saveInternalStoreItemRecord);
  const [workspace, setWorkspace] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    itemName: "",
    unit: "unit",
    quality: "",
    brand: "",
    quantityAvailable: 0,
    reorderLevel: 0,
    buyingPrice: 0,
    sellingPrice: 0,
    preferredSupplierId: "",
  });

  async function refresh() {
    setBusy(true);
    try {
      const next = (await loadWorkspace()) as any;
      setWorkspace(next);
      setForm((current) => ({
        ...current,
        preferredSupplierId:
          current.preferredSupplierId ||
          next.suppliers?.find((supplier: any) => supplier.kind === "stock")?.id ||
          "",
      }));
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load stock workspace.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const internalStore = workspace?.internalStore ?? [];
  const suppliers = (workspace?.suppliers ?? []).filter(
    (supplier: any) => supplier.kind === "stock",
  );
  const lowStock = internalStore.filter(
    (item: any) => Number(item.quantity_available ?? 0) <= Number(item.reorder_level ?? 0),
  );
  const stockValue = useMemo(
    () =>
      internalStore.reduce(
        (sum: number, item: any) =>
          sum +
          Number(item.quantity_available ?? 0) * Number(item.selling_price ?? item.unit_price ?? 0),
        0,
      ),
    [internalStore],
  );
  const marginValue = useMemo(
    () =>
      internalStore.reduce((sum: number, item: any) => {
        const qty = Number(item.quantity_available ?? 0);
        const buy = Number(item.buying_price ?? item.unit_price ?? 0);
        const sell = Number(item.selling_price ?? item.unit_price ?? 0);
        return sum + Math.max(0, sell - buy) * qty;
      }, 0),
    [internalStore],
  );

  async function submit() {
    if (!form.itemName.trim()) return toast.error("Enter the stock item name.");
    setBusy(true);
    try {
      await saveStock({
        data: {
          itemName: form.itemName,
          itemKind: "stock",
          unit: form.unit,
          quantityAvailable: form.quantityAvailable,
          reorderLevel: form.reorderLevel,
          unitPrice: form.sellingPrice || form.buyingPrice,
          buyingPrice: form.buyingPrice,
          sellingPrice: form.sellingPrice,
          brand: form.brand,
          quality: form.quality,
          preferredSupplierId: form.preferredSupplierId || undefined,
        },
      });
      toast.success("Stock item saved.");
      setForm({
        itemName: "",
        unit: "unit",
        quality: "",
        brand: "",
        quantityAvailable: 0,
        reorderLevel: 0,
        buyingPrice: 0,
        sellingPrice: 0,
        preferredSupplierId: suppliers[0]?.id ?? "",
      });
      await refresh();
    } catch (error: any) {
      toast.error(error?.message ?? "Could not save the stock item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Stock"
        subtitle="Maintain internal inventory, buying prices, selling prices, reorder levels, and stock-loan availability."
      />
      <main className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
        <SectionTabs section="members" />

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Stock SKUs"
            value={internalStore.length}
            icon={<Package className="h-5 w-5" />}
          />
          <StatCard
            label="Low stock"
            value={lowStock.length}
            tone={lowStock.length ? "warning" : "success"}
          />
          <StatCard
            label="Expected margin"
            value={fmtKES(marginValue)}
            hint={`Selling value ${fmtKES(stockValue)}`}
          />
        </div>

        <Section title="Add / Update Stock">
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Input
              value={form.itemName}
              onChange={(itemName) => setForm({ ...form, itemName })}
              placeholder="Item name"
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
            <Input
              value={form.unit}
              onChange={(unit) => setForm({ ...form, unit })}
              placeholder="Unit"
            />
            <Input
              type="number"
              value={form.quantityAvailable || ""}
              onChange={(value) => setForm({ ...form, quantityAvailable: Number(value) })}
              placeholder="Quantity"
            />
            <Input
              type="number"
              value={form.reorderLevel || ""}
              onChange={(value) => setForm({ ...form, reorderLevel: Number(value) })}
              placeholder="Reorder level"
            />
            <Input
              type="number"
              value={form.buyingPrice || ""}
              onChange={(value) => setForm({ ...form, buyingPrice: Number(value) })}
              placeholder="Buying price"
            />
            <Input
              type="number"
              value={form.sellingPrice || ""}
              onChange={(value) => setForm({ ...form, sellingPrice: Number(value) })}
              placeholder="Selling price"
            />
            <select
              value={form.preferredSupplierId}
              onChange={(event) => setForm({ ...form, preferredSupplierId: event.target.value })}
              className="rounded-md border border-border bg-muted px-3 py-2 text-sm xl:col-span-2"
            >
              <option value="">No preferred supplier</option>
              {suppliers.map((supplier: any) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <button
              onClick={submit}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> Save stock
            </button>
            <button
              onClick={() => refresh()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>
        </Section>

        <Section title="Current Inventory">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Item</th>
                  <th className="px-5 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Buying</th>
                  <th className="px-5 py-3 text-right">Selling</th>
                  <th className="px-5 py-3 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {internalStore.map((item: any) => {
                  const buying = Number(item.buying_price ?? item.unit_price ?? 0);
                  const selling = Number(item.selling_price ?? item.unit_price ?? 0);
                  return (
                    <tr key={item.id}>
                      <td className="px-5 py-3 font-medium">
                        {item.item_name}
                        <div className="text-xs text-muted-foreground">
                          {[item.brand, item.quality, item.unit].filter(Boolean).join(" / ")}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {Number(item.quantity_available ?? 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 text-right">{fmtKES(buying)}</td>
                      <td className="px-5 py-3 text-right">{fmtKES(selling)}</td>
                      <td className="px-5 py-3 text-right font-semibold">
                        {fmtKES(Math.max(0, selling - buying))}
                      </td>
                    </tr>
                  );
                })}
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
