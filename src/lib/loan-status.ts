export type TrueLoanStatus = "pending" | "active" | "closed" | "defaulted" | "rejected";

export function trueLoanStatus(args: {
  storedStatus?: string;
  balance: number;
  dueDate?: string;
  today?: string;
}): TrueLoanStatus {
  const storedStatus = String(args.storedStatus ?? "")
    .trim()
    .toLowerCase();
  const balance = Math.max(0, Number(args.balance ?? 0));
  const dueDate = String(args.dueDate ?? "").slice(0, 10);
  const today = String(args.today ?? new Date().toISOString().slice(0, 10)).slice(0, 10);

  if (storedStatus === "pending" || storedStatus === "rejected") return storedStatus;
  if (balance <= 0) return "closed";
  if (storedStatus === "defaulted" || (dueDate && dueDate < today)) return "defaulted";
  return "active";
}

export function trueLoanStatusLabel(status: TrueLoanStatus) {
  if (status === "closed") return "Completed";
  return status[0].toUpperCase() + status.slice(1);
}

export function trueLoanStatusTone(status: TrueLoanStatus) {
  if (status === "active") return "success";
  if (status === "closed") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "destructive";
  return "destructive";
}
