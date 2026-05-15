import { Section } from "@/components/ui-bits";
import {
  useStore,
  fmtKES,
  loanRateForTerm,
  loanScheduleTotal,
  normalizeLoanTermDays,
  sbcDeductions,
  SBC_FEES,
  SBC_LOAN_TERMS,
  SBC_UPFRONT_TABLE,
  termPeriodsFromDays,
} from "@/lib/store";
import { Input, Select, Row, inputCss } from "./atoms";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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
  const { members, currentUser, addLoan, addMember } = useStore();
  const existing = members.find((m) => m.id === memberId);
  const [f, setF] = useState({
    fullName: existing?.name ?? "",
    nickname: "",
    maritalStatus: "Single",
    idNo: "",
    phone: existing?.phone ?? "",
    membershipNo: existing?.id ?? "",
    gender: "Male",
    dob: "",
    businessType: "Mama Mboga",
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
    loanCategory: "Normal" as "Normal" | "Premium",
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
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const calc = useMemo(() => {
    const termDays = normalizeLoanTermDays(f.repaymentDays);
    const ratePct = loanRateForTerm(termDays);
    const { interest, total } = loanScheduleTotal(
      f.loanAmount,
      ratePct,
      termPeriodsFromDays(termDays),
    );
    const ded = sbcDeductions(f.loanAmount);
    const upfront = SBC_UPFRONT_TABLE.find((u) => f.loanAmount >= u.min && f.loanAmount <= u.max);
    return {
      ratePct,
      termDays,
      interest,
      total,
      ded,
      upfront,
      netDisbursed: f.loanAmount - ded.total,
      dailyPay: total / termDays,
    };
  }, [f.loanAmount, f.loanCategory, f.repaymentDays]);

  const submit = () => {
    if (!f.fullName || !f.phone || f.loanAmount <= 0)
      return toast.error("Complete name, phone and loan amount.");
    let mid = members.find((x) => x.phone === f.phone)?.id;
    if (!mid)
      mid = addMember({
        name: f.fullName,
        phone: f.phone,
        joinedAt: new Date().toISOString().slice(0, 10),
        status: "active",
        shares: 0,
        savingsBalance: 0,
      });
    const loanId = addLoan({
      memberId: mid,
      principal: f.loanAmount,
      rate: calc.ratePct,
      termDays: calc.termDays,
      termMonths: termPeriodsFromDays(calc.termDays),
      startDate: new Date().toISOString().slice(0, 10),
      officerId: currentUser.id,
      status: "pending",
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
            value={f.loanCategory}
            onChange={(v) => set("loanCategory", v as any)}
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
            onChange={(v) => set("repaymentPlan", v as any)}
            options={["Daily", "Weekly", "Monthly"]}
          />
          <Select
            label="Repayment Period (days)"
            value={String(calc.termDays)}
            onChange={(v) => set("repaymentDays", Number(v))}
            options={SBC_LOAN_TERMS.map((d) => String(d))}
          />
          <Select
            label="Daily Savings Plan"
            value={f.dailySavingsPlan}
            onChange={(v) => set("dailySavingsPlan", v as any)}
            options={["50", "100"]}
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
            <Row label={`Interest (${calc.ratePct}%)`} value={fmtKES(calc.interest)} />
            <Row
              label={`Processing (${SBC_FEES.processingPct}%)`}
              value={fmtKES(calc.ded.processing)}
            />
            <Row
              label={`Insurance (${SBC_FEES.insurancePct}%)`}
              value={fmtKES(calc.ded.insurance)}
            />
            <Row label="Total Deductions" value={fmtKES(calc.ded.total)} bold />
          </div>
          <div className="space-y-2">
            <Row label="Net Disbursable" value={fmtKES(calc.netDisbursed)} bold />
            <Row label="Total Repayable" value={fmtKES(calc.total)} bold />
            <Row label="Daily Repayment" value={fmtKES(calc.dailyPay)} />
            <Row label="Repayment Period" value={`${calc.termDays} days`} />
            {calc.upfront && (
              <div className="bg-muted/50 rounded-md p-3 text-xs">
                <div className="font-medium text-foreground">Upfront for {calc.upfront.range}:</div>
                <div>
                  Min Shares: {fmtKES(calc.upfront.minShares)} · Min Savings:{" "}
                  {fmtKES(calc.upfront.minSavings)}
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
