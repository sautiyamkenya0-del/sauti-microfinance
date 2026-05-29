import { Section } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  loanPricingPreview,
  loanProductTypeForAmount,
  SBC_FEES,
  PREMIUM_LOAN_TERMS,
  STANDARD_LOAN_TERMS,
  termPeriodsFromDays,
  type LoanChargeMode,
  type LoanKind,
} from "@/lib/store";
import { Input, Select, Snap, Row, inputCss } from "./atoms";
import {
  FuelJobCardFields,
  blankFuelJobCardRows,
  resizeFuelJobCardRows,
  summarizeFuelJobCardRows,
} from "./FuelJobCardFields";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ReconfirmRow = [label: string, checked: boolean, onChange: (value: boolean) => void];

export function RepeatApplication({
  memberId,
  initialLoanKind = "financial",
  onSubmitted,
}: {
  memberId: string;
  initialLoanKind?: LoanKind;
  onSubmitted?: (loanId: string, memberId: string) => void;
}) {
  const { members, loans, currentUser, addLoan } = useStore();
  const member = members.find((m) => m.id === memberId);
  const memberLoans = loans.filter((l) => l.memberId === memberId);
  const lastLoan = memberLoans[memberLoans.length - 1];
  const repaymentScore =
    memberLoans.length === 0
      ? 0
      : memberLoans.reduce(
          (s, l) => s + (l.status === "closed" ? 1 : l.status === "defaulted" ? -1 : 0.5),
          0,
        ) / memberLoans.length;

  const [loanCategory, setLoanCategory] = useState<"Normal" | "Premium">("Premium");
  const [loanKind, setLoanKind] = useState<LoanKind>(initialLoanKind);
  const [loanAmount, setLoanAmount] = useState(10000);
  const [overrideRatePct, setOverrideRatePct] = useState(0);
  const [purpose, setPurpose] = useState("Stock/Goods");
  const [vehiclePlate, setVehiclePlate] = useState(member?.vehiclePlate ?? "");
  const [fuelType, setFuelType] = useState("Petrol");
  const [fuelLitres, setFuelLitres] = useState(0);
  const [fuelUnitPrice, setFuelUnitPrice] = useState(0);
  const [fuelCharge, setFuelCharge] = useState(0);
  const [fuelEntryCount, setFuelEntryCount] = useState(1);
  const [fuelJobCardRows, setFuelJobCardRows] = useState(() => blankFuelJobCardRows(1));
  const [stockItem, setStockItem] = useState("");
  const [stockQuantity, setStockQuantity] = useState(0);
  const [stockUnitPrice, setStockUnitPrice] = useState(0);
  const [stockCharge, setStockCharge] = useState(0);
  const [serviceType, setServiceType] = useState("");
  const [supplierNotes, setSupplierNotes] = useState("");
  const [repaymentPlan, setRepaymentPlan] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const [repaymentDays, setRepaymentDays] = useState(30);
  const [compliancePlan, setCompliancePlan] = useState<"50" | "100">("100");
  const [processingFeeMode, setProcessingFeeMode] = useState<LoanChargeMode>("financed");
  const [insuranceFeeMode, setInsuranceFeeMode] = useState<LoanChargeMode>("financed");
  const [confirmKYC, setConfirmKYC] = useState(false);
  const [confirmKin, setConfirmKin] = useState(false);
  const [confirmGuar, setConfirmGuar] = useState(false);
  const [confirmBiz, setConfirmBiz] = useState(false);
  const [changesSinceLast, setChangesSinceLast] = useState("");
  const fuelJobCardSummary = useMemo(
    () => summarizeFuelJobCardRows(fuelJobCardRows),
    [fuelJobCardRows],
  );
  const fuelChargeTotal = fuelJobCardSummary.totalFuelCharge || fuelCharge;
  const fuelFallbackTotal = fuelLitres * fuelUnitPrice;
  const resolvedVehiclePlate = member?.vehiclePlate || vehiclePlate.trim().toUpperCase();
  const stockComputedTotal = stockQuantity * stockUnitPrice;
  const requestedLoanAmount =
    loanKind === "fuel"
      ? fuelJobCardSummary.totalCost
      : loanKind === "stock"
        ? stockComputedTotal || loanAmount
        : loanAmount;
  const loanType = loanCategory === "Premium" ? "premium" : "standard";
  const repaymentOptions = loanType === "premium" ? PREMIUM_LOAN_TERMS : STANDARD_LOAN_TERMS;
  const loanKindOptions = useMemo<LoanKind[]>(() => ["financial", "fuel", "stock", "service"], []);

  useEffect(() => {
    if (loanKindOptions.includes(initialLoanKind)) {
      setLoanKind(initialLoanKind);
      return;
    }
    if (!loanKindOptions.includes(loanKind)) setLoanKind("financial");
  }, [initialLoanKind, loanKind, loanKindOptions]);

  const calc = useMemo(() => {
    const productChargeAmount =
      loanKind === "fuel" ? fuelChargeTotal : loanKind === "stock" ? stockCharge : 0;
    const pricing = loanPricingPreview({
      loanType,
      loanKind,
      netAmount: requestedLoanAmount,
      termDays: loanKind === "fuel" ? 1 : repaymentDays,
      ratePct: overrideRatePct > 0 ? overrideRatePct : undefined,
      productChargeAmount,
      processingFeeMode,
      insuranceFeeMode,
      dailySavingsAmount: Number(compliancePlan),
    });
    const ded = pricing.deductions;
    return {
      ratePct: pricing.ratePct,
      termDays: pricing.termDays,
      interest: pricing.interest,
      total: pricing.totalRepayment,
      ded,
      net: pricing.netDisbursedAmount,
      financedPrincipal: pricing.financedPrincipal,
      daily: pricing.dailyInclusive,
      grandTotalCollected: pricing.grandTotalCollected,
      roundOffBasket: pricing.roundOff * pricing.termDays,
    };
  }, [
    insuranceFeeMode,
    loanKind,
    fuelChargeTotal,
    fuelFallbackTotal,
    fuelJobCardSummary.totalCost,
    requestedLoanAmount,
    stockCharge,
    stockComputedTotal,
    loanType,
    overrideRatePct,
    processingFeeMode,
    repaymentDays,
    compliancePlan,
  ]);

  if (!member) return <div className="text-sm text-muted-foreground">Select a member first.</div>;

  const submit = async () => {
    if (!confirmKYC || !confirmKin || !confirmGuar || !confirmBiz)
      return toast.error("Confirm all KYC details first.");
    if (loanKind === "fuel" && !resolvedVehiclePlate) {
      return toast.error(
        "Add the locomotive vehicle plate on the member profile before repeat fuel.",
      );
    }
    if (loanKind === "fuel" && requestedLoanAmount <= 0) {
      return toast.error("Enter at least one fuel refill entry.");
    }
    try {
      const applicationPayload = {
        reconfirmed: { confirmKYC, confirmKin, confirmGuar, confirmBiz, changesSinceLast },
        loan: {
          loanKind,
          purpose,
          amountApplied: requestedLoanAmount,
          termDays: calc.termDays,
          dailyRepayment: calc.daily,
          dailyInstallment: calc.daily,
          grandTotalCollected: calc.grandTotalCollected,
          roundOffBasket: calc.roundOffBasket,
        },
      };
      const supplierPayload =
        loanKind === "fuel"
          ? {
              vehiclePlate: resolvedVehiclePlate,
              fuelType,
              litres: fuelLitres,
              unitPrice: fuelUnitPrice,
              fuelCharge: fuelChargeTotal,
              productChargeAmount: fuelChargeTotal,
              jobCard: {
                rows: fuelJobCardRows,
                totals: fuelJobCardSummary,
              },
              estimatedTotal: requestedLoanAmount,
              notes: supplierNotes,
              application: applicationPayload,
            }
          : loanKind === "stock"
            ? {
                item: stockItem || purpose,
                quantity: stockQuantity,
                unitPrice: stockUnitPrice,
                stockCharge,
                productChargeAmount: stockCharge,
                estimatedTotal: requestedLoanAmount,
                notes: supplierNotes,
                application: applicationPayload,
              }
            : loanKind === "service"
              ? {
                  serviceType: serviceType || purpose,
                  notes: supplierNotes,
                  application: applicationPayload,
                }
              : { application: applicationPayload };
      const loanId = await addLoan({
        memberId: member.id,
        principal: requestedLoanAmount,
        rate: calc.ratePct,
        termDays: calc.termDays,
        termMonths: termPeriodsFromDays(calc.termDays, loanType),
        startDate: new Date().toISOString().slice(0, 10),
        officerId: currentUser.id,
        status: "pending",
        financedPrincipalAmount: calc.financedPrincipal,
        netDisbursedAmount: calc.net,
        processingFeeAmount: calc.ded.processing,
        insuranceFeeAmount: calc.ded.insurance,
        transactionFeeAmount: calc.ded.transactionCost,
        processingFeeMode,
        insuranceFeeMode,
        disbursementStatus: "not_requested",
        purpose,
        loanKind,
        supplierPayload,
      });
      toast.success("Repeat application submitted for review.");
      onSubmitted?.(loanId, member.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save repeat application.");
    }
  };

  return (
    <div className="space-y-6">
      <Section title="Member Snapshot (auto-loaded)">
        <div className="p-5 grid md:grid-cols-4 gap-4 text-sm">
          <Snap label="Member ID" v={member.id} />
          <Snap label="Full Name" v={member.name} />
          <Snap label="Phone" v={member.phone} />
          <Snap label="Joined" v={member.joinedAt} />
          <Snap label="Savings" v={fmtKES(member.savingsBalance)} />
          <Snap label="Shares" v={`${member.shares} units`} />
          <Snap label="Previous Loans" v={String(memberLoans.length)} />
          <Snap label="Repayment Track" v={`${(repaymentScore * 100).toFixed(0)}%`} />
          {lastLoan && (
            <Snap label="Last Loan" v={`${fmtKES(lastLoan.principal)} · ${lastLoan.status}`} />
          )}
        </div>
      </Section>

      <Section title="KYC Re-confirmation">
        <div className="p-5 space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Per SBC policy, repeat applications only re-confirm previously captured data.
          </p>
          {(
            [
              ["KYC details on file are still accurate", confirmKYC, setConfirmKYC],
              ["Next of Kin contact is still accurate", confirmKin, setConfirmKin],
              ["Guarantors are still willing & active SBC members", confirmGuar, setConfirmGuar],
              ["Business type & location are unchanged", confirmBiz, setConfirmBiz],
            ] as ReconfirmRow[]
          ).map(([label, v, on]) => (
            <label key={label} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={v}
                onChange={(e) => on(e.target.checked)}
                className="mt-0.5"
              />
              <span>{label}</span>
            </label>
          ))}
          <label className="block pt-2">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Any changes since last loan? (optional)
            </span>
            <textarea
              rows={3}
              className="loan-input mt-1"
              value={changesSinceLast}
              onChange={(e) => setChangesSinceLast(e.target.value)}
            />
          </label>
        </div>
      </Section>

      <Section title="New Loan Details">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Select
            label="Loan Category"
            value={loanCategory}
            onChange={(v) => setLoanCategory(v as "Normal" | "Premium")}
            options={["Normal", "Premium"]}
          />
          <Select
            label="Loan Type"
            value={loanKindOptions.includes(loanKind) ? loanKind : "financial"}
            onChange={(v) => {
              const next = v as LoanKind;
              setLoanKind(next);
              if (next === "fuel") {
                setPurpose("Fuel Credit");
                setRepaymentDays(1);
              }
              if (next === "stock") setPurpose("Stock/Goods");
              if (next === "service") setPurpose("Other");
            }}
            options={loanKindOptions}
          />
          {loanKind !== "fuel" ? (
            <>
              <Input
                type="number"
                label="Amount Requested (KSh)"
                value={String(loanAmount)}
                onChange={(v) => {
                  const nextAmount = Number(v);
                  setLoanAmount(nextAmount);
                  setLoanCategory(
                    loanProductTypeForAmount(nextAmount) === "premium" ? "Premium" : "Normal",
                  );
                }}
              />
              <Input
                type="number"
                label="Override Interest %"
                value={String(overrideRatePct)}
                onChange={(v) => setOverrideRatePct(Math.max(0, Number(v)))}
              />
              <Select
                label="Purpose"
                value={purpose}
                onChange={setPurpose}
                options={["Fuel Credit", "Spare Parts", "Stock/Goods", "Emergencies", "Other"]}
              />
            </>
          ) : null}
          {loanKind === "fuel" && (
            <>
              {member.vehiclePlate ? (
                <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Vehicle / Plate
                  </div>
                  <div className="mt-1 font-mono font-semibold">{member.vehiclePlate}</div>
                </div>
              ) : (
                <Input
                  label="Vehicle / Plate"
                  value={vehiclePlate}
                  onChange={(value) => setVehiclePlate(value.toUpperCase())}
                />
              )}
              <Input
                type="number"
                label="Fuel Entries"
                value={String(fuelEntryCount)}
                onChange={(value) => {
                  const count = Math.max(1, Math.floor(Number(value) || 1));
                  setFuelEntryCount(count);
                  setFuelJobCardRows((current) => resizeFuelJobCardRows(current, count));
                }}
              />
              <FuelJobCardFields rows={fuelJobCardRows} onChange={setFuelJobCardRows} />
            </>
          )}
          {loanKind === "stock" && (
            <>
              <Input label="Stock Item" value={stockItem} onChange={setStockItem} />
              <Input
                type="number"
                label="Quantity"
                value={String(stockQuantity)}
                onChange={(v) => setStockQuantity(Number(v))}
              />
              <Input
                type="number"
                label="Unit Price"
                value={String(stockUnitPrice)}
                onChange={(v) => setStockUnitPrice(Number(v))}
              />
              <Input
                type="number"
                label="Stock Charge"
                value={String(stockCharge)}
                onChange={(v) => setStockCharge(Number(v))}
              />
            </>
          )}
          {loanKind === "service" && (
            <Input label="Service Type" value={serviceType} onChange={setServiceType} />
          )}
          {loanKind !== "financial" && loanKind !== "fuel" && (
            <label className="block md:col-span-2 lg:col-span-3">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Supplier Notes
              </span>
              <textarea
                rows={2}
                className="loan-input mt-1"
                value={supplierNotes}
                onChange={(event) => setSupplierNotes(event.target.value)}
              />
            </label>
          )}
          {loanKind !== "fuel" ? (
            <>
              <Select
                label="Repayment Plan"
                value={repaymentPlan}
                onChange={(v) => setRepaymentPlan(v as "Daily" | "Weekly" | "Monthly")}
                options={["Daily", "Weekly", "Monthly"]}
              />
              <Input
                type="number"
                label="Repayment Days"
                value={String(repaymentDays)}
                onChange={(v) => setRepaymentDays(Math.max(1, Number(v) || 0))}
              />
              <Select
                label="Quick Term Picker"
                value={String(calc.termDays)}
                onChange={(v) => setRepaymentDays(Number(v))}
                options={repaymentOptions.map((d) => String(d))}
              />
              <div className="md:col-span-2 lg:col-span-3 text-xs text-muted-foreground">
                Interest is {calc.ratePct}% of net disbursed for this {loanType} loan. Changing
                days only changes the daily repayment.
              </div>
              <Select
                label="Daily Compliance Contribution Plan"
                value={compliancePlan}
                onChange={(v) => setCompliancePlan(v as "50" | "100")}
                options={["50", "100"]}
              />
              <Select
                label="Processing Fee"
                value={processingFeeMode}
                onChange={(v) => setProcessingFeeMode(v as LoanChargeMode)}
                options={["financed", "upfront"]}
              />
              <Select
                label="Insurance Fee"
                value={insuranceFeeMode}
                onChange={(v) => setInsuranceFeeMode(v as LoanChargeMode)}
                options={["financed", "upfront"]}
              />
            </>
          ) : null}
        </div>
      </Section>

      <Section title="Disbursement Computation">
        {loanKind === "fuel" ? (
          <div className="p-5 grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Row label="Fuel Total" value={fmtKES(requestedLoanAmount)} />
              <Row label="Fuel Charge" value={fmtKES(fuelChargeTotal)} />
              <Row label="Liters" value={`${fuelJobCardSummary.totalLiters.toFixed(2)} L`} />
            </div>
            <div className="space-y-2">
              <Row label="Total Due" value={fmtKES(calc.total)} bold />
              <Row label="Entries" value={String(fuelJobCardRows.length)} />
              <Row label="Repayment Period" value="24 hours" />
            </div>
          </div>
        ) : (
          <div className="p-5 grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Row label="Loan Amount" value={fmtKES(requestedLoanAmount)} />
              <Row label="Interest" value={fmtKES(calc.interest)} />
              <Row
                label={`Processing (${SBC_FEES.processingPct}%)`}
                value={fmtKES(calc.ded.processing)}
              />
              <Row
                label={`Insurance (${SBC_FEES.insurancePct}%)`}
                value={fmtKES(calc.ded.insurance)}
              />
              <Row label="Fixed Transaction Fee" value={fmtKES(calc.ded.transactionCost)} />
              <Row label="Total Deductions" value={fmtKES(calc.ded.total)} bold />
            </div>
            <div className="space-y-2">
              <Row label="Net Disbursable" value={fmtKES(calc.net)} bold />
              <Row label="Financed Principal" value={fmtKES(calc.financedPrincipal)} />
              <Row label="Total Repayable" value={fmtKES(calc.total)} bold />
              <Row label="Daily repayment (daily installment)" value={fmtKES(calc.daily)} />
              <Row label="Grand Total Collected" value={fmtKES(calc.grandTotalCollected)} />
              <Row label="Round-off Basket" value={fmtKES(calc.roundOffBasket)} />
              <Row label="Period" value={`${calc.termDays} days`} />
            </div>
          </div>
        )}
      </Section>

      <div className="flex justify-end">
        <button
          onClick={submit}
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Submit Repeat Application
        </button>
      </div>
      <style>{inputCss}</style>
    </div>
  );
}
