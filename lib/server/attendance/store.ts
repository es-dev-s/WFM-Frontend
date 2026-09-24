import type { DailyLogRow } from "@/lib/api";
import { APP_TIMEZONE, isoDateInZone } from "@/lib/datetime";
import { query, withTransaction } from "@/lib/server/auth/db";
import { ensureAttendanceSchema } from "@/lib/server/attendance/schema";
import { dayShowsPunches, enumerateDays, normalizeDayStatus } from "@/lib/server/metrics";

export type AttendanceSource = "biometrics" | "tivazo";

export type StoredMember = {
  id: string;
  email: string;
  name: string;
  department: string;
  groups: string[];
  role: string;
  designation: string;
  joinedAt: string;
  workspaceId: string;
  disabled: boolean;
};

export type IngestDay = {
  day: string;
  sealed: boolean;
  rowCount: number;
  presentCount: number;
};

export type PresenceDay = {
  day: string;
  present: number;
  typicalIn: number | null;
  typicalOut: number | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const BATCH = 80;

function isDay(value: string): boolean {
  return ISO_DAY.test(value);
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

function asGroups(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean);
  }
  const single = asText(value);
  return single ? [single] : [];
}

function personIdOf(row: DailyLogRow, source: AttendanceSource): string {
  if (source === "biometrics") return asText(row.employeeId) || asText(row.memberId);
  return asText(row.memberId) || asText(row.employeeId);
}

function dayOf(row: DailyLogRow): string {
  const day = asText(row.rawDate) || asText(row.date);
  return isDay(day) ? day : "";
}

export function memberFromLog(row: DailyLogRow, source: AttendanceSource): StoredMember | null {
  const id = personIdOf(row, source);
  if (!id) return null;
  return {
    id,
    email: asText(row.email).toLowerCase(),
    name: asText(row.name) || "Unknown",
    department: asText(row.group),
    groups: row.groups?.length ? row.groups.map((item) => asText(item)).filter(Boolean) : asText(row.group) ? [asText(row.group)] : [],
    role: asText(row.role),
    designation: asText(row.designation),
    joinedAt: "",
    workspaceId: asText(row.workspaceId),
    disabled: asText(row.disabled).toLowerCase() === "yes",
  };
}

export function toDailyLogRow(
  source: AttendanceSource,
  row: {
    person_id: string;
    day: string;
    name: string;
    email: string;
    department?: string;
    groups: string[] | null;
    role: string;
    designation: string;
    status: string;
    in_time: string;
    out_time: string;
    tracked_time: string;
    manual_time: string;
    break_time: string;
    occupancy: string;
    utilization: string;
    wtr: string;
    employee_id?: string;
    workspace_id?: string;
    clocked_in_ms?: string | number | null;
    last_screenshot_ms?: string | number | null;
  },
): DailyLogRow {
  const groups = asGroups(row.groups);
  const department = asText(row.department) || groups[0] || "";
  const personId = asText(row.person_id);
  const day = asText(row.day);
  const status = asText(row.status) || "Absent";
  const showPunches = dayShowsPunches(status);
  return {
    id: day ? `${personId}:${day}` : personId,
    date: day,
    rawDate: day,
    name: asText(row.name) || "Unknown",
    email: asText(row.email),
    group: department,
    groups: groups.length ? groups : department ? [department] : [],
    role: asText(row.role),
    designation: asText(row.designation),
    userStatus: "",
    active: "",
    disabled: "No",
    status,
    // Leave/Absent/Weekly off/Holiday: hide stored door/tracked (same issue class as Tivazo live bleed).
    inTime: showPunches ? asText(row.in_time) : "",
    outTime: showPunches ? asText(row.out_time) : "",
    trackedTime: showPunches ? asText(row.tracked_time) : "",
    manualTime: showPunches ? asText(row.manual_time) : "",
    breakTime: asText(row.break_time),
    occupancy: showPunches ? asText(row.occupancy) || "0%" : "0%",
    utilization: showPunches ? asText(row.utilization) || "0%" : "0%",
    wtr: showPunches ? asText(row.wtr) || asText(row.utilization) || "0%" : "0%",
    memberId: personId,
    employeeId: asText(row.employee_id) || personId,
    workspaceId: asText(row.workspace_id),
    clockedInMs: showPunches ? Number(row.clocked_in_ms || 0) || 0 : 0,
    lastScreenshotMs: showPunches ? Number(row.last_screenshot_ms || 0) || 0 : 0,
    allTimeWorkHour: 0,
    screenshotFrequency: 0,
    lastActiveAt: "",
    avatarUrl: "",
  };
}

export async function saveAttendance(input: {
  source: AttendanceSource;
  members: StoredMember[];
  logs: DailyLogRow[];
  coveredDays: string[];
  today: string;
}): Promise<void> {
  await ensureAttendanceSchema();
  const source = input.source;
  const members = new Map<string, StoredMember>();
  for (const member of input.members) {
    if (!member.id) continue;
    members.set(member.id, member);
  }
  const logs = new Map<string, DailyLogRow>();
  for (const row of input.logs) {
    const day = dayOf(row);
    const id = personIdOf(row, source);
    if (!day || !id) continue;
    const member = memberFromLog(row, source);
    if (member && !members.has(member.id)) members.set(member.id, member);
    const key = `${id}:${day}`;
    const prev = logs.get(key);
    logs.set(key, prev ? mergeLog(prev, row) : row);
  }

  const covered = [...new Set(input.coveredDays.filter(isDay))];
  const counts = new Map<string, { rows: number; present: number }>();
  for (const row of logs.values()) {
    const day = dayOf(row);
    const bucket = counts.get(day) ?? { rows: 0, present: 0 };
    bucket.rows += 1;
    if (asText(row.status).toLowerCase().replace(/[\s_-]+/g, "") === "present") {
      bucket.present += 1;
    }
    counts.set(day, bucket);
  }
  for (const day of covered) {
    if (!counts.has(day)) counts.set(day, { rows: 0, present: 0 });
  }

  await withTransaction(async (client) => {
    if (source === "biometrics") {
      const memberRows = [...members.values()].map((member) => [
        member.id,
        member.email,
        member.name,
        member.department,
        member.role,
        member.designation,
        member.joinedAt,
      ]);
      if (memberRows.length) {
        await insertWithClient(
          client,
          `INSERT INTO wfm_bio_members (id, email, name, department, role, designation, joined_at)
           VALUES %VALUES%
           ON CONFLICT (id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             department = EXCLUDED.department,
             role = EXCLUDED.role,
             designation = EXCLUDED.designation,
             joined_at = CASE WHEN EXCLUDED.joined_at <> '' THEN EXCLUDED.joined_at ELSE wfm_bio_members.joined_at END,
             updated_at = now()`,
          memberRows,
        );
      }
      const logRows = [...logs.values()].map((row) => {
        const id = personIdOf(row, source);
        return [
          id,
          dayOf(row),
          asText(row.name) || "Unknown",
          asText(row.email),
          asText(row.group),
          row.groups?.length ? row.groups : asText(row.group) ? [asText(row.group)] : [],
          asText(row.role),
          asText(row.designation),
          asText(row.status) || "Absent",
          asText(row.inTime),
          asText(row.outTime),
          asText(row.trackedTime),
          asText(row.manualTime),
          asText(row.breakTime),
          asText(row.occupancy) || "0%",
          asText(row.utilization) || "0%",
          asText(row.wtr) || asText(row.utilization) || "0%",
        ];
      });
      if (logRows.length) {
        await insertWithClient(
          client,
          `INSERT INTO wfm_bio_day_logs (
             employee_id, day, name, email, department, groups, role, designation,
             status, in_time, out_time, tracked_time, manual_time, break_time,
             occupancy, utilization, wtr
           )
           VALUES %VALUES%
           ON CONFLICT (employee_id, day) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             department = EXCLUDED.department,
             groups = EXCLUDED.groups,
             role = EXCLUDED.role,
             designation = EXCLUDED.designation,
             status = EXCLUDED.status,
             in_time = EXCLUDED.in_time,
             out_time = EXCLUDED.out_time,
             tracked_time = EXCLUDED.tracked_time,
             manual_time = EXCLUDED.manual_time,
             break_time = EXCLUDED.break_time,
             occupancy = EXCLUDED.occupancy,
             utilization = EXCLUDED.utilization,
             wtr = EXCLUDED.wtr,
             saved_at = now()`,
          logRows,
        );
      }
    } else {
      const memberRows = [...members.values()].map((member) => [
        member.id,
        member.email,
        member.name,
        member.designation,
        member.groups,
        member.role,
        member.workspaceId,
        member.disabled,
      ]);
      if (memberRows.length) {
        await insertWithClient(
          client,
          `INSERT INTO wfm_tivazo_members (id, email, name, designation, groups, role, workspace_id, disabled)
           VALUES %VALUES%
           ON CONFLICT (id) DO UPDATE SET
             email = EXCLUDED.email,
             name = EXCLUDED.name,
             designation = EXCLUDED.designation,
             groups = EXCLUDED.groups,
             role = EXCLUDED.role,
             workspace_id = CASE WHEN EXCLUDED.workspace_id <> '' THEN EXCLUDED.workspace_id ELSE wfm_tivazo_members.workspace_id END,
             disabled = EXCLUDED.disabled,
             updated_at = now()`,
          memberRows,
        );
      }
      const logRows = [...logs.values()].map((row) => {
        const id = personIdOf(row, source);
        return [
          id,
          dayOf(row),
          asText(row.name) || "Unknown",
          asText(row.email),
          row.groups?.length ? row.groups : asText(row.group) ? [asText(row.group)] : [],
          asText(row.role),
          asText(row.designation),
          asText(row.status) || "Absent",
          asText(row.inTime),
          asText(row.outTime),
          asText(row.trackedTime),
          asText(row.manualTime),
          asText(row.breakTime),
          asText(row.occupancy) || "0%",
          asText(row.utilization) || "0%",
          asText(row.wtr) || asText(row.utilization) || "0%",
          asText(row.employeeId) || id,
          asText(row.workspaceId),
          row.clockedInMs || 0,
          row.lastScreenshotMs || 0,
        ];
      });
      if (logRows.length) {
        await insertWithClient(
          client,
          `INSERT INTO wfm_tivazo_day_logs (
             member_id, day, name, email, groups, role, designation, status,
             in_time, out_time, tracked_time, manual_time, break_time,
             occupancy, utilization, wtr, employee_id, workspace_id,
             clocked_in_ms, last_screenshot_ms
           )
           VALUES %VALUES%
           ON CONFLICT (member_id, day) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             groups = EXCLUDED.groups,
             role = EXCLUDED.role,
             designation = EXCLUDED.designation,
             status = EXCLUDED.status,
             in_time = EXCLUDED.in_time,
             out_time = EXCLUDED.out_time,
             tracked_time = EXCLUDED.tracked_time,
             manual_time = EXCLUDED.manual_time,
             break_time = EXCLUDED.break_time,
             occupancy = EXCLUDED.occupancy,
             utilization = EXCLUDED.utilization,
             wtr = EXCLUDED.wtr,
             employee_id = CASE WHEN EXCLUDED.employee_id <> '' THEN EXCLUDED.employee_id ELSE wfm_tivazo_day_logs.employee_id END,
             workspace_id = EXCLUDED.workspace_id,
             clocked_in_ms = EXCLUDED.clocked_in_ms,
             last_screenshot_ms = EXCLUDED.last_screenshot_ms,
             saved_at = now()`,
          logRows,
        );
      }
    }

    const ingestRows = [...counts.entries()]
      .filter(([day]) => isDay(day))
      .map(([day, count]) => [
        source,
        day,
        day < input.today,
        count.rows,
        count.present,
      ]);
    if (ingestRows.length) {
      await insertWithClient(
        client,
        `INSERT INTO wfm_ingest_days (source, day, sealed, row_count, present_count)
         VALUES %VALUES%
         ON CONFLICT (source, day) DO UPDATE SET
           sealed = EXCLUDED.sealed OR wfm_ingest_days.sealed,
           row_count = EXCLUDED.row_count,
           present_count = EXCLUDED.present_count,
           ingested_at = now()`,
        ingestRows,
      );
    }
  });
}

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

async function insertWithClient(client: Queryable, sql: string, rows: unknown[][]): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const chunk = rows.slice(offset, offset + BATCH);
    if (!chunk.length) continue;
    const params: unknown[] = [];
    const values = chunk.map((row) => {
      const start = params.length;
      params.push(...row);
      return `(${row.map((_, index) => `$${start + index + 1}`).join(", ")})`;
    });
    await client.query(sql.replace("%VALUES%", values.join(", ")), params);
  }
}

function earlierClock(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function laterClock(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

function mergeLog(prev: DailyLogRow, next: DailyLogRow): DailyLogRow {
  const prevDay = normalizeDayStatus(prev.status);
  const nextDay = normalizeDayStatus(next.status);
  const present = prevDay === "Present" || nextDay === "Present";
  const half = prevDay === "Half day" || nextDay === "Half day";
  const status = present ? "Present" : half ? "Half day" : asText(next.status) || prev.status;
  const showPunches = dayShowsPunches(status);
  return {
    ...prev,
    ...next,
    name: asText(next.name) || prev.name,
    email: asText(next.email) || prev.email,
    group: asText(next.group) || prev.group,
    groups: next.groups?.length ? next.groups : prev.groups,
    status,
    inTime: showPunches ? earlierClock(prev.inTime, next.inTime) : "",
    outTime: showPunches ? laterClock(prev.outTime, next.outTime) : "",
    trackedTime: showPunches ? laterClock(prev.trackedTime, next.trackedTime) : "",
    manualTime: showPunches ? laterClock(prev.manualTime, next.manualTime) : "",
    occupancy: present ? "100%" : showPunches ? asText(next.occupancy) || prev.occupancy : "0%",
    utilization: showPunches ? asText(next.utilization) || prev.utilization : "0%",
    wtr: showPunches ? asText(next.wtr) || prev.wtr : "0%",
    clockedInMs: showPunches
      ? prev.clockedInMs && next.clockedInMs
        ? Math.min(prev.clockedInMs, next.clockedInMs)
        : prev.clockedInMs || next.clockedInMs
      : 0,
    lastScreenshotMs: showPunches ? Math.max(prev.lastScreenshotMs, next.lastScreenshotMs) : 0,
  };
}

export async function listDayLogs(
  source: AttendanceSource,
  start: string,
  end: string,
): Promise<DailyLogRow[]> {
  await ensureAttendanceSchema();
  if (!isDay(start) || !isDay(end)) return [];
  if (source === "biometrics") {
    const result = await query<{
      person_id: string;
      day: string;
      name: string;
      email: string;
      department: string;
      groups: string[];
      role: string;
      designation: string;
      status: string;
      in_time: string;
      out_time: string;
      tracked_time: string;
      manual_time: string;
      break_time: string;
      occupancy: string;
      utilization: string;
      wtr: string;
    }>(
      `SELECT employee_id AS person_id, day, name, email, department, groups, role, designation,
              status, in_time, out_time, tracked_time, manual_time, break_time,
              occupancy, utilization, wtr
       FROM wfm_bio_day_logs
       WHERE day >= $1 AND day <= $2
       ORDER BY day DESC, lower(name)`,
      [start, end],
    );
    return result.rows.map((row) => toDailyLogRow("biometrics", row));
  }
  const result = await query<{
    person_id: string;
    day: string;
    name: string;
    email: string;
    groups: string[];
    role: string;
    designation: string;
    status: string;
    in_time: string;
    out_time: string;
    tracked_time: string;
    manual_time: string;
    break_time: string;
    occupancy: string;
    utilization: string;
    wtr: string;
    employee_id: string;
    workspace_id: string;
    clocked_in_ms: string | number;
    last_screenshot_ms: string | number;
  }>(
    `SELECT member_id AS person_id, day, name, email, groups, role, designation,
            status, in_time, out_time, tracked_time, manual_time, break_time,
            occupancy, utilization, wtr, employee_id, workspace_id,
            clocked_in_ms, last_screenshot_ms
     FROM wfm_tivazo_day_logs
     WHERE day >= $1 AND day <= $2
     ORDER BY day DESC, lower(name)`,
    [start, end],
  );
  return result.rows.map((row) => toDailyLogRow("tivazo", row));
}

export async function listMemberDays(
  source: AttendanceSource,
  personId: string,
  start: string,
  end: string,
): Promise<DailyLogRow[]> {
  await ensureAttendanceSchema();
  const id = asText(personId);
  if (!id || !isDay(start) || !isDay(end)) return [];
  if (source === "biometrics") {
    const result = await query<{
      person_id: string;
      day: string;
      name: string;
      email: string;
      department: string;
      groups: string[];
      role: string;
      designation: string;
      status: string;
      in_time: string;
      out_time: string;
      tracked_time: string;
      manual_time: string;
      break_time: string;
      occupancy: string;
      utilization: string;
      wtr: string;
    }>(
      `SELECT employee_id AS person_id, day, name, email, department, groups, role, designation,
              status, in_time, out_time, tracked_time, manual_time, break_time,
              occupancy, utilization, wtr
       FROM wfm_bio_day_logs
       WHERE day >= $1 AND day <= $2
         AND (employee_id = $3 OR lower(email) = lower($3))
       ORDER BY day DESC, lower(name)`,
      [start, end, id],
    );
    return result.rows.map((row) => toDailyLogRow("biometrics", row));
  }
  const result = await query<{
    person_id: string;
    day: string;
    name: string;
    email: string;
    groups: string[];
    role: string;
    designation: string;
    status: string;
    in_time: string;
    out_time: string;
    tracked_time: string;
    manual_time: string;
    break_time: string;
    occupancy: string;
    utilization: string;
    wtr: string;
    employee_id: string;
    workspace_id: string;
    clocked_in_ms: string | number;
    last_screenshot_ms: string | number;
  }>(
    `SELECT member_id AS person_id, day, name, email, groups, role, designation,
            status, in_time, out_time, tracked_time, manual_time, break_time,
            occupancy, utilization, wtr, employee_id, workspace_id,
            clocked_in_ms, last_screenshot_ms
     FROM wfm_tivazo_day_logs
     WHERE day >= $1 AND day <= $2
       AND (member_id = $3 OR lower(email) = lower($3) OR employee_id = $3)
     ORDER BY day DESC, lower(name)`,
    [start, end, id],
  );
  return result.rows.map((row) => toDailyLogRow("tivazo", row));
}

function uniqueKeys(values: string[]): string[] {
  const keys = new Set<string>();
  for (const value of values) {
    const next = asText(value).toLowerCase();
    if (next) keys.add(next);
  }
  return [...keys];
}

type PersonKeyRow = { id: string; email: string; name: string };

function personKeyParts(rows: PersonKeyRow[]): string[] {
  return rows.flatMap((row) => [row.id, row.email, row.name]);
}

async function membersByEmails(emails: string[]): Promise<PersonKeyRow[]> {
  const keys = uniqueKeys(emails);
  if (!keys.length) return [];
  const [bio, tivazo] = await Promise.all([
    query<PersonKeyRow>(
      `SELECT id, email, name FROM wfm_bio_members WHERE lower(email) = ANY($1::text[]) LIMIT 80`,
      [keys],
    ),
    query<PersonKeyRow>(
      `SELECT id, email, name FROM wfm_tivazo_members WHERE lower(email) = ANY($1::text[]) LIMIT 80`,
      [keys],
    ),
  ]);
  return [...bio.rows, ...tivazo.rows];
}

async function uniqueNameCounterparts(names: string[]): Promise<PersonKeyRow[]> {
  const keys = uniqueKeys(names);
  if (!keys.length) return [];
  const [namedBio, namedTivazo] = await Promise.all([
    query<PersonKeyRow>(
      `SELECT id, email, name FROM wfm_bio_members WHERE lower(name) = ANY($1::text[]) LIMIT 400`,
      [keys],
    ),
    query<PersonKeyRow>(
      `SELECT id, email, name FROM wfm_tivazo_members WHERE lower(name) = ANY($1::text[]) LIMIT 400`,
      [keys],
    ),
  ]);
  const extra: PersonKeyRow[] = [];
  for (const name of keys) {
    const bio = namedBio.rows.filter((row) => asText(row.name).toLowerCase() === name);
    const tivazo = namedTivazo.rows.filter((row) => asText(row.name).toLowerCase() === name);
    if (bio.length <= 1 && tivazo.length <= 1) extra.push(...bio, ...tivazo);
  }
  return extra;
}

export async function lookupPersonAliases(needle: string): Promise<string[]> {
  await ensureAttendanceSchema();
  const want = asText(needle);
  if (!want) return [];
  const [bio, tivazo] = await Promise.all([
    query<PersonKeyRow>(
      `SELECT id, email, name
       FROM wfm_bio_members
       WHERE lower(id) = lower($1) OR lower(email) = lower($1) OR lower(name) = lower($1)
       LIMIT 12`,
      [want],
    ),
    query<PersonKeyRow>(
      `SELECT id, email, name
       FROM wfm_tivazo_members
       WHERE lower(id) = lower($1) OR lower(email) = lower($1) OR lower(name) = lower($1)
       LIMIT 12`,
      [want],
    ),
  ]);
  const exact = [...bio.rows, ...tivazo.rows].filter(
    (row) =>
      asText(row.id).toLowerCase() === want.toLowerCase() ||
      asText(row.email).toLowerCase() === want.toLowerCase(),
  );
  const nameHits = [...bio.rows, ...tivazo.rows];
  const seed = exact.length ? exact : nameHits.length <= 2 ? nameHits : exact;
  const extra = [
    ...(await membersByEmails(seed.map((row) => row.email))),
    ...(await uniqueNameCounterparts(seed.map((row) => row.name))),
  ];
  const rows = [...seed, ...extra];
  return uniqueKeys([want, ...personKeyParts(rows)]);
}

export async function lookupTeamPersonKeys(teamId: string): Promise<string[]> {
  await ensureAttendanceSchema();
  const want = asText(teamId).toLowerCase();
  if (!want || want === "all") return [];
  const [bio, tivazo] = await Promise.all([
    query<PersonKeyRow>(
      `SELECT id, email, name
       FROM wfm_bio_members
       WHERE lower(department) = $1
       LIMIT 400`,
      [want],
    ),
    query<PersonKeyRow>(
      `SELECT id, email, name
       FROM wfm_tivazo_members
       WHERE EXISTS (SELECT 1 FROM unnest(groups) AS g WHERE lower(g) = $1)
       LIMIT 400`,
      [want],
    ),
  ]);
  const seed = [...bio.rows, ...tivazo.rows];
  if (!seed.length) return [];
  const extra = [
    ...(await membersByEmails(seed.map((row) => row.email))),
    ...(await uniqueNameCounterparts(seed.map((row) => row.name))),
  ];
  return uniqueKeys(personKeyParts([...seed, ...extra]));
}

export async function listDayLogsForKeys(
  source: AttendanceSource,
  start: string,
  end: string,
  keys: string[],
): Promise<DailyLogRow[]> {
  const aliases = uniqueKeys(keys);
  if (!aliases.length || !isDay(start) || !isDay(end)) return [];
  await ensureAttendanceSchema();
  if (source === "biometrics") {
    const result = await query<{
      person_id: string;
      day: string;
      name: string;
      email: string;
      department: string;
      groups: string[];
      role: string;
      designation: string;
      status: string;
      in_time: string;
      out_time: string;
      tracked_time: string;
      manual_time: string;
      break_time: string;
      occupancy: string;
      utilization: string;
      wtr: string;
    }>(
      `SELECT employee_id AS person_id, day, name, email, department, groups, role, designation,
              status, in_time, out_time, tracked_time, manual_time, break_time,
              occupancy, utilization, wtr
       FROM wfm_bio_day_logs
       WHERE day >= $1 AND day <= $2
         AND (lower(employee_id) = ANY($3::text[]) OR lower(email) = ANY($3::text[]) OR lower(name) = ANY($3::text[]))
       ORDER BY day DESC, lower(name)`,
      [start, end, aliases],
    );
    return result.rows.map((row) => toDailyLogRow("biometrics", row));
  }
  const result = await query<{
    person_id: string;
    day: string;
    name: string;
    email: string;
    groups: string[];
    role: string;
    designation: string;
    status: string;
    in_time: string;
    out_time: string;
    tracked_time: string;
    manual_time: string;
    break_time: string;
    occupancy: string;
    utilization: string;
    wtr: string;
    employee_id: string;
    workspace_id: string;
    clocked_in_ms: string | number;
    last_screenshot_ms: string | number;
  }>(
    `SELECT member_id AS person_id, day, name, email, groups, role, designation,
            status, in_time, out_time, tracked_time, manual_time, break_time,
            occupancy, utilization, wtr, employee_id, workspace_id,
            clocked_in_ms, last_screenshot_ms
     FROM wfm_tivazo_day_logs
     WHERE day >= $1 AND day <= $2
       AND (lower(member_id) = ANY($3::text[]) OR lower(employee_id) = ANY($3::text[])
            OR lower(email) = ANY($3::text[]) OR lower(name) = ANY($3::text[]))
     ORDER BY day DESC, lower(name)`,
    [start, end, aliases],
  );
  return result.rows.map((row) => toDailyLogRow("tivazo", row));
}

export async function loadBioMember(id: string): Promise<StoredMember | null> {
  await ensureAttendanceSchema();
  const result = await query<{
    id: string;
    email: string;
    name: string;
    department: string;
    role: string;
    designation: string;
    joined_at: string;
  }>(
    `SELECT id, email, name, department, role, designation, joined_at
     FROM wfm_bio_members
     WHERE id = $1 OR lower(email) = lower($1)
     LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    department: row.department,
    groups: row.department ? [row.department] : [],
    role: row.role,
    designation: row.designation,
    joinedAt: row.joined_at,
    workspaceId: "",
    disabled: false,
  };
}

export async function listHistoryLogs(
  source: AttendanceSource,
  start: string,
  end: string,
  today: string,
): Promise<DailyLogRow[]> {
  const last = historyEnd(end, today);
  if (!isDay(start) || !isDay(last) || start > last) return [];
  return listDayLogs(source, start, last);
}

function asDayKey(value: unknown): string {
  // Calendar day in app zone — never UTC-slice a Date (Kathmandu midnight → prior UTC day).
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDateInZone(value, APP_TIMEZONE);
  }
  const text = asText(value);
  if (text.length >= 10 && isDay(text.slice(0, 10))) return text.slice(0, 10);
  return "";
}

function clockMinutes(label: unknown): number | null {
  const text = asText(label);
  if (!text) return null;
  const match = text.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (meridiem === "AM") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "PM" && hour !== 12) {
    hour += 12;
  }
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

export async function presenceByDay(
  source: AttendanceSource,
  start: string,
  end: string,
  teamNeedle = "",
  memberNeedle = "",
): Promise<Map<string, PresenceDay>> {
  await ensureAttendanceSchema();
  if (!isDay(start) || !isDay(end)) return new Map();
  const table = source === "biometrics" ? "wfm_bio_day_logs" : "wfm_tivazo_day_logs";
  const team = teamNeedle.trim().toLowerCase();
  const member = memberNeedle.trim().toLowerCase();
  const params: string[] = [start, end];
  const clauses: string[] = [];
  if (team) {
    params.push(team);
    const p = `$${params.length}`;
    clauses.push(
      source === "biometrics"
        ? `(lower(department) = ${p} OR lower(department) LIKE '%' || ${p} || '%' OR EXISTS (SELECT 1 FROM unnest(groups) g WHERE lower(g) = ${p} OR lower(g) LIKE '%' || ${p} || '%'))`
        : `EXISTS (SELECT 1 FROM unnest(groups) g WHERE lower(g) = ${p} OR lower(g) LIKE '%' || ${p} || '%')`,
    );
  }
  if (member) {
    params.push(member);
    const p = `$${params.length}`;
    clauses.push(
      source === "biometrics"
        ? `(lower(coalesce(employee_id, '')) = ${p} OR lower(coalesce(email, '')) = ${p} OR lower(coalesce(name, '')) = ${p})`
        : `(lower(coalesce(member_id, '')) = ${p} OR lower(coalesce(employee_id, '')) = ${p} OR lower(coalesce(email, '')) = ${p} OR lower(coalesce(name, '')) = ${p})`,
    );
  }
  const teamClause = clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
  const result = await query<{
    day: string;
    present: number;
    typical_in: string | null;
    typical_out: string | null;
  }>(
    `SELECT day,
            COUNT(*) FILTER (
              WHERE lower(replace(replace(replace(btrim(status), ' ', ''), '_', ''), '-', ''))
                    = 'present'
            )::int AS present,
            MIN(NULLIF(btrim(in_time), '')) FILTER (
              WHERE lower(replace(replace(replace(btrim(status), ' ', ''), '_', ''), '-', ''))
                    = 'present'
            ) AS typical_in,
            MAX(NULLIF(btrim(out_time), '')) FILTER (
              WHERE lower(replace(replace(replace(btrim(status), ' ', ''), '_', ''), '-', ''))
                    = 'present'
            ) AS typical_out
     FROM ${table}
     WHERE day >= $1 AND day <= $2${teamClause}
     GROUP BY day`,
    params,
  );
  return new Map(
    result.rows.flatMap((row) => {
      const day = asDayKey(row.day);
      if (!day) return [];
      return [[
        day,
        {
          day,
          present: Number(row.present) || 0,
          typicalIn: clockMinutes(row.typical_in),
          typicalOut: clockMinutes(row.typical_out),
        },
      ]];
    }),
  );
}

export async function ingestedDays(
  source: AttendanceSource,
  start: string,
  end: string,
): Promise<Map<string, IngestDay>> {
  await ensureAttendanceSchema();
  if (!isDay(start) || !isDay(end)) return new Map();
  const result = await query<{
    day: string;
    sealed: boolean;
    row_count: number;
    present_count: number;
  }>(
    `SELECT day, sealed, row_count, present_count
     FROM wfm_ingest_days
     WHERE source = $1 AND day >= $2 AND day <= $3`,
    [source, start, end],
  );
  return new Map(
    result.rows.flatMap((row) => {
      const day = asDayKey(row.day);
      if (!day) return [];
      return [[
        day,
        {
          day,
          sealed: Boolean(row.sealed),
          rowCount: Number(row.row_count) || 0,
          presentCount: Number(row.present_count) || 0,
        },
      ]];
    }),
  );
}

export async function missingSealedDays(
  source: AttendanceSource,
  start: string,
  end: string,
  today: string,
): Promise<string[]> {
  const last = end < today ? end : previousDay(today);
  if (!isDay(start) || !isDay(last) || start > last) return [];
  const have = await ingestedDays(source, start, last);
  return enumerateDays(start, last).filter((day) => {
    const row = have.get(day);
    return !row?.sealed;
  });
}

export async function rangeIsStored(
  source: AttendanceSource,
  start: string,
  end: string,
  today: string,
): Promise<boolean> {
  if (!isDay(start) || !isDay(end) || start > end) return false;
  if (start >= today) return false;
  const missing = await missingSealedDays(source, start, end, today);
  return missing.length === 0;
}

export function historyEnd(end: string, today: string): string {
  return end < today ? end : previousDay(today);
}

function previousDay(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1, 12, 0, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function persistQuiet(task: Promise<unknown>, label: string): void {
  void task.catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`attendance store ${label}`, message);
  });
}
