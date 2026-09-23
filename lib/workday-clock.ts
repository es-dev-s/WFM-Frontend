import type { DailyLogRow, DashboardRosterPerson } from "@/lib/api";
import { createIdentityIndex, identityCanonical } from "@/lib/identity";
import { isRestStatus, normalizeDayStatus, trackedSecondsOf } from "@/lib/server/metrics";

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
  date: string;
  inLabel: string;
  outLabel: string;
  inMinutes: number | null;
  outMinutes: number | null;
  arrival: ArrivalStatus;
  departure: DepartureStatus;
  sources: Array<"bio" | "tivazo">;
  /** Matches Biometrics/Tivazo Present cards (status Present, punch fallback). */
  bioPresent: boolean;
  tivazoPresent: boolean;
  bioInLabel: string;
  bioOutLabel: string;
  tivazoInLabel: string;
  tivazoOutLabel: string;
  bioArrival: ArrivalStatus;
  bioDeparture: DepartureStatus;
  tivazoArrival: ArrivalStatus;
  tivazoDeparture: DepartureStatus;
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

export type ClockGapTone = "same" | "later" | "earlier" | "missing";

export type ClockGap = {
  minutes: number | null;
  signed: number | null;
  label: string;
  note: string;
  tone: ClockGapTone;
  fromLabel: string;
  toLabel: string;
};

export function parseClockMinutes(label: string): number | null {
  return parseMinutes(label);
}

/** Prefer tracked seconds; else a completed in→out span (either source). Null = still in / unknown. */
export function completedWorkSeconds(input: {
  tracked?: unknown;
  trackedAlt?: unknown;
  inTime?: string;
  outTime?: string;
  inTimeAlt?: string;
  outTimeAlt?: string;
}): number | null {
  const tracked = trackedSecondsOf(input.tracked) || trackedSecondsOf(input.trackedAlt);
  if (tracked > 0) return tracked;

  const candidates: Array<[string, string]> = [
    [String(input.inTime || "").trim(), String(input.outTime || "").trim()],
    [String(input.inTimeAlt || "").trim(), String(input.outTimeAlt || "").trim()],
  ];
  for (const [inn, out] of candidates) {
    const a = parseClockMinutes(inn);
    const b = parseClockMinutes(out);
    if (a == null || b == null) continue;
    let span = b - a;
    if (span < 0) span += 24 * 60;
    if (span > 0) return span * 60;
  }
  return null;
}



export function signedPunchDelta(from: number, to: number): number {
  return wrapSignedMinutes(from, to);
}

function wrapSignedMinutes(from: number, to: number): number {
  let delta = to - from;
  if (delta > 720) delta -= 1440;
  if (delta < -720) delta += 1440;
  return delta;
}

export function formatClockDuration(totalMinutes: number, signed = false): string {
  const rounded = Math.round(totalMinutes);
  const abs = Math.abs(rounded);
  if (abs === 0) return "0 min";
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const body = hours === 0 ? `${minutes} min` : minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  if (!signed) return body;
  return rounded > 0 ? `+${body}` : `−${body}`;
}

export function sourceInLabel(row: DashboardRosterPerson | undefined, source: "bio" | "tivazo"): string {
  if (!row) return "";
  return source === "bio"
    ? String(row.startTime || "").trim()
    : String(row.clockedIn || row.startTime || "").trim();
}

export function bioToTivazoInGap(
  bio?: DashboardRosterPerson,
  tivazo?: DashboardRosterPerson,
): ClockGap {
  const fromLabel = sourceInLabel(bio, "bio");
  const toLabel = sourceInLabel(tivazo, "tivazo");
  const from = parseMinutes(fromLabel);
  const to = parseMinutes(toLabel);
  if (from == null || to == null) {
    const note = !bio
      ? "No Bio record"
      : !tivazo
        ? "No Tivazo record"
        : from == null
          ? "Bio in-time missing"
          : "Tivazo in-time missing";
    return {
      minutes: null,
      signed: null,
      label: "—",
      note,
      tone: "missing",
      fromLabel,
      toLabel,
    };
  }
  const signed = wrapSignedMinutes(from, to);
  if (signed === 0) {
    return {
      minutes: 0,
      signed: 0,
      label: "0 min",
      note: "Same in-time",
      tone: "same",
      fromLabel,
      toLabel,
    };
  }
  return {
    minutes: Math.abs(signed),
    signed,
    label: formatClockDuration(signed, true),
    note: signed > 0 ? "Tivazo after Bio" : "Tivazo before Bio",
    tone: signed > 0 ? "later" : "earlier",
    fromLabel,
    toLabel,
  };
}

export function medianSignedMinutes(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseMinutes(label: string): number | null {
  const text = label.trim();
  if (!text || text === "—") return null;
  const match = text.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?/i);
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

function personDayKey(row: DashboardRosterPerson): string {
  const who = personKey(row);
  const date = row.date?.trim();
  return date ? `${who}|${date}` : who;
}

export function rosterPunchMinutes(
  row: DashboardRosterPerson,
  which: "in" | "out",
): number | null {
  return which === "in" ? bestIn(row) : bestOut(row);
}

export function rowIsToday(row: DashboardRosterPerson, todayDate: string, undatedIsToday = false): boolean {
  if (row.date?.trim()) return row.date.trim() === todayDate;
  return undatedIsToday;
}

function teamOf(row: DashboardRosterPerson): string {
  return row.teams.find((value) => value && value !== "unassigned") || "Unassigned";
}

function stillOnShift(row: DashboardRosterPerson, today: boolean): boolean {
  if (!today || row.source !== "tivazo") return false;
  const status = row.status.trim().toLowerCase();
  return status === "active" || status === "tracking" || status === "idle";
}

function recordedOut(row: DashboardRosterPerson): number | null {
  return parseMinutes(row.endTime) ?? parseMinutes(row.lastScreenshot);
}

function confirmedCheckout(
  row: DashboardRosterPerson,
  today: boolean,
  inn: number | null,
  out: number | null,
): boolean {
  if (out == null) return false;
  if (stillOnShift(row, today)) return false;
  if (row.source !== "tivazo") return true;
  if (inn != null) {
    let span = out - inn;
    if (span < 0) span += 1440;
    if (today && span < MIN_SHIFT_MINUTES) return false;
  }
  if (today && out < TODAY_CHECKOUT_AFTER) return false;
  return true;
}

function bestIn(row: DashboardRosterPerson): number | null {
  const times = [row.startTime, row.clockedIn].map(parseMinutes).filter((value): value is number => value != null);
  return times.length ? Math.min(...times) : null;
}

function bestOut(row: DashboardRosterPerson): number | null {
  return recordedOut(row);
}

/** Salary-safe Present: status Present only; Half day/Leave/Absent excluded; empty status falls back to in-punch. */
function rowCountsPresent(row: DashboardRosterPerson): boolean {
  const status = normalizeDayStatus(row.attendance);
  if (status === "Present") return true;
  if (status === "Half day" || status === "Leave" || status === "Absent") return false;
  if (status && isRestStatus(row.attendance)) return false;
  return bestIn(row) != null;
}

export function workdayPresentOn(
  person: WorkdayPerson,
  source: "all" | "bio" | "tivazo" = "all",
): boolean {
  if (source === "bio") return person.bioPresent;
  if (source === "tivazo") return person.tivazoPresent;
  return person.bioPresent || person.tivazoPresent;
}

export function uniqueWorkdayPeople(people: WorkdayPerson[]): WorkdayPerson[] {
  const map = new Map<string, WorkdayPerson>();
  const idToKey = new Map<string, string>();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    const id = person.id.trim().toLowerCase();
    const name = person.name.trim().toLowerCase();
    let key = email || id || name;
    if (!key) continue;
    // Collapse id-only rows into an earlier email-keyed row for the same id.
    if (!email && id && idToKey.has(id)) key = idToKey.get(id)!;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, person);
      if (id) idToKey.set(id, key);
      continue;
    }
    // Prefer the row that already carries Present / richer punches.
    const prevPresent = prev.bioPresent || prev.tivazoPresent;
    const nextPresent = person.bioPresent || person.tivazoPresent;
    if ((!prevPresent && nextPresent) || (!prev.email && person.email)) {
      map.set(key, {
        ...prev,
        ...person,
        email: person.email || prev.email,
        id: prev.id || person.id,
        bioPresent: prev.bioPresent || person.bioPresent,
        tivazoPresent: prev.tivazoPresent || person.tivazoPresent,
        sources: Array.from(new Set([...prev.sources, ...person.sources])),
      });
    }
    if (id) idToKey.set(id, key);
  }
  return [...map.values()];
}

function pickName(current: string | undefined, next: string): string {
  const left = current?.trim() || "";
  const right = next.trim();
  if (!left || left === "Unknown") return right || "Unknown";
  if (!right || right === "Unknown") return left;
  return left.length >= right.length ? left : right;
}

function pickMinutes(
  left: number | null | undefined,
  right: number | null,
  mode: "min" | "max",
): number | null {
  const values = [left, right].filter((value): value is number => value != null);
  if (!values.length) return null;
  return mode === "min" ? Math.min(...values) : Math.max(...values);
}

function arrivalOf(minutes: number | null): ArrivalStatus {
  if (minutes == null) return "missing";
  return minutes > LATE_AFTER_MIN ? "late" : "on-time";
}

function departureOf(minutes: number | null, pending: boolean): DepartureStatus {
  if (pending) return "pending";
  if (minutes == null) return "missing";
  return minutes < WORKDAY_END_MIN ? "early" : "on-time";
}

function clockLabel(minutes: number | null): string {
  return minutes == null ? "—" : formatMinutes(minutes);
}

type WorkdayDraft = {
  id: string;
  name: string;
  email: string;
  team: string;
  designation: string;
  date: string;
  inMinutes: number | null;
  outMinutes: number | null;
  bioInMinutes: number | null;
  bioOutMinutes: number | null;
  tivazoInMinutes: number | null;
  tivazoOutMinutes: number | null;
  bioConfirmed: boolean;
  tivazoConfirmed: boolean;
  bioPresent: boolean;
  tivazoPresent: boolean;
  sources: Array<"bio" | "tivazo">;
};

export function workdayKey(person: { email: string; id: string; date?: string }): string {
  return `${person.email.trim().toLowerCase() || person.id}|${person.date || ""}`;
}

export function mergeWorkdayPeople(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  today: boolean | string,
): WorkdayPerson[] {
  const todayDate = typeof today === "string" ? today : "";
  const forceToday = today === true;
  const map = new Map<string, WorkdayDraft>();
  const index = createIdentityIndex([...bio, ...tivazo]);

  const add = (row: DashboardRosterPerson) => {
    const who = identityCanonical(index, row) || personKey(row);
    if (!who) return;
    // Weekly off / rest stay on the roster as Not present so Present + Not present == group Total.
    const resting = isRestStatus(row.attendance);
    const date = row.date?.trim();
    const key = date ? `${who}|${date}` : who;
    const prev = map.get(key);
    const rowToday = forceToday || rowIsToday(row, todayDate, false);
    const inMinutes = resting ? null : bestIn(row);
    const outMinutes = resting ? null : bestOut(row);
    const confirmed = resting ? false : confirmedCheckout(row, rowToday, inMinutes, outMinutes);
    const next: WorkdayDraft = {
      id: prev?.id || row.id || who,
      name: pickName(prev?.name, row.name),
      email: prev?.email || row.email,
      team: prev?.team && prev.team !== "Unassigned" ? prev.team : teamOf(row),
      designation: prev?.designation || row.designation || "",
      date: prev?.date || row.date || "",
      inMinutes: pickMinutes(prev?.inMinutes, inMinutes, "min"),
      outMinutes: pickMinutes(prev?.outMinutes, outMinutes, "max"),
      bioInMinutes: prev?.bioInMinutes ?? null,
      bioOutMinutes: prev?.bioOutMinutes ?? null,
      tivazoInMinutes: prev?.tivazoInMinutes ?? null,
      tivazoOutMinutes: prev?.tivazoOutMinutes ?? null,
      bioConfirmed: prev?.bioConfirmed ?? false,
      tivazoConfirmed: prev?.tivazoConfirmed ?? false,
      bioPresent: prev?.bioPresent ?? false,
      tivazoPresent: prev?.tivazoPresent ?? false,
      sources: prev ? [...prev.sources] : [],
    };
    if (row.source === "bio") {
      next.bioInMinutes = pickMinutes(prev?.bioInMinutes, inMinutes, "min");
      next.bioOutMinutes = pickMinutes(prev?.bioOutMinutes, outMinutes, "max");
      next.bioConfirmed = Boolean(prev?.bioConfirmed) || confirmed;
      next.bioPresent = Boolean(prev?.bioPresent) || (!resting && rowCountsPresent(row));
    } else {
      next.tivazoInMinutes = pickMinutes(prev?.tivazoInMinutes, inMinutes, "min");
      next.tivazoOutMinutes = pickMinutes(prev?.tivazoOutMinutes, outMinutes, "max");
      next.tivazoConfirmed = Boolean(prev?.tivazoConfirmed) || confirmed;
      next.tivazoPresent = Boolean(prev?.tivazoPresent) || (!resting && rowCountsPresent(row));
    }
    if (!next.sources.includes(row.source)) next.sources.push(row.source);
    map.set(key, next);
  };

  for (const row of [...bio, ...tivazo]) add(row);

  return [...map.values()]
    .map((person) => {
      const todayRow = forceToday || Boolean(todayDate && person.date === todayDate);
      const confirmed = person.bioConfirmed || person.tivazoConfirmed;
      return {
        id: person.id,
        name: person.name,
        email: person.email,
        team: person.team,
        designation: person.designation,
        date: person.date,
        inMinutes: person.inMinutes,
        outMinutes: person.outMinutes,
        inLabel: clockLabel(person.inMinutes),
        outLabel: clockLabel(person.outMinutes),
        arrival: arrivalOf(person.inMinutes),
        departure: departureOf(person.outMinutes, todayRow && !confirmed),
        sources: person.sources,
        bioPresent: person.bioPresent,
        tivazoPresent: person.tivazoPresent,
        bioInLabel: clockLabel(person.bioInMinutes),
        bioOutLabel: clockLabel(person.bioOutMinutes),
        tivazoInLabel: clockLabel(person.tivazoInMinutes),
        tivazoOutLabel: clockLabel(person.tivazoOutMinutes),
        bioArrival: arrivalOf(person.bioInMinutes),
        bioDeparture: departureOf(person.bioOutMinutes, todayRow && person.sources.includes("bio") && !person.bioConfirmed),
        tivazoArrival: arrivalOf(person.tivazoInMinutes),
        tivazoDeparture: departureOf(
          person.tivazoOutMinutes,
          todayRow && person.sources.includes("tivazo") && !person.tivazoConfirmed,
        ),
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
    date: row.date || row.rawDate || "",
  };
}

function medianMinutes(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function averageWorkdayTimes(people: WorkdayPerson[]): { inTime: string; outTime: string } {
  const ins = people
    .map((person) => person.inMinutes)
    .filter((value): value is number => value != null);
  // Pending / unconfirmed outs (common on live Tivazo screenshots) must not skew "typical out".
  const outs = people
    .filter((person) => person.departure !== "pending" && person.outMinutes != null)
    .map((person) => person.outMinutes as number);
  const inMedian = medianMinutes(ins);
  const outMedian = medianMinutes(outs);
  return {
    inTime: inMedian == null ? "—" : formatMinutes(inMedian),
    outTime: outMedian == null ? "—" : formatMinutes(outMedian),
  };
}

export function presentPeople(
  people: WorkdayPerson[],
  source: "all" | "bio" | "tivazo" = "all",
): WorkdayPerson[] {
  return people.filter((person) => workdayPresentOn(person, source));
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

export function clockLabelMinutes(label: string): number | null {
  return parseMinutes(label);
}

export function sourcePunchMinutes(
  person: WorkdayPerson,
  source: "all" | "bio" | "tivazo",
  kind: "in" | "out",
): number | null {
  if (source === "bio") return parseMinutes(kind === "in" ? person.bioInLabel : person.bioOutLabel);
  if (source === "tivazo") return parseMinutes(kind === "in" ? person.tivazoInLabel : person.tivazoOutLabel);
  return kind === "in" ? person.inMinutes : person.outMinutes;
}

export type PresenceHeatLevel = 0 | 1 | 2 | 3 | 4;

export function presenceHeatLevel(
  minutes: number | null,
  kind: "in" | "out",
  pending = false,
): PresenceHeatLevel {
  if (kind === "in") {
    if (minutes == null) return 0;
    if (minutes <= LATE_AFTER_MIN) return 4;
    if (minutes <= 8 * 60) return 3;
    if (minutes <= 9 * 60) return 2;
    return 1;
  }
  if (pending) return 3;
  if (minutes == null) return 0;
  if (minutes >= WORKDAY_END_MIN) return 4;
  if (minutes >= 14 * 60) return 3;
  if (minutes >= 12 * 60) return 2;
  return 1;
}

export function peopleForFocus(
  people: WorkdayPerson[],
  focus: ClockInsFocus,
  source: "all" | "bio" | "tivazo" = "all",
): WorkdayPerson[] {
  const present = people.filter((person) => workdayPresentOn(person, source));
  if (focus === "present") return present;
  if (focus === "on-time") return present.filter((person) => person.arrival === "on-time");
  if (focus === "late") return present.filter((person) => person.arrival === "late");
  if (focus === "early") {
    return present.filter((person) => person.departure === "early");
  }
  if (focus === "full-day") {
    return present.filter(
      (person) => person.arrival === "on-time" && person.departure === "on-time",
    );
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
