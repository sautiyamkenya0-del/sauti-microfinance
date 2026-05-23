import { Section, Badge } from "@/components/ui-bits";
import { useStore, fmtKES, loanPricingPreview, loanTermDaysOf } from "@/lib/store";
import { useState } from "react";
import { toast } from "sonner";

export function PendingReview() {
  const { loans, members, staff, currentUser, approveLoan, rejectLoan, appraisals } = useStore();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [adjAmount, setAdjAmount] = useState(0);
  const [note, setNote] = useState("");

  if (currentUser.role === "loan_officer") {
    return (
      <div className="bg-card border border-dashed border-border rounded-xl p-6 text-sm text-muted-foreground">
        Loan officers cannot review applications. Submit your applications and they will appear here
        for the manager or director.
      </div>
    );
  }

  const pending = loans.filter(
    (l) => l.status === "pending" && l.supplierRequestStatus !== "approved",
  );

  return (
    <Section title={`Applications Awaiting Review (${pending.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-5 py-3">Loan</th>
              <th className="text-left px-5 py-3">Type</th>
              <th className="text-left px-5 py-3">Member</th>
              <th className="text-right px-5 py-3">Amount Applied</th>
              <th className="text-right px-5 py-3">Term</th>
              <th className="text-left px-5 py-3">Officer</th>
              <th className="text-left px-5 py-3">Appraisal</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pending.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  No pending applications.
                </td>
              </tr>
            )}
            {pending.map((l) => {
              const m = members.find((x) => x.id === l.memberId);
              const o = staff.find((s) => s.id === l.officerId);
              const ap = appraisals.find((a) => a.loanId === l.id || a.memberId === l.memberId);
              const termDays = loanTermDaysOf(l);
              return (
                <tr key={l.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-mono text-xs">{l.id}</td>
                  <td className="px-5 py-3">
                    <Badge tone={l.loanKind && l.loanKind !== "financial" ? "warning" : "muted"}>
                      {l.loanKind ?? "financial"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 font-medium">{m?.name}</td>
                  <td className="px-5 py-3 text-right">{fmtKES(l.principal)}</td>
                  <td className="px-5 py-3 text-right">{termDays} days</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{o?.name}</td>
                  <td className="px-5 py-3">
                    {ap ? (
                      <Badge
                        tone={
                          ap.decision === "Approve"
                            ? "success"
                            : ap.decision === "Reject"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        {ap.totalScore}/100 · {ap.decision}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No appraisal</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => {
                        setReviewing(l.id);
                        setAdjAmount(ap?.approvedAmount || l.principal);
                        setNote("");
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {reviewing &&
        (() => {
          const l = loans.find((x) => x.id === reviewing)!;
          const m = members.find((x) => x.id === l.memberId);
          const termDays = loanTermDaysOf(l);
          const supplierBacked = l.loanKind != null && l.loanKind !== "financial";
          const pricing = loanPricingPreview({
            netAmount: adjAmount,
            termDays,
            ratePct: l.rate,
            processingFeeMode: l.processingFeeMode,
            insuranceFeeMode: l.insuranceFeeMode,
          });
          return (
            <div
              className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4"
              onClick={() => setReviewing(null)}
            >
              <div
                className="bg-card rounded-xl border border-border w-full max-w-md p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="font-display text-lg font-semibold mb-1">Review · {l.id}</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  {m?.name} · applied {fmtKES(l.principal)}
                </p>
                <label className="block mb-3">
                  <span className="text-xs text-muted-foreground">
                    Approved amount (you may revise downward)
                  </span>
                  <input
                    type="number"
                    max={l.principal}
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(Math.min(l.principal, Number(e.target.value)))}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <div className="text-xs text-muted-foreground mb-3">Term: {termDays} days.</div>
                <div className="bg-muted/50 rounded-md px-3 py-2 text-sm flex justify-between mb-3">
                  <span className="text-muted-foreground">New total repayable</span>
                  <span className="font-semibold">{fmtKES(pricing.totalRepayment)}</span>
                </div>
                <div className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  Net to member {fmtKES(pricing.netDisbursedAmount)} · financed principal{" "}
                  {fmtKES(pricing.financedPrincipal)} · fixed transaction fee{" "}
                  {fmtKES(pricing.deductions.transactionCost)}
                </div>
                <label className="block mb-4">
                  <span className="text-xs text-muted-foreground">Review note (optional)</span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <div className="flex justify-between gap-2">
                  <button
                    onClick={async () => {
                      await rejectLoan(l.id, currentUser.id, note);
                      toast.error("Loan rejected");
                      setReviewing(null);
                    }}
                    className="px-3 py-1.5 text-sm rounded-md text-destructive hover:bg-destructive/10"
                  >
                    Reject
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setReviewing(null)}
                      className="px-3 py-1.5 text-sm rounded-md hover:bg-muted"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (adjAmount <= 0)
                          return toast.error("Approved amount must be above zero.");
                        await approveLoan(l.id, adjAmount, currentUser.id, note);
                        toast.success(
                          supplierBacked
                            ? "Loan approved for supplier fulfillment"
                            : "Loan approved & disbursed",
                        );
                        setReviewing(null);
                      }}
                      className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {supplierBacked ? "Approve for Supplier" : "Approve & Disburse"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </Section>
  );
}
