import { APP_TIMEZONE } from "@/lib/datetime";

const WORKDAY_SECONDS = 8 * 60 * 60;

export function titleStatus(value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Present / Absent / Leave — maps OnLeave, on leave, on-leave to Leave. */
export function normalizeDayStatus(value: string | undefined | null): string {
  const original = String(value ?? "").trim();
  if (!original) return "";
  const compact = original.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "present") return "Present";
  if (compact === "absent") return "Absent";
  if (compact === "leave" || compact === "onleave") return "Leave";
  if (compact === "weeklyoff" || compact === "weekoff") return "Weekly off";
  if (compact === "halfday") return "Half day";
  return titleStatus(original);
}

export function isRestStatus(value: string | undefined | null): boolean {
  const status = normalizeDayStatus(value);
  return status === "Weekly off" || status === "Leave";
}

export function sameDayStatus(value: string | undefined | null, want: string): boolean {
  const left = normalizeDayStatus(value);
  const right = normalizeDayStatus(want);
  return Boolean(left && right && left === right);
}

/** Matches Biometrics/Tivazo "Present" filters — not Half day, Leave, or in-time alone. */
export function isPresentAttendance(value: string | undefined | null): boolean {
  return normalizeDayStatus(value) === "Present";
}

export function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text;
}

export function percent(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return "0%";
  }
  const value = (numerator / denominator) * 100;
  return `${Math.round(value * 10) / 10}%`;
}

export function utilization(trackedSeconds: number, days = 1): string {
  const capacity = WORKDAY_SECONDS * Math.max(1, days);
  return percent(Math.max(0, trackedSeconds), capacity);
}

export function formatHours(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0h";
  const hours = seconds / 3600;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours * 10) / 10}h`;
}

export function averageHours(totalSeconds: number, people: number): string {
  if (!Number.isFinite(totalSeconds) || people <= 0) return "0h";
  return formatHours(totalSeconds / people);
}

/** Normalize upstream tracked durations to seconds (HH:MM:SS, seconds, or hour fractions). */
export function trackedSecondsOf(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return 0;
    const hourMatch = text.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/i);
    if (hourMatch) return Math.round(Number(hourMatch[1]) * 3600);
    if (text.includes(":")) {
      const parts = text.split(":").map(Number);
      if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
        const hours = parts[0] || 0;
        const minutes = parts[1] || 0;
        const seconds = parts[2] || 0;
        return Math.max(0, hours * 3600 + minutes * 60 + seconds);
      }
    }
    const n = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return trackedSecondsOf(n);
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Heuristics: ms clocks, fractional hours (0.5 / 8.5), or raw seconds (Tivazo default).
    if (value > 100_000) return Math.round(value / 1000);
    if (value < 1) return Math.round(value * 3600);
    if (value <= 48 && !Number.isInteger(value)) return Math.round(value * 3600);
    return Math.round(value);
  }
  return 0;
}

/** Average worked time per present person-day (salary-safe). */
export function averageWorkedHours(totalSeconds: number, presentPersonDays: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0 || presentPersonDays <= 0) return "0h";
  return formatHours(totalSeconds / presentPersonDays);
}


/** Average Biometrics door span (in→out) in hours for Present people with both punches. */
export function averageBioDoorHours(spansSeconds: number, people: number): string {
  return averageWorkedHours(spansSeconds, people);
}



export function enumerateDays(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = parseISO(start);
  const last = parseISO(end);
  if (!cursor || !last) return start ? [start] : [];
  for (let time = cursor.getTime(); time <= last.getTime(); time += 86_400_000) {
    days.push(toISO(new Date(time)));
    if (days.length > 366) break;
  }
  return days;
}

export function parseISO(iso: string): Date | null {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function toISO(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hourInZone(ms: number, timeZone: string): number {
  if (!Number.isFinite(ms) || ms <= 0) return -1;
  const hour = Number.parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ms)),
    10,
  );
  return Number.isFinite(hour) ? hour % 24 : -1;
}

export function minuteInZone(ms: number, timeZone: string): number {
  if (!Number.isFinite(ms) || ms <= 0) return -1;
  const minute = Number.parseInt(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      minute: "2-digit",
    }).format(new Date(ms)),
    10,
  );
  return Number.isFinite(minute) ? minute : -1;
}

function formatClockFromMs(ms: number, timeZone = APP_TIMEZONE): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

export function formatClock(value: string | undefined | null): string {
  const raw = dash(value);
  if (!raw) return "";
  if (/^\d{1,2}:\d{2}/.test(raw)) return raw.slice(0, 8);
  if (/^\d{12,13}$/.test(raw)) return formatClockFromMs(Number(raw));
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) || raw.includes("T")) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return formatClockFromMs(ms);
  }
  return raw;
}

export function workdaySeconds(): number {
  return WORKDAY_SECONDS;
}

export function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function isOpaqueId(value: string | undefined | null): boolean {
  const raw = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
}

export function humanLabel(value: string | undefined | null): string {
  const raw = String(value ?? "").trim();
  if (!raw || isOpaqueId(raw)) return "";
  return raw;
}

export function asBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean);
}
