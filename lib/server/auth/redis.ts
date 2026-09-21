import Redis from "ioredis";
import { redisUrl } from "@/lib/server/auth/types";

declare global {
  var __wfmRedis: Redis | undefined;
}

export function getRedis(): Redis {
  if (globalThis.__wfmRedis) return globalThis.__wfmRedis;
  const client = new Redis(redisUrl(), {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on("error", (error) => {
    console.error("redis error", error.message);
  });
  globalThis.__wfmRedis = client;
  return client;
}
