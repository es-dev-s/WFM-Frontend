"use client";

import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterSearch } from "@/components/ui/FilterSearch";
import { FilterSelect } from "@/components/ui/FilterSelect";
import {
  ACTIVITY_COLUMNS,
  MEMBER_COLUMNS,
  TEAM_COLUMNS,
} from "@/components/data/activity-columns";
import {
  BiomaticStatCards,
  type BiomaticCardId,
} from "@/components/data/BiomaticStatCards";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import {
  type DailyLogRow,
  type FilterOptions,
  type ListPage,
  type MemberDirectoryRow,
  useQuery,
  withQuery,
} from "@/lib/api";
import { isoDateInZone } from "@/lib/datetime";
import { recordHref } from "@/lib/href";
import {
  filterBioLogs,
  filterBioMembers,
  summaryFromBioMembers,
  teamsFromBioMembers,
} from "@/lib/list-scope";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Tab = "teams" | "members" | "logs";

function selectedBiomaticCard(tab: Tab, dayStatus: string): BiomaticCardId | null {
  if (dayStatus === "Present") return "presentMembers";
  if (dayStatus === "Leave") return "leaveMembers";
  if (dayStatus === "Absent") return "absentMembers";
  if (tab === "teams") return "teams";
  if (tab === "members") return "totalMembers";
  return null;
}

function memberKey(row: MemberDirectoryRow) {
  return row.id;
}

function logKey(row: DailyLogRow) {
  return row.id;
}

export default function BiomaticPage() {
  const router = useRouter();
  const today = useMemo(() => isoDateInZone(), []);
  const [tab, setTab] = useState<Tab>("teams");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [teamId, setTeamId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [dayStatus, setDayStatus] = useState("");
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [emailScope, setEmailScope] = useState<string[]>([]);
  const [idScope, setIdScope] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get("view") || "";
    const team = params.get("teamId") || "";
    const member = params.get("memberId") || "";
    const emails = (params.get("emails") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const ids = (params.get("ids") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const start = params.get("startDate") || "";
    const end = params.get("endDate") || "";
    if (team) setTeamId(team);
    if (member) setMemberId(member);
    if (emails.length) setEmailScope(emails);
    if (ids.length) setIdScope(ids);
    if (start) setStartDate(start);
    if (end) setEndDate(end);
    if (view === "members") {
      setTab("members");
      setDayStatus("");
      return;
    }
    if (view === "teams") {
      setTab("teams");
      setDayStatus("");
      return;
    }
    if (view === "logs") {
      setTab("logs");
      setDayStatus("");
      return;
    }
    if (view === "present" || view === "leave" || view === "absent") {
      setTab("members");
      setDayStatus(view === "present" ? "Present" : view === "leave" ? "Leave" : "Absent");
    }
  }, []);

  const snapshotParams = useMemo(
    () => ({ startDate, endDate, all: 1 }),
    [startDate, endDate],
  );
  const filters = useQuery<FilterOptions>(
    withQuery("/filters", { startDate, endDate }),
  );
  const membersAll = useQuery<ListPage<MemberDirectoryRow>>(
    withQuery("/members", snapshotParams),
  );
  const logsAll = useQuery<ListPage<DailyLogRow>>(
    tab === "logs" ? withQuery("/daily-logs", snapshotParams) : null,
  );

  // Table rows may narrow by the selected department + page search.
  const filteredTeams = useMemo(
    () => teamsFromBioMembers(membersAll.data?.items ?? [], teamId, query),
    [membersAll.data?.items, teamId, query],
  );
  // Dropdown catalog must stay the full department list — never the selected subset.
  // (Previously filterTeams was derived from filteredTeams, so after picking one
  // department the searchable options collapsed to only that department.)
  const catalogTeams = useMemo(
    () => teamsFromBioMembers(membersAll.data?.items ?? [], "", ""),
    [membersAll.data?.items],
  );
  const filterTeams = useMemo(() => {
    const byId = new Map((filters.data?.teams ?? []).map((team) => [team.id, team]));
    for (const team of catalogTeams) {
      if (!team.id || byId.has(team.id)) continue;
      byId.set(team.id, { id: team.id, label: team.name });
    }
    return [...byId.values()].sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
  }, [filters.data?.teams, catalogTeams]);
  const filterRoles = filters.data?.roles ?? [];
  const peopleScope = useMemo(
    () => ({ memberId, emails: emailScope, ids: idScope }),
    [memberId, emailScope, idScope],
  );
  const pinnedPeople = Boolean(idScope.length || (!memberId && emailScope.length));
  const scopedMembers = useMemo(
    () =>
      filterBioMembers(membersAll.data?.items ?? [], teamId, roleId, query, "", filterTeams, peopleScope),
    [membersAll.data?.items, teamId, roleId, query, filterTeams, peopleScope],
  );
  const memberRows = useMemo(() => {
    if (tab === "logs") return scopedMembers;
    // Chart click pins the exact Present set — show that list as-is so counts match hover.
    if (pinnedPeople) return scopedMembers;
    if (!dayStatus) return scopedMembers;
    return filterBioMembers(scopedMembers, "", "", "", dayStatus, [], peopleScope);
  }, [scopedMembers, tab, dayStatus, peopleScope, pinnedPeople]);
  const summary = useMemo(() => summaryFromBioMembers(scopedMembers), [scopedMembers]);
  const logRows = useMemo(
    () =>
      filterBioLogs(
        logsAll.data?.items ?? [],
        teamId,
        roleId,
        dayStatus,
        query,
        filterTeams,
        peopleScope,
      ),
    [logsAll.data?.items, teamId, roleId, dayStatus, query, filterTeams, peopleScope],
  );

  const activeError =
    tab === "teams" || tab === "members" ? membersAll.error : logsAll.error;
  const activeHasRows =
    tab === "teams"
      ? filteredTeams.length > 0
      : tab === "members"
        ? memberRows.length > 0
        : logRows.length > 0;
  const retry = () => {
    filters.reload();
    membersAll.reload();
    logsAll.reload();
  };
  const selectedCard = selectedBiomaticCard(tab, dayStatus);
  const logsEmpty =
    dayStatus === "Present"
      ? "No present attendance for this range."
      : dayStatus === "Leave"
        ? "No leave rows for this range."
        : dayStatus === "Absent"
          ? "No absent attendance for this range."
          : "No attendance rows match these filters.";

  const applyCard = (next: BiomaticCardId) => {
    setIdScope([]);
    setEmailScope([]);
    if (selectedCard === next) {
      if (next === "presentMembers" || next === "leaveMembers" || next === "absentMembers") {
        setDayStatus("");
      }
      return;
    }
    if (next === "teams") {
      setTab("teams");
      setDayStatus("");
      return;
    }
    if (next === "totalMembers") {
      setTab("members");
      setDayStatus("");
      return;
    }
    setTab("members");
    setDayStatus(
      next === "presentMembers" ? "Present" : next === "leaveMembers" ? "Leave" : "Absent",
    );
  };

  return (
    <div className="smp-page-stack smp-page-stack--fill">
      <div className="smp-stage">
        {membersAll.data ? (
          <BiomaticStatCards
            summary={summary}
            teams={filterTeams.length}
            selected={selectedCard}
            onSelect={applyCard}
          />
        ) : (
          <QueryState
            loading={membersAll.loading}
            error={membersAll.error}
            onRetry={membersAll.reload}
            label="Biometrics summary"
          />
        )}

        <ControlBar
          leading={
            <div
              className="smp-segment"
              role="tablist"
              aria-label="Biometrics views"
            >
              {(
                [
                  ["teams", "Departments"],
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
              ? { label: "Departments", value: String(filteredTeams.length) }
              : tab === "members"
                ? {
                    label: pinnedPeople ? "People" : "Members",
                    value: String(memberRows.length || "—"),
                  }
                : {
                    label: "Logs",
                    value: String(logRows.length || "—"),
                  },
          ]}
        >
          <div className="smp-filters--inline">
            <DateRangePicker
              start={startDate}
              end={endDate}
              max={today}
              onChange={(nextStart, nextEnd) => {
                setStartDate(nextStart);
                setEndDate(nextEnd);
              }}
            />
            <FilterSelect
              label="Department"
              value={teamId}
              allLabel="All departments"
              options={filterTeams}
              searchable
              onChange={(next) => {
                setTeamId(next);
                setIdScope([]);
                setEmailScope([]);
              }}
            />
            <FilterSelect
              label="Role"
              value={roleId}
              allLabel="All roles"
              options={filterRoles}
              searchable
              onChange={setRoleId}
            />
            {tab === "members" || tab === "logs" ? (
              <FilterSelect
                label="Day"
                value={dayStatus}
                allLabel="All days"
                options={[
                  { id: "Present", label: "Present" },
                  { id: "Absent", label: "Absent" },
                  { id: "Leave", label: "Leave" },
                ]}
                onChange={(next) => {
                  setDayStatus(next);
                  setIdScope([]);
                  setEmailScope([]);
                }}
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
            label="Biometrics"
          />
        ) : tab === "teams" ? (
          <DataTable
            columns={TEAM_COLUMNS}
            rows={filteredTeams}
            getKey={(row) => row.id}
            resetKey={`${teamId}:${query}`}
            totalCount={filteredTeams.length}
            empty={
              membersAll.loading ? "Loading departments…" : "No departments match these filters."
            }
            refreshing={membersAll.loading || membersAll.refreshing}
            onRowClick={(row) =>
              router.push(recordHref("/biomatic/teams", row.id))
            }
          />
        ) : tab === "members" ? (
          <DataTable
            columns={MEMBER_COLUMNS}
            rows={memberRows}
            getKey={memberKey}
            resetKey={`${startDate}:${endDate}:${teamId}:${roleId}:${query}:${dayStatus}`}
            totalCount={memberRows.length}
              empty={
                membersAll.loading
                  ? "Loading members…"
                  : dayStatus === "Present"
                    ? "No present members for this range."
                    : dayStatus === "Leave"
                      ? "No leave members for this range."
                      : dayStatus === "Absent"
                        ? "No absent members for this range."
                        : "No members match these filters."
              }
            refreshing={membersAll.loading || membersAll.refreshing}
            onRowClick={(row) =>
              router.push(recordHref("/biomatic/members", row.id))
            }
          />
        ) : (
          <DataTable
            columns={ACTIVITY_COLUMNS}
            rows={logRows}
            getKey={logKey}
            resetKey={`${startDate}:${endDate}:${teamId}:${roleId}:${dayStatus}:${query}`}
            totalCount={logRows.length}
            empty={
              logsAll.loading
                ? "Loading daily logs…"
                : logsEmpty
            }
            refreshing={logsAll.loading || logsAll.refreshing}
            onRowClick={(row) =>
              router.push(recordHref("/biomatic/logs", row.id))
            }
          />
        )}
      </div>
    </div>
  );
}
