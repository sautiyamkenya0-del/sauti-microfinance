import { useStore, roleLabel, navForUser } from "@/lib/store";
import { Bell, Search, Menu, X as IconX } from "lucide-react";
import { useNotifications, useUnreadChatCount } from "@/lib/notifications";
import { useApprovals } from "@/lib/approvals";
import { useReadIds } from "@/lib/read-state";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useRouterState } from "@tanstack/react-router";
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

export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { currentUser } = useStore();
  const notes = useNotifications();
  const { markRead } = useReadIds();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState<"idle" | "alert" | "info">("idle");
  const lastCountRef = useRef<number>(notes.length);
  const lastUrgentRef = useRef<number>(notes.filter((n) => n.kind === "alert").length);
  const path = useRouterState({ select: (r) => r.location.pathname });
  const activeSection = sectionForPath(path);
  const unreadChat = useUnreadChatCount();
  const { pendingCount } = useApprovals();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const allowed = useMemo(() => new Set(navForUser(currentUser)), [currentUser]);
  const entries = ENTRIES.filter((e) => e.requires.some((k) => allowed.has(k)));

  // Bell reacts to two streams:
  //   1. Notifications array growing (any new pending review / penalty / urgent alert)
  //   2. Cross-tab "sauti:notify" event fired by chat or other modules
  useEffect(() => {
    const urgent = notes.filter((n) => n.kind === "alert").length;
    const grew = notes.length > lastCountRef.current;
    const newUrgent = urgent > lastUrgentRef.current;
    if (grew || newUrgent) {
      setPulse(newUrgent ? "alert" : "info");
      try {
        const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
        const ctx = AudioCtor ? new AudioCtor() : null;
        if (!ctx) throw new Error("AudioContext unavailable");
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = newUrgent ? 660 : 880;
        g.gain.value = 0.06;
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.2);
      } catch {
        /* AudioContext blocked */
      }
      navigator.vibrate?.(newUrgent ? [180, 80, 180, 80, 180] : [120]);
      const t = setTimeout(() => setPulse("idle"), 2400);
      lastCountRef.current = notes.length;
      lastUrgentRef.current = urgent;
      return () => clearTimeout(t);
    }
    lastCountRef.current = notes.length;
    lastUrgentRef.current = urgent;
  }, [notes]);

  // Cross-tab signal from /staff chat etc.
  useEffect(() => {
    const onNotify = (e: Event) => {
      const detail = (e as CustomEvent).detail as { urgent?: boolean };
      setPulse(detail.urgent ? "alert" : "info");
      try {
        const AudioCtor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
        const ctx = AudioCtor ? new AudioCtor() : null;
        if (!ctx) throw new Error("AudioContext unavailable");
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = detail.urgent ? 660 : 880;
        g.gain.value = 0.06;
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.2);
      } catch {
        /* no-op */
      }
      navigator.vibrate?.(detail.urgent ? [180, 80, 180] : [120]);
      setTimeout(() => setPulse("idle"), 2400);
    };
    window.addEventListener("sauti:notify", onNotify);
    return () => window.removeEventListener("sauti:notify", onNotify);
  }, []);

  const bellTone =
    pulse === "alert"
      ? "text-destructive animate-[shake_0.4s_ease-in-out_infinite]"
      : pulse === "info"
        ? "text-primary animate-pulse"
        : "text-foreground";

  return (
    <header className="mobile-safe-top flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-3 sm:py-4 border-b border-border bg-card/60 backdrop-blur relative">
      <style>{`@keyframes shake{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}`}</style>
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
            placeholder="Search members, loans, refs…"
            className="bg-transparent text-sm outline-none flex-1"
          />
        </div>
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className={`relative h-9 w-9 grid place-items-center rounded-md hover:bg-muted transition-colors ${pulse === "alert" ? "bg-destructive/10" : pulse === "info" ? "bg-primary/10" : ""}`}
          >
            <Bell className={`h-4 w-4 transition-colors ${bellTone}`} />
            {notes.length > 0 && (
              <span
                className={`absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full ${pulse === "alert" ? "bg-destructive" : "bg-destructive"} text-destructive-foreground text-[10px] font-bold grid place-items-center`}
              >
                {notes.length}
              </span>
            )}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-11 w-80 max-h-96 overflow-y-auto bg-card border border-border rounded-xl shadow-lg z-50">
                <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  <span>Notifications · {notes.length}</span>
                  {notes.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead(notes.map((n) => n.id));
                      }}
                      className="text-[10px] normal-case tracking-normal text-primary hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                {notes.length === 0 && (
                  <div className="p-4 text-sm text-muted-foreground">All clear ✨</div>
                )}
                {notes.map((n) => (
                  <Link
                    key={n.id}
                    to={n.href ?? "/"}
                    onClick={() => {
                      markRead(n.id);
                      setOpen(false);
                    }}
                    className="block px-4 py-2.5 border-b border-border last:border-0 hover:bg-muted/50"
                  >
                    <div className="flex gap-2 items-start">
                      <span
                        className={`mt-1 h-2 w-2 rounded-full shrink-0 ${n.kind === "alert" ? "bg-destructive" : n.kind === "warning" ? "bg-accent" : "bg-primary"}`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{n.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{n.detail}</div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2.5 pl-3 border-l border-border">
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
          <div className="hidden sm:block">
            <div className="text-sm font-medium leading-tight">{currentUser.name}</div>
            <div className="text-xs text-muted-foreground">{roleLabel(currentUser.role)}</div>
          </div>
        </div>
      </div>

      {/* Mobile nav drawer — portaled to body to escape header's backdrop-blur stacking context */}
      {mobileNavOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              className="md:hidden fixed inset-0 z-[100] bg-black/50"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="md:hidden fixed left-0 top-0 bottom-0 z-[101] w-72 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col animate-in slide-in-from-left">
              <div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border">
                <div>
                  <div className="font-display text-base font-semibold leading-tight">
                    Sauti Microfinance
                  </div>
                  <div className="text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
                    Menu
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
                {entries.map((e) => {
                  const Icon = e.icon;
                  const active = e.section
                    ? activeSection === e.section
                    : path === e.to || (e.to !== "/" && path.startsWith(e.to + "/"));
                  return (
                    <Link
                      key={e.id}
                      to={e.to}
                      onClick={() => setMobileNavOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm ${active ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" : "text-sidebar-foreground/85 hover:bg-sidebar-accent"}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1">{e.label}</span>
                      {e.id === "comms" && unreadChat > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center">
                          {unreadChat}
                        </span>
                      )}
                      {e.id === "lending" && pendingCount > 0 && (
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
