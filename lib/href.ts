export function recordHref(base: string, id: string): string {
  return `${base}/${encodeURIComponent(id)}`;
}

export function readParamId(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export type PageScope = {
  view?: string;
  teamId?: string;
  memberId?: string;
  emails?: string;
  ids?: string;
  startDate?: string;
  endDate?: string;
};

export function pageHref(
  path: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function emailsParam(values: Array<string | undefined | null>, limit = 80): string | undefined {
  const emails = [
    ...new Set(
      values
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!emails.length || emails.length > limit) return undefined;
  return emails.join(",");
}

export function idsParam(values: Array<string | undefined | null>, limit = 80): string | undefined {
  const ids = [
    ...new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  if (!ids.length || ids.length > limit) return undefined;
  return ids.join(",");
}

export function peopleScopeParam(
  people: Array<{ id?: string; email?: string | null }>,
  limit = 80,
): Pick<PageScope, "ids" | "emails"> {
  if (!people.length || people.length > limit) return {};
  return {
    ids: idsParam(
      people.map((person) => person.id),
      limit,
    ),
    emails: emailsParam(
      people.map((person) => person.email),
      limit,
    ),
  };
}

export function biomaticHref(scope: PageScope = {}): string {
  return pageHref("/biomatic", {
    view: scope.view,
    teamId: scope.teamId,
    memberId: scope.memberId,
    emails: scope.emails,
    ids: scope.ids,
    startDate: scope.startDate,
    endDate: scope.endDate,
  });
}

export function tivazoHref(scope: PageScope = {}): string {
  return pageHref("/tivazo", {
    view: scope.view,
    group: scope.teamId,
    memberId: scope.memberId,
    emails: scope.emails,
    ids: scope.ids,
    startDate: scope.startDate,
    endDate: scope.endDate,
  });
}
