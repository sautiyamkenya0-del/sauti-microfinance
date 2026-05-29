import { useMemo, useState } from "react";
import {
  useStore,
  businessPermanenceLabel,
  fmtKES,
  fuelBufferTargetAmount,
  formatMembershipNumber,
  isInvestorOnlyCategory,
  memberIsFuelMember,
  memberNeedsSticker,
  upfrontTotalsForAmount,
  type Member,
} from "@/lib/store";
import { feePolicyAppliesToMember } from "@/lib/fees-policy";
import { toast } from "sonner";
import { Smartphone, X, Loader2 } from "lucide-react";

type Props = { member: Member; mode?: "member" | "officer"; onClose: () => void };

type Purpose = "savings" | "loan" | "shares" | "investment" | "fees" | "upfront";

/**
 * STK Push prompt - sends a real Daraja prompt to the member's phone.
 * Member mode: free-form amount + purpose (no day caps).
 * Officer mode: prompts for the first-time minimum upfront + mandatory fees.
 */
export function MemberPayDialog({ member, mode = "member", onClose }: Props) {
  const { loans, transactions, feePolicies } = useStore();
  const activeLoan = loans.find(
    (l) => l.memberId === member.id && (l.status === "active" || l.status === "defaulted"),
  );
  const [busy, setBusy] = useState(false);

  const fuelMember = memberIsFuelMember(member);
  const [legacyStickerOn, setLegacyStickerOn] = useState(member.fees.hasShop || false);
  const stickerOn = fuelMember
    ? false
    : member.businessPermanence
      ? memberNeedsSticker(member)
      : legacyStickerOn;
  const fuelBufferPaid = transactions
    .filter(
      (transaction) =>
        transaction.memberId === member.id &&
        transaction.type === "deposit" &&
        String(transaction.note ?? "").startsWith("Locomotive fuel buffer"),
    )
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const fuelBufferDue = fuelMember ? Math.max(0, fuelBufferTargetAmount() - fuelBufferPaid) : 0;
  const fees = member.fees;
  const membershipPolicy = feePolicies.find((fee) => fee.key === "membership");
  const cardPolicy = feePolicies.find((fee) => fee.key === "card");
  const stickerPolicy = feePolicies.find((fee) => fee.key === "sticker");
  const membershipAmount =
    membershipPolicy &&
    feePolicyAppliesToMember(
      membershipPolicy,
      {
        id: member.id,
        joinedAt: member.joinedAt,
        category: member.category,
        isInvestor: member.isInvestor,
      },
      { hasActiveLoan: !!activeLoan },
    )
      ? membershipPolicy.amount
      : 0;
  const cardAmount =
    cardPolicy &&
    feePolicyAppliesToMember(
      cardPolicy,
      {
        id: member.id,
        joinedAt: member.joinedAt,
        category: member.category,
        isInvestor: member.isInvestor,
      },
      { hasActiveLoan: !!activeLoan },
    )
      ? cardPolicy.amount
      : 0;
  const stickerAmount =
    stickerPolicy &&
    feePolicyAppliesToMember(
      stickerPolicy,
      {
        id: member.id,
        joinedAt: member.joinedAt,
        category: member.category,
        isInvestor: member.isInvestor,
      },
      { hasActiveLoan: !!activeLoan },
    )
      ? stickerPolicy.amount
      : 0;
  const feeQueue = [
    {
      key: "membership",
      label: "Membership fee",
      amount: membershipAmount,
      owed: !fees.membership,
    },
    { key: "card", label: "Membership card", amount: cardAmount, owed: !fees.card },
    {
      key: "sticker",
      label: "Sticker (shop)",
      amount: stickerAmount,
      owed: stickerOn && !fees.sticker,
    },
  ].filter((fee) => fee.amount > 0);
  const feesDue = feeQueue.filter((f) => f.owed).reduce((s, f) => s + f.amount, 0);

  const investorOnly = isInvestorOnlyCategory(member.category);
  const defaultPurpose: Purpose = investorOnly ? "investment" : activeLoan ? "loan" : "savings";
  const [purpose, setPurpose] = useState<Purpose>(mode === "officer" ? "upfront" : defaultPurpose);
  const [amount, setAmount] = useState<number>(0);
  const [plannedLoanAmount, setPlannedLoanAmount] = useState<number>(5000);
  const upfrontTotals = useMemo(
    () =>
      upfrontTotalsForAmount(plannedLoanAmount, {
        membershipFeeAmount:
          feeQueue.find((fee) => fee.key === "membership" && fee.owed)?.amount ?? 0,
        cardFeeAmount: feeQueue.find((fee) => fee.key === "card" && fee.owed)?.amount ?? 0,
        stickerFeeAmount: feeQueue.find((fee) => fee.key === "sticker" && fee.owed)?.amount ?? 0,
        includeSticker: stickerOn,
      }),
    [feeQueue, plannedLoanAmount, stickerOn],
  );

  const purposeOptions: { value: Purpose; label: string; disabled?: boolean }[] = useMemo(() => {
    const opts: { value: Purpose; label: string; disabled?: boolean }[] = [
      { value: "savings", label: "Daily compliance contribution" },
      { value: "loan", label: "Loan repayment", disabled: !activeLoan },
      { value: "shares", label: "Buy shares" },
      { value: "fees", label: "Mandatory fees" },
    ];
    if (investorOnly) opts.unshift({ value: "investment", label: "Investment top-up" });
    return opts;
  }, [activeLoan, investorOnly]);

  const previewAmount = useMemo(() => {
    if (mode === "officer") {
      if (purpose === "upfront") return upfrontTotals.totalUpfrontNow + fuelBufferDue;
      if (purpose === "fees") return feesDue + fuelBufferDue;
      return 0;
    }
    return Math.max(0, Math.floor(amount || 0));
  }, [amount, feesDue, fuelBufferDue, mode, purpose, upfrontTotals.totalUpfrontNow]);

  const send = async () => {
    if (previewAmount <= 0) return toast.error("Enter an amount.");
    if (mode === "officer" && purpose === "upfront" && member.fees.firstUpfrontPaid) {
      return toast.warning("First upfront already settled - STK prompt skipped.");
    }

    setBusy(true);
    const accountRef = formatMembershipNumber(member.id);
    const purposeLabel = purposeOptions.find((p) => p.value === purpose)?.label ?? "Sauti payment";

    try {
      const res = await fetch("/api/public/mpesa/stkpush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: member.phone,
          amount: previewAmount,
          accountRef,
          description: `${purposeLabel} - ${member.name}`,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (res.status === 404 || !contentType.includes("application/json")) {
        toast.error("The M-Pesa server endpoint is not available.");
        return;
      }

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        errorMessage?: string;
        daraja?: string;
        CheckoutRequestID?: string;
        hint?: string;
      };

      if (!res.ok || !data.ok) {
        const msg = data.error ?? data.errorMessage ?? "STK push failed";
        toast.error(msg, {
          duration: 8000,
          description: data.hint ?? (data.daraja ? String(data.daraja).slice(0, 200) : undefined),
        });
        return;
      }

      toast.success(
        `STK prompt sent to ${member.phone}. Request ID: ${data.CheckoutRequestID ?? "-"}`,
      );
      onClose();
    } catch {
      toast.error("M-Pesa request failed. Check the server configuration and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card rounded-xl border border-border w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-semibold">
              {mode === "officer" ? "Prompt for upfront" : "Pay via M-Pesa"}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {member.name} - Membership{" "}
              <span className="font-mono">{formatMembershipNumber(member.id)}</span> -{" "}
              {member.phone}
            </p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "member" ? (
          <div className="mb-3 space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Purpose</span>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as Purpose)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                {purposeOptions.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                    {o.disabled ? " (no active loan)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Amount (KSh)</span>
              <input
                type="number"
                min={1}
                placeholder="e.g. 20000"
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-base font-semibold"
              />
              <div className="mt-1 text-xs text-muted-foreground">
                Pay any amount you wish - no caps.
              </div>
            </label>
            {investorOnly && (
              <p className="text-xs text-accent">
                This investor-only account routes Paybill payments directly to the investment pool.
              </p>
            )}
            {member.category === "both" && (
              <p className="text-xs text-muted-foreground">
                Member-plus-investor accounts still follow the normal member payment flow first.
              </p>
            )}
          </div>
        ) : (
          <div className="mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPurpose("upfront")}
                className={`rounded-md border py-2 text-xs font-medium ${
                  purpose === "upfront"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted"
                }`}
              >
                First-time upfront
              </button>
              <button
                onClick={() => setPurpose("fees")}
                className={`rounded-md border py-2 text-xs font-medium ${
                  purpose === "fees"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted"
                }`}
              >
                Mandatory fees only
              </button>
            </div>
            {fuelMember ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Locomotive fuel member: sticker fee is skipped. Fuel buffer due:{" "}
                <span className="font-medium text-foreground">{fmtKES(fuelBufferDue)}</span>.
              </div>
            ) : member.businessPermanence ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Business setup:{" "}
                <span className="font-medium text-foreground">
                  {businessPermanenceLabel(member.businessPermanence)}
                </span>
                . Sticker fee {stickerOn ? "applies automatically." : "does not apply."}
              </div>
            ) : (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={legacyStickerOn}
                  onChange={(e) => setLegacyStickerOn(e.target.checked)}
                />
                Member has a physical shop (sticker fee applicable)
              </label>
            )}
            <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
              {feeQueue.map((f) => (
                <div key={f.key} className="flex justify-between">
                  <span className={f.owed ? "" : "text-muted-foreground line-through"}>
                    {f.label}
                  </span>
                  <span>
                    {fmtKES(f.amount)} {f.owed ? "" : "(paid)"}
                  </span>
                </div>
              ))}
              {purpose === "upfront" && (
                <label className="block border-t border-border pt-2">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Planned loan amount
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={plannedLoanAmount || ""}
                    onChange={(e) => setPlannedLoanAmount(Number(e.target.value) || 0)}
                    className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                  />
                </label>
              )}
              {purpose === "upfront" && (
                <div className="mt-1 flex justify-between border-t border-border pt-1">
                  <span>Tiered upfront base</span>
                  <span>{fmtKES(upfrontTotals.total)}</span>
                </div>
              )}
              {purpose === "upfront" && (
                <div className="mt-1 flex justify-between border-t border-border pt-1">
                  <span>Mandatory fees due now</span>
                  <span>{fmtKES(upfrontTotals.mandatoryFeesTotal)}</span>
                </div>
              )}
              {fuelBufferDue > 0 && (
                <div className="mt-1 flex justify-between border-t border-border pt-1">
                  <span>Fuel buffer due</span>
                  <span>{fmtKES(fuelBufferDue)}</span>
                </div>
              )}
              {purpose === "upfront" && (
                <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
                  <span>Total upfront now</span>
                  <span>{fmtKES(upfrontTotals.totalUpfrontNow + fuelBufferDue)}</span>
                </div>
              )}
              {purpose === "upfront" && upfrontTotals.tier && (
                <div className="text-muted-foreground">
                  {upfrontTotals.tier.range}: shares {fmtKES(upfrontTotals.sharesAmount)} · savings{" "}
                  {fmtKES(upfrontTotals.savingsAmount)}
                </div>
              )}
              {purpose === "upfront" && !upfrontTotals.tier && (
                <div className="text-muted-foreground">
                  No premium upfront tier is configured for this loan amount yet.
                </div>
              )}
            </div>
            {purpose === "upfront" && member.fees.firstUpfrontPaid && (
              <p className="text-xs text-accent">
                Member has already paid first upfront manually - prompt will be disabled.
              </p>
            )}
          </div>
        )}

        <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Total to prompt
          </div>
          <div className="font-display text-2xl font-semibold">{fmtKES(previewAmount)}</div>
        </div>

        <button
          onClick={send}
          disabled={
            busy ||
            previewAmount <= 0 ||
            (mode === "officer" && purpose === "upfront" && member.fees.firstUpfrontPaid)
          }
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
          {busy ? "Sending..." : "Send STK Prompt"}
        </button>
      </div>
    </div>
  );
}
