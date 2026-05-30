import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, Badge } from "@/components/ui-bits";
import { useStore, fmtKES } from "@/lib/store";
import { useApprovals, type ApprovalRequest } from "@/lib/approvals";
import { listSupplierWorkspaceRecord } from "@/lib/runtime-data.functions";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, Banknote, UserCog } from "lucide-react";

export const Route = createFileRoute("/approvals")({
  head: () => ({ meta: [{ title: "Approvals — Sauti Microfinance" }] }),
  component: ApprovalsPage,
});

function ApprovalsPage() {
  const { currentUser, loans, members, appraisals, approveLoan, rejectLoan } = useStore();
  const loadSupplierWorkspace = useServerFn(listSupplierWorkspaceRecord);
  const { items, decide } = useApprovals();
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [supplierWorkspace, setSupplierWorkspace] = useState<any>(null);
  const [repaymentDays, setRepaymentDays] = useState<Record<string, number | "">>({});

  const canDecide = currentUser.role === "director";
  const pendingLoans = loans.filter((l) => l.status === "pending");
  const filteredReqs = items.filter((r) => (filter === "all" ? true : r.status === filter));
  const supplierReadyLoans = loans.filter(
    (loan) =>
      (loan.loanKind === "fuel" || loan.loanKind === "stock" || loan.loanKind === "service") &&
      loan.supplierRequestStatus === "approved",
  );
  const supplierRequests = supplierWorkspace?.requests ?? [];
  const fulfilledSupplierRequests = supplierRequests.filter(
    (request: any) => request.status === "fulfilled",
  );
  const activeSupplierRequests = supplierRequests.filter(
    (request: any) => request.status === "sent",
  );

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const memberHasPriorAppraisal = (memberId: string, loanId: string) =>
    appraisals.some((row) => row.memberId === memberId && row.loanId !== loanId);

  useEffect(() => {
    loadSupplierWorkspace()
      .then(setSupplierWorkspace)
      .catch(() => {});
  }, [loadSupplierWorkspace]);

  return (
    <>
      <AppHeader
        title="Approvals"
        subtitle="Centralized queue for everything that needs sign-off — loans, member requests and policy exceptions."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="lending" />
        {!canDecide && (
          <div className="bg-accent/15 border border-accent/40 rounded-md p-3 text-sm">
            You can <strong>view</strong> approvals here, but only the Director can approve or
            reject cash, loan, and supplier-control decisions.
          </div>
        )}

        {/* Pending Loans (live from store) */}
        <Section title={`Loan Applications Awaiting Review (${pendingLoans.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left">Loan</th>
                  <th className="text-left">Member</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left pl-4">Repayment Days</th>
                  <th className="text-left pl-4">Officer</th>
                  <th className="text-right pr-5">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingLoans.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      No loans awaiting review.
                    </td>
                  </tr>
                )}
                {pendingLoans.map((l) => {
                  const appraisal = appraisals.find((row) => row.loanId === l.id);
                  const appraisalExempt = !appraisal && memberHasPriorAppraisal(l.memberId, l.id);
                  const canApproveLoan =
                    (!!appraisal || appraisalExempt) &&
                    String(appraisal?.decision ?? "").toLowerCase() !== "reject";
                  const reviewedAmount = l.approvedAmount ?? l.principal;
                  const repaymentDayValue =
                    l.id in repaymentDays ? repaymentDays[l.id] : (l.termDays ?? 30);
                  const approvalRepaymentDays =
                    repaymentDayValue === "" ? (l.termDays ?? 30) : repaymentDayValue;
                  return (
                    <tr key={l.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Banknote className="h-4 w-4 text-primary" />
                          <span className="font-mono text-xs">{l.id}</span>
                        </div>
                        {appraisalExempt ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Repeat loan - appraisal exempt
                          </div>
                        ) : !appraisal ? (
                          <div className="mt-1 text-[11px] text-warning-foreground">
                            Appraisal required before approval
                          </div>
                        ) : (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Reviewed: {fmtKES(reviewedAmount)} / {l.termDays ?? 30} days
                          </div>
                        )}
                      </td>
                      <td>{memberName(l.memberId)}</td>
                      <td className="text-right font-medium">
                        <div>{fmtKES(reviewedAmount)}</div>
                        {reviewedAmount !== l.principal ? (
                          <div className="text-[11px] font-normal text-muted-foreground">
                            applied {fmtKES(l.principal)}
                          </div>
                        ) : null}
                      </td>
                      <td className="pl-4">
                        <input
                          type="number"
                          min={1}
                          value={repaymentDayValue}
                          onChange={(event) =>
                            setRepaymentDays((current) => ({
                              ...current,
                              [l.id]:
                                event.target.value === ""
                                  ? ""
                                  : Math.max(1, Number(event.target.value) || 1),
                            }))
                          }
                          className="w-24 rounded-md border border-border bg-card px-2 py-1 text-xs"
                          disabled={!canDecide || !canApproveLoan}
                        />
                      </td>
                      <td className="pl-4 text-xs text-muted-foreground">{l.officerId}</td>
                      <td className="space-x-2 pr-5 text-right">
                        <Link to="/loans" className="text-xs text-primary hover:underline">
                          Open in Loans
                        </Link>
                        {canDecide && (
                          <>
                            <button
                              disabled={!canApproveLoan}
                              title={
                                canApproveLoan
                                  ? "Approve loan"
                                  : "Complete appraisal before approval"
                              }
                              onClick={async () => {
                                if (!canApproveLoan) {
                                  toast.error(
                                    "Complete appraisal before approval. Repeat loans are exempt when this member already has an appraisal record.",
                                  );
                                  return;
                                }
                                try {
                                  await approveLoan(
                                    l.id,
                                    reviewedAmount,
                                    currentUser.id,
                                    "Approved from queue",
                                    approvalRepaymentDays,
                                  );
                                  toast.success("Loan approved and payout requested");
                                } catch (error) {
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Failed to approve loan.",
                                  );
                                }
                              }}
                              className="rounded-md bg-success/15 px-2 py-1 text-xs text-success hover:bg-success/25 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={async () => {
                                await rejectLoan(l.id, currentUser.id, "Rejected from queue");
                                toast.warning("Loan rejected");
                              }}
                              className="rounded-md bg-destructive/15 px-2 py-1 text-xs text-destructive hover:bg-destructive/25"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Member / staff requests */}
        <Section title="Member & Staff Requests">
          <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
            {(["pending", "approved", "rejected", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full text-xs font-medium border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {filteredReqs.length} item(s)
            </span>
          </div>
          <div className="divide-y divide-border">
            {filteredReqs.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No requests.
              </div>
            )}
            {filteredReqs.map((r) => (
              <RequestRow
                key={r.id}
                req={r}
                canDecide={canDecide}
                onDecide={async (d, note, adjustedAmount) => {
                  await decide(r.id, d, currentUser.id, note, adjustedAmount);
                  toast.success(`Request ${d}`);
                }}
              />
            ))}
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section
            title={`Supplier-backed loans waiting for dispatch (${supplierReadyLoans.length})`}
          >
            <div className="divide-y divide-border">
              {supplierReadyLoans.length === 0 ? (
                <div className="px-5 py-8 text-sm text-muted-foreground">
                  No approved supplier-backed loans are waiting for dispatch.
                </div>
              ) : null}
              {supplierReadyLoans.map((loan) => (
                <div key={loan.id} className="px-5 py-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {loan.id} / {memberName(loan.memberId)}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {loan.loanKind} loan approved and waiting to be sent to a supplier.
                      </div>
                    </div>
                    <Link to="/suppliers" className="text-xs text-primary hover:underline">
                      Open Supplier Hub
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title={`Supplier queue needing follow-through (${activeSupplierRequests.length + fulfilledSupplierRequests.length})`}
          >
            <div className="divide-y divide-border">
              {activeSupplierRequests.length === 0 && fulfilledSupplierRequests.length === 0 ? (
                <div className="px-5 py-8 text-sm text-muted-foreground">
                  No supplier actions are waiting right now.
                </div>
              ) : null}
              {[...activeSupplierRequests, ...fulfilledSupplierRequests]
                .slice(0, 8)
                .map((request: any) => (
                  <div key={request.id} className="px-5 py-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">
                          {request.id} / {memberName(request.member_id)}
                        </div>
                        <div className="text-xs text-muted-foreground capitalize">
                          {request.kind} request is {request.status}
                          {request.status === "fulfilled"
                            ? " and waiting for payment."
                            : " and waiting for supplier confirmation."}
                        </div>
                      </div>
                      <Link to="/suppliers" className="text-xs text-primary hover:underline">
                        Open Supplier Hub
                      </Link>
                    </div>
                  </div>
                ))}
            </div>
          </Section>
        </div>
      </main>
    </>
  );
}

function RequestRow({
  req,
  canDecide,
  onDecide,
}: {
  req: ApprovalRequest;
  canDecide: boolean;
  onDecide: (d: "approved" | "rejected", note?: string, adjustedAmount?: number) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [adjustedAmount, setAdjustedAmount] = useState("");
  const payload = (req.payload ?? {}) as Record<string, unknown>;
  const requestType = String(payload.requestType ?? "");
  const supportsAdjustment = ["loan", "fuel_loan", "stock_request", "service_request"].includes(
    requestType,
  );
  const tone =
    req.status === "approved" ? "success" : req.status === "rejected" ? "destructive" : "warning";
  const Icon =
    req.status === "approved" ? CheckCircle2 : req.status === "rejected" ? XCircle : Clock;
  return (
    <div className="px-5 py-4 grid sm:grid-cols-[auto_1fr_auto] gap-3 items-start">
      <div className="mt-0.5">
        <UserCog className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{req.title}</span>
          <Badge tone={tone as any}>
            <Icon className="h-3 w-3 inline mr-1" />
            {req.status}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{req.kind}</span>
        </div>
        <div className="text-sm text-muted-foreground">{req.detail}</div>
        <div className="text-[11px] text-muted-foreground">
          By {req.requestedByName ?? req.requestedBy} · {new Date(req.createdAt).toLocaleString()}
          {req.reviewedBy && (
            <>
              {" "}
              · Reviewed by {req.reviewedBy}
              {req.reviewNote ? ` — “${req.reviewNote}”` : ""}
            </>
          )}
        </div>
      </div>
      {req.status === "pending" && canDecide && (
        <div className="flex flex-col gap-2 min-w-[180px]">
          {supportsAdjustment && (
            <input
              type="number"
              min={0}
              value={adjustedAmount}
              onChange={(e) => setAdjustedAmount(e.target.value)}
              placeholder="Approved amount"
              className="bg-muted border border-border rounded-md px-2 py-1 text-xs"
            />
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note"
            className="bg-muted border border-border rounded-md px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                const finalNote =
                  adjustedAmount.trim() && supportsAdjustment
                    ? [note, `Approved adjusted amount: ${fmtKES(Number(adjustedAmount) || 0)}`]
                        .filter(Boolean)
                        .join(" | ")
                    : note;
                void onDecide(
                  "approved",
                  finalNote,
                  adjustedAmount.trim() && supportsAdjustment
                    ? Math.max(0, Number(adjustedAmount) || 0)
                    : undefined,
                );
              }}
              className="flex-1 text-xs px-2 py-1 rounded-md bg-success/15 text-success hover:bg-success/25"
            >
              Approve
            </button>
            <button
              onClick={() => void onDecide("rejected", note)}
              className="flex-1 text-xs px-2 py-1 rounded-md bg-destructive/15 text-destructive hover:bg-destructive/25"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
