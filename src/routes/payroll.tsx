import { useEffect, useMemo, useState } from "react";

import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { DollarSign, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/SectionTabs";
import { Badge, Section, StatCard } from "@/components/ui-bits";
import {
  getSystemCashSummaryRecord,
  listStaffPayrollPayments,
  listStaffPayrollProfiles,
  requestStaffPayrollPayoutRecord,
  upsertStaffPayrollProfileRecord,
} from "@/lib/payroll.functions";
import {
  payableSalaryFromAttendance,
  payrollMonthWindow,
  previousPayrollMonth,
} from "@/lib/payroll";
import { fmtKES, roleLabel, useStore } from "@/lib/store";

type PayrollProfile = {
  staffId: string;
  baseSalary: number;
  payoutPhone?: string;
  notes?: string;
};

type PayrollPayment = {
  id: string;
  staffId: string;
  periodStart: string;
  periodEnd: string;
  baseSalary: number;
  workDays: number;
  presentDays: number;
  payableAmount: number;
  paidAmount: number;
  payoutMode?: "gross_payable" | "base_salary";
  status: string;
  requestedAt?: string;
  paidAt?: string;
};

export const Route = createFileRoute("/payroll")({
  head: () => ({ meta: [{ title: "Payroll - Sauti Microfinance" }] }),
  component: PayrollPage,
});

function PayrollPage() {
  const { currentUser, staff, attendance } = useStore();
  const loadProfiles = useServerFn(listStaffPayrollProfiles);
  const loadPayments = useServerFn(listStaffPayrollPayments);
  const saveProfile = useServerFn(upsertStaffPayrollProfileRecord);
  const requestPayout = useServerFn(requestStaffPayrollPayoutRecord);
  const loadCashSummary = useServerFn(getSystemCashSummaryRecord);
  const [month, setMonth] = useState(previousPayrollMonth);
  const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
  const [payments, setPayments] = useState<PayrollPayment[]>([]);
  const [cashSummary, setCashSummary] = useState<{
    inflow: number;
    outflow: number;
    pending: number;
    available: number;
  } | null>(null);
  const [savingStaffId, setSavingStaffId] = useState<string | null>(null);
  const [payingStaffId, setPayingStaffId] = useState<string | null>(null);
  const [payoutMode, setPayoutMode] = useState<"gross_payable" | "base_salary">("gross_payable");

  const period = useMemo(() => payrollMonthWindow(month), [month]);

  async function refresh() {
    const [nextProfiles, nextPayments, nextCashSummary] = await Promise.all([
      loadProfiles(),
      loadPayments(),
      loadCashSummary(),
    ]);
    setProfiles(nextProfiles as PayrollProfile[]);
    setPayments(nextPayments as PayrollPayment[]);
    setCashSummary(
      nextCashSummary as { inflow: number; outflow: number; pending: number; available: number },
    );
  }

  useEffect(() => {
    refresh().catch((error: any) => {
      toast.error(error?.message ?? "Failed to load payroll data.");
    });
  }, []);

  const paymentsForMonth = useMemo(
    () =>
      payments.filter(
        (payment) => payment.periodStart === period.start && payment.periodEnd === period.end,
      ),
    [payments, period.end, period.start],
  );

  const rows = useMemo(
    () =>
      staff.map((staffMember) => {
        const profile = profiles.find((item) => item.staffId === staffMember.id);
        const alreadyPaid = paymentsForMonth
          .filter((payment) => payment.staffId === staffMember.id && payment.status === "paid")
          .reduce((sum, payment) => sum + payment.paidAmount, 0);
        const payroll = payableSalaryFromAttendance({
          baseSalary: profile?.baseSalary ?? 0,
          rows: attendance.map((row) => ({
            staffId: row.staffId,
            date: row.date,
            status: row.status,
          })),
          staffId: staffMember.id,
          start: period.start,
          end: period.end,
          alreadyPaid,
          payoutMode,
        });
        const latestPayment = paymentsForMonth.find(
          (payment) => payment.staffId === staffMember.id,
        );
        return {
          staffMember,
          profile,
          payroll,
          latestPayment,
        };
      }),
    [attendance, paymentsForMonth, payoutMode, period.end, period.start, profiles, staff],
  );

  const grossPayroll = rows.reduce((sum, row) => sum + row.payroll.grossPayable, 0);
  const targetPayroll = rows.reduce((sum, row) => sum + row.payroll.targetPayable, 0);
  const outstandingPayroll = rows.reduce((sum, row) => sum + row.payroll.outstanding, 0);

  if (currentUser.role !== "director") return <Navigate to="/" />;

  return (
    <>
      <AppHeader
        title="Payroll"
        subtitle="Director payroll desk for staff salaries, attendance-based payouts, and paybill visibility."
      />
      <main className="flex-1 space-y-6 p-6 lg:p-8">
        <SectionTabs section="admin" />

        <div className="grid gap-4 lg:grid-cols-4">
          <StatCard
            label="Payroll Month"
            value={period.month}
            icon={<DollarSign className="h-5 w-5" />}
          />
          <StatCard
            label={payoutMode === "base_salary" ? "Base Salary Payroll" : "Gross Payroll"}
            value={fmtKES(targetPayroll)}
            icon={<Wallet className="h-5 w-5" />}
            tone="accent"
            hint={
              payoutMode === "base_salary"
                ? `Attendance gross ${fmtKES(grossPayroll)}`
                : undefined
            }
          />
          <StatCard
            label="Outstanding Payroll"
            value={fmtKES(outstandingPayroll)}
            tone={outstandingPayroll > 0 ? "warning" : "success"}
          />
          <StatCard
            label="Paybill Available"
            value={fmtKES(cashSummary?.available ?? 0)}
            hint={`Pending payouts ${fmtKES(cashSummary?.pending ?? 0)}`}
            tone={(cashSummary?.available ?? 0) >= 0 ? "success" : "destructive"}
          />
        </div>

        <Section
          title="Payroll Controls"
          action={
            <button
              onClick={() => {
                refresh().catch((error: any) => {
                  toast.error(error?.message ?? "Failed to refresh payroll.");
                });
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          }
        >
          <div className="grid gap-4 p-5 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Payroll month
              </span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Payout basis
              </span>
              <select
                value={payoutMode}
                onChange={(event) =>
                  setPayoutMode(event.target.value as "gross_payable" | "base_salary")
                }
                className="mt-1 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm"
              >
                <option value="gross_payable">Gross payable</option>
                <option value="base_salary">Base salary</option>
              </select>
            </label>
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Salaries are prorated by actual signed-in working days only. Sundays are excluded from
              the divisor and from counted attendance days when gross payable is selected.
            </div>
          </div>
        </Section>

        <Section title={`Staff Payroll (${rows.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left">Staff</th>
                  <th className="px-5 py-3 text-right">Base Salary</th>
                  <th className="px-5 py-3 text-right">Work Days</th>
                  <th className="px-5 py-3 text-right">Present Days</th>
                  <th className="px-5 py-3 text-right">Gross Payable</th>
                  <th className="px-5 py-3 text-right">Already Paid</th>
                  <th className="px-5 py-3 text-right">Outstanding</th>
                  <th className="px-5 py-3 text-left">Latest Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ staffMember, profile, payroll, latestPayment }) => (
                  <tr key={staffMember.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{staffMember.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {roleLabel(staffMember.role)} · {staffMember.phone ?? "No phone"}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <input
                        type="number"
                        value={profile?.baseSalary ?? 0}
                        onChange={(event) => {
                          const nextSalary = Number(event.target.value) || 0;
                          setProfiles((current) => {
                            const existing = current.find(
                              (item) => item.staffId === staffMember.id,
                            );
                            if (existing) {
                              return current.map((item) =>
                                item.staffId === staffMember.id
                                  ? { ...item, baseSalary: nextSalary }
                                  : item,
                              );
                            }
                            return [
                              ...current,
                              { staffId: staffMember.id, baseSalary: nextSalary },
                            ];
                          });
                        }}
                        className="w-28 rounded-md border border-border bg-card px-3 py-2 text-right text-sm"
                      />
                    </td>
                    <td className="px-5 py-3 text-right">{payroll.workDays}</td>
                    <td className="px-5 py-3 text-right">{payroll.presentDays}</td>
                    <td className="px-5 py-3 text-right font-medium">
                      {fmtKES(payroll.grossPayable)}
                    </td>
                    <td className="px-5 py-3 text-right">{fmtKES(payroll.alreadyPaid)}</td>
                    <td className="px-5 py-3 text-right font-semibold">
                      {fmtKES(payroll.outstanding)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          latestPayment?.status === "paid"
                            ? "success"
                            : latestPayment?.status === "requested"
                              ? "warning"
                              : latestPayment?.status === "failed" ||
                                  latestPayment?.status === "timeout"
                                ? "destructive"
                                : "default"
                        }
                      >
                        {latestPayment?.status ?? "not paid"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          onClick={async () => {
                            try {
                              setSavingStaffId(staffMember.id);
                              await saveProfile({
                                data: {
                                  staffId: staffMember.id,
                                  baseSalary: profile?.baseSalary ?? 0,
                                },
                              });
                              await refresh();
                              toast.success("Salary saved");
                            } catch (error: any) {
                              toast.error(error?.message ?? "Failed to save salary.");
                            } finally {
                              setSavingStaffId(null);
                            }
                          }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                          disabled={savingStaffId === staffMember.id}
                        >
                          {savingStaffId === staffMember.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              setPayingStaffId(staffMember.id);
                              await requestPayout({
                                data: {
                                  staffId: staffMember.id,
                                  month: period.month,
                                  payoutMode,
                                },
                              });
                              await refresh();
                              toast.success("Payroll payout requested");
                            } catch (error: any) {
                              toast.error(error?.message ?? "Failed to request payroll payout.");
                            } finally {
                              setPayingStaffId(null);
                            }
                          }}
                          disabled={
                            payingStaffId === staffMember.id ||
                            payroll.outstanding <= 0 ||
                            !(staffMember.phone || profile?.payoutPhone)
                          }
                          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                        >
                          {payingStaffId === staffMember.id ? "Paying..." : "Pay"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </>
  );
}
