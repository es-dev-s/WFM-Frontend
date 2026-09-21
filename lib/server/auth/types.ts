import { authRoleLabel, type AuthRole } from "@/lib/auth-role";

export const AUTH_COOKIE = process.env.AUTH_COOKIE_NAME?.trim() || "wfm_session";

export const SESSION_TTL_SECONDS = Math.max(
  60 * 30,
  Number.parseInt(process.env.SESSION_TTL_SECONDS || "43200", 10) || 43_200,
);

export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim() || "";
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  }
  return secret;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim() || "";
  if (!url) throw new Error("DATABASE_URL is not set.");
  return url;
}

export function redisUrl(): string {
  const url = process.env.REDIS_URL?.trim() || "";
  if (!url) throw new Error("REDIS_URL is not set.");
  return url;
}

export function redisKeyPrefix(): string {
  const configured = process.env.REDIS_KEY_PREFIX?.trim();
  if (configured) return configured.endsWith(":") ? configured : `${configured}:`;
  try {
    const parsed = new URL(redisUrl());
    const user = decodeURIComponent(parsed.username || "");
    return user ? `${user}:` : "";
  } catch {
    return "";
  }
}

export function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  assignments: TeamAssignment[];
}): PublicUser {
  const initials = user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "W";
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roleLabel: authRoleLabel(user.role),
    initials,
    assignments: user.assignments,
  };
}

export type TeamAssignment = {
  source: "tivazo" | "biometrics";
  teamId: string;
  teamLabel: string;
};

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  status: "active" | "disabled";
  assignments: TeamAssignment[];
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  roleLabel: string;
  initials: string;
  assignments: TeamAssignment[];
};
