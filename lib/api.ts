"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export type HealthResponse = {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  uptimeMs: number;
  timestamp: string;
};

export type MetricCard = {
  key: string;
  label: string;
  value: string;
  delta: string;
  positive: boolean;
};

export type TrendPoint = {
  day: string;
  value: number;
};

export type TrendMetric = "present";

export type LeaderRow = {
  id: string;
  name: string;
  team: string;
  value: string;
  delta: string;
  positive: boolean;
};

export type AttentionItem = {
  id: string;
  name: string;
  team: string;
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
  workspaceId: string;
  groups: string[];
  allTimeWorkHour: number;
  screenshotFrequency: number;
  lastActiveAt: string;
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

export type TivazoGroupsResponse = {
  groups: FilterOption[];
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

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError";
}

let dbChain: Promise<unknown> = Promise.resolve();

function enqueueDb<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const next = dbChain.then(async () => {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return task();
  });
  dbChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function shouldSerialize(path: string): boolean {
  const bare = path.split("?")[0];
  return (
    bare.startsWith("/dashboard") ||
    bare === "/teams" ||
    bare.startsWith("/teams/") ||
    bare === "/members" ||
    bare.startsWith("/members/") ||
    bare === "/daily-logs" ||
    bare === "/filters"
  );
}

export async function apiGet<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;

  const execute = async () => {
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
        "Can’t reach the API. Confirm the Go server is running on port 18780.",
      );
    }

    if (response.status === 502 || response.status === 504) {
      throw new ApiError(
        response.status,
        "network_error",
        "Can’t reach the API. Confirm the Go server is running on port 18780.",
      );
    }

    if (!response.ok) {
      let code = "http_error";
      let message = response.statusText || "Request failed";
      let parsed = false;
      try {
        const body = (await response.json()) as ApiErrorBody;
        parsed = true;
        if (body.error) code = body.error;
        if (body.message) message = body.message;
      } catch {
        /* ignore non-JSON error bodies */
      }
      if (!parsed && response.status >= 500) {
        throw new ApiError(
          response.status,
          "network_error",
          "Can’t reach the API. Confirm the Go server is running on port 18780.",
        );
      }
      throw new ApiError(response.status, code, message);
    }

    return (await response.json()) as T;
  };

  const relative = path.startsWith("http")
    ? path
    : path.startsWith("/")
      ? path
      : `/${path}`;
  if (shouldSerialize(relative)) {
    const signal = init?.signal ?? undefined;
    return enqueueDb(execute, signal ?? undefined);
  }
  return execute();
}

export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
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

export function useQuery<T>(url: string | null): QueryState<T> & {
  reload: () => void;
} {
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<QueryState<T>>({
    data: null,
    error: null,
    loading: Boolean(url),
    refreshing: false,
  });

  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false, refreshing: false });
      return;
    }

    const controller = new AbortController();
    setState((prev) => ({
      ...prev,
      error: null,
      loading: prev.data === null,
      refreshing: prev.data !== null,
    }));

    apiGet<T>(url, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ data, error: null, loading: false, refreshing: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        const next =
          error instanceof ApiError
            ? error
            : new ApiError(0, "unknown", "Something went wrong.");
        setState((prev) => ({
          data: prev.data,
          error: next,
          loading: false,
          refreshing: false,
        }));
      });

    return () => controller.abort();
  }, [url, epoch]);

  return { ...state, reload };
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

  buildUrlRef.current = buildUrl;
  getKeyRef.current = getKey;

  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    moreAbortRef.current?.abort();
    moreAbortRef.current = null;

    if (!filterKey) {
      generationRef.current += 1;
      inflightRef.current = false;
      cursorRef.current = 0;
      hasMoreRef.current = false;
      filterRef.current = filterKey;
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
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    const sameFilter = filterRef.current === filterKey;
    filterRef.current = filterKey;
    inflightRef.current = true;
    cursorRef.current = 0;
    hasMoreRef.current = false;

    setState((prev) => ({
      items: sameFilter ? prev.items : [],
      total: sameFilter ? prev.total : 0,
      hasMore: false,
      loading: !sameFilter || prev.items.length === 0,
      refreshing: sameFilter && prev.items.length > 0,
      loadingMore: false,
      error: null,
      data: sameFilter ? prev.data : null,
    }));

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
      inflightRef.current = false;
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
        if (generation !== generationRef.current) return;
        inflightRef.current = false;
        if (controller.signal.aborted) return;
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
