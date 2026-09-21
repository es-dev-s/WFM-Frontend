import type {
  BiomaticSummary,
  DailyLogRow,
  FilterOption,
  MemberDirectoryRow,
  Team,
  TivazoSummary,
} from "@/lib/api";
import {
  averageHours,
  normalizeDayStatus,
  percent,
  sameDayStatus,
  utilization,
} from "@/lib/server/metrics";

function needle(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesSearch(values: Array<string | undefined>, query: string): boolean {
  const q = needle(query);
  if (!q) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(q));
}

function teamAliases(teamId: string, teams: FilterOption[] = []): Set<string> {
  const aliases = new Set<string>();
  if (!teamId) return aliases;
  aliases.add(needle(teamId));
  for (const option of teams) {
    if (needle(option.id) === needle(teamId) || needle(option.label) === needle(teamId)) {
      aliases.add(needle(option.id));
      aliases.add(needle(option.label));
    }
  }
  return aliases;
}

function inBioTeam(
  row: { teamId?: string; teamName?: string; group?: string; groups: string[] },
  aliases: Set<string>,
): boolean {
  if (!aliases.size) return true;
  if (aliases.has(needle(row.teamId || ""))) return true;
  if (aliases.has(needle(row.teamName || ""))) return true;
  if (aliases.has(needle(row.group || ""))) return true;
  return row.groups.some((group) => aliases.has(needle(group)));
}

export function matchesPerson(
  row: { id?: string; email?: string; name?: string; employeeId?: string; memberId?: string },
  memberId: string,
): boolean {
  if (!memberId) return true;
  const key = needle(memberId);
  return [row.id, row.email, row.employeeId, row.memberId].some((value) => needle(value || "") === key);
}

export type PeopleScope = {
  memberId?: string;
  emails?: string[];
};

function inPeopleScope(
  row: { id?: string; email?: string; employeeId?: string; memberId?: string },
  people?: PeopleScope,
): boolean | null {
  const memberId = people?.memberId?.trim() || "";
  const emails = new Set((people?.emails ?? []).map(needle).filter(Boolean));
  if (memberId) return matchesPerson(row, memberId);
  if (emails.size) return emails.has(needle(row.email || ""));
  return null;
}

function isBioLate(start: string): boolean {
  const [hour, minute] = start.split(/[:.]/).map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  return hour > 9 || (hour === 9 && minute >= 30);
}

export function filterBioMembers(
  rows: MemberDirectoryRow[],
  teamId: string,
  roleId: string,
  query: string,
  dayStatus = "",
  teams: FilterOption[] = [],
  people?: PeopleScope,
): MemberDirectoryRow[] {
  const q = needle(query);
  const role = needle(roleId);
  const aliases = teamAliases(teamId, teams);
  return rows.filter((row) => {
    const scoped = inPeopleScope(row, people);
    if (scoped === false) return false;
    if (scoped == null && !inBioTeam(row, aliases)) return false;
    if (role && needle(row.role) !== role) return false;
    if (dayStatus && !sameDayStatus(row.dayStatus || row.attendance, dayStatus)) return false;
    if (q && !matchesSearch([row.name, row.email, row.designation, row.id, row.teamName], query)) {
      return false;
    }
    return true;
  });
}

export function summaryFromBioMembers(rows: MemberDirectoryRow[]): BiomaticSummary {
  let present = 0;
  let absent = 0;
  let leave = 0;
  let late = 0;
  for (const row of rows) {
    const attendance = normalizeDayStatus(row.dayStatus || row.attendance);
    if (attendance === "Present") {
      present += 1;
      if (isBioLate(row.inTime || "")) late += 1;
    } else if (attendance === "Leave") leave += 1;
    else if (attendance === "Absent") absent += 1;
  }
  return {
    totalMembers: rows.length,
    presentMembers: present,
    absentMembers: absent,
    leaveMembers: leave,
    lateMembers: late,
  };
}

export function teamsFromBioMembers(rows: MemberDirectoryRow[], teamId: string, query: string): Team[] {
  const buckets = new Map<string, { name: string; people: MemberDirectoryRow[] }>();
  for (const row of rows) {
    const id = row.teamId || "unassigned";
    const bucket = buckets.get(id) ?? { name: row.teamName || "Unassigned", people: [] };
    bucket.people.push(row);
    buckets.set(id, bucket);
  }
  const q = needle(query);
  return [...buckets.entries()]
    .map(([id, bucket]) => {
      const present = bucket.people.filter((row) => normalizeDayStatus(row.dayStatus) === "Present").length;
      const tracked = 0;
      return {
        id,
        name: bucket.name,
        members: bucket.people.length,
        occupancy: percent(present, bucket.people.length),
        utilization: utilization(tracked, bucket.people.length || 1),
        wtr: utilization(tracked, bucket.people.length || 1),
        attendance: percent(present, bucket.people.length),
        composition: { agents: bucket.people.length, leads: 0, supervisors: 0 },
      } satisfies Team;
    })
    .filter((team) => (!teamId || team.id === teamId) && (!q || team.name.toLowerCase().includes(q)))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function filterBioLogs(
  rows: DailyLogRow[],
  teamId: string,
  roleId: string,
  dayStatus: string,
  query: string,
  teams: FilterOption[] = [],
  people?: PeopleScope,
): DailyLogRow[] {
  const role = needle(roleId);
  const aliases = teamAliases(teamId, teams);
  return rows.filter((row) => {
    const scoped = inPeopleScope(row, people);
    if (scoped === false) return false;
    if (scoped == null && !inBioTeam(row, aliases)) return false;
    if (role && needle(row.role) !== role) return false;
    if (dayStatus && !sameDayStatus(row.status, dayStatus)) return false;
    if (!matchesSearch([row.name, row.email, row.designation, row.employeeId, row.group], query)) {
      return false;
    }
    return true;
  });
}

export function filterTivazoRows(
  rows: DailyLogRow[],
  group: string,
  query: string,
  status?: string,
  groups: { id: string; label: string }[] = [],
  people?: PeopleScope,
): DailyLogRow[] {
  const aliases = new Set<string>();
  if (group) {
    aliases.add(needle(group));
    for (const option of groups) {
      if (needle(option.id) === needle(group) || needle(option.label) === needle(group)) {
        aliases.add(needle(option.id));
        aliases.add(needle(option.label));
      }
    }
  }
  return rows.filter((row) => {
    const scoped = inPeopleScope(row, people);
    if (scoped === false) return false;
    if (
      scoped == null &&
      aliases.size &&
      !aliases.has(needle(row.group)) &&
      !row.groups.some((item) => aliases.has(needle(item)))
    ) {
      return false;
    }
    if (!matchesSearch([row.name, row.email, row.designation, row.memberId, row.group, ...row.groups], query)) {
      return false;
    }
    if (!status) return true;
    if (/^(present|absent|leave)$/i.test(status)) return sameDayStatus(row.status, status);
    const live = status.toLowerCase() === "tracking" ? "active" : status.toLowerCase();
    const value = row.userStatus.toLowerCase();
    if (live === "active") return value === "active" || value === "tracking";
    return value === live;
  });
}

export function summaryFromTivazoRows(rows: DailyLogRow[]): TivazoSummary {
  const seen = new Map<string, DailyLogRow>();
  for (const row of rows) {
    const key = row.memberId || row.email || row.id;
    if (!seen.has(key)) seen.set(key, row);
  }
  const people = [...seen.values()];
  let present = 0;
  let tracking = 0;
  let idle = 0;
  let offline = 0;
  for (const row of people) {
    if (normalizeDayStatus(row.status) === "Present") present += 1;
    const live = row.userStatus.toLowerCase();
    if (live === "active" || live === "tracking") tracking += 1;
    else if (live === "idle") idle += 1;
    else if (live === "offline") offline += 1;
  }
  return {
    totalMembers: people.length,
    activeMembers: tracking,
    idleMembers: idle,
    offlineMembers: offline,
    presentMembers: present,
    absentMembers: people.length - present,
    avgWorkHours: averageHours(0, present),
  };
}
