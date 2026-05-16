import { useStore, roleLabel, navForUser } from "@/lib/store";
import { Bell, Search, Menu, X as IconX } from "lucide-react";
import logoUrl from "@/assets/sauti-logo.png?url";
import { useNotifications, useUnreadCommunicationCount } from "@/lib/notifications";
import { useApprovals } from "@/lib/approvals";
import { useReadIds } from "@/lib/read-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Banknote,
  Users,
  Wallet,
  MessageSquare,
  Sparkles,
  IdCard,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { sectionForPath } from "@/components/SectionTabs";

type Entry = {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  section?: string;
  requires: string[];
};

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
type NotifyEventDetail = {
  id?: string;
  title?: string;
  detail?: string;
  urgent?: boolean;
};
type BatteryManagerLike = EventTarget & {
  charging: boolean;
  level: number;
  addEventListener(type: "chargingchange" | "levelchange", listener: () => void): void;
  removeEventListener(type: "chargingchange" | "levelchange", listener: () => void): void;
};
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManagerLike> };

const ENTRIES: Entry[] = [
  { id: "dashboard", to: "/", label: "Dashboard", icon: LayoutDashboard, requires: ["dashboard"] },
  { id: "ai", to: "/ai", label: "SautiAI", icon: Sparkles, requires: ["ai"] },
  { id: "portal", to: "/portal", label: "Member Portal", icon: IdCard, requires: ["portal"] },
  {
    id: "lending",
    to: "/loans",
    label: "Lending",
    icon: Banknote,
    section: "lending",
    requires: ["loans"],
  },
  {
    id: "members",
    to: "/members",
    label: "Members",
    icon: Users,
    section: "members",
    requires: ["members"],
  },
  {
    id: "capital",
    to: "/savings",
    label: "Capital Operations",
    icon: Wallet,
    section: "capital",
    requires: ["savings"],
  },
  {
    id: "comms",
    to: "/staff",
    label: "Communications",
    icon: MessageSquare,
    section: "comms",
    requires: ["staff"],
  },
  {
    id: "admin",
    to: "/staff-mgmt",
    label: "Administration",
    icon: ShieldCheck,
    section: "admin",
    requires: ["staffmgmt"],
  },
];

function BatteryGlyph({ level, charging }: { level: number | null; charging: boolean }) {
  const percentage = level === null ? 38 : Math.max(12, Math.round(level * 100));

  return (
    <div className="flex items-center gap-2">
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/38">Battery</div>
        <div className="data-readout text-xs text-foreground">
          {level === null ? "--" : `${Math.round(level * 100)}%`}
          {charging ? " +" : ""}
        </div>
      </div>
      <div className="relative h-3.5 w-8 rounded-[2px] border border-white/20">
        <div
          className={`absolute inset-y-[1px] left-[1px] rounded-[1px] ${charging ? "bg-white/90" : "bg-primary shadow-[0_0_12px_rgba(45,212,191,0.45)]"}`}
          style={{ width: `calc(${percentage}% - 2px)` }}
        />
        <div className="absolute -right-[3px] top-[4px] h-1.5 w-[2px] rounded-full bg-white/25" />
      </div>
    </div>
  );
}

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { currentUser } = useStore();
  const notes = useNotifications();
  const { markRead } = useReadIds();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState<"idle" | "alert" | "info">("idle");
  const initializedRef = useRef(false);
  const seenNoteIdsRef = useRef(new Set<string>());
  const announcedIdsRef = useRef(new Set<string>());
  const path = useRouterState({ select: (r) => r.location.pathname });
  const activeSection = sectionForPath(path);
  const unreadComms = useUnreadCommunicationCount();
  const { pendingCount } = useApprovals();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [battery, setBattery] = useState<{ level: number | null; charging: boolean }>({
    level: null,
    charging: false,
  });
  const allowed = useMemo(() => new Set(navForUser(currentUser)), [currentUser]);
  const entries = ENTRIES.filter((entry) => entry.requires.some((key) => allowed.has(key)));

  const announceNotification = useCallback(
    ({ id, title: nextTitle, detail, urgent }: NotifyEventDetail) => {
      if (id && announcedIdsRef.current.has(id)) return;
      if (id) announcedIdsRef.current.add(id);

      setPulse(urgent ? "alert" : "info");
      try {
        const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
        const ctx = AudioCtor ? new AudioCtor() : null;
        if (!ctx) throw new Error("AudioContext unavailable");
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.frequency.value = urgent ? 660 : 880;
        gain.gain.value = 0.06;
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.2);
      } catch {
        /* AudioContext blocked */
      }

      navigator.vibrate?.(urgent ? [180, 80, 180, 80, 180] : [120]);
      if (nextTitle) {
        toast(nextTitle, {
          description: detail,
        });
      }
      window.setTimeout(() => setPulse("idle"), 2400);
    },
    [],
  );

  useEffect(() => {
    const currentIds = new Set(notes.map((note) => note.id));
    if (!initializedRef.current) {
      initializedRef.current = true;
      seenNoteIdsRef.current = currentIds;
      return;
    }

    const incoming = notes.filter((note) => !seenNoteIdsRef.current.has(note.id));
    seenNoteIdsRef.current = currentIds;
    if (!incoming.length) return;

    const lead = incoming.find((note) => note.kind === "alert") ?? incoming[0];
    announceNotification({
      id: lead.id,
      title: lead.title,
      detail:
        incoming.length > 1 ? `${lead.detail} (+${incoming.length - 1} more unread)` : lead.detail,
      urgent: lead.kind === "alert",
    });
  }, [announceNotification, notes]);

  useEffect(() => {
    const onNotify = (event: Event) => {
      announceNotification((event as CustomEvent<NotifyEventDetail>).detail ?? {});
    };
    window.addEventListener("sauti:notify", onNotify);
    return () => window.removeEventListener("sauti:notify", onNotify);
  }, [announceNotification]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    syncOnline();

    let batteryManager: BatteryManagerLike | null = null;
    let detachBatteryListeners = () => {};

    (navigator as NavigatorWithBattery)
      .getBattery?.()
      .then((manager) => {
        batteryManager = manager;
        const updateBattery = () => {
          setBattery({
            level: manager.level,
            charging: manager.charging,
          });
        };

        updateBattery();
        manager.addEventListener("levelchange", updateBattery);
        manager.addEventListener("chargingchange", updateBattery);
        detachBatteryListeners = () => {
          manager.removeEventListener("levelchange", updateBattery);
          manager.removeEventListener("chargingchange", updateBattery);
        };
      })
      .catch(() => {
        setBattery({ level: null, charging: false });
      });

    return () => {
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
      detachBatteryListeners();
      batteryManager = null;
    };
  }, []);

  const bellTone =
    pulse === "alert"
      ? "text-destructive animate-[shake_0.4s_ease-in-out_infinite]"
      : pulse === "info"
        ? "text-primary animate-pulse"
        : "text-foreground";

  const timeLabel = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateLabel = now.toLocaleDateString([], {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const renderEntry = (entry: Entry, closeOnSelect = false) => {
    const Icon = entry.icon;
    const active = entry.section
      ? activeSection === entry.section
      : path === entry.to || (entry.to !== "/" && path.startsWith(entry.to + "/"));

    return (
      <Link
        key={entry.id}
        to={entry.to}
        onClick={closeOnSelect ? () => setMobileNavOpen(false) : undefined}
        className={`group relative flex items-center gap-3 rounded-sm border px-3 py-3 text-sm transition-all duration-200 ${
          active
            ? "border-primary/25 bg-white/[0.035] font-medium text-foreground shadow-[inset_0_0_0_1px_rgba(45,212,191,0.08)]"
            : "border-transparent text-sidebar-foreground/60 hover:border-white/10 hover:bg-white/[0.03] hover:text-sidebar-accent-foreground"
        }`}
      >
        <span
          className={`absolute inset-y-2 left-0 w-px transition-opacity ${active ? "bg-primary opacity-100 shadow-[0_0_14px_rgba(45,212,191,0.55)]" : "bg-white/20 opacity-0 group-hover:opacity-100"}`}
        />
        <Icon
          className={`h-4 w-4 transition-colors ${active ? "text-primary" : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground/80"}`}
        />
        <span className="flex-1">{entry.label}</span>
        {entry.id === "comms" && unreadComms > 0 && (
          <span className="data-readout grid h-[18px] min-w-[18px] place-items-center rounded-sm border border-destructive/30 bg-destructive/[0.08] px-1 text-[10px] text-destructive">
            {unreadComms}
          </span>
        )}
        {entry.id === "lending" && pendingCount > 0 && (
          <span className="data-readout grid h-[18px] min-w-[18px] place-items-center rounded-sm border border-warning/30 bg-warning/[0.08] px-1 text-[10px] text-warning">
            {pendingCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <header className="mobile-safe-top relative overflow-hidden border-b border-white/8 px-4 pb-4 sm:px-6 lg:px-8">
      <style>{`@keyframes shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}`}</style>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/16 to-transparent" />

      <div className="flex w-full flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-sm border border-white/10 bg-white/[0.03] text-foreground transition-colors hover:border-white/18 hover:bg-white/[0.05] md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/40">
              <span>Microfinance command</span>
              <span
                className={`telemetry-dot ${isOnline ? "telemetry-dot-online" : "telemetry-dot-offline"}`}
              />
              <span className="data-readout text-[10px] text-white/55">
                {isOnline ? "link stable" : "sync offline"}
              </span>
            </div>
            <h1 className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-[2rem]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground sm:text-[0.95rem]">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 xl:w-auto xl:items-end">
          <div className="hidden h-11 w-full max-w-sm items-center gap-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 text-sm text-muted-foreground lg:flex xl:w-[22rem]">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              placeholder="Search members, loans, refs..."
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex flex-wrap items-stretch justify-end gap-3">
            <div className="surface-panel flex min-w-0 items-center gap-3 rounded-sm px-3 py-2.5">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-white/38">Local</div>
                <div className="data-readout text-xs text-foreground">{timeLabel}</div>
                <div className="text-[11px] text-muted-foreground">{dateLabel}</div>
              </div>
              <div className="hidden h-6 w-px bg-white/10 sm:block" />
              <div className="flex items-center gap-2">
                <span
                  className={`telemetry-dot ${isOnline ? "telemetry-dot-online" : "telemetry-dot-offline"}`}
                />
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/38">Sync</div>
                  <div className="data-readout text-xs text-foreground">
                    {isOnline ? "ONLINE" : "HOLD"}
                  </div>
                </div>
              </div>
              <div className="hidden h-6 w-px bg-white/10 sm:block" />
              <div className="hidden sm:block">
                <BatteryGlyph level={battery.level} charging={battery.charging} />
              </div>
            </div>

            <div className="surface-panel flex min-w-0 items-center gap-3 rounded-sm px-3 py-2.5">
              <div className="relative">
                <button
                  onClick={() => setOpen((value) => !value)}
                  className={`relative grid h-10 w-10 place-items-center rounded-sm border transition-colors ${
                    pulse === "alert"
                      ? "border-destructive/30 bg-destructive/[0.08]"
                      : pulse === "info"
                        ? "border-primary/30 bg-primary/[0.08]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]"
                  }`}
                >
                  <Bell className={`h-4 w-4 transition-colors ${bellTone}`} />
                  {notes.length > 0 && (
                    <span className="data-readout absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-sm border border-destructive/30 bg-destructive/90 px-1 py-0.5 text-[10px] text-destructive-foreground">
                      {notes.length}
                    </span>
                  )}
                </button>
                {open && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="surface-panel absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-sm">
                      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        <span>Notifications / {notes.length}</span>
                        {notes.length > 0 && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              markRead(notes.map((note) => note.id));
                            }}
                            className="normal-case tracking-normal text-primary hover:underline"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>
                      {notes.length === 0 && (
                        <div className="p-4 text-sm text-muted-foreground">All clear.</div>
                      )}
                      {notes.map((note) => (
                        <Link
                          key={note.id}
                          to={note.href ?? "/"}
                          onClick={() => {
                            markRead(note.id);
                            setOpen(false);
                          }}
                          className="block border-b border-white/6 px-4 py-3 last:border-0 hover:bg-white/[0.03]"
                        >
                          <div className="flex gap-3">
                            <span
                              className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                                note.kind === "alert"
                                  ? "bg-destructive shadow-[0_0_10px_rgba(251,113,133,0.55)]"
                                  : note.kind === "warning"
                                    ? "bg-warning shadow-[0_0_10px_rgba(245,185,66,0.45)]"
                                    : "bg-primary shadow-[0_0_10px_rgba(45,212,191,0.55)]"
                              }`}
                            />
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">
                                {note.title}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {note.detail}
                              </div>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="hidden h-6 w-px bg-white/10 sm:block" />

              <div className="flex min-w-0 items-center gap-2.5">
                {currentUser.photo ? (
                  <img
                    src={currentUser.photo}
                    alt={currentUser.name}
                    className="h-10 w-10 rounded-sm border border-white/10 object-cover"
                  />
                ) : (
                  <div className="grid h-10 w-10 place-items-center rounded-sm border border-primary/25 bg-primary/[0.08] text-xs font-semibold text-primary">
                    {currentUser.name
                      .split(" ")
                      .map((name) => name[0])
                      .slice(0, 2)
                      .join("")}
                  </div>
                )}
                <div className="hidden min-w-0 sm:block">
                  <div className="truncate text-sm font-medium text-foreground">
                    {currentUser.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {roleLabel(currentUser.role)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {mobileNavOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="md:hidden fixed inset-0 z-[100] bg-black/65"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="mobile-safe-top md:hidden fixed left-0 top-0 bottom-0 z-[101] flex w-[18rem] flex-col border-r border-sidebar-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_16%),rgba(2,7,18,0.98)] text-sidebar-foreground">
              <div className="border-b border-sidebar-border px-4 pb-4">
                <div className="surface-panel rounded-sm p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={logoUrl}
                        alt="Sauti logo"
                        className="h-10 w-10 rounded-sm object-contain bg-white/95 p-0.5"
                      />
                      <div>
                        <div className="font-display text-base font-semibold leading-tight text-foreground">
                          Sauti Microfinance
                        </div>
                        <div className="text-[9px] uppercase tracking-[0.22em] text-sidebar-foreground/55">
                          Menu
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setMobileNavOpen(false)}
                      className="grid h-8 w-8 place-items-center rounded-sm border border-white/10 bg-white/[0.03] hover:border-white/18 hover:bg-white/[0.05]"
                    >
                      <IconX className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
                {entries.map((entry) => renderEntry(entry, true))}
              </nav>
            </aside>
          </>,
          document.body,
        )}
    </header>
  );
}
