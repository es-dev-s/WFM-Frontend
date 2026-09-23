import { datePresets } from "@/lib/date-presets";
import { APP_TIMEZONE, addDaysISO, monthWindows } from "@/lib/datetime";
import {
  historyEnd,
  listDayLogsForKeys,
  listHistoryLogs,
  listMemberDays,
  loadBioMember,
  lookupPersonAliases,
  lookupTeamPersonKeys,
  missingSealedDays,
  ingestedDays,
  presenceByDay,
  persistQuiet,
  rangeIsStored,
  saveAttendance,
  type StoredMember,
} from "@/lib/server/attendance/store";
import { createSnapshotCache } from "@/lib/server/bff-cache";
import { createIdentityIndex, identityCanonical, identityMatchesNeedle } from "@/lib/identity";
import { clockLabelMinutes } from "@/lib/workday-clock";
import type {
  AttentionItem,
  BiomaticSummary,
  DailyEntry,
  DailyLogRow,
  CoverageGaps,
  CoveragePerson,
  DashboardMemberFocus,
  DashboardOverview,
  DashboardRosterPerson,
  FilterOption,
  FilterOptions,
  HourlyPoint,
  HourlySeries,
  PunchCompare,
  LeaderRow,
  Member,
  MemberDetail,
  MemberDirectoryRow,
  SearchHit,
  SearchResponse,
  Team,
  TivazoSummary,
  TrendMetric,
  TrendPoint,
} from "@/lib/api";
import {
  averageHours,
  averageWorkedHours,
  trackedSecondsOf,
  asBool,
  asNumber,
  asString,
  asStringArray,
  enumerateDays,
  formatClock,
  hourInZone,
  humanLabel,
  minuteInZone,
  isOpaqueId,
  percent,
  isPresentAttendance,
  isRestStatus,
  normalizeDayStatus,
  sameDayStatus,
  titleStatus,
  utilization,
  formatHours,
} from "@/lib/server/metrics";
import {
  BIO_ORIGIN,
  BffError,
  TIVAZO_ORIGIN,
  collectPages,
  dateRange,
  pageOf,
  readInt,
  readParam,
  todayInAppZone,
  upstreamGet,
  withParams,
  type JsonMap,
} from "@/lib/server/upstream";
import { isTeamLead } from "@/lib/server/auth/context";
import {
  assertTeamAccess,
  catalogFromGroups,
  filterMembersForLead,
  groupCatalog,
  leadAssignments,
  memberInLeadScope,
  namedTeamOptions,
  restrictTeamOptions,
  rowInLeadScope,
  runWithCatalog,
  teamInLeadScope,
  teamsMatch,
  type GroupCatalogEntry,
} from "@/lib/server/auth/scope";

const TREND_DAYS = 30;

function rollingWindow(end = todayInAppZone(), days = TREND_DAYS) {
  return { start: addDaysISO(end, -(Math.max(1, days) - 1)), end };
}

/** Prefer the dashboard date filter; fall back to a trailing TREND_DAYS window. */
function resolveTrendWindow(start: string | undefined, end: string | undefined, today = todayInAppZone()) {
  const startOk = Boolean(start && /^\d{4}-\d{2}-\d{2}$/.test(start));
  const endOk = Boolean(end && /^\d{4}-\d{2}-\d{2}$/.test(end));
  if (startOk && endOk) {
    let s = start!;
    let e = end! <= today ? end! : today;
    if (s > e) s = e;
    return { start: s, end: e };
  }
  if (endOk) {
    const e = end! <= today ? end! : today;
    return { start: e, end: e };
  }
  if (startOk) {
    const s = start! <= today ? start! : today;
    return { start: s, end: s };
  }
  return rollingWindow(today, TREND_DAYS);
}


function asJsonMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function durationFrom(source: JsonMap, keys: string[]): string {
  for (const key of keys) {
    const seconds = asNumber(source[key]);
    if (seconds > 0) return formatSecondsLabel(seconds);
    const label = asString(source[key]);
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(label)) {
      return label.length === 5 ? `${label}:00` : label;
    }
  }
  return "";
}

function breakLabel(...sources: unknown[]): string {
  const keys = [
    "breakTime",
    "break_time",
    "breakSeconds",
    "break_seconds",
    "idleTime",
    "idle_time",
    "idleSeconds",
    "idle_seconds",
  ];
  for (const source of sources) {
    const label = durationFrom(asJsonMap(source), keys);
    if (label) return label;
  }
  return formatSecondsLabel(0);
}

type BioSummary = {
  employees?: number;
  present?: number;
  absent?: number;
  leave?: number;
  late?: number;
};

type BioEnvelope = {
  ok?: boolean;
  summary?: BioSummary;
  members?: JsonMap[];
  employees?: JsonMap[];
  employee?: JsonMap;
  departments?: JsonMap[];
  roles?: JsonMap[];
  total?: number;
  has_more?: boolean;
  offset?: number;
};

type TivazoSummaryRaw = {
  members?: number;
  present?: number;
  absent?: number;
  groups?: number;
  tracking?: number;
  idle?: number;
  offline?: number;
  activities?: number;
  tracked_seconds?: number;
};

type TivazoEnvelope = {
  ok?: boolean;
  summary?: TivazoSummaryRaw;
  trend?: JsonMap[];
  members?: JsonMap[];
  activities?: JsonMap[];
  groups?: JsonMap[];
  total?: number;
  has_more?: boolean;
  offset?: number;
};

function teamIdFrom(department: string): string {
  return department.trim() ? department.trim() : "unassigned";
}

function teamLabelFrom(department: string): string {
  return department.trim() ? department.trim() : "Unassigned";
}

function emptyComposition() {
  return { agents: 0, leads: 0, supervisors: 0 };
}

function emptyMix() {
  return { voice: 0, chat: 0, backoffice: 0 };
}

function bioMember(raw: JsonMap, date = ""): MemberDirectoryRow {
  const department = asString(raw.department);
  const attendance = normalizeDayStatus(asString(raw.attendance));
  const tracked = asNumber(raw.tracked_seconds);
  const id = asString(raw.id);
  const join = asString(raw.join_date);
  return {
    id,
    employeeId: id,
    teamId: teamIdFrom(department),
    name: asString(raw.name) || "Unknown",
    email: asString(raw.email),
    role: asString(raw.role),
    designation: asString(raw.designation),
    userStatus: attendance,
    reportsTo: "",
    tenureMonths: 0,
    occupancy: attendance === "Present" ? "100%" : "0%",
    utilization: utilization(tracked),
    wtr: utilization(tracked),
    attendance,
    status: attendance,
    dayStatus: attendance,
    inTime: attendanceIn(undefined, raw),
    workspaceId: "",
    groups: department ? [department] : [],
    allTimeWorkHour: 0,
    screenshotFrequency: 0,
    lastActiveAt: "",
    joinedAt: join,
    avatarUrl: "",
    composition: emptyMix(),
    teamName: teamLabelFrom(department),
  };
}

function bioLog(raw: JsonMap, record?: JsonMap): DailyLogRow {
  const rec = record ?? {};
  const date = asString(rec.date) || asString(raw.date);
  const status = normalizeDayStatus(asString(rec.status) || asString(raw.attendance));
  const department = asString(raw.department);
  const id = asString(raw.id);
  const trackedLabel =
    asString(raw.tracked_label) ||
    formatSecondsLabel(asNumber(rec.tivazo_tracked_time));
  const manualLabel =
    asString(raw.manual_label) ||
    formatSecondsLabel(asNumber(rec.tivazo_manual_time));
  return {
    id: date ? `${id}:${date}` : id,
    date,
    rawDate: date,
    name: asString(raw.name) || "Unknown",
    email: asString(raw.email),
    group: teamLabelFrom(department),
    groups: department ? [department] : [],
    role: asString(raw.role),
    designation: asString(raw.designation),
    userStatus: status,
    active: status === "Present" ? "Yes" : "No",
    disabled: "No",
    status,
    inTime: attendanceIn(rec, raw),
    outTime: attendanceOut(rec, raw),
    trackedTime: trackedLabel,
    manualTime: manualLabel,
    breakTime: breakLabel(rec, raw),
    occupancy: status === "Present" ? "100%" : "0%",
    utilization: utilization(asNumber(rec.tivazo_tracked_time) || asNumber(raw.tracked_seconds)),
    wtr: utilization(asNumber(rec.tivazo_tracked_time) || asNumber(raw.tracked_seconds)),
    memberId: id,
    employeeId: id,
    workspaceId: "",
    clockedInMs: 0,
    lastScreenshotMs: 0,
    allTimeWorkHour: 0,
    screenshotFrequency: 0,
    lastActiveAt: "",
    avatarUrl: "",
  };
}

function formatSecondsLabel(total: number): string {
  const value = Math.max(0, Math.floor(total));
  const h = String(Math.floor(value / 3600)).padStart(2, "0");
  const m = String(Math.floor((value % 3600) / 60)).padStart(2, "0");
  const s = String(value % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function groupNameMap(groups: JsonMap[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of [...groups, ...groupCatalog().map((entry) => ({ id: entry.id, name: entry.label, label: entry.label }))]) {
    const id = asString(group.id);
    const name = humanLabel(asString(group.name)) || humanLabel(asString(group.label));
    if (!name) continue;
    if (id) map.set(id, name);
    map.set(name.toLowerCase(), name);
  }
  return map;
}

let tivazoCatalogCache: { key: string; at: number; value: GroupCatalogEntry[] } | null = null;
let tivazoCatalogInflight: { key: string; promise: Promise<GroupCatalogEntry[]> } | null = null;

async function loadTivazoCatalog(start: string, end: string): Promise<GroupCatalogEntry[]> {
  const payload = await settled(
    upstreamGet<TivazoEnvelope>(
      TIVAZO_ORIGIN,
      withParams("/api/v1/groups", { start_date: start, end_date: end }),
    ),
  );
  return catalogFromGroups(payload.ok ? payload.value.groups ?? [] : []);
}

async function fetchTivazoCatalog(_url: URL): Promise<GroupCatalogEntry[]> {
  const today = todayInAppZone();
  const key = "groups";
  if (tivazoCatalogCache && tivazoCatalogCache.key === key && Date.now() - tivazoCatalogCache.at < 60_000) {
    return tivazoCatalogCache.value;
  }
  if (tivazoCatalogInflight && tivazoCatalogInflight.key === key) {
    return tivazoCatalogInflight.promise;
  }
  const promise = loadTivazoCatalog(today, today)
    .then((value) => {
      if (value.length > 0) {
        tivazoCatalogCache = { key, at: Date.now(), value };
        return value;
      }
      if (tivazoCatalogCache) return tivazoCatalogCache.value;
      tivazoCatalogCache = { key, at: Date.now(), value };
      return value;
    })
    .catch(() => tivazoCatalogCache?.value ?? [])
    .finally(() => {
      if (tivazoCatalogInflight?.promise === promise) {
        tivazoCatalogInflight = null;
      }
    });
  tivazoCatalogInflight = { key, promise };
  return promise;
}

const LIVE_FRESH_MS = 15_000;
const LIVE_STALE_MS = 60_000;
const HISTORY_FRESH_MS = 180_000;
const HISTORY_STALE_MS = 1_800_000;

function liveRangeTtl(key: string): { fresh: number; stale: number } {
  const today = todayInAppZone();
  const [start, end] = key.split(":");
  if (!start || !end) return { fresh: LIVE_FRESH_MS, stale: LIVE_STALE_MS };
  if (start === end && start === today) {
    return { fresh: LIVE_FRESH_MS, stale: LIVE_STALE_MS };
  }
  return { fresh: HISTORY_FRESH_MS, stale: HISTORY_STALE_MS };
}

type TivazoLiveSnap = { members: JsonMap[]; groups: JsonMap[] };

const bioLiveCache = createSnapshotCache<JsonMap[]>({ max: 32, ttl: liveRangeTtl, redis: "bio-live" });
const tivazoLiveCache = createSnapshotCache<TivazoLiveSnap>({ max: 32, ttl: liveRangeTtl, redis: "tivazo-live" });
const bioEmployeesCache = createSnapshotCache<JsonMap[]>({ max: 16, ttl: liveRangeTtl, redis: "bio-employees" });
const tivazoActivitiesCache = createSnapshotCache<JsonMap[]>({ max: 16, ttl: liveRangeTtl, redis: "tivazo-acts" });
const dailyLogRowsCache = createSnapshotCache<DailyLogRow[]>({ max: 16, ttl: liveRangeTtl, redis: "bio-logs" });
const activityRowsCache = createSnapshotCache<DailyLogRow[]>({ max: 16, ttl: liveRangeTtl, redis: "tivazo-logs" });
const overviewCache = createSnapshotCache<DashboardOverview>({ max: 16, ttl: liveRangeTtl, redis: "overview" });
const bioFiltersCache = createSnapshotCache<BioEnvelope>({
  max: 2,
  ttl: () => ({ fresh: 60_000, stale: 180_000 }),
  redis: "bio-filters",
});
const trendSeriesCache = createSnapshotCache<Map<string, { clockIns: number; tracked: number }>>({
  max: 12,
  ttl: () => ({ fresh: 15_000, stale: 60_000 }),
});

async function loadUnfilteredBioLive(start: string, end: string): Promise<JsonMap[]> {
  return collectPages(async (offset, limit) => {
    const payload = await upstreamGet<BioEnvelope>(
      BIO_ORIGIN,
      withParams("/api/v1/live", { start_date: start, end_date: end, limit, offset }),
    );
    return {
      items: payload.members ?? [],
      total: asNumber(payload.total),
      hasMore: Boolean(payload.has_more),
    };
  });
}

async function cachedBioLive(start: string, end: string): Promise<JsonMap[]> {
  return bioLiveCache.get(`${start}:${end}`, async () => {
    const members = await loadUnfilteredBioLive(start, end);
    if (start === end) persistQuiet(persistBioLiveDay(members, start), "bio-live");
    return members;
  });
}

async function loadUnfilteredTivazoLive(start: string, end: string): Promise<TivazoLiveSnap> {
  let groups: JsonMap[] = [];
  const members = await collectPages(async (offset, limit) => {
    const payload = await upstreamGet<TivazoEnvelope>(
      TIVAZO_ORIGIN,
      withParams("/api/v1/live", { start_date: start, end_date: end, limit, offset }),
    );
    if (!groups.length) groups = payload.groups ?? [];
    return {
      items: payload.members ?? [],
      total: asNumber(payload.total),
      hasMore: Boolean(payload.has_more),
    };
  });
  return { members, groups };
}

async function cachedTivazoLive(start: string, end: string): Promise<TivazoLiveSnap> {
  return tivazoLiveCache.get(`${start}:${end}`, async () => {
    const snap = await loadUnfilteredTivazoLive(start, end);
    if (start === end) persistQuiet(persistTivazoLiveDay(snap.members, start), "tivazo-live");
    return snap;
  });
}

async function cachedBioEmployees(start: string, end: string): Promise<JsonMap[]> {
  return bioEmployeesCache.get(`${start}:${end}`, () =>
    collectPages(async (offset, limit) => {
      const payload = await upstreamGet<BioEnvelope>(
        BIO_ORIGIN,
        withParams("/api/v1/employees", { start_date: start, end_date: end, limit, offset }),
      );
      return {
        items: payload.employees ?? payload.members ?? [],
        total: asNumber(payload.total),
        hasMore: Boolean(payload.has_more),
      };
    }),
  );
}

async function cachedTivazoActivities(start: string, end: string): Promise<JsonMap[]> {
  return tivazoActivitiesCache.get(`${start}:${end}`, () =>
    collectPages(async (offset, limit) => {
      const payload = await upstreamGet<TivazoEnvelope>(
        TIVAZO_ORIGIN,
        withParams("/api/v1/activities", { start_date: start, end_date: end, limit, offset }),
      );
      return {
        items: payload.activities ?? [],
        total: asNumber(payload.total),
        hasMore: Boolean(payload.has_more),
      };
    }),
  );
}

function attendancesOf(row: JsonMap): JsonMap[] {
  return Array.isArray(row.attendances) ? (row.attendances as JsonMap[]) : [];
}

function mergeEmployeeMonths(parts: JsonMap[][]): JsonMap[] {
  const map = new Map<string, JsonMap>();
  for (const list of parts) {
    for (const employee of list) {
      const id = asString(employee.id) || asString(employee.email).toLowerCase();
      if (!id) continue;
      const prev = map.get(id);
      if (!prev) {
        map.set(id, { ...employee, attendances: attendancesOf(employee).slice() });
        continue;
      }
      const seen = new Set(attendancesOf(prev).map((rec) => asString(rec.date)));
      const attendances = attendancesOf(prev).slice();
      for (const rec of attendancesOf(employee)) {
        const date = asString(rec.date);
        if (!date || seen.has(date)) continue;
        seen.add(date);
        attendances.push(rec);
      }
      map.set(id, { ...prev, ...employee, attendances });
    }
  }
  return [...map.values()];
}

async function loadBioEmployeesRange(start: string, end: string): Promise<JsonMap[]> {
  const windows = monthWindows(start, end);
  const employees =
    windows.length <= 1
      ? await cachedBioEmployees(start, end)
      : mergeEmployeeMonths(await Promise.all(windows.map((window) => cachedBioEmployees(window.start, window.end))));
  persistQuiet(persistBioEmployees(employees, start, end), "bio-employees");
  return employees;
}

async function loadTivazoActivitiesRange(start: string, end: string): Promise<JsonMap[]> {
  const windows = monthWindows(start, end);
  const acts =
    windows.length <= 1
      ? await cachedTivazoActivities(start, end)
      : (await Promise.all(windows.map((window) => cachedTivazoActivities(window.start, window.end)))).flat();
  persistQuiet(persistTivazoActivities(acts, start, end), "tivazo-activities");
  return acts;
}

function employeesToRangeMembers(employees: JsonMap[], start: string, end: string): JsonMap[] {
  return employees.map((employee) => {
    const recs = attendancesOf(employee).filter((rec) => {
      const date = asString(rec.date);
      return date >= start && date <= end;
    });
    const presentRecs = recs.filter(
      (rec) => normalizeDayStatus(asString(rec.status) || asString(rec.attendance)) === "Present",
    );
    const first = presentRecs[0] ?? recs[0];
    const last = presentRecs[presentRecs.length - 1] ?? recs[recs.length - 1];
    return {
      ...employee,
      attendance: presentRecs.length ? "present" : recs.length ? asString(recs[0].status) || "absent" : "absent",
      start_time: attendanceIn(first, employee),
      end_time: attendanceOut(last, employee),
    };
  });
}

function activitiesToRangeMembers(
  acts: JsonMap[],
  liveMembers: JsonMap[],
  start: string,
  end: string,
): JsonMap[] {
  const byId = new Map<string, JsonMap>();
  for (const member of liveMembers) {
    const id = asString(member.id) || asString(member.email).toLowerCase();
    if (!id) continue;
    // Reset tracked aggregates — live partial-day seconds must not dilute range averages.
    byId.set(id, {
      ...member,
      attendance: "absent",
      tracked_seconds: 0,
      present_days: 0,
      attended_days: 0,
      absent_days: 0,
      tracked_label: "",
    });
  }
  for (const act of acts) {
    const date = asString(act.date);
    if (date && (date < start || date > end)) continue;
    const id = asString(act.memberID) || asString(act.email).toLowerCase();
    if (!id) continue;
    const prev =
      byId.get(id) ||
      ({
        id: asString(act.memberID) || id,
        email: asString(act.email),
        name: asString(act.email) || "Unknown",
        attendance: "absent",
        groups: [],
        tracked_seconds: 0,
        present_days: 0,
        attended_days: 0,
        absent_days: 0,
      } as JsonMap);
    const dayTracked = trackedSecondsOf(act.trackedTime);
    const dayStatus = normalizeDayStatus(asString(act.status) || asString(act.attendance));
    // Salary-safe: never promote Half day / Leave / Absent to Present just because a punch exists.
    const isPresent =
      dayStatus === "Present" ||
      (!dayStatus && (dayTracked > 0 || asNumber(act.clocked_in) > 0));
    if (isPresent) {
      prev.attendance = "present";
      if (!asString(prev.clocked_in)) prev.clocked_in = clockLabel(asNumber(act.clocked_in));
      const shot = clockLabel(asNumber(act.last_taken_screenshot));
      if (shot) prev.last_screenshot = shot;
      prev.tracked_seconds = asNumber(prev.tracked_seconds) + dayTracked;
      prev.attended_days = asNumber(prev.attended_days) + 1;
      // Denominator for Avg Work Hour: only days that actually contributed tracked time.
      if (dayTracked > 0) prev.present_days = asNumber(prev.present_days) + 1;
      prev.tracked_label = formatSecondsLabel(asNumber(prev.tracked_seconds));
    } else if (!isRestStatus(dayStatus)) {
      prev.absent_days = asNumber(prev.absent_days) + 1;
    }
    byId.set(id, prev);
  }
  return [...byId.values()];
}

async function cachedBioFilters(start: string, end: string): Promise<BioEnvelope> {
  return bioFiltersCache.get("filters", () =>
    upstreamGet<BioEnvelope>(
      BIO_ORIGIN,
      withParams("/api/v1/filters", { start_date: start, end_date: end }),
    ),
  );
}

function warmNeighborDays(day: string) {
  const today = todayInAppZone();
  const prev = addDaysISO(day, -1);
  const next = addDaysISO(day, 1);
  void cachedBioLive(prev, prev).catch(() => undefined);
  void cachedTivazoLive(prev, prev).catch(() => undefined);
  if (next <= today) {
    void cachedBioLive(next, next).catch(() => undefined);
    void cachedTivazoLive(next, next).catch(() => undefined);
  }
}

function warmLiveSnapshots(_start: string, _end: string) {
  const today = todayInAppZone();
  void cachedBioLive(today, today).catch(() => undefined);
  void cachedTivazoLive(today, today).catch(() => undefined);
  warmNeighborDays(today);
}

function scopeCacheKey(): string {
  if (!isTeamLead()) return "org";
  const assigned = (leadAssignments() ?? [])
    .map((item) => `${item.source}:${item.teamId}`)
    .sort()
    .join("|");
  return assigned || "lead";
}

let presetWarmStarted = false;

function schedulePresetWarm() {
  if (presetWarmStarted) return;
  presetWarmStarted = true;
  const today = todayInAppZone();
  warmLiveSnapshots(today, today);
}

function matchesLiveQuery(row: JsonMap, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [asString(row.name), asString(row.email), asString(row.designation), asString(row.id)].some(
    (value) => value.toLowerCase().includes(needle),
  );
}

function matchesBioDepartment(department: string, teamId: string): boolean {
  if (!teamId || teamId === "all") return true;
  const got = department.trim();
  const want = teamId.trim().toLowerCase();
  if (want === "unassigned" || want === "__unassigned__") return got === "";
  if (teamsMatch(got, teamId) || teamsMatch(teamIdFrom(got), teamId)) return true;
  return got.toLowerCase().includes(want);
}

function filterBioLiveMembers(members: JsonMap[], url: URL): JsonMap[] {
  const teamId = readParam(url, "teamId", "department");
  const role = readParam(url, "role");
  const q = readParam(url, "q");
  const status = readParam(url, "status", "dayStatus");
  return members.filter((row) => {
    if (!matchesLiveQuery(row, q)) return false;
    if (status && !sameDayStatus(asString(row.attendance), status)) return false;
    if (role && asString(row.role).toLowerCase() !== role.toLowerCase()) return false;
    if (teamId && teamId !== "all" && !matchesBioDepartment(asString(row.department), teamId)) {
      return false;
    }
    return true;
  });
}

function matchesTivazoStatus(row: JsonMap, status: string): boolean {
  const want = status.trim().toLowerCase();
  if (!want) return true;
  const attendance = asString(row.attendance).toLowerCase();
  const live = asString(row.status).toLowerCase();
  if (attendance === want || live === want) return true;
  if (want === "active" || want === "tracking") return live === "active" || live === "tracking";
  if (want === "present" || want === "absent" || want === "leave") {
    return sameDayStatus(asString(row.attendance), status);
  }
  return false;
}

function filterTivazoLiveMembers(members: JsonMap[], url: URL): JsonMap[] {
  const group = readParam(url, "group", "teamId");
  const q = readParam(url, "q");
  const status = readParam(url, "status");
  const attendance = readParam(url, "attendance");
  const catalog = groupNameMap([]);
  return members.filter((row) => {
    if (!matchesLiveQuery(row, q)) return false;
    if (group && group !== "all" && group !== "unassigned" && !memberInTeam(row, group, catalog)) {
      return false;
    }
    if (status && !matchesTivazoStatus(row, status)) return false;
    if (!status && attendance && asString(row.attendance).toLowerCase() !== attendance.toLowerCase()) {
      return false;
    }
    return true;
  });
}

function resolveGroupNames(raw: string[], catalog: Map<string, string>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const alreadyNamed = humanLabel(value);
    const mapped =
      alreadyNamed || catalog.get(value) || catalog.get(value.toLowerCase());
    if (!mapped || seen.has(mapped.toLowerCase())) continue;
    seen.add(mapped.toLowerCase());
    names.push(mapped);
  }
  return names;
}

function readableEmployeeId(rawId: string, email: string, bioByEmail: Map<string, string>): string {
  const fromBio = bioByEmail.get(email.toLowerCase());
  if (fromBio) return fromBio;
  return humanLabel(rawId);
}

function decorateTivazoRow(
  row: DailyLogRow,
  catalog: Map<string, string>,
  bioByEmail: Map<string, string>,
): DailyLogRow {
  const groups = resolveGroupNames(row.groups.length ? row.groups : [row.group], catalog);
  return {
    ...row,
    groups,
    group: groups[0] || "",
    employeeId: readableEmployeeId(row.employeeId, row.email, bioByEmail),
  };
}

async function bioEmployeeIdsByEmail(): Promise<Map<string, string>> {
  const today = todayInAppZone();
  const members = await cachedBioLive(today, today);
  const map = new Map<string, string>();
  for (const member of members) {
    const email = asString(member.email).toLowerCase();
    const id = humanLabel(asString(member.id));
    if (email && id) map.set(email, id);
  }
  return map;
}

function liveForDate(raw: JsonMap | undefined, date: string): {
  userStatus: string;
  active: string;
  lastActiveAt: string;
} {
  if (!raw || (date && date !== todayInAppZone())) {
    return { userStatus: "", active: "", lastActiveAt: "" };
  }
  return {
    userStatus: titleStatus(asString(raw.status)),
    active: asBool(raw.active) ? "Yes" : "No",
    lastActiveAt: asNumber(raw.last_active_at)
      ? new Date(asNumber(raw.last_active_at)).toISOString()
      : "",
  };
}

function tivazoMemberRow(raw: JsonMap, date: string): DailyLogRow {
  const groups = asStringArray(raw.groups);
  const attendance = normalizeDayStatus(asString(raw.attendance));
  const live = liveForDate(raw, date);
  const id = asString(raw.id);
  const clockedMs = clockMs(raw.activity) || parseClockLabel(asString(raw.clocked_in), date);
  const shotMs = screenshotMs(raw.activity);
  return {
    id: date ? `${id}:${date}` : id,
    date,
    rawDate: date,
    name: asString(raw.name) || "Unknown",
    email: asString(raw.email),
    group: groups[0] || "",
    groups,
    role: asString(raw.role),
    designation: asString(raw.designation).trim(),
    userStatus: live.userStatus,
    active: live.active,
    disabled: asBool(raw.disabled) ? "Yes" : "No",
    status: attendance,
    inTime: memberClock(raw.clocked_in) || clockLabel(clockedMs),
    outTime: memberClock(raw.last_screenshot) || clockLabel(shotMs),
    trackedTime: asString(raw.tracked_label) || formatSecondsLabel(asNumber(raw.tracked_seconds)),
    manualTime: asString(raw.manual_label) || formatSecondsLabel(asNumber(raw.manual_seconds)),
    breakTime: breakLabel(raw.activity, raw.user, raw),
    occupancy: attendance === "Present" ? "100%" : "0%",
    utilization: utilization(asNumber(raw.tracked_seconds)),
    wtr: utilization(asNumber(raw.tracked_seconds)),
    memberId: id,
    employeeId: id,
    workspaceId: asString(raw.workspace_id),
    clockedInMs: clockedMs,
    lastScreenshotMs: shotMs,
    allTimeWorkHour: asNumber((raw.user as JsonMap | undefined)?.allTimeWorkHour),
    screenshotFrequency: asNumber((raw.user as JsonMap | undefined)?.screenshotFrequency),
    lastActiveAt: live.lastActiveAt,
    avatarUrl: asString((raw.user as JsonMap | undefined)?.avatarUrl),
  };
}

function clockMs(activity: unknown): number {
  if (!activity || typeof activity !== "object") return 0;
  return asNumber((activity as JsonMap).clocked_in);
}

function screenshotMs(activity: unknown): number {
  if (!activity || typeof activity !== "object") return 0;
  return asNumber((activity as JsonMap).last_taken_screenshot);
}

function parseClockLabel(label: string, date: string): number {
  if (!label || !date) return 0;
  const [h, m, s] = label.split(":").map(Number);
  if (!Number.isFinite(h)) return 0;
  const iso = `${date}T${String(h).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}:${String(s || 0).padStart(2, "0")}+05:45`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function activityRow(act: JsonMap, member: JsonMap | undefined, fallbackDate: string): DailyLogRow {
  const date = asString(act.date) || fallbackDate;
  const memberId = asString(act.memberID) || asString(member?.id);
  const groups = asStringArray(member?.groups);
  const tracked = trackedSecondsOf(act.trackedTime);
  const present =
    tracked > 0 || asNumber(act.clocked_in) > 0 || asNumber(act.last_taken_screenshot) > 0;
  const status = present ? "Present" : "Absent";
  const live = liveForDate(member, date);
  return {
    id: date ? `${memberId}:${date}` : memberId,
    date,
    rawDate: date,
    name: asString(member?.name) || asString(act.email) || "Unknown",
    email: asString(member?.email) || asString(act.email),
    group: groups[0] || "",
    groups,
    role: asString(member?.role),
    designation: asString(member?.designation).trim(),
    userStatus: live.userStatus,
    active: live.active,
    disabled: asBool(member?.disabled) ? "Yes" : "No",
    status,
    inTime: clockLabel(asNumber(act.clocked_in)),
    outTime: clockLabel(asNumber(act.last_taken_screenshot)),
    trackedTime: formatSecondsLabel(tracked),
    manualTime: formatSecondsLabel(asNumber(act.manualTime)),
    breakTime: breakLabel(act, act.payload, member?.activity, member),
    occupancy: present ? "100%" : "0%",
    utilization: utilization(tracked),
    wtr: utilization(tracked),
    memberId,
    employeeId: memberId,
    workspaceId: asString(act.workspaceID) || asString(member?.workspace_id),
    clockedInMs: asNumber(act.clocked_in),
    lastScreenshotMs: asNumber(act.last_taken_screenshot),
    allTimeWorkHour: asNumber((member?.user as JsonMap | undefined)?.allTimeWorkHour),
    screenshotFrequency: asNumber((member?.user as JsonMap | undefined)?.screenshotFrequency),
    lastActiveAt: live.lastActiveAt,
    avatarUrl: asString((member?.user as JsonMap | undefined)?.avatarUrl),
  };
}

function clockLabel(ms: number): string {
  if (!ms) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function memberClock(raw: unknown): string {
  const label = asString(raw);
  if (/^\d{1,2}:\d{2}/.test(label)) return formatClock(label);
  return clockLabel(asNumber(raw)) || formatClock(label);
}

function attendanceIn(rec?: JsonMap, raw?: JsonMap): string {
  return formatClock(
    asString(rec?.start_time) ||
      asString(rec?.in_time) ||
      asString(raw?.start_time) ||
      asString(raw?.in_time) ||
      asString(raw?.clocked_in),
  );
}

function attendanceOut(rec?: JsonMap, raw?: JsonMap): string {
  return formatClock(
    asString(rec?.end_time) ||
      asString(rec?.out_time) ||
      asString(raw?.end_time) ||
      asString(raw?.out_time),
  );
}

function withDayRange(url: URL, start: string, end: string): URL {
  const next = new URL(url.toString());
  next.searchParams.set("startDate", start);
  next.searchParams.set("endDate", end);
  next.searchParams.delete("start_date");
  next.searchParams.delete("end_date");
  return next;
}

function overlayLiveMembers(history: JsonMap[], live: JsonMap[]): JsonMap[] {
  const map = new Map<string, JsonMap>();
  const keyOf = (row: JsonMap) => asString(row.email).toLowerCase() || asString(row.id);
  for (const row of history) {
    const key = keyOf(row);
    if (key) map.set(key, { ...row });
    else map.set(`anon:${map.size}`, { ...row });
  }
  for (const row of live) {
    const key = keyOf(row);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      continue;
    }
    const livePresent = asString(row.attendance).toLowerCase() === "present";
    const histPresent = asString(prev.attendance).toLowerCase() === "present";
    map.set(key, {
      ...prev,
      ...row,
      attendance: livePresent || histPresent ? "present" : asString(row.attendance) || asString(prev.attendance),
      start_time: asString(row.start_time) || asString(prev.start_time),
      end_time: asString(row.end_time) || asString(prev.end_time),
      in_time: asString(row.in_time) || asString(prev.in_time),
      clocked_in: asString(row.clocked_in) || asString(prev.clocked_in),
      last_screenshot: asString(row.last_screenshot) || asString(prev.last_screenshot),
      attendances: prev.attendances,
      groups: asStringArray(row.groups).length ? asStringArray(row.groups) : asStringArray(prev.groups),
      department: asString(row.department) || asString(prev.department),
      // Live partial-day rows must not wipe range day tallies.
      present_days: asNumber(prev.present_days),
      attended_days: asNumber(prev.attended_days),
      absent_days: asNumber(prev.absent_days),
      tracked_seconds: Math.max(asNumber(prev.tracked_seconds), asNumber(row.tracked_seconds)),
      tracked_label: asString(prev.tracked_label) || asString(row.tracked_label),
    });
  }
  return [...map.values()];
}

async function bioLive(url: URL, _signal?: AbortSignal, all = false) {
  const { start, end } = dateRange(url);
  const members = filterBioLiveMembers(await cachedBioLive(start, end), url);
  if (all) {
    return { members, summary: undefined as BioSummary | undefined, total: members.length };
  }
  const page = pageOf(members, readInt(url, "offset", 0), readInt(url, "limit", 50));
  return {
    members: page.items,
    summary: undefined as BioSummary | undefined,
    total: page.total,
    hasMore: page.hasMore,
    offset: page.offset,
    limit: page.limit,
  };
}

async function bioEmployeesAll(url: URL, _signal?: AbortSignal): Promise<JsonMap[]> {
  const { start, end } = dateRange(url);
  return filterBioLiveMembers(await loadBioEmployeesRange(start, end), url);
}

async function tivazoLive(url: URL, _signal?: AbortSignal, all = false) {
  const { start, end } = dateRange(url);
  const snap = await cachedTivazoLive(start, end);
  const members = filterTivazoLiveMembers(snap.members, url);
  if (all) {
    return {
      members,
      summary: undefined as TivazoSummaryRaw | undefined,
      groups: snap.groups,
      total: members.length,
    };
  }
  const page = pageOf(members, readInt(url, "offset", 0), readInt(url, "limit", 50));
  return {
    members: page.items,
    summary: undefined as TivazoSummaryRaw | undefined,
    groups: snap.groups,
    total: page.total,
    hasMore: page.hasMore,
  };
}

async function settled<T>(
  task: Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: BffError }> {
  try {
    return { ok: true, value: await task };
  } catch (error) {
    if (error instanceof BffError) return { ok: false, error };
    const message = error instanceof Error ? error.message : "Request failed";
    return { ok: false, error: new BffError(502, "network_error", message) };
  }
}

export async function handleBff(path: string[], request: Request): Promise<unknown> {
  const url = new URL(request.url);
  const signal = request.signal;
  const key = path.join("/");
  if (key === "health") return health(signal);
  const { start, end } = dateRange(url);
  scheduleAttendanceBackfill();
  warmLiveSnapshots(start, end);
  const catalog = await fetchTivazoCatalog(url);
  return runWithCatalog(catalog, () => dispatchBff(path, url, signal));
}

async function dispatchBff(path: string[], url: URL, signal?: AbortSignal): Promise<unknown> {
  const key = path.join("/");

  switch (key) {
    case "filters":
      return filters(url, signal);
    case "search":
      return search(url, signal);
    case "dashboard/overview":
      return dashboardOverview(url, signal);
    case "dashboard/trend":
      return dashboardTrend(url, signal);
    case "dashboard/presence":
      return dashboardPresence(url);
    case "biomatic/summary":
      return biomaticSummary(url, signal);
    case "teams":
      return teams(url, signal);
    case "members":
      return members(url, signal);
    case "daily-logs":
      return dailyLogs(url, signal);
    case "tivazo/groups":
      return tivazoGroups(url, signal);
    case "tivazo/summary":
      return tivazoSummary(url, signal);
    case "tivazo/activities":
      return tivazoActivities(url, signal);
    case "tivazo/activity":
      return tivazoActivity(url, signal);
    default:
      break;
  }

  if (path[0] === "teams" && path[1] && path[2] === "members") {
    return teamMembers(path[1], url, signal);
  }
  if (path[0] === "teams" && path[1] && path.length === 2) {
    return teamDetail(path[1], url, signal);
  }
  if (path[0] === "members" && path[1] && path[2] === "detail") {
    return memberDetail(path[1], url, signal);
  }
  if (path[0] === "members" && path[1] && path.length === 2) {
    return memberDetail(path[1], url, signal).then((detail) => (detail as MemberDetail).member);
  }
  if (path[0] === "daily-logs" && path[1]) {
    return dailyLogDetail(decodeURIComponent(path[1]), url, signal);
  }

  throw new BffError(404, "not_found", "Unknown API path");
}

async function health(signal?: AbortSignal) {
  const [bio, tivazo] = await Promise.all([
    settled(upstreamGet<JsonMap>(BIO_ORIGIN, "/healthz", signal)),
    settled(upstreamGet<JsonMap>(TIVAZO_ORIGIN, "/healthz", signal)),
  ]);
  const ok = bio.ok && tivazo.ok;
  return {
    status: ok ? "ok" : "degraded",
    bio: bio.ok ? bio.value : { error: bio.error.message },
    tivazo: tivazo.ok ? tivazo.value : { error: tivazo.error.message },
  };
}

async function biomaticSummary(url: URL, signal?: AbortSignal): Promise<BiomaticSummary> {
  assertTeamAccess(readParam(url, "teamId", "department"), "", "biometrics");
  const { members } = await bioLive(url, signal, true);
  return recountBio(filterMembersForLead(members, "biometrics"));
}

async function tivazoSummary(url: URL, signal?: AbortSignal): Promise<TivazoSummary> {
  assertTeamAccess(readParam(url, "group", "teamId"), "", "tivazo");
  const { members } = await tivazoLive(url, signal, true);
  return recountTivazo(filterMembersForLead(members, "tivazo"));
}

export async function filters(url: URL, signal?: AbortSignal): Promise<FilterOptions> {
  const catalog = groupCatalog().length ? groupCatalog() : await fetchTivazoCatalog(url);
  return runWithCatalog(catalog, () => buildFilters(url, catalog, signal));
}

async function buildFilters(
  url: URL,
  catalog: GroupCatalogEntry[],
  signal?: AbortSignal,
): Promise<FilterOptions> {
  const complete = readParam(url, "complete") === "1";
  const range = dateRange(url);
  const bio = await settled(cachedBioFilters(range.start, range.end));
  const teams: FilterOption[] = [];
  if (bio.ok) {
    for (const dept of bio.value.departments ?? []) {
      const id = asString(dept.id) || asString(dept.label);
      if (!id) continue;
      const label = humanLabel(asString(dept.label) || asString(dept.name)) || id;
      teams.push({ id, label });
    }
  }
  const roles: FilterOption[] = [];
  if (bio.ok) {
    for (const role of bio.value.roles ?? []) {
      const id = asString(role.id) || asString(role.label);
      if (!id) continue;
      roles.push({
        id,
        label: asString(role.label) || id,
      });
    }
  }
  const extraDepts: FilterOption[] = [];
  if (complete) {
    const liveBio = await settled(bioLive(url, signal, true));
    if (liveBio.ok) {
      for (const row of liveBio.value.members) {
        const department = asString(row.department);
        if (!department) continue;
        extraDepts.push({
          id: teamIdFrom(department),
          label: teamLabelFrom(department),
        });
      }
    }
  }
  return {
    teams: restrictTeamOptions(mergeOptions(teams, extraDepts), "biometrics"),
    supervisors: restrictTeamOptions(namedTeamOptions(catalog), "tivazo"),
    roles: mergeOptions(roles, []),
    members: [],
  };
}

async function teams(url: URL, signal?: AbortSignal): Promise<Team[]> {
  const { members } = await bioLive(url, signal, true);
  const scoped = filterMembersForLead(members, "biometrics");
  const buckets = new Map<string, { name: string; people: JsonMap[] }>();
  for (const member of scoped) {
    const name = teamLabelFrom(asString(member.department));
    const id = teamIdFrom(asString(member.department));
    const bucket = buckets.get(id) ?? { name, people: [] };
    bucket.people.push(member);
    buckets.set(id, bucket);
  }
  const q = readParam(url, "q").toLowerCase();
  return [...buckets.entries()]
    .map(([id, bucket]) => toTeam(id, bucket.name, bucket.people))
    .filter((team) => teamInLeadScope(team.id, team.name, "biometrics"))
    .filter((team) => !q || team.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toTeam(id: string, name: string, people: JsonMap[]): Team {
  const present = people.filter((m) => asString(m.attendance) === "present").length;
  const tracked = people.reduce((sum, m) => sum + asNumber(m.tracked_seconds), 0);
  const composition = emptyComposition();
  for (const person of people) {
    const role = asString(person.role).toLowerCase();
    if (role.includes("supervis")) composition.supervisors += 1;
    else if (role.includes("lead")) composition.leads += 1;
    else composition.agents += 1;
  }
  return {
    id,
    name,
    members: people.length,
    occupancy: percent(present, people.length),
    utilization: utilization(tracked, people.length || 1),
    wtr: utilization(tracked, people.length || 1),
    attendance: percent(present, people.length),
    composition,
  };
}

async function teamDetail(id: string, url: URL, signal?: AbortSignal): Promise<Team> {
  const decoded = decodeURIComponent(id);
  assertTeamAccess(decoded, "", "biometrics");
  url.searchParams.set("teamId", decoded);
  const list = await teams(url, signal);
  const match = list.find((team) => team.id === decoded);
  if (!match) throw new BffError(404, "not_found", "Department not found");
  return match;
}

async function teamMembers(id: string, url: URL, signal?: AbortSignal): Promise<Member[]> {
  const decoded = decodeURIComponent(id);
  assertTeamAccess(decoded, "", "biometrics");
  url.searchParams.set("teamId", decoded);
  const { members } = await bioLive(url, signal, true);
  return filterMembersForLead(members, "biometrics")
    .filter((row) => {
      const department = asString(row.department);
      const deptId = teamIdFrom(department);
      return (
        teamsMatch(deptId, decoded) ||
        teamsMatch(teamLabelFrom(department), decoded)
      );
    })
    .map((row) => bioMember(row, dateRange(url).end));
}

async function bioRosterForRange(start: string, end: string): Promise<JsonMap[]> {
  const today = todayInAppZone();
  if (start === end) return cachedBioLive(start, end);
  const stored = await rangeIsStored("biometrics", start, end, today).catch(() => false);
  if (stored) {
    const logs = await listHistoryLogs("biometrics", start, end, today).catch(() => [] as DailyLogRow[]);
    let raw = employeesToRangeMembers(logsToBioMembers(logs), start, end);
    if (end >= today) {
      const live = await cachedBioLive(today, today).catch(() => [] as JsonMap[]);
      raw = overlayLiveMembers(raw, live);
    }
    if (raw.length) return raw;
  }
  const employees = await loadBioEmployeesRange(start, end).catch(() => [] as JsonMap[]);
  if (employees.length) {
    let raw = employeesToRangeMembers(employees, start, end);
    if (end >= today) {
      const live = await cachedBioLive(today, today).catch(() => [] as JsonMap[]);
      raw = overlayLiveMembers(raw, live);
    }
    return raw;
  }
  return cachedBioLive(start, end);
}

async function members(url: URL, _signal?: AbortSignal) {
  assertTeamAccess(readParam(url, "teamId", "department"), "", "biometrics");
  const { start, end } = dateRange(url);
  const raw = await bioRosterForRange(start, end);
  const scoped = filterMembersForLead(raw, "biometrics");
  const items = scoped.map((row) => bioMember(row, end || start));
  if (readParam(url, "all") === "1") {
    return { items, total: items.length, limit: items.length, offset: 0, hasMore: false };
  }
  return pageOf(items, readInt(url, "offset", 0), readInt(url, "limit", 40));
}

async function memberDetail(id: string, url: URL, signal?: AbortSignal): Promise<MemberDetail> {
  const decoded = decodeURIComponent(id);
  const { start, end } = dateRange(url);
  const today = todayInAppZone();
  const stored = await rangeIsStored("biometrics", start, end, today).catch(() => false);
  if (stored) {
    const person = await loadBioMember(decoded);
    const histEnd = historyEnd(end, today);
    const logs = (
      start <= histEnd
        ? await listMemberDays("biometrics", person?.id || decoded, start, histEnd)
        : []
    ).filter((row) =>
      memberInLeadScope(
        {
          id: row.employeeId,
          email: row.email,
          department: row.group,
          teamId: row.group,
          teamName: row.group,
        },
        undefined,
        "biometrics",
      ),
    );
    let dailyEntries: DailyEntry[] = logs
      .filter((row) => row.date !== today)
      .map((row) => ({
        id: row.id,
        date: row.date,
        status: normalizeDayStatus(row.status),
        inTime: row.inTime,
        outTime: row.outTime,
        occupancy: row.occupancy,
        utilization: row.utilization,
        wtr: row.wtr,
      }));
    if (end >= today) {
      const live = await cachedBioLive(today, today).catch(() => [] as JsonMap[]);
      const hit =
        live.find((row) => asString(row.id) === (person?.id || decoded) || asString(row.email).toLowerCase() === (person?.email || decoded).toLowerCase()) ??
        null;
      if (hit) {
        const recs = attendancesOf(hit);
        const rec = recs.find((item) => asString(item.date) === today) ?? {
          date: today,
          status: asString(hit.attendance),
          start_time: asString(hit.start_time),
          end_time: asString(hit.end_time),
        };
        dailyEntries = [
          {
            id: `${asString(hit.id)}:${today}`,
            date: today,
            status: normalizeDayStatus(asString(rec.status) || asString(hit.attendance)),
            inTime: attendanceIn(rec, hit),
            outTime: attendanceOut(rec, hit),
            occupancy: normalizeDayStatus(asString(rec.status) || asString(hit.attendance)) === "Present" ? "100%" : "0%",
            utilization: utilization(asNumber(hit.tracked_seconds)),
            wtr: utilization(asNumber(hit.tracked_seconds)),
          },
          ...dailyEntries.filter((row) => row.date !== today),
        ];
      }
    }
    dailyEntries.sort((a, b) => b.date.localeCompare(a.date));
    if (person || dailyEntries.length) {
      const raw = {
        id: person?.id || logs[0]?.employeeId || decoded,
        name: person?.name || logs[0]?.name || "Unknown",
        email: person?.email || logs[0]?.email || "",
        department: person?.department || logs[0]?.group || "",
        role: person?.role || logs[0]?.role || "",
        designation: person?.designation || logs[0]?.designation || "",
        join_date: person?.joinedAt || "",
        attendance: dailyEntries.some((row) => row.status === "Present") ? "present" : "absent",
      };
      const member = bioMember(raw, end);
      const present = dailyEntries.filter((row) => row.status === "Present").length;
      const absent = dailyEntries.filter((row) => row.status === "Absent").length;
      return {
        member,
        cards: {
          present: String(present),
          absent: String(absent),
          entries: String(dailyEntries.length),
        },
        occupancyTrend: dailyEntries.map((row) => (row.status === "Present" ? 100 : 0)).slice(0, 14),
        dailyEntries,
      };
    }
  }
  const payload = await upstreamGet<BioEnvelope>(
    BIO_ORIGIN,
    withParams(`/api/v1/employees/${encodeURIComponent(decoded)}`, {
      start_date: start,
      end_date: end,
    }),
    signal,
  );
  const raw = payload.employee;
  if (!raw) throw new BffError(404, "not_found", "Employee not found");
  if (!memberInLeadScope(raw, undefined, "biometrics")) throw new BffError(404, "not_found", "Employee not found");
  persistQuiet(persistBioEmployees([raw], start, end), "bio-member");
  const member = bioMember(raw, end);
  const attendances = Array.isArray(raw.attendances) ? (raw.attendances as JsonMap[]) : [];
  const dailyEntries: DailyEntry[] = attendances
    .map((rec) => ({
      id: `${member.id}:${asString(rec.date)}`,
      date: asString(rec.date),
      status: normalizeDayStatus(asString(rec.status)),
      inTime: attendanceIn(rec),
      outTime: attendanceOut(rec),
      occupancy: normalizeDayStatus(asString(rec.status)) === "Present" ? "100%" : "0%",
      utilization: utilization(asNumber(rec.tivazo_tracked_time)),
      wtr: utilization(asNumber(rec.tivazo_tracked_time)),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const present = dailyEntries.filter((row) => row.status === "Present").length;
  const absent = dailyEntries.filter((row) => row.status === "Absent").length;
  return {
    member,
    cards: {
      present: String(present),
      absent: String(absent),
      entries: String(dailyEntries.length),
    },
    occupancyTrend: dailyEntries.map((row) => (row.status === "Present" ? 100 : 0)).slice(0, 14),
    dailyEntries,
  };
}

function explodeLogs(employees: JsonMap[], start: string, end: string): DailyLogRow[] {
  const days = enumerateDays(start, end);
  const rows: DailyLogRow[] = [];
  for (const employee of employees) {
    const attendances = Array.isArray(employee.attendances)
      ? (employee.attendances as JsonMap[])
      : [];
    if (days.length <= 1 && attendances.length === 0) {
      rows.push(bioLog(employee));
      continue;
    }
    const byDate = new Map<string, JsonMap>();
    for (const rec of attendances) {
      byDate.set(asString(rec.date), rec);
    }
    for (const day of days) {
      const rec = byDate.get(day);
      if (rec) {
        rows.push(bioLog(employee, rec));
      } else {
        rows.push(
          bioLog(
            { ...employee, attendance: "absent" },
            { date: day, status: "absent" },
          ),
        );
      }
    }
  }
  return rows.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.name.localeCompare(b.name);
  });
}

function explodeEvidence(employees: JsonMap[]): DailyLogRow[] {
  const rows: DailyLogRow[] = [];
  for (const employee of employees) {
    const attendances = attendancesOf(employee);
    if (!attendances.length) continue;
    for (const rec of attendances) {
      if (!asString(rec.date)) continue;
      rows.push(bioLog(employee, rec));
    }
  }
  return rows;
}

function bioStoredMember(raw: JsonMap): StoredMember | null {
  const id = asString(raw.id);
  if (!id) return null;
  const department = asString(raw.department);
  return {
    id,
    email: asString(raw.email).toLowerCase(),
    name: asString(raw.name) || "Unknown",
    department,
    groups: department ? [department] : [],
    role: asString(raw.role),
    designation: asString(raw.designation),
    joinedAt: asString(raw.join_date),
    workspaceId: "",
    disabled: false,
  };
}

function tivazoStoredMember(raw: JsonMap): StoredMember | null {
  const id = asString(raw.id) || asString(raw.email).toLowerCase();
  if (!id) return null;
  return {
    id,
    email: asString(raw.email).toLowerCase(),
    name: asString(raw.name) || asString(raw.email) || "Unknown",
    department: "",
    groups: asStringArray(raw.groups),
    role: asString(raw.role),
    designation: asString(raw.designation),
    joinedAt: "",
    workspaceId: asString(raw.workspace_id),
    disabled: asBool(raw.disabled),
  };
}

function coveredHistoryDays(start: string, end: string, today: string, hasEvidence: boolean): string[] {
  if (!hasEvidence) return [];
  return enumerateDays(start, end).filter((day) => day < today);
}

async function persistBioEmployees(employees: JsonMap[], start: string, end: string): Promise<void> {
  const today = todayInAppZone();
  const logs = explodeEvidence(employees).filter((row) => row.date >= start && row.date <= end);
  const evidence = logs.length > 0;
  await saveAttendance({
    source: "biometrics",
    members: employees.map(bioStoredMember).filter((row): row is StoredMember => Boolean(row)),
    logs,
    coveredDays: coveredHistoryDays(start, end, today, evidence),
    today,
  });
}

async function persistBioLiveDay(members: JsonMap[], day: string): Promise<void> {
  const today = todayInAppZone();
  const logs = members.map((member) =>
    bioLog(member, {
      date: day,
      status: asString(member.attendance) || "absent",
      start_time: asString(member.start_time),
      end_time: asString(member.end_time),
    }),
  );
  await saveAttendance({
    source: "biometrics",
    members: members.map(bioStoredMember).filter((row): row is StoredMember => Boolean(row)),
    logs,
    coveredDays:
      day < today && logs.some((row) => row.status === "Present" || row.inTime || row.outTime) ? [day] : [],
    today,
  });
}

async function persistTivazoActivities(acts: JsonMap[], start: string, end: string): Promise<void> {
  const today = todayInAppZone();
  const snap = await cachedTivazoLive(today, today).catch(() => ({ members: [] as JsonMap[], groups: [] as JsonMap[] }));
  const membersById = new Map<string, JsonMap>();
  const membersByEmail = new Map<string, JsonMap>();
  const storedMembers: StoredMember[] = [];
  for (const member of snap.members) {
    const stored = tivazoStoredMember(member);
    if (stored) storedMembers.push(stored);
    membersById.set(asString(member.id), member);
    if (asString(member.email)) membersByEmail.set(asString(member.email).toLowerCase(), member);
  }
  const logs = acts
    .filter((act) => {
      const date = asString(act.date);
      return date >= start && date <= end;
    })
    .map((act) =>
      activityRow(
        act,
        membersById.get(asString(act.memberID)) || membersByEmail.get(asString(act.email).toLowerCase()),
        asString(act.date) || end,
      ),
    );
  await saveAttendance({
    source: "tivazo",
    members: storedMembers,
    logs,
    coveredDays: coveredHistoryDays(start, end, today, snap.members.length > 0 || acts.length > 0),
    today,
  });
}

async function persistTivazoLiveDay(members: JsonMap[], day: string): Promise<void> {
  const today = todayInAppZone();
  await saveAttendance({
    source: "tivazo",
    members: members.map(tivazoStoredMember).filter((row): row is StoredMember => Boolean(row)),
    logs: members.map((member) => tivazoMemberRow(member, day)),
    coveredDays: day < today ? [day] : [],
    today,
  });
}

function overlayDay(stored: DailyLogRow[], live: DailyLogRow[], day: string): DailyLogRow[] {
  if (!live.length) return stored;
  const kept = stored.filter((row) => row.date !== day);
  return [...live, ...kept].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.name.localeCompare(b.name);
  });
}

function logsToBioMembers(rows: DailyLogRow[]): JsonMap[] {
  const map = new Map<string, JsonMap>();
  for (const row of rows) {
    const id = row.employeeId || row.memberId;
    if (!id) continue;
    const prev =
      map.get(id) ??
      ({
        id,
        name: row.name,
        email: row.email,
        department: row.group,
        role: row.role,
        designation: row.designation,
        attendance: "absent",
        groups: row.groups,
        attendances: [] as JsonMap[],
      } as JsonMap);
    const recs = Array.isArray(prev.attendances) ? (prev.attendances as JsonMap[]) : [];
    recs.push({
      date: row.date,
      status: row.status,
      start_time: row.inTime,
      end_time: row.outTime,
    });
    prev.attendances = recs;
    prev.name = row.name || asString(prev.name);
    prev.email = row.email || asString(prev.email);
    prev.department = row.group || asString(prev.department);
    if (row.status === "Present") {
      prev.attendance = "present";
      if (!asString(prev.start_time) && row.inTime) prev.start_time = row.inTime;
      if (row.outTime) prev.end_time = row.outTime;
    }
    map.set(id, prev);
  }
  return [...map.values()];
}

function logsToTivazoMembers(rows: DailyLogRow[], liveMembers: JsonMap[]): JsonMap[] {
  const byId = new Map<string, JsonMap>();
  for (const member of liveMembers) {
    const id = asString(member.id) || asString(member.email).toLowerCase();
    if (!id) continue;
    // Reset tracked aggregates — stored day logs are the salary source of truth.
    byId.set(id, {
      ...member,
      attendance: "absent",
      tracked_seconds: 0,
      present_days: 0,
      attended_days: 0,
      absent_days: 0,
      tracked_label: "",
    });
  }
  for (const row of rows) {
    const id = row.memberId || row.email.toLowerCase();
    if (!id) continue;
    const prev =
      byId.get(id) ||
      ({
        id: row.memberId || id,
        email: row.email,
        name: row.name,
        attendance: "absent",
        groups: row.groups,
        designation: row.designation,
        role: row.role,
        tracked_seconds: 0,
        present_days: 0,
        attended_days: 0,
        absent_days: 0,
      } as JsonMap);
    prev.name = row.name || asString(prev.name);
    prev.email = row.email || asString(prev.email);
    prev.groups = row.groups.length ? row.groups : asStringArray(prev.groups);
    prev.designation = row.designation || asString(prev.designation);
    const dayStatus = normalizeDayStatus(row.status);
    if (dayStatus === "Present") {
      prev.attendance = "present";
      if (!asString(prev.clocked_in) && row.inTime) prev.clocked_in = row.inTime;
      if (row.outTime) prev.last_screenshot = row.outTime;
      const dayTracked = trackedSecondsOf(row.trackedTime);
      prev.tracked_seconds = asNumber(prev.tracked_seconds) + dayTracked;
      prev.attended_days = asNumber(prev.attended_days) + 1;
      if (dayTracked > 0) prev.present_days = asNumber(prev.present_days) + 1;
      prev.tracked_label = formatSecondsLabel(asNumber(prev.tracked_seconds));
    } else if (!isRestStatus(dayStatus)) {
      prev.absent_days = asNumber(prev.absent_days) + 1;
    }
    byId.set(id, prev);
  }
  return [...byId.values()];
}

const ingestWindows = new Map<string, Promise<void>>();

function ingestWindow(source: "biometrics" | "tivazo", start: string, end: string): Promise<void> {
  const key = `${source}:${start}:${end}`;
  const pending = ingestWindows.get(key);
  if (pending) return pending;
  const promise = (async () => {
    if (source === "biometrics") {
      const employees = await cachedBioEmployees(start, end);
      await persistBioEmployees(employees, start, end);
      return;
    }
    const acts = await cachedTivazoActivities(start, end);
    await persistTivazoActivities(acts, start, end);
  })()
    .catch((error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`attendance ingest ${key}`, message);
    })
    .finally(() => {
      if (ingestWindows.get(key) === promise) ingestWindows.delete(key);
    });
  ingestWindows.set(key, promise);
  return promise;
}

async function ensureStoredRange(source: "biometrics" | "tivazo", start: string, end: string): Promise<boolean> {
  const today = todayInAppZone();
  try {
    const missing = await missingSealedDays(source, start, end, today);
    if (missing.length) {
      const windows = monthWindows(missing[0], missing[missing.length - 1]);
      for (const window of windows) {
        await ingestWindow(source, window.start, window.end);
      }
    }
    return rangeIsStored(source, start, end, today);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("attendance ensure range", source, message);
    return false;
  }
}

let backfillStarted = false;

function scheduleAttendanceBackfill() {
  if (backfillStarted) return;
  backfillStarted = true;
  void (async () => {
    const range = datePresets().find((item) => item.id === "last3Months");
    if (!range) return;
    const windows = monthWindows(range.start, range.end);
    for (const window of windows) {
      await ingestWindow("biometrics", window.start, window.end);
      await ingestWindow("tivazo", window.start, window.end);
    }
  })().catch((error) => {
    backfillStarted = false;
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("attendance backfill", message);
  });
}

function bioLogInLeadScope(row: DailyLogRow): boolean {
  return memberInLeadScope(
    {
      id: row.employeeId,
      email: row.email,
      department: row.group,
      teamId: row.group,
      teamName: row.group,
    },
    undefined,
    "biometrics",
  );
}

async function dailyLogs(url: URL, signal?: AbortSignal) {
  assertTeamAccess(readParam(url, "teamId", "department"));
  const { start, end } = dateRange(url);
  const fetchUrl = new URL(url.toString());
  fetchUrl.searchParams.delete("status");
  fetchUrl.searchParams.delete("dayStatus");
  fetchUrl.searchParams.delete("teamId");
  fetchUrl.searchParams.delete("department");
  const today = todayInAppZone();
  const q = readParam(url, "q");
  const teamId = readParam(url, "teamId", "department");
  const aliases = q ? await lookupPersonAliases(q).catch(() => [q]) : [];
  const memberScoped = isExactPersonQuery(q, aliases) && start !== end;
  const teamKeys =
    !memberScoped && teamId && teamId !== "all" && start !== end
      ? await lookupTeamPersonKeys(teamId).catch(() => [])
      : [];
  let rows: DailyLogRow[] | null = null;
  let identityScoped = false;
  if (memberScoped) {
    const stored = await rangeIsStored("biometrics", start, end, today).catch(() => false);
    if (stored) {
      const keys = aliases.length ? aliases : [q];
      rows = (await listDayLogsForKeys("biometrics", start, historyEnd(end, today), keys)).filter(
        bioLogInLeadScope,
      );
      if (end >= today) {
        const liveEmployees = filterMembersForLead(
          await bioEmployeesAll(withDayRange(fetchUrl, today, today), signal),
          "biometrics",
        );
        rows = overlayDay(
          rows,
          explodeLogs(liveEmployees, today, today).filter((row) => activityRowMatchesKeys(row, keys)),
          today,
        );
      }
      identityScoped = true;
    }
  } else if (teamKeys.length) {
    const stored = await rangeIsStored("biometrics", start, end, today).catch(() => false);
    if (stored) {
      rows = (await listDayLogsForKeys("biometrics", start, historyEnd(end, today), teamKeys)).filter(
        bioLogInLeadScope,
      );
      if (end >= today) {
        const liveEmployees = filterMembersForLead(
          await bioEmployeesAll(withDayRange(fetchUrl, today, today), signal),
          "biometrics",
        );
        rows = overlayDay(
          rows,
          explodeLogs(liveEmployees, today, today).filter((row) => activityRowMatchesKeys(row, teamKeys)),
          today,
        );
      }
      identityScoped = true;
    }
  }
  if (!rows) {
    rows = await dailyLogRowsCache.get(`${start}:${end}:${scopeCacheKey()}`, async () => {
      if (start === today && end === today) {
        const employees = filterMembersForLead(await bioEmployeesAll(fetchUrl, signal), "biometrics");
        return explodeLogs(employees, today, today);
      }
      const stored = await rangeIsStored("biometrics", start, end, today).catch(() => false);
      if (stored) {
        let saved = await listHistoryLogs("biometrics", start, end, today);
        saved = saved.filter(bioLogInLeadScope);
        if (end >= today) {
          const liveEmployees = filterMembersForLead(
            await bioEmployeesAll(withDayRange(fetchUrl, today, today), signal),
            "biometrics",
          );
          saved = overlayDay(saved, explodeLogs(liveEmployees, today, today), today);
        }
        return saved;
      }
      const employees = filterMembersForLead(await bioEmployeesAll(fetchUrl, signal), "biometrics");
      return explodeLogs(employees, start, end);
    });
  }
  if (teamId && teamId !== "all" && !identityScoped) {
    rows = rows.filter((row) => activityRowInGroup(row, teamId));
  }
  const status = readParam(url, "status");
  if (status) {
    rows = rows.filter((row) => sameDayStatus(row.status, status));
  }
  if (q) {
    rows = rows.filter((row) => (identityScoped ? activityRowMatchesKeys(row, aliases.length ? aliases : [q]) : activityRowMatchesQuery(row, q)));
  }
  if (readParam(url, "all") === "1") {
    return { items: rows, total: rows.length, limit: rows.length, offset: 0, hasMore: false };
  }
  const page = pageOf(rows, readInt(url, "offset", 0), readInt(url, "limit", 40));
  return { ...page, hasMore: page.hasMore };
}

async function dailyLogDetail(id: string, url: URL, signal?: AbortSignal): Promise<DailyLogRow> {
  const match = id.match(/^(.*):(\d{4}-\d{2}-\d{2})$/);
  const employeeId = match?.[1] || id;
  const date = match?.[2] || dateRange(url).end;
  const today = todayInAppZone();
  if (date !== today) {
    const stored = await listMemberDays("biometrics", employeeId, date, date).catch(() => []);
    const saved = stored.find((row) => row.date === date);
    if (saved) {
      if (
        !memberInLeadScope(
          {
            id: saved.employeeId,
            email: saved.email,
            department: saved.group,
            teamId: saved.group,
            teamName: saved.group,
          },
          undefined,
          "biometrics",
        )
      ) {
        throw new BffError(404, "not_found", "Daily log not found");
      }
      return saved;
    }
  }
  url.searchParams.set("startDate", date);
  url.searchParams.set("endDate", date);
  const payload = await upstreamGet<BioEnvelope>(
    BIO_ORIGIN,
    withParams(`/api/v1/employees/${encodeURIComponent(employeeId)}`, {
      start_date: date,
      end_date: date,
    }),
    signal,
  );
  const raw = payload.employee;
  if (!raw) throw new BffError(404, "not_found", "Daily log not found");
  if (!memberInLeadScope(raw, undefined, "biometrics")) throw new BffError(404, "not_found", "Daily log not found");
  persistQuiet(persistBioEmployees([raw], date, date), "bio-log");
  const attendances = Array.isArray(raw.attendances) ? (raw.attendances as JsonMap[]) : [];
  const rec = attendances.find((item) => asString(item.date) === date) ?? attendances[0];
  return bioLog(raw, rec);
}

async function tivazoGroups(_url: URL, _signal?: AbortSignal): Promise<{ groups: FilterOption[] }> {
  const catalog = groupCatalog().length ? groupCatalog() : await fetchTivazoCatalog(_url);
  return runWithCatalog(catalog, () => ({
    groups: restrictTeamOptions(namedTeamOptions(catalog), "tivazo"),
  }));
}

function activityRowInGroup(row: DailyLogRow, group: string): boolean {
  if (!group || group === "all" || group === "unassigned") return true;
  return memberInTeam(
    {
      id: row.memberId,
      groups: row.groups,
      group: row.group,
      email: row.email,
    },
    group,
    groupNameMap([]),
  );
}

function activityRowMatchesQuery(row: DailyLogRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.email, row.designation, row.memberId, row.employeeId, row.id].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(needle),
  );
}

function activityRowMatchesKeys(row: DailyLogRow, keys: string[]): boolean {
  const aliases = keys.map((key) => key.trim().toLowerCase()).filter(Boolean);
  if (!aliases.length) return true;
  const fields = [row.name, row.email, row.memberId, row.employeeId, row.id]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return aliases.some((alias) => fields.some((field) => field === alias || field.includes(alias)));
}

function isExactPersonQuery(query: string, aliases: string[]): boolean {
  const needle = query.trim();
  if (!needle) return false;
  if (needle.includes("@") || aliases.some((alias) => alias.includes("@"))) return true;
  if (aliases.length >= 2) return true;
  return /^[a-z0-9._-]{6,}$/i.test(needle);
}

async function loadTivazoActivityRows(url: URL, _signal?: AbortSignal): Promise<DailyLogRow[]> {
  const { start, end } = dateRange(url);
  const today = todayInAppZone();
  const liveDay = start === end ? start : today;
  const [snap, bioByEmail] = await Promise.all([
    cachedTivazoLive(liveDay, liveDay),
    settled(bioEmployeeIdsByEmail()),
  ]);

  const membersById = new Map<string, JsonMap>();
  const membersByEmail = new Map<string, JsonMap>();
  const scopedMembers = filterMembersForLead(snap.members, "tivazo");
  for (const member of scopedMembers) {
    membersById.set(asString(member.id), member);
    if (asString(member.email)) membersByEmail.set(asString(member.email).toLowerCase(), member);
  }

  const catalog = groupNameMap(snap.groups);
  const employeeIds = bioByEmail.ok ? bioByEmail.value : new Map<string, string>();
  const q = readParam(url, "q");
  const group = readParam(url, "group", "teamId");
  const aliases = q ? await lookupPersonAliases(q).catch(() => [q]) : [];
  const memberScoped = isExactPersonQuery(q, aliases);
  const teamKeys =
    !memberScoped && group && group !== "all" && start !== end
      ? await lookupTeamPersonKeys(group).catch(() => [])
      : [];

  let rows: DailyLogRow[];
  let identityScoped = false;
  if (start === end) {
    if (start === today) {
      rows = filterTivazoLiveMembers(scopedMembers, url).map((member) =>
        decorateTivazoRow(tivazoMemberRow(member, today), catalog, employeeIds),
      );
    } else {
      const stored = await rangeIsStored("tivazo", start, end, today).catch(() => false);
      if (stored) {
        rows = (await listHistoryLogs("tivazo", start, end, today))
          .map((row) => decorateTivazoRow(row, catalog, employeeIds))
          .filter((row) => rowInLeadScope(row))
          .filter((row) => activityRowMatchesQuery(row, q))
          .filter((row) => activityRowInGroup(row, group));
      } else {
        rows = filterTivazoLiveMembers(scopedMembers, url).map((member) =>
          decorateTivazoRow(tivazoMemberRow(member, end), catalog, employeeIds),
        );
      }
    }
  } else {
    const stored = (memberScoped || teamKeys.length)
      ? await rangeIsStored("tivazo", start, end, today).catch(() => false)
      : false;
    if (memberScoped && stored) {
      const keys = aliases.length ? aliases : [q];
      const saved = (await listDayLogsForKeys("tivazo", start, historyEnd(end, today), keys))
        .map((row) => decorateTivazoRow(row, catalog, employeeIds))
        .filter((row) => rowInLeadScope(row));
      rows = overlayDay(
        saved,
        end >= today
          ? scopedMembers
              .map((member) => decorateTivazoRow(tivazoMemberRow(member, today), catalog, employeeIds))
              .filter((row) => activityRowMatchesKeys(row, keys))
          : [],
        today,
      );
      identityScoped = true;
    } else if (teamKeys.length && stored) {
      const saved = (await listDayLogsForKeys("tivazo", start, historyEnd(end, today), teamKeys))
        .map((row) => decorateTivazoRow(row, catalog, employeeIds))
        .filter((row) => rowInLeadScope(row));
      rows = overlayDay(
        saved,
        end >= today
          ? scopedMembers
              .map((member) => decorateTivazoRow(tivazoMemberRow(member, today), catalog, employeeIds))
              .filter((row) => activityRowMatchesKeys(row, teamKeys))
          : [],
        today,
      );
      identityScoped = true;
    } else {
      rows = await activityRowsCache.get(`${start}:${end}:${scopeCacheKey()}`, async () => {
        const rangeStored = await rangeIsStored("tivazo", start, end, today).catch(() => false);
        if (rangeStored) {
          const saved = (await listHistoryLogs("tivazo", start, end, today))
            .map((row) => decorateTivazoRow(row, catalog, employeeIds))
            .filter((row) => rowInLeadScope(row));
          return overlayDay(
            saved,
            end >= today
              ? scopedMembers.map((member) => decorateTivazoRow(tivazoMemberRow(member, today), catalog, employeeIds))
              : [],
            today,
          );
        }
        const actsPage = await loadTivazoActivitiesRange(start, end);
        return actsPage
          .map((act) =>
            decorateTivazoRow(
              activityRow(
                act,
                membersById.get(asString(act.memberID)) ||
                  membersByEmail.get(asString(act.email).toLowerCase()),
                end,
              ),
              catalog,
              employeeIds,
            ),
          )
          .filter((row) => rowInLeadScope(row));
      });
    }
    if (q) {
      rows = rows.filter((row) =>
        identityScoped ? activityRowMatchesKeys(row, aliases.length ? aliases : [q]) : activityRowMatchesQuery(row, q),
      );
    }
    if (!identityScoped) {
      rows = rows.filter((row) => activityRowInGroup(row, group));
    }
  }

  const status = readParam(url, "status");
  if (status && /^(present|absent)$/i.test(status)) {
    rows = rows.filter((row) => row.status.toLowerCase() === status.toLowerCase());
  } else if (status && /^(active|tracking|idle|offline)$/i.test(status)) {
    const live = status.toLowerCase() === "tracking" ? "active" : status.toLowerCase();
    rows = rows.filter((row) => {
      const value = row.userStatus.toLowerCase();
      if (live === "active") return value === "active" || value === "tracking";
      return value === live;
    });
  }
  return rows;
}

async function tivazoActivities(url: URL, signal?: AbortSignal) {
  assertTeamAccess(readParam(url, "group", "teamId"));
  const rows = await loadTivazoActivityRows(url, signal);
  const presentIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const row of rows) {
    const key = row.memberId || row.email || row.id;
    seenIds.add(key);
    if (row.status === "Present") presentIds.add(key);
  }
  const page =
    readParam(url, "all") === "1"
      ? { items: rows, total: rows.length, limit: rows.length, offset: 0, hasMore: false }
      : pageOf(rows, readInt(url, "offset", 0), readInt(url, "limit", 50));
  return {
    ...page,
    present: presentIds.size,
    absent: seenIds.size - presentIds.size,
    hasMore: page.hasMore,
  };
}

async function tivazoActivity(url: URL, signal?: AbortSignal): Promise<DailyLogRow> {
  const id = readParam(url, "id");
  if (!id) throw new BffError(400, "invalid_id", "Missing activity id");
  const match = id.match(/^(.*):(\d{4}-\d{2}-\d{2})$/);
  const memberId = match?.[1] || id;
  const date = match?.[2] || dateRange(url).end;
  url.searchParams.set("startDate", date);
  url.searchParams.set("endDate", date);
  url.searchParams.delete("q");
  url.searchParams.delete("offset");
  const rows = await loadTivazoActivityRows(url, signal);
  const row = rows.find(
    (item) => item.id === id || (item.memberId === memberId && item.date === date),
  );
  if (!row) throw new BffError(404, "not_found", "Activity not found");
  return row;
}

async function search(url: URL, signal?: AbortSignal): Promise<SearchResponse> {
  const q = readParam(url, "q");
  const today = todayInAppZone();
  const needle = q.toLowerCase();
  const [bioMembers, tivSnap, groups] = await Promise.all([
    cachedBioLive(today, today).catch(() => [] as JsonMap[]),
    cachedTivazoLive(today, today).catch(() => ({ members: [] as JsonMap[], groups: [] as JsonMap[] })),
    settled(tivazoGroups(url, signal)),
  ]);

  const bioHits = filterMembersForLead(
    bioMembers.filter((member) => matchesLiveQuery(member, q)),
    "biometrics",
  );
  const bioPeople: SearchHit[] = bioHits.slice(0, 8).map((member) => ({
    kind: "person" as const,
    id: asString(member.id),
    title: asString(member.name),
    subtitle: asString(member.department) || asString(member.email),
    status: normalizeDayStatus(asString(member.attendance)),
  }));
  const bioTeams: SearchHit[] = [];
  if (q.length >= 2) {
    const seen = new Set<string>();
    for (const member of filterMembersForLead(bioMembers, "biometrics")) {
      const dept = asString(member.department);
      if (!dept || seen.has(dept)) continue;
      if (!dept.toLowerCase().includes(needle)) continue;
      if (!teamInLeadScope(dept, dept, "biometrics")) continue;
      seen.add(dept);
      bioTeams.push({ kind: "team", id: dept, title: dept, subtitle: "Department" });
    }
  }

  const catalog = groupNameMap(
    groups.ok
      ? groups.value.groups.map((group) => ({
          id: group.id,
          name: group.label,
          label: group.label,
        }))
      : tivSnap.groups,
  );

  const tivazoHits = filterMembersForLead(
    tivSnap.members.filter((member) => matchesLiveQuery(member, q)),
    "tivazo",
  );
  const tivazoPeople: SearchHit[] = tivazoHits.slice(0, 8).map((member) => ({
    kind: "person" as const,
    id: asString(member.id),
    title: asString(member.name),
    subtitle:
      resolveGroupNames(asStringArray(member.groups), catalog).join(", ") ||
      asString(member.email),
    status: titleStatus(asString(member.attendance) || asString(member.status)),
  }));
  const tivazoTeams: SearchHit[] = groups.ok
    ? groups.value.groups
        .filter((group) => group.label.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((group) => ({
          kind: "group" as const,
          id: group.id,
          title: group.label,
          subtitle: "Tivazo group",
        }))
    : [];

  return {
    query: q,
    tivazo: { people: tivazoPeople, teams: tivazoTeams },
    biomatic: { people: bioPeople, teams: bioTeams },
  };
}

function memberEmail(raw: JsonMap): string {
  return asString(raw.email).toLowerCase();
}

function memberKey(raw: JsonMap): string {
  return memberEmail(raw) || asString(raw.id);
}

function memberInTeam(raw: JsonMap, teamId: string, catalog: Map<string, string>): boolean {
  if (!teamId) return true;
  const memberId = asString(raw.id);
  const groups = groupCatalog();
  const hit = groups.find((group) => teamsMatch(group.id, teamId) || teamsMatch(group.label, teamId));
  if (hit && memberId && hit.memberIds.includes(memberId)) return true;
  if (isOpaqueId(teamId)) {
    if (asStringArray(raw.groups).some((group) => teamsMatch(group, teamId))) return true;
    const named = catalog.get(teamId);
    return named ? memberInTeam(raw, named, catalog) : false;
  }
  const namedGroups = resolveGroupNames(asStringArray(raw.groups), catalog);
  if (namedGroups.some((group) => teamsMatch(group, teamId))) return true;
  const department = asString(raw.department);
  return (
    teamsMatch(department, teamId) ||
    teamsMatch(teamIdFrom(department), teamId)
  );
}

function resolveTrendGroup(teamId: string, groups: FilterOption[]): string | undefined {
  if (!teamId) return undefined;
  const exact = groups.find(
    (group) => teamsMatch(group.id, teamId) || teamsMatch(group.label, teamId),
  );
  if (exact) return exact.id;
  if (isOpaqueId(teamId)) return teamId;
  return undefined;
}

function matchesMember(raw: JsonMap, needle: string): boolean {
  return identityMatchesNeedle(
    { email: asString(raw.email), id: asString(raw.id), name: asString(raw.name) },
    needle,
  );
}

function unionByEmail(
  scopedBio: JsonMap[],
  scopedTivazo: JsonMap[],
  allBio: JsonMap[],
  allTivazo: JsonMap[],
): { bio: JsonMap[]; tivazo: JsonMap[] } {
  const index = createIdentityIndex([
    ...allBio.map((row) => ({ ...row, source: "bio" as const, email: asString(row.email), id: asString(row.id), name: asString(row.name) })),
    ...allTivazo.map((row) => ({ ...row, source: "tivazo" as const, email: asString(row.email), id: asString(row.id), name: asString(row.name) })),
  ]);
  const wanted = new Set<string>();
  for (const row of [...scopedBio, ...scopedTivazo]) {
    const key = identityCanonical(index, {
      email: asString(row.email),
      id: asString(row.id),
      name: asString(row.name),
      source: scopedBio.includes(row) ? "bio" : "tivazo",
    });
    if (key) wanted.add(key);
  }
  const bio = new Set(scopedBio);
  const tivazo = new Set(scopedTivazo);
  if (wanted.size) {
    for (const row of allBio) {
      if (wanted.has(identityCanonical(index, { email: asString(row.email), id: asString(row.id), name: asString(row.name), source: "bio" }))) {
        bio.add(row);
      }
    }
    for (const row of allTivazo) {
      if (wanted.has(identityCanonical(index, { email: asString(row.email), id: asString(row.id), name: asString(row.name), source: "tivazo" }))) {
        tivazo.add(row);
      }
    }
  }
  return { bio: [...bio], tivazo: [...tivazo] };
}

function mergeMemberOptions(bio: JsonMap[], tivazo: JsonMap[]): FilterOption[] {
  const index = createIdentityIndex([
    ...bio.map((row) => ({ email: asString(row.email), id: asString(row.id), name: asString(row.name), source: "bio" as const })),
    ...tivazo.map((row) => ({ email: asString(row.email), id: asString(row.id), name: asString(row.name), source: "tivazo" as const })),
  ]);
  const byId = new Map<string, FilterOption>();
  for (const raw of [...tivazo, ...bio]) {
    const id = identityCanonical(index, {
      email: asString(raw.email),
      id: asString(raw.id),
      name: asString(raw.name),
    });
    const label = asString(raw.name);
    if (!id || !label || byId.has(id)) continue;
    byId.set(id, { id, label });
  }
  return [...byId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function coverageTeam(raw: JsonMap, catalog: Map<string, string>): string {
  const groups = resolveGroupNames(asStringArray(raw.groups), catalog);
  if (groups[0]) return groups[0];
  return teamLabelFrom(asString(raw.department));
}

function coveragePerson(raw: JsonMap, catalog: Map<string, string>): CoveragePerson {
  const email = asString(raw.email);
  return {
    id: asString(raw.id) || memberKey(raw) || asString(raw.name),
    name: asString(raw.name) || "Unknown",
    email,
    team: coverageTeam(raw, catalog),
    status: normalizeDayStatus(asString(raw.attendance)) || titleStatus(asString(raw.status)),
    match: memberEmail(raw) ? "email" : "none",
  };
}

function sortCoverage(left: CoveragePerson, right: CoveragePerson): number {
  if (left.match !== right.match) return left.match === "email" ? -1 : 1;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function firstByEmail(members: JsonMap[]): { byEmail: Map<string, JsonMap>; noEmail: JsonMap[] } {
  const byEmail = new Map<string, JsonMap>();
  const noEmail: JsonMap[] = [];
  for (const row of members) {
    const email = memberEmail(row);
    if (!email) {
      noEmail.push(row);
      continue;
    }
    if (!byEmail.has(email)) byEmail.set(email, row);
  }
  return { byEmail, noEmail };
}

function inCoverageFocus(
  row: JsonMap,
  catalog: Map<string, string>,
  teamId: string,
  memberId: string,
): boolean {
  if (teamId && !memberInTeam(row, teamId, catalog)) return false;
  if (memberId && !matchesMember(row, memberId)) return false;
  return true;
}

function coverageScopeLabel(
  teamId: string,
  memberId: string,
  teams: FilterOption[],
  members: FilterOption[],
): string {
  if (memberId) {
    return members.find((member) => member.id === memberId)?.label || "Selected member";
  }
  if (!teamId) return "All groups";
  return teams.find((team) => team.id === teamId)?.label || "Selected team";
}

function buildCoverageGaps(
  bio: JsonMap[],
  tivazo: JsonMap[],
  catalog: Map<string, string>,
  teamId = "",
  memberId = "",
  scope = "All groups",
): CoverageGaps {
  const bioIndex = firstByEmail(bio);
  const tivIndex = firstByEmail(tivazo);
  const bioOnly: CoveragePerson[] = [];
  const tivazoOnly: CoveragePerson[] = [];
  const linkedEmails = new Set<string>();

  for (const [email, row] of bioIndex.byEmail) {
    if (!inCoverageFocus(row, catalog, teamId, memberId)) continue;
    if (tivIndex.byEmail.has(email)) {
      linkedEmails.add(email);
      continue;
    }
    bioOnly.push(coveragePerson(row, catalog));
  }
  for (const row of bioIndex.noEmail) {
    if (!inCoverageFocus(row, catalog, teamId, memberId)) continue;
    bioOnly.push(coveragePerson(row, catalog));
  }
  for (const [email, row] of tivIndex.byEmail) {
    if (!inCoverageFocus(row, catalog, teamId, memberId)) continue;
    if (bioIndex.byEmail.has(email)) {
      linkedEmails.add(email);
      continue;
    }
    tivazoOnly.push(coveragePerson(row, catalog));
  }
  for (const row of tivIndex.noEmail) {
    if (!inCoverageFocus(row, catalog, teamId, memberId)) continue;
    tivazoOnly.push(coveragePerson(row, catalog));
  }

  bioOnly.sort(sortCoverage);
  tivazoOnly.sort(sortCoverage);
  return { linked: linkedEmails.size, bioOnly, tivazoOnly, scope, teamId, memberId };
}

function isBioLate(start: string): boolean {
  const [hour, minute] = start.split(/[:.]/).map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  return hour > 9 || (hour === 9 && minute >= 30);
}

function recountBio(members: JsonMap[]): BiomaticSummary {
  let present = 0;
  let absent = 0;
  let leave = 0;
  let late = 0;
  for (const row of members) {
    const attendance = normalizeDayStatus(asString(row.attendance));
    if (attendance === "Present") {
      present += 1;
      if (isBioLate(asString(row.start_time))) late += 1;
    } else if (attendance === "Leave") leave += 1;
    else if (attendance === "Absent") absent += 1;
  }
  return {
    totalMembers: members.length,
    presentMembers: present,
    absentMembers: absent,
    leaveMembers: leave,
    lateMembers: late,
  };
}


function bioDoorSpanSeconds(row: JsonMap): number {
  const start = attendanceIn(undefined, row) || memberClock(row.clocked_in);
  const end = attendanceOut(undefined, row) || memberClock(row.last_screenshot);
  const inPunch = punchFromClock(start) ?? punchFromMillis(asNumber(row.clocked_in));
  const outPunch = punchFromClock(end) ?? punchFromMillis(asNumber(row.last_screenshot));
  if (!inPunch || !outPunch) return 0;
  const inM = inPunch.hour * 60 + inPunch.minute;
  const outM = outPunch.hour * 60 + outPunch.minute;
  let delta = outM - inM;
  if (delta <= 0) delta += 1440;
  // Guard absurd spans (overnight noise / missing out)
  if (delta <= 0 || delta > 16 * 60) return 0;
  return delta * 60;
}

function averageBioDoorFromMembers(members: JsonMap[]): string {
  let total = 0;
  let people = 0;
  for (const row of members) {
    if (normalizeDayStatus(asString(row.attendance)) !== "Present") continue;
    const seconds = bioDoorSpanSeconds(row);
    if (seconds <= 0) continue;
    total += seconds;
    people += 1;
  }
  return averageWorkedHours(total, people);
}

function workSpanSeconds(inMinutes: number | null, outMinutes: number | null): number {
  if (inMinutes == null || outMinutes == null) return 0;
  let delta = outMinutes - inMinutes;
  if (delta <= 0) delta += 1440;
  // Guard absurd spans (overnight noise / missing out)
  if (delta <= 0 || delta > 16 * 60) return 0;
  return delta * 60;
}

/** Combined Avg Work Hour: one in→out span per person (earliest in, latest out across Bio ∪ Tivazo). */
function combinedWorkHours(bio: JsonMap[], tivazo: JsonMap[]): string {
  const bioMap = indexMembers(bio);
  const tivMap = indexMembers(tivazo);
  const keys = new Set([...bioMap.keys(), ...tivMap.keys()]);
  let total = 0;
  let people = 0;
  for (const key of keys) {
    const bioRow = bioMap.get(key);
    const tivRow = tivMap.get(key);
    const bioPresent = bioRow
      ? normalizeDayStatus(asString(bioRow.attendance)) === "Present"
      : false;
    const tivPresent = tivRow
      ? normalizeDayStatus(asString(tivRow.attendance)) === "Present"
      : false;
    if (!bioPresent && !tivPresent) continue;

    const inBio = punchMinutes(bioRow ? bioFirstPunch(bioRow) : null);
    const inTiv = punchMinutes(tivRow ? tivazoFirstPunch(tivRow) : null);
    const outBio = punchMinutes(bioRow ? bioCheckoutPunch(bioRow) : null);
    const outTiv = punchMinutes(tivRow ? tivazoCheckoutPunch(tivRow) : null);

    const ins = [inBio, inTiv].filter((value): value is number => value != null);
    const outs = [outBio, outTiv].filter((value): value is number => value != null);
    if (!ins.length || !outs.length) continue;

    const seconds = workSpanSeconds(Math.min(...ins), Math.max(...outs));
    if (seconds <= 0) continue;
    total += seconds;
    people += 1;
  }
  return averageWorkedHours(total, people);
}

/** Combined Avg Clock-in: earliest first punch per person across Bio ∪ Tivazo. */
function combinedAvgClockIn(bio: JsonMap[], tivazo: JsonMap[]): string {
  const bioMap = indexMembers(bio);
  const tivMap = indexMembers(tivazo);
  const keys = new Set([...bioMap.keys(), ...tivMap.keys()]);
  const punches: number[] = [];
  for (const key of keys) {
    const bioRow = bioMap.get(key);
    const tivRow = tivMap.get(key);
    const inBio = punchMinutes(bioRow ? bioFirstPunch(bioRow) : null);
    const inTiv = punchMinutes(tivRow ? tivazoFirstPunch(tivRow) : null);
    if (inBio == null && inTiv == null) continue;
    if (inBio != null && inTiv != null) punches.push(Math.min(inBio, inTiv));
    else punches.push((inBio ?? inTiv) as number);
  }
  const avg = meanMinutes(punches);
  return avg == null ? "—" : formatClockLabel(avg);
}

function recountTivazo(members: JsonMap[]): TivazoSummary {
  let present = 0;
  let absent = 0;
  let tracking = 0;
  let idle = 0;
  let offline = 0;
  let tracked = 0;
  let presentDays = 0;
  for (const row of members) {
    const attendance = normalizeDayStatus(asString(row.attendance));
    if (attendance === "Present") {
      present += 1;
      const seconds = trackedSecondsOf(row.tracked_seconds) || trackedSecondsOf(row.tracked_label);
      tracked += seconds;
      const days = asNumber(row.present_days);
      // Only count days that contribute tracked time so empty Present rows do not dilute salary averages.
      if (days > 0) presentDays += days;
      else if (seconds > 0) presentDays += 1;
    } else {
      absent += 1;
    }
    switch (asString(row.status).toLowerCase()) {
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
    totalMembers: members.length,
    activeMembers: tracking,
    idleMembers: idle,
    offlineMembers: offline,
    presentMembers: present,
    absentMembers: absent,
    avgWorkHours: averageWorkedHours(tracked, presentDays || (tracked > 0 ? present : 0)),
  };
}

function parseClockParts(label: string): { hour: number; minute: number } | null {
  const match = label.trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return { hour, minute: Number.isFinite(minute) ? minute : 0 };
}

function punchFromClock(label: string): { hour: number; minute: number } | null {
  return parseClockParts(label);
}

function punchFromMillis(ms: number): { hour: number; minute: number } | null {
  const hour = hourInZone(ms, APP_TIMEZONE);
  const minute = minuteInZone(ms, APP_TIMEZONE);
  if (hour < 0 || minute < 0) return null;
  return { hour, minute };
}

function tivazoFirstPunch(member: JsonMap): { hour: number; minute: number } | null {
  const fromLabel = punchFromClock(asString(member.clocked_in));
  if (fromLabel) return fromLabel;
  const activity = asJsonMap(member.activity);
  return punchFromMillis(asNumber(activity.clocked_in));
}

function bioFirstPunch(member: JsonMap): { hour: number; minute: number } | null {
  return (
    punchFromClock(asString(member.start_time)) ||
    punchFromClock(asString(member.in_time)) ||
    punchFromClock(asString(member.clocked_in))
  );
}

function tivazoLastPunch(member: JsonMap): { hour: number; minute: number } | null {
  const fromLabel = punchFromClock(asString(member.last_screenshot));
  if (fromLabel) return fromLabel;
  const activity = asJsonMap(member.activity);
  return punchFromMillis(asNumber(activity.last_taken_screenshot));
}

function bioLastPunch(member: JsonMap): { hour: number; minute: number } | null {
  return punchFromClock(asString(member.end_time)) || punchFromClock(asString(member.out_time));
}

function tivazoCheckoutPunch(member: JsonMap): { hour: number; minute: number } | null {
  return tivazoLastPunch(member);
}

function bioCheckoutPunch(member: JsonMap): { hour: number; minute: number } | null {
  return bioLastPunch(member);
}

function punchMinutes(punch: { hour: number; minute: number } | null): number | null {
  if (!punch) return null;
  return punch.hour * 60 + punch.minute;
}

function meanMinutes(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function emptyPunchMoment(): { time: string; people: number } {
  return { time: "—", people: 0 };
}

function punchMomentFrom(values: number[]): { time: string; people: number } {
  const avg = meanMinutes(values);
  return {
    time: avg == null ? "—" : formatClockLabel(avg),
    people: values.length,
  };
}

function punchGapFrom(
  values: number[],
  laterNote: string,
  earlierNote: string,
): PunchCompare["checkIn"]["gap"] {
  const avg = meanMinutes(values);
  if (avg == null) {
    return { label: "—", minutes: null, people: 0, note: "No paired punches" };
  }
  const rounded = Math.round(avg);
  if (rounded === 0) {
    return { label: "0 min", minutes: 0, people: values.length, note: "Same time" };
  }
  return {
    label: formatDurationMinutes(rounded),
    minutes: Math.abs(rounded),
    people: values.length,
    note: rounded > 0 ? laterNote : earlierNote,
  };
}

function indexMembers(rows: JsonMap[]): Map<string, JsonMap> {
  const map = new Map<string, JsonMap>();
  for (const row of rows) {
    const key = memberKey(row);
    if (key) map.set(key, row);
  }
  return map;
}

function buildPunchCompare(
  bio: JsonMap[],
  tivazo: JsonMap[],
  forToday: boolean,
): PunchCompare {
  const bioMap = indexMembers(bio);
  const tivMap = indexMembers(tivazo);
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
    const inBio = punchMinutes(bioRow ? bioFirstPunch(bioRow) : null);
    const inTiv = punchMinutes(tivRow ? tivazoFirstPunch(tivRow) : null);
    const outBio = punchMinutes(bioRow ? bioCheckoutPunch(bioRow) : null);
    const outTiv = punchMinutes(tivRow ? tivazoCheckoutPunch(tivRow) : null);

    if (inBio != null) bioIn.push(inBio);
    if (inTiv != null) tivIn.push(inTiv);
    if (inBio != null && inTiv != null) {
      inCombined.push(Math.min(inBio, inTiv));
      inGaps.push(inTiv - inBio);
    } else if (inBio != null) {
      inCombined.push(inBio);
    } else if (inTiv != null) {
      inCombined.push(inTiv);
    }

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

  const noOuts = outCombined.length === 0;
  return {
    checkIn: {
      first: punchMomentFrom(bioIn),
      second: punchMomentFrom(tivIn),
      gap: punchGapFrom(inGaps, "Tivazo after Biometrics", "Tivazo before Biometrics"),
      overall: punchMomentFrom(inCombined),
    },
    checkOut: {
      first: punchMomentFrom(tivOut),
      second: punchMomentFrom(bioOut),
      gap: noOuts
        ? {
            label: "—",
            minutes: null,
            people: 0,
            note: forToday ? "No check-outs yet today" : "No check-outs for this day",
          }
        : punchGapFrom(outGaps, "Biometrics after Tivazo", "Biometrics before Tivazo"),
      overall: punchMomentFrom(outCombined),
    },
    avgGap: (() => {
      const samples = [...inGaps, ...outGaps].map((value) => Math.abs(value));
      if (!samples.length) return "—";
      const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
      return formatDurationMinutes(Math.round(mean));
    })(),
  };
}

function emptyHourlyPoints(): HourlyPoint[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    value: 0,
    share: 0,
  }));
}

function rankingTeam(member: JsonMap, catalog: Map<string, string>): string {
  return (
    resolveGroupNames(asStringArray(member.groups), catalog)[0] ||
    humanLabel(teamLabelFrom(asString(member.department))) ||
    "Unassigned"
  );
}

function rankingStatus(member: JsonMap): string {
  const day = normalizeDayStatus(asString(member.attendance));
  const live = titleStatus(asString(member.status));
  const liveKey = live.toLowerCase();
  if (day && day !== "Present") return day;
  if (liveKey && !["active", "tracking", "present", "online"].includes(liveKey)) {
    return live;
  }
  return day || live || "Absent";
}

function rankingReason(member: JsonMap, tracked: number): string {
  const day = normalizeDayStatus(asString(member.attendance));
  const live = titleStatus(asString(member.status)).toLowerCase();
  if (day === "Leave") return "On leave today";
  if (day === "Weekly off") return "Weekly off";
  if (day === "Half day") return tracked > 0 ? `${formatHours(tracked)} tracked` : "Half day";
  if (live === "idle") return "Idle now";
  if (live === "offline") return "Offline now";
  if (live === "disabled") return "Disabled account";
  if (!day || day === "Absent") {
    return tracked > 0 ? `${formatHours(tracked)} tracked` : "No clock-in";
  }
  if (tracked > 0) return `${formatHours(tracked)} tracked`;
  return "Low activity";
}

function needsAttention(member: JsonMap, metric: TrendMetric): boolean {
  const day = normalizeDayStatus(asString(member.attendance));
  const live = asString(member.status).toLowerCase();
  const tracked = asNumber(member.tracked_seconds);
  const present = day === "Present";
  if (metric === "utilization") return !present || tracked < 4 * 3600;
  if (live === "idle" || live === "offline" || live === "disabled" || live === "invited") {
    return true;
  }
  return !present;
}

function attentionValue(member: JsonMap, metric: TrendMetric, tracked: number): string {
  if (metric === "present") return formatDayCount(rankingAbsentDays(member));
  if (metric === "attendance") {
    return normalizeDayStatus(asString(member.attendance)) === "Present" ? "100%" : "0%";
  }
  if (metric === "utilization") return utilization(tracked);
  return tracked > 0 ? formatHours(tracked) : "";
}

function formatDayCount(days: number): string {
  const n = Math.max(0, Math.round(days));
  return n === 1 ? "1 day" : `${n} days`;
}

function rankingPresentDays(member: JsonMap): number {
  const attended = asNumber(member.attended_days);
  if (attended > 0) return attended;
  const trackedDays = asNumber(member.present_days);
  if (trackedDays > 0) return trackedDays;
  return normalizeDayStatus(asString(member.attendance)) === "Present" ? 1 : 0;
}

function rankingAbsentDays(member: JsonMap): number {
  const absent = asNumber(member.absent_days);
  if (absent > 0) return absent;
  return normalizeDayStatus(asString(member.attendance)) === "Present" ? 0 : 1;
}

function buildLeaderboard(
  members: JsonMap[],
  metric: TrendMetric,
  catalog: Map<string, string>,
): { leaders: LeaderRow[]; attention: AttentionItem[] } {
  const ranked = [...members].sort((a, b) => {
    if (metric === "present") {
      const byDays = rankingPresentDays(b) - rankingPresentDays(a);
      if (byDays !== 0) return byDays;
    } else if (metric === "attendance") {
      const left = asString(a.attendance).toLowerCase() === "present" ? 1 : 0;
      const right = asString(b.attendance).toLowerCase() === "present" ? 1 : 0;
      if (right !== left) return right - left;
    }
    return asNumber(b.tracked_seconds) - asNumber(a.tracked_seconds);
  });
  const leaders: LeaderRow[] = ranked.map((member) => {
    const attendance = asString(member.attendance);
    const present = attendance.toLowerCase() === "present";
    return {
      id: asString(member.id) || memberKey(member),
      name: asString(member.name) || "Unknown",
      email: asString(member.email),
      team: rankingTeam(member, catalog),
      status: normalizeDayStatus(attendance) || titleStatus(asString(member.status)),
      value:
        metric === "present"
          ? formatDayCount(rankingPresentDays(member))
          : metric === "attendance"
            ? present
              ? "100%"
              : "0%"
            : utilization(asNumber(member.tracked_seconds)),
      delta: "",
      positive: present,
    };
  });
  const attention: AttentionItem[] = ranked
    .filter((member) => needsAttention(member, metric))
    .sort((a, b) => {
      if (metric === "present") {
        const byAbsent = rankingAbsentDays(b) - rankingAbsentDays(a);
        if (byAbsent !== 0) return byAbsent;
      }
      const aPresent = normalizeDayStatus(asString(a.attendance)) === "Present" ? 1 : 0;
      const bPresent = normalizeDayStatus(asString(b.attendance)) === "Present" ? 1 : 0;
      if (aPresent !== bPresent) return aPresent - bPresent;
      const tracked = asNumber(a.tracked_seconds) - asNumber(b.tracked_seconds);
      if (tracked !== 0) return tracked;
      return asString(a.name).localeCompare(asString(b.name), undefined, { sensitivity: "base" });
    })
    .map((member) => {
      const tracked = asNumber(member.tracked_seconds);
      return {
        id: asString(member.id) || memberKey(member),
        name: asString(member.name) || "Unknown",
        email: asString(member.email),
        team: rankingTeam(member, catalog),
        status: rankingStatus(member),
        reason: rankingReason(member, tracked),
        value: attentionValue(member, metric, tracked),
      };
    });
  return { leaders, attention };
}

function buildHourlySeries(
  rows: JsonMap[],
  readPunch: (row: JsonMap) => { hour: number; minute: number } | null,
): HourlySeries {
  const points = emptyHourlyPoints();
  const totals: number[] = [];
  const firstExact = new Map<number, string>();
  for (const row of rows) {
    const punch = readPunch(row);
    if (!punch) continue;
    const minutes = punch.hour * 60 + punch.minute;
    points[punch.hour].value += 1;
    totals.push(minutes);
    if (!firstExact.has(punch.hour)) {
      firstExact.set(punch.hour, formatClockLabel(minutes));
    }
  }
  const people = totals.length;
  for (const point of points) {
    point.share = people ? Math.round((point.value / people) * 1000) / 10 : 0;
    const exact = firstExact.get(point.hour);
    if (exact) point.exact = exact;
  }
  const avgMinutes = people ? totals.reduce((sum, value) => sum + value, 0) / people : 0;
  return {
    avgClockIn: people ? formatClockLabel(avgMinutes) : "—",
    people,
    points,
  };
}

function formatClockLabel(totalMinutes: number): string {
  const rounded = Math.round(totalMinutes);
  const dayMod = ((rounded % 1440) + 1440) % 1440;
  const hour = Math.floor(dayMod / 60);
  const minute = dayMod % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function uniqueAttendance(bio: JsonMap[], tivazo: JsonMap[]): { people: number; present: number } {
  const index = createIdentityIndex([
    ...bio.map((row) => ({ email: asString(row.email), id: asString(row.id), name: asString(row.name), source: "bio" as const })),
    ...tivazo.map((row) => ({ email: asString(row.email), id: asString(row.id), name: asString(row.name), source: "tivazo" as const })),
  ]);
  const people = new Map<string, boolean>();
  for (const row of [...bio, ...tivazo]) {
    const key = identityCanonical(index, { email: asString(row.email), id: asString(row.id), name: asString(row.name) });
    if (!key) continue;
    people.set(key, people.get(key) === true || isPresentAttendance(asString(row.attendance)));
  }
  let present = 0;
  for (const value of people.values()) if (value) present += 1;
  return { people: people.size, present };
}

function buildMemberFocus(
  bio: JsonMap[],
  tivazo: JsonMap[],
  catalog: Map<string, string>,
): DashboardMemberFocus | null {
  const tiv = tivazo[0];
  const bioRow = bio[0];
  if (!tiv && !bioRow) return null;
  return {
    name: asString(tiv?.name) || asString(bioRow?.name),
    email: memberEmail(tiv ?? {}) || memberEmail(bioRow ?? {}),
    employeeId: humanLabel(asString(bioRow?.id)) || humanLabel(asString(tiv?.id)),
    sources: [...(bioRow ? ["Biometrics"] : []), ...(tiv ? ["Tivazo"] : [])],
    biometrics: {
      day: normalizeDayStatus(asString(bioRow?.attendance)),
      inTime: attendanceIn(undefined, bioRow),
      outTime: attendanceOut(undefined, bioRow),
      department: teamLabelFrom(asString(bioRow?.department)),
      designation: asString(bioRow?.designation),
      joined: asString(bioRow?.join_date),
    },
    tivazo: {
      live: liveForDate(tiv ?? {}, todayInAppZone()).userStatus,
      day: normalizeDayStatus(asString(tiv?.attendance)),
      inTime: memberClock(tiv?.clocked_in),
      outTime: memberClock(tiv?.last_screenshot),
      tracked: asString(tiv?.tracked_label) || "",
      group: resolveGroupNames(asStringArray(tiv?.groups), catalog)[0] || "",
      designation: asString(tiv?.designation).trim(),
    },
  };
}

async function fetchTrendSeries(
  groups: string[],
  memberId: string,
  today: string,
): Promise<Map<string, { clockIns: number; tracked: number }>> {
  const byDay = new Map<string, { clockIns: number; tracked: number }>();
  const targets = groups.length ? groups : [""];
  const pages = await Promise.all(
    targets.map((group) =>
      settled(
        upstreamGet<TivazoEnvelope>(
          TIVAZO_ORIGIN,
          withParams("/api/v1/trend", {
            days: TREND_DAYS,
            group: group || undefined,
            q: memberId || undefined,
            start_date: today,
            end_date: today,
          }),
        ),
      ),
    ),
  );
  for (const page of pages) {
    if (!page.ok) continue;
    for (const point of page.value.trend ?? []) {
      const day = asString(point.day);
      const prev = byDay.get(day) ?? { clockIns: 0, tracked: 0 };
      byDay.set(day, {
        clockIns: prev.clockIns + asNumber(point.clock_ins),
        tracked: prev.tracked + asNumber(point.tracked_seconds),
      });
    }
  }
  return byDay;
}

async function loadTrendSeries(
  groups: string[],
  memberId: string,
  today: string,
  _signal?: AbortSignal,
): Promise<Map<string, { clockIns: number; tracked: number }>> {
  const key = `${today}|${memberId}|${[...groups].sort().join(",")}`;
  return trendSeriesCache.get(key, () => fetchTrendSeries(groups, memberId, today));
}

function uniqueRosterTeams(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function rosterPerson(
  source: "bio" | "tivazo",
  raw: JsonMap,
  catalog: Map<string, string>,
): DashboardRosterPerson {
  const department = asString(raw.department);
  const groups = asStringArray(raw.groups);
  const named = resolveGroupNames(groups, catalog);
  return {
    source,
    id: asString(raw.id),
    email: asString(raw.email),
    name: asString(raw.name),
    teams: uniqueRosterTeams([
      department,
      teamIdFrom(department),
      teamLabelFrom(department),
      ...groups,
      ...named,
    ]),
    department,
    groups: named.length ? named : groups,
    attendance: asString(raw.attendance),
    status: asString(raw.status),
    startTime: attendanceIn(undefined, raw) || memberClock(raw.clocked_in),
    endTime: attendanceOut(undefined, raw) || memberClock(raw.last_screenshot),
    clockedIn: memberClock(raw.clocked_in),
    lastScreenshot: memberClock(raw.last_screenshot),
    trackedSeconds:
      trackedSecondsOf(raw.tracked_seconds) || trackedSecondsOf(raw.tracked_label),
    trackedLabel: asString(raw.tracked_label),
    presentDays: asNumber(raw.present_days) || undefined,
    attendedDays: asNumber(raw.attended_days) || undefined,
    absentDays: asNumber(raw.absent_days) || undefined,
    designation: asString(raw.designation),
    joinDate: asString(raw.join_date),
  };
}

type PresenceBucket = {
  present: number;
  typicalIn: number | null;
  typicalOut: number | null;
};

function medianClock(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function addPresencePunch(
  map: Map<string, { present: number; ins: number[]; outs: number[] }>,
  day: string,
  punched: boolean,
  inMinutes: number | null,
  outMinutes: number | null,
) {
  if (!day || !punched) return;
  const row = map.get(day) ?? { present: 0, ins: [], outs: [] };
  row.present += 1;
  if (inMinutes != null) row.ins.push(inMinutes);
  if (outMinutes != null) row.outs.push(outMinutes);
  map.set(day, row);
}

function finishPresence(map: Map<string, { present: number; ins: number[]; outs: number[] }>): Map<string, PresenceBucket> {
  return new Map(
    [...map.entries()].map(([day, row]) => [
      day,
      {
        present: row.present,
        typicalIn: medianClock(row.ins),
        typicalOut: medianClock(row.outs),
      },
    ]),
  );
}

function presenceFromBioEmployees(employees: JsonMap[], start: string, end: string): Map<string, PresenceBucket> {
  const map = new Map<string, { present: number; ins: number[]; outs: number[] }>();
  for (const employee of employees) {
    const recs = attendancesOf(employee);
    if (!recs.length) continue;
    for (const rec of recs) {
      const day = asString(rec.date);
      if (!day || day < start || day > end) continue;
      const inLabel = attendanceIn(rec, employee);
      const outLabel = attendanceOut(rec, employee);
      const status = normalizeDayStatus(asString(rec.status) || asString(employee.attendance));
      const punched = status === "Present";
      addPresencePunch(map, day, punched, clockLabelMinutes(inLabel), clockLabelMinutes(outLabel));
    }
  }
  return finishPresence(map);
}

function presenceFromTivazoActivities(acts: JsonMap[], start: string, end: string): Map<string, PresenceBucket> {
  const map = new Map<string, { present: number; ins: number[]; outs: number[] }>();
  for (const act of acts) {
    const day = asString(act.date);
    if (!day || day < start || day > end) continue;
    const tracked = asNumber(act.trackedTime);
    const clocked = asNumber(act.clocked_in);
    const screenshot = asNumber(act.last_taken_screenshot);
    const status = normalizeDayStatus(asString(act.status) || asString(act.attendance));
    const punched =
      status === "Present" ||
      (!status && (tracked > 0 || clocked > 0));
    addPresencePunch(
      map,
      day,
      punched,
      clocked ? clockLabelMinutes(clockLabel(clocked)) : null,
      screenshot ? clockLabelMinutes(clockLabel(screenshot)) : null,
    );
  }
  return finishPresence(map);
}

function presenceFromLiveMembers(members: JsonMap[], day: string, source: "bio" | "tivazo"): Map<string, PresenceBucket> {
  const map = new Map<string, { present: number; ins: number[]; outs: number[] }>();
  for (const member of members) {
    if (source === "bio") {
      const inLabel = attendanceIn(undefined, member);
      const status = normalizeDayStatus(asString(member.attendance));
      const punched = status === "Present";
      addPresencePunch(map, day, punched, clockLabelMinutes(inLabel), clockLabelMinutes(attendanceOut(undefined, member)));
      continue;
    }
    const clocked = asNumber(member.clocked_in);
    const tracked = asNumber(member.tracked_seconds) || parseTrackedLabel(asString(member.tracked_label));
    const punched = normalizeDayStatus(asString(member.attendance)) === "Present";
    addPresencePunch(
      map,
      day,
      punched,
      clocked ? clockLabelMinutes(clockLabel(clocked)) : clockLabelMinutes(memberClock(member.clocked_in)),
      clockLabelMinutes(memberClock(member.last_screenshot)),
    );
  }
  return finishPresence(map);
}

function mergePresence(base: Map<string, PresenceBucket>, extra: Map<string, PresenceBucket>) {
  for (const [day, row] of extra) {
    const prev = base.get(day);
    if (!prev || row.present > prev.present) base.set(day, row);
  }
}

function storedToPresence(
  logs: Map<string, { present: number; typicalIn: number | null; typicalOut: number | null }>,
  ingest: Map<string, { presentCount: number }>,
): Map<string, PresenceBucket> {
  const map = new Map<string, PresenceBucket>();
  for (const [day, row] of logs) {
    map.set(day, {
      present: row.present,
      typicalIn: row.typicalIn,
      typicalOut: row.typicalOut,
    });
  }
  for (const [day, row] of ingest) {
    const prev = map.get(day);
    const present = Math.max(prev?.present || 0, Number(row.presentCount) || 0);
    if (!present) continue;
    map.set(day, {
      present,
      typicalIn: prev?.typicalIn ?? null,
      typicalOut: prev?.typicalOut ?? null,
    });
  }
  return map;
}

async function dashboardPresence(url: URL): Promise<{
  start: string;
  end: string;
  days: { day: string; present: number; typicalIn: number | null; typicalOut: number | null }[];
}> {
  const { start, end } = dateRange(url);
  const source = readParam(url, "source");
  const teamId = readParam(url, "teamId", "group", "department");
  assertTeamAccess(teamId);
  const today = todayInAppZone();
  // bio | tivazo | all/combined (default). Combined uses both sources and max(count)
  // as a salary-safe lower bound of unique Present (exact union needs per-person join).
  const wantBio = source !== "tivazo";
  const wantTivazo = source !== "bio";
  const [bioLogs, tivazoLogs, bioIngest, tivazoIngest] = await Promise.all([
    wantBio ? presenceByDay("biometrics", start, end, teamId).catch(() => new Map()) : Promise.resolve(new Map()),
    wantTivazo ? presenceByDay("tivazo", start, end, teamId).catch(() => new Map()) : Promise.resolve(new Map()),
    wantBio ? ingestedDays("biometrics", start, end).catch(() => new Map()) : Promise.resolve(new Map()),
    wantTivazo ? ingestedDays("tivazo", start, end).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  const bio = storedToPresence(bioLogs, bioIngest);
  const tivazo = storedToPresence(tivazoLogs, tivazoIngest);
  const span = enumerateDays(start, end).length;
  const storedHits = enumerateDays(start, end).filter((day) =>
    Math.max(bio.get(day)?.present || 0, tivazo.get(day)?.present || 0) > 0,
  ).length;
  const sparse = span > 7 && storedHits <= Math.max(1, Math.floor(span * 0.08));

  if (sparse) {
    const [bioEmployees, tivazoActs] = await Promise.all([
      wantBio ? loadBioEmployeesRange(start, end).catch(() => [] as JsonMap[]) : Promise.resolve([] as JsonMap[]),
      wantTivazo ? loadTivazoActivitiesRange(start, end).catch(() => [] as JsonMap[]) : Promise.resolve([] as JsonMap[]),
    ]);
    if (wantBio) mergePresence(bio, presenceFromBioEmployees(bioEmployees, start, end));
    if (wantTivazo) mergePresence(tivazo, presenceFromTivazoActivities(tivazoActs, start, end));
  } else {
    void Promise.all([
      wantBio ? ensureStoredRange("biometrics", start, end) : Promise.resolve(false),
      wantTivazo ? ensureStoredRange("tivazo", start, end) : Promise.resolve(false),
    ]).catch(() => undefined);
  }

  if (end >= today) {
    const [bioLiveMembers, tivazoLive] = await Promise.all([
      wantBio ? cachedBioLive(today, today).catch(() => [] as JsonMap[]) : Promise.resolve([] as JsonMap[]),
      wantTivazo ? cachedTivazoLive(today, today).catch(() => ({ members: [] as JsonMap[], groups: [] as JsonMap[] })) : Promise.resolve({ members: [] as JsonMap[], groups: [] as JsonMap[] }),
    ]);
    if (wantBio) mergePresence(bio, presenceFromLiveMembers(bioLiveMembers, today, "bio"));
    if (wantTivazo) mergePresence(tivazo, presenceFromLiveMembers(tivazoLive.members, today, "tivazo"));
  }

  const days = enumerateDays(start, end).map((day) => {
    const bioRow = bio.get(day);
    const tivazoRow = tivazo.get(day);
    const bioCount = bioRow?.present || 0;
    const tivazoCount = tivazoRow?.present || 0;
    const present =
      source === "tivazo"
        ? tivazoCount
        : source === "bio"
          ? bioCount
          : Math.max(bioCount, tivazoCount);
    const typical =
      source === "tivazo"
        ? tivazoRow
        : source === "bio"
          ? bioRow
          : (bioCount >= tivazoCount ? bioRow : tivazoRow);
    return {
      day,
      present,
      typicalIn: typical?.typicalIn ?? null,
      typicalOut: typical?.typicalOut ?? null,
    };
  });
  return { start, end, days };
}

async function dashboardTrend(url: URL, signal?: AbortSignal): Promise<{ trend: TrendPoint[] }> {
  const teamId = readParam(url, "teamId", "group", "department");
  const memberId = readParam(url, "memberId");
  assertTeamAccess(teamId);
  const today = todayInAppZone();
  const { start: rangeStart, end: rangeEnd } = dateRange(url);
  const trendWindow = resolveTrendWindow(rangeStart, rangeEnd, today);
  const tivazoTeams = restrictTeamOptions(namedTeamOptions(groupCatalog()), "tivazo");
  const assignedTivazoTeams = (leadAssignments() ?? []).filter((item) => item.source === "tivazo");
  const trendGroups = (
    teamId
      ? [resolveTrendGroup(teamId, tivazoTeams)]
      : isTeamLead()
        ? assignedTivazoTeams.map(
            (item) =>
              resolveTrendGroup(item.teamId, tivazoTeams) ||
              resolveTrendGroup(item.teamLabel, tivazoTeams),
          )
        : []
  ).filter((value): value is string => Boolean(value));
  const uniqueTrendGroups = [...new Set(trendGroups)];
  const byDay =
    isTeamLead() && uniqueTrendGroups.length === 0
      ? new Map<string, { clockIns: number; tracked: number }>()
      : await loadTrendSeries(uniqueTrendGroups, memberId, today, signal);
  const days = enumerateDays(trendWindow.start, trendWindow.end);
  return {
    trend: days.map((day) => {
      const point = byDay.get(day);
      const present = point?.clockIns ?? 0;
      const tracked = point?.tracked ?? 0;
      return { day, value: present, clockIns: present, trackedSeconds: tracked };
    }),
  };
}

function parseTrackedLabel(label: string): number {
  const parts = label.split(":").map(Number);
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return 0;
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

function trendMapFromLogs(logs: DailyLogRow[]): Map<string, { clockIns: number; tracked: number }> {
  const map = new Map<string, { clockIns: number; tracked: number }>();
  for (const row of logs) {
    if (!row.date) continue;
    const prev = map.get(row.date) ?? { clockIns: 0, tracked: 0 };
    if (row.status === "Present") prev.clockIns += 1;
    prev.tracked += parseTrackedLabel(row.trackedTime);
    map.set(row.date, prev);
  }
  return map;
}

function filtersFromStoredLogs(bioLogs: DailyLogRow[], tivazoLogs: DailyLogRow[]): FilterOptions {
  const teams = new Map<string, FilterOption>();
  const roles = new Map<string, FilterOption>();
  const supervisors = new Map<string, FilterOption>();
  for (const row of bioLogs) {
    const id = teamIdFrom(row.group);
    const label = teamLabelFrom(row.group);
    teams.set(id.toLowerCase(), { id, label });
    if (row.role.trim()) roles.set(row.role.toLowerCase(), { id: row.role, label: row.role });
  }
  for (const row of tivazoLogs) {
    const names = row.groups.length ? row.groups : row.group ? [row.group] : [];
    for (const group of names) {
      const label = group.trim();
      if (!label) continue;
      supervisors.set(label.toLowerCase(), { id: label, label });
    }
  }
  return {
    teams: [...teams.values()].sort((left, right) => left.label.localeCompare(right.label)),
    supervisors: [...supervisors.values()].sort((left, right) => left.label.localeCompare(right.label)),
    roles: [...roles.values()].sort((left, right) => left.label.localeCompare(right.label)),
    members: [],
  };
}

async function dashboardOverview(url: URL, signal?: AbortSignal): Promise<DashboardOverview> {
  const { start, end } = dateRange(url);
  schedulePresetWarm();
  return overviewCache.get(`${start}:${end}:${scopeCacheKey()}`, () =>
    buildDashboardOverview(url, signal),
  );
}

async function buildDashboardOverview(url: URL, signal?: AbortSignal): Promise<DashboardOverview> {
  const metric = (readParam(url, "metric") || "present") as TrendMetric;
  const teamId = readParam(url, "teamId", "group", "department");
  assertTeamAccess(teamId);
  const liveUrl = new URL(url.toString());
  liveUrl.searchParams.delete("teamId");
  liveUrl.searchParams.delete("group");
  liveUrl.searchParams.delete("department");
  liveUrl.searchParams.delete("memberId");
  liveUrl.searchParams.delete("q");
  const today = todayInAppZone();
  const { start, end } = dateRange(url);
  const trendWindow = resolveTrendWindow(start, end, today);
  const assignedOverviewTeams = (leadAssignments() ?? []).filter((item) => item.source === "tivazo");
  const tivazoTeamsHint = restrictTeamOptions(namedTeamOptions(groupCatalog()), "tivazo");
  const trendGroups = (
    isTeamLead()
      ? assignedOverviewTeams.map(
          (item) =>
            resolveTrendGroup(item.teamId, tivazoTeamsHint) ||
            resolveTrendGroup(item.teamLabel, tivazoTeamsHint),
        )
      : []
  ).filter((value): value is string => Boolean(value));
  const uniqueTrendGroups = [...new Set(trendGroups)];
  const trendTask =
    isTeamLead() && uniqueTrendGroups.length === 0
      ? Promise.resolve(new Map<string, { clockIns: number; tracked: number }>())
      : loadTrendSeries(uniqueTrendGroups, "", today, signal);

  const useHistory = start !== end;
  const storedHistory = useHistory
    ? await Promise.all([
        rangeIsStored("biometrics", start, end, today).catch(() => false),
        rangeIsStored("tivazo", start, end, today).catch(() => false),
      ])
    : ([false, false] as const);
  const bioStored = storedHistory[0];
  const tivazoStored = storedHistory[1];
  const todayUrl = withDayRange(liveUrl, today, today);
  const todayKey = `${today}:${today}`;
  const peekedBio = bioLiveCache.peek(todayKey) ?? [];
  const peekedTivazo = tivazoLiveCache.peek(todayKey);
  void cachedBioLive(today, today).catch(() => undefined);
  void cachedTivazoLive(today, today).catch(() => undefined);

  const skipLiveWait = useHistory && (bioStored || tivazoStored);
  const [bioFilters, tivMembers, bioMembers, byDay, historyBio, historyActs, storedBioLogs, storedTivazoLogs] =
    await Promise.all([
    skipLiveWait
      ? Promise.resolve({ ok: false as const, error: undefined })
      : settled(filters(url, signal)),
    skipLiveWait
      ? Promise.resolve({
          ok: true as const,
          value: { members: peekedTivazo?.members ?? [], groups: peekedTivazo?.groups ?? [] },
        })
      : settled(tivazoLive(todayUrl, signal, true)),
    skipLiveWait
      ? Promise.resolve({ ok: true as const, value: { members: peekedBio } })
      : settled(bioLive(todayUrl, signal, true)),
    skipLiveWait
      ? Promise.resolve(new Map<string, { clockIns: number; tracked: number }>())
      : trendTask,
    useHistory && !bioStored ? settled(loadBioEmployeesRange(start, end)) : Promise.resolve({ ok: false as const, error: undefined }),
    useHistory && !tivazoStored
      ? settled(loadTivazoActivitiesRange(start, end))
      : Promise.resolve({ ok: false as const, error: undefined }),
    bioStored ? listHistoryLogs("biometrics", start, end, today).catch(() => [] as DailyLogRow[]) : Promise.resolve([] as DailyLogRow[]),
    tivazoStored ? listHistoryLogs("tivazo", start, end, today).catch(() => [] as DailyLogRow[]) : Promise.resolve([] as DailyLogRow[]),
  ]);

  const filterOptions: FilterOptions = skipLiveWait
    ? filtersFromStoredLogs(storedBioLogs, storedTivazoLogs)
    : bioFilters.ok
      ? bioFilters.value
      : { teams: [], supervisors: [], roles: [], members: [] };
  const trendByDay = skipLiveWait ? trendMapFromLogs(storedTivazoLogs) : byDay;
  let liveTivazo = tivMembers.ok ? tivMembers.value.members : [];
  let liveBio = bioMembers.ok ? bioMembers.value.members : [];
  let rawTivazo = liveTivazo;
  let rawBio = liveBio;
  if (bioStored && storedBioLogs.length) {
    rawBio = employeesToRangeMembers(logsToBioMembers(storedBioLogs), start, end);
    if (end >= today) rawBio = overlayLiveMembers(rawBio, liveBio);
  } else if (useHistory && historyBio.ok && historyBio.value.length) {
    rawBio = employeesToRangeMembers(historyBio.value, start, end);
    if (end >= today) rawBio = overlayLiveMembers(rawBio, liveBio);
  }
  if (tivazoStored) {
    rawTivazo = logsToTivazoMembers(storedTivazoLogs, liveTivazo);
    if (end >= today) rawTivazo = overlayLiveMembers(rawTivazo, liveTivazo);
  } else if (useHistory && historyActs.ok) {
    rawTivazo = activitiesToRangeMembers(historyActs.value, liveTivazo, start, end);
    if (end >= today) rawTivazo = overlayLiveMembers(rawTivazo, liveTivazo);
  }
  const tivazoTeams = filterOptions.supervisors;
  const bioTeams = filterOptions.teams;
  const catalog = groupNameMap([
    ...tivazoTeams.map((group) => ({ id: group.id, name: group.label, label: group.label })),
    ...bioTeams.map((group) => ({ id: group.id, name: group.label, label: group.label })),
  ]);
  const mergedTeams = mergeOptions(bioTeams, tivazoTeams);
  const scopedBio = filterMembersForLead(rawBio, "biometrics");
  const scopedTivazo = filterMembersForLead(rawTivazo, "tivazo");
  const joined = unionByEmail(scopedBio, scopedTivazo, rawBio, rawTivazo);
  const visibleBio = joined.bio;
  const visibleTivazo = joined.tivazo;

  const biomatic = recountBio(visibleBio);
  const tivazo = recountTivazo(visibleTivazo);
  const memberOptions = mergeMemberOptions(joined.bio, joined.tivazo);
  const unique = uniqueAttendance(visibleBio, visibleTivazo);
  const days = enumerateDays(trendWindow.start, trendWindow.end);
  const trend: TrendPoint[] = days.map((day) => {
    const point = trendByDay.get(day);
    const present = point?.clockIns ?? 0;
    const tracked = point?.tracked ?? 0;
    return { day, value: present, clockIns: present, trackedSeconds: tracked };
  });

  const leaderboard = buildLeaderboard(visibleTivazo, metric, catalog);
  const leaderboards = {
    present: buildLeaderboard(visibleTivazo, "present", catalog),
    attendance: buildLeaderboard(visibleTivazo, "attendance", catalog),
    utilization: buildLeaderboard(visibleTivazo, "utilization", catalog),
  };

  const punchDay = end || start || today;
  const liveScopedBio = filterMembersForLead(liveBio, "biometrics");
  const liveScopedTivazo = filterMembersForLead(liveTivazo, "tivazo");
  const punchBio = punchDay === today ? liveScopedBio : visibleBio;
  const punchTivazo = punchDay === today ? liveScopedTivazo : visibleTivazo;
  const hourly = {
    biometrics: buildHourlySeries(punchBio, bioFirstPunch),
    tivazo: buildHourlySeries(punchTivazo, tivazoFirstPunch),
    compare: buildPunchCompare(punchBio, punchTivazo, punchDay === today),
  };

  return {
    summary: {
      totalTeams: mergedTeams.length,
      totalMembers: unique.people,
      biomaticTeams: bioTeams.length,
      tivazoTeams: tivazoTeams.length,
      biomaticMembers: biomatic.totalMembers,
      tivazoMembers: tivazo.totalMembers,
      avgAttendance: percent(unique.present, unique.people),
      avgWorkHours: combinedWorkHours(visibleBio, visibleTivazo),
      avgClockIn: combinedAvgClockIn(punchBio, punchTivazo),
      biomaticPresent: biomatic.presentMembers,
      bioPresent: biomatic.presentMembers,
      bioTotal: biomatic.totalMembers,
      tivazoPresent: tivazo.presentMembers,
      tivazoTotal: tivazo.totalMembers,
      bioAttendance: percent(biomatic.presentMembers, biomatic.totalMembers),
      tivazoAttendance: percent(tivazo.presentMembers, tivazo.totalMembers),
      bioAvgWorkHours: averageBioDoorFromMembers(visibleBio),
      tivazoAvgWorkHours: tivazo.avgWorkHours,
      bioClockIn: hourly.compare.checkIn.first.time,
      tivazoClockIn: hourly.compare.checkIn.second.time,
      avgSourceGap: hourly.compare.avgGap,
    },
    filters: {
      teams: mergedTeams,
      supervisors: tivazoTeams,
      roles: filterOptions.roles,
      members: memberOptions,
    },
    trend,
    leaderboard,
    leaderboards,
    hourly,
    member: null,
    biomatic,
    tivazo,
    coverage: buildCoverageGaps(
      scopedBio,
      scopedTivazo,
      catalog,
      "",
      "",
      "All groups",
    ),
    roster: {
      bio: scopedBio.map((row) => rosterPerson("bio", row, catalog)),
      tivazo: scopedTivazo.map((row) => rosterPerson("tivazo", row, catalog)),
    },
  };
}

function mergeOptions(a: FilterOption[], b: FilterOption[]): FilterOption[] {
  const byId = new Map<string, FilterOption>();
  for (const option of [...a, ...b]) {
    const id = option.id.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    const label = option.label.trim() || id;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, { id, label });
      continue;
    }
    const prevNamed = Boolean(humanLabel(prev.label));
    const nextNamed = Boolean(humanLabel(label));
    if (nextNamed && !prevNamed) byId.set(key, { id: prev.id, label });
  }
  return [...byId.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
  );
}

function workdayCapacity(days: number): number {
  return 8 * 60 * 60 * Math.max(1, days);
}
