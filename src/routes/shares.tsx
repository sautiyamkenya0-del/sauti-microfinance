import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { MemberSearchSelect } from "@/components/MemberSearchSelect";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, StatCard, DirectorOnly } from "@/components/ui-bits";
import { useStore, fmtKES, hasMemberTag, isMemberCategory } from "@/lib/store";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PieChart as PieIcon } from "lucide-react";

export const Route = createFileRoute("/shares")({
  head: () => ({ meta: [{ title: "Shares — Sauti Microfinance" }] }),
  component: SharesPage,
});

function SharesPage() {
  const { members, sharePrice, recordTransaction, currentUser } = useStore();
  const memberAccounts = useMemo(
    () =>
      members.filter(
        (member) =>
          isMemberCategory(member.category) || hasMemberTag(member.memberTags, "member", member.category),
      ),
    [members],
  );
  const [memberId, setMemberId] = useState(memberAccounts[0]?.id ?? "");
  const [units, setUnits] = useState(1);

  useEffect(() => {
    if (!memberAccounts.some((member) => member.id === memberId)) {
      setMemberId(memberAccounts[0]?.id ?? "");
    }
  }, [memberAccounts, memberId]);

  const totalUnits = memberAccounts.reduce((s, m) => s + m.shares, 0);
  const totalCapital = totalUnits * sharePrice;

  const ownershipRows = memberAccounts
    .filter((m) => m.shares > 0)
    .sort((a, b) => b.shares - a.shares)
    .map((m) => ({
      ...m,
      stake: totalUnits > 0 ? (m.shares / totalUnits) * 100 : 0,
      value: m.shares * sharePrice,
    }));
  const topOwners = ownershipRows.slice(0, 10);
  const otherOwners = ownershipRows.slice(10);
  const otherUnits = otherOwners.reduce((sum, member) => sum + member.shares, 0);
  const otherStake = totalUnits > 0 ? (otherUnits / totalUnits) * 100 : 0;

  return (
    <>
      <AppHeader title="Shares" subtitle="Member share capital and ownership distribution." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="capital" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Share Price"
            value={fmtKES(sharePrice)}
            icon={<PieIcon className="h-5 w-5" />}
            tone="accent"
          />
          <DirectorOnly>
            <StatCard label="Units Issued" value={totalUnits.toLocaleString()} />
            <StatCard label="Share Capital" value={fmtKES(totalCapital)} tone="success" />
          </DirectorOnly>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Section title="Issue shares">
            <div className="p-5 space-y-3">
              <MemberSearchSelect
                members={memberAccounts}
                value={memberId}
                onChange={setMemberId}
                describeMember={(member) => `${member.name} - ${member.shares ?? 0} units`}
              />
              <input
                type="number"
                min={1}
                placeholder="Units"
                value={units}
                onChange={(e) => setUnits(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm"
              />
              <div className="bg-muted/50 rounded-md px-3 py-2 text-sm flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-semibold">{fmtKES(units * sharePrice)}</span>
              </div>
              <button
                onClick={async () => {
                  if (units <= 0) return;
                  await recordTransaction({
                    type: "share_purchase",
                    amount: units * sharePrice,
                    memberId,
                    by: currentUser.id,
                  });
                  toast.success(`${units} share unit(s) issued`);
                  setUnits(1);
                }}
                className="w-full bg-primary text-primary-foreground py-2 rounded-md text-sm font-medium hover:bg-primary/90"
              >
                Issue
              </button>
            </div>
          </Section>

          <div className="lg:col-span-2">
            <Section title="Ownership Distribution">
              <div className="space-y-3 p-5">
                <div className="flex h-4 overflow-hidden rounded-full bg-muted">
                  {topOwners.map((member, index) => (
                    <div
                      key={member.id}
                      title={`${member.name}: ${member.stake.toFixed(1)}%`}
                      className={[
                        "h-full",
                        [
                          "bg-primary",
                          "bg-success",
                          "bg-warning",
                          "bg-destructive",
                          "bg-accent",
                          "bg-foreground/70",
                          "bg-primary/60",
                          "bg-success/60",
                          "bg-warning/60",
                          "bg-accent/60",
                        ][index],
                      ].join(" ")}
                      style={{ width: `${Math.max(1.5, member.stake)}%` }}
                    />
                  ))}
                  {otherOwners.length > 0 && (
                    <div
                      title={`Other shareholders: ${otherStake.toFixed(1)}%`}
                      className="h-full bg-muted-foreground/40"
                      style={{ width: `${Math.max(1.5, otherStake)}%` }}
                    />
                  )}
                </div>
                {topOwners.map((member, index) => (
                  <div key={member.id} className="grid gap-1">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={[
                            "h-2.5 w-2.5 shrink-0 rounded-full",
                            [
                              "bg-primary",
                              "bg-success",
                              "bg-warning",
                              "bg-destructive",
                              "bg-accent",
                              "bg-foreground/70",
                              "bg-primary/60",
                              "bg-success/60",
                              "bg-warning/60",
                              "bg-accent/60",
                            ][index],
                          ].join(" ")}
                        />
                        <span className="truncate font-medium">
                          {index + 1}. {member.name}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {member.shares} units
                        </span>
                      </div>
                      <span className="shrink-0 font-semibold">{member.stake.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.min(100, member.stake)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {otherOwners.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                    <div className="flex justify-between">
                      <span>{otherOwners.length} smaller shareholders grouped as Other</span>
                      <span className="font-semibold">{otherStake.toFixed(1)}%</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, otherStake)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>

        <Section title="Shareholder Register">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Member</th>
                <th className="px-5 py-3 text-right">Units</th>
                <th className="px-5 py-3 text-right">Value</th>
                <th className="px-5 py-3 text-right">% Stake</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ownershipRows
                .map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3 font-medium">{m.name}</td>
                    <td className="px-5 py-3 text-right">{m.shares}</td>
                    <td className="px-5 py-3 text-right">{fmtKES(m.value)}</td>
                    <td className="px-5 py-3 text-right">{m.stake.toFixed(1)}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Section>
      </main>
    </>
  );
}
