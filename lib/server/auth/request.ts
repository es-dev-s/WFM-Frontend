import { cookies } from "next/headers";
import { AUTH_COOKIE } from "@/lib/server/auth/types";
import { readCookie } from "@/lib/server/auth/http";
import { readSessionUser } from "@/lib/server/auth/session";
import type { AuthUser } from "@/lib/server/auth/types";

export async function getSessionFromRequest(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request.headers.get("cookie"));
  if (!token) return null;
  try {
    return await readSessionUser(token);
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<AuthUser | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value ?? "";
  if (!token) return null;
  try {
    return await readSessionUser(token);
  } catch {
    return null;
  }
}

export async function requireSessionFromRequest(request: Request): Promise<AuthUser> {
  const user = await getSessionFromRequest(request);
  if (!user) {
    const { BffError } = await import("@/lib/server/upstream");
    throw new BffError(401, "unauthenticated", "Sign in to continue.");
  }
  return user;
}
