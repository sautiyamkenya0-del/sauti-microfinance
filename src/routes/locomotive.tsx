import { createFileRoute, Navigate } from "@tanstack/react-router";
import { HandCoins, UserPlus, Wallet } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { DataTable, useLocomotiveWorkspace } from "@/components/locomotive/LocomotiveWorkspace";
import { Section, StatCard } from "@/components/ui-bits";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive")({
  head: () => ({ meta: [{ title: "Locomotive Admin - Sauti Microfinance" }] }),
  component: LocomotiveAdminPage,
});

function LocomotiveAdminPage() {
  const { currentUser } = useStore();
  const { workspace } = useLocomotiveWorkspace();

  const allowed =
    currentUser.role === "locomotive_admin" ||
    currentUser.role === "director" ||
    currentUser.role === "manager";

  if (!allowed) return <Navigate to="/" />;

  return (
    <>
      <AppHeader
        title="Locomotive Dashboard"
        subtitle="Your members, deposits, wallet balance, and recent locomotive work."
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
