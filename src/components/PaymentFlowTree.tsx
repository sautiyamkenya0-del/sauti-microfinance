import type { ReactNode } from "react";

import { FUEL_BUFFER_TARGET, fmtKES } from "@/lib/store";

type PaymentFlowTreeProps = {
  membershipFeeAmount: number;
  cardFeeAmount: number;
  stickerFeeAmount: number;
  mandatorySavingsThreshold: number;
  mandatorySharesThreshold: number;
};

export function PaymentFlowTree({
  membershipFeeAmount,
  cardFeeAmount,
  stickerFeeAmount,
  mandatorySavingsThreshold,
  mandatorySharesThreshold,
}: PaymentFlowTreeProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-muted/20 p-4 shadow-sm">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Payment Flow Map
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          Fees clear first, penalties follow if they already exist, then member money moves through
          the compliance basket below. Loan-member collections reserve the selected compliance
          contribution and send the remainder to the active loan.
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <FlowBoard
          title="Non-loan member flow"
          subtitle="A full contribution fills the compliance basket, then splits into pool and loan savings."
          accentClass="border-primary/25 bg-primary/5"
        >
          <StepCard
            eyebrow="Start"
            title="Incoming member payment"
            detail="Cash, Paybill, or officer-triggered payment lands here first."
          />
          <Connector />
          <FeeGate
            membershipFeeAmount={membershipFeeAmount}
            cardFeeAmount={cardFeeAmount}
            stickerFeeAmount={stickerFeeAmount}
          />
          <Connector />
          <StepCard
            title="Outstanding penalties"
            detail="Any already-open penalties clear before savings and shares grow again."
          />
          <Connector />
          <ThresholdTree
            title="Mandatory compliance basket"
            mandatorySavingsThreshold={mandatorySavingsThreshold}
            mandatorySharesThreshold={mandatorySharesThreshold}
          />
        </FlowBoard>

        <FlowBoard
          title="Member with active loan"
          subtitle="After the fee gate, upfront and compliance are handled before the loan remainder."
          accentClass="border-accent/30 bg-accent/10"
        >
          <StepCard
            eyebrow="Start"
            title="Incoming loan-member payment"
            detail="The same receipt can settle due fees, premium upfront, compliance, and loan balance."
          />
          <Connector />
          <FeeGate
            membershipFeeAmount={membershipFeeAmount}
            cardFeeAmount={cardFeeAmount}
            stickerFeeAmount={stickerFeeAmount}
          />
          <Connector />
          <StepCard
            title="Outstanding penalties"
            detail="Penalty arrears are cleared before the live split runs."
          />
          <Connector />
          <SplitStage
            mandatorySavingsThreshold={mandatorySavingsThreshold}
            mandatorySharesThreshold={mandatorySharesThreshold}
          />
        </FlowBoard>
      </div>
    </div>
  );
}

function FlowBoard({
  title,
  subtitle,
  accentClass,
  children,
}: {
  title: string;
  subtitle: string;
  accentClass: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-[28px] border p-5 shadow-sm ${accentClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{subtitle}</div>
        </div>
        <div className="rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          SBC flow
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Connector({ compact = false }: { compact?: boolean }) {
  return <div className={`ml-5 w-px bg-border ${compact ? "h-3" : "h-4"}`} />;
}

function StepCard({ eyebrow, title, detail }: { eyebrow?: string; title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      {eyebrow ? (
        <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <div className="mt-1 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function FeeGate({
  membershipFeeAmount,
  cardFeeAmount,
  stickerFeeAmount,
}: {
  membershipFeeAmount: number;
  cardFeeAmount: number;
  stickerFeeAmount: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Deduct First
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">
        Membership fee gate in the same payment window
      </div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">
        Every due membership item can clear here together before the rest of the payment continues.
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <TinyNode title="Registration fee" detail={fmtKES(membershipFeeAmount)} />
        <TinyNode title="Membership card" detail={fmtKES(cardFeeAmount)} />
        <TinyNode
          title="Sticker fee"
          detail={`${fmtKES(stickerFeeAmount)} for permanent non-fuel businesses`}
        />
        <TinyNode title="Fuel buffer" detail={`${fmtKES(FUEL_BUFFER_TARGET)} for fuel members`} />
      </div>
    </div>
  );
}

function ThresholdTree({
  title,
  mandatorySavingsThreshold,
  mandatorySharesThreshold,
}: {
  title: string;
  mandatorySavingsThreshold: number;
  mandatorySharesThreshold: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-4 space-y-3">
        <ThresholdNode
          step="1"
          title="60% to daily compliance contribution"
          detail={`Daily compliance contributions continue until ${fmtKES(mandatorySavingsThreshold)} is covered.`}
        />
        <Connector compact />
        <ThresholdNode
          step="2"
          title="40% to mandatory shares"
          detail={`Share contributions continue until ${fmtKES(mandatorySharesThreshold)} is covered.`}
        />
        <Connector compact />
        <ThresholdNode
          step="3"
          title="80/20 post-compliance split"
          detail="Once both thresholds are full, 80% goes to purpose pool and 20% goes to loan savings / multiplier savings."
          tone="warning"
        />
      </div>
    </div>
  );
}

function SplitStage({
  mandatorySavingsThreshold,
  mandatorySharesThreshold,
}: {
  mandatorySavingsThreshold: number;
  mandatorySharesThreshold: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Parallel Split
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">
        One payment reserves compliance then repays the loan
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.9fr]">
        <div className="rounded-2xl border border-border bg-muted/15 p-4">
          <div className="text-xs font-semibold text-foreground">Compliance contribution</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            One selected slice of KSh 50 or KSh 100 fills the 60/40 savings and shares basket.
          </div>
          <div className="mt-4">
            <ThresholdTree
              title="Compliance basket"
              mandatorySavingsThreshold={mandatorySavingsThreshold}
              mandatorySharesThreshold={mandatorySharesThreshold}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-muted/15 p-4">
          <div className="text-xs font-semibold text-foreground">Loan repayment leg</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            The rest of the same payment reduces the active loan balance immediately.
          </div>
          <div className="mt-4 space-y-3">
            <StepCard
              title="Apply repayment remainder"
              detail="Everything left after the compliance contribution reduces the outstanding active loan."
            />
            <Connector compact />
            <StepCard
              title="If the loan closes"
              detail="Any leftover amount loops back into the compliance basket, then the 80/20 post-compliance split."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TinyNode({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/15 p-3">
      <div className="text-xs font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ThresholdNode({
  step,
  title,
  detail,
  tone = "default",
}: {
  step: string;
  title: string;
  detail: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={`rounded-2xl border p-3 shadow-sm ${
        tone === "warning" ? "border-warning/35 bg-warning/10" : "border-border bg-muted/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
          {step}
        </div>
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
        </div>
      </div>
    </div>
  );
}
