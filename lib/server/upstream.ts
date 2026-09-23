import { APP_TIMEZONE, isoDateInZone, normalizeDateRange } from "@/lib/datetime";

export const BIO_ORIGIN =
  process.env.BIO_ORIGIN?.replace(/\/$/, "") || "http://127.0.0.1:8091";
export const TIVAZO_ORIGIN =
  process.env.TIVAZO_ORIGIN?.replace(/\/$/, "") || "http://127.0.0.1:8090";

export class BffError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "BffError";
    this.status = status;
    this.code = code;
  }
}

export type JsonMap = Record<string, unknown>;

export function todayInAppZone(): string {
  return isoDateInZone(new Date(), APP_TIMEZONE);
}

export function readParam(url: URL, ...keys: string[]): string {
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value != null && value.trim() !== "") return value.trim();
  }
  return "";
}

export function readInt(url: URL, key: string, fallback: number): number {
  const raw = readParam(url, key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function dateRange(url: URL): { start: string; end: string } {
  return normalizeDateRange(
    readParam(url, "startDate", "start_date"),
    readParam(url, "endDate", "end_date"),
    todayInAppZone(),
  );
}

export function withParams(
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

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  return name === "AbortError";
}

function readError(body: unknown, fallback: string): { code: string; message: string } {
  if (!body || typeof body !== "object") {
    return { code: "http_error", message: fallback };
  }
  const record = body as JsonMap;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const detail = nested as JsonMap;
    return {
      code: String(detail.code || "http_error"),
      message: String(detail.message || fallback),
    };
  }
  if (typeof nested === "string" && nested) {
    return {
      code: nested,
      message: String(record.message || fallback),
    };
  }
  return {
    code: String(record.code || "http_error"),
    message: String(record.message || fallback),
  };
}

export async function upstreamGet<T>(
  origin: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    const host = origin.includes("8091") ? "Bio (port 8091)" : "Tivazo (port 8090)";
    throw new BffError(502, "network_error", `Can’t reach ${host}. Confirm the Go server is running.`);
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const fallback =
      response.status === 503
        ? "Source is still warming up. Retry in a moment."
        : response.statusText || "Request failed";
    const { code, message } = readError(parsed, fallback);
    throw new BffError(response.status, code, message);
  }

  return parsed as T;
}

export async function collectPages<T>(
  load: (
    offset: number,
    limit: number,
  ) => Promise<{ items: T[]; total: number; hasMore: boolean }>,
  signal?: AbortSignal,
): Promise<T[]> {
  const limit = 200;
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const first = await load(0, limit);
  const all = first.items.slice();
  const total = first.total;
  if (!first.items.length || !first.hasMore || all.length >= total) return all;

  const offsets: number[] = [];
  for (let offset = all.length; offset < total && offsets.length < 40; offset += limit) {
    offsets.push(offset);
  }
  const pages = await Promise.all(
    offsets.map((offset) => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return load(offset, limit);
    }),
  );
  for (const page of pages) all.push(...page.items);
  return all;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof BffError) {
    return jsonResponse(
      { error: error.code, message: error.message, code: error.status },
      error.status,
    );
  }
  if (isAbortError(error)) {
    return jsonResponse(
      { error: "aborted", message: "Request was cancelled." },
      499,
    );
  }
  const message =
    error instanceof Error ? error.message : "Unexpected BFF error";
  return jsonResponse({ error: "internal_error", message }, 500);
}

export function pageOf<T>(
  items: readonly T[],
  offset: number,
  limit: number,
): { items: T[]; total: number; limit: number; offset: number; hasMore: boolean } {
  const total = items.length;
  const start = Math.max(0, offset);
  const size = Math.min(200, Math.max(1, limit));
  const slice = items.slice(start, start + size);
  return {
    items: slice,
    total,
    limit: size,
    offset: Math.min(start, total),
    hasMore: start + slice.length < total,
  };
}
