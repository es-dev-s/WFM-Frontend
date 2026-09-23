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

function averageBioDoorFromRoster(people: DashboardRosterPerson[]): string {
  let total = 0;
  let count = 0;
  for (const row of people) {
    if (!isPresentAttendance(row.attendance)) continue;
    const seconds = bioDoorSpanSeconds(row);
    if (seconds <= 0) continue;
    total += seconds;
    count += 1;
  }
  return averageWorkedHours(total, count);
}

function workSpanSeconds(inMinutes: number | null, outMinutes: number | null): number {
  if (inMinutes == null || outMinutes == null) return 0;
  let delta = outMinutes - inMinutes;
  if (delta <= 0) delta += 1440;
  if (delta <= 0 || delta > 16 * 60) return 0;
  return delta * 60;
}

/** Combined Avg Work Hour: earliest in / latest out across Bio ∪ Tivazo, one span per person. */
function combinedWorkHoursFromRoster(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]): string {
  const people = new Map<string, { ins: number[]; outs: number[]; present: boolean }>();
  const touch = (row: DashboardRosterPerson) => {
    const key = keyOf(row);
    if (!key) return;
    const prev = people.get(key) ?? { ins: [], outs: [], present: false };
    if (isPresentAttendance(row.attendance)) prev.present = true;
    const inPunch = punchOf(row, "in");
    const outPunch = punchOf(row, "out");
    if (inPunch) prev.ins.push(inPunch.hour * 60 + inPunch.minute);
    if (outPunch) prev.outs.push(outPunch.hour * 60 + outPunch.minute);
    people.set(key, prev);
  };
  for (const row of bio) touch(row);
  for (const row of tivazo) touch(row);

  let total = 0;
  let count = 0;
  for (const row of people.values()) {
    if (!row.present || !row.ins.length || !row.outs.length) continue;
    const seconds = workSpanSeconds(Math.min(...row.ins), Math.max(...row.outs));
    if (seconds <= 0) continue;
    total += seconds;
    count += 1;
  }
  return averageWorkedHours(total, count);
}

function combinedAvgClockInFromRoster(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]): string {
  const earliest = new Map<string, number>();
  for (const row of [...bio, ...tivazo]) {
    const key = keyOf(row);
    if (!key) continue;
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

export function buildPunchCompareBundle(
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
  options?: { todayDate?: string; undatedIsToday?: boolean; period?: "day" | "range" },
): { compare: PunchCompare; focus: PunchCompareFocus } {
  const period = options?.period ?? "day";
  const todayArg = options?.todayDate?.trim() || options?.undatedIsToday === true;
  // Single source of truth with chip cards: confirmed outs, rest days excluded, identity merge.
  const people = mergeWorkdayPeople(bio, tivazo, todayArg || false);

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

function leaderValue(person: DashboardRosterPerson, metric: TrendMetric): string {
  const present = person.attendance.toLowerCase() === "present";
  if (metric === "present") return titleStatus(person.attendance) || (present ? "Present" : "Absent");
  if (metric === "attendance") return present ? "100%" : "0%";
  return utilization(person.trackedSeconds);
}

function buildLeaderboard(people: DashboardRosterPerson[], metric: TrendMetric) {
  const ranked = [...people].sort((left, right) => {
    if (metric === "present" || metric === "attendance") {
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
        value: leaderValue(person, metric),
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
  return {
    name: tiv?.name || bioRow?.name || "",
    email: tiv?.email || bioRow?.email || "",
    employeeId: bioRow?.id || tiv?.id || "",
    sources: [...(bioRow ? ["Biometrics"] : []), ...(tiv ? ["Tivazo"] : [])],
    biometrics: {
      day: normalizeDayStatus(bioRow?.attendance),
      inTime: bioRow?.startTime || "",
      outTime: bioRow?.endTime || "",
      department: bioRow ? rankingTeam(bioRow) : "",
      designation: bioRow?.designation || "",
      joined: bioRow?.joinDate || "",
    },
    tivazo: {
      live: titleStatus(tiv?.status),
      day: normalizeDayStatus(tiv?.attendance),
      inTime: tiv?.clockedIn || "",
      outTime: tiv?.lastScreenshot || "",
      tracked: tiv?.trackedLabel || "",
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

export function scopeDashboard(
  overview: DashboardOverview,
  teamId: string,
  memberId: string,
): DashboardOverview {
  const roster = overview.roster;
  if (!roster || (!teamId && !memberId)) return overview;

  const { bio: visibleBio, tivazo: visibleTivazo } = selectPeople(overview, teamId, memberId);
  const allTeams = [...overview.filters.teams, ...overview.filters.supervisors];
  const members = [...visibleTivazo, ...visibleBio]
    .filter((row, index, list) => list.findIndex((item) => keyOf(item) === keyOf(row)) === index)
    .map((row) => ({ id: keyOf(row) || row.id, label: row.name }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const biomatic = recountBio(visibleBio);
  const tivazo = recountTivazo(visibleTivazo);
  const unique = uniqueAttendance(visibleBio, visibleTivazo);
  const hourly = {
    biometrics: buildHourly(visibleBio, "in"),
    tivazo: buildHourly(visibleTivazo, "in"),
    compare: buildPunchCompare(visibleBio, visibleTivazo),
  };
  const leaderboards = {
    present: buildLeaderboard(visibleTivazo, "present"),
    attendance: buildLeaderboard(visibleTivazo, "attendance"),
    utilization: buildLeaderboard(visibleTivazo, "utilization"),
  };

  return {
    ...overview,
    summary: {
      ...overview.summary,
      totalMembers: unique.people,
      biomaticMembers: biomatic.totalMembers,
      tivazoMembers: tivazo.totalMembers,
      avgAttendance: percent(unique.present, unique.people),
      avgWorkHours: combinedWorkHoursFromRoster(visibleBio, visibleTivazo),
      avgClockIn: combinedAvgClockInFromRoster(visibleBio, visibleTivazo),
      biomaticPresent: biomatic.presentMembers,
      bioPresent: biomatic.presentMembers,
      bioTotal: biomatic.totalMembers,
      tivazoPresent: tivazo.presentMembers,
      tivazoTotal: tivazo.totalMembers,
      bioAttendance: percent(biomatic.presentMembers, biomatic.totalMembers),
      tivazoAttendance: percent(tivazo.presentMembers, tivazo.totalMembers),
      bioAvgWorkHours: averageBioDoorFromRoster(visibleBio),
      tivazoAvgWorkHours: tivazo.avgWorkHours,
      bioClockIn: hourly.compare.checkIn.first.time,
      tivazoClockIn: hourly.compare.checkIn.second.time,
    },
    filters: {
      ...overview.filters,
      members,
    },
    leaderboard: leaderboards.present,
    leaderboards,
    hourly,
    member: memberId ? memberFocus(visibleBio, visibleTivazo) : null,
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
