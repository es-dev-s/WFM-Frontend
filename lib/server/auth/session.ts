import { getRedis } from "@/lib/server/auth/redis";
import { redisKeyPrefix, SESSION_TTL_SECONDS, sessionSecret, type AuthUser } from "@/lib/server/auth/types";
import { randomSessionId, signSessionToken, verifySessionToken } from "@/lib/auth/session-token";
import { loadUserById } from "@/lib/server/auth/users";

const prefix = () => redisKeyPrefix();
const SESSION_PREFIX = () => `${prefix()}wfm:session:`;
const USER_SESSIONS_PREFIX = () => `${prefix()}wfm:user-sessions:`;

type SessionRecord = {
  userId: string;
  createdAt: number;
};

export async function createSession(user: AuthUser): Promise<{ token: string; maxAge: number }> {
  const redis = getRedis();
  const sessionId = randomSessionId();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const record: SessionRecord = { userId: user.id, createdAt: Date.now() };
  await redis.set(SESSION_PREFIX() + sessionId, JSON.stringify(record), "EX", SESSION_TTL_SECONDS);
  await redis.sadd(USER_SESSIONS_PREFIX() + user.id, sessionId);
  await redis.expire(USER_SESSIONS_PREFIX() + user.id, SESSION_TTL_SECONDS);
  const token = await signSessionToken(sessionId, expiresAt, sessionSecret());
  return { token, maxAge: SESSION_TTL_SECONDS };
}

export async function peekSessionId(token: string): Promise<string | null> {
  if (!token) return null;
  const verified = await verifySessionToken(token, sessionSecret()).catch(() => null);
  return verified?.sessionId ?? null;
}

export async function readSessionUser(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  const verified = await verifySessionToken(token, sessionSecret());
  if (!verified) return null;
  const redis = getRedis();
  const raw = await redis.get(SESSION_PREFIX() + verified.sessionId);
  if (!raw) return null;
  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
  const user = await loadUserById(record.userId);
  if (!user || user.status !== "active") return null;
  await redis.expire(SESSION_PREFIX() + verified.sessionId, SESSION_TTL_SECONDS);
  await redis.expire(USER_SESSIONS_PREFIX() + user.id, SESSION_TTL_SECONDS);
  return user;
}

export async function destroySession(token: string): Promise<void> {
  const verified = await verifySessionToken(token, sessionSecret()).catch(() => null);
  if (!verified) return;
  const redis = getRedis();
  const raw = await redis.get(SESSION_PREFIX() + verified.sessionId);
  await redis.del(SESSION_PREFIX() + verified.sessionId);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as SessionRecord;
    await redis.srem(USER_SESSIONS_PREFIX() + record.userId, verified.sessionId);
  } catch {
    /* ignore */
  }
}

export async function destroyUserSessions(
  userId: string,
  keepSessionId?: string,
): Promise<void> {
  const redis = getRedis();
  const ids = await redis.smembers(USER_SESSIONS_PREFIX() + userId);
  const drop = keepSessionId ? ids.filter((id) => id !== keepSessionId) : ids;
  if (!drop.length) {
    if (!keepSessionId) await redis.del(USER_SESSIONS_PREFIX() + userId);
    return;
  }
  await redis.del(...drop.map((id) => SESSION_PREFIX() + id));
  if (keepSessionId) {
    await redis.srem(USER_SESSIONS_PREFIX() + userId, ...drop);
  } else {
    await redis.del(USER_SESSIONS_PREFIX() + userId);
  }
}
