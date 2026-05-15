/**
 * Network-resilience helper. Wrap any async mutation so that:
 *  - Double-clicks / shaky WiFi never fire it twice (in-flight de-dup by key).
 *  - The same logical action retried within `ttlMs` resolves with the cached result
 *    instead of running again (idempotency).
 *
 * Use for: form submits, "approve loan", "post payment", "save secret", etc.
 *
 *   await runOnce(`approve-loan:${loanId}`, () => approveLoan({ data: { id: loanId } }));
 */
const inflight = new Map<string, Promise<unknown>>();
const recent = new Map<string, { result: unknown; at: number }>();

export async function runOnce<T>(key: string, fn: () => Promise<T>, ttlMs = 4000): Promise<T> {
  const now = Date.now();
  const cached = recent.get(key);
  if (cached && now - cached.at < ttlMs) return cached.result as T;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      const out = await fn();
      recent.set(key, { result: out, at: Date.now() });
      // garbage-collect old entries
      for (const [k, v] of recent) if (Date.now() - v.at > ttlMs * 4) recent.delete(k);
      return out;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Generate a stable idempotency key for a one-shot user action. */
export function newIdemKey(prefix = "op"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
