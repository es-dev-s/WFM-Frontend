export const APP_TIMEZONE = "Asia/Kathmandu";

export function isoDateInZone(
  date = new Date(),
  timeZone = APP_TIMEZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  const y = next.getUTCFullYear();
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function greetingInZone(timeZone = APP_TIMEZONE): string {
  const hour = Number.parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
    10,
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function formatInstantMs(
  ms: number,
  timeZone = APP_TIMEZONE,
): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function formatDisplayDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
  );
}

export function formatRangeLabel(start: string, end: string): string {
  if (!start || !end) return "Choose dates";
  if (start === end) return formatDisplayDate(start);

  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const startDate = new Date(Date.UTC(sy, sm - 1, sd, 12, 0, 0));
  const endDate = new Date(Date.UTC(ey, em - 1, ed, 12, 0, 0));

  const startMonth = startDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  const endMonth = endDate.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });

  if (sy === ey && sm === em) {
    return `${startMonth} ${sd} – ${ed}, ${ey}`;
  }
  if (sy === ey) {
    return `${startMonth} ${sd} – ${endMonth} ${ed}, ${ey}`;
  }
  return `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`;
}

export function shiftMonth(year: number, month: number, delta: number): {
  year: number;
  month: number;
} {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

export function monthCells(year: number, month: number): (string | null)[] {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 12)).getUTCDay();
  const days = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthTitle(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1, 12)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
