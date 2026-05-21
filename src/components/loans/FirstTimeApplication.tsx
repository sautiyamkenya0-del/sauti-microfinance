import { Section } from "@/components/ui-bits";
import {
  type BusinessPermanence,
  useStore,
  formatMembershipNumber,
  fmtKES,
  loanPricingPreview,
  loanProductTypeForAmount,
  nextMembershipNumber,
  normalizeMembershipNumber,
  normalizeLoanTermDaysForType,
  SBC_FEES,
  PREMIUM_LOAN_TERMS,
  STANDARD_LOAN_TERMS,
  termPeriodsFromDays,
  upfrontRequirementForAmount,
  type LoanChargeMode,
} from "@/lib/store";
import { feePolicyAppliesToMember } from "@/lib/fees-policy";
import { Input, Select, Row, inputCss } from "./atoms";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { isValidLocalKenyanPhone, toLocalKenyanPhone } from "@/lib/utils";

const blankContact = { name: "", phone: "", relationship: "", location: "" };
const blankGuarantor = { name: "", phone: "", membershipNo: "", guaranteedAmount: 0 };
const blankCollateral = { item: "", model: "", serial: "", estValue: 0, owner: "", remarks: "" };

export function FirstTimeApplication({
  memberId,
  onSubmitted,
}: {
  memberId?: string;
  onSubmitted?: (loanId: string) => void;
}) {
  const { members, currentUser, addLoan, addMember, feePolicies } = useStore();
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const nextMemberNo = useMemo(
    () =>
      nextMembershipNumber(
        members.map((member) => member.id),
        1,
      ),
    [members],
  );
  const existing = members.find((m) => m.id === memberId);
  const [f, setF] = useState(() => ({
    fullName: existing?.name ?? "",
    nickname: "",
    maritalStatus: "Single",
    idNo: "",
    phone: existing?.phone ?? "",
    membershipNo: existing ? formatMembershipNumber(existing.id) : nextMemberNo,
    gender: "Male",
    dob: "",
    businessType: "Mama Mboga",
    businessPermanence: (existing?.businessPermanence ?? "") as "" | BusinessPermanence,
    tradingName: "",
    businessLocation: "",
    county: "",
    subCounty: "",
    town: "",
    ward: "",
    referredBy: "",
    referrerMembershipNo: "",
    homeMarket: "",
    village: "",
    ownership: "Rented",
    plotName: "",
    houseNumber: "",
    road: "",
    locatedNextTo: "",
    kinName: "",
    kinPhone: "",
    kinRelationship: "",
    kinAddress: "",
    loanAmount: 5000,
    purpose: "Stock/Goods",
    repaymentPlan: "Daily" as "Daily" | "Weekly" | "Monthly",
    repaymentDays: 14,
    contacts: [{ ...blankContact }, { ...blankContact }, { ...blankContact }],
    guarantors: [{ ...blankGuarantor }, { ...blankGuarantor }, { ...blankGuarantor }],
    collateral: [{ ...blankCollateral }],
    collateralAddedToLoan: false,
    collateralPhotosAttached: false,
    dailySavingsPlan: "50" as "50" | "100",
    processingFeeMode: "financed" as LoanChargeMode,
    insuranceFeeMode: "financed" as LoanChargeMode,
    registrationFeeMode: "upfront" as LoanChargeMode,
    cardFeeMode: "upfront" as LoanChargeMode,
    stickerFeeMode: "upfront" as LoanChargeMode,
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const loanType = useMemo(() => loanProductTypeForAmount(f.loanAmount), [f.loanAmount]);
  const loanCategory = loanType === "premium" ? "Premium" : "Normal";
  const repaymentOptions = loanType === "premium" ? PREMIUM_LOAN_TERMS : STANDARD_LOAN_TERMS;

  useEffect(() => {
    if (existing) {
      setF((prev) => ({
        ...prev,
        fullName: existing.name,
        phone: existing.phone,
        membershipNo: formatMembershipNumber(existing.id),
        businessPermanence: existing.businessPermanence ?? prev.businessPermanence,
      }));
      return;
    }

    if (!memberId) {
      setF((prev) => ({
        ...prev,
        membershipNo: prev.membershipNo || nextMemberNo,
      }));
    }
  }, [existing, memberId, nextMemberNo]);

  const previewMemberId = useMemo(
    () => normalizeMembershipNumber(f.membershipNo) || existing?.id || nextMemberNo,
    [existing?.id, f.membershipNo, nextMemberNo],
  );
  const stickerApplicable = (existing?.businessPermanence ?? f.businessPermanence) === "permanent";
  const previewMember = useMemo(
    () => ({
      id: previewMemberId,
      joinedAt: existing?.joinedAt ?? todayIso,
      category: existing?.category ?? "member",
      isInvestor: existing?.isInvestor ?? false,
    }),
    [
      existing?.category,
      existing?.id,
      existing?.isInvestor,
      existing?.joinedAt,
      previewMemberId,
      todayIso,
    ],
  );
  const membershipPolicy = feePolicies.find((fee) => fee.key === "membership");
  const cardPolicy = feePolicies.find((fee) => fee.key === "card");
  const stickerPolicy = feePolicies.find((fee) => fee.key === "sticker");
  const membershipFeeDue =
    membershipPolicy &&
    feePolicyAppliesToMember(membershipPolicy, previewMember, { hasActiveLoan: false }) &&
    !existing?.fees.membership
      ? membershipPolicy.amount
      : 0;
  const cardFeeDue =
    cardPolicy &&
    feePolicyAppliesToMember(cardPolicy, previewMember, { hasActiveLoan: false }) &&
    !existing?.fees.card
      ? cardPolicy.amount
      : 0;
  const stickerFeeDue =
    stickerPolicy &&
    feePolicyAppliesToMember(stickerPolicy, previewMember, { hasActiveLoan: false }) &&
    stickerApplicable &&
    !existing?.fees.sticker
      ? stickerPolicy.amount
      : 0;

  const calc = useMemo(() => {
    const termDays = normalizeLoanTermDaysForType(f.repaymentDays, loanType);
    const pricing = loanPricingPreview({
      loanType,
      netAmount: f.loanAmount,
      termDays: f.repaymentDays,
      processingFeeMode: f.processingFeeMode,
      insuranceFeeMode: f.insuranceFeeMode,
      dailySavingsAmount: Number(f.dailySavingsPlan),
      fixedFees: {
        membershipFeeAmount: membershipFeeDue,
        membershipFeeMode: f.registrationFeeMode,
        cardFeeAmount: cardFeeDue,
        cardFeeMode: f.cardFeeMode,
        stickerFeeAmount: stickerFeeDue,
        stickerFeeMode: f.stickerFeeMode,
      },
    });
    const ded = pricing.deductions;
    const upfrontBase = upfrontRequirementForAmount(f.loanAmount);
    return {
      ratePct: pricing.ratePct,
      termDays,
      interest: pricing.interest,
      total: pricing.totalRepayment,
      ded,
      upfront: {
        range: upfrontBase.tier?.range ?? "",
        minShares: upfrontBase.sharesAmount,
        minSavings: upfrontBase.savingsAmount,
      },
      upfrontBase,
      fixedFeeRows: pricing.fixedFees.rows,
      fixedFeesUpfront: pricing.fixedFees.totalUpfront,
      fixedFeesFinanced: pricing.fixedFees.totalFinanced,
      totalUpfrontNow: upfrontBase.total + pricing.totalUpfrontCharges,
      netDisbursed: pricing.netDisbursedAmount,
      financedPrincipal: pricing.financedPrincipal,
      dailyPay: pricing.dailyLoanInstallment,
      totalUpfrontCharges: pricing.totalUpfrontCharges,
      totalFinancedCharges: pricing.totalFinancedCharges,
    };
  }, [
    cardFeeDue,
    f.cardFeeMode,
    f.loanAmount,
    f.insuranceFeeMode,
    f.processingFeeMode,
    f.repaymentDays,
    f.registrationFeeMode,
    f.dailySavingsPlan,
    f.stickerFeeMode,
    loanType,
    membershipFeeDue,
    stickerApplicable,
    stickerFeeDue,
  ]);

  const submit = async () => {
    if (!f.fullName || !f.phone || f.loanAmount <= 0)
      return toast.error("Complete name, phone and loan amount.");
    if (!isValidLocalKenyanPhone(f.phone)) {
      return toast.error("Use a local phone number starting with 07 or 01.");
    }
    const phone = toLocalKenyanPhone(f.phone);
    const normalizedMembershipNo = f.membershipNo
      ? normalizeMembershipNumber(f.membershipNo)
      : undefined;
    if (f.membershipNo && !normalizedMembershipNo) {
      return toast.error("Membership number must follow the SBC0001K format.");
    }
    const businessPermanence = existing?.businessPermanence ?? (f.businessPermanence || undefined);
    if (!businessPermanence) {
      return toast.error("Select whether the business is permanent or semi-permanent.");
    }
    let mid = members.find((x) => x.phone === phone)?.id;
    if (!mid)
      mid = await addMember({
        memberId: normalizedMembershipNo,
        name: f.fullName,
        phone,
        joinedAt: todayIso,
        status: "active",
        shares: 0,
        savingsBalance: 0,
        category: existing?.category ?? "member",
        businessType: f.businessType || undefined,
        businessPermanence,
        businessName: f.tradingName || undefined,
        businessAddress: f.businessLocation || undefined,
      });
    const loanId = await addLoan({
      memberId: mid,
      principal: f.loanAmount,
      rate: calc.ratePct,
      termDays: calc.termDays,
      termMonths: termPeriodsFromDays(calc.termDays, loanType),
      startDate: new Date().toISOString().slice(0, 10),
      officerId: currentUser.id,
      status: "pending",
      financedPrincipalAmount: calc.financedPrincipal,
      netDisbursedAmount: calc.netDisbursed,
      processingFeeAmount: calc.ded.processing,
      insuranceFeeAmount: calc.ded.insurance,
      transactionFeeAmount: calc.ded.transactionCost,
      processingFeeMode: f.processingFeeMode,
      insuranceFeeMode: f.insuranceFeeMode,
      disbursementStatus: "not_requested",
      purpose: f.purpose,
    });
    toast.success("Application submitted — awaiting appraisal & review.");
    onSubmitted?.(loanId);
  };

  return (
    <div className="space-y-6">
      <Section title="1. Applicant Details">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Input label="Full Name" value={f.fullName} onChange={(v) => set("fullName", v)} />
          <Input label="Nickname" value={f.nickname} onChange={(v) => set("nickname", v)} />
          <Select
            label="Marital Status"
            value={f.maritalStatus}
            onChange={(v) => set("maritalStatus", v)}
            options={["Single", "Married", "Divorced", "Widow", "Widower"]}
          />
          <Input label="ID / Passport No." value={f.idNo} onChange={(v) => set("idNo", v)} />
          <Input label="Phone Number" value={f.phone} onChange={(v) => set("phone", v)} />
          <Input
            label="SBC Membership No."
            value={f.membershipNo}
            onChange={(v) => set("membershipNo", v)}
          />
          <Select
            label="Gender"
            value={f.gender}
            onChange={(v) => set("gender", v)}
            options={["Male", "Female"]}
          />
          <Input type="date" label="Date of Birth" value={f.dob} onChange={(v) => set("dob", v)} />
          <Select
            label="Business Type"
            value={f.businessType}
            onChange={(v) => set("businessType", v)}
            options={[
              "Boda Boda",
              "TukTuk",
              "Taxi/Uber",
              "Matatu",
              "Mama Mboga",
              "Smokies/Chapati",
              "Shop/Kiosk",
              "Other",
            ]}
          />
          <label className="block">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
              Business Setup
            </span>
            <select
              value={f.businessPermanence}
              onChange={(event) =>
                set("businessPermanence", event.target.value as "" | BusinessPermanence)
              }
              className="loan-input mt-1"
            >
              <option value="">Select business setup</option>
              <option value="permanent">Permanent</option>
              <option value="semi">Semi-permanent</option>
            </select>
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Permanent businesses attract the sticker fee. Semi-permanent businesses do not.
            </span>
          </label>
          <Input
            label="Trading Name"
            value={f.tradingName}
            onChange={(v) => set("tradingName", v)}
          />
          <Input
            label="Business Location/Stage"
            value={f.businessLocation}
            onChange={(v) => set("businessLocation", v)}
          />
          <Input label="County" value={f.county} onChange={(v) => set("county", v)} />
          <Input label="Sub-County" value={f.subCounty} onChange={(v) => set("subCounty", v)} />
          <Input label="Town" value={f.town} onChange={(v) => set("town", v)} />
          <Input label="Ward" value={f.ward} onChange={(v) => set("ward", v)} />
          <Input label="Referred By" value={f.referredBy} onChange={(v) => set("referredBy", v)} />
          <Input
            label="Referrer SBC No."
            value={f.referrerMembershipNo}
            onChange={(v) => set("referrerMembershipNo", v)}
          />
        </div>
      </Section>

      <Section title="2. Home Location">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Input label="Town/Market" value={f.homeMarket} onChange={(v) => set("homeMarket", v)} />
          <Input label="Village/Estate" value={f.village} onChange={(v) => set("village", v)} />
          <Select
            label="Ownership"
            value={f.ownership}
            onChange={(v) => set("ownership", v)}
            options={["Rented", "Owned"]}
          />
          <Input label="Plot Name/Number" value={f.plotName} onChange={(v) => set("plotName", v)} />
          <Input
            label="House Number"
            value={f.houseNumber}
            onChange={(v) => set("houseNumber", v)}
          />
          <Input label="Road" value={f.road} onChange={(v) => set("road", v)} />
          <Input
            label="Located Next To"
            value={f.locatedNextTo}
            onChange={(v) => set("locatedNextTo", v)}
          />
        </div>
      </Section>

      <Section title="3. Next of Kin">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input label="Full Name" value={f.kinName} onChange={(v) => set("kinName", v)} />
          <Input label="Phone Number" value={f.kinPhone} onChange={(v) => set("kinPhone", v)} />
          <Input
            label="Relationship"
            value={f.kinRelationship}
            onChange={(v) => set("kinRelationship", v)}
          />
          <Input label="Address" value={f.kinAddress} onChange={(v) => set("kinAddress", v)} />
        </div>
      </Section>

      <Section title="4. Loan Details">
        <div className="p-5 grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Select
            label="Loan Category"
            value={loanCategory}
            disabled
            options={["Normal", "Premium"]}
          />
          <Input
            type="number"
            label="Amount Requested (KSh)"
            value={String(f.loanAmount)}
            onChange={(v) => set("loanAmount", Number(v))}
          />
          <Select
            label="Purpose"
            value={f.purpose}
            onChange={(v) => set("purpose", v)}
            options={["Fuel Credit", "Spare Parts", "Stock/Goods", "Emergencies", "Other"]}
          />
          <Select
            label="Repayment Plan"
            value={f.repaymentPlan}
            onChange={(v) => set("repaymentPlan", v as "Daily" | "Weekly" | "Monthly")}
            options={["Daily", "Weekly", "Monthly"]}
          />
          <Input
            type="number"
            label="Repayment Days"
            value={String(f.repaymentDays)}
            onChange={(v) => set("repaymentDays", Math.max(1, Number(v) || 0))}
          />
          <Select
            label="Repayment Term Band"
            value={String(calc.termDays)}
            onChange={(v) => set("repaymentDays", Number(v))}
            options={repaymentOptions.map((d) => String(d))}
          />
          <div className="md:col-span-2 lg:col-span-3 text-xs text-muted-foreground">
            Manual {f.repaymentDays} day entry uses the {calc.termDays}-day {loanType} interest band
            at {calc.ratePct}%.
          </div>
          <Select
            label="Daily Savings Plan"
            value={f.dailySavingsPlan}
            onChange={(v) => set("dailySavingsPlan", v as "50" | "100")}
            options={["50", "100"]}
          />
          <Select
            label="Processing Fee"
            value={f.processingFeeMode}
            onChange={(v) => set("processingFeeMode", v as LoanChargeMode)}
            options={["financed", "upfront"]}
          />
          <Select
            label="Insurance Fee"
            value={f.insuranceFeeMode}
            onChange={(v) => set("insuranceFeeMode", v as LoanChargeMode)}
            options={["financed", "upfront"]}
          />
          <Select
            label={`Registration Fee (${fmtKES(membershipFeeDue)})`}
            value={f.registrationFeeMode}
            onChange={(v) => set("registrationFeeMode", v as LoanChargeMode)}
            disabled={membershipFeeDue <= 0}
            options={["upfront", "financed"]}
          />
          <Select
            label={`Membership Card (${fmtKES(cardFeeDue)})`}
            value={f.cardFeeMode}
            onChange={(v) => set("cardFeeMode", v as LoanChargeMode)}
            disabled={cardFeeDue <= 0}
            options={["upfront", "financed"]}
          />
          <Select
            label={`Sticker Fee (${fmtKES(stickerFeeDue)})`}
            value={f.stickerFeeMode}
            onChange={(v) => set("stickerFeeMode", v as LoanChargeMode)}
            disabled={stickerFeeDue <= 0}
            options={["upfront", "financed"]}
          />
        </div>
      </Section>

      <Section title="5. Contact Persons (min. 2)">
        <div className="overflow-x-auto p-5">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr>
                <th className="text-left py-2">#</th>
                <th className="text-left">Name</th>
                <th className="text-left">Contact</th>
                <th className="text-left">Relationship</th>
                <th className="text-left">Location</th>
              </tr>
            </thead>
            <tbody>
              {f.contacts.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 pr-2">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.name}
                      onChange={(e) => {
                        const a = [...f.contacts];
                        a[i] = { ...c, name: e.target.value };
                        set("contacts", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.phone}
                      onChange={(e) => {
                        const a = [...f.contacts];
                        a[i] = { ...c, phone: e.target.value };
                        set("contacts", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.relationship}
                      onChange={(e) => {
                        const a = [...f.contacts];
                        a[i] = { ...c, relationship: e.target.value };
                        set("contacts", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.location}
                      onChange={(e) => {
                        const a = [...f.contacts];
                        a[i] = { ...c, location: e.target.value };
                        set("contacts", a);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="6. Guarantors (3 SBC members)">
        <div className="overflow-x-auto p-5">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr>
                <th className="text-left py-2">#</th>
                <th className="text-left">Name</th>
                <th className="text-left">Phone</th>
                <th className="text-left">SBC No.</th>
                <th className="text-right">Guaranteed (KSh)</th>
              </tr>
            </thead>
            <tbody>
              {f.guarantors.map((g, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 pr-2">{i + 1}</td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={g.name}
                      onChange={(e) => {
                        const a = [...f.guarantors];
                        a[i] = { ...g, name: e.target.value };
                        set("guarantors", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={g.phone}
                      onChange={(e) => {
                        const a = [...f.guarantors];
                        a[i] = { ...g, phone: e.target.value };
                        set("guarantors", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={g.membershipNo}
                      onChange={(e) => {
                        const a = [...f.guarantors];
                        a[i] = { ...g, membershipNo: e.target.value };
                        set("guarantors", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      className="loan-input text-right"
                      value={g.guaranteedAmount}
                      onChange={(e) => {
                        const a = [...f.guarantors];
                        a[i] = { ...g, guaranteedAmount: Number(e.target.value) };
                        set("guarantors", a);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="7. Collateral (if applicable)">
        <div className="overflow-x-auto p-5 space-y-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr>
                <th className="text-left py-2">Item</th>
                <th className="text-left">Model</th>
                <th className="text-left">Serial</th>
                <th className="text-right">Value (KSh)</th>
                <th className="text-left">Owner</th>
                <th className="text-left">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {f.collateral.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.item}
                      onChange={(e) => {
                        const a = [...f.collateral];
                        a[i] = { ...c, item: e.target.value };
                        set("collateral", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.model}
                      onChange={(e) => {
                        const a = [...f.collateral];
                        a[i] = { ...c, model: e.target.value };
                        set("collateral", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.serial}
                      onChange={(e) => {
                        const a = [...f.collateral];
                        a[i] = { ...c, serial: e.target.value };
                        set("collateral", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      className="loan-input text-right"
                      value={c.estValue}
                      onChange={(e) => {
                        const a = [...f.collateral];
                        a[i] = { ...c, estValue: Number(e.target.value) };
                        set("collateral", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.owner}
                      onChange={(e) => {
                        const a = [...f.collateral];
                        a[i] = { ...c, owner: e.target.value };
                        set("collateral", a);
                      }}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="loan-input"
                      value={c.remarks}
                      onChange={(e) => {
                        const a = [...f.collateral];
                        a[i] = { ...c, remarks: e.target.value };
                        set("collateral", a);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => set("collateral", [...f.collateral, { ...blankCollateral }])}
            className="text-xs text-primary hover:underline"
          >
            + Add collateral row
          </button>
        </div>
      </Section>

      <Section title="8. Disbursement Computation (Official Use)">
        <div className="p-5 grid md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Row label="Loan Amount Applied" value={fmtKES(f.loanAmount)} />
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
            <Row label="Fixed Fees Financed" value={fmtKES(calc.fixedFeesFinanced)} />
            <Row label="Total Financed Charges" value={fmtKES(calc.totalFinancedCharges)} bold />
          </div>
          <div className="space-y-2">
            <Row label="Net Disbursable" value={fmtKES(calc.netDisbursed)} bold />
            <Row label="Financed Principal" value={fmtKES(calc.financedPrincipal)} />
            <Row label="Total Repayable" value={fmtKES(calc.total)} bold />
            <Row label="Daily Repayment" value={fmtKES(calc.dailyPay)} />
            <Row label="Repayment Period" value={`${calc.termDays} days`} />
            {calc.totalUpfrontNow > 0 && (
              <div className="bg-muted/50 rounded-md p-3 text-xs">
                <div className="font-medium text-foreground">
                  {calc.upfrontBase.tier
                    ? `Upfront for ${calc.upfrontBase.tier.range}:`
                    : "First-time upfront:"}
                </div>
                {calc.upfrontBase.tier ? (
                  <div>
                    Min Shares: {fmtKES(calc.upfront.minShares)} · Min Savings:{" "}
                    {fmtKES(calc.upfront.minSavings)}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Tiered upfront base</span>
                  <span>{fmtKES(calc.upfrontBase.total)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Fixed fees due upfront</span>
                  <span>{fmtKES(calc.fixedFeesUpfront)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 font-medium text-foreground">
                  <span>Total upfront now</span>
                  <span>{fmtKES(calc.totalUpfrontNow)}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  Processing upfront {fmtKES(calc.ded.processingUpfront)} · Insurance upfront{" "}
                  {fmtKES(calc.ded.insuranceUpfront)}
                </div>
                <div className="mt-2 text-muted-foreground">
                  Sticker fee is only added when the business setup is marked permanent.
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <div className="flex justify-end">
        <button
          onClick={submit}
          className="bg-primary text-primary-foreground px-5 py-2.5 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          Submit Application → Appraisal
        </button>
      </div>
      <style>{inputCss}</style>
    </div>
  );
}
