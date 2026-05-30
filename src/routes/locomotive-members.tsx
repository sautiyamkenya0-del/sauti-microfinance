import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import {
  DataTable,
  inputCls,
  useLocomotiveWorkspace,
} from "@/components/locomotive/LocomotiveWorkspace";
import { Section } from "@/components/ui-bits";
import { createLocomotiveBusinessMemberRecord } from "@/lib/app-data.functions";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive-members")({
  head: () => ({ meta: [{ title: "Locomotive Members - Sauti Microfinance" }] }),
  component: LocomotiveMembersPage,
});

function LocomotiveMembersPage() {
  const { currentUser } = useStore();
  const createMember = useServerFn(createLocomotiveBusinessMemberRecord);
  const { workspace, refresh } = useLocomotiveWorkspace();
  const [busy, setBusy] = useState(false);
  const [memberDraft, setMemberDraft] = useState({
    name: "",
    phone: "",
    businessName: "",
    vehiclePlate: "",
    route: "",
    stage: "",
  });

  const allowed =
    currentUser.role === "locomotive_admin" ||
    currentUser.role === "director" ||
    currentUser.role === "manager";

  if (!allowed) return <Navigate to="/" />;

  async function saveMember() {
    try {
      if (!memberDraft.name.trim()) {
        toast.error("Enter the member's full name.");
        return;
      }
      if (!memberDraft.phone.trim()) {
        toast.error("Enter the member's phone number.");
        return;
      }
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

  return (
    <>
      <AppHeader
        title="Locomotive Members"
        subtitle="Register and view members assigned to your locomotive workspace."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <Section title="Add member">
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <input
              className={inputCls}
              placeholder="Full name"
              value={memberDraft.name}
              onChange={(event) =>
                setMemberDraft((draft) => ({ ...draft, name: event.target.value }))
              }
            />
            <input
              className={inputCls}
              placeholder="Phone"
              value={memberDraft.phone}
              onChange={(event) =>
                setMemberDraft((draft) => ({ ...draft, phone: event.target.value }))
              }
            />
            <input
              className={inputCls}
              placeholder="Business name"
              value={memberDraft.businessName}
              onChange={(event) =>
                setMemberDraft((draft) => ({ ...draft, businessName: event.target.value }))
              }
            />
            <input
              className={inputCls}
              placeholder="Vehicle plate"
              value={memberDraft.vehiclePlate}
              onChange={(event) =>
                setMemberDraft((draft) => ({ ...draft, vehiclePlate: event.target.value }))
              }
            />
            <input
              className={inputCls}
              placeholder="Route"
              value={memberDraft.route}
              onChange={(event) =>
                setMemberDraft((draft) => ({ ...draft, route: event.target.value }))
              }
            />
            <input
              className={inputCls}
              placeholder="Stage"
              value={memberDraft.stage}
              onChange={(event) =>
                setMemberDraft((draft) => ({ ...draft, stage: event.target.value }))
              }
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

        <Section title={`Members (${workspace.members.length})`}>
          <DataTable
            empty="No locomotive business members registered yet."
            headers={["Member", "Phone", "Vehicle", "Route", "Stage", "Joined"]}
            rows={workspace.members.map((member: any) => [
              `${member.id} - ${member.name}`,
              member.phone ?? "",
              member.vehicle_plate ?? "",
              member.locomotive_details?.route ?? "",
              member.locomotive_details?.stage ?? "",
              member.joined_at ?? "",
            ])}
          />
        </Section>
      </main>
    </>
  );
}
