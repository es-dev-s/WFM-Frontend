import type { DailyLogRow, DashboardRosterPerson } from "@/lib/api";

export const WORKDAY_START_MIN = 7 * 60;
export const LATE_AFTER_MIN = 7 * 60 + 15;
export const WORKDAY_END_MIN = 15 * 60;
export const SLOT_MINUTES = 15;
const MIN_SHIFT_MINUTES = 3 * 60;
const TODAY_CHECKOUT_AFTER = 12 * 60;

export type ArrivalStatus = "on-time" | "late" | "missing";
export type DepartureStatus = "on-time" | "early" | "pending" | "missing";
export type ClockInsFocus =
  | "present"
  | "on-time"
  | "late"
  | "early"
  | "full-day"
  | { kind: "in" | "out"; slot: number };

export type WorkdayPerson = {
  id: string;
  name: string;
  email: string;
  team: string;
  designation: string;
  inLabel: string;
  outLabel: string;
  inMinutes: number | null;
  outMinutes: number | null;
  arrival: ArrivalStatus;
  departure: DepartureStatus;
  sources: Array<"bio" | "tivazo">;
};

export type ClockSlot = {
  minutes: number;
  label: string;
  hourLabel: string;
  onTime: number;
  late: number;
  early: number;
  total: number;
};

function parseMinutes(label: string): number | null {
  const text = label.trim();
  if (!text || text === "—") return null;
  const match = text.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "PM" && hour !== 12) {
    hour += 12;
  }
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

export function formatMinutes(total: number): string {
  const dayMod = ((Math.round(total) % 1440) + 1440) % 1440;
  const hour = Math.floor(dayMod / 60);
  const minute = dayMod % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function slotLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  if (hour === 0) return `12:${String(minute).padStart(2, "0")} AM`;
  if (hour < 12) return `${hour}:${String(minute).padStart(2, "0")} AM`;
  if (hour === 12) return `12:${String(minute).padStart(2, "0")} PM`;
  return `${hour - 12}:${String(minute).padStart(2, "0")} PM`;
}

function compactHour(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

function personKey(row: DashboardRosterPerson): string {
  return row.email.trim().toLowerCase() || row.id;
}

function teamOf(row: DashboardRosterPerson): string {
  return row.teams.find((value) => value && value !== "unassigned") || "Unassigned";
}

function stillOnShift(row: DashboardRosterPerson, today: boolean): boolean {
  if (!today || row.source !== "tivazo") return false;
  const status = row.status.trim().toLowerCase();
  return status === "active" || status === "tracking" || status === "idle";
}

function bestIn(row: DashboardRosterPerson): number | null {
  const times = [row.startTime, row.clockedIn].map(parseMinutes).filter((value): value is number => value != null);
  return times.length ? Math.min(...times) : null;
}

function bestOut(row: DashboardRosterPerson, today: boolean): number | null {
  if (stillOnShift(row, today)) return null;
  const out = parseMinutes(row.endTime) ?? parseMinutes(row.lastScreenshot);
  if (out == null) return null;
  const inn = bestIn(row);
  if (inn != null) {
    let span = out - inn;
    if (span < 0) span += 1440;
    if (row.source === "tivazo" && span < MIN_SHIFT_MINUTES) return null;
  }
  if (row.source === "tivazo" && today && out < TODAY_CHECKOUT_AFTER) return null;
  return out;
}

function pickName(current: string | undefined, next: string): string {
  const left = current?.trim() || "";
  const right = next.trim();
  if (!left || left === "Unknown") return right || "Unknown";
  if (!right || right === "Unknown") return left;
  return left.length >= right.length ? left : right;
}

export function mergeWorkdayPeople(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  today: boolean,
): WorkdayPerson[] {
  const map = new Map<string, WorkdayPerson>();

  const add = (row: DashboardRosterPerson) => {
    const key = personKey(row);
    if (!key) return;
    const prev = map.get(key);
    const inMinutes = bestIn(row);
    const outMinutes = bestOut(row, today);
    const next: WorkdayPerson = {
      id: prev?.id || row.id || key,
      name: pickName(prev?.name, row.name),
      email: prev?.email || row.email,
      team: prev?.team && prev.team !== "Unassigned" ? prev.team : teamOf(row),
      designation: prev?.designation || row.designation || "",
      inMinutes: [prev?.inMinutes, inMinutes].filter((value): value is number => value != null).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY),
      outMinutes: [prev?.outMinutes, outMinutes].filter((value): value is number => value != null).reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY),
      inLabel: "",
      outLabel: "",
      arrival: "missing",
      departure: "missing",
      sources: prev ? [...prev.sources] : [],
    };
    if (next.inMinutes === Number.POSITIVE_INFINITY) next.inMinutes = null;
    if (next.outMinutes === Number.NEGATIVE_INFINITY) next.outMinutes = null;
    if (!next.sources.includes(row.source)) next.sources.push(row.source);
    map.set(key, next);
  };

  for (const row of [...bio, ...tivazo]) add(row);

  return [...map.values()]
    .map((person) => {
      const arrival: ArrivalStatus =
        person.inMinutes == null ? "missing" : person.inMinutes > LATE_AFTER_MIN ? "late" : "on-time";
      const departure: DepartureStatus =
        person.outMinutes == null
          ? today
            ? "pending"
            : "missing"
          : person.outMinutes < WORKDAY_END_MIN
            ? "early"
            : "on-time";
      return {
        ...person,
        inLabel: person.inMinutes == null ? "—" : formatMinutes(person.inMinutes),
        outLabel: person.outMinutes == null ? "—" : formatMinutes(person.outMinutes),
        arrival,
        departure,
      };
    })
    .sort((left, right) => {
      if ((left.inMinutes ?? 9999) !== (right.inMinutes ?? 9999)) {
        return (left.inMinutes ?? 9999) - (right.inMinutes ?? 9999);
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
}

export function dailyLogToRoster(row: DailyLogRow, source: "bio" | "tivazo"): DashboardRosterPerson {
  return {
    source,
    id: row.memberId || row.employeeId || row.id,
    email: row.email,
    name: row.name,
    teams: [row.group, ...row.groups].filter(Boolean),
    department: row.group,
    groups: row.groups,
    attendance: row.status,
    status: row.userStatus,
    startTime: row.inTime,
    endTime: row.outTime,
    clockedIn: row.inTime,
    lastScreenshot: row.outTime,
    trackedSeconds: 0,
    trackedLabel: row.trackedTime,
    designation: row.designation,
    joinDate: "",
  };
}

export function presentPeople(people: WorkdayPerson[]): WorkdayPerson[] {
  return people.filter((person) => person.inMinutes != null || person.arrival !== "missing");
}

export function workdaySlots(): number[] {
  const slots: number[] = [];
  for (let minutes = WORKDAY_START_MIN; minutes <= WORKDAY_END_MIN; minutes += SLOT_MINUTES) {
    slots.push(minutes);
  }
  return slots;
}

export function slotFor(minutes: number): number {
  if (minutes < WORKDAY_START_MIN) return WORKDAY_START_MIN;
  if (minutes >= WORKDAY_END_MIN) return WORKDAY_END_MIN;
  return WORKDAY_START_MIN + Math.floor((minutes - WORKDAY_START_MIN) / SLOT_MINUTES) * SLOT_MINUTES;
}

export function buildClockSlots(people: WorkdayPerson[], kind: "in" | "out"): ClockSlot[] {
  return workdaySlots().map((minutes) => {
    const members = people.filter((person) => {
      const value = kind === "in" ? person.inMinutes : person.outMinutes;
      return value != null && slotFor(value) === minutes;
    });
    const onTime = members.filter((person) =>
      kind === "in" ? person.arrival === "on-time" : person.departure === "on-time",
    ).length;
    const late = kind === "in" ? members.filter((person) => person.arrival === "late").length : 0;
    const early = kind === "out" ? members.filter((person) => person.departure === "early").length : 0;
    return {
      minutes,
      label: formatMinutes(minutes),
      hourLabel: minutes % 60 === 0 ? compactHour(minutes) : "",
      onTime,
      late,
      early,
      total: members.length,
    };
  });
}

export function peopleForFocus(people: WorkdayPerson[], focus: ClockInsFocus): WorkdayPerson[] {
  if (focus === "present") return people.filter((person) => person.inMinutes != null);
  if (focus === "on-time") return people.filter((person) => person.arrival === "on-time");
  if (focus === "late") return people.filter((person) => person.arrival === "late");
  if (focus === "early") return people.filter((person) => person.departure === "early");
  if (focus === "full-day") {
    return people.filter((person) => person.arrival !== "missing" && person.departure === "on-time");
  }
  return people.filter((person) => {
    const value = focus.kind === "in" ? person.inMinutes : person.outMinutes;
    return value != null && slotFor(value) === focus.slot;
  });
}

export function focusTitle(focus: ClockInsFocus): string {
  if (focus === "present") return "Present";
  if (focus === "on-time") return "On time";
  if (focus === "late") return "Late in";
  if (focus === "early") return "Left early";
  if (focus === "full-day") return "Stayed till 3:00";
  return `${focus.kind === "in" ? "Clock-in" : "Check-out"} ${slotLabel(focus.slot)}`;
}
