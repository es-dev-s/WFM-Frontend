import type { DashboardRosterPerson, FilterOption } from "@/lib/api";
import { biomaticHref, peopleScopeParam, tivazoHref, type PageScope } from "@/lib/href";
import {
  createIdentityIndex,
  identityCanonical,
  type IdentityLike,
} from "@/lib/identity";
import { normalizeDayStatus } from "@/lib/server/metrics";

export type CardKind = "all" | "present" | "leave" | "absent" | "active" | "idle" | "offline";

export function peopleOnTeam(
  teamId: string,
  people: DashboardRosterPerson[],
  teams: FilterOption[] = [],
): boolean {
  if (!teamId) return false;
  const aliases = new Set<string>([teamId.trim().toLowerCase()]);
  for (const team of teams) {
    if (
      team.id.trim().toLowerCase() === teamId.trim().toLowerCase() ||
      team.label.trim().toLowerCase() === teamId.trim().toLowerCase()
    ) {
      aliases.add(team.id.trim().toLowerCase());
      aliases.add(team.label.trim().toLowerCase());
    }
  }
  return people.some((person) =>
    person.teams.some((value) => aliases.has(value.trim().toLowerCase())),
  );
}

export function cardPeople(rows: DashboardRosterPerson[], kind: CardKind): DashboardRosterPerson[] {
  if (kind === "all") return rows;
  if (kind === "present") return rows.filter((row) => normalizeDayStatus(row.attendance) === "Present");
  if (kind === "leave") return rows.filter((row) => normalizeDayStatus(row.attendance) === "Leave");
  if (kind === "absent") return rows.filter((row) => normalizeDayStatus(row.attendance) === "Absent");
  const live = (row: DashboardRosterPerson) => row.status.trim().toLowerCase();
  if (kind === "active") return rows.filter((row) => live(row) === "active" || live(row) === "tracking");
  if (kind === "idle") return rows.filter((row) => live(row) === "idle");
  return rows.filter((row) => live(row) === "offline");
}

export function sourceCardHref(
  source: "bio" | "tivazo",
  view: string,
  people: DashboardRosterPerson[],
  options: {
    startDate: string;
    endDate: string;
    teamId: string;
    memberId: string;
    native: boolean;
  },
): string {
  const scope: PageScope = {
    view,
    startDate: options.startDate,
    endDate: options.endDate,
    memberId: options.memberId || undefined,
  };
  if (options.memberId) {
    return source === "bio" ? biomaticHref(scope) : tivazoHref(scope);
  }
  if (options.native && options.teamId) {
    scope.teamId = options.teamId;
  } else {
    Object.assign(scope, peopleScopeParam(people));
  }
  return source === "bio" ? biomaticHref(scope) : tivazoHref(scope);
}

export function isBioTeam(teamId: string, people: DashboardRosterPerson[], teams: FilterOption[] = []): boolean {
  return peopleOnTeam(teamId, people, teams);
}

export function isTivazoTeam(teamId: string, people: DashboardRosterPerson[], teams: FilterOption[] = []): boolean {
  return peopleOnTeam(teamId, people, teams);
}

function asIdentity(row: DashboardRosterPerson): IdentityLike {
  return {
    email: row.email,
    id: row.id,
    name: row.name,
    source: row.source,
  };
}

export type PairedPerson = {
  key: string;
  name: string;
  email: string;
  team: string;
  bio?: DashboardRosterPerson;
  tivazo?: DashboardRosterPerson;
};

export function pairRosterPeople(
  focus: DashboardRosterPerson[],
  bio: DashboardRosterPerson[],
  tivazo: DashboardRosterPerson[],
): PairedPerson[] {
  const index = createIdentityIndex([...focus, ...bio, ...tivazo].map(asIdentity));
  const bioByKey = new Map<string, DashboardRosterPerson>();
  const tivazoByKey = new Map<string, DashboardRosterPerson>();
  for (const row of bio) {
    const key = identityCanonical(index, asIdentity(row));
    if (key) bioByKey.set(key, row);
  }
  for (const row of tivazo) {
    const key = identityCanonical(index, asIdentity(row));
    if (key) tivazoByKey.set(key, row);
  }
  const seen = new Set<string>();
  const out: PairedPerson[] = [];
  for (const row of focus) {
    const key = identityCanonical(index, asIdentity(row)) || row.email.trim().toLowerCase() || row.id || row.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const bioRow = bioByKey.get(key) || (row.source === "bio" ? row : undefined);
    const tivazoRow = tivazoByKey.get(key) || (row.source === "tivazo" ? row : undefined);
    out.push({
      key,
      name: row.name || bioRow?.name || tivazoRow?.name || "Unknown",
      email: row.email || bioRow?.email || tivazoRow?.email || "",
      team:
        row.teams.find((value) => value && value !== "unassigned") ||
        bioRow?.teams.find((value) => value && value !== "unassigned") ||
        tivazoRow?.teams.find((value) => value && value !== "unassigned") ||
        "",
      bio: bioRow,
      tivazo: tivazoRow,
    });
  }
  return out.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}
