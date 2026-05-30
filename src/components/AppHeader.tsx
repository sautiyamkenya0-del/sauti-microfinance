import { useStore, roleLabel, navForUser } from "@/lib/store";
import { Bell, ChevronDown, LogOut, Search, Menu, X as IconX } from "lucide-react";
import logoUrl from "@/assets/sauti-logo.png?url";
import { useNotifications, useUnreadCommunicationCount } from "@/lib/notifications";
import { useReadIds } from "@/lib/read-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
  Package,
  ReceiptText,
  Truck,
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

const ENTRIES: Entry[] = [
  { id: "dashboard", to: "/", label: "Dashboard", icon: LayoutDashboard, requires: ["dashboard"] },
  { id: "ai", to: "/ai", label: "SautiAI", icon: Sparkles, requires: ["ai"] },
  { id: "portal", to: "/portal", label: "Member Portal", icon: IdCard, requires: ["portal"] },
  {
    id: "supplier-portal",
    to: "/supplier-portal",
    label: "Supplier Portal",
    icon: Truck,
    requires: ["suppliers"],
  },
  { id: "suppliers", to: "/suppliers", label: "Suppliers", icon: Truck, requires: ["suppliers"] },
  { id: "stock", to: "/stock", label: "Stock", icon: Package, requires: ["stock"] },
  {
    id: "locomotive",
    to: "/locomotive",
    label: "Locomotive Admin",
    icon: ReceiptText,
    requires: ["locomotive_dashboard", "locomotive_members", "locomotive_ledger"],
  },
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
    requires: ["staffmgmt", "attendance", "policies", "reports", "fees", "payroll"],
  },
];

const LITE_ENTRY_IDS = new Set([
  "dashboard",
  "portal",
  "lending",
  "members",
  "capital",
  "comms",
  "admin",
]);

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { currentUser, loans, appMode, setAppMode, logout, authMode } = useStore();
  const navigate = useNavigate();
  const notes = useNotifications();
  const { markRead } = useReadIds();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pulse, setPulse] = useState<"idle" | "alert" | "info">("idle");
  const initializedRef = useRef(false);
  const seenNoteIdsRef = useRef(new Set<string>());
  const announcedIdsRef = useRef(new Set<string>());
  const path = useRouterState({ select: (r) => r.location.pathname });
  const activeSection = sectionForPath(path);
  const unreadComms = useUnreadCommunicationCount();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const allowed = useMemo(() => new Set(navForUser(currentUser)), [currentUser]);
  const pendingCount = loans.filter((loan) => loan.status === "pending").length;
  const entries = useMemo(
    () =>
      ENTRIES.filter((entry) => entry.requires.some((key) => allowed.has(key))).filter(
        (entry) => appMode !== "lite" || LITE_ENTRY_IDS.has(entry.id),
      ),
    [allowed, appMode],
  );
  const tapsRef = useRef<{ count: number; first: number }>({ count: 0, first: 0 });

  function onLogoTap() {
    const now = Date.now();
    const tap = tapsRef.current;
    if (now - tap.first > 3000) {
      tap.count = 0;
      tap.first = now;
    }
    tap.count += 1;
    if (tap.count >= 5) {
      tapsRef.current = { count: 0, first: 0 };
      if (currentUser.role === "director") {
        setMobileNavOpen(false);
        void navigate({ to: "/secret-keys" });
      }
    }
  }

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

  const bellTone =
    pulse === "alert"
      ? "text-destructive animate-[shake_0.4s_ease-in-out_infinite]"
      : pulse === "info"
        ? "text-primary animate-pulse"
        : "text-foreground";

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur relative px-4 pb-3 pt-0 sm:px-6 sm:pb-4 lg:px-8">
      <style>{`@keyframes shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}`}</style>
      <div className="safe-area-spacer md:hidden" />
      <div className="flex w-full flex-wrap items-center justify-between gap-4 pt-3 sm:gap-6 sm:pt-4">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden h-9 w-9 grid place-items-center rounded-md hover:bg-muted shrink-0"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl lg:text-2xl font-semibold text-foreground truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 line-clamp-1">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden lg:flex items-center gap-2 bg-muted rounded-md px-3 py-1.5 w-72">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Search members, loans, refs..."
              className="bg-transparent text-sm outline-none flex-1"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setOpen((value) => !value)}
              className={`relative h-9 w-9 grid place-items-center rounded-md hover:bg-muted transition-colors ${pulse === "alert" ? "bg-destructive/10" : pulse === "info" ? "bg-primary/10" : ""}`}
            >
              <Bell className={`h-4 w-4 transition-colors ${bellTone}`} />
              {notes.length > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center">
                  {notes.length}
                </span>
              )}
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute right-0 top-11 w-80 max-w-[calc(100vw-2rem)] max-h-96 overflow-y-auto bg-card border border-border rounded-xl shadow-lg z-50">
                  <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Notifications / {notes.length}</span>
                    {notes.length > 0 && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          markRead(notes.map((note) => note.id));
                        }}
                        className="text-[10px] normal-case tracking-normal text-primary hover:underline"
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
                      className="block px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <div className="flex gap-2 items-start">
                        <span
                          className={`mt-1 h-2 w-2 rounded-full shrink-0 ${note.kind === "alert" ? "bg-destructive" : note.kind === "warning" ? "bg-accent" : "bg-primary"}`}
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{note.title}</div>
                          <div className="text-xs text-muted-foreground truncate">
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
          <div className="relative border-l border-border pl-3">
            <button
              type="button"
              onClick={() => setProfileOpen((value) => !value)}
              className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted"
            >
              {currentUser.photo ? (
                <img
                  src={currentUser.photo}
                  alt={currentUser.name}
                  className="h-9 w-9 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs font-semibold">
                  {currentUser.name
                    .split(" ")
                    .map((name) => name[0])
                    .slice(0, 2)
                    .join("")}
                </div>
              )}
              <div className="hidden sm:block text-left">
                <div className="text-sm font-medium leading-tight">{currentUser.name}</div>
                <div className="text-xs text-muted-foreground">
                  {roleLabel(currentUser.role)} / {appMode === "lite" ? "Lite" : "Complex"}
                </div>
              </div>
              <ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" />
            </button>
            {profileOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                <div className="absolute right-0 top-12 z-50 w-64 rounded-md border border-border bg-card p-2 shadow-lg">
                  <div className="px-2 py-2">
                    <div className="text-sm font-medium">{currentUser.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {roleLabel(currentUser.role)}
                    </div>
                  </div>
                  {authMode === "staff" ? (
                    <div className="rounded-md border border-border bg-muted/30 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAppMode("lite");
                          setProfileOpen(false);
                        }}
                        className={`w-full rounded px-3 py-2 text-left text-sm ${
                          appMode === "lite"
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-background"
                        }`}
                      >
                        Lite mode
                        <span className="mt-0.5 block text-xs opacity-80">
                          Daily essentials and capital transactions.
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAppMode("complex");
                          setProfileOpen(false);
                        }}
                        className={`mt-1 w-full rounded px-3 py-2 text-left text-sm ${
                          appMode === "complex"
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-background"
                        }`}
                      >
                        Complex mode
                        <span className="mt-0.5 block text-xs opacity-80">
                          Full staff operations and admin tools.
                        </span>
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      setProfileOpen(false);
                      await logout();
                      await navigate({ to: "/login" });
                    }}
                    className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {mobileNavOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="md:hidden fixed inset-0 z-[100] bg-black/50"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="md:hidden fixed left-0 top-0 bottom-0 z-[101] w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col animate-in slide-in-from-left">
              <div className="safe-area-spacer" />
              <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
                <div className="flex items-center gap-3">
                  <button
                    onClick={onLogoTap}
                    className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50"
                    aria-label="Logo"
                    title=""
                  >
                    <img
                      src={logoUrl}
                      alt="Sauti logo"
                      className="h-12 w-12 rounded-full bg-white/95 p-0.5 ring-1 ring-sidebar-border"
                    />
                  </button>
                  <div>
                    <div className="font-display text-base font-semibold leading-tight">
                      Sauti Microfinance
                    </div>
                    <div className="text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
                      Menu
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setMobileNavOpen(false)}
                  className="h-8 w-8 grid place-items-center rounded-md hover:bg-sidebar-accent"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
                {entries.map((entry) => {
                  const Icon = entry.icon;
                  const entryTo =
                    appMode === "lite" && entry.id === "capital"
                      ? "/transactions"
                      : appMode === "lite" && entry.id === "admin"
                        ? "/reports"
                        : entry.id === "admin" && !allowed.has("staffmgmt")
                          ? "/attendance"
                          : entry.to;
                  const active = entry.section
                    ? activeSection === entry.section
                    : path === entryTo || (entryTo !== "/" && path.startsWith(entryTo + "/"));
                  return (
                    <Link
                      key={entry.id}
                      to={entryTo}
                      onClick={() => setMobileNavOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm ${active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "text-sidebar-foreground/85 hover:bg-sidebar-accent"}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1">{entry.label}</span>
                      {entry.id === "comms" && unreadComms > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center">
                          {unreadComms}
                        </span>
                      )}
                      {entry.id === "lending" && pendingCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold grid place-items-center">
                          {pendingCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </aside>
          </>,
          document.body,
        )}
    </header>
  );
}
