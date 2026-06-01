import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  HandCoins,
  LayoutDashboard,
  LifeBuoy,
  RefreshCw,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import {
  DataTable,
  getAdminStaffIdFromLocation,
  inputCls,
  useLocomotiveWorkspace,
} from "@/components/locomotive/LocomotiveWorkspace";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive-admin-portal")({
  head: () => ({ meta: [{ title: "Locomotive Admin Portal - Sauti Microfinance" }] }),
  component: LocomotiveAdminPortalPage,
});

function LocomotiveAdminPortalPage() {
  const { currentUser } = useStore();
  const [adminStaffId, setAdminStaffId] = useState(() => getAdminStaffIdFromLocation());
  const [adminQuery, setAdminQuery] = useState("");
  const { workspace, refresh } = useLocomotiveWorkspace({ adminStaffId });
  const allowed = currentUser.role === "director" || currentUser.role === "manager";

  useEffect(() => {
    if (adminStaffId || workspace.locomotiveAdmins.length === 0) return;
    setAdminStaffId(String(workspace.locomotiveAdmins[0].id ?? ""));
  }, [adminStaffId, workspace.locomotiveAdmins]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (adminStaffId) url.searchParams.set("adminStaffId", adminStaffId);
    else url.searchParams.delete("adminStaffId");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [adminStaffId]);

  const selectedAdmin = useMemo(
    () =>
      workspace.locomotiveAdmins.find((admin: any) => String(admin.id) === adminStaffId) ??
      workspace.selectedAdmin,
    [adminStaffId, workspace.locomotiveAdmins, workspace.selectedAdmin],
  );
  const filteredAdmins = useMemo(() => {
    const query = adminQuery.trim().toLowerCase();
    if (!query) return workspace.locomotiveAdmins;
    return workspace.locomotiveAdmins.filter((admin: any) =>
      [
        admin.id,
        admin.name,
        admin.member_id,
        admin.email,
        admin.phone,
        admin.branch,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [adminQuery, workspace.locomotiveAdmins]);
  const recentCash = workspace.allocations
    .filter((row: any) => String(row.payment_method ?? "") === "cash")
    .slice(0, 8);
  const recentMpesa = workspace.allocations
    .filter((row: any) => String(row.payment_method ?? "") !== "cash")
    .slice(0, 8);

  if (!allowed) return <Navigate to="/" />;

  return (
    <>
      <AppHeader
        title="Locomotive Admin Portal"
        subtitle="Director view of the exact locomotive admin workspace: members, deposits, wallet activity, and support records."
      />
      <main className="flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
        <Section
          title="Choose admin to inspect"
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
          <div className="grid gap-3 p-5 lg:grid-cols-[minmax(16rem,24rem),1fr]">
            <div className="grid gap-2">
              <input
                className={inputCls}
                placeholder="Search admin by name, staff ID, member, phone"
                value={adminQuery}
                onChange={(event) => setAdminQuery(event.target.value)}
              />
              <select
                value={adminStaffId}
                onChange={(event) => setAdminStaffId(event.target.value)}
                className={inputCls}
              >
                <option value="">All locomotive admins</option>
                {filteredAdmins.map((admin: any) => (
                  <option key={admin.id} value={admin.id}>
                    {admin.name} - {admin.member_id || "no linked member"}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium text-foreground">
                {selectedAdmin?.name ?? "All locomotive admin workspaces"}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Staff ID: {selectedAdmin?.id ?? "all"}</span>
                <span>Linked member: {workspace.actorMemberId || selectedAdmin?.member_id || "-"}</span>
                <span>{selectedAdmin?.email ?? "No email on file"}</span>
                <span>
                  {adminQuery
                    ? `${filteredAdmins.length} matching admin${filteredAdmins.length === 1 ? "" : "s"}`
                    : `${workspace.locomotiveAdmins.length} admins available`}
                </span>
              </div>
            </div>
          </div>
        </Section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Assigned members"
            value={workspace.members.length}
            icon={<Users className="h-5 w-5" />}
          />
          <StatCard
            label="Wallet deposits"
            value={fmtKES(workspace.depositTotal)}
            icon={<Wallet className="h-5 w-5" />}
            tone="success"
          />
          <StatCard
            label="Allocated gross"
            value={fmtKES(workspace.allocatedTotal)}
            icon={<HandCoins className="h-5 w-5" />}
          />
          <StatCard label="Pending claims" value={fmtKES(workspace.pendingTotal)} />
          <StatCard label="Available balance" value={fmtKES(workspace.availableBalance)} />
        </div>

        <Section title="Their login interface">
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
            <InterfaceLink
              to="/locomotive"
              adminStaffId={adminStaffId}
              icon={<LayoutDashboard className="h-4 w-4" />}
              title="Dashboard"
              detail="Stats, recent members, and recent allocations."
            />
            <InterfaceLink
              to="/locomotive-members"
              adminStaffId={adminStaffId}
              icon={<UserPlus className="h-4 w-4" />}
              title="Members"
              detail="Register members and inspect the assigned member list."
            />
            <InterfaceLink
              to="/locomotive-balances"
              adminStaffId={adminStaffId}
              icon={<Wallet className="h-4 w-4" />}
              title="Balances"
              detail="Collect into the admin account and allocate wallet funds."
            />
            <InterfaceLink
              to="/locomotive-support"
              adminStaffId={adminStaffId}
              icon={<LifeBuoy className="h-4 w-4" />}
              title="Support"
              detail="Linked account deposits and support audit."
            />
          </div>
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section title={`Members they manage (${workspace.members.length})`}>
            <DataTable
              empty="No members are assigned to this locomotive admin yet."
              headers={["Member", "Phone", "Vehicle", "Route", "Stage", "Joined"]}
              rows={workspace.members.slice(0, 50).map((member: any) => [
                `${member.id} - ${member.name}`,
                member.phone ?? "",
                member.vehicle_plate ?? "",
                member.locomotive_details?.route ?? member.locomotive_details?.routeOfOperation ?? "",
                member.locomotive_details?.stage ?? member.locomotive_details?.operatingStage ?? "",
                String(member.joined_at ?? "").slice(0, 10),
              ])}
            />
          </Section>

          <Section title={`Wallet deposits (${workspace.deposits.length})`}>
            <DataTable
              empty="No wallet deposits found for the selected admin."
              headers={["Date", "Type", "Amount", "Reference", "Note"]}
              rows={workspace.deposits.slice(0, 50).map((row: any) => [
                String(row.created_at ?? row.date ?? "").slice(0, 10),
                row.type ?? "",
                fmtKES(row.amount ?? 0),
                row.reference ?? row.ref ?? "",
                row.note ?? "",
              ])}
            />
          </Section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section title={`M-Pesa allocations (${recentMpesa.length})`}>
            <DataTable
              empty="No M-Pesa allocations yet."
              headers={["Date", "Member", "Gross", "Deduction", "Net", "Status"]}
              rows={recentMpesa.map((row: any) => [
                String(row.allocated_at ?? "").slice(0, 10),
                row.beneficiary_member_id ?? "",
                fmtKES(row.gross_amount ?? 0),
                fmtKES(row.deduction_amount ?? 0),
                fmtKES(row.net_amount ?? 0),
                row.status ?? "confirmed",
              ])}
            />
          </Section>

          <Section title={`Cash work (${recentCash.length})`}>
            <DataTable
              empty="No cash entries recorded yet."
              headers={["Date", "Member", "Gross", "Deduction", "Net", "Note"]}
              rows={recentCash.map((row: any) => [
                String(row.allocated_at ?? "").slice(0, 10),
                row.beneficiary_member_id ?? "",
                fmtKES(row.gross_amount ?? 0),
                fmtKES(row.deduction_amount ?? 0),
                fmtKES(row.net_amount ?? 0),
                row.note ?? "",
              ])}
            />
          </Section>
        </div>
      </main>
    </>
  );
}

function InterfaceLink({
  to,
  adminStaffId,
  icon,
  title,
  detail,
}: {
  to: string;
  adminStaffId?: string;
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <Link
      to={to as never}
      search={adminStaffId ? ({ adminStaffId } as never) : undefined}
      className="group rounded-md border border-border bg-muted/20 p-4 text-sm hover:bg-muted"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
          {icon}
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
      </div>
      <div className="mt-3 flex items-center gap-2 font-semibold">
        {title}
        <Badge tone="muted">view</Badge>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </Link>
  );
}
