import { APP_TIMEZONE, addDaysISO } from "@/lib/datetime";
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
    inTime: formatClock(asString(raw.start_time)),
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
    inTime: formatClock(asString(rec.start_time) || asString(raw.start_time)),
    outTime: formatClock(asString(rec.end_time) || asString(raw.end_time)),
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

const LIVE_FRESH_MS = 4_000;
const LIVE_STALE_MS = 20_000;
const HISTORY_FRESH_MS = 180_000;
const HISTORY_STALE_MS = 1_800_000;

type SnapshotEntry<T> = { key: string; at: number; value: T };
type SnapshotTtl = { fresh: number; stale: number };

function liveRangeTtl(key: string): SnapshotTtl {
  const today = todayInAppZone();
  const [start, end] = key.split(":");
  if (!start || !end) return { fresh: LIVE_FRESH_MS, stale: LIVE_STALE_MS };
  if (start === today || end === today || (start <= today && end >= today)) {
    return { fresh: LIVE_FRESH_MS, stale: LIVE_STALE_MS };
  }
  return { fresh: HISTORY_FRESH_MS, stale: HISTORY_STALE_MS };
}

function createSnapshotCache<T>(options: {
  max?: number;
  ttl: (key: string) => SnapshotTtl;
}) {
  const max = Math.max(1, options.max ?? 24);
  const entries = new Map<string, SnapshotEntry<T>>();
  const inflight = new Map<string, Promise<T>>();

  function remember(key: string, value: T, at = Date.now()) {
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { key, at, value });
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      entries.delete(oldest);
    }
  }

  function refresh(key: string, load: () => Promise<T>): Promise<T> {
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = load()
      .then((value) => {
        remember(key, value);
        return value;
      })
      .catch((error: unknown) => {
        const hit = entries.get(key);
        if (hit) return hit.value;
        throw error;
      })
      .finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });
    inflight.set(key, promise);
    return promise;
  }

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit) {
        remember(key, hit.value, hit.at);
        const age = Date.now() - hit.at;
        const ttl = options.ttl(key);
        if (age < ttl.fresh) return Promise.resolve(hit.value);
        if (age < ttl.stale) {
          void refresh(key, load);
          return Promise.resolve(hit.value);
        }
      }
      return refresh(key, load);
    },
  };
}

type TivazoLiveSnap = { members: JsonMap[]; groups: JsonMap[] };

const bioLiveCache = createSnapshotCache<JsonMap[]>({ max: 24, ttl: liveRangeTtl });
const tivazoLiveCache = createSnapshotCache<TivazoLiveSnap>({ max: 24, ttl: liveRangeTtl });
const bioEmployeesCache = createSnapshotCache<JsonMap[]>({ max: 12, ttl: liveRangeTtl });
const tivazoActivitiesCache = createSnapshotCache<JsonMap[]>({ max: 12, ttl: liveRangeTtl });
const bioFiltersCache = createSnapshotCache<BioEnvelope>({
  max: 2,
  ttl: () => ({ fresh: 60_000, stale: 180_000 }),
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
  return bioLiveCache.get(`${start}:${end}`, () => loadUnfilteredBioLive(start, end));
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
  return tivazoLiveCache.get(`${start}:${end}`, () => loadUnfilteredTivazoLive(start, end));
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

function warmLiveSnapshots(start: string, end: string) {
  const tasks: Promise<unknown>[] = [
    cachedBioLive(start, end).catch(() => undefined),
    cachedTivazoLive(start, end).catch(() => undefined),
  ];
  if (start !== end) {
    tasks.push(cachedBioEmployees(start, end).catch(() => undefined));
    tasks.push(cachedTivazoActivities(start, end).catch(() => undefined));
  }
  void Promise.all(tasks).then(() => {
    if (start === end) warmNeighborDays(start);
  });
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
    inTime: asString(raw.clocked_in),
    outTime: asString(raw.last_screenshot),
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
  const tracked = asNumber(act.trackedTime);
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
  return clockLabel(asNumber(raw));
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
  const rows = start === end ? await cachedBioLive(start, end) : await cachedBioEmployees(start, end);
  return filterBioLiveMembers(rows, url);
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

async function members(url: URL, signal?: AbortSignal) {
  assertTeamAccess(readParam(url, "teamId", "department"), "", "biometrics");
  const { start, end } = dateRange(url);
  const result = await bioLive(url, signal, true);
  const scoped = filterMembersForLead(result.members ?? [], "biometrics");
  const items = scoped.map((row) => bioMember(row, end || start));
  if (readParam(url, "all") === "1") {
    return { items, total: items.length, limit: items.length, offset: 0, hasMore: false };
  }
  return pageOf(items, readInt(url, "offset", 0), readInt(url, "limit", 40));
}

async function memberDetail(id: string, url: URL, signal?: AbortSignal): Promise<MemberDetail> {
  const decoded = decodeURIComponent(id);
  const { start, end } = dateRange(url);
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
  const member = bioMember(raw, end);
  const attendances = Array.isArray(raw.attendances) ? (raw.attendances as JsonMap[]) : [];
  const dailyEntries: DailyEntry[] = attendances
    .map((rec) => ({
      id: `${member.id}:${asString(rec.date)}`,
      date: asString(rec.date),
      status: normalizeDayStatus(asString(rec.status)),
      inTime: formatClock(asString(rec.start_time)),
      outTime: formatClock(asString(rec.end_time)),
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

async function dailyLogs(url: URL, signal?: AbortSignal) {
  assertTeamAccess(readParam(url, "teamId", "department"), "", "biometrics");
  const { start, end } = dateRange(url);
  const fetchUrl = new URL(url.toString());
  fetchUrl.searchParams.delete("status");
  fetchUrl.searchParams.delete("dayStatus");
  const employees = filterMembersForLead(await bioEmployeesAll(fetchUrl, signal), "biometrics");
  let rows = explodeLogs(employees, start, end);
  const status = readParam(url, "status");
  if (status) {
    rows = rows.filter((row) => sameDayStatus(row.status, status));
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

async function loadTivazoActivityRows(url: URL, _signal?: AbortSignal): Promise<DailyLogRow[]> {
  const { start, end } = dateRange(url);
  const [snap, bioByEmail] = await Promise.all([
    cachedTivazoLive(start, end),
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

  let rows: DailyLogRow[];
  if (start === end) {
    rows = filterTivazoLiveMembers(scopedMembers, url).map((member) =>
      decorateTivazoRow(tivazoMemberRow(member, end), catalog, employeeIds),
    );
  } else {
    const actsPage = await cachedTivazoActivities(start, end);
    rows = actsPage
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
      .filter((row) => rowInLeadScope(row))
      .filter((row) => activityRowMatchesQuery(row, q))
      .filter((row) => activityRowInGroup(row, group));
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
  assertTeamAccess(readParam(url, "group", "teamId"), "", "tivazo");
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
  const want = needle.toLowerCase();
  if (!want) return true;
  return (
    memberEmail(raw) === want ||
    asString(raw.id).toLowerCase() === want ||
    asString(raw.name).toLowerCase() === want
  );
}

function unionByEmail(
  scopedBio: JsonMap[],
  scopedTivazo: JsonMap[],
  allBio: JsonMap[],
  allTivazo: JsonMap[],
): { bio: JsonMap[]; tivazo: JsonMap[] } {
  const emails = new Set<string>();
  for (const row of [...scopedBio, ...scopedTivazo]) {
    const email = memberEmail(row);
    if (email) emails.add(email);
  }
  const bio = new Set(scopedBio);
  const tivazo = new Set(scopedTivazo);
  if (emails.size) {
    for (const row of allBio) {
      if (emails.has(memberEmail(row))) bio.add(row);
    }
    for (const row of allTivazo) {
      if (emails.has(memberEmail(row))) tivazo.add(row);
    }
  }
  return { bio: [...bio], tivazo: [...tivazo] };
}

function mergeMemberOptions(bio: JsonMap[], tivazo: JsonMap[]): FilterOption[] {
  const byId = new Map<string, FilterOption>();
  for (const raw of [...tivazo, ...bio]) {
    const id = memberKey(raw);
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

function recountTivazo(members: JsonMap[]): TivazoSummary {
  let present = 0;
  let absent = 0;
  let tracking = 0;
  let idle = 0;
  let offline = 0;
  let tracked = 0;
  for (const row of members) {
    if (asString(row.attendance).toLowerCase() === "present") {
      present += 1;
      tracked += asNumber(row.tracked_seconds);
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
    avgWorkHours: averageHours(tracked, present),
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

function tivazoLiveStatus(member: JsonMap): string {
  return (
    asString(member.status) ||
    asString(member.userStatus) ||
    ""
  ).toLowerCase();
}

function isTivazoStillOnShift(member: JsonMap, forToday: boolean): boolean {
  if (!forToday) return false;
  const status = tivazoLiveStatus(member);
  return status === "active" || status === "tracking" || status === "idle";
}

const MIN_SHIFT_MINUTES = 3 * 60;
const TODAY_CHECKOUT_AFTER = 12 * 60;

function laterPunch(
  start: { hour: number; minute: number } | null,
  end: { hour: number; minute: number } | null,
  forToday = false,
): { hour: number; minute: number } | null {
  if (!start || !end) return null;
  const inMin = punchMinutes(start);
  const outMin = punchMinutes(end);
  if (inMin == null || outMin == null) return null;
  let span = outMin - inMin;
  if (span < 0) span += 1440;
  if (span < MIN_SHIFT_MINUTES) return null;
  if (forToday && outMin < TODAY_CHECKOUT_AFTER) return null;
  return end;
}

function tivazoCheckoutPunch(
  member: JsonMap,
  forToday: boolean,
): { hour: number; minute: number } | null {
  if (isTivazoStillOnShift(member, forToday)) return null;
  return laterPunch(tivazoFirstPunch(member), tivazoLastPunch(member), forToday);
}

function bioCheckoutPunch(
  member: JsonMap,
  forToday: boolean,
): { hour: number; minute: number } | null {
  return laterPunch(bioFirstPunch(member), bioLastPunch(member), forToday);
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
    const outBio = punchMinutes(bioRow ? bioCheckoutPunch(bioRow, forToday) : null);
    const outTiv = punchMinutes(tivRow ? tivazoCheckoutPunch(tivRow, forToday) : null);

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
  if (metric === "attendance") {
    return normalizeDayStatus(asString(member.attendance)) === "Present" ? "100%" : "0%";
  }
  if (metric === "utilization") return utilization(tracked);
  return tracked > 0 ? formatHours(tracked) : "";
}

function buildLeaderboard(
  members: JsonMap[],
  metric: TrendMetric,
  catalog: Map<string, string>,
): { leaders: LeaderRow[]; attention: AttentionItem[] } {
  const ranked = [...members].sort((a, b) => {
    if (metric === "present" || metric === "attendance") {
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
          ? titleStatus(attendance) || (present ? "Present" : "Absent")
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
  const people = new Map<string, boolean>();
  for (const row of [...bio, ...tivazo]) {
    const key = memberKey(row);
    if (!key) continue;
    people.set(key, people.get(key) === true || asString(row.attendance).toLowerCase() === "present");
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
      inTime: formatClock(asString(bioRow?.start_time)),
      outTime: formatClock(asString(bioRow?.end_time)),
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
    startTime: asString(raw.start_time) || asString(raw.clocked_in),
    endTime: asString(raw.end_time) || asString(raw.last_screenshot),
    clockedIn: memberClock(raw.clocked_in),
    lastScreenshot: memberClock(raw.last_screenshot),
    trackedSeconds: asNumber(raw.tracked_seconds),
    trackedLabel: asString(raw.tracked_label),
    designation: asString(raw.designation),
    joinDate: asString(raw.join_date),
  };
}

async function dashboardTrend(url: URL, signal?: AbortSignal): Promise<{ trend: TrendPoint[] }> {
  const teamId = readParam(url, "teamId", "group", "department");
  const memberId = readParam(url, "memberId");
  assertTeamAccess(teamId);
  const today = todayInAppZone();
  const trendWindow = rollingWindow(today, TREND_DAYS);
  const tivazoTeams = restrictTeamOptions(namedTeamOptions(groupCatalog()), "tivazo");
  const assignedTivazo = (leadAssignments() ?? []).filter((item) => item.source === "tivazo");
  const trendGroups = (
    teamId
      ? [resolveTrendGroup(teamId, tivazoTeams)]
      : isTeamLead()
        ? assignedTivazo.map(
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

async function dashboardOverview(url: URL, signal?: AbortSignal): Promise<DashboardOverview> {
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
  const trendWindow = rollingWindow(today, TREND_DAYS);

  const [bioFilters, tivMembers, bioMembers] = await Promise.all([
    settled(filters(url, signal)),
    settled(tivazoLive(liveUrl, signal, true)),
    settled(bioLive(liveUrl, signal, true)),
  ]);

  const filterOptions: FilterOptions = bioFilters.ok
    ? bioFilters.value
    : { teams: [], supervisors: [], roles: [], members: [] };
  const rawTivazo = tivMembers.ok ? tivMembers.value.members : [];
  const rawBio = bioMembers.ok ? bioMembers.value.members : [];
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

  const assignedTivazo = (leadAssignments() ?? []).filter((item) => item.source === "tivazo");
  const trendGroups = (
    isTeamLead()
      ? assignedTivazo.map(
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
      : await loadTrendSeries(uniqueTrendGroups, "", today, signal);
  const days = enumerateDays(trendWindow.start, trendWindow.end);
  const trend: TrendPoint[] = days.map((day) => {
    const point = byDay.get(day);
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

  const { start, end } = dateRange(url);
  const punchDay = end || start || today;
  const hourly = {
    biometrics: buildHourlySeries(visibleBio, bioFirstPunch),
    tivazo: buildHourlySeries(visibleTivazo, tivazoFirstPunch),
    compare: buildPunchCompare(visibleBio, visibleTivazo, punchDay === today),
  };

  return {
    summary: {
      totalTeams: mergedTeams.length,
      totalMembers: unique.people,
      biomaticTeams: bioTeams.length,
      tivazoTeams: tivazoTeams.length,
      biomaticMembers: biomatic.totalMembers,
      tivazoMembers: tivazo.totalMembers,
      avgWorkHours: tivazo.avgWorkHours,
      avgClockIn: hourly.compare.checkIn.overall.time !== "—"
        ? hourly.compare.checkIn.overall.time
        : hourly.biometrics.avgClockIn,
      avgAttendance: percent(unique.present, unique.people),
      biomaticPresent: biomatic.presentMembers,
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
