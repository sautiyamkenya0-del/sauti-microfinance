import type { ReactNode } from "react";
import { useStore } from "@/lib/store";
import { Lock } from "lucide-react";

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
    <div className="bg-card border border-dashed border-border rounded-lg p-5 flex items-center gap-3 text-sm text-muted-foreground">
      <Lock className="h-4 w-4 text-accent" />
      <span>
        <span className="font-medium text-foreground">{label}.</span> Aggregate company figures are
        visible to directors only.
      </span>
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
    default: "bg-primary/10 text-primary",
    accent: "bg-accent/20 text-accent-foreground",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    destructive: "bg-destructive/10 text-destructive",
  }[tone];
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-4 transition hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-xs uppercase tracking-wider text-muted-foreground [overflow-wrap:anywhere]">
            {label}
          </div>
          <div className="mt-1.5 max-w-full break-words font-display text-[clamp(1rem,5.5vw,1.5rem)] font-semibold leading-tight text-foreground [overflow-wrap:anywhere]">
            {value}
          </div>
          {hint && (
            <div className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {hint}
            </div>
          )}
        </div>
        {icon && (
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${toneCls}`}>
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
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-card border border-border rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <h2 className="font-display text-base font-semibold">{title}</h2>
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
    default: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/25 text-warning-foreground",
    destructive: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
    accent: "bg-accent/25 text-accent-foreground",
  }[tone];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}
