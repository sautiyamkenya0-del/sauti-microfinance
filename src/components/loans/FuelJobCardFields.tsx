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
  attendantName: string;
  attendantSign: string;
  driverSign: string;
  odometerStart: number;
  odometerEnd: number;
  kmCovered: number;
  driverName: string;
  driverSignature: string;
};

export function blankFuelJobCardRows(): FuelJobCardRow[] {
  return FUEL_JOB_DAYS.map((day) => ({
    day,
    date: "",
    time: "",
    fuelType: "",
    liters: 0,
    pricePerLitre: 0,
    total: 0,
    attendantName: "",
    attendantSign: "",
    driverSign: "",
    odometerStart: 0,
    odometerEnd: 0,
    kmCovered: 0,
    driverName: "",
    driverSignature: "",
  }));
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
        totalKm: summary.totalKm + kmCovered,
      };
    },
    { totalLiters: 0, totalCost: 0, totalKm: 0 },
  );
}

export function FuelJobCardFields({
  rows,
  onChange,
}: {
  rows: FuelJobCardRow[];
  onChange: (rows: FuelJobCardRow[]) => void;
}) {
  const summary = summarizeFuelJobCardRows(rows);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Sauti Business Community</div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Weekly Fuel Consumption Job Card - Leadway Petrol Station
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border border-border bg-background/50 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Liters</div>
            <div className="font-semibold">{summary.totalLiters.toFixed(2)}</div>
          </div>
          <div className="rounded-md border border-border bg-background/50 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Cost</div>
            <div className="font-semibold">KSh {summary.totalCost.toFixed(0)}</div>
          </div>
          <div className="rounded-md border border-border bg-background/50 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">KM</div>
            <div className="font-semibold">{summary.totalKm.toFixed(0)}</div>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[980px] w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-2 text-left">Day</th>
              <th className="py-2 pr-2 text-left">Date</th>
              <th className="py-2 pr-2 text-left">Time</th>
              <th className="py-2 pr-2 text-left">Fuel Type</th>
              <th className="py-2 pr-2 text-right">Liters</th>
              <th className="py-2 pr-2 text-right">Price/Litre</th>
              <th className="py-2 pr-2 text-right">Total</th>
              <th className="py-2 pr-2 text-left">Attendant</th>
              <th className="py-2 pr-2 text-left">Driver</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={row.day}>
                <td className="py-2 pr-2 font-medium">{row.day}</td>
                <td className="py-2 pr-2">
                  <input
                    type="date"
                    value={row.date}
                    onChange={(event) => updateRow(index, "date", event.target.value)}
                    className="loan-input"
                  />
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
                    value={row.attendantName}
                    onChange={(event) => updateRow(index, "attendantName", event.target.value)}
                    className="loan-input"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={row.driverName}
                    onChange={(event) => updateRow(index, "driverName", event.target.value)}
                    className="loan-input"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[760px] w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-2 text-left">Day</th>
              <th className="py-2 pr-2 text-right">Odometer Start</th>
              <th className="py-2 pr-2 text-right">Odometer End</th>
              <th className="py-2 pr-2 text-right">KM Covered</th>
              <th className="py-2 pr-2 text-left">Driver Sign</th>
              <th className="py-2 pr-2 text-left">Attendant Sign</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => (
              <tr key={`${row.day}-usage`}>
                <td className="py-2 pr-2 font-medium">{row.day}</td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.odometerStart}
                    onChange={(event) =>
                      updateRow(index, "odometerStart", Number(event.target.value))
                    }
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.odometerEnd}
                    onChange={(event) =>
                      updateRow(index, "odometerEnd", Number(event.target.value))
                    }
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    min={0}
                    value={row.kmCovered}
                    onChange={(event) =>
                      updateRow(index, "kmCovered", Number(event.target.value))
                    }
                    className="loan-input text-right"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={row.driverSignature}
                    onChange={(event) => updateRow(index, "driverSignature", event.target.value)}
                    className="loan-input"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    value={row.attendantSign}
                    onChange={(event) => updateRow(index, "attendantSign", event.target.value)}
                    className="loan-input"
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
