import { useMemo, useState } from "react";
import { useStore, fmtKES, type Member } from "@/lib/store";
import { toast } from "sonner";
import { Smartphone, X, Loader2 } from "lucide-react";

type Props = { member: Member; mode?: "member" | "officer"; onClose: () => void };

type Purpose = "savings" | "loan" | "shares" | "investment" | "fees" | "upfront";

/**
 * STK Push prompt — sends a real Daraja prompt to the member's phone.
 * Member mode: free-form amount + purpose (no day caps).
 * Officer mode: prompts for the first-time minimum upfront + mandatory fees.
 */
export function MemberPayDialog({ member, mode = "member", onClose }: Props) {
  const { applyMpesaPayment, loans } = useStore();
  const activeLoan = loans.find((l) => l.memberId === member.id && l.status === "active");
  const [busy, setBusy] = useState(false);

  // ----- Officer mode (unchanged behavior, fees + upfront) -----
  const [stickerOn, setStickerOn] = useState(member.fees.hasShop || false);
  const fees = member.fees;
  const feeQueue = [
    { key: "membership", label: "Membership fee", amount: 500, owed: !fees.membership },
    { key: "card", label: "Membership card", amount: 500, owed: !fees.card },
    { key: "sticker", label: "Sticker (shop)", amount: 500, owed: stickerOn && !fees.sticker },
  ];
  const feesDue = feeQueue.filter((f) => f.owed).reduce((s, f) => s + f.amount, 0);

  // ----- Member mode (free-form) -----
  const defaultPurpose: Purpose = member.isInvestor
    ? "investment"
    : activeLoan
      ? "loan"
      : "savings";
  const [purpose, setPurpose] = useState<Purpose>(mode === "officer" ? "upfront" : defaultPurpose);
  const [amount, setAmount] = useState<number>(0);

  const purposeOptions: { value: Purpose; label: string; disabled?: boolean }[] = useMemo(() => {
    const opts: { value: Purpose; label: string; disabled?: boolean }[] = [
      { value: "savings", label: "Savings deposit" },
      { value: "loan", label: "Loan repayment", disabled: !activeLoan },
      { value: "shares", label: "Buy shares" },
      { value: "fees", label: "Mandatory fees" },
    ];
    if (member.isInvestor) opts.unshift({ value: "investment", label: "Investment top-up" });
    return opts;
  }, [activeLoan, member.isInvestor]);

  const previewAmount = useMemo(() => {
    if (mode === "officer") {
      if (purpose === "upfront") return feesDue + 500;
      if (purpose === "fees") return feesDue;
      return 0;
    }
    return Math.max(0, Math.floor(amount || 0));
  }, [mode, purpose, amount, feesDue]);

  const send = async () => {
    if (previewAmount <= 0) return toast.error("Enter an amount.");
    if (mode === "officer" && purpose === "upfront" && member.fees.firstUpfrontPaid) {
      return toast.warning("First upfront already settled — STK prompt skipped.");
    }
    setBusy(true);
    const accountRef = `SBC${member.id.replace(/^M/, "")}`;
    const purposeLabel = purposeOptions.find((p) => p.value === purpose)?.label ?? "Sauti payment";
    try {
      const res = await fetch("/api/public/mpesa/stkpush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: member.phone,
          amount: previewAmount,
          accountRef,
          description: `${purposeLabel} · ${member.name}`,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const msg = data?.error ?? data?.errorMessage ?? "STK push failed";
        toast.error(msg, {
          duration: 8000,
          description: data?.daraja ? String(data.daraja).slice(0, 200) : undefined,
        });
        setBusy(false);
        return;
      }
      if (data.simulated) {
        // Dev mode — run the in-memory allocation engine so the UI updates immediately.
        const r = applyMpesaPayment(
          accountRef,
          previewAmount,
          member.name,
          `STK${Date.now().toString().slice(-6)}`,
        );
        toast.success(`Simulated STK · ${r.notes.join(" ")}`);
      } else {
        toast.success(
          `STK prompt sent to ${member.phone} · CheckoutRequestID ${data.CheckoutRequestID ?? "—"}`,
        );
      }
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "STK push failed");
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
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-display text-lg font-semibold">
              {mode === "officer" ? "Prompt for upfront" : "Pay via M-Pesa"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {member.name} · Membership{" "}
              <span className="font-mono">SBC{member.id.replace(/^M/, "")}</span> · {member.phone}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "member" ? (
          <div className="space-y-3 mb-3">
            <label className="block">
              <span className="text-sm font-medium">Purpose</span>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as Purpose)}
                className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
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
                className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-base font-semibold"
              />
              <div className="text-xs text-muted-foreground mt-1">
                Pay any amount you wish — no caps.
              </div>
            </label>
            {member.isInvestor && (
              <p className="text-xs text-accent">
                As a member-investor, all payments to your Paybill account are routed to the
                investment pool.
              </p>
            )}
          </div>
        ) : (
          <div className="mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setPurpose("upfront")}
                className={`py-2 rounded-md text-xs font-medium border ${purpose === "upfront" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
              >
                First-time upfront
              </button>
              <button
                onClick={() => setPurpose("fees")}
                className={`py-2 rounded-md text-xs font-medium border ${purpose === "fees" ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
              >
                Mandatory fees only
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={stickerOn}
                onChange={(e) => setStickerOn(e.target.checked)}
              />
              Member has a physical shop (sticker fee applicable)
            </label>
            <div className="bg-muted/40 border border-border rounded-md p-3 text-xs space-y-1">
              {feeQueue.map((f) => (
                <div key={f.key} className="flex justify-between">
                  <span className={f.owed ? "" : "line-through text-muted-foreground"}>
                    {f.label}
                  </span>
                  <span>
                    {fmtKES(f.amount)} {f.owed ? "" : "(paid)"}
                  </span>
                </div>
              ))}
              {purpose === "upfront" && (
                <div className="flex justify-between border-t border-border pt-1 mt-1">
                  <span>First daily installment</span>
                  <span>{fmtKES(500)}</span>
                </div>
              )}
            </div>
            {purpose === "upfront" && member.fees.firstUpfrontPaid && (
              <p className="text-xs text-accent">
                Member has already paid first upfront manually — prompt will be disabled.
              </p>
            )}
          </div>
        )}

        <div className="bg-primary/10 border border-primary/30 rounded-md p-3 mb-4">
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
          className="w-full inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2.5 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
          {busy ? "Sending…" : "Send STK Prompt"}
        </button>
      </div>
    </div>
  );
}
