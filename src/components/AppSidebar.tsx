import { useMemo, useRef } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Banknote,
  Users,
  Sparkles,
  IdCard,
  LogOut,
  MessageSquare,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import { useStore, navForUser, roleLabel } from "@/lib/store";
import { useUnreadChatCount } from "@/lib/notifications";
import { useApprovals } from "@/lib/approvals";
import { sectionForPath } from "@/components/SectionTabs";
import logo from "@/assets/sauti-logo.png";

/** 8 flat top-level entries. Sub-pages live as in-page tabs (see SectionTabs)
 *  so the sidebar never expands. `requires` lists which legacy nav-keys the
 *  user must have access to for the entry to appear. */
type Entry = {
  id: string;
  to: string;
  label: string;
  icon: any;
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
  const unreadChat = useUnreadChatCount();
  const { pendingCount } = useApprovals();
  const allowed = useMemo(() => new Set(navForUser(currentUser)), [currentUser]);
  const activeSection = sectionForPath(path);
  const entries = ENTRIES.filter((e) => e.requires.some((k) => allowed.has(k)));

  // 🔐 Hidden door: tap the logo 5 times within 3s → /secret-keys (director-only page).
  const tapsRef = useRef<{ count: number; first: number }>({ count: 0, first: 0 });
  function onLogoTap() {
    const now = Date.now();
    const t = tapsRef.current;
    if (now - t.first > 3000) {
      t.count = 0;
      t.first = now;
    }
    t.count += 1;
    if (t.count >= 5) {
      tapsRef.current = { count: 0, first: 0 };
      if (currentUser.role === "director") navigate({ to: "/secret-keys" });
    }
  }

  const renderEntry = (e: Entry) => {
    const Icon = e.icon;
    const active = e.section
      ? activeSection === e.section
      : path === e.to || (e.to !== "/" && path.startsWith(e.to + "/"));
    // Show a subtle badge when the section contains unread chat / pending approvals.
    const showChatBadge = e.id === "comms" && unreadChat > 0;
    const showApprovalBadge = e.id === "lending" && pendingCount > 0;
    return (
      <Link
        key={e.id}
        to={e.to}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
          active
            ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{e.label}</span>
        {showChatBadge && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center animate-pulse">
            {unreadChat}
          </span>
        )}
        {showApprovalBadge && (
          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-bold grid place-items-center">
            {pendingCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-sidebar-border">
        <button
          onClick={onLogoTap}
          className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label="Logo"
          title=""
        >
          <img
            src={logo}
            alt="Sauti Business Community"
            className="h-12 w-12 rounded-full bg-white/95 p-0.5 ring-1 ring-sidebar-border"
          />
        </button>
        <div>
          <div className="font-display text-base font-semibold leading-tight">
            Sauti Microfinance
          </div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/60">
            Amplifying the Voice of Business
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">{entries.map(renderEntry)}</nav>

      <div className="border-t border-sidebar-border p-3 space-y-2">
        <div className="px-1">
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
            Signed in
          </div>
          <div className="text-sm font-medium truncate">{currentUser.name}</div>
          <div className="text-[11px] text-sidebar-foreground/60">
            {roleLabel(currentUser.role)}
            {currentUser.canMarkAttendance ? " · Attendance" : ""}
          </div>
        </div>
        <button
          onClick={() => {
            logout();
            router.navigate({ to: "/login" });
          }}
          className="w-full inline-flex items-center justify-center gap-2 bg-sidebar-accent text-sidebar-accent-foreground text-sm rounded-md px-2 py-2 border border-sidebar-border hover:bg-sidebar-accent/80"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );
}
