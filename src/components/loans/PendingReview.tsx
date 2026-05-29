import { Section, Badge } from "@/components/ui-bits";
import { useServerFn } from "@tanstack/react-start";
import { saveLoanReviewRecord } from "@/lib/app-data.functions";
import {
  useStore,
  fmtKES,
  loanPricingPreview,
  loanTermDaysOf,
  loanProductChargeAmount,
  type Loan,
  type LoanKind,
} from "@/lib/store";
import { useState } from "react";
import { toast } from "sonner";

type ProductFilter = "all" | LoanKind;
type ReviewProductDraft = {
  vehiclePlate: string;
  fuelType: string;
  litres: number;
  unitPrice: number;
  productChargeAmount: number;
  weekStarting: string;
  weekEnding: string;
  item: string;
  quantity: number;
  serviceType: string;
  notes: string;
};

const PRODUCT_FILTERS: { key: ProductFilter; label: string }[] = [
  { key: "all", label: "All products" },
  { key: "financial", label: "Financial" },
  { key: "fuel", label: "Fuel" },
  { key: "stock", label: "Stock" },
  { key: "service", label: "Service" },
];

export function PendingReview() {
  const { loans, members, staff, currentUser, rejectLoan, appraisals, reloadAppData } = useStore();
  const saveLoanReview = useServerFn(saveLoanReviewRecord);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [appliedAmount, setAppliedAmount] = useState(0);
  const [adjAmount, setAdjAmount] = useState(0);
  const [adjTermDays, setAdjTermDays] = useState(30);
  const [reviewPurpose, setReviewPurpose] = useState("");
  const [productDraft, setProductDraft] = useState<ReviewProductDraft>(() =>
    productDraftFromLoan(),
  );
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");

  if (currentUser.role !== "director") {
    return (
      <div className="bg-card border border-dashed border-border rounded-xl p-6 text-sm text-muted-foreground">
        Loan officers and managers can request and prepare applications here, but only the director
        can approve or reject them.
      </div>
    );
  }

  const pending = loans.filter((loan) => {
    if (loan.status !== "pending" || loan.supplierRequestStatus === "approved") return false;
    if (productFilter === "all") return true;
    return (loan.loanKind ?? "financial") === productFilter;
  });

  return (
    <Section title={`Applications Awaiting Review (${pending.length})`}>
      <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
        {PRODUCT_FILTERS.map((filter) => {
          const active = productFilter === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setProductFilter(filter.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
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
            {pending.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-muted-foreground text-sm">
                  No pending applications.
                </td>
              </tr>
            ) : null}
            {pending.map((loan) => {
              const member = members.find((row) => row.id === loan.memberId);
              const officer = staff.find((row) => row.id === loan.officerId);
              const appraisal = appraisals.find((row) => row.loanId === loan.id);
              const termDays = loanTermDaysOf(loan);
              return (
                <tr key={loan.id} className="hover:bg-muted/30">
                  <td className="px-5 py-3 font-mono text-xs">{loan.id}</td>
                  <td className="px-5 py-3">
                    <Badge
                      tone={loan.loanKind && loan.loanKind !== "financial" ? "warning" : "muted"}
                    >
                      {loan.loanKind ?? "financial"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 font-medium">{member?.name}</td>
                  <td className="px-5 py-3 text-right">{fmtKES(loan.principal)}</td>
                  <td className="px-5 py-3 text-right">{termDays} days</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{officer?.name}</td>
                  <td className="px-5 py-3">
                    {appraisal ? (
                      <Badge
                        tone={
                          appraisal.decision === "Approve"
                            ? "success"
                            : appraisal.decision === "Reject"
                              ? "destructive"
                              : "warning"
                        }
                      >
                        Appraisal done - {appraisal.totalScore}/100 - {appraisal.decision}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Pending appraisal</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => {
                        const termDays = loanTermDaysOf(loan);
                        setReviewing(loan.id);
                        setAppliedAmount(loan.principal);
                        setAdjAmount(appraisal?.approvedAmount || loan.principal);
                        setAdjTermDays(termDays);
                        setReviewPurpose(loan.purpose ?? "");
                        setProductDraft(productDraftFromLoan(loan));
                        setNote("");
                        setShowAll(false);
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
          const loan = loans.find((row) => row.id === reviewing)!;
          const member = members.find((row) => row.id === loan.memberId);
          const officer = staff.find((row) => row.id === loan.officerId);
          const appraisal = appraisals.find((row) => row.loanId === loan.id);
          const termDays = Math.max(1, Math.floor(adjTermDays || loanTermDaysOf(loan)));
          const supplierBacked = loan.loanKind != null && loan.loanKind !== "financial";
          const storedProductChargeAmount = loanProductChargeAmount({
            loanKind: loan.loanKind,
            supplierPayload: loan.supplierPayload,
            processingFeeAmount: loan.processingFeeAmount,
          });
          const productChargeAmount = supplierBacked
            ? Math.max(0, Number(productDraft.productChargeAmount || storedProductChargeAmount))
            : 0;
          const pricing = loanPricingPreview({
            netAmount: adjAmount,
            termDays,
            ratePct: loan.rate,
            loanKind: loan.loanKind,
            productChargeAmount,
            processingFeeMode: loan.processingFeeMode,
            insuranceFeeMode: loan.insuranceFeeMode,
          });
          const application = extractApplicationPayload(loan.supplierPayload);
          return (
            <div
              className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4"
              onClick={() => setReviewing(null)}
            >
              <div
                className="bg-card rounded-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg font-semibold mb-1">Review {loan.id}</h3>
                    <p className="text-xs text-muted-foreground">
                      {member?.name} - {loan.loanKind ?? "financial"} application
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAll((current) => !current)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    {showAll ? "Show summary" : "View all"}
                  </button>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
                  <ReviewCell label="Member" value={member?.name ?? loan.memberId} />
                  <ReviewCell label="Officer" value={officer?.name ?? loan.officerId} />
                  <ReviewCell label="Amount applied" value={fmtKES(appliedAmount)} />
                  <ReviewCell label="Product charge" value={fmtKES(productChargeAmount)} />
                  <ReviewCell label="Term" value={`${termDays} days`} />
                  <ReviewCell
                    label="Daily repayment (daily installment)"
                    value={fmtKES(pricing.dailyInclusive)}
                  />
                  <ReviewCell label="Total repayable" value={fmtKES(pricing.totalRepayment)} />
                  <ReviewCell
                    label="Grand total collected"
                    value={fmtKES(pricing.grandTotalCollected)}
                  />
                  <ReviewCell
                    label="Round-off basket"
                    value={fmtKES(pricing.roundOff * pricing.termDays)}
                  />
                  <ReviewCell
                    label="Appraisal"
                    value={
                      appraisal
                        ? `Done - ${appraisal.totalScore}/100 - ${appraisal.decision}`
                        : "Pending appraisal"
                    }
                  />
                </div>

                {showAll ? (
                  <div className="mt-4 space-y-4">
                    <DetailBlock
                      title="Application details"
                      data={application ?? loan.supplierPayload}
                    />
                    <DetailBlock
                      title="Appraisal details"
                      data={appraisal ?? { status: "Pending appraisal" }}
                    />
                    <DetailBlock
                      title="Review computation"
                      data={{
                        approvedAmount: adjAmount,
                        dailyRepayment: pricing.dailyInclusive,
                        dailyInstallment: pricing.dailyInclusive,
                        totalRepayable: pricing.totalRepayment,
                        grandTotalCollected: pricing.grandTotalCollected,
                        roundOffBasket: pricing.roundOff * pricing.termDays,
                      }}
                    />
                  </div>
                ) : null}

                <label className="mt-4 block">
                  <span className="text-xs text-muted-foreground">Applied amount</span>
                  <input
                    type="number"
                    min={1}
                    value={appliedAmount}
                    onChange={(event) => {
                      const next = Math.max(1, Number(event.target.value) || 1);
                      setAppliedAmount(next);
                      setAdjAmount((current) => Math.min(current, next));
                    }}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs text-muted-foreground">
                    Approved amount (you may revise downward)
                  </span>
                  <input
                    type="number"
                    max={appliedAmount}
                    value={adjAmount}
                    onChange={(event) =>
                      setAdjAmount(Math.min(appliedAmount, Number(event.target.value)))
                    }
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs text-muted-foreground">Purpose / applied details</span>
                  <input
                    value={reviewPurpose}
                    onChange={(event) => setReviewPurpose(event.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                  />
                </label>
                <ReviewProductFields
                  loanKind={loan.loanKind ?? "financial"}
                  draft={productDraft}
                  onChange={(patch) => setProductDraft((current) => ({ ...current, ...patch }))}
                />
                <label className="mt-3 block">
                  <span className="text-xs text-muted-foreground">Approved repayment days</span>
                  <input
                    type="number"
                    min={1}
                    value={adjTermDays}
                    onChange={(event) =>
                      setAdjTermDays(Math.max(1, Math.floor(Number(event.target.value) || 1)))
                    }
                    className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
                  />
                  <div className="mt-1 text-xs text-muted-foreground">
                    Changing this recalculates the daily repayment, interest band, round-off, and
                    due date.
                  </div>
                </label>
                <label className="mt-3 block">
                  <span className="text-xs text-muted-foreground">Review note (optional)</span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <div className="mt-4 flex justify-between gap-2">
                  <button
                    onClick={async () => {
                      await rejectLoan(loan.id, currentUser.id, note);
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
                        if (!appraisal) {
                          toast.error("Complete the appraisal before director review.");
                          return;
                        }
                        if (adjAmount <= 0) {
                          toast.error("Approved amount must be above zero.");
                          return;
                        }
                        if (appliedAmount <= 0) {
                          toast.error("Applied amount must be above zero.");
                          return;
                        }
                        await saveLoanReview({
                          data: {
                            loanId: loan.id,
                            principal: appliedAmount,
                            approvedAmount: adjAmount,
                            termDays,
                            reviewedBy: currentUser.id,
                            purpose: reviewPurpose,
                            note,
                            supplierPayloadPatch: supplierPayloadPatchFromDraft(
                              productDraft,
                              loan.loanKind ?? "financial",
                            ),
                            applicationLoanPatch: {
                              purpose: reviewPurpose,
                              amountApplied: appliedAmount,
                              termDays,
                            },
                            applicationApplicantPatch:
                              loan.loanKind === "fuel"
                                ? { vehiclePlate: productDraft.vehiclePlate.trim() || undefined }
                                : {},
                          },
                        });
                        await reloadAppData();
                        toast.success("Loan review saved. It is now eligible for approval.");
                        setReviewing(null);
                      }}
                      className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Save review
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

function extractApplicationPayload(payload?: Record<string, unknown>) {
  const application = payload?.application;
  return application && typeof application === "object" ? application : undefined;
}

function productDraftFromLoan(loan?: Loan): ReviewProductDraft {
  const payload = (loan?.supplierPayload ?? {}) as Record<string, unknown>;
  return {
    vehiclePlate: String(payload.vehiclePlate ?? ""),
    fuelType: String(payload.fuelType ?? "Petrol"),
    litres: Number(payload.litres ?? 0),
    unitPrice: Number(payload.unitPrice ?? 0),
    productChargeAmount: loan
      ? loanProductChargeAmount({
          loanKind: loan.loanKind,
          supplierPayload: loan.supplierPayload,
          processingFeeAmount: loan.processingFeeAmount,
        })
      : 0,
    weekStarting: String(payload.weekStarting ?? ""),
    weekEnding: String(payload.weekEnding ?? ""),
    item: String(payload.item ?? ""),
    quantity: Number(payload.quantity ?? 0),
    serviceType: String(payload.serviceType ?? ""),
    notes: String(payload.notes ?? ""),
  };
}

function supplierPayloadPatchFromDraft(draft: ReviewProductDraft, loanKind: LoanKind) {
  if (loanKind === "fuel") {
    return {
      vehiclePlate: draft.vehiclePlate.trim(),
      fuelType: draft.fuelType.trim(),
      litres: Math.max(0, Number(draft.litres) || 0),
      unitPrice: Math.max(0, Number(draft.unitPrice) || 0),
      fuelCharge: Math.max(0, Number(draft.productChargeAmount) || 0),
      productChargeAmount: Math.max(0, Number(draft.productChargeAmount) || 0),
      weekStarting: draft.weekStarting || undefined,
      weekEnding: draft.weekEnding || undefined,
      notes: draft.notes.trim() || undefined,
    };
  }
  if (loanKind === "stock") {
    return {
      item: draft.item.trim(),
      quantity: Math.max(0, Number(draft.quantity) || 0),
      stockCharge: Math.max(0, Number(draft.productChargeAmount) || 0),
      productChargeAmount: Math.max(0, Number(draft.productChargeAmount) || 0),
      notes: draft.notes.trim() || undefined,
    };
  }
  if (loanKind === "service") {
    return {
      serviceType: draft.serviceType.trim(),
      notes: draft.notes.trim() || undefined,
    };
  }
  return {};
}

function ReviewProductFields({
  loanKind,
  draft,
  onChange,
}: {
  loanKind: LoanKind;
  draft: ReviewProductDraft;
  onChange: (patch: Partial<ReviewProductDraft>) => void;
}) {
  if (loanKind === "financial") return null;
  return (
    <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Applied product details
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {loanKind === "fuel" ? (
          <>
            <ReviewInput
              label="Vehicle plate"
              value={draft.vehiclePlate}
              onChange={(value) => onChange({ vehiclePlate: value.toUpperCase() })}
            />
            <ReviewInput
              label="Fuel type"
              value={draft.fuelType}
              onChange={(value) => onChange({ fuelType: value })}
            />
            <ReviewNumberInput
              label="Litres"
              value={draft.litres}
              onChange={(value) => onChange({ litres: value })}
            />
            <ReviewNumberInput
              label="Unit price"
              value={draft.unitPrice}
              onChange={(value) => onChange({ unitPrice: value })}
            />
            <ReviewNumberInput
              label="Fuel charge"
              value={draft.productChargeAmount}
              onChange={(value) => onChange({ productChargeAmount: value })}
            />
            <ReviewInput
              label="Week starting"
              type="date"
              value={draft.weekStarting}
              onChange={(value) => onChange({ weekStarting: value })}
            />
            <ReviewInput
              label="Week ending"
              type="date"
              value={draft.weekEnding}
              onChange={(value) => onChange({ weekEnding: value })}
            />
          </>
        ) : null}
        {loanKind === "stock" ? (
          <>
            <ReviewInput
              label="Stock item"
              value={draft.item}
              onChange={(value) => onChange({ item: value })}
            />
            <ReviewNumberInput
              label="Quantity"
              value={draft.quantity}
              onChange={(value) => onChange({ quantity: value })}
            />
            <ReviewNumberInput
              label="Stock charge"
              value={draft.productChargeAmount}
              onChange={(value) => onChange({ productChargeAmount: value })}
            />
          </>
        ) : null}
        {loanKind === "service" ? (
          <ReviewInput
            label="Service type"
            value={draft.serviceType}
            onChange={(value) => onChange({ serviceType: value })}
          />
        ) : null}
        <label className="block sm:col-span-2">
          <span className="text-xs text-muted-foreground">Supplier notes</span>
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(event) => onChange({ notes: event.target.value })}
            className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
          />
        </label>
      </div>
    </div>
  );
}

function ReviewInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
      />
    </label>
  );
}

function ReviewNumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
      />
    </label>
  );
}

function ReviewCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function DetailBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="max-h-64 overflow-auto text-xs">
        <FriendlyDetails data={data ?? {}} />
      </div>
    </div>
  );
}

function FriendlyDetails({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    if (data.length === 0) return <div className="text-muted-foreground">None</div>;
    return (
      <div className="space-y-2">
        {data.map((item, index) => (
          <div key={index} className="rounded border border-border/70 bg-card/60 p-2">
            <div className="mb-1 font-medium text-muted-foreground">Item {index + 1}</div>
            <FriendlyDetails data={item} />
          </div>
        ))}
      </div>
    );
  }
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <div className="text-muted-foreground">None</div>;
    return (
      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="grid gap-1 sm:grid-cols-[160px,1fr]">
            <div className="font-medium capitalize text-muted-foreground">
              {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
            </div>
            <div>
              {value && typeof value === "object" ? (
                <FriendlyDetails data={value} />
              ) : (
                String(value ?? "-")
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <div>{String(data ?? "-")}</div>;
}
