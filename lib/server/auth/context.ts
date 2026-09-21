import { AsyncLocalStorage } from "node:async_hooks";
import type { AuthUser } from "@/lib/server/auth/types";
import { BffError } from "@/lib/server/upstream";

const store = new AsyncLocalStorage<AuthUser>();

export function runWithAuth<T>(user: AuthUser, fn: () => T): T {
  return store.run(user, fn);
}

export function getAuth(): AuthUser {
  const user = store.getStore();
  if (!user) {
    throw new BffError(401, "unauthenticated", "Sign in to continue.");
  }
  return user;
}

export function getAuthOptional(): AuthUser | null {
  return store.getStore() ?? null;
}

export function isWfm(user: AuthUser | null = getAuthOptional()): boolean {
  return user?.role === "wfm";
}

export function isTeamLead(user: AuthUser | null = getAuthOptional()): boolean {
  return user?.role === "team_lead";
}

export function isHr(user: AuthUser | null = getAuthOptional()): boolean {
  return user?.role === "hr";
}

export function requireWfm(): AuthUser {
  const user = getAuth();
  if (user.role !== "wfm") {
    throw new BffError(403, "forbidden", "Only WFM can manage access.");
  }
  return user;
}
