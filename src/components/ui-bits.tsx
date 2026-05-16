import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function DirectorOnly({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { currentUser } = useStore();
  if (currentUser.role !== "director") return <>{fallback ?? null}</>;
  return <>{children}</>;
}

export function RestrictedNotice({ label = "Restricted to Directors" }: { label?: string }) {
  return (
    <div className="surface-panel rounded-sm border-dashed p-5 text-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-white/10 bg-white/[0.02]">
          <Lock className="h-4 w-4 text-primary" />
        </div>
        <span>
          <span className="font-medium text-foreground">{label}.</span> Aggregate company figures
          are visible to directors only.
        </span>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "destructive";
}) {
  const toneCls = {
    default:
      "border-primary/25 bg-primary/[0.08] text-primary shadow-[0_0_32px_rgba(45,212,191,0.08)]",
    accent: "border-white/12 bg-white/[0.03] text-foreground",
    success:
      "border-success/25 bg-success/[0.08] text-success shadow-[0_0_24px_rgba(52,211,153,0.08)]",
    warning: "border-warning/30 bg-warning/[0.08] text-warning",
    destructive: "border-destructive/25 bg-destructive/[0.08] text-destructive",
  }[tone];
  return (
    <div className="surface-panel group relative overflow-hidden rounded-sm p-5 transition-transform duration-200 hover:-translate-y-0.5">
      <div
        className={cn(
          "pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-80",
        )}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            {label}
          </div>
          <div className="data-readout mt-2 text-2xl font-semibold text-foreground sm:text-[1.9rem]">
            {value}
          </div>
          {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {icon && (
          <div
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-sm border ${toneCls}`}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section data-panel="telemetry" className={cn("surface-panel rounded-sm", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Command Surface
          </div>
          <h2 className="mt-1 font-display text-base font-semibold text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive" | "muted" | "accent";
}) {
  const cls = {
    default: {
      shell: "border-primary/25 bg-primary/[0.06] text-primary",
      dot: "bg-primary shadow-[0_0_10px_rgba(45,212,191,0.55)]",
    },
    success: {
      shell: "border-success/25 bg-success/[0.06] text-success",
      dot: "bg-success shadow-[0_0_10px_rgba(52,211,153,0.55)]",
    },
    warning: {
      shell: "border-warning/30 bg-warning/[0.08] text-warning",
      dot: "bg-warning shadow-[0_0_10px_rgba(245,185,66,0.5)]",
    },
    destructive: {
      shell: "border-destructive/25 bg-destructive/[0.06] text-destructive",
      dot: "bg-destructive shadow-[0_0_10px_rgba(251,113,133,0.45)]",
    },
    muted: {
      shell: "border-white/10 bg-white/[0.03] text-muted-foreground",
      dot: "bg-muted-foreground shadow-none",
    },
    accent: {
      shell: "border-white/14 bg-white/[0.05] text-foreground",
      dot: "bg-white/75 shadow-[0_0_10px_rgba(255,255,255,0.28)]",
    },
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.18em] ${cls.shell}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} />
      {children}
    </span>
  );
}
