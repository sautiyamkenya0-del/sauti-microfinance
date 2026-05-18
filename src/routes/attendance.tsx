import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import { roleLabel, useStore, type Attendance } from "@/lib/store";
import { getErrorMessage } from "@/lib/utils";

export const Route = createFileRoute("/attendance")({
  head: () => ({ meta: [{ title: "Attendance - Sauti Microfinance" }] }),
  component: AttendancePage,
});

const STATUS_LABEL: Record<Attendance["status"], string> = {
  present: "Present",
  signed_out: "Signed out",
  permission: "Absent with permission",
  absent: "Absent without permission",
  late: "Late",
};

const ROLL_CALL_LABEL: Record<Attendance["status"], string> = {
  present: "Present",
  signed_out: "Present",
  permission: "Absent with permission",
  absent: "Absent without permission",
  late: "Present",
};

const STATUS_TONE: Record<Attendance["status"], "success" | "warning" | "destructive" | "default"> =
  {
    present: "success",
    signed_out: "default",
    permission: "warning",
    absent: "destructive",
    late: "warning",
  };

function AttendancePage() {
  const { attendance, currentUser, markAttendance, staff } = useStore();
  const today = new Date().toISOString().slice(0, 10);
  const dates = Array.from(new Set([today, ...attendance.map((row) => row.date)]))
    .sort()
    .reverse();
  const recentDates = dates.slice(0, 7);

  function statusForDay(staffId: string, date: string): Attendance | undefined {
    const record = attendance.find((row) => row.staffId === staffId && row.date === date);
    if (record) return record;
    if (date < today) {
      return { id: `missing-${date}-${staffId}`, staffId, date, status: "absent" };
    }
    return undefined;
  }

  const todayRows = staff.map((member) => statusForDay(member.id, today));
  const presentToday = todayRows.filter(
    (row) => row?.status === "present" || row?.status === "signed_out",
  ).length;
  const permissionToday = todayRows.filter((row) => row?.status === "permission").length;
  const canMarkOthers =
    currentUser.role === "director" ||
    currentUser.role === "manager" ||
    currentUser.canMarkAttendance;

  async function applyStatus(staffId: string, status: Attendance["status"], when?: "in" | "out") {
    try {
      await markAttendance(staffId, status, when);
      toast.success(STATUS_LABEL[status]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Failed to update attendance"));
    }
  }

  return (
    <>
      <AppHeader
        title="Attendance"
        subtitle="Daily roll call, sign-in/out, and absence-with-permission tracking."
      />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="admin" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Staff"
            value={staff.length}
            icon={<CalendarCheck className="h-5 w-5" />}
          />
          <StatCard
            label="Present Today"
            value={`${presentToday}/${staff.length}`}
            tone="success"
          />
          <StatCard
            label="With Permission"
            value={permissionToday}
            tone={permissionToday > 0 ? "accent" : "default"}
          />
          <StatCard label="Days Tracked" value={recentDates.length} tone="accent" />
        </div>

        <Section title="Roll Call Sheet">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Staff</th>
                  <th className="px-5 py-3 text-left">Role</th>
                  {recentDates.map((date) => (
                    <th key={date} className="px-3 py-3 text-center text-[10px]">
                      {date.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staff.map((member) => (
                  <tr key={member.id}>
                    <td className="px-5 py-3 font-medium">{member.name}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {roleLabel(member.role)}
                    </td>
                    {recentDates.map((date) => {
                      const row = statusForDay(member.id, date);
                      return (
                        <td key={date} className="px-3 py-3 text-center">
                          {row ? (
                            <Badge tone={STATUS_TONE[row.status]}>
                              {ROLL_CALL_LABEL[row.status]}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">Pending</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`Today · ${today}`}>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left">Staff</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Check-in</th>
                <th className="px-5 py-3 text-left">Check-out</th>
                <th className="px-5 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {staff.map((member) => {
                const row = statusForDay(member.id, today);
                return (
                  <tr key={member.id}>
                    <td className="px-5 py-3 font-medium">{member.name}</td>
                    <td className="px-5 py-3">
                      {row ? (
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{row?.checkIn ?? "-"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{row?.checkOut ?? "-"}</td>
                    {(member.id === currentUser.id || canMarkOthers) && (
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => applyStatus(member.id, "present", "in")}
                            className="px-2.5 py-1 rounded-md text-xs bg-success/15 text-success hover:bg-success/25"
                          >
                            Signed in
                          </button>
                          <button
                            onClick={() => applyStatus(member.id, "signed_out", "out")}
                            className="px-2.5 py-1 rounded-md text-xs bg-muted hover:bg-accent"
                          >
                            Signed out
                          </button>
                          <button
                            onClick={() => applyStatus(member.id, "permission")}
                            className="px-2.5 py-1 rounded-md text-xs bg-warning/15 text-warning-foreground hover:bg-warning/25"
                          >
                            Asked for permission
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      </main>
    </>
  );
}
