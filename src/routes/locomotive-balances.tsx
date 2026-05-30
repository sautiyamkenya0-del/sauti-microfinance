import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { RefreshCw, Send, Smartphone, Wallet } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import {
  DataTable,
  inputCls,
  useLocomotiveWorkspace,
} from "@/components/locomotive/LocomotiveWorkspace";
import { Section, StatCard } from "@/components/ui-bits";
import { createLocomotiveBusinessWalletAllocationRecord } from "@/lib/app-data.functions";
import { formatMembershipNumber } from "@/lib/membership";
import { fmtKES, useStore } from "@/lib/store";

export const Route = createFileRoute("/locomotive-balances")({
  head: () => ({ meta: [{ title: "Locomotive Balances - Sauti Microfinance" }] }),
  component: LocomotiveBalancesPage,
});

function LocomotiveBalancesPage() {
  const { currentUser } = useStore();
  const createAllocation = useServerFn(createLocomotiveBusinessWalletAllocationRecord);
  const { workspace, refresh } = useLocomotiveWorkspace();
  const [busy, setBusy] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [allocationDraft, setAllocationDraft] = useState({
    beneficiaryMemberId: "",
    grossAmount: "",
    serviceId: "",
    note: "",
  });
  const [promptDraft, setPromptDraft] = useState({
    payer: "self",
    phone: "",
    amount: "",
    note: "",
  });

  const allowed =
    currentUser.role === "locomotive_admin" ||
    currentUser.role === "director" ||
    currentUser.role === "manager";

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
  const adminAccountRef = workspace.actorMemberId
    ? formatMembershipNumber(workspace.actorMemberId)
    : "";
  const selectedPromptMember =
    promptDraft.payer === "self"
      ? workspace.actorMember
      : workspace.members.find((member: any) => member.id === promptDraft.payer);
  const promptPhone =
    promptDraft.payer === "custom"
      ? promptDraft.phone
      : String(selectedPromptMember?.phone ?? "");

  if (!allowed) return <Navigate to="/" />;

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

  async function sendCollectionPrompt() {
    const amount = Math.max(0, Math.floor(Number(promptDraft.amount || 0)));
    if (!adminAccountRef) {
      toast.error("Link this locomotive admin staff account to a member account first.");
      return;
    }
    if (amount <= 0) {
      toast.error("Enter the amount to collect.");
      return;
    }
    if (!promptPhone.trim()) {
      toast.error("Enter or select the phone to prompt.");
      return;
    }

    setPromptBusy(true);
    try {
      const payerName =
        promptDraft.payer === "custom"
          ? "Custom payer"
          : String(selectedPromptMember?.name ?? "Locomotive admin");
      const res = await fetch("/api/public/mpesa/stkpush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: promptPhone,
          amount,
          accountRef: adminAccountRef,
          description: `Locomotive wallet deposit - ${payerName}${
            promptDraft.note ? ` - ${promptDraft.note}` : ""
          }`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? data.errorMessage ?? "STK prompt failed.");
        return;
      }
      setPromptDraft({ payer: "self", phone: "", amount: "", note: "" });
      await refresh();
      toast.success(`Prompt sent. Payment will land in ${adminAccountRef}.`);
    } catch {
      toast.error("M-Pesa request failed. Check the server configuration and try again.");
    } finally {
      setPromptBusy(false);
    }
  }

  return (
    <>
      <AppHeader
        title="Locomotive Balances"
        subtitle="View your wallet balance and distribute funds to registered members."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            label="Admin Paybill account"
            value={adminAccountRef || "Not linked"}
            hint="All member and self prompts collect into this account"
            icon={<Wallet className="h-5 w-5" />}
          />
          <StatCard label="Detected deposits" value={fmtKES(workspace.depositTotal)} />
          <StatCard label="Allocated gross" value={fmtKES(workspace.allocatedTotal)} />
          <StatCard label="Available balance" value={fmtKES(workspace.availableBalance)} />
        </div>

        <Section
          title="Collect into admin account"
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
              value={promptDraft.payer}
              onChange={(event) =>
                setPromptDraft((draft) => ({ ...draft, payer: event.target.value, phone: "" }))
              }
            >
              <option value="self">
                Myself{workspace.actorMember?.name ? ` - ${workspace.actorMember.name}` : ""}
              </option>
              {workspace.members.map((member: any) => (
                <option key={member.id} value={member.id}>
                  {member.id} - {member.name}
                </option>
              ))}
              <option value="custom">Other phone</option>
            </select>
            <input
              className={inputCls}
              placeholder="Phone to prompt"
              value={promptPhone}
              disabled={promptDraft.payer !== "custom"}
              onChange={(event) =>
                setPromptDraft((draft) => ({ ...draft, phone: event.target.value }))
              }
            />
            <input
              className={inputCls}
              type="number"
              min="1"
              placeholder="Amount to collect"
              value={promptDraft.amount}
              onChange={(event) =>
                setPromptDraft((draft) => ({ ...draft, amount: event.target.value }))
              }
            />
            <input
              className={inputCls}
              placeholder="Note"
              value={promptDraft.note}
              onChange={(event) =>
                setPromptDraft((draft) => ({ ...draft, note: event.target.value }))
              }
            />
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm md:col-span-2">
              Account receiving payment:{" "}
              <span className="font-mono font-semibold">{adminAccountRef || "Not linked"}</span>
            </div>
            <button
              disabled={promptBusy || !adminAccountRef}
              onClick={() => void sendCollectionPrompt()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 md:col-span-2"
            >
              {promptBusy ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Smartphone className="h-4 w-4" />
              )}
              Send STK prompt to admin account
            </button>
          </div>
        </Section>

        <Section
          title="Add balance allocation"
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
              onChange={(event) =>
                setAllocationDraft((draft) => ({
                  ...draft,
                  beneficiaryMemberId: event.target.value,
                }))
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
              onChange={(event) =>
                setAllocationDraft((draft) => ({ ...draft, grossAmount: event.target.value }))
              }
            />
            <select
              className={inputCls}
              value={allocationDraft.serviceId}
              onChange={(event) =>
                setAllocationDraft((draft) => ({ ...draft, serviceId: event.target.value }))
              }
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
              onChange={(event) =>
                setAllocationDraft((draft) => ({ ...draft, note: event.target.value }))
              }
            />
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              Deduction {fmtKES(deductionPreview.deduction)} / Net {fmtKES(deductionPreview.net)}
            </div>
            <button
              disabled={busy}
              onClick={() => void saveAllocation()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              Allocate funds
            </button>
          </div>
        </Section>

        <Section title={`Admin account deposits (${workspace.deposits.length})`}>
          <DataTable
            empty="No deposits have landed in the admin account yet."
            headers={["Date", "Type", "Amount", "Account", "Payer", "Reference"]}
            rows={workspace.deposits.slice(0, 30).map((row: any) => [
              String(row.created_at ?? row.date ?? "").slice(0, 10),
              row.type ?? "",
              fmtKES(row.amount ?? 0),
              row.account ?? adminAccountRef,
              row.payer_name ?? "",
              row.ref ?? "",
            ])}
          />
        </Section>

        <Section title={`Allocations (${workspace.allocations.length})`}>
          <DataTable
            empty="No allocations posted yet."
            headers={["Date", "Member", "Gross", "Deduction", "Net", "Note"]}
            rows={workspace.allocations.map((row: any) => [
              String(row.allocated_at ?? "").slice(0, 10),
              row.beneficiary_member_id ?? "",
              fmtKES(row.gross_amount ?? 0),
              fmtKES(row.deduction_amount ?? 0),
              fmtKES(row.net_amount ?? 0),
              row.note ?? "",
            ])}
          />
        </Section>
      </main>
    </>
  );
}
