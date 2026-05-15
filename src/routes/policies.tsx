import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section } from "@/components/ui-bits";
import { SBC_FEES, SBC_UPFRONT_TABLE, fmtKES } from "@/lib/store";
import logo from "@/assets/sauti-logo.png";

export const Route = createFileRoute("/policies")({
  head: () => ({ meta: [{ title: "SBC Policies — Sauti Microfinance" }] }),
  component: Policies,
});

function Policies() {
  return (
    <>
      <AppHeader
        title="SBC Policies & Terms"
        subtitle="Sauti Business Community — operational rulebook."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="admin" />

        <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-5">
          <img
            src={logo}
            alt="SBC"
            className="h-20 w-20 rounded-full bg-white p-1 ring-1 ring-border"
          />
          <div>
            <h2 className="font-display text-xl font-semibold">Sauti Business Community (SBC)</h2>
            <p className="text-sm text-muted-foreground italic">
              "Amplifying the Voice of Business Community"
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Members with KSh 3,000 in shares and KSh 5,000 in mandatory savings qualify for
              premium loans and annual dividends.
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Section title="A. Membership & Savings">
            <ul className="p-5 list-disc pl-9 space-y-2 text-sm text-muted-foreground">
              <li>All borrowers must be active SBC members.</li>
              <li>
                Mandatory / Compliant savings (KSh 5,000 min) act as security and are not
                withdrawable during active membership. Shares are not withdrawable but transferable.
              </li>
              <li>
                Non-withdrawable / Loan savings can only be accessed after{" "}
                <span className="text-foreground font-medium">6-month written notice</span> and must
                not have an active loan or guarantorship obligation.
              </li>
              <li>
                Voluntary / withdrawable savings may be withdrawn at will less any administrative
                charge/s.
              </li>
              <li>Savings contributions must continue through the full loan cycle.</li>
              <li>
                At no one point will savings be utilized to offset loan unless under the discretion
                of the management.
              </li>
            </ul>
          </Section>

          <Section title="B. Loan Terms">
            <ul className="p-5 list-disc pl-9 space-y-2 text-sm text-muted-foreground">
              <li>
                <span className="text-foreground font-medium">Normal Loans:</span> KSh 1,000–5,000
                (7–30 days, 10–25% interest).
              </li>
              <li>
                <span className="text-foreground font-medium">Premium Loans:</span> KSh 5,000 and
                above (14–90 days, 15–25% interest).
              </li>
              <li>
                Processing fee {SBC_FEES.processingPct}%, insurance {SBC_FEES.insurancePct}%.
              </li>
              <li>
                {SBC_FEES.penaltyDailyPct}% penalty of the daily arrears if not cleared by the
                second day shall apply for every skipped day (within the loan cycle) unless with a
                communicated justifiable reason; in such an instance the arrears must be paid the
                next day.
              </li>
              <li>
                Compounded penalty of {SBC_FEES.defaultPenaltyPct}% daily per default period after
                the due date shall apply.
              </li>
              <li>Collateral joint registration fee is separate (can be added or deducted).</li>
            </ul>
          </Section>

          <Section title="C. Dividends & Multipliers">
            <ul className="p-5 list-disc pl-9 space-y-2 text-sm text-muted-foreground">
              <li>
                Members with full share and savings thresholds and without default earn annual
                dividends.
              </li>
              <li>Good repayment history grows savings and access multipliers.</li>
              <li>Default reduces eligibility for the next loan cycle.</li>
            </ul>
          </Section>

          <Section title="D. Default & Recovery">
            <ul className="p-5 list-disc pl-9 space-y-2 text-sm text-muted-foreground">
              <li>Increased penalty applies after due date as listed in B.</li>
              <li>Guarantors and collateral may be invoked after written notice.</li>
              <li>
                Final recourse: management may apply restricted savings against outstanding
                obligations.
              </li>
            </ul>
          </Section>
        </div>

        <Section title="Premium Loan Upfront Heads (Shares + Savings thresholds)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Loan Amount (KSh)</th>
                  <th className="px-5 py-3 text-right">Min Shares (KSh)</th>
                  <th className="px-5 py-3 text-right">Shares %</th>
                  <th className="px-5 py-3 text-right">Min Savings (KSh)</th>
                  <th className="px-5 py-3 text-right">Savings %</th>
                  <th className="px-5 py-3 text-left">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {SBC_UPFRONT_TABLE.map((u) => (
                  <tr key={u.range}>
                    <td className="px-5 py-3 font-medium">{u.range}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(u.minShares)}</td>
                    <td className="px-5 py-3 text-right">{u.sharesPct}%</td>
                    <td className="px-5 py-3 text-right">{fmtKES(u.minSavings)}</td>
                    <td className="px-5 py-3 text-right">{u.savingsPct}%</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{u.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
            Remaining balances can be completed through Special Savings (3:2 ratio).
          </p>
        </Section>
      </main>
    </>
  );
}
