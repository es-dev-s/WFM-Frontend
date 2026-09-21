import { asString, asStringArray, humanLabel, isOpaqueId } from "@/lib/server/metrics";
import { isScopedAuthRole } from "@/lib/auth-role";
import { getAuthOptional, isTeamLead } from "@/lib/server/auth/context";
import type { TeamAssignment } from "@/lib/server/auth/types";
import { BffError } from "@/lib/server/upstream";
import type { JsonMap } from "@/lib/server/upstream";
import type { FilterOption } from "@/lib/api";
import { AsyncLocalStorage } from "node:async_hooks";

export type ScopeSource = TeamAssignment["source"];

export type GroupCatalogEntry = {
  id: string;
  label: string;
  memberIds: string[];
};

const catalogStore = new AsyncLocalStorage<GroupCatalogEntry[]>();

export function runWithCatalog<T>(catalog: GroupCatalogEntry[], fn: () => T): T {
  return catalogStore.run(catalog, fn);
}

export function groupCatalog(): GroupCatalogEntry[] {
  return catalogStore.getStore() ?? [];
}

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function teamsMatch(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (isOpaqueId(a) || isOpaqueId(b)) return false;
  return fold(a) === fold(b);
}

function uniqueKeys(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key) continue;
    const folded = fold(key) || key.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(key);
  }
  return out;
}

function assignmentKeys(assignment: TeamAssignment, catalog: GroupCatalogEntry[]): string[] {
  const keys = [assignment.teamId, assignment.teamLabel];
  if (assignment.source !== "tivazo") return uniqueKeys(keys);
  for (const group of catalog) {
    if (
      teamsMatch(group.id, assignment.teamId) ||
      teamsMatch(group.label, assignment.teamId) ||
      teamsMatch(group.id, assignment.teamLabel) ||
      teamsMatch(group.label, assignment.teamLabel)
    ) {
      keys.push(group.id, group.label);
    }
  }
  return uniqueKeys(keys);
}

function catalogForKeys(keys: string[], catalog: GroupCatalogEntry[]): GroupCatalogEntry[] {
  return catalog.filter((group) =>
    keys.some((key) => teamsMatch(group.id, key) || teamsMatch(group.label, key)),
  );
}

function memberInTivazoScope(
  raw: JsonMap,
  assignment: TeamAssignment,
  catalog: GroupCatalogEntry[],
): boolean {
  const keys = assignmentKeys(assignment, catalog);
  if (!keys.length) return false;
  const memberId = asString(raw.id);
  for (const group of catalogForKeys(keys, catalog)) {
    if (memberId && group.memberIds.includes(memberId)) return true;
  }
  const groups = [...asStringArray(raw.groups), asString(raw.group)];
  return groups.some((group) => keys.some((key) => teamsMatch(group, key)));
}

function memberInBioScope(raw: JsonMap, assignment: TeamAssignment): boolean {
  const department = asString(raw.department);
  const teamId = asString(raw.teamId);
  const teamName = asString(raw.teamName);
  return [department, teamId, teamName].some(
    (value) => teamsMatch(value, assignment.teamId) || teamsMatch(value, assignment.teamLabel),
  );
}

export function catalogFromGroups(groups: JsonMap[]): GroupCatalogEntry[] {
  const out: GroupCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const id = asString(group.id) || asString(group.name);
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const label =
      humanLabel(asString(group.name)) ||
      humanLabel(asString(group.label)) ||
      humanLabel(id);
    const memberIds = uniqueKeys([
      ...asStringArray(group.member_ids),
      ...asStringArray(group.manager_ids),
      ...asStringArray(group.members),
      ...asStringArray(group.managers),
    ]);
    out.push({
      id,
      label: label || (memberIds.length ? `Tivazo group · ${memberIds.length} members` : ""),
      memberIds,
    });
  }
  return out;
}

export function namedTeamOptions(entries: GroupCatalogEntry[]): FilterOption[] {
  return entries
    .map((entry) => ({
      id: entry.id,
      label: humanLabel(entry.label) || entry.label,
    }))
    .filter((entry) => humanLabel(entry.label))
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
}

export function leadAssignments(): TeamAssignment[] | null {
  const user = getAuthOptional();
  if (!user) return [];
  if (!isScopedAuthRole(user.role)) return null;
  return user.assignments ?? [];
}

function relevantAssignments(source?: ScopeSource): TeamAssignment[] | null {
  const assignments = leadAssignments();
  if (!assignments) return null;
  if (!source) return assignments;
  return assignments.filter((item) => item.source === source);
}

export function memberInLeadScope(
  raw: JsonMap,
  assignments = leadAssignments(),
  source?: ScopeSource,
): boolean {
  if (!assignments) return true;
  const relevant = source ? assignments.filter((item) => item.source === source) : assignments;
  if (!relevant.length) return false;
  const catalog = groupCatalog();
  return relevant.some((assignment) =>
    assignment.source === "tivazo"
      ? memberInTivazoScope(raw, assignment, catalog)
      : memberInBioScope(raw, assignment),
  );
}

export function filterMembersForLead<T extends JsonMap>(
  members: T[],
  source?: ScopeSource,
): T[] {
  const assignments = relevantAssignments(source);
  if (!assignments) return members;
  if (!assignments.length) return [];
  return members.filter((row) => memberInLeadScope(row, assignments, source));
}

export function teamInLeadScope(
  teamId: string,
  teamLabel = "",
  source?: ScopeSource,
): boolean {
  const assignments = relevantAssignments(source);
  if (!assignments) return true;
  if (!teamId && !teamLabel) return true;
  if (!assignments.length) return false;
  const catalog = source === "biometrics" ? [] : groupCatalog();
  return assignments.some((assignment) => {
    const keys = assignmentKeys(assignment, assignment.source === "tivazo" ? catalog : []);
    return keys.some((key) => teamsMatch(key, teamId) || teamsMatch(key, teamLabel));
  });
}

export function assertTeamAccess(
  teamId: string,
  teamLabel = "",
  source?: ScopeSource,
): void {
  if (!isTeamLead()) return;
  if (!teamId) return;
  if (teamInLeadScope(teamId, teamLabel, source)) return;
  throw new BffError(403, "forbidden", "That team is outside your assignment.");
}

export function restrictTeamOptions(
  options: FilterOption[],
  source?: ScopeSource,
): FilterOption[] {
  const assignments = relevantAssignments(source);
  if (!assignments) return options;
  if (!assignments.length) return [];
  return options.filter((option) => teamInLeadScope(option.id, option.label, source));
}

export function rowInLeadScope(row: {
  group?: string;
  teamName?: string;
  email?: string;
  memberId?: string;
}): boolean {
  const assignments = relevantAssignments("tivazo");
  if (!assignments) return true;
  if (!assignments.length) return false;
  const catalog = groupCatalog();
  const memberId = String(row.memberId || "").trim();
  const haystack = [row.group, row.teamName].filter(Boolean) as string[];
  return assignments.some((assignment) => {
    const keys = assignmentKeys(assignment, catalog);
    if (haystack.some((value) => keys.some((key) => teamsMatch(value, key)))) return true;
    if (!memberId) return false;
    return catalogForKeys(keys, catalog).some((group) => group.memberIds.includes(memberId));
  });
}

export function relabelAssignments(
  assignments: TeamAssignment[],
  tivazo: FilterOption[],
  biometrics: FilterOption[],
): TeamAssignment[] {
  return assignments.map((assignment) => {
    const list = assignment.source === "tivazo" ? tivazo : biometrics;
    const hit = list.find(
      (option) =>
        teamsMatch(option.id, assignment.teamId) ||
        teamsMatch(option.label, assignment.teamId) ||
        teamsMatch(option.id, assignment.teamLabel) ||
        teamsMatch(option.label, assignment.teamLabel),
    );
    const label = humanLabel(hit?.label) || humanLabel(assignment.teamLabel) || assignment.teamLabel;
    return {
      ...assignment,
      teamId: hit?.id || assignment.teamId,
      teamLabel: label,
    };
  });
}
