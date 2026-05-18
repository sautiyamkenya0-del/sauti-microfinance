import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppHeader } from "@/components/AppHeader";
import { useStore } from "@/lib/store";
import {
  listRuntimeSecrets,
  setRuntimeSecret,
  deleteRuntimeSecret,
} from "@/lib/runtime-secrets.functions";
import { listAudit, listAuditActors } from "@/lib/audit.functions";
import { askWatchdog } from "@/lib/watchdog.functions";
import { runOnce } from "@/lib/dedupe";
import { toast } from "sonner";
import {
  KeyRound,
  Trash2,
  Save,
  ShieldAlert,
  ScrollText,
  Bot,
  Download,
  Send,
  RefreshCw,
} from "lucide-react";

export const Route = createFileRoute("/secret-keys")({
  head: () => ({ meta: [{ title: "Secret Keys — Sauti Microfinance" }] }),
  component: SecretKeysPage,
});

type Suggested = {
  key: string;
  label: string;
  help: string;
  secret?: boolean;
  group: "AI" | "M-Pesa";
};
const SUGGESTED: Suggested[] = [
  // AI
  {
    key: "GROQ_API_KEY",
    group: "AI",
    secret: true,
    label: "Groq API key",
    help: "Main AI provider for SautiAI. Get one at console.groq.com.",
  },
  {
    key: "GROQ_MODEL",
    group: "AI",
    label: "Groq chat model (optional)",
    help: "Defaults to llama-3.3-70b-versatile.",
  },
  {
    key: "GROQ_VISION_MODEL",
    group: "AI",
    label: "Groq vision model (optional)",
    help: "Used for M-Pesa screenshot extraction. Defaults to meta-llama/llama-4-scout-17b-16e-instruct.",
  },
  // M-Pesa Daraja
  {
    key: "MPESA_ENV",
    group: "M-Pesa",
    label: "MPESA_ENV (sandbox / production)",
    help: "sandbox for test creds, production for live shortcode.",
  },
  {
    key: "MPESA_SHORTCODE",
    group: "M-Pesa",
    label: "MPESA_SHORTCODE (Paybill)",
    help: "Your Lipa Na M-Pesa Paybill / Till number.",
  },
  {
    key: "MPESA_CONSUMER_KEY",
    group: "M-Pesa",
    secret: true,
    label: "MPESA_CONSUMER_KEY",
    help: "Daraja app Consumer Key.",
  },
  {
    key: "MPESA_CONSUMER_SECRET",
    group: "M-Pesa",
    secret: true,
    label: "MPESA_CONSUMER_SECRET",
    help: "Daraja app Consumer Secret.",
  },
  {
    key: "MPESA_PASSKEY",
    group: "M-Pesa",
    secret: true,
    label: "MPESA_PASSKEY (Lipa Na M-Pesa Online)",
    help: "STK Push passkey for the shortcode.",
  },
  {
    key: "MPESA_INITIATOR_NAME",
    group: "M-Pesa",
    label: "MPESA_INITIATOR_NAME",
    help: "B2C/Reversal initiator username (e.g. apiop).",
  },
  {
    key: "MPESA_INITIATOR_PASSWORD",
    group: "M-Pesa",
    secret: true,
    label: "MPESA_INITIATOR_PASSWORD",
    help: "Plaintext password used to encrypt the SecurityCredential.",
  },
];
const GROUPS: Array<Suggested["group"]> = ["AI", "M-Pesa"];

function SecretKeysPage() {
  const { currentUser } = useStore();
  const navigate = useNavigate();
  const list = useServerFn(listRuntimeSecrets);
  const save = useServerFn(setRuntimeSecret);
  const remove = useServerFn(deleteRuntimeSecret);
  const fetchAudit = useServerFn(listAudit);
  const fetchActors = useServerFn(listAuditActors);
  const ask = useServerFn(askWatchdog);

  const [tab, setTab] = useState<"keys" | "audit" | "ai">("keys");

  const [items, setItems] = useState<
    Array<{ key: string; preview: string; length: number; updated_at: string }>
  >([]);
  const [vaultWritable, setVaultWritable] = useState(true);
  const [vaultReason, setVaultReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{ key: string; value: string }>({
    key: "GROQ_API_KEY",
    value: "",
  });
  const [showValue, setShowValue] = useState(false);

  const currentSuggestion = SUGGESTED.find((s) => s.key === form.key);
  const isSecretField = currentSuggestion ? currentSuggestion.secret === true : true;

  useEffect(() => {
    if (currentUser.role !== "director") {
      navigate({ to: "/" });
    }
  }, [currentUser.role, navigate]);

  async function refresh() {
    setLoading(true);
    try {
      const result = await list();
      setItems(result.items);
      setVaultWritable(result.writable);
      setVaultReason(result.reason);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  async function onSave() {
    const key = form.key.trim().toUpperCase();
    const value = form.value.trim();
    if (!key || !value) return toast.error("Key and value required");
    try {
      await runOnce(`secret-save:${key}`, () =>
        save({
          data: {
            key,
            value,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRole: currentUser.role,
          },
        }),
      );
      toast.success(`Saved ${key}`);
      setForm({ key: "GROQ_API_KEY", value: "" });
      setShowValue(false);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    }
  }

  async function onDelete(key: string) {
    if (!confirm(`Delete ${key}?`)) return;
    try {
      await runOnce(`secret-delete:${key}`, () =>
        remove({
          data: {
            key,
            actorId: currentUser.id,
            actorName: currentUser.name,
            actorRole: currentUser.role,
          },
        }),
      );
      toast.success(`Deleted ${key}`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  if (currentUser.role !== "director") return null;

  return (
    <>
      <AppHeader
        title="System Secrets"
        subtitle="Director-only server configuration, audit review, and watchdog controls."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6 max-w-5xl">
        <div className="flex gap-1 bg-muted/40 border border-border rounded-lg p-1 w-fit">
          {(
            [
              { id: "keys", label: "Keys", Icon: KeyRound },
              { id: "audit", label: "Audit log", Icon: ScrollText },
              { id: "ai", label: "Watchdog AI", Icon: Bot },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 ${tab === id ? "bg-background shadow-sm font-medium" : "opacity-70 hover:opacity-100"}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        {tab === "keys" && (
          <>
            <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-xl p-4 flex gap-3">
              <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold">Sensitive area</div>
                <div className="opacity-80">
                  Values stored here are read by the server only and override any matching
                  build-time secret of the same name. Do not share screenshots of saved keys.
                </div>
              </div>
            </div>
            {!vaultWritable && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-semibold">Runtime vault unavailable</div>
                <div className="mt-1">
                  {vaultReason ||
                    "SUPABASE_SERVICE_ROLE_KEY is missing on the server, so runtime secret storage is currently disabled."}
                </div>
                <div className="mt-1">
                  Add `SUPABASE_SERVICE_ROLE_KEY` to your local `.env` and hosting secrets, then
                  redeploy.
                </div>
              </div>
            )}

            <section className="bg-card border border-border rounded-xl p-5">
              <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Add / update a key
              </h2>
              <div className="grid sm:grid-cols-[1fr_2fr_auto] gap-3 items-end">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Key
                  </span>
                  <input
                    value={form.key}
                    onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))}
                    placeholder="GROQ_API_KEY"
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Value{currentSuggestion ? ` — ${currentSuggestion.help}` : ""}</span>
                    <button
                      type="button"
                      onClick={() => setShowValue((v) => !v)}
                      className="text-[10px] underline opacity-70 hover:opacity-100"
                    >
                      {showValue ? "Hide" : "Show"}
                    </button>
                  </span>
                  <input
                    type={showValue || !isSecretField ? "text" : "password"}
                    value={form.value}
                    onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                    placeholder={
                      currentSuggestion?.key === "MPESA_ENV"
                        ? "production or sandbox"
                        : currentSuggestion?.key === "MPESA_SHORTCODE"
                          ? "e.g. 4153434"
                          : "Paste value…"
                    }
                    className="w-full mt-1 bg-muted border border-border rounded-md px-3 py-2 text-sm font-mono"
                  />
                </label>
                <button
                  onClick={onSave}
                  disabled={!vaultWritable}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-md hover:bg-primary/90 h-[38px]"
                >
                  <Save className="h-4 w-4" /> Save
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {GROUPS.map((g) => (
                  <div key={g}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                      {g}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTED.filter((s) => s.group === g).map((s) => {
                        const stored = items.find((it) => it.key === s.key);
                        return (
                          <button
                            key={s.key}
                            onClick={() => {
                              setForm({ key: s.key, value: "" });
                              setShowValue(false);
                            }}
                            title={s.help}
                            className={`text-xs px-2 py-1 rounded-md border ${form.key === s.key ? "bg-primary/15 border-primary text-primary" : stored ? "bg-success/15 border-success/40 text-success" : "bg-muted hover:bg-accent border-border"}`}
                          >
                            {s.label}
                            {stored ? " ✓" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-card border border-border rounded-xl">
              <div className="px-5 py-3 border-b border-border font-medium text-sm">
                Stored keys ({items.length})
              </div>
              {loading ? (
                <div className="p-5 text-sm text-muted-foreground">Loading…</div>
              ) : items.length === 0 ? (
                <div className="p-5 text-sm text-muted-foreground">No secrets stored yet.</div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((it) => (
                    <li key={it.key} className="px-5 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm">{it.key}</div>
                        <div className="text-[11px] text-muted-foreground">
                          value <span className="font-mono">{it.preview || "—"}</span> · {it.length}{" "}
                          chars · updated {new Date(it.updated_at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => onDelete(it.key)}
                        disabled={!vaultWritable}
                        className="h-8 w-8 grid place-items-center rounded-md hover:bg-destructive/15 text-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                <span className="font-mono">GROQ_API_KEY</span> powers the app's AI chat, watchdog,
                and M-Pesa scan features.
              </div>
              <div>
                M-Pesa keys saved here override the build-time secrets and can be swapped without
                redeploying. The diagnostic endpoint is disabled in production unless{" "}
                <span className="font-mono">SAUTI_ENABLE_MPESA_DIAGNOSTICS=true</span>.
              </div>
            </div>
          </>
        )}

        {tab === "audit" && <AuditTab fetchAudit={fetchAudit} fetchActors={fetchActors} />}
        {tab === "ai" && <WatchdogTab ask={ask} />}
      </main>
    </>
  );
}

/* ---------------- Audit tab ---------------- */
function AuditTab({ fetchAudit, fetchActors }: { fetchAudit: any; fetchActors: any }) {
  const [rows, setRows] = useState<any[]>([]);
  const [actors, setActors] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [filters, setFilters] = useState<{ actorId: string; action: string; q: string }>({
    actorId: "",
    action: "",
    q: "",
  });
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        fetchAudit({
          data: {
            actorId: filters.actorId || undefined,
            action: filters.action || undefined,
            q: filters.q || undefined,
            limit: 1000,
          },
        }),
        fetchActors(),
      ]);
      setRows(r);
      setActors(a);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load audit");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  function downloadCsv() {
    const head = [
      "timestamp",
      "actor_id",
      "actor_name",
      "actor_role",
      "action",
      "target_type",
      "target_id",
      "summary",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      head.join(","),
      ...rows.map((r) =>
        [
          r.ts,
          r.actor_id,
          r.actor_name,
          r.actor_role,
          r.action,
          r.target_type,
          r.target_id,
          r.summary,
        ]
          .map(esc)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="bg-card border border-border rounded-xl">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm mr-2">Audit log</span>
        <select
          value={filters.actorId}
          onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))}
          className="text-xs bg-muted border border-border rounded-md px-2 py-1.5"
        >
          <option value="">All staff</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} {a.role ? `· ${a.role}` : ""}
            </option>
          ))}
        </select>
        <input
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          placeholder="action contains…"
          className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 w-40"
        />
        <input
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          placeholder="search summary…"
          className="text-xs bg-muted border border-border rounded-md px-2 py-1.5 flex-1 min-w-[140px]"
        />
        <button
          onClick={load}
          className="text-xs inline-flex items-center gap-1 bg-muted hover:bg-accent border border-border rounded-md px-2 py-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <button
          onClick={downloadCsv}
          disabled={!rows.length}
          className="text-xs inline-flex items-center gap-1 bg-primary text-primary-foreground rounded-md px-2 py-1.5 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      </div>
      {loading ? (
        <div className="p-5 text-sm text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="p-5 text-sm text-muted-foreground">No matching audit entries.</div>
      ) : (
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                    {new Date(r.ts).toLocaleString()}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {r.actor_name ?? r.actor_id ?? "—"}
                    <span className="text-muted-foreground">
                      {" "}
                      {r.actor_role ? `· ${r.actor_role}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono">{r.action}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                    {r.target_type ? `${r.target_type}:${r.target_id ?? ""}` : "—"}
                  </td>
                  <td className="px-3 py-1.5">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- Watchdog AI tab ---------------- */
function WatchdogTab({ ask }: { ask: any }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const presets = useMemo(
    () => [
      "Anything fishy in the last 14 days?",
      "Did anyone try to elevate their role?",
      "Show deleted or modified transactions.",
      "Are any loans paying back more than principal + interest?",
      "Which staff edited their own records?",
    ],
    [],
  );

  async function send(question: string) {
    if (!question.trim() || busy) return;
    setChat((c) => [...c, { role: "user", content: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await ask({ data: { question } });
      setChat((c) => [...c, { role: "assistant", content: r.answer }]);
    } catch (e: any) {
      setChat((c) => [
        ...c,
        { role: "assistant", content: `⚠️ ${e?.message ?? "Watchdog failed"}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card border border-border rounded-xl flex flex-col h-[70vh]">
      <div className="px-5 py-3 border-b border-border">
        <div className="font-medium text-sm flex items-center gap-2">
          <Bot className="h-4 w-4" /> Watchdog AI
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Read-only. Sees the last 14 days of audit log + live tables. Cannot change anything.
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {chat.length === 0 && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">Try asking:</div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-xs px-2 py-1 rounded-md bg-muted hover:bg-accent border border-border text-left"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "text-sm"
                : "text-sm bg-muted/40 border border-border rounded-lg p-3"
            }
          >
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              {m.role === "user" ? "You" : "Watchdog"}
            </div>
            <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
          </div>
        ))}
        {busy && (
          <div className="text-xs text-muted-foreground animate-pulse">Watchdog is scanning…</div>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
        className="p-3 border-t border-border flex gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask the watchdog…"
          className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm"
        />
        <button
          disabled={busy || !q.trim()}
          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-3 py-2 rounded-md disabled:opacity-50"
        >
          <Send className="h-4 w-4" /> Ask
        </button>
      </form>
    </section>
  );
}
