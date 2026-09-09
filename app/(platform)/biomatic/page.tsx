"use client";

import { FilterSearch } from "@/components/ui/FilterSearch";
import { FilterSelect } from "@/components/ui/FilterSelect";
import {
  ACTIVITY_COLUMNS,
  MEMBER_COLUMNS,
  TEAM_COLUMNS,
} from "@/components/data/activity-columns";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  type DailyLogRow,
  type FilterOptions,
  type ListPage,
  type MemberDirectoryRow,
  type Team,
  useInfinitePage,
  useQuery,
  withQuery,
} from "@/lib/api";
import { recordHref } from "@/lib/href";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

const PAGE_SIZE = 40;

type Tab = "teams" | "members" | "logs";

function memberKey(row: MemberDirectoryRow) {
  return row.id;
}

function logKey(row: DailyLogRow) {
  return row.id;
}

export default function BiomaticPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("teams");
  const [teamId, setTeamId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [dayStatus, setDayStatus] = useState("");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);

  const listParams = useMemo(
    () => ({
      teamId: teamId || undefined,
      role: roleId || undefined,
      status: tab === "logs" ? dayStatus || undefined : undefined,
      q: debouncedQuery || undefined,
    }),
    [teamId, roleId, dayStatus, debouncedQuery, tab],
  );

  const membersKey =
    tab === "members" ? withQuery("/members", listParams) : null;
  const logsKey =
    tab === "logs" ? withQuery("/daily-logs", listParams) : null;

  const buildMembersUrl = useCallback(
    (offset: number) =>
      withQuery("/members", { ...listParams, limit: PAGE_SIZE, offset }),
    [listParams],
  );
  const buildLogsUrl = useCallback(
    (offset: number) =>
      withQuery("/daily-logs", { ...listParams, limit: PAGE_SIZE, offset }),
    [listParams],
  );

  const filters = useQuery<FilterOptions>("/filters");
  const teams = useQuery<Team[]>(tab === "teams" ? "/teams" : null);
  const members = useInfinitePage<MemberDirectoryRow, ListPage<MemberDirectoryRow>>(
    membersKey,
    buildMembersUrl,
    memberKey,
  );
  const logs = useInfinitePage<DailyLogRow, ListPage<DailyLogRow>>(
    logsKey,
    buildLogsUrl,
    logKey,
  );

  const filteredTeams = useMemo(() => {
    const list = teams.data ?? [];
    const needle = debouncedQuery.trim().toLowerCase();
    return list.filter((team) => {
      if (teamId && team.id !== teamId) return false;
      if (!needle) return true;
      return team.name.toLowerCase().includes(needle);
    });
  }, [teams.data, teamId, debouncedQuery]);

  const memberRows = members.items;
  const logRows = logs.items;
  const filterTeams = filters.data?.teams ?? [];
  const filterRoles = filters.data?.roles ?? [];

  const activeError =
    tab === "teams"
      ? teams.error
      : tab === "members"
        ? members.error
        : logs.error;
  const activeHasRows =
    tab === "teams"
      ? filteredTeams.length > 0
      : tab === "members"
        ? memberRows.length > 0
        : logRows.length > 0;
  const retry = () => {
    filters.reload();
    if (tab === "teams") teams.reload();
    else if (tab === "members") members.reload();
    else logs.reload();
  };

  return (
    <div className="smp-page-stack smp-page-stack--fill">
      <div className="smp-stage">
        <ControlBar
          leading={
            <div
              className="smp-segment"
              role="tablist"
              aria-label="Biomatic views"
            >
              {(
                [
                  ["teams", "Teams"],
                  ["members", "Members"],
                  ["logs", "Logs"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="smp-segment__btn"
                  data-active={tab === id ? "true" : "false"}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          }
          stats={[
            tab === "teams"
              ? { label: "Teams", value: String(filteredTeams.length) }
              : tab === "members"
                ? {
                    label: "Members",
                    value: String(members.total || "—"),
                  }
                : {
                    label: "Logs",
                    value: String(logs.total || "—"),
                  },
          ]}
        >
          <div className="smp-filters--inline">
            <FilterSelect
              label="Team"
              value={teamId}
              allLabel="All teams"
              options={filterTeams}
              onChange={setTeamId}
            />
            <FilterSelect
              label="Role"
              value={roleId}
              allLabel="All roles"
              options={filterRoles}
              onChange={setRoleId}
            />
            {tab === "logs" ? (
              <FilterSelect
                label="Day"
                value={dayStatus}
                allLabel="All days"
                options={[
                  { id: "Present", label: "Present" },
                  { id: "Absent", label: "Absent" },
                ]}
                onChange={setDayStatus}
              />
            ) : null}
            <FilterSearch
              value={query}
              onChange={setQuery}
              placeholder="Name, email, or team"
            />
          </div>
        </ControlBar>

        {activeError && !activeHasRows ? (
          <QueryState
            loading={false}
            error={activeError}
            onRetry={retry}
            label="Biomatic"
          />
        ) : tab === "teams" ? (
          <DataTable
            columns={TEAM_COLUMNS}
            rows={filteredTeams}
            getKey={(row) => row.id}
            resetKey={`${teamId}:${debouncedQuery}`}
            totalCount={filteredTeams.length}
            empty={
              teams.loading ? "Loading teams…" : "No teams match these filters."
            }
            refreshing={teams.loading || teams.refreshing}
            onRowClick={(row) =>
              router.push(recordHref("/biomatic/teams", row.id))
            }
          />
        ) : tab === "members" ? (
          <DataTable
            columns={MEMBER_COLUMNS}
            rows={memberRows}
            getKey={memberKey}
            resetKey={membersKey ?? "members"}
            hasMore={members.hasMore}
            loadingMore={members.loadingMore}
            totalCount={members.total}
            onNearEnd={members.loadMore}
            empty={
              members.loading
                ? "Loading members…"
                : "No members match these filters."
            }
            refreshing={members.loading || members.refreshing}
            onRowClick={(row) =>
              router.push(recordHref("/biomatic/members", row.id))
            }
          />
        ) : (
          <DataTable
            columns={ACTIVITY_COLUMNS}
            rows={logRows}
            getKey={logKey}
            resetKey={logsKey ?? "logs"}
            hasMore={logs.hasMore}
            loadingMore={logs.loadingMore}
            totalCount={logs.total}
            onNearEnd={logs.loadMore}
            empty={
              logs.loading
                ? "Loading daily logs…"
                : "No attendance rows match these filters."
            }
            refreshing={logs.loading || logs.refreshing}
            onRowClick={(row) =>
              router.push(recordHref("/biomatic/logs", row.id))
            }
          />
        )}
      </div>
    </div>
  );
}
