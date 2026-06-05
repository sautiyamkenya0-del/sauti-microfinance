function receiptKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function dedupeMemberTransactions<
  T extends {
    id: string;
    type: string;
    amount: number;
    ref?: string;
    loanId?: string;
  },
>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const ref = receiptKey(row.ref);
    const key = ref ? `${row.type}|${row.loanId ?? ""}|${row.amount}|${ref}` : `id|${row.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
