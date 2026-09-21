export type BiomaticView = "present" | "leave" | "absent" | "members" | "teams";
export type TivazoView =
  | "total"
  | "present"
  | "active"
  | "idle"
  | "offline"
  | "absent"
  | "teams";

export function dashboardSourceHref(
  path: "/biomatic" | "/tivazo",
  view: string,
  extras: {
    teamId?: string;
    memberId?: string;
    emails?: string[];
    startDate?: string;
    endDate?: string;
  } = {},
): string {
  const params = new URLSearchParams();
  if (view) params.set("view", view);
  if (extras.startDate) params.set("startDate", extras.startDate);
  if (extras.endDate) params.set("endDate", extras.endDate);
  if (extras.memberId) params.set("memberId", extras.memberId);
  if (extras.emails?.length) params.set("emails", extras.emails.slice(0, 200).join(","));
  if (extras.teamId) {
    params.set(path === "/tivazo" ? "group" : "teamId", extras.teamId);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function bioMemberHref(
  id: string,
  extras: { startDate?: string; endDate?: string } = {},
): string {
  const params = new URLSearchParams();
  if (extras.startDate) params.set("startDate", extras.startDate);
  if (extras.endDate) params.set("endDate", extras.endDate);
  const query = params.toString();
  const path = `/biomatic/members/${encodeURIComponent(id)}`;
  return query ? `${path}?${query}` : path;
}

export function tivazoMemberHref(id: string): string {
  return `/tivazo/${encodeURIComponent(id)}`;
}
