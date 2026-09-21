export const AUTH_ROLES = ["wfm", "team_lead", "hr"] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export function isAuthRole(value: unknown): value is AuthRole {
  return value === "wfm" || value === "team_lead" || value === "hr";
}

export function isScopedAuthRole(role: string | undefined | null): boolean {
  return role === "team_lead";
}

export function isOrgWideAuthRole(role: string | undefined | null): boolean {
  return role === "wfm" || role === "hr";
}

export function authRoleLabel(role: string | undefined | null): string {
  if (role === "wfm") return "Superadmin";
  if (role === "hr") return "HR";
  if (role === "team_lead") return "Team lead";
  return "User";
}
