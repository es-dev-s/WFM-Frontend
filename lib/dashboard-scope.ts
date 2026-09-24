import type {
  AttentionItem,
  BiomaticSummary,
  CoverageGaps,
  CoveragePerson,
  DashboardMemberFocus,
  DashboardOverview,
  DashboardRosterPerson,
  FilterOption,
  HourlyPoint,
  HourlySeries,
  LeaderRow,
  PunchCompare,
  TivazoSummary,
  TrendMetric,
} from "@/lib/api";
import {
  averageWorkedHours,
  formatHours,
  isPresentAttendance,
  isRestStatus,
  normalizeDayStatus,
  percent,
  titleStatus,
  utilization,
} from "@/lib/server/metrics";
import {
  createIdentityIndex,
  identityCanonical,
  identityMatchesNeedle,
  type IdentityLike,
} from "@/lib/identity";
import {
  LATE_AFTER_MIN,
  formatMinutes,
  mergeWorkdayPeople,
  parseClockMinutes,
  rosterPunchMinutes,
  signedPunchDelta,
  type WorkdayPerson,
} from "@/lib/workday-clock";

function keyOf(person: DashboardRosterPerson): string {
  return person.email.trim().toLowerCase() || person.id;
}

function sameKey(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function inTeam(person: DashboardRosterPerson, teamId: string, teams: FilterOption[]): boolean {
  if (!teamId) return true;
  const aliases = new Set<string>([teamId.toLowerCase()]);
  for (const team of teams) {
    if (sameKey(team.id, teamId) || sameKey(team.label, teamId)) {
      aliases.add(team.id.toLowerCase());
      aliases.add(team.label.toLowerCase());
    }
  }
  return person.teams.some((value) => aliases.has(value.trim().toLowerCase()));
}

function asIdentity(person: DashboardRosterPerson): IdentityLike {
  return {
    email: person.email,
    id: person.id,
    name: person.name,
    source: person.source,
  };
}

function inMember(person: DashboardRosterPerson, memberId: string, index?: ReturnType<typeof createIdentityIndex>): boolean {
  if (!memberId) return true;
  return identityMatchesNeedle(asIdentity(person), memberId, index);
}

function isLate(start: string): boolean {
  const [hour, minute] = start.split(/[:.]/).map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  return hour > 9 || (hour === 9 && minute >= 30);
}

function recountBio(people: DashboardRosterPerson[]): BiomaticSummary {
  let present = 0;
  let absent = 0;
  let leave = 0;
  let late = 0;
  for (const row of people) {
    const attendance = normalizeDayStatus(row.attendance);
    if (attendance === "Present") {
      present += 1;
      if (isLate(row.startTime)) late += 1;
    } else if (attendance === "Leave") leave += 1;
    else if (attendance === "Absent") absent += 1;
  }
  return {
    totalMembers: people.length,
    presentMembers: present,
    absentMembers: absent,
    leaveMembers: leave,
    lateMembers: late,
  };
}

function recountTivazo(people: DashboardRosterPerson[]): TivazoSummary {
  let present = 0;
  let absent = 0;
  let tracking = 0;
  let idle = 0;
  let offline = 0;
  let tracked = 0;
  let presentDays = 0;
  for (const row of people) {
    if (isPresentAttendance(row.attendance)) {
      present += 1;
      tracked += Math.max(0, row.trackedSeconds || 0);
      const days = row.presentDays ?? 0;
      if (days > 0) presentDays += days;
      else if (row.trackedSeconds > 0) presentDays += 1;
    } else {
      absent += 1;
    }
    switch (row.status.toLowerCase()) {
      case "tracking":
      case "active":
        tracking += 1;
        break;
      case "idle":
        idle += 1;
        break;
      case "offline":
        offline += 1;
        break;
      default:
        break;
    }
  }
  return {
    totalMembers: people.length,
    activeMembers: tracking,
    idleMembers: idle,
    offlineMembers: offline,
    presentMembers: present,
    absentMembers: absent,
    avgWorkHours: averageWorkedHours(tracked, presentDays || (tracked > 0 ? present : 0)),
  };
}


function bioDoorSpanSeconds(row: DashboardRosterPerson): number {
  const inM = parseClockMinutes(row.startTime || row.clockedIn);
  const outM = parseClockMinutes(row.endTime || row.lastScreenshot);
  if (inM == null || outM == null) return 0;
  let delta = signedPunchDelta(inM, outM);
  if (delta <= 0) delta += 1440;
  if (delta <= 0 || delta > 16 * 60) return 0;
  return delta * 60;
}

/**
 * Avg Work Hour: Today = mean Present door span; multi-day = Σ daily seconds / person-days.
 * `trackedSeconds` on range rows is absolute seconds (see rosterPerson / absoluteTrackedSeconds).
 */
function averageBioDoorFromRoster(people: DashboardRosterPerson[]): string {
  let total = 0;
  let denom = 0;
  for (const row of people) {
    if (!isPresentAttendance(row.attendance)) continue;
    // Prefer presentDays (days that contributed work seconds) over attendedDays.
    const days = row.presentDays || row.attendedDays || 0;
    if (days > 1 && row.trackedSeconds > 0) {
      total += row.trackedSeconds;
      denom += days;
      continue;
    }
    const seconds = bioDoorSpanSeconds(row);
    if (seconds <= 0) continue;
    total += seconds;
    denom += 1;
  }
  return averageWorkedHours(total, denom);
}

function workSpanSeconds(inMinutes: number | null, outMinutes: number | null): number {
  if (inMinutes == null || outMinutes == null) return 0;
  let delta = outMinutes - inMinutes;
  if (delta <= 0) delta += 1440;
  if (delta <= 0 || delta > 16 * 60) return 0;
  return delta * 60;
}

/** Combined Avg Work Hour: earliest in / latest out across Bio ∪ Tivazo, one span per person.
 * Multi-day range rows: prefer Tivazo tracked/days, else Bio door-sum/days (not first→last clocks). */
function combinedWorkHoursFromRoster(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]): string {
  const people = new Map<
    string,
    {
      ins: number[];
      outs: number[];
      present: boolean;
      bioDays: number;
      tivDays: number;
      bioTracked: number;
      tivTracked: number;
    }
  >();
  const touch = (row: DashboardRosterPerson, source: "bio" | "tivazo") => {
    const key = keyOf(row);
    if (!key) return;
    const prev = people.get(key) ?? {
      ins: [],
      outs: [],
      present: false,
      bioDays: 0,
      tivDays: 0,
      bioTracked: 0,
      tivTracked: 0,
    };
    if (isPresentAttendance(row.attendance)) prev.present = true;
    const days = row.presentDays || row.attendedDays || 0;
    if (source === "bio") {
      if (days > prev.bioDays) prev.bioDays = days;
      if (row.trackedSeconds > prev.bioTracked) prev.bioTracked = row.trackedSeconds;
    } else {
      if (days > prev.tivDays) prev.tivDays = days;
      if (row.trackedSeconds > prev.tivTracked) prev.tivTracked = row.trackedSeconds;
    }
    const inPunch = punchOf(row, "in");
    const outPunch = punchOf(row, "out");
    if (inPunch) prev.ins.push(inPunch.hour * 60 + inPunch.minute);
    if (outPunch) prev.outs.push(outPunch.hour * 60 + outPunch.minute);
    people.set(key, prev);
  };
  for (const row of bio) touch(row, "bio");
  for (const row of tivazo) touch(row, "tivazo");

  let total = 0;
  let denom = 0;
  for (const row of people.values()) {
    if (!row.present) continue;
    if (row.tivDays > 1 && row.tivTracked > 0) {
      total += row.tivTracked;
      denom += row.tivDays;
      continue;
    }
    if (row.bioDays > 1 && row.bioTracked > 0) {
      total += row.bioTracked;
      denom += row.bioDays;
      continue;
    }
    if (!row.ins.length || !row.outs.length) continue;
    const seconds = workSpanSeconds(Math.min(...row.ins), Math.max(...row.outs));
    if (seconds <= 0) continue;
    total += seconds;
    denom += 1;
  }
  return averageWorkedHours(total, denom);
}

function combinedAvgClockInFromRoster(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]): string {
  let sampleSum = 0;
  let sampleCount = 0;
  const earliest = new Map<string, number>();
  const presentKeys = new Set<string>();
  const bioMap = new Map<string, DashboardRosterPerson>();
  const tivMap = new Map<string, DashboardRosterPerson>();
  for (const row of bio) {
    const key = keyOf(row);
    if (key) bioMap.set(key, row);
  }
  for (const row of tivazo) {
    const key = keyOf(row);
    if (key) tivMap.set(key, row);
  }
  for (const key of new Set([...bioMap.keys(), ...tivMap.keys()])) {
    const bioRow = bioMap.get(key);
    const tivRow = tivMap.get(key);
    const bioSamples = bioRow?.clockInSamples ?? 0;
    const tivSamples = tivRow?.clockInSamples ?? 0;
    if (tivSamples > 1 || bioSamples > 1) {
      if (tivSamples >= bioSamples && tivSamples > 0 && tivRow) {
        sampleSum += tivRow.clockInSumMinutes ?? 0;
        sampleCount += tivSamples;
      } else if (bioSamples > 0 && bioRow) {
        sampleSum += bioRow.clockInSumMinutes ?? 0;
        sampleCount += bioSamples;
      }
      continue;
    }
    if (bioRow && isPresentAttendance(bioRow.attendance)) presentKeys.add(key);
    if (tivRow && isPresentAttendance(tivRow.attendance)) presentKeys.add(key);
  }
  if (sampleCount > 0) return formatClockLabel(sampleSum / sampleCount);
  for (const row of [...bio, ...tivazo]) {
    const key = keyOf(row);
    if (!key || !presentKeys.has(key)) continue;
    const punch = punchOf(row, "in");
    if (!punch) continue;
    const minutes = punch.hour * 60 + punch.minute;
    const prev = earliest.get(key);
    if (prev == null || minutes < prev) earliest.set(key, minutes);
  }
  if (!earliest.size) return "—";
  const avg = [...earliest.values()].reduce((sum, value) => sum + value, 0) / earliest.size;
  return formatClockLabel(avg);
}

/** Single-source Avg Clock-in: mean of daily first-ins when range samples exist; else Present-row mean. */
function sourceAvgClockInFromRoster(rows: DashboardRosterPerson[]): string {
  let sampleSum = 0;
  let sampleCount = 0;
  const punches: number[] = [];
  for (const row of rows) {
    const samples = row.clockInSamples ?? 0;
    if (samples > 1 && (row.clockInSumMinutes ?? 0) > 0) {
      sampleSum += row.clockInSumMinutes ?? 0;
      sampleCount += samples;
      continue;
    }
    if (!isPresentAttendance(row.attendance)) continue;
    const punch = punchOf(row, "in");
    if (!punch) continue;
    punches.push(punch.hour * 60 + punch.minute);
  }
  if (sampleCount > 0) return formatClockLabel(sampleSum / sampleCount);
  if (!punches.length) return "—";
  const avg = punches.reduce((sum, value) => sum + value, 0) / punches.length;
  return formatClockLabel(avg);
}

/** Single-source Avg Work Hour: mean Present in→out door span (same formula Bio uses). */
function sourceWorkHoursFromRoster(rows: DashboardRosterPerson[]): string {
  return averageBioDoorFromRoster(rows);
}

function uniqueAttendance(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]) {
  const people = new Map<string, boolean>();
  for (const row of [...bio, ...tivazo]) {
    const key = keyOf(row);
    if (!key) continue;
    people.set(key, people.get(key) === true || isPresentAttendance(row.attendance));
  }
  let present = 0;
  for (const value of people.values()) if (value) present += 1;
  return { people: people.size, present };
}

/**
 * Day-weighted Avg Attendance:
 *   sum(present_person_days) / sum(expected_workdays)
 * expected = attendedDays + absentDays (Weekly off / Leave / Holiday excluded upstream).
 * Combined uses max(bio, tivazo) per person. Falls back to unique Present/Total for Today.
 */
function dayWeightedAttendance(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
): { rate: string; people: number; present: number } {
  const bioMap = new Map<string, DashboardRosterPerson>();
  const tivMap = new Map<string, DashboardRosterPerson>();
  for (const row of bio) {
    const key = keyOf(row);
    if (key) bioMap.set(key, row);
  }
  for (const row of tivazo) {
    const key = keyOf(row);
    if (key) tivMap.set(key, row);
  }
  const keys = new Set([...bioMap.keys(), ...tivMap.keys()]);
  let presentDays = 0;
  let expectedDays = 0;
  let hasDayWeights = false;
  let presentPeople = 0;
  for (const key of keys) {
    const bioRow = bioMap.get(key);
    const tivRow = tivMap.get(key);
    const bioAtt = bioRow?.attendedDays ?? 0;
    const bioAbs = bioRow?.absentDays ?? 0;
    const tivAtt = tivRow?.attendedDays ?? 0;
    const tivAbs = tivRow?.absentDays ?? 0;
    const bioExpected = bioAtt + bioAbs;
    const tivExpected = tivAtt + tivAbs;
    if (bioExpected > 0 || tivExpected > 0) {
      hasDayWeights = true;
      presentDays += Math.max(bioAtt, tivAtt);
      expectedDays += Math.max(bioExpected, tivExpected);
    }
    const flagged =
      (bioRow && isPresentAttendance(bioRow.attendance)) ||
      (tivRow && isPresentAttendance(tivRow.attendance)) ||
      bioAtt > 0 ||
      tivAtt > 0;
    if (flagged) presentPeople += 1;
  }
  if (hasDayWeights && expectedDays > 0) {
    return { rate: percent(presentDays, expectedDays), people: keys.size, present: presentPeople };
  }
  const unique = uniqueAttendance(bio, tivazo);
  return { rate: percent(unique.present, unique.people), people: unique.people, present: unique.present };
}

function parseClock(label: string): { hour: number; minute: number } | null {
  const match = label.trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return { hour, minute: Number.isFinite(minute) ? minute : 0 };
}

function punchOf(person: DashboardRosterPerson, which: "in" | "out"): { hour: number; minute: number } | null {
  if (which === "in") {
    return parseClock(person.startTime) || parseClock(person.clockedIn);
  }
  return parseClock(person.endTime) || parseClock(person.lastScreenshot);
}

function formatClockLabel(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const dayMod = ((rounded % 1440) + 1440) % 1440;
  const hour = Math.floor(dayMod / 60);
  const minute = dayMod % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function emptyHourlyPoints(): HourlyPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    value: 0,
    share: 0,
  }));
}

function buildHourly(people: DashboardRosterPerson[], which: "in" | "out"): HourlySeries {
  const points = emptyHourlyPoints();
  const totals: number[] = [];
  const firstExact = new Map<number, string>();
  for (const row of people) {
    const punch = punchOf(row, which);
    if (!punch) continue;
    const minutes = punch.hour * 60 + punch.minute;
    points[punch.hour].value += 1;
    totals.push(minutes);
    if (!firstExact.has(punch.hour)) firstExact.set(punch.hour, formatClockLabel(minutes));
  }
  const count = totals.length;
  for (const point of points) {
    point.share = count ? Math.round((point.value / count) * 1000) / 10 : 0;
    const exact = firstExact.get(point.hour);
    if (exact) point.exact = exact;
  }
  const avg = count ? totals.reduce((sum, value) => sum + value, 0) / count : 0;
  return {
    avgClockIn: count ? formatClockLabel(avg) : "—",
    people: count,
    points,
  };
}

function punchKey(person: DashboardRosterPerson, index?: ReturnType<typeof createIdentityIndex>): string {
  const who = (index ? identityCanonical(index, asIdentity(person)) : "") || keyOf(person);
  const date = person.date?.trim();
  return date ? `${who}|${date}` : who;
}

function medianOf(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDurationMinutes(totalMinutes: number): string {
  const abs = Math.abs(Math.round(totalMinutes));
  if (abs === 0) return "0 min";
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Mean absolute Bio↔Tivazo lag across check-in and check-out pair samples. */
export function avgSourceGapLabel(inGaps: number[], outGaps: number[]): string {
  const samples = [...inGaps, ...outGaps].map((value) => Math.abs(value));
  if (!samples.length) return "—";
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return formatDurationMinutes(Math.round(mean));
}

function punchMoment(values: number[]) {
  const median = medianOf(values);
  if (median == null) return { time: "—", people: 0 };
  return { time: formatMinutes(median), people: values.length };
}

function punchGap(values: number[], after: string, before: string) {
  const median = medianOf(values);
  if (median == null) return { label: "—", minutes: null, people: 0, note: "No paired punches" };
  const avg = Math.round(median);
  if (avg === 0) {
    return { label: "0 min", minutes: 0, people: values.length, note: "Same time" };
  }
  const abs = Math.abs(avg);
  return {
    label: formatDurationMinutes(abs),
    minutes: abs,
    people: values.length,
    note: avg > 0 ? after : before,
  };
}


export type PunchCompareSlot =
  | "checkIn-bio"
  | "checkIn-tivazo"
  | "checkIn-gap"
  | "checkIn-overall"
  | "checkOut-tivazo"
  | "checkOut-bio"
  | "checkOut-gap"
  | "checkOut-overall";

export type PunchCompareFocus = Record<PunchCompareSlot, DashboardRosterPerson[]>;

function workdayAsRoster(person: WorkdayPerson, source: "bio" | "tivazo"): DashboardRosterPerson {
  const present = source === "bio" ? person.bioPresent : person.tivazoPresent;
  const inLabel = source === "bio" ? person.bioInLabel : person.tivazoInLabel;
  const outLabel = source === "bio" ? person.bioOutLabel : person.tivazoOutLabel;
  return {
    source,
    id: person.id,
    email: person.email,
    name: person.name,
    teams: person.team ? [person.team] : [],
    department: person.team,
    groups: [],
    attendance: present ? "Present" : "",
    status: "",
    startTime: inLabel === "—" ? "" : inLabel,
    endTime: outLabel === "—" ? "" : outLabel,
    clockedIn: source === "tivazo" && inLabel !== "—" ? inLabel : "",
    lastScreenshot: source === "tivazo" && outLabel !== "—" ? outLabel : "",
    trackedSeconds: 0,
    trackedLabel: "",
    designation: person.designation,
    joinDate: "",
    date: person.date,
  };
}

export function emptyPunchCompareFocus(): PunchCompareFocus {
  return {
    "checkIn-bio": [],
    "checkIn-tivazo": [],
    "checkIn-gap": [],
    "checkIn-overall": [],
    "checkOut-tivazo": [],
    "checkOut-bio": [],
    "checkOut-gap": [],
    "checkOut-overall": [],
  };
}

function collapsePunches(
  rows: DashboardRosterPerson[],
): Map<string, { in: number | null; out: number | null }> {
  const index = createIdentityIndex(rows.map(asIdentity));
  const map = new Map<string, { in: number | null; out: number | null }>();
  for (const row of rows) {
    if (isRestStatus(row.attendance)) continue;
    const key = punchKey(row, index);
    if (!key) continue;
    const inn = rosterPunchMinutes(row, "in");
    const out = rosterPunchMinutes(row, "out");
    const prev = map.get(key) ?? { in: null, out: null };
    const ins = [prev.in, inn].filter((value): value is number => value != null);
    const outs = [prev.out, out].filter((value): value is number => value != null);
    map.set(key, {
      in: ins.length ? Math.min(...ins) : null,
      out: outs.length ? Math.max(...outs) : null,
    });
  }
  return map;
}


/** One WorkdayPerson per identity — earliest in / latest out across person-days (range punch cards). */
function collapseWorkdaysByPerson(people: WorkdayPerson[]): WorkdayPerson[] {
  type Acc = {
    base: WorkdayPerson;
    inMinutes: number | null;
    outMinutes: number | null;
    bioIn: number | null;
    bioOut: number | null;
    tivIn: number | null;
    tivOut: number | null;
    bioPresent: boolean;
    tivazoPresent: boolean;
  };
  const map = new Map<string, Acc>();
  const pickMin = (a: number | null, b: number | null) =>
    a == null ? b : b == null ? a : Math.min(a, b);
  const pickMax = (a: number | null, b: number | null) =>
    a == null ? b : b == null ? a : Math.max(a, b);
  for (const person of people) {
    const who =
      person.email.trim().toLowerCase() ||
      person.id.trim().toLowerCase() ||
      person.name.trim().toLowerCase();
    if (!who) continue;
    const bioIn = parseClockMinutes(person.bioInLabel);
    const bioOut = parseClockMinutes(person.bioOutLabel);
    const tivIn = parseClockMinutes(person.tivazoInLabel);
    const tivOut = parseClockMinutes(person.tivazoOutLabel);
    const prev = map.get(who);
    if (!prev) {
      map.set(who, {
        base: person,
        inMinutes: person.inMinutes,
        outMinutes: person.outMinutes,
        bioIn,
        bioOut,
        tivIn,
        tivOut,
        bioPresent: person.bioPresent,
        tivazoPresent: person.tivazoPresent,
      });
      continue;
    }
    map.set(who, {
      base: prev.base,
      inMinutes: pickMin(prev.inMinutes, person.inMinutes),
      outMinutes: pickMax(prev.outMinutes, person.outMinutes),
      bioIn: pickMin(prev.bioIn, bioIn),
      bioOut: pickMax(prev.bioOut, bioOut),
      tivIn: pickMin(prev.tivIn, tivIn),
      tivOut: pickMax(prev.tivOut, tivOut),
      bioPresent: prev.bioPresent || person.bioPresent,
      tivazoPresent: prev.tivazoPresent || person.tivazoPresent,
    });
  }
  return [...map.values()].map((row) => {
    const inMinutes = row.inMinutes;
    const outMinutes = row.outMinutes;
    return {
      ...row.base,
      date: "",
      inMinutes,
      outMinutes,
      inLabel: inMinutes == null ? "—" : formatMinutes(inMinutes),
      outLabel: outMinutes == null ? "—" : formatMinutes(outMinutes),
      bioPresent: row.bioPresent,
      tivazoPresent: row.tivazoPresent,
      bioInLabel: row.bioIn == null ? "—" : formatMinutes(row.bioIn),
      bioOutLabel: row.bioOut == null ? "—" : formatMinutes(row.bioOut),
      tivazoInLabel: row.tivIn == null ? "—" : formatMinutes(row.tivIn),
      tivazoOutLabel: row.tivOut == null ? "—" : formatMinutes(row.tivOut),
      bioArrival: row.bioIn == null ? "missing" : row.bioIn > LATE_AFTER_MIN ? "late" : "on-time",
      tivazoArrival: row.tivIn == null ? "missing" : row.tivIn > LATE_AFTER_MIN ? "late" : "on-time",
      bioDeparture:
        row.bioOut == null ? "missing" : row.bioOut < 15 * 60 ? "early" : "on-time",
      tivazoDeparture:
        row.tivOut == null ? "missing" : row.tivOut < 15 * 60 ? "early" : "on-time",
      arrival: inMinutes == null ? "missing" : inMinutes > LATE_AFTER_MIN ? "late" : "on-time",
      departure: outMinutes == null ? "missing" : outMinutes < 15 * 60 ? "early" : "on-time",
    } satisfies WorkdayPerson;
  });
}

export function buildPunchCompareBundle(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  options?: { todayDate?: string; undatedIsToday?: boolean; period?: "day" | "range" },
): { compare: PunchCompare; focus: PunchCompareFocus } {
  const period = options?.period ?? "day";
  const todayArg = options?.todayDate?.trim() || options?.undatedIsToday === true;
  // Single source of truth with chip cards: confirmed outs, rest days excluded, identity merge.
  const merged = mergeWorkdayPeople(bio, tivazo, todayArg || false);
  // Range cards + modals both list unique people (not person-day punch samples).
  const people = period === "range" ? collapseWorkdaysByPerson(merged) : merged;

  const bioIn: number[] = [];
  const tivIn: number[] = [];
  const inGaps: number[] = [];
  const inOverall: number[] = [];
  const bioOut: number[] = [];
  const tivOut: number[] = [];
  const outGaps: number[] = [];
  const outOverall: number[] = [];
  const focus = emptyPunchCompareFocus();

  for (const person of people) {
    const inBio = parseClockMinutes(person.bioInLabel);
    const inTiv = parseClockMinutes(person.tivazoInLabel);
    const outBio =
      person.bioDeparture === "pending" || person.bioDeparture === "missing"
        ? null
        : parseClockMinutes(person.bioOutLabel);
    const outTiv =
      person.tivazoDeparture === "pending" || person.tivazoDeparture === "missing"
        ? null
        : parseClockMinutes(person.tivazoOutLabel);

    if (inBio != null) {
      bioIn.push(inBio);
      focus["checkIn-bio"].push(workdayAsRoster(person, "bio"));
    }
    if (inTiv != null) {
      tivIn.push(inTiv);
      focus["checkIn-tivazo"].push(workdayAsRoster(person, "tivazo"));
    }
    // One overall in per person (earliest reliable punch), never double-count Bio+Tivazo.
    if (person.inMinutes != null) {
      inOverall.push(person.inMinutes);
      const preferred: "bio" | "tivazo" =
        inBio != null && (inTiv == null || inBio <= inTiv) ? "bio" : "tivazo";
      focus["checkIn-overall"].push(workdayAsRoster(person, preferred));
    }
    if (inBio != null && inTiv != null) {
      inGaps.push(signedPunchDelta(inBio, inTiv));
      focus["checkIn-gap"].push(workdayAsRoster(person, "bio"));
      focus["checkIn-gap"].push(workdayAsRoster(person, "tivazo"));
    }

    if (outBio != null) {
      bioOut.push(outBio);
      focus["checkOut-bio"].push(workdayAsRoster(person, "bio"));
    }
    if (outTiv != null) {
      tivOut.push(outTiv);
      focus["checkOut-tivazo"].push(workdayAsRoster(person, "tivazo"));
    }
    if (person.departure !== "pending" && person.outMinutes != null) {
      outOverall.push(person.outMinutes);
      const preferred: "bio" | "tivazo" =
        outBio != null && (outTiv == null || outBio >= outTiv) ? "bio" : "tivazo";
      focus["checkOut-overall"].push(workdayAsRoster(person, preferred));
    }
    if (outBio != null && outTiv != null) {
      outGaps.push(signedPunchDelta(outTiv, outBio));
      focus["checkOut-gap"].push(workdayAsRoster(person, "tivazo"));
      focus["checkOut-gap"].push(workdayAsRoster(person, "bio"));
    }
  }

  const outNote = period === "range" ? "No confirmed check-outs in this range" : "No confirmed check-outs for this day";
  const inNote = period === "range" ? "No check-ins in this range" : "No check-ins for this day";

  return {
    compare: {
      checkIn: {
        first: punchMoment(bioIn),
        second: punchMoment(tivIn),
        gap:
          inGaps.length === 0 && bioIn.length + tivIn.length === 0
            ? { label: "—", minutes: null, people: 0, note: inNote }
            : punchGap(inGaps, "Tivazo after Biometrics", "Tivazo before Biometrics"),
        overall: punchMoment(inOverall),
      },
      checkOut: {
        first: punchMoment(tivOut),
        second: punchMoment(bioOut),
        gap:
          outOverall.length === 0
            ? { label: "—", minutes: null, people: 0, note: outNote }
            : punchGap(outGaps, "Biometrics after Tivazo", "Biometrics before Tivazo"),
        overall: punchMoment(outOverall),
      },
      avgGap: avgSourceGapLabel(inGaps, outGaps),
    },
    focus,
  };
}

export function buildPunchCompare(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  options?: { todayDate?: string; undatedIsToday?: boolean; period?: "day" | "range" },
): PunchCompare {
  return buildPunchCompareBundle(bio, tivazo, options).compare;
}

function rankingTeam(person: DashboardRosterPerson): string {
  return person.teams.find((value) => value && value !== "unassigned") || "Unassigned";
}

function formatDayCount(days: number): string {
  const n = Math.max(0, Math.round(days));
  return n === 1 ? "1 day" : `${n} days`;
}

function rankingPresentDays(person: DashboardRosterPerson): number {
  if ((person.attendedDays ?? 0) > 0) return person.attendedDays!;
  if ((person.presentDays ?? 0) > 0) return person.presentDays!;
  return person.attendance.toLowerCase() === "present" ? 1 : 0;
}

function rankingAbsentDays(person: DashboardRosterPerson): number {
  if ((person.absentDays ?? 0) > 0) return person.absentDays!;
  return person.attendance.toLowerCase() === "present" ? 0 : 1;
}

function leaderValue(person: DashboardRosterPerson, metric: TrendMetric): string {
  const present = person.attendance.toLowerCase() === "present";
  if (metric === "present") return formatDayCount(rankingPresentDays(person));
  if (metric === "attendance") return present ? "100%" : "0%";
  return utilization(person.trackedSeconds);
}

function buildLeaderboard(people: DashboardRosterPerson[], metric: TrendMetric) {
  const ranked = [...people].sort((left, right) => {
    if (metric === "present") {
      const byDays = rankingPresentDays(right) - rankingPresentDays(left);
      if (byDays !== 0) return byDays;
    } else if (metric === "attendance") {
      const a = left.attendance.toLowerCase() === "present" ? 1 : 0;
      const b = right.attendance.toLowerCase() === "present" ? 1 : 0;
      if (b !== a) return b - a;
    }
    return right.trackedSeconds - left.trackedSeconds;
  });
  const leaders: LeaderRow[] = ranked.map((person) => {
    const present = person.attendance.toLowerCase() === "present";
    return {
      id: person.id || keyOf(person),
      name: person.name || "Unknown",
      email: person.email,
      team: rankingTeam(person),
      status: normalizeDayStatus(person.attendance) || titleStatus(person.status),
      value: leaderValue(person, metric),
      delta: "",
      positive: present,
    };
  });
  const attention: AttentionItem[] = ranked
    .filter((person) => {
      const day = normalizeDayStatus(person.attendance);
      const live = person.status.toLowerCase();
      return day !== "Present" || live === "idle" || live === "offline" || person.trackedSeconds <= 0;
    })
    .sort((left, right) => {
      if (metric === "present") {
        const byAbsent = rankingAbsentDays(right) - rankingAbsentDays(left);
        if (byAbsent !== 0) return byAbsent;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    })
    .map((person) => {
      const day = normalizeDayStatus(person.attendance);
      const live = person.status.toLowerCase();
      let reason = "Low activity";
      if (day === "Leave") reason = "On leave today";
      else if (live === "idle") reason = "Idle now";
      else if (live === "offline") reason = "Offline now";
      else if (!day || day === "Absent") reason = person.trackedSeconds > 0 ? `${formatHours(person.trackedSeconds)} tracked` : "No clock-in";
      else if (person.trackedSeconds > 0) reason = `${formatHours(person.trackedSeconds)} tracked`;
      return {
        id: person.id || keyOf(person),
        name: person.name || "Unknown",
        email: person.email,
        team: rankingTeam(person),
        status: day || titleStatus(person.status) || "Absent",
        reason,
        value:
          metric === "present"
            ? formatDayCount(rankingAbsentDays(person))
            : leaderValue(person, metric),
      };
    });
  return { leaders, attention };
}

function coveragePerson(person: DashboardRosterPerson): CoveragePerson {
  return {
    id: person.id || keyOf(person) || person.name,
    name: person.name || "Unknown",
    email: person.email,
    team: rankingTeam(person),
    status: normalizeDayStatus(person.attendance) || titleStatus(person.status),
    match: person.email ? "email" : "none",
  };
}

function buildCoverage(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  teamId: string,
  memberId: string,
  teams: FilterOption[],
  scope: string,
): CoverageGaps {
  const index = createIdentityIndex([...bio, ...tivazo].map(asIdentity));
  const bioByCanon = new Map<string, DashboardRosterPerson>();
  const tivByCanon = new Map<string, DashboardRosterPerson>();
  const bioOnly: CoveragePerson[] = [];
  const tivazoOnly: CoveragePerson[] = [];
  const linked = new Set<string>();
  const focus = (person: DashboardRosterPerson) => inTeam(person, teamId, teams) && inMember(person, memberId, index);

  for (const row of bio) {
    const key = identityCanonical(index, asIdentity(row));
    if (key) bioByCanon.set(key, row);
  }
  for (const row of tivazo) {
    const key = identityCanonical(index, asIdentity(row));
    if (key) tivByCanon.set(key, row);
  }
  for (const row of bio) {
    if (!focus(row)) continue;
    const key = identityCanonical(index, asIdentity(row));
    if (key && tivByCanon.has(key)) {
      linked.add(key);
      continue;
    }
    bioOnly.push(coveragePerson(row));
  }
  for (const row of tivazo) {
    if (!focus(row)) continue;
    const key = identityCanonical(index, asIdentity(row));
    if (key && bioByCanon.has(key)) {
      linked.add(key);
      continue;
    }
    tivazoOnly.push(coveragePerson(row));
  }
  bioOnly.sort((a, b) => a.name.localeCompare(b.name));
  tivazoOnly.sort((a, b) => a.name.localeCompare(b.name));
  return { linked: linked.size, bioOnly, tivazoOnly, scope, teamId, memberId };
}

function memberFocus(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
): DashboardMemberFocus | null {
  const tiv = tivazo[0];
  const bioRow = bio[0];
  if (!tiv && !bioRow) return null;
  const bioPresent = isPresentAttendance(bioRow?.attendance);
  const tivPresent = isPresentAttendance(tiv?.attendance);
  return {
    name: tiv?.name || bioRow?.name || "",
    email: tiv?.email || bioRow?.email || "",
    employeeId: bioRow?.id || tiv?.id || "",
    sources: [...(bioRow ? ["Biometrics"] : []), ...(tiv ? ["Tivazo"] : [])],
    biometrics: {
      day: normalizeDayStatus(bioRow?.attendance),
      inTime: bioPresent ? bioRow?.startTime || "" : "",
      outTime: bioPresent ? bioRow?.endTime || "" : "",
      department: bioRow ? rankingTeam(bioRow) : "",
      designation: bioRow?.designation || "",
      joined: bioRow?.joinDate || "",
    },
    tivazo: {
      live: tivPresent ? titleStatus(tiv?.status) : "",
      day: normalizeDayStatus(tiv?.attendance),
      inTime: tivPresent ? tiv?.clockedIn || "" : "",
      outTime: tivPresent ? tiv?.lastScreenshot || "" : "",
      tracked: tivPresent ? tiv?.trackedLabel || "" : "",
      group: tiv ? rankingTeam(tiv) : "",
      designation: tiv?.designation || "",
    },
  };
}

function scopeLabel(teamId: string, memberId: string, teams: FilterOption[], members: FilterOption[]): string {
  if (memberId) return members.find((member) => member.id === memberId)?.label || "Selected member";
  if (!teamId) return "All groups";
  return teams.find((team) => team.id === teamId)?.label || "Selected team";
}

function selectPeople(
  overview: DashboardOverview,
  teamId: string,
  memberId: string,
): { bio: DashboardRosterPerson[]; tivazo: DashboardRosterPerson[] } {
  return scopeRosterPeople(
    overview.roster?.bio ?? [],
    overview.roster?.tivazo ?? [],
    teamId,
    memberId,
    overview.filters.teams,
    overview.filters.supervisors,
  );
}

export function scopeRosterPeople(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  teamId: string,
  memberId: string,
  teams: FilterOption[],
  supervisors: FilterOption[],
): { bio: DashboardRosterPerson[]; tivazo: DashboardRosterPerson[] } {
  if (!teamId && !memberId) return { bio, tivazo };

  const allTeams = [...teams, ...supervisors];
  const index = createIdentityIndex([...bio, ...tivazo].map(asIdentity));
  const tivazoHit = supervisors.some((team) => sameKey(team.id, teamId) || sameKey(team.label, teamId));
  const bioHit = teams.some((team) => sameKey(team.id, teamId) || sameKey(team.label, teamId));

  let teamBio = bio;
  let teamTivazo = tivazo;
  if (teamId) {
    if (tivazoHit) {
      teamTivazo = tivazo.filter((row) => inTeam(row, teamId, allTeams));
      const wanted = new Set(teamTivazo.map((row) => identityCanonical(index, asIdentity(row))).filter(Boolean));
      teamBio = bio.filter((row) => wanted.has(identityCanonical(index, asIdentity(row))));
    } else if (bioHit) {
      teamBio = bio.filter((row) => inTeam(row, teamId, allTeams));
      const wanted = new Set(teamBio.map((row) => identityCanonical(index, asIdentity(row))).filter(Boolean));
      teamTivazo = tivazo.filter((row) => wanted.has(identityCanonical(index, asIdentity(row))));
    } else {
      teamBio = [];
      teamTivazo = [];
    }
  }
  return {
    bio: memberId ? teamBio.filter((row) => inMember(row, memberId, index)) : teamBio,
    tivazo: memberId ? teamTivazo.filter((row) => inMember(row, memberId, index)) : teamTivazo,
  };
}

export function selectVisibleRoster(
  overview: DashboardOverview,
  teamId: string,
  memberId: string,
): { bio: DashboardRosterPerson[]; tivazo: DashboardRosterPerson[] } {
  return selectPeople(overview, teamId, memberId);
}

export type PunchSourceFilter = "all" | "bio" | "tivazo";

export function scopeDashboard(
  overview: DashboardOverview,
  teamId: string,
  memberId: string,
  source: PunchSourceFilter = "all",
): DashboardOverview {
  const roster = overview.roster;
  // Rescope when Group/Member filters apply OR when Source is not Combined
  // (top Avg cards must follow the punch Source strip).
  if (!roster || (!teamId && !memberId && source === "all")) return overview;

  const { bio: scopedBio, tivazo: scopedTivazo } = selectPeople(overview, teamId, memberId);
  // Metric roster follows Source; Source Snapshots / coverage still use full scoped sets below.
  const metricBio = source === "tivazo" ? [] : scopedBio;
  const metricTivazo = source === "bio" ? [] : scopedTivazo;
  const allTeams = [...overview.filters.teams, ...overview.filters.supervisors];
  // Keep the Member filter populated with everyone in scope (team or all), not only the selected member.
  const { bio: filterBio, tivazo: filterTivazo } = selectPeople(overview, teamId, "");
  const members = [...filterTivazo, ...filterBio]
    .filter((row, index, list) => list.findIndex((item) => keyOf(item) === keyOf(row)) === index)
    .map((row) => ({ id: keyOf(row) || row.id, label: row.name }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const biomatic = recountBio(scopedBio);
  const tivazo = recountTivazo(scopedTivazo);
  const unique = dayWeightedAttendance(metricBio, metricTivazo);
  const avgWorkHours =
    source === "bio"
      ? sourceWorkHoursFromRoster(metricBio)
      : source === "tivazo"
        ? sourceWorkHoursFromRoster(metricTivazo)
        : combinedWorkHoursFromRoster(metricBio, metricTivazo);
  const avgClockIn =
    source === "bio"
      ? sourceAvgClockInFromRoster(metricBio)
      : source === "tivazo"
        ? sourceAvgClockInFromRoster(metricTivazo)
        : combinedAvgClockInFromRoster(metricBio, metricTivazo);
  const hourly = {
    biometrics: buildHourly(metricBio, "in"),
    tivazo: buildHourly(metricTivazo, "in"),
    compare: buildPunchCompare(metricBio, metricTivazo),
  };
  const leaderboards = {
    present: buildLeaderboard(scopedTivazo, "present"),
    attendance: buildLeaderboard(scopedTivazo, "attendance"),
    utilization: buildLeaderboard(scopedTivazo, "utilization"),
  };

  return {
    ...overview,
    summary: {
      ...overview.summary,
      totalMembers: unique.people,
      biomaticMembers: biomatic.totalMembers,
      tivazoMembers: tivazo.totalMembers,
      avgAttendance: unique.rate,
      avgWorkHours,
      avgClockIn,
      biomaticPresent: biomatic.presentMembers,
      bioPresent: biomatic.presentMembers,
      bioTotal: biomatic.totalMembers,
      tivazoPresent: tivazo.presentMembers,
      tivazoTotal: tivazo.totalMembers,
      bioAttendance: percent(biomatic.presentMembers, biomatic.totalMembers),
      tivazoAttendance: percent(tivazo.presentMembers, tivazo.totalMembers),
      bioAvgWorkHours: averageBioDoorFromRoster(scopedBio),
      tivazoAvgWorkHours: tivazo.avgWorkHours,
      bioClockIn: hourly.compare.checkIn.first.time,
      tivazoClockIn: hourly.compare.checkIn.second.time,
      // Bio↔Tivazo lag is only meaningful for Combined.
      avgSourceGap: source === "all" ? hourly.compare.avgGap : "—",
    },
    filters: {
      ...overview.filters,
      members,
    },
    leaderboard: leaderboards.present,
    leaderboards,
    hourly,
    member: memberId ? memberFocus(scopedBio, scopedTivazo) : null,
    biomatic,
    tivazo,
    coverage: buildCoverage(
      roster.bio,
      roster.tivazo,
      teamId,
      memberId,
      allTeams,
      scopeLabel(teamId, memberId, overview.filters.teams, members),
    ),
  };
}
