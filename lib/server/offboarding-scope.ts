import { AsyncLocalStorage } from "node:async_hooks";
import {
  listOffboarding,
  type OffboardingRecord,
} from "@/lib/server/offboarding";
import type { JsonMap } from "@/lib/server/upstream";

/**
 * Per-request view of HR's resignation records.
 *
 * An employee stays in active headcount through their last working date and is
 * dropped from the first day after it (the "effective date"). Lists and
 * headcounts are evaluated as of `referenceDay`: the end of the requested
 * range, or today. A past range that ends on or before the last working date
 * therefore still includes the person.
 */
type OffboardingScope = {
  referenceDay: string;
  byEmail: Map<string, OffboardingRecord>;
  byMemberId: Map<string, OffboardingRecord>;
  /** Changes whenever the set of records or the reference day changes. */
  cacheKey: string;
};

const store = new AsyncLocalStorage<OffboardingScope>();

const CACHE_TTL_MS = 20_000;
type Loader = () => Promise<{ items: OffboardingRecord[]; today: string }>;
let loader: Loader = () => listOffboarding();

/** Test seam: swap where records come from, and drop the cache. */
export function setOffboardingLoaderForTests(next: Loader | null) {
  loader = next ?? (() => listOffboarding());
  cached = null;
  inflight = null;
}

let cached: { at: number; records: OffboardingRecord[]; today: string } | null = null;
let inflight: Promise<OffboardingRecord[]> | null = null;

/** Drop the cached records (call after HR saves or removes one). */
export function invalidateOffboardingCache() {
  cached = null;
}

async function loadRecords(): Promise<OffboardingRecord[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.records;
  inflight ??= loader()
    .then((list) => {
      cached = { at: Date.now(), records: list.items ?? [], today: list.today };
      return cached.records;
    })
    .finally(() => {
      inflight = null;
    });
  try {
    return await inflight;
  } catch (error) {
    // Reports must keep working when the records service is down: fall back to the
    // last good copy, or to "nobody has resigned".
    console.error("offboarding load failed", error instanceof Error ? error.message : error);
    return cached?.records ?? [];
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function buildScope(records: OffboardingRecord[], referenceDay: string): OffboardingScope {
  const byEmail = new Map<string, OffboardingRecord>();
  const byMemberId = new Map<string, OffboardingRecord>();
  for (const record of records) {
    const email = clean(record.employeeEmail);
    if (email) byEmail.set(email, record);
    const memberId = clean(record.memberId);
    if (memberId) byMemberId.set(memberId, record);
  }
  const version = records.map((r) => `${r.id}:${r.updatedAt}`).sort().join(",");
  return { referenceDay, byEmail, byMemberId, cacheKey: `${referenceDay}|${version}` };
}

/** Run `fn` with the resignation records for `referenceDay` available to the filters below. */
export async function runWithOffboarding<T>(referenceDay: string, fn: () => Promise<T>): Promise<T> {
  const records = await loadRecords();
  return store.run(buildScope(records, referenceDay), fn);
}

export function offboardingCacheKey(): string {
  return store.getStore()?.cacheKey ?? "";
}

function recordFor(scope: OffboardingScope, row: JsonMap): OffboardingRecord | undefined {
  const email = clean(row.email);
  if (email) {
    const hit = scope.byEmail.get(email);
    if (hit) return hit;
  }
  const id = clean(row.id);
  return id ? scope.byMemberId.get(id) : undefined;
}

/** True once the employee's effective date has been reached on the reference day. */
export function isSeparated(row: JsonMap): boolean {
  const scope = store.getStore();
  if (!scope) return false;
  const record = recordFor(scope, row);
  return Boolean(record && record.effectiveDate && record.effectiveDate <= scope.referenceDay);
}

/** Remove employees whose effective date has passed from a member list. */
export function excludeSeparated<T extends JsonMap>(members: T[]): T[] {
  const scope = store.getStore();
  if (!scope || (scope.byEmail.size === 0 && scope.byMemberId.size === 0)) return members;
  const kept = members.filter((row) => !isSeparated(row));
  return kept.length === members.length ? members : kept;
}

/** Resignation record for a member row (any state), for badges and reports. */
export function offboardingFor(row: JsonMap): OffboardingRecord | undefined {
  const scope = store.getStore();
  return scope ? recordFor(scope, row) : undefined;
}

/** All records, for reports that need every state. */
export async function allOffboarding(): Promise<OffboardingRecord[]> {
  return loadRecords();
}

export type RowOffboarding = {
  status: "Serving notice" | "Resigned";
  lastWorkingDate: string;
};

const ANNOTATED_KEYS = new Set(["items", "logs", "members", "rows", "employee", "member", "detail"]);

function isPerson(value: unknown): value is JsonMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as JsonMap;
  return typeof row.email === "string" && row.email !== "" && (typeof row.name === "string" || typeof row.id === "string");
}

/**
 * Tag member/log rows that have a resignation record so tables can show a badge.
 * Copy-on-write: cached payloads are shared between requests and must not be mutated.
 */
export function annotateOffboarding<T>(body: T, depth = 0): T {
  const scope = store.getStore();
  if (!scope || (scope.byEmail.size === 0 && scope.byMemberId.size === 0) || depth > 3) return body;
  if (Array.isArray(body)) {
    let changed = false;
    const next = body.map((item) => {
      const out = annotateOffboarding(item, depth + 1);
      if (out !== item) changed = true;
      return out;
    });
    return (changed ? next : body) as T;
  }
  if (!body || typeof body !== "object") return body;
  let result = body as JsonMap;
  if (isPerson(result)) {
    const record = recordFor(scope, result);
    if (record) {
      const offboarding: RowOffboarding = {
        status: record.effectiveDate <= scope.referenceDay ? "Resigned" : "Serving notice",
        lastWorkingDate: record.lastWorkingDate,
      };
      result = { ...result, offboarding };
    }
  }
  for (const key of Object.keys(result)) {
    if (!ANNOTATED_KEYS.has(key)) continue;
    const value = result[key];
    const out = annotateOffboarding(value, depth + 1);
    if (out !== value) {
      if (result === (body as JsonMap)) result = { ...result };
      result[key] = out;
    }
  }
  return result as T;
}
