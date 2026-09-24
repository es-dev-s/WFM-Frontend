"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { AuthRole } from "@/lib/auth-role";
import { getCached, peekFresh, queryTtl, setCached } from "@/lib/query-cache";

export type { AuthRole } from "@/lib/auth-role";
export { authRoleLabel, isOrgWideAuthRole, isScopedAuthRole } from "@/lib/auth-role";
export const API_PREFIX = "/api/v1";

export type ApiErrorBody = {
  error?: string;
  message?: string;
  code?: number;
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function readApiError(body: unknown, fallback: string): { code: string; message: string } {
  if (!body || typeof body !== "object") {
    return { code: "http_error", message: fallback };
  }
  const record = body as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const detail = nested as Record<string, unknown>;
    return {
      code: String(detail.code || record.code || "http_error"),
      message: String(detail.message || record.message || fallback),
    };
  }
  if (typeof nested === "string" && nested) {
    return { code: nested, message: String(record.message || fallback) };
  }
  return {
    code: String(record.code || "http_error"),
    message: String(record.message || fallback),
  };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError";
}

function redirectIfSignedOut(status: number, path: string) {
  if (status !== 401) return;
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  if (path.includes("/auth/login")) return;
  const next = window.location.pathname + window.location.search;
  window.location.href = `/login?next=${encodeURIComponent(next || "/")}`;
}

export async function apiGet<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(
      0,
      "network_error",
      "Can’t reach Bio or Tivazo. Confirm the Go servers are running on ports 8091 and 8090.",
    );
  }

  if (response.status === 499) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (!response.ok) {
    redirectIfSignedOut(response.status, url);
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const { code, message } = readApiError(
      parsed,
      response.statusText || "Request failed",
    );
    if (response.status === 502 || response.status === 504 || code === "network_error") {
      throw new ApiError(
        response.status,
        "network_error",
        message ||
          "Can’t reach Bio or Tivazo. Confirm the Go servers are running on ports 8091 and 8090.",
      );
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as T;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    redirectIfSignedOut(response.status, url);
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const { code, message } = readApiError(
      parsed,
      response.statusText || "Request failed",
    );
    throw new ApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type HealthResponse = {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  uptimeMs: number;
  timestamp: string;
};

export type TeamAssignment = {
  source: "tivazo" | "biometrics";
  teamId: string;
  teamLabel: string;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  roleLabel: string;
  initials: string;
  assignments: TeamAssignment[];
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt?: string;
  assignments: TeamAssignment[];
};

export type MetricCard = {
  key: string;
  label: string;
  value: string;
  delta: string;
  positive: boolean;
};

export type DashboardSummary = {
  totalTeams: number;
  totalMembers: number;
  biomaticTeams: number;
  tivazoTeams: number;
  biomaticMembers: number;
  tivazoMembers: number;
  /** Combined: unique Present across Bio ∪ Tivazo. */
  avgAttendance: string;
  /** Combined in→out work span average (earliest in / latest out per person). */
  avgWorkHours: string;
  /** Combined earliest first-punch average (one per person). */
  avgClockIn: string;
  /**
   * Mean |Bio↔Tivazo| lag across paired check-in gaps (Bio in → Tivazo on)
   * and check-out gaps (Tivazo off → Bio out).
   */
  avgSourceGap: string;
  biomaticPresent: number;
  bioPresent: number;
  bioTotal: number;
  tivazoPresent: number;
  tivazoTotal: number;
  bioAttendance: string;
  tivazoAttendance: string;
  /** Biometrics in→out span average for Present people. */
  bioAvgWorkHours: string;
  /** Tivazo tracked-time average per present person-day. */
  tivazoAvgWorkHours: string;
  bioClockIn: string;
  tivazoClockIn: string;
};

export type DashboardMemberFocus = {
  name: string;
  email: string;
  employeeId: string;
  sources: string[];
  biometrics: {
    day: string;
    inTime: string;
    outTime: string;
    department: string;
    designation: string;
    joined: string;
  };
  tivazo: {
    live: string;
    day: string;
    inTime: string;
    outTime: string;
    tracked: string;
    group: string;
    designation: string;
  };
};

export type CoveragePerson = {
  id: string;
  name: string;
  email: string;
  team: string;
  status: string;
  match: "email" | "none";
};

export type CoverageGaps = {
  linked: number;
  bioOnly: CoveragePerson[];
  tivazoOnly: CoveragePerson[];
  scope: string;
  teamId: string;
  memberId: string;
};

export type DashboardRosterPerson = {
  source: "bio" | "tivazo";
  id: string;
  email: string;
  name: string;
  teams: string[];
  department: string;
  groups: string[];
  attendance: string;
  status: string;
  startTime: string;
  endTime: string;
  clockedIn: string;
  lastScreenshot: string;
  trackedSeconds: number;
  trackedLabel: string;
  /** Tracked Present person-days when roster row is range-aggregated (Tivazo). */
  presentDays?: number;
  /** Present status days in range (for ranking); may exceed presentDays when some Present days have no tracked time. */
  attendedDays?: number;
  /** Absent (non-rest) person-days when roster row is range-aggregated. */
  absentDays?: number;
  /** Sum of first-in minutes across Present days (range aggregate) for day-weighted Avg Clock-in. */
  clockInSumMinutes?: number;
  /** Count of Present days that contributed to clockInSumMinutes. */
  clockInSamples?: number;
  designation: string;
  joinDate: string;
  date?: string;
};

export type DashboardOverview = {
  summary: DashboardSummary;
  filters: FilterOptions;
  trend: TrendPoint[];
  leaderboard: Leaderboard;
  hourly: {
    biometrics: HourlySeries;
    tivazo: HourlySeries;
    compare: PunchCompare;
  };
  leaderboards?: Partial<Record<TrendMetric, Leaderboard>>;
  member: DashboardMemberFocus | null;
  biomatic: BiomaticSummary;
  tivazo: TivazoSummary;
  coverage: CoverageGaps;
  roster?: {
    bio: DashboardRosterPerson[];
    tivazo: DashboardRosterPerson[];
  };
};

export type TrendPoint = {
  day: string;
  value: number;
  clockIns?: number;
  trackedSeconds?: number;
};

export type HourlyPoint = {
  hour: number;
  label: string;
  value: number;
  share?: number;
  exact?: string;
  bio?: number;
  tivazo?: number;
};

export type HourlySeries = {
  avgClockIn: string;
  people: number;
  points: HourlyPoint[];
};

export type PunchMoment = {
  time: string;
  people: number;
};

export type PunchGap = {
  label: string;
  minutes: number | null;
  people: number;
  note: string;
};

export type PunchLane = {
  first: PunchMoment;
  second: PunchMoment;
  gap: PunchGap;
  overall: PunchMoment;
};

export type PunchCompare = {
  checkIn: PunchLane;
  checkOut: PunchLane;
  /** Combined mean absolute Bio↔Tivazo lag (check-in + check-out pairs). */
  avgGap: string;
};

export type ClockSource = "biometrics" | "tivazo";

export type TrendMetric =
  | "present"
  | "attendance"
  | "occupancy"
  | "utilization"
  | "wtr";

export type LeaderRow = {
  id: string;
  name: string;
  email: string;
  team: string;
  status: string;
  value: string;
  delta: string;
  positive: boolean;
};

export type AttentionItem = {
  id: string;
  name: string;
  email: string;
  team: string;
  status: string;
  reason: string;
  value: string;
};

export type Leaderboard = {
  leaders: LeaderRow[];
  attention: AttentionItem[];
};

export type FilterOption = {
  id: string;
  label: string;
};

export type FilterOptions = {
  teams: FilterOption[];
  supervisors: FilterOption[];
  roles: FilterOption[];
  members: FilterOption[];
};

export type TeamComposition = {
  agents: number;
  leads: number;
  supervisors: number;
};

export type Team = {
  id: string;
  name: string;
  members: number;
  occupancy: string;
  utilization: string;
  wtr: string;
  attendance: string;
  composition: TeamComposition;
};

export type MemberComposition = {
  voice: number;
  chat: number;
  backoffice: number;
};

export type Member = {
  id: string;
  employeeId: string;
  teamId: string;
  name: string;
  email: string;
  role: string;
  designation: string;
  userStatus: string;
  reportsTo: string;
  tenureMonths: number;
  occupancy: string;
  utilization: string;
  wtr: string;
  attendance: string;
  status: string;
  dayStatus: string;
  inTime?: string;
  workspaceId: string;
  groups: string[];
  allTimeWorkHour: number;
  screenshotFrequency: number;
  lastActiveAt: string;
  joinedAt: string;
  avatarUrl: string;
  composition: MemberComposition;
};

export type MemberDirectoryRow = Member & {
  teamName: string;
};

export type DailyLogRow = {
  id: string;
  date: string;
  rawDate: string;
  name: string;
  email: string;
  group: string;
  groups: string[];
  role: string;
  designation: string;
  userStatus: string;
  active: string;
  disabled: string;
  status: string;
  inTime: string;
  outTime: string;
  trackedTime: string;
  manualTime: string;
  breakTime: string;
  occupancy: string;
  utilization: string;
  wtr: string;
  memberId: string;
  employeeId: string;
  workspaceId: string;
  clockedInMs: number;
  lastScreenshotMs: number;
  allTimeWorkHour: number;
  screenshotFrequency: number;
  lastActiveAt: string;
  avatarUrl: string;
};

export type ListPage<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type TivazoActivitiesPage = ListPage<DailyLogRow> & {
  present: number;
  absent: number;
};

export type BiomaticSummary = {
  totalMembers: number;
  presentMembers: number;
  absentMembers: number;
  leaveMembers: number;
  lateMembers: number;
};

export type TivazoGroupsResponse = {
  groups: FilterOption[];
};

export type TivazoSummary = {
  totalMembers: number;
  activeMembers: number;
  idleMembers: number;
  offlineMembers: number;
  presentMembers: number;
  absentMembers: number;
  avgWorkHours: string;
};

export type SearchHit = {
  kind: "person" | "team" | "group";
  id: string;
  title: string;
  subtitle: string;
  status?: string;
};

export type SearchSection = {
  people: SearchHit[];
  teams: SearchHit[];
};

export type SearchResponse = {
  query: string;
  tivazo: SearchSection;
  biomatic: SearchSection;
};

export type DailyEntry = {
  id: string;
  date: string;
  status: string;
  inTime: string;
  outTime: string;
  occupancy: string;
  utilization: string;
  wtr: string;
};

export type MemberDetail = {
  member: Member;
  cards: {
    present: string;
    absent: string;
    entries: string;
  };
  occupancyTrend: number[];
  dailyEntries: DailyEntry[];
};

export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  // Stable key order so identical filters share one cache entry / inflight request.
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `${path}?${encoded}` : path;
}

type QueryState<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
};

const inflightQueries = new Map<string, Promise<unknown>>();

function snapshotState<T>(url: string | null, force = false): QueryState<T> & { url: string | null } {
  if (!url) {
    return { url, data: null, error: null, loading: false, refreshing: false };
  }
  const hit = getCached<T>(url);
  const fresh = Boolean(hit && Date.now() - hit.at < queryTtl(url).fresh);
  return {
    url,
    data: hit?.data ?? null,
    error: null,
    loading: !hit,
    refreshing: Boolean(hit) && (!fresh || force),
  };
}

export function loadQuery<T>(url: string, force = false): Promise<T> {
  if (!force) {
    const fresh = peekFresh<T>(url);
    if (fresh !== null) return Promise.resolve(fresh);
    const pending = inflightQueries.get(url);
    if (pending) return pending as Promise<T>;
  }
  const request = apiGet<T>(url)
    .then((data) => {
      setCached(url, data);
      return data;
    })
    .finally(() => {
      if (inflightQueries.get(url) === request) inflightQueries.delete(url);
    });
  inflightQueries.set(url, request);
  return request;
}

export function prefetchQueries(urls: Array<string | null | undefined>, concurrency = 2): void {
  const unique = [...new Set(urls.filter((url): url is string => Boolean(url)))].filter(
    (url) => !peekFresh(url),
  );
  if (!unique.length) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (index < unique.length) {
      const url = unique[index];
      index += 1;
      try {
        await loadQuery(url);
      } catch {
        /* prefetch is best-effort */
      }
    }
  });
  void Promise.all(workers);
}

export function useQuery<T>(url: string | null): QueryState<T> & {
  reload: () => void;
} {
  const [epoch, setEpoch] = useState(0);
  const [seenEpoch, setSeenEpoch] = useState(0);
  const [state, setState] = useState(() => snapshotState<T>(url));
  const urlRef = useRef(url);
  const fetchedRef = useRef({ url, epoch: -1 });
  const generationRef = useRef(0);
  const previousDataRef = useRef<T | null>(state.data);

  if (state.data) previousDataRef.current = state.data;

  if (state.url !== url) {
    const next = snapshotState<T>(url);
    if (next.data) {
      setState(next);
    } else if (previousDataRef.current) {
      // Keep last good payload visible while the new range loads (no blank/freeze).
      setState({
        ...next,
        data: previousDataRef.current,
        loading: false,
        refreshing: true,
      });
    } else {
      setState(next);
    }
  } else if (epoch !== seenEpoch) {
    setSeenEpoch(epoch);
    if (url) setState(snapshotState<T>(url, true));
  }

  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    urlRef.current = url;
    if (!url) {
      generationRef.current += 1;
      fetchedRef.current = { url, epoch };
      return;
    }

    const force = fetchedRef.current.url === url && fetchedRef.current.epoch !== epoch;
    if (peekFresh<T>(url) && !force) {
      fetchedRef.current = { url, epoch };
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    loadQuery<T>(url, force)
      .then((data) => {
        if (generation !== generationRef.current || urlRef.current !== url) return;
        fetchedRef.current = { url, epoch };
        previousDataRef.current = data;
        // Defer heavy tree updates so preset clicks stay clickable while data commits.
        startTransition(() => {
          setState({ url, data, error: null, loading: false, refreshing: false });
        });
      })
      .catch((error: unknown) => {
        if (generation !== generationRef.current || urlRef.current !== url || isAbortError(error)) {
          return;
        }
        const nextError =
          error instanceof ApiError
            ? error
            : new ApiError(0, "unknown", "Something went wrong.");
        startTransition(() => {
          setState((prev) => ({
            url,
            data: prev.url === url ? prev.data : getCached<T>(url)?.data ?? previousDataRef.current,
            error: nextError,
            loading: false,
            refreshing: false,
          }));
        });
      });
  }, [url, epoch]);

  const cached = url ? getCached<T>(url) : null;
  const data = state.url === url ? state.data : cached?.data ?? state.data;
  return {
    data,
    error: state.url === url ? state.error : null,
    loading: (state.url === url ? state.loading : !cached && !state.data) && !data,
    refreshing: state.url === url ? state.refreshing : Boolean(data),
    reload,
  };
}

function mergeUnique<T>(
  prev: readonly T[],
  next: readonly T[],
  getKey: (item: T) => string | number,
): T[] {
  if (prev.length === 0) return next.slice();
  const seen = new Set(prev.map((item) => String(getKey(item))));
  const merged = prev.slice();
  for (const item of next) {
    const key = String(getKey(item));
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export type InfinitePage<T, P extends ListPage<T> = ListPage<T>> = {
  items: T[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  data: P | null;
  loadMore: () => void;
  reload: () => void;
};

export function useInfinitePage<T, P extends ListPage<T> = ListPage<T>>(
  filterKey: string | null,
  buildUrl: (offset: number) => string,
  getKey: (item: T) => string | number,
): InfinitePage<T, P> {
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<Omit<InfinitePage<T, P>, "loadMore" | "reload">>({
    items: [],
    total: 0,
    hasMore: false,
    loading: Boolean(filterKey),
    refreshing: false,
    loadingMore: false,
    error: null,
    data: null,
  });

  const buildUrlRef = useRef(buildUrl);
  const getKeyRef = useRef(getKey);
  const filterRef = useRef(filterKey);
  const cursorRef = useRef(0);
  const hasMoreRef = useRef(false);
  const inflightRef = useRef(false);
  const generationRef = useRef(0);
  const moreAbortRef = useRef<AbortController | null>(null);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  const [trackedKey, setTrackedKey] = useState(filterKey);

  if (trackedKey !== filterKey) {
    setTrackedKey(filterKey);
    if (!filterKey) {
      setState({
        items: [],
        total: 0,
        hasMore: false,
        loading: false,
        refreshing: false,
        loadingMore: false,
        error: null,
        data: null,
      });
    } else {
      setState((prev) => ({
        items: prev.items,
        total: prev.total,
        hasMore: prev.hasMore,
        loading: prev.items.length === 0,
        refreshing: prev.items.length > 0,
        loadingMore: false,
        error: null,
        data: prev.data,
      }));
    }
  }

  useEffect(() => {
    buildUrlRef.current = buildUrl;
    getKeyRef.current = getKey;
  }, [buildUrl, getKey]);

  useEffect(() => {
    moreAbortRef.current?.abort();
    moreAbortRef.current = null;

    if (!filterKey) {
      generationRef.current += 1;
      inflightRef.current = false;
      cursorRef.current = 0;
      hasMoreRef.current = false;
      filterRef.current = filterKey;
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    filterRef.current = filterKey;
    inflightRef.current = true;
    cursorRef.current = 0;
    hasMoreRef.current = false;

    apiGet<P>(buildUrlRef.current(0), { signal: controller.signal })
      .then((page) => {
        if (generation !== generationRef.current || controller.signal.aborted) {
          return;
        }
        const items = page.items ?? [];
        cursorRef.current = page.offset + items.length;
        hasMoreRef.current = Boolean(page.hasMore) && items.length > 0;
        inflightRef.current = false;
        setState({
          items,
          total: page.total,
          hasMore: hasMoreRef.current,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: null,
          data: page,
        });
      })
      .catch((error: unknown) => {
        if (
          generation !== generationRef.current ||
          controller.signal.aborted ||
          isAbortError(error)
        ) {
          return;
        }
        inflightRef.current = false;
        hasMoreRef.current = false;
        const next =
          error instanceof ApiError
            ? error
            : new ApiError(0, "unknown", "Something went wrong.");
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          loadingMore: false,
          error: next,
        }));
      });

    return () => {
      controller.abort();
      if (generation === generationRef.current) {
        inflightRef.current = false;
      }
    };
  }, [filterKey, epoch]);

  const loadMore = useCallback(() => {
    if (!filterKey) return;
    if (inflightRef.current || !hasMoreRef.current) return;
    const offset = cursorRef.current;
    if (offset <= 0) return;

    const generation = generationRef.current;
    const controller = new AbortController();
    moreAbortRef.current = controller;
    inflightRef.current = true;
    setState((prev) => ({ ...prev, loadingMore: true, error: null }));

    apiGet<P>(buildUrlRef.current(offset), { signal: controller.signal })
      .then((page) => {
        if (generation !== generationRef.current || controller.signal.aborted) {
          return;
        }
        inflightRef.current = false;
        const incoming = page.items ?? [];
        cursorRef.current = page.offset + incoming.length;
        setState((prev) => {
          const items = mergeUnique(prev.items, incoming, getKeyRef.current);
          const added = items.length - prev.items.length;
          const hasMore =
            Boolean(page.hasMore) && incoming.length > 0 && added > 0;
          hasMoreRef.current = hasMore;
          return {
            items,
            total: page.total,
            hasMore,
            loading: false,
            refreshing: false,
            loadingMore: false,
            error: null,
            data: prev.data ?? page,
          };
        });
      })
      .catch((error: unknown) => {
        if (generation !== generationRef.current) return;
        inflightRef.current = false;
        if (controller.signal.aborted || isAbortError(error)) return;
        const next =
          error instanceof ApiError
            ? error
            : new ApiError(0, "unknown", "Something went wrong.");
        setState((prev) => ({
          ...prev,
          loadingMore: false,
          error: prev.items.length > 0 ? null : next,
        }));
      });
  }, [filterKey]);

  return {
    ...state,
    loading:
      Boolean(filterKey) &&
      state.items.length === 0 &&
      !state.error &&
      (state.loading || state.data === null),
    loadMore,
    reload,
  };
}

export const TREND_METRICS: { id: TrendMetric; label: string }[] = [
  { id: "present", label: "Present" },
];
