import { useMemo, useRef } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Banknote,
  IdCard,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import logo from "@/assets/sauti-logo.png";
import { sectionForPath } from "@/components/SectionTabs";
import { useApprovals } from "@/lib/approvals";
import { useUnreadCommunicationCount } from "@/lib/notifications";
import { navForUser, roleLabel, useStore } from "@/lib/store";

type Entry = {
  id: string;
  to: string;
  label: string;
  icon: LucideIcon;
  section?: string;
  requires: string[];
};

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

export function AppSidebar() {
  const { currentUser, logout } = useStore();
  const router = useRouter();
  const navigate = useNavigate();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const unreadComms = useUnreadCommunicationCount();
  const { pendingCount } = useApprovals();
  const allowed = useMemo(() => new Set(navForUser(currentUser)), [currentUser]);
  const activeSection = sectionForPath(path);
  const entries = ENTRIES.filter((entry) => entry.requires.some((key) => allowed.has(key)));

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
      if (currentUser.role === "director") navigate({ to: "/secret-keys" });
    }
  }

  return (
    <aside className="hidden md:flex w-[17.5rem] shrink-0 flex-col border-r border-sidebar-border bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_16%),rgba(2,7,18,0.96)] text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-5 py-5">
        <div className="surface-panel rounded-sm p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onLogoTap}
              className="shrink-0 rounded-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              aria-label="Logo"
              title=""
            >
              <img
                src={logo}
                alt="Sauti Business Community"
                className="h-12 w-12 rounded-sm bg-white/95 p-0.5 ring-1 ring-white/10"
              />
            </button>
            <div className="min-w-0">
              <div className="font-display text-base font-semibold leading-tight text-foreground">
                Sauti Microfinance
              </div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.24em] text-sidebar-foreground/55">
                Operations Command
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-sm border border-white/8 bg-white/[0.02] px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
                Access
              </div>
              <div className="mt-1 text-xs font-medium text-sidebar-foreground">
                {roleLabel(currentUser.role)}
              </div>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/[0.02] px-3 py-2">
              <div className="text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
                Mode
              </div>
              <div className="data-readout mt-1 text-xs text-sidebar-foreground">
                {currentUser.canMarkAttendance ? "ATTN+" : "CORE"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
        {entries.map((entry) => {
          const Icon = entry.icon;
          const active = entry.section
            ? activeSection === entry.section
            : path === entry.to || (entry.to !== "/" && path.startsWith(entry.to + "/"));
          const showChatBadge = entry.id === "comms" && unreadComms > 0;
          const showApprovalBadge = entry.id === "lending" && pendingCount > 0;

          return (
            <Link
              key={entry.id}
              to={entry.to}
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
              {showChatBadge && (
                <span className="data-readout grid h-[18px] min-w-[18px] place-items-center rounded-sm border border-destructive/30 bg-destructive/[0.08] px-1 text-[10px] text-destructive animate-pulse">
                  {unreadComms}
                </span>
              )}
              {showApprovalBadge && (
                <span className="data-readout grid h-[18px] min-w-[18px] place-items-center rounded-sm border border-warning/30 bg-warning/[0.08] px-1 text-[10px] text-warning">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="surface-panel rounded-sm p-3">
          <div className="px-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
              Signed in
            </div>
            <div className="mt-3 flex items-center gap-3">
              {currentUser.photo ? (
                <img
                  src={currentUser.photo}
                  alt={currentUser.name}
                  className="h-10 w-10 rounded-sm border border-sidebar-border object-cover"
                />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-sm border border-primary/25 bg-primary/[0.08] text-xs font-semibold text-primary">
                  {currentUser.name[0]}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">
                  {currentUser.name}
                </div>
                <div className="text-[11px] text-sidebar-foreground/58">
                  {roleLabel(currentUser.role)}
                  {currentUser.canMarkAttendance ? " / Attendance" : ""}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              router.navigate({ to: "/login" });
            }}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-sidebar-foreground transition-colors hover:border-white/18 hover:bg-white/[0.05]"
          >
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
