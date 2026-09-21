import { authRoleLabel, isOrgWideAuthRole, isScopedAuthRole, type AuthRole } from "@/lib/auth-role";
import type { FilterOption, TeamAssignment } from "@/lib/api";
import { formatInstantMs } from "@/lib/datetime";

export type UserDraft = {
  id?: string;
  name: string;
  email: string;
  password: string;
  status: "active" | "disabled";
  initialStatus?: "active" | "disabled";
  role: AuthRole;
  assignments: TeamAssignment[];
  lastLoginAt?: string | null;
  updatedAt?: string;
  justCreated?: boolean;
  passwordTouched?: boolean;
};

export function validateUserDraft(
  draft: UserDraft,
  mode: "create" | "update",
): string | null {
  if (draft.name.trim().replace(/\s+/g, " ").length < 2) {
    return "Enter the user’s name.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    return "Enter a valid work email.";
  }
  if (mode === "create" || draft.password.trim()) {
    const password = draft.password.trim();
    if (password.length < 12) return "Password must be at least 12 characters.";
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return "Password must include letters and numbers.";
    }
  }
  if (isScopedAuthRole(draft.role) && draft.assignments.length === 0) {
    return "Choose at least one Tivazo group or Biometrics department.";
  }
  return null;
}

export function roleLabel(role: UserDraft["role"]): string {
  return authRoleLabel(role);
}

export function assignmentKey(item: TeamAssignment) {
  return `${item.source}:${item.teamId}`;
}

export function generateLeadPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `Lead#${body.slice(0, 10)}9`;
}

export function lastSeen(value: string | null | undefined): string {
  if (!value) return "Never";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? formatInstantMs(ms) : "Never";
}

const OPAQUE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function namedTeamOptions(options: FilterOption[]) {
  return options.filter((item) => item.label.trim() && !OPAQUE_ID.test(item.label.trim()));
}

export function assignmentLabel(
  item: TeamAssignment,
  options: FilterOption[],
): string {
  const hit = options.find(
    (option) =>
      option.id === item.teamId ||
      option.label === item.teamId ||
      option.id === item.teamLabel ||
      option.label === item.teamLabel,
  );
  const label = hit?.label || item.teamLabel;
  return OPAQUE_ID.test(label) ? "Tivazo group" : label;
}
