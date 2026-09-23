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

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MIN_APP_DATE = "2000-01-01";
export const MAX_RANGE_DAYS = 366;

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function isISODate(value: string): boolean {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

export function parseISODate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  return isISODate(raw) ? raw : "";
}

export function daysInclusive(start: string, end: string): number {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const from = Date.UTC(startYear, startMonth - 1, startDay);
  const to = Date.UTC(endYear, endMonth - 1, endDay);
  return Math.floor((to - from) / 86_400_000) + 1;
}

export function enumerateDaysISO(start: string, end: string): string[] {
  const from = parseISODate(start);
  const to = parseISODate(end);
  if (!from || !to || from > to) return from ? [from] : [];
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    days.push(cursor);
    cursor = addDaysISO(cursor, 1);
    if (days.length > MAX_RANGE_DAYS) break;
  }
  return days;
}

export function addMonthsISO(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + months, 1, 12, 0, 0));
  const last = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0, 12, 0, 0)).getUTCDate();
  return `${cursor.getUTCFullYear()}-${padDatePart(cursor.getUTCMonth() + 1)}-${padDatePart(Math.min(day, last))}`;
}

export function startOfMonthISO(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonthISO(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  return `${year}-${padDatePart(month)}-${padDatePart(last)}`;
}

export function monthWindows(start: string, end: string): { start: string; end: string }[] {
  const from = parseISODate(start);
  const to = parseISODate(end);
  if (!from || !to || from > to) return [];
  const windows: { start: string; end: string }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const monthEnd = endOfMonthISO(cursor);
    const sliceEnd = monthEnd < to ? monthEnd : to;
    windows.push({ start: cursor, end: sliceEnd });
    cursor = addDaysISO(sliceEnd, 1);
  }
  return windows;
}

export function startOfWeekMonday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return addDaysISO(iso, weekday === 0 ? -6 : 1 - weekday);
}


export function startOfWeekSunday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return addDaysISO(iso, -weekday);
}

export function endOfWeekSaturday(iso: string): string {
  return addDaysISO(startOfWeekSunday(iso), 6);
}

export function normalizeDateRange(
  startRaw: string,
  endRaw: string,
  today = isoDateInZone(),
): { start: string; end: string } {
  const safeToday = parseISODate(today) || isoDateInZone();
  let start = parseISODate(startRaw);
  let end = parseISODate(endRaw);
  if (!start && !end) return { start: safeToday, end: safeToday };
  if (!start) start = end || safeToday;
  if (!end) end = start;
  if (start > end) {
    const swap = start;
    start = end;
    end = swap;
  }
  // Allow short future calendar windows (week/month presets) without runaway picks.
  const softFutureCap = addDaysISO(safeToday, 40);
  if (end > softFutureCap) end = softFutureCap;
  if (start > end) start = end;
  if (start < MIN_APP_DATE) start = MIN_APP_DATE;
  if (daysInclusive(start, end) > MAX_RANGE_DAYS) {
    start = addDaysISO(end, -(MAX_RANGE_DAYS - 1));
  }
  return { start, end };
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
