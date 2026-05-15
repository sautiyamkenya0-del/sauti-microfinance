import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Section, Badge, StatCard } from "@/components/ui-bits";
import { useStore, roleLabel } from "@/lib/store";
import { CalendarCheck } from "lucide-react";

export const Route = createFileRoute("/attendance")({
  head: () => ({ meta: [{ title: "Attendance — Sauti Microfinance" }] }),
  component: AttPage,
});

function AttPage() {
  const { attendance, staff } = useStore();
  const dates = Array.from(new Set(attendance.map((a) => a.date)))
    .sort()
    .reverse();

  const today = dates[0];
  const todayRecords = attendance.filter((a) => a.date === today);
  const presentToday = todayRecords.filter((a) => a.status === "present").length;

  return (
    <>
      <AppHeader title="Attendance" subtitle="Daily staff check-in record." />
      <main className="flex-1 p-6 lg:p-8 space-y-6">
        <SectionTabs section="admin" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
          <StatCard label="Days Tracked" value={dates.length} tone="accent" />
        </div>

        <Section title="Roster">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3 text-left">Staff</th>
                  <th className="px-5 py-3 text-left">Role</th>
                  {dates.slice(0, 7).map((d) => (
                    <th key={d} className="px-3 py-3 text-center text-[10px]">
                      {d.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{roleLabel(s.role)}</td>
                    {dates.slice(0, 7).map((d) => {
                      const a = attendance.find((x) => x.staffId === s.id && x.date === d);
                      const tone =
                        a?.status === "present"
                          ? "success"
                          : a?.status === "late"
                            ? "warning"
                            : "destructive";
                      return (
                        <td key={d} className="px-3 py-3 text-center">
                          {a ? (
                            <Badge tone={tone}>
                              {a.status === "present" ? "P" : a.status === "late" ? "L" : "A"}
                            </Badge>
                          ) : (
                            "—"
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
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {todayRecords.map((a) => {
                const s = staff.find((x) => x.id === a.staffId);
                return (
                  <tr key={a.id}>
                    <td className="px-5 py-3 font-medium">{s?.name}</td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          a.status === "present"
                            ? "success"
                            : a.status === "late"
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {a.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{a.checkIn ?? "—"}</td>
                    <td className="px-5 py-3 text-muted-foreground">{a.checkOut ?? "—"}</td>
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
