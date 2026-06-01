import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RefreshCw, Send, Smartphone, Wallet } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import {
  DataTable,
  getAdminStaffIdFromLocation,
  inputCls,
  useLocomotiveWorkspace,
} from "@/components/locomotive/LocomotiveWorkspace";
import { Section, StatCard } from "@/components/ui-bits";
import {
  createLocomotiveBusinessWalletAllocationRecord,
  createLocomotiveBusinessWalletPromptRecord,
  listMpesaReceiptAudit,
} from "@/lib/app-data.functions";
import { formatMembershipNumber } from "@/lib/membership";
import { fmtKES, useStore } from "@/lib/store";

type PromptDestination = "locomotive_wallet" | "withdrawable_savings" | "loan_savings";

const promptDestinations: Record<
  PromptDestination,
  { label: string; token: string; description: string }
> = {
  locomotive_wallet: {
    label: "Locomotive wallet",
    token: "LW",
    description: "Collects into the selected locomotive admin wallet.",
  },
  withdrawable_savings: {
    label: "Withdrawable savings",
    token: "WDS",
    description: "Prompts the selected member into their withdrawable savings docket.",
  },
  loan_savings: {
    label: "Loan savings",
    token: "LS",
    description: "Prompts the selected member into their loan savings docket.",
  },
};

export const Route = createFileRoute("/locomotive-balances")({
  head: () => ({ meta: [{ title: "Locomotive Balances - Sauti Microfinance" }] }),
  component: LocomotiveBalancesPage,
});

function LocomotiveBalancesPage() {
  const { currentUser } = useStore();
  const createAllocation = useServerFn(createLocomotiveBusinessWalletAllocationRecord);
  const createPromptRecord = useServerFn(createLocomotiveBusinessWalletPromptRecord);
  const fetchMpesaAudit = useServerFn(listMpesaReceiptAudit);
  const { workspace, refresh } = useLocomotiveWorkspace();
  const [scopedAdminStaffId] = useState(() => getAdminStaffIdFromLocation());
  const [busy, setBusy] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [allocationDraft, setAllocationDraft] = useState({
    beneficiaryMemberId: "",
    grossAmount: "",
    serviceId: "",
    paymentMethod: "cash",
    note: "",
  });
  const [promptDraft, setPromptDraft] = useState({
    destination: "locomotive_wallet" as PromptDestination,
    payer: "self",
    phone: "",
    amount: "",
    note: "",
  });

  const allowed =
    currentUser.role === "locomotive_admin" ||
    currentUser.role === "director" ||
    currentUser.role === "manager";
  const actionAdminStaffId = workspace.selectedAdminStaffId || scopedAdminStaffId || undefined;

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
  const promptDestination = promptDestinations[promptDraft.destination];
  const promptMemberAccountRef = selectedPromptMember?.id
    ? formatMembershipNumber(selectedPromptMember.id)
    : "";
  const promptBaseAccountRef =
    promptDraft.destination === "locomotive_wallet" ? adminAccountRef : promptMemberAccountRef;
  const promptAccountRef = promptBaseAccountRef
    ? `${promptBaseAccountRef}-${promptDestination.token}`.slice(0, 12)
    : "";
  const promptPhone =
    promptDraft.payer === "custom"
      ? promptDraft.phone
      : String(selectedPromptMember?.phone ?? "");
  const { data: adminReceiptRows = [] } = useQuery({
    queryKey: ["locomotive-admin-mpesa-receipts", workspace.actorMemberId],
    queryFn: () => fetchMpesaAudit({ data: { memberId: workspace.actorMemberId } }),
    enabled: !!workspace.actorMemberId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  if (!allowed) return <Navigate to="/" />;

  async function saveAllocation() {
    try {
      setBusy(true);
      const result = await createAllocation({
        data: {
          adminStaffId: actionAdminStaffId,
          beneficiaryMemberId: allocationDraft.beneficiaryMemberId,
          grossAmount: Number(allocationDraft.grossAmount || 0),
          serviceId: allocationDraft.serviceId || undefined,
          paymentMethod:
            allocationDraft.paymentMethod === "mpesa_manual" ? "mpesa_manual" : "cash",
          note: allocationDraft.note,
        },
      });
      setAllocationDraft({
        beneficiaryMemberId: "",
        grossAmount: "",
        serviceId: "",
        paymentMethod: "cash",
        note: "",
      });
      await refresh();
      toast.success(
        allocationDraft.paymentMethod === "cash"
          ? `Cash recorded: ${fmtKES(result.netAmount)} after deductions.`
          : "M-Pesa entry is pending until the exact wallet deposit is detected.",
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to allocate wallet funds.");
    } finally {
      setBusy(false);
    }
  }

  async function sendCollectionPrompt() {
    const amount = Math.max(0, Math.floor(Number(promptDraft.amount || 0)));
    if (promptDraft.destination === "locomotive_wallet" && !adminAccountRef) {
      toast.error("Link this locomotive admin staff account to a member account first.");
      return;
    }
    if (promptDraft.destination !== "locomotive_wallet" && promptDraft.payer === "custom") {
      toast.error("Select a registered member before prompting savings.");
      return;
    }
    if (!promptAccountRef) {
      toast.error("The selected account cannot receive this prompt yet.");
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
      const isWalletPrompt = promptDraft.destination === "locomotive_wallet";
      const res = await fetch("/api/public/mpesa/stkpush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: promptPhone,
          amount,
          accountRef: promptAccountRef,
          description: `${promptDestination.label} deposit - ${payerName}${
            promptDraft.note ? ` - ${promptDraft.note}` : ""
          }`,
          locomotiveWallet:
            isWalletPrompt && promptDraft.payer !== "custom"
              ? {
                  beneficiaryMemberId:
                    promptDraft.payer === "self" ? workspace.actorMemberId : promptDraft.payer,
                  note: promptDraft.note,
                }
              : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? data.errorMessage ?? "STK prompt failed.");
        return;
      }
      if (isWalletPrompt && promptDraft.payer !== "custom") {
        try {
          await createPromptRecord({
            data: {
              adminStaffId: actionAdminStaffId,
              beneficiaryMemberId:
                promptDraft.payer === "self" ? workspace.actorMemberId : promptDraft.payer,
              grossAmount: amount,
              expectedPhone: promptPhone,
              checkoutRequestId: data.CheckoutRequestID,
              merchantRequestId: data.MerchantRequestID,
              note: promptDraft.note,
            },
          });
        } catch (ledgerError: any) {
          toast.warning("Prompt sent, but the pending ledger row was not created.", {
            description: ledgerError?.message,
          });
        }
      }
      setPromptDraft({
        destination: "locomotive_wallet",
        payer: "self",
        phone: "",
        amount: "",
        note: "",
      });
      await refresh();
      toast.success(`Prompt sent. Payment will land in ${promptAccountRef}.`);
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
        <div className="grid gap-4 md:grid-cols-5">
          <StatCard
            label="Admin Paybill account"
            value={adminAccountRef || "Not linked"}
            hint="All member and self prompts collect into this account"
            icon={<Wallet className="h-5 w-5" />}
          />
          <StatCard label="Detected deposits" value={fmtKES(workspace.depositTotal)} />
          <StatCard label="Allocated gross" value={fmtKES(workspace.allocatedTotal)} />
          <StatCard label="Pending ledger" value={fmtKES(workspace.pendingTotal)} />
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
            <select
              className={inputCls}
              value={promptDraft.destination}
              onChange={(event) =>
                setPromptDraft((draft) => ({
                  ...draft,
                  destination: event.target.value as PromptDestination,
                  payer:
                    event.target.value === "locomotive_wallet" || draft.payer !== "custom"
                      ? draft.payer
                      : "self",
                  phone: event.target.value === "locomotive_wallet" ? draft.phone : "",
                }))
              }
            >
              {Object.entries(promptDestinations).map(([value, destination]) => (
                <option key={value} value={value}>
                  {destination.label}
                </option>
              ))}
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
              <span className="font-mono font-semibold">
                {promptAccountRef || "Not linked"}
              </span>
              <div className="mt-1 text-xs text-muted-foreground">
                {promptDestination.description}
              </div>
            </div>
            <button
              disabled={promptBusy || !promptAccountRef}
              onClick={() => void sendCollectionPrompt()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 md:col-span-2"
            >
              {promptBusy ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Smartphone className="h-4 w-4" />
              )}
              Send STK prompt
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
            <select
              className={inputCls}
              value={allocationDraft.paymentMethod}
              onChange={(event) =>
                setAllocationDraft((draft) => ({
                  ...draft,
                  paymentMethod: event.target.value,
                }))
              }
            >
              <option value="cash">Cash paid</option>
              <option value="mpesa_manual">M-Pesa pending verification</option>
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
              {allocationDraft.paymentMethod === "cash"
                ? "Record cash payment"
                : "Record pending M-Pesa"}
            </button>
          </div>
        </Section>

        <Section title={`Original M-Pesa receipts (${(adminReceiptRows as any[]).length})`}>
          <div className="grid gap-3 p-4 md:hidden">
            {(adminReceiptRows as any[]).length === 0 && (
              <div className="rounded-md border border-border p-4 text-center text-sm text-muted-foreground">
                No original M-Pesa receipts have landed in the admin account yet.
              </div>
            )}
            {(adminReceiptRows as any[]).slice(0, 30).map((row: any) => (
              <div key={row.id} className="rounded-md border border-border bg-card p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-xs font-semibold">
                      {row.mpesaRef ?? row.id}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.exactReceivedAt || row.createdAt
                        ? new Date(row.exactReceivedAt ?? row.createdAt).toLocaleString()
                        : "-"}
                    </div>
                  </div>
                  <div className="text-right font-semibold">
                    {fmtKES(Number(row.originalAmount ?? row.amount ?? 0))}
                  </div>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {row.note ?? "M-Pesa receipt"}
                </div>
                <div className="mt-2 font-mono text-[11px] text-muted-foreground">
                  Account {row.account ?? adminAccountRef}
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
            <DataTable
              empty="No original M-Pesa receipts have landed in the admin account yet."
              headers={["Date / Time", "Receipt", "Receipt detail", "Account", "Amount"]}
              rows={(adminReceiptRows as any[]).slice(0, 30).map((row: any) => [
                row.exactReceivedAt || row.createdAt
                  ? new Date(row.exactReceivedAt ?? row.createdAt).toLocaleString()
                  : "-",
                row.mpesaRef ?? row.id,
                row.note ?? "M-Pesa receipt",
                row.account ?? adminAccountRef,
                fmtKES(Number(row.originalAmount ?? row.amount ?? 0)),
              ])}
            />
          </div>
        </Section>

        <Section title={`Allocations (${workspace.allocations.length})`}>
          <DataTable
            empty="No allocations posted yet."
            headers={["Date", "Member", "Gross", "Deduction", "Net", "Method", "Status", "Note"]}
            rows={workspace.allocations.map((row: any) => [
              String(row.allocated_at ?? "").slice(0, 10),
              row.beneficiary_member_id ?? "",
              fmtKES(row.gross_amount ?? 0),
              fmtKES(row.deduction_amount ?? 0),
              fmtKES(row.net_amount ?? 0),
              String(row.payment_method ?? "mpesa").replace(/_/g, " "),
              row.status ?? "confirmed",
              row.note ?? "",
            ])}
          />
        </Section>
      </main>
    </>
  );
}
