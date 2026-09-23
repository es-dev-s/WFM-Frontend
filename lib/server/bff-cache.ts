import { getRedis } from "@/lib/server/auth/redis";
import { redisKeyPrefix } from "@/lib/server/auth/types";

export type SnapshotTtl = { fresh: number; stale: number };

type SnapshotEntry<T> = { key: string; at: number; value: T };
type RedisPayload<T> = { at: number; value: T };

const MAX_REDIS_CHARS = 1_200_000;

function redisCacheKey(ns: string, key: string): string {
  return `${redisKeyPrefix()}wfm:bff:v1:${ns}:${key}`;
}

function ttlSeconds(ttl: SnapshotTtl): number {
  return Math.max(20, Math.ceil(ttl.stale / 1000));
}

async function redisGet<T>(ns: string, key: string): Promise<RedisPayload<T> | null> {
  try {
    const raw = await getRedis().get(redisCacheKey(ns, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RedisPayload<T>;
    if (!parsed || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function redisSet<T>(ns: string, key: string, value: T, ttl: SnapshotTtl): void {
  try {
    const payload = JSON.stringify({ at: Date.now(), value } satisfies RedisPayload<T>);
    if (payload.length > MAX_REDIS_CHARS) return;
    void getRedis()
      .set(redisCacheKey(ns, key), payload, "EX", ttlSeconds(ttl))
      .catch(() => undefined);
  } catch {
    /* Redis is optional for BFF snapshots. */
  }
}

export function createSnapshotCache<T>(options: {
  max?: number;
  ttl: (key: string) => SnapshotTtl;
  redis?: string;
}) {
  const max = Math.max(1, options.max ?? 24);
  const entries = new Map<string, SnapshotEntry<T>>();
  const inflight = new Map<string, Promise<T>>();
  const ns = options.redis || "";

  function remember(key: string, value: T, at = Date.now(), persist = false) {
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { key, at, value });
    while (entries.size > max) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      entries.delete(oldest);
    }
    if (ns && persist) redisSet(ns, key, value, options.ttl(key));
  }

  function refresh(key: string, load: () => Promise<T>): Promise<T> {
    const pending = inflight.get(key);
    if (pending) return pending;
    const promise = load()
      .then((value) => {
        remember(key, value, Date.now(), true);
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
    peek(key: string): T | null {
      const hit = entries.get(key);
      if (!hit) return null;
      const ttl = options.ttl(key);
      if (Date.now() - hit.at >= ttl.stale) return null;
      return hit.value;
    },
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit) {
        remember(key, hit.value, hit.at, false);
        const age = Date.now() - hit.at;
        const ttl = options.ttl(key);
        if (age < ttl.fresh) return Promise.resolve(hit.value);
        if (age < ttl.stale) {
          void refresh(key, load);
          return Promise.resolve(hit.value);
        }
      }
      if (!ns) return refresh(key, load);
      return redisGet<T>(ns, key).then((stored) => {
        if (stored) {
          remember(key, stored.value, stored.at, false);
          const age = Date.now() - stored.at;
          const ttl = options.ttl(key);
          if (age < ttl.fresh) return stored.value;
          if (age < ttl.stale) {
            void refresh(key, load);
            return stored.value;
          }
        }
        return refresh(key, load);
      });
    },
  };
}
