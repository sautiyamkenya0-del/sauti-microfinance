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
  HandCoins,
  Landmark,
} from "lucide-react";
import { navForUser, useStore } from "@/lib/store";

export type Tab = { to: string; label: string; icon: ComponentType<{ className?: string }> };

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
    { to: "/withdrawals", label: "Withdrawals", icon: Landmark },
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
    { to: "/payroll", label: "Payroll", icon: HandCoins },
    { to: "/fees-policy", label: "Policy Center", icon: Receipt },
    { to: "/attendance", label: "Attendance", icon: CalendarCheck },
    { to: "/reports", label: "Reports", icon: FileBarChart },
    { to: "/policies", label: "SBC Policies", icon: BookOpen },
  ],
};

const TAB_REQUIREMENTS: Record<string, string> = {
  "/staff-mgmt": "staffmgmt",
  "/payroll": "payroll",
  "/fees-policy": "fees",
  "/attendance": "attendance",
  "/reports": "reports",
  "/policies": "policies",
  "/investors": "investors",
};

const LITE_SECTION_TABS: Partial<Record<keyof typeof SECTION_TABS, string[]>> = {
  lending: ["/loans"],
  members: ["/members"],
  capital: ["/transactions"],
  comms: ["/staff"],
  admin: ["/reports"],
};

export function sectionForPath(path: string): string | null {
  for (const [id, tabs] of Object.entries(SECTION_TABS)) {
    if (tabs.some((t) => path === t.to || path.startsWith(t.to + "/"))) return id;
  }
  return null;
}

export function SectionTabs({ section }: { section: keyof typeof SECTION_TABS }) {
  const { currentUser, appMode } = useStore();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const allowed = new Set(navForUser(currentUser));
  const tabs = SECTION_TABS[section]?.filter((tab) => {
    const required = TAB_REQUIREMENTS[tab.to];
    const visibleInMode = appMode !== "lite" || (LITE_SECTION_TABS[section] ?? []).includes(tab.to);
    return visibleInMode && (!required || allowed.has(required));
  });
  if (!tabs) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = path === t.to || path.startsWith(t.to + "/");
        const Icon = t.icon;
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-t-md border-b-2 -mb-px transition-colors ${
              active
                ? "border-primary text-primary font-medium bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </div>
  );
}
