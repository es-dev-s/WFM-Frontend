import { isoDateInZone } from "@/lib/datetime";

type CacheEntry<T> = { data: T; at: number };

const MAX_ENTRIES = 64;
const cache = new Map<string, CacheEntry<unknown>>();

function rangeFromUrl(url: string): { start: string; end: string } {
  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(query);
  return {
    start: params.get("startDate") || params.get("start_date") || "",
    end: params.get("endDate") || params.get("end_date") || "",
  };
}

export function queryTtl(url: string): { fresh: number; stale: number } {
  if (url.includes("/dashboard/presence")) return { fresh: 15_000, stale: 45_000 };
  const today = isoDateInZone();
  const { start, end } = rangeFromUrl(url);
  const todayOnly = Boolean(start && end && start === end && start === today);
  if (todayOnly || !start || !end) return { fresh: 20_000, stale: 90_000 };
  return { fresh: 180_000, stale: 1_800_000 };
}

function isHollowPayload(url: string, data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const rec = data as {
    summary?: { totalMembers?: number };
    roster?: { bio?: unknown[]; tivazo?: unknown[] };
    items?: unknown[];
    days?: { present?: number }[];
  };
  if (url.includes("/dashboard/overview")) {
    const people = rec.summary?.totalMembers ?? 0;
    const roster = (rec.roster?.bio?.length ?? 0) + (rec.roster?.tivazo?.length ?? 0);
    return people === 0 && roster === 0;
  }
  if (url.includes("/daily-logs") || url.includes("/tivazo/activities")) {
    return Array.isArray(rec.items) && rec.items.length === 0 && url.includes("startDate=");
  }
  if (url.includes("/dashboard/presence")) {
    const days = Array.isArray(rec.days) ? rec.days : [];
    const hits = days.filter((row) => Number(row.present) > 0).length;
    return days.length > 7 && hits <= 1;
  }
  return false;
}

export function getCached<T>(url: string): CacheEntry<T> | null {
  const hit = cache.get(url) as CacheEntry<T> | undefined;
  if (!hit) return null;
  if (isHollowPayload(url, hit.data)) {
    cache.delete(url);
    return null;
  }
  cache.delete(url);
  cache.set(url, hit);
  return hit;
}

export function peekFresh<T>(url: string): T | null {
  const hit = getCached<T>(url);
  if (!hit) return null;
  return Date.now() - hit.at < queryTtl(url).fresh ? hit.data : null;
}

export function setCached<T>(url: string, data: T): void {
  if (isHollowPayload(url, data)) {
    cache.delete(url);
    return;
  }
  if (cache.has(url)) cache.delete(url);
  cache.set(url, { data, at: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === url) break;
    cache.delete(oldest);
  }
}
