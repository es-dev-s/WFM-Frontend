import { getRedis } from "@/lib/server/auth/redis";
import { redisKeyPrefix } from "@/lib/server/auth/types";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 8;

export async function loginAllowed(email: string, ip: string): Promise<boolean> {
  const redis = getRedis();
  const emailCount = Number(await redis.get(failKey("email", email))) || 0;
  const ipCount = Number(await redis.get(failKey("ip", ip))) || 0;
  return emailCount < MAX_ATTEMPTS && ipCount < MAX_ATTEMPTS * 3;
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const redis = getRedis();
  const emailKey = failKey("email", email);
  const ipKey = failKey("ip", ip);
  const emailCount = await redis.incr(emailKey);
  const ipCount = await redis.incr(ipKey);
  if (emailCount === 1) await redis.expire(emailKey, WINDOW_SECONDS);
  if (ipCount === 1) await redis.expire(ipKey, WINDOW_SECONDS);
}

export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  const redis = getRedis();
  await redis.del(failKey("email", email), failKey("ip", ip));
}

function failKey(kind: "email" | "ip", value: string): string {
  return `${redisKeyPrefix()}wfm:login-fail:${kind}:${value.toLowerCase()}`;
}
