export type PayrollAttendanceStatus =
  | "present"
  | "late"
  | "signed_out"
  | "permission"
  | "absent";

export type PayrollAttendanceRow = {
  staffId: string;
  date: string;
  status: PayrollAttendanceStatus;
};

function toDateOnly(value: string) {
  return String(value ?? "").slice(0, 10);
}

function dateRangeInclusive(start: string, end: string) {
  const days: string[] = [];
  const cursor = new Date(`${toDateOnly(start)}T00:00:00`);
  const last = new Date(`${toDateOnly(end)}T00:00:00`);
  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function isSunday(date: string) {
  return new Date(`${toDateOnly(date)}T00:00:00`).getDay() === 0;
}

export function workingDaysExcludingSundays(start: string, end: string) {
  return dateRangeInclusive(start, end).filter((date) => !isSunday(date)).length;
}

export function attendedWorkingDays(
  rows: PayrollAttendanceRow[],
  staffId: string,
  start: string,
  end: string,
) {
  const validStatuses = new Set<PayrollAttendanceStatus>(["present", "late", "signed_out"]);
  return dateRangeInclusive(start, end).filter((date) => {
    if (isSunday(date)) return false;
    return rows.some(
      (row) =>
        row.staffId === staffId &&
        toDateOnly(row.date) === date &&
        validStatuses.has(row.status),
    );
  }).length;
}

export function payableSalaryFromAttendance(args: {
  baseSalary: number;
  rows: PayrollAttendanceRow[];
  staffId: string;
  start: string;
  end: string;
  alreadyPaid?: number;
}) {
  const baseSalary = Math.max(0, Number(args.baseSalary ?? 0));
  const workDays = workingDaysExcludingSundays(args.start, args.end);
  const presentDays = attendedWorkingDays(args.rows, args.staffId, args.start, args.end);
  const grossPayable =
    workDays > 0 ? Math.round((baseSalary * presentDays) / workDays) : 0;
  const alreadyPaid = Math.max(0, Number(args.alreadyPaid ?? 0));
  return {
    workDays,
    presentDays,
    grossPayable,
    alreadyPaid,
    outstanding: Math.max(0, grossPayable - alreadyPaid),
  };
}

export function payrollMonthWindow(month: string) {
  const [yearText, monthText] = String(month ?? "").split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const today = new Date();
    const fallbackMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    return payrollMonthWindow(fallbackMonth);
  }
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function previousPayrollMonth() {
  const now = new Date();
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}
