/** Persist dashboard filter choices across refresh, navigation, and logout. */

export const DASHBOARD_FILTERS_STORAGE_KEY = "wfm.dashboard.filters";

export type StoredDashboardFilters = {
  teamId: string;
  memberId: string;
};

const EMPTY: StoredDashboardFilters = { teamId: "", memberId: "" };

export function readDashboardFilters(): StoredDashboardFilters {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(DASHBOARD_FILTERS_STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<StoredDashboardFilters>;
    return {
      teamId: typeof parsed.teamId === "string" ? parsed.teamId : "",
      memberId: typeof parsed.memberId === "string" ? parsed.memberId : "",
    };
  } catch {
    return EMPTY;
  }
}

export function writeDashboardFilters(next: StoredDashboardFilters) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      DASHBOARD_FILTERS_STORAGE_KEY,
      JSON.stringify({
        teamId: next.teamId || "",
        memberId: next.memberId || "",
      }),
    );
  } catch {
    /* quota / private mode */
  }
}
