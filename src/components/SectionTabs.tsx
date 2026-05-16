import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import {
  Banknote,
  ShieldCheck,
  Users,
  Building2,
  PiggyBank,
  PieChart,
  ArrowLeftRight,
  Wallet,
  MessageSquare,
  StickyNote,
  Inbox,
  UserCog,
  Receipt,
  CalendarCheck,
  FileBarChart,
  BookOpen,
} from "lucide-react";

export type Tab = { to: string; label: string; icon: ComponentType<{ className?: string }> };

/** Sub-pages of each main sidebar group. The sidebar shows ONLY the group entry;
 *  the tabs render at the top of every page in the group so users can switch
 *  between sub-pages in-page (not by expanding the sidebar). */
export const SECTION_TABS: Record<string, Tab[]> = {
  lending: [
    { to: "/loans", label: "Loans", icon: Banknote },
    { to: "/approvals", label: "Approvals", icon: ShieldCheck },
  ],
  members: [
    { to: "/members", label: "Members", icon: Users },
    { to: "/investors", label: "Investors", icon: Building2 },
  ],
  capital: [
    { to: "/savings", label: "Savings", icon: PiggyBank },
    { to: "/shares", label: "Shares", icon: PieChart },
    { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    { to: "/pettycash", label: "Petty Cash", icon: Wallet },
  ],
  comms: [
    { to: "/staff", label: "Chat", icon: MessageSquare },
    { to: "/memos", label: "Memos", icon: StickyNote },
    { to: "/support-inbox", label: "Member Support", icon: Inbox },
  ],
  admin: [
    { to: "/staff-mgmt", label: "Staff Management", icon: UserCog },
    { to: "/fees-policy", label: "Fees Policy", icon: Receipt },
    { to: "/attendance", label: "Attendance", icon: CalendarCheck },
    { to: "/reports", label: "Reports", icon: FileBarChart },
    { to: "/policies", label: "SBC Policies", icon: BookOpen },
  ],
};

/** Maps a path → which section it belongs to, so the sidebar can highlight
 *  the correct top-level entry no matter which sub-page is open. */
export function sectionForPath(path: string): string | null {
  for (const [id, tabs] of Object.entries(SECTION_TABS)) {
    if (tabs.some((t) => path === t.to || path.startsWith(t.to + "/"))) return id;
  }
  return null;
}

export function SectionTabs({ section }: { section: keyof typeof SECTION_TABS }) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const tabs = SECTION_TABS[section];
  if (!tabs) return null;
  return (
    <div className="surface-panel mb-5 flex flex-wrap items-center gap-2 rounded-sm p-1.5">
      {tabs.map((t) => {
        const active = path === t.to || path.startsWith(t.to + "/");
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`inline-flex items-center gap-2 rounded-sm border px-3.5 py-2 text-sm transition-all duration-200 ${
              active
                ? "border-primary/35 bg-primary/[0.08] font-medium text-primary shadow-[0_0_18px_rgba(45,212,191,0.08)]"
                : "border-transparent text-muted-foreground hover:border-white/10 hover:bg-white/[0.03] hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
