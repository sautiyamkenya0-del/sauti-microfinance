import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AppHeader } from "@/components/AppHeader";
import { DataTable, useLocomotiveWorkspace } from "@/components/locomotive/LocomotiveWorkspace";
import { Section, StatCard } from "@/components/ui-bits";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive-support")({
  head: () => ({ meta: [{ title: "Locomotive Support - Sauti Microfinance" }] }),
  component: LocomotiveSupportPage,
});

function LocomotiveSupportPage() {
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
        title="Locomotive Support"
        subtitle="A focused audit page for your linked account, deposits, and recent wallet activity."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Linked member account" value={workspace.actorMemberId || "-"} />
          <StatCard label="Recent deposit lines" value={workspace.deposits.length} />
          <StatCard label="Available balance" value={fmtKES(workspace.availableBalance)} />
        </div>

        <Section title="Recent deposits">
          <DataTable
            empty="No deposits found for the linked locomotive admin account."
            headers={["Date", "Type", "Amount", "Reference", "Note"]}
            rows={workspace.deposits
              .slice(0, 50)
              .map((row: any) => [
                String(row.created_at ?? row.date ?? "").slice(0, 10),
                row.type ?? "",
                fmtKES(row.amount ?? 0),
                row.reference ?? row.ref ?? "",
                row.note ?? "",
              ])}
          />
        </Section>

        <Section title="Recent allocations">
          <DataTable
            empty="No allocations posted yet."
            headers={["Date", "Member", "Gross", "Deduction", "Net"]}
            rows={workspace.allocations
              .slice(0, 50)
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
