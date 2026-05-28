const FUEL_JOB_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type FuelJobCardRow = {
  day: string;
  date: string;
  time: string;
  fuelType: string;
  liters: number;
  pricePerLitre: number;
  total: number;
  fuelCharge: number;
  attendantName: string;
  odometerReading: number;
  /** @deprecated Old signature fields are kept so existing saved payloads still hydrate safely. */
  attendantSign: string;
  /** @deprecated Old signature fields are kept so existing saved payloads still hydrate safely. */
  driverSign: string;
  /** @deprecated Use odometerReading for new refill rows. */
  odometerStart: number;
  /** @deprecated Use odometerReading for new refill rows. */
  odometerEnd: number;
  /** @deprecated Kept for old weekly job-card payloads. */
  kmCovered: number;
  /** @deprecated Replaced by attendantName plus profile-linked vehicle details. */
  driverName: string;
  /** @deprecated Old signature fields are kept so existing saved payloads still hydrate safely. */
  driverSignature: string;
};

function blankFuelJobCardRow(index: number): FuelJobCardRow {
  return {
    day: FUEL_JOB_DAYS[index % FUEL_JOB_DAYS.length] ?? `Entry ${index + 1}`,
    date: "",
    time: "",
    fuelType: "",
    liters: 0,
    pricePerLitre: 0,
    total: 0,
    fuelCharge: 0,
    attendantName: "",
    odometerReading: 0,
    attendantSign: "",
    driverSign: "",
    odometerStart: 0,
    odometerEnd: 0,
    kmCovered: 0,
    driverName: "",
    driverSignature: "",
  };
}

function numericValue(value: unknown) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? Math.max(0, next) : 0;
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

export function blankFuelJobCardRows(count = 1): FuelJobCardRow[] {
  return Array.from({ length: Math.max(1, Math.floor(Number(count) || 1)) }, (_, index) =>
    blankFuelJobCardRow(index),
  );
}

export function normalizeFuelJobCardRows(value: unknown, fallbackCount = 1): FuelJobCardRow[] {
  const source = Array.isArray(value) ? value : [];
  if (source.length === 0) return blankFuelJobCardRows(fallbackCount);
  return source.map((row, index) => {
    const typed = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const blank = blankFuelJobCardRow(index);
    const liters = numericValue(typed.liters ?? typed.litres);
    const pricePerLitre = numericValue(typed.pricePerLitre ?? typed.pricePerLiter);
    const computedTotal = liters * pricePerLitre;
    const total = numericValue(typed.total) || computedTotal;
    return {
      ...blank,
      day: textValue(typed.day) || blank.day,
      date: textValue(typed.date),
      time: textValue(typed.time),
      fuelType: textValue(typed.fuelType),
      liters,
      pricePerLitre,
      total,
      fuelCharge: numericValue(typed.fuelCharge ?? typed.charge),
      attendantName: textValue(typed.attendantName),
      odometerReading: numericValue(typed.odometerReading ?? typed.odometer),
      attendantSign: textValue(typed.attendantSign),
      driverSign: textValue(typed.driverSign),
      odometerStart: numericValue(typed.odometerStart),
      odometerEnd: numericValue(typed.odometerEnd),
      kmCovered: numericValue(typed.kmCovered),
      driverName: textValue(typed.driverName),
      driverSignature: textValue(typed.driverSignature),
    };
  });
}

export function resizeFuelJobCardRows(rows: FuelJobCardRow[], countValue: number) {
  const count = Math.max(1, Math.floor(Number(countValue) || 1));
  const normalized = normalizeFuelJobCardRows(rows, count);
  return Array.from(
    { length: count },
    (_, index) => normalized[index] ?? blankFuelJobCardRow(index),
  );
}

export function fuelEntryDayLabel(row: Pick<FuelJobCardRow, "date" | "day">, index = 0) {
  if (row.date) {
    const value = new Date(`${row.date}T00:00:00`);
    if (!Number.isNaN(value.getTime())) {
      return value.toLocaleDateString(undefined, { weekday: "long" });
    }
  }
  return row.day || `Entry ${index + 1}`;
}

export function summarizeFuelJobCardRows(rows: FuelJobCardRow[]) {
  return rows.reduce(
    (summary, row) => {
      const computedTotal = Number(row.liters ?? 0) * Number(row.pricePerLitre ?? 0);
      const total = Number(row.total ?? 0) > 0 ? Number(row.total ?? 0) : computedTotal;
      const kmCovered =
        Number(row.kmCovered ?? 0) > 0
          ? Number(row.kmCovered ?? 0)
          : Math.max(0, Number(row.odometerEnd ?? 0) - Number(row.odometerStart ?? 0));
      return {
        totalLiters: summary.totalLiters + Number(row.liters ?? 0),
        totalCost: summary.totalCost + total,
        totalFuelCharge: summary.totalFuelCharge + Number(row.fuelCharge ?? 0),
        totalKm: summary.totalKm + kmCovered,
        latestOdometer: Math.max(summary.latestOdometer, Number(row.odometerReading ?? 0)),
      };
    },
    { totalLiters: 0, totalCost: 0, totalFuelCharge: 0, totalKm: 0, latestOdometer: 0 },
  );
}

export function FuelJobCardFields({
  rows,
  onChange,
}: {
  rows: FuelJobCardRow[];
  onChange: (rows: FuelJobCardRow[]) => void;
}) {
  const updateRow = <K extends keyof FuelJobCardRow>(
    index: number,
    key: K,
    value: FuelJobCardRow[K],
  ) => {
    onChange(
      rows.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const next = { ...row, [key]: value };
        if (key === "liters" || key === "pricePerLitre") {
          next.total = Number(next.liters ?? 0) * Number(next.pricePerLitre ?? 0);
        }
        if (key === "date") {
          next.day = fuelEntryDayLabel({ date: String(value ?? ""), day: row.day }, index);
        }
        if (key === "odometerStart" || key === "odometerEnd") {
          next.kmCovered = Math.max(
            0,
            Number(next.odometerEnd ?? 0) - Number(next.odometerStart ?? 0),
          );
        }
        return next;
      }),
    );
  };

  return (
    <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="overflow-x-auto">
        <table className="min-w-[1120px] w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-2 text-left">Date</th>
              <th className="py-2 pr-2 text-left">Time</th>
              <th className="py-2 pr-2 text-left">Fuel Type</th>
              <th className="py-2 pr-2 text-right">Liters</th>
              <th className="py-2 pr-2 text-right">Price/Litre (KSh)</th>
              <th className="py-2 pr-2 text-right">Total (KSh)</th>
              <th className="py-2 pr-2 text-right">Fuel Charge</th>
              <th className="py-2 pr-2 text-left">Attendant Name</th>
              <th className="py-2 pr-2 text-right">Odometer Reading</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={`${index}-${row.day}`}>
                <td className="py-2 pr-2">
                  <input
                    type="date"
                    value={row.date}
                    onChange={(event) => updateRow(index, "date", event.target.value)}
                    className="loan-input"
                  />
                  <div className="mt-1 text-[10px] font-semibold uppercase text-muted-foreground">
                    {fuelEntryDayLabel(row, index)}
                  </div>
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="time"
                    value={row.time}
                    onChange={(event) => updateRow(index, "time", event.target.value)}
                    className="loan-input"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={row.fuelType}
                    onChange={(event) => updateRow(index, "fuelType", event.target.value)}
                    className="loan-input"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.liters}
                    onChange={(event) => updateRow(index, "liters", Number(event.target.value))}
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.pricePerLitre}
                    onChange={(event) =>
                      updateRow(index, "pricePerLitre", Number(event.target.value))
                    }
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.total}
                    onChange={(event) => updateRow(index, "total", Number(event.target.value))}
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.fuelCharge}
                    onChange={(event) => updateRow(index, "fuelCharge", Number(event.target.value))}
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={row.attendantName}
                    onChange={(event) => updateRow(index, "attendantName", event.target.value)}
                    className="loan-input"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.odometerReading}
                    onChange={(event) =>
                      updateRow(index, "odometerReading", Number(event.target.value))
                    }
                    className="loan-input text-right"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
