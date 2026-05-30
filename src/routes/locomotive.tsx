import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HandCoins, RefreshCw, UserPlus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { Section, StatCard } from "@/components/ui-bits";
import {
  createLocomotiveBusinessMemberRecord,
  createLocomotiveBusinessWalletAllocationRecord,
} from "@/lib/app-data.functions";
import { listLocomotiveBusinessWorkspace } from "@/lib/runtime-data.functions";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive")({
  head: () => ({ meta: [{ title: "Locomotive Admin - Sauti Microfinance" }] }),
  component: LocomotiveAdminPage,
});

function LocomotiveAdminPage() {
  const { currentUser } = useStore();
  const loadWorkspace = useServerFn(listLocomotiveBusinessWorkspace);
  const createMember = useServerFn(createLocomotiveBusinessMemberRecord);
  const createAllocation = useServerFn(createLocomotiveBusinessWalletAllocationRecord);
  const [workspace, setWorkspace] = useState<any>({
    members: [],
    allocations: [],
    services: [],
    deposits: [],
    depositTotal: 0,
    allocatedTotal: 0,
    availableBalance: 0,
  });
  const [memberDraft, setMemberDraft] = useState({
    name: "",
    phone: "",
    businessName: "",
    vehiclePlate: "",
    route: "",
    stage: "",
  });
  const [allocationDraft, setAllocationDraft] = useState({
    beneficiaryMemberId: "",
    grossAmount: "",
    serviceId: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);

  const allowed =
    currentUser.role === "locomotive_admin" ||
    currentUser.role === "director" ||
    currentUser.role === "manager";

  const refresh = useCallback(async () => {
    try {
      setWorkspace(await loadWorkspace());
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to load locomotive workspace.");
    }
  }, [loadWorkspace]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const deductionPreview = useMemo(() => {
    const amount = Number(allocationDraft.grossAmount || 0);
    const service =
      workspace.services.find((row: any) => row.id === allocationDraft.serviceId) ??
      workspace.services[0];
    const deductions = service?.normal_deductions ?? {};
    const fixed = Number(
      deductions.fixedAmount ?? deductions.amount ?? deductions.deductionAmount ?? 0,
    );
    const pct = Number(deductions.percentage ?? deductions.percent ?? deductions.deductionPct ?? 0);
    const serviceCharge = Number(service?.service_charge ?? service?.price ?? 0);
    const deduction = Math.min(
      amount,
      Math.max(
        0,
        (Number.isFinite(fixed) ? fixed : 0) +
          (Number.isFinite(pct) ? (amount * pct) / 100 : 0) +
          (Number.isFinite(serviceCharge) ? serviceCharge : 0),
      ),
    );
    return { deduction, net: Math.max(0, amount - deduction) };
  }, [allocationDraft.grossAmount, allocationDraft.serviceId, workspace.services]);

  if (!allowed) return <Navigate to="/" />;

  async function saveMember() {
    try {
      setBusy(true);
      const result = await createMember({ data: memberDraft });
      setMemberDraft({
        name: "",
        phone: "",
        businessName: "",
        vehiclePlate: "",
        route: "",
        stage: "",
      });
      await refresh();
      toast.success(`Member registered - ${result.serviceMemberNumber}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to register member.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAllocation() {
    try {
      setBusy(true);
      const result = await createAllocation({
        data: {
          beneficiaryMemberId: allocationDraft.beneficiaryMemberId,
          grossAmount: Number(allocationDraft.grossAmount || 0),
          serviceId: allocationDraft.serviceId || undefined,
          note: allocationDraft.note,
        },
      });
      setAllocationDraft({ beneficiaryMemberId: "", grossAmount: "", serviceId: "", note: "" });
      await refresh();
      toast.success(`Allocated ${fmtKES(result.netAmount)} after deductions.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to allocate wallet funds.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Locomotive Admin"
        subtitle="Register locomotive business members and distribute deposits through controlled service deductions."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Business members"
            value={workspace.members.length}
            icon={<UserPlus className="h-5 w-5" />}
          />
          <StatCard
            label="Detected deposits"
            value={fmtKES(workspace.depositTotal)}
            icon={<Wallet className="h-5 w-5" />}
          />
          <StatCard
            label="Allocated gross"
            value={fmtKES(workspace.allocatedTotal)}
            icon={<HandCoins className="h-5 w-5" />}
          />
          <StatCard
            label="Available balance"
            value={fmtKES(workspace.availableBalance)}
            icon={<Wallet className="h-5 w-5" />}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.3fr]">
          <Section title="Register locomotive business member">
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <input
                className={inputCls}
                placeholder="Full name"
                value={memberDraft.name}
                onChange={(e) => setMemberDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Phone"
                value={memberDraft.phone}
                onChange={(e) => setMemberDraft((d) => ({ ...d, phone: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Business name"
                value={memberDraft.businessName}
                onChange={(e) => setMemberDraft((d) => ({ ...d, businessName: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Vehicle plate"
                value={memberDraft.vehiclePlate}
                onChange={(e) => setMemberDraft((d) => ({ ...d, vehiclePlate: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Route"
                value={memberDraft.route}
                onChange={(e) => setMemberDraft((d) => ({ ...d, route: e.target.value }))}
              />
              <input
                className={inputCls}
                placeholder="Stage"
                value={memberDraft.stage}
                onChange={(e) => setMemberDraft((d) => ({ ...d, stage: e.target.value }))}
              />
              <button
                disabled={busy}
                onClick={() => void saveMember()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:col-span-2"
              >
                Register member
              </button>
            </div>
          </Section>

          <Section
            title="Ledger distribution"
            action={
              <button
                onClick={() => void refresh()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            }
          >
            <div className="grid gap-3 p-5 md:grid-cols-2">
              <select
                className={inputCls}
                value={allocationDraft.beneficiaryMemberId}
                onChange={(e) =>
                  setAllocationDraft((d) => ({ ...d, beneficiaryMemberId: e.target.value }))
                }
              >
                <option value="">Select member</option>
                {workspace.members.map((member: any) => (
                  <option key={member.id} value={member.id}>
                    {member.id} - {member.name}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                type="number"
                min="0"
                placeholder="Gross amount"
                value={allocationDraft.grossAmount}
                onChange={(e) => setAllocationDraft((d) => ({ ...d, grossAmount: e.target.value }))}
              />
              <select
                className={inputCls}
                value={allocationDraft.serviceId}
                onChange={(e) => setAllocationDraft((d) => ({ ...d, serviceId: e.target.value }))}
              >
                <option value="">Locomotive Business Wallet default</option>
                {workspace.services.map((service: any) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                placeholder="Note"
                value={allocationDraft.note}
                onChange={(e) => setAllocationDraft((d) => ({ ...d, note: e.target.value }))}
              />
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                Deduction {fmtKES(deductionPreview.deduction)} / Net {fmtKES(deductionPreview.net)}
              </div>
              <button
                disabled={busy}
                onClick={() => void saveAllocation()}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                Allocate funds
              </button>
            </div>
          </Section>
        </div>

        <Section title={`Members (${workspace.members.length})`}>
          <DataTable
            empty="No locomotive business members registered yet."
            headers={["Member", "Phone", "Vehicle", "Joined"]}
            rows={workspace.members.map((member: any) => [
              `${member.id} - ${member.name}`,
              member.phone ?? "",
              member.vehicle_plate ?? "",
              member.joined_at ?? "",
            ])}
          />
        </Section>

        <Section title={`Allocations (${workspace.allocations.length})`}>
          <DataTable
            empty="No allocations posted yet."
            headers={["Date", "Member", "Gross", "Deduction", "Net"]}
            rows={workspace.allocations.map((row: any) => [
              String(row.allocated_at ?? "").slice(0, 10),
              row.beneficiary_member_id ?? "",
              fmtKES(row.gross_amount ?? 0),
              fmtKES(row.deduction_amount ?? 0),
              fmtKES(row.net_amount ?? 0),
            ])}
          />
        </Section>
      </main>
    </>
  );
}

function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-5 py-3 text-left">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-5 py-8 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-5 py-3">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-muted px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";
