import Redis from "ioredis";
import { redisUrl } from "@/lib/server/auth/types";

declare global {
  var __wfmRedis: Redis | undefined;
}

function isRedisAuthError(message: string): boolean {
  return /WRONGPASS|invalid username-password|NOAUTH|user is disabled/i.test(message);
}

export function getRedis(): Redis {
  if (globalThis.__wfmRedis) return globalThis.__wfmRedis;

  let authFailed = false;
  let loggedAuthError = false;

  const client = new Redis(redisUrl(), {
    maxRetriesPerRequest: 2,
    // ACL users such as mesh_r_wfm_redis typically cannot run INFO.
    enableReadyCheck: false,
    lazyConnect: false,
    retryStrategy(times) {
      if (authFailed) return null;
      return Math.min(times * 200, 3_000);
    },
  });

  client.on("error", (error) => {
    const message = error.message || String(error);
    if (isRedisAuthError(message)) {
      authFailed = true;
      if (loggedAuthError) return;
      loggedAuthError = true;
      console.error(
        "redis auth failed: REDIS_URL username or password does not match Redis, or the ACL user is disabled.",
      );
      return;
    }
    console.error("redis error", message);
  });

  globalThis.__wfmRedis = client;
  return client;
}
