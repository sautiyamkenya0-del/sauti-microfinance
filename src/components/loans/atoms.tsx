// Shared small form atoms used across loan sub-views.
import type { ReactNode } from "react";

export function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="loan-input mt-1"
      />
    </label>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  options: string[];
  disabled?: boolean;
}) {
  return (
    <label className="block">
      {label && (
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
      )}
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="loan-input mt-1"
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Snap({ label, v }: { label: string; v: string }) {
  return (
    <div className="bg-muted/40 border border-border rounded-md p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground mt-0.5 text-sm">{v}</div>
    </div>
  );
}
export function Row({
  label,
  value,
  bold,
  note,
}: {
  label: string;
  value: ReactNode;
  bold?: boolean;
  note?: string;
}) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">
        {label}
        {note && <span className="block text-[10px]">{note}</span>}
      </span>
      <span className={`text-sm ${bold ? "font-semibold text-foreground" : ""}`}>{value}</span>
    </div>
  );
}
export const inputCss = `.loan-input{width:100%;background:var(--color-muted);border:1px solid var(--color-border);border-radius:6px;padding:6px 10px;font-size:13px;outline:none}.loan-input:focus{border-color:var(--color-ring)}`;
