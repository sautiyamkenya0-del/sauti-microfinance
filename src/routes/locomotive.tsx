import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { HandCoins, RefreshCw, UserPlus, Wallet } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import {
  DataTable,
  getAdminStaffIdFromLocation,
  inputCls,
  useLocomotiveWorkspace,
} from "@/components/locomotive/LocomotiveWorkspace";
import { Section, StatCard } from "@/components/ui-bits";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive")({
  head: () => ({ meta: [{ title: "Locomotive Admin - Sauti Microfinance" }] }),
  component: LocomotiveAdminPage,
});

function LocomotiveAdminPage() {
  const { currentUser } = useStore();
  const [adminStaffId, setAdminStaffId] = useState(() => getAdminStaffIdFromLocation());
  const [adminQuery, setAdminQuery] = useState("");
  const { workspace, refresh } = useLocomotiveWorkspace({ adminStaffId });

  const allowed =
    currentUser.role === "locomotive_admin" ||
    currentUser.role === "director" ||
    currentUser.role === "manager";
  const canSimulate = currentUser.role === "director" || currentUser.role === "manager";
  const filteredAdmins = useMemo(() => {
    const query = adminQuery.trim().toLowerCase();
    if (!query) return workspace.locomotiveAdmins;
    return workspace.locomotiveAdmins.filter((admin: any) =>
      [admin.id, admin.name, admin.member_id, admin.email, admin.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [adminQuery, workspace.locomotiveAdmins]);

  useEffect(() => {
    if (!canSimulate || adminStaffId || workspace.locomotiveAdmins.length === 0) return;
    setAdminStaffId(String(workspace.locomotiveAdmins[0].id ?? ""));
  }, [adminStaffId, canSimulate, workspace.locomotiveAdmins]);

  useEffect(() => {
    if (!canSimulate || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (adminStaffId) url.searchParams.set("adminStaffId", adminStaffId);
    else url.searchParams.delete("adminStaffId");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [adminStaffId, canSimulate]);

  if (!allowed) return <Navigate to="/" />;

  return (
    <>
      <AppHeader
        title="Locomotive Dashboard"
        subtitle="Your members, deposits, wallet balance, and recent locomotive work."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        {canSimulate && (
          <Section
            title="Simulate locomotive admin"
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
            <div className="grid gap-3 p-5 md:grid-cols-[minmax(14rem,22rem),minmax(14rem,22rem),1fr]">
              <input
                className={inputCls}
                placeholder="Search admin"
                value={adminQuery}
                onChange={(event) => setAdminQuery(event.target.value)}
              />
              <select
                className={inputCls}
                value={adminStaffId}
                onChange={(event) => setAdminStaffId(event.target.value)}
              >
                <option value="">All locomotive admins</option>
                {filteredAdmins.map((admin: any) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.name} - {admin.member_id || "no linked member"}
                  </option>
                ))}
              </select>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <div className="font-medium">
                  {workspace.selectedAdmin?.name ?? "All locomotive admin workspaces"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Linked member: {workspace.actorMemberId || "-"}
                </div>
              </div>
            </div>
          </Section>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
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
          <StatCard
            label="Withdrawable savings"
            value={fmtKES(workspace.withdrawableSavingsBalance)}
            icon={<Wallet className="h-5 w-5" />}
            tone="success"
          />
          <StatCard
            label="Loan savings"
            value={fmtKES(workspace.loanSavingsBalance)}
            icon={<Wallet className="h-5 w-5" />}
          />
        </div>

        <Section title={`Recent members (${workspace.members.slice(0, 8).length})`}>
          <DataTable
            empty="No locomotive business members registered yet."
            headers={["Member", "Phone", "Vehicle", "Joined"]}
            rows={workspace.members
              .slice(0, 8)
              .map((member: any) => [
                `${member.id} - ${member.name}`,
                member.phone ?? "",
                member.vehicle_plate ?? "",
                member.joined_at ?? "",
              ])}
          />
        </Section>

        <Section title={`Recent allocations (${workspace.allocations.slice(0, 8).length})`}>
          <DataTable
            empty="No allocations posted yet."
            headers={["Date", "Member", "Gross", "Deduction", "Net"]}
            rows={workspace.allocations
              .slice(0, 8)
              .map((row: any) => [
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
