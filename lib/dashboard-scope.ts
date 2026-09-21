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
  averageHours,
  formatHours,
  normalizeDayStatus,
  percent,
  titleStatus,
  utilization,
} from "@/lib/server/metrics";

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

function inMember(person: DashboardRosterPerson, memberId: string): boolean {
  if (!memberId) return true;
  return (
    sameKey(person.id, memberId) ||
    sameKey(person.email, memberId) ||
    sameKey(person.name, memberId)
  );
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
  for (const row of people) {
    if (row.attendance.toLowerCase() === "present") {
      present += 1;
      tracked += row.trackedSeconds;
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
    avgWorkHours: averageHours(tracked, present),
  };
}

function uniqueAttendance(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]) {
  const people = new Map<string, boolean>();
  for (const row of [...bio, ...tivazo]) {
    const key = keyOf(row);
    if (!key) continue;
    people.set(key, people.get(key) === true || row.attendance.toLowerCase() === "present");
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

function punchMinutes(punch: { hour: number; minute: number } | null): number | null {
  if (!punch) return null;
  return punch.hour * 60 + punch.minute;
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

function punchMoment(values: number[]) {
  if (!values.length) return { time: "—", people: 0 };
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { time: formatClockLabel(avg), people: values.length };
}

function punchGap(values: number[], after: string, before: string) {
  if (!values.length) return { label: "—", minutes: null, people: 0, note: "No paired punches" };
  const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    label: avg >= 0 ? after : before,
    minutes: Math.abs(avg),
    people: values.length,
    note: `${values.length} paired`,
  };
}

function buildPunch(bio: DashboardRosterPerson[], tivazo: DashboardRosterPerson[]): PunchCompare {
  const bioMap = new Map(bio.map((row) => [keyOf(row), row]));
  const tivMap = new Map(tivazo.map((row) => [keyOf(row), row]));
  const keys = new Set([...bioMap.keys(), ...tivMap.keys()]);
  const bioIn: number[] = [];
  const tivIn: number[] = [];
  const inGaps: number[] = [];
  const inCombined: number[] = [];
  const bioOut: number[] = [];
  const tivOut: number[] = [];
  const outGaps: number[] = [];
  const outCombined: number[] = [];

  for (const key of keys) {
    const bioRow = bioMap.get(key);
    const tivRow = tivMap.get(key);
    const inBio = punchMinutes(bioRow ? punchOf(bioRow, "in") : null);
    const inTiv = punchMinutes(tivRow ? punchOf(tivRow, "in") : null);
    const outBio = punchMinutes(bioRow ? punchOf(bioRow, "out") : null);
    const outTiv = punchMinutes(tivRow ? punchOf(tivRow, "out") : null);
    if (inBio != null) {
      bioIn.push(inBio);
      inCombined.push(inBio);
    }
    if (inTiv != null) {
      tivIn.push(inTiv);
      inCombined.push(inTiv);
    }
    if (inBio != null && inTiv != null) inGaps.push(inTiv - inBio);
    if (outTiv != null) {
      tivOut.push(outTiv);
      outCombined.push(outTiv);
    }
    if (outBio != null) {
      bioOut.push(outBio);
      outCombined.push(outBio);
    }
    if (outBio != null && outTiv != null) outGaps.push(outBio - outTiv);
  }

  return {
    checkIn: {
      first: punchMoment(bioIn),
      second: punchMoment(tivIn),
      gap: punchGap(inGaps, "Tivazo after Biometrics", "Tivazo before Biometrics"),
      overall: punchMoment(inCombined),
    },
    checkOut: {
      first: punchMoment(tivOut),
      second: punchMoment(bioOut),
      gap:
        outCombined.length === 0
          ? { label: "—", minutes: null, people: 0, note: "No check-outs for this day" }
          : punchGap(outGaps, "Biometrics after Tivazo", "Biometrics before Tivazo"),
      overall: punchMoment(outCombined),
    },
  };
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
  const bioByEmail = new Map<string, DashboardRosterPerson>();
  const tivByEmail = new Map<string, DashboardRosterPerson>();
  const bioOnly: CoveragePerson[] = [];
  const tivazoOnly: CoveragePerson[] = [];
  const linked = new Set<string>();
  const focus = (person: DashboardRosterPerson) => inTeam(person, teamId, teams) && inMember(person, memberId);

  for (const row of bio) {
    if (row.email) bioByEmail.set(row.email.toLowerCase(), row);
  }
  for (const row of tivazo) {
    if (row.email) tivByEmail.set(row.email.toLowerCase(), row);
  }
  for (const row of bio) {
    if (!focus(row)) continue;
    const email = row.email.toLowerCase();
    if (email && tivByEmail.has(email)) {
      linked.add(email);
      continue;
    }
    bioOnly.push(coveragePerson(row));
  }
  for (const row of tivazo) {
    if (!focus(row)) continue;
    const email = row.email.toLowerCase();
    if (email && bioByEmail.has(email)) {
      linked.add(email);
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
  const tivazoHit = supervisors.some((team) => sameKey(team.id, teamId) || sameKey(team.label, teamId));
  const bioHit = teams.some((team) => sameKey(team.id, teamId) || sameKey(team.label, teamId));

  let teamBio = bio;
  let teamTivazo = tivazo;
  if (teamId) {
    if (tivazoHit) {
      teamTivazo = tivazo.filter((row) => inTeam(row, teamId, allTeams));
      const emails = new Set(teamTivazo.map((row) => row.email.toLowerCase()).filter(Boolean));
      teamBio = bio.filter((row) => emails.has(row.email.toLowerCase()));
    } else if (bioHit) {
      teamBio = bio.filter((row) => inTeam(row, teamId, allTeams));
      const emails = new Set(teamBio.map((row) => row.email.toLowerCase()).filter(Boolean));
      teamTivazo = tivazo.filter((row) => emails.has(row.email.toLowerCase()));
    } else {
      teamBio = [];
      teamTivazo = [];
    }
  }
  return {
    bio: memberId ? teamBio.filter((row) => inMember(row, memberId)) : teamBio,
    tivazo: memberId ? teamTivazo.filter((row) => inMember(row, memberId)) : teamTivazo,
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
    compare: buildPunch(visibleBio, visibleTivazo),
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
      avgWorkHours: tivazo.avgWorkHours,
      avgClockIn:
        hourly.compare.checkIn.overall.time !== "—"
          ? hourly.compare.checkIn.overall.time
          : hourly.biometrics.avgClockIn,
      avgAttendance: percent(unique.present, unique.people),
      biomaticPresent: biomatic.presentMembers,
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
