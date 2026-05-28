import { createFileRoute } from "@tanstack/react-router";

import logo from "@/assets/sauti-logo.png";
import { AppHeader } from "@/components/AppHeader";
import { PaymentFlowTree } from "@/components/PaymentFlowTree";
import { SectionTabs } from "@/components/SectionTabs";
import { Section } from "@/components/ui-bits";
import { SBC_FEES, SBC_UPFRONT_TABLE, fmtKES, useStore } from "@/lib/store";

const PURPOSE_POOL_DISTRIBUTION = [
  ["Levies & Permits Fund", "40%", "Enables members to pay business permits flexibly."],
  ["Welfare Fund", "15%", "Emergencies such as accidents, sickness, and funerals."],
  ["Legal Fund", "20%", "Legal aid and representation."],
  ["Operations/Admin", "25%", "Running SBC, staff, IT systems, and growth."],
] as const;

export const Route = createFileRoute("/policies")({
  head: () => ({ meta: [{ title: "SBC Policies - Sauti Microfinance" }] }),
  component: Policies,
});

function Policies() {
  const { feePolicies, policySettings } = useStore();
  const membershipAmount = feePolicies.find((fee) => fee.key === "membership")?.amount ?? 500;
  const cardAmount = feePolicies.find((fee) => fee.key === "card")?.amount ?? 500;
  const stickerAmount = feePolicies.find((fee) => fee.key === "sticker")?.amount ?? 500;
  const mandatorySavingsThreshold = policySettings.percentages.mandatorySavingsThreshold;
  const mandatorySharesThreshold = policySettings.percentages.mandatorySharesThreshold;

  return (
    <>
      <AppHeader
        title="SBC Policies & Terms"
        subtitle="Sauti Business Community operational rulebook."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="admin" />

        <div className="flex items-center gap-5 rounded-xl border border-border bg-card p-6">
          <img
            src={logo}
            alt="SBC"
            className="h-20 w-20 rounded-full bg-white p-1 ring-1 ring-border"
          />
          <div>
            <h2 className="font-display text-xl font-semibold">Sauti Business Community (SBC)</h2>
            <p className="text-sm italic text-muted-foreground">
              "Amplifying the Voice of Business Community"
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Members with {fmtKES(mandatorySharesThreshold)} in shares and{" "}
              {fmtKES(mandatorySavingsThreshold)} in daily compliance contribution qualify for
              premium loans and annual dividends.
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="A. Membership & Compliance Contribution">
            <ul className="list-disc space-y-2 p-5 pl-9 text-sm text-muted-foreground">
              <li>All borrowers must be active SBC members.</li>
              <li>
                Daily compliance contribution ({fmtKES(mandatorySavingsThreshold)} min) acts as
                security and is not withdrawable during active membership. Shares are not
                withdrawable but transferable.
              </li>
              <li>
                Non-withdrawable or loan savings can only be accessed after{" "}
                <span className="font-medium text-foreground">6-month written notice</span> and the
                member must not have an active loan or guarantorship obligation.
              </li>
              <li>Voluntary savings may be withdrawn at will less any administrative charges.</li>
              <li>Daily compliance contributions must continue through the full loan cycle.</li>
              <li>
                Savings are not used to offset a loan unless management approves the exception.
              </li>
            </ul>
          </Section>

          <Section title="B. Loan Terms">
            <ul className="list-disc space-y-2 p-5 pl-9 text-sm text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">Normal Loans:</span> KSh 1,000-5,000
                (7-30 days, {policySettings.interestRates.standard[7]}%-
                {policySettings.interestRates.standard[30]}% interest).
              </li>
              <li>
                <span className="font-medium text-foreground">Premium Loans:</span> KSh 5,000 and
                above (14-90 days, {policySettings.interestRates.premium[14]}%-
                {policySettings.interestRates.premium[90]}% interest).
              </li>
              <li>
                Processing fee {SBC_FEES.processingPct}%, insurance {SBC_FEES.insurancePct}%, and
                fixed transaction fees from the Policy Center band table.
              </li>
              <li>
                {SBC_FEES.penaltyDailyPct}% penalty on daily arrears if not cleared by the second
                day, unless a justified reason is communicated and the arrears are settled the next
                day.
              </li>
              <li>
                Compounded default penalty of {SBC_FEES.defaultPenaltyPct}% daily after the due
                date.
              </li>
              <li>Collateral joint registration fee is separate and may be added or deducted.</li>
              <li>
                Membership fee {fmtKES(membershipAmount)}, membership card {fmtKES(cardAmount)}, and
                sticker fee {fmtKES(stickerAmount)} where applicable.
              </li>
              <li>
                First-time total upfront now means tiered upfront plus membership fee, card fee, and
                sticker fee where the business is permanent.
              </li>
            </ul>
          </Section>

          <Section title="C. Dividends & Multipliers">
            <ul className="list-disc space-y-2 p-5 pl-9 text-sm text-muted-foreground">
              <li>
                Members with full share and daily compliance contribution thresholds (
                {fmtKES(mandatorySharesThreshold)} shares value and{" "}
                {fmtKES(mandatorySavingsThreshold)} contribution) and without default earn annual
                dividends.
              </li>
              <li>Good repayment history grows savings and access multipliers.</li>
              <li>Default reduces eligibility for the next loan cycle.</li>
            </ul>
          </Section>

          <Section title="D. Default & Recovery">
            <ul className="list-disc space-y-2 p-5 pl-9 text-sm text-muted-foreground">
              <li>Default penalty applies after the final due date as listed above.</li>
              <li>Guarantors and collateral may be invoked after written notice.</li>
              <li>
                Final recourse: management may apply restricted savings against outstanding
                obligations.
              </li>
            </ul>
          </Section>
        </div>

        <Section title="E. Payment Allocation Rules">
          <div className="p-5 space-y-4">
            <PaymentFlowTree
              membershipFeeAmount={membershipAmount}
              cardFeeAmount={cardAmount}
              stickerFeeAmount={stickerAmount}
              mandatorySavingsThreshold={mandatorySavingsThreshold}
              mandatorySharesThreshold={mandatorySharesThreshold}
            />
            <div className="rounded-xl border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              Active-loan receipts first clear mandatory fees and premium upfront where applicable.
              The selected KSh 50 or KSh 100 daily compliance contribution fills compliance and
              shares at a 60/40 split; once both thresholds are full, excess contributions split 80%
              to purpose pool and 20% to loan savings / multiplier savings. The remaining amount
              reduces the active loan balance.
            </div>
          </div>
        </Section>

        <Section title="Purpose Pool Distribution">
          <div className="p-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              After a member is compliant, 80% of excess contribution money routes into these
              internal funds. The other 20% remains as loan savings / multiplier savings for the
              member.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left">Allocation</th>
                    <th className="px-5 py-3 text-right">% of Pool</th>
                    <th className="px-5 py-3 text-left">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {PURPOSE_POOL_DISTRIBUTION.map(([allocation, pct, purpose]) => (
                    <tr key={allocation}>
                      <td className="px-5 py-3 font-medium">{allocation}</td>
                      <td className="px-5 py-3 text-right">{pct}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section title="Premium Loan Upfront Heads (Shares + Compliance thresholds)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Loan Amount (KSh)</th>
                  <th className="px-5 py-3 text-right">Min Shares (KSh)</th>
                  <th className="px-5 py-3 text-right">Shares %</th>
                  <th className="px-5 py-3 text-right">Min Compliance (KSh)</th>
                  <th className="px-5 py-3 text-right">Compliance %</th>
                  <th className="px-5 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SBC_UPFRONT_TABLE.map((row) => (
                  <tr key={row.range}>
                    <td className="px-5 py-3 font-medium">{row.range}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(row.minShares)}</td>
                    <td className="px-5 py-3 text-right">{row.sharesPct}%</td>
                    <td className="px-5 py-3 text-right">{fmtKES(row.minSavings)}</td>
                    <td className="px-5 py-3 text-right">{row.savingsPct}%</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Remaining balances can be completed through directed compliance top-ups (3:2 ratio).
          </p>
        </Section>
      </main>
    </>
  );
}
