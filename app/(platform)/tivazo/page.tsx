"use client";

import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterSearch } from "@/components/ui/FilterSearch";
import { FilterSelect } from "@/components/ui/FilterSelect";
import {
  TIVAZO_ACTIVITY_COLUMNS,
  TIVAZO_GROUP_COLUMNS,
} from "@/components/data/activity-columns";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { TivazoStatCards, type TivazoCardId } from "@/components/data/TivazoStatCards";
import { TivazoInspector } from "@/components/data/TivazoInspector";
import { useMenu } from "@/hooks/use-menu";
import {
  type DailyLogRow,
  type TivazoActivitiesPage,
  type TivazoGroupsResponse,
  useQuery,
  withQuery,
} from "@/lib/api";
import { isoDateInZone } from "@/lib/datetime";
import { filterTivazoRows, summaryFromTivazoRows, matchesPerson } from "@/lib/list-scope";
import { normalizeDayStatus } from "@/lib/server/metrics";
import { useEffect, useMemo, useState } from "react";

type Inspector =
  | { view: "present" }
  | { view: "detail"; row: DailyLogRow; fromPresent: boolean };

function rowKey(row: DailyLogRow) {
  return row.id;
}

export default function TivazoPage() {
  const today = useMemo(() => isoDateInZone(), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [emailScope, setEmailScope] = useState<string[]>([]);
  const [card, setCard] = useState<TivazoCardId>("totalMembers");
  const [inspector, setInspector] = useState<Inspector | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromGroup = params.get("group");
    const member = params.get("memberId") || "";
    const emails = (params.get("emails") || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const view = params.get("view") || "";
    const start = params.get("startDate") || "";
    const end = params.get("endDate") || "";
    if (fromGroup) setGroup((current) => current || fromGroup);
    if (member) setMemberId(member);
    if (emails.length) setEmailScope(emails);
    if (start) setStartDate(start);
    if (end) setEndDate(end);
    if (view === "present") setCard("presentMembers");
    else if (view === "absent") setCard("absentMembers");
    else if (view === "active") setCard("activeMembers");
    else if (view === "idle") setCard("idleMembers");
    else if (view === "offline") setCard("offlineMembers");
    else if (view === "teams") setCard("teams");
    else if (view === "total" || view === "members") setCard("totalMembers");
  }, []);

  useEffect(() => {
    setInspector(null);
  }, [startDate, endDate, group, query]);

  const inspectorOpen = inspector !== null;
  const { menuId, rootRef } = useMenu({
    open: inspectorOpen,
    onClose: () => setInspector(null),
  });

  const peopleStatus =
    card === "presentMembers"
      ? "Present"
      : card === "absentMembers"
        ? "Absent"
        : card === "activeMembers"
          ? "active"
          : card === "idleMembers"
            ? "idle"
            : card === "offlineMembers"
              ? "offline"
              : undefined;
  const showTeams = card === "teams";

  const groups = useQuery<TivazoGroupsResponse>(
    withQuery("/tivazo/groups", { startDate, endDate }),
  );
  const activities = useQuery<TivazoActivitiesPage>(
    withQuery("/tivazo/activities", { startDate, endDate, all: 1 }),
  );

  const catalog = useMemo(() => {
    return [...(groups.data?.groups ?? [])].sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    );
  }, [groups.data?.groups]);
  const peopleScope = useMemo(
    () => ({ memberId, emails: emailScope }),
    [memberId, emailScope],
  );
  const scopedRows = useMemo(
    () => filterTivazoRows(activities.data?.items ?? [], group, query, undefined, catalog, peopleScope),
    [activities.data?.items, group, query, catalog, peopleScope],
  );
  useEffect(() => {
    if (!memberId) return;
    const row = scopedRows.find((item) => matchesPerson(item, memberId));
    if (!row) return;
    setInspector({ view: "detail", row, fromPresent: false });
  }, [memberId, scopedRows]);
  const items = useMemo(
    () => filterTivazoRows(scopedRows, "", "", peopleStatus, catalog),
    [scopedRows, peopleStatus, catalog],
  );
  const summary = useMemo(() => summaryFromTivazoRows(scopedRows), [scopedRows]);
  const presentRows = useMemo(
    () => scopedRows.filter((row) => normalizeDayStatus(row.status) === "Present"),
    [scopedRows],
  );
  const total = items.length;
  const teamRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (item) =>
        item.label.toLowerCase().includes(needle) ||
        item.id.toLowerCase().includes(needle),
    );
  }, [catalog, query]);
  const tableEmpty =
    card === "presentMembers"
      ? "No present people for this range."
      : card === "absentMembers"
        ? "No absent people for this range."
        : card === "activeMembers"
          ? "No active people right now."
          : card === "idleMembers"
            ? "No idle people right now."
            : card === "offlineMembers"
              ? "No offline people for this range."
              : "No Tivazo activity for this range.";
  const presentCount = String(summary.presentMembers || presentRows.length || "—");
  const selectedRow = inspector?.view === "detail" ? inspector.row : null;

  return (
    <div
      className="smp-page-stack smp-page-stack--fill"
      ref={rootRef}
      data-inspector={inspectorOpen ? "true" : "false"}
    >
      <div className="smp-stage">
        {activities.data ? (
          <TivazoStatCards
            summary={summary}
            teams={catalog.length}
            selected={card}
            onSelect={(next) => {
              setInspector(null);
              setCard((current) => (current === next ? "totalMembers" : next));
            }}
          />
        ) : (
          <QueryState
            loading={activities.loading}
            error={activities.error}
            onRetry={activities.reload}
            label="Tivazo summary"
          />
        )}

        <ControlBar
          stats={[
            {
              label: "Present",
              value: String(summary.presentMembers || "—"),
              onClick: () =>
                setCard((current) =>
                  current === "presentMembers" ? "totalMembers" : "presentMembers",
                ),
              active: card === "presentMembers",
            },
            {
              label: "Teams",
              value: String(catalog.length),
              onClick: () =>
                setCard((current) => (current === "teams" ? "totalMembers" : "teams")),
              active: showTeams,
            },
            {
              label: "Absent",
              value: String(summary.absentMembers || "—"),
              onClick: () =>
                setCard((current) =>
                  current === "absentMembers" ? "totalMembers" : "absentMembers",
                ),
              active: card === "absentMembers",
            },
            { label: "Records", value: String(showTeams ? teamRows.length : total || "—") },
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
              label="Group"
              value={group}
              allLabel="All groups"
              options={catalog}
              searchable
              onChange={setGroup}
            />
            <FilterSearch
              value={query}
              onChange={setQuery}
              placeholder={showTeams ? "Team name" : "Name, email, group"}
            />
          </div>
        </ControlBar>

        {showTeams ? (
          groups.error && teamRows.length === 0 ? (
            <QueryState
              loading={false}
              error={groups.error}
              onRetry={groups.reload}
              label="Tivazo teams"
            />
          ) : (
            <DataTable
              columns={TIVAZO_GROUP_COLUMNS}
              rows={teamRows}
              getKey={(row) => row.id}
              resetKey={`${startDate}:${endDate}:${query}`}
              totalCount={teamRows.length}
              empty={
                groups.loading ? "Loading Tivazo teams…" : "No teams match these filters."
              }
              refreshing={groups.loading || groups.refreshing}
              onRowClick={(row) => {
                setGroup(row.id);
                setCard("totalMembers");
                setQuery("");
              }}
            />
          )
        ) : activities.error && items.length === 0 ? (
          <QueryState
            loading={false}
            error={activities.error}
            onRetry={activities.reload}
            label="Tivazo activity"
          />
        ) : (
          <DataTable
            columns={TIVAZO_ACTIVITY_COLUMNS}
            rows={items}
            getKey={rowKey}
            selectedKey={selectedRow?.id ?? null}
            resetKey={`${startDate}:${endDate}:${group}:${query}:${card}`}
            totalCount={total}
            empty={activities.loading ? "Loading Tivazo activity…" : tableEmpty}
            refreshing={activities.loading || activities.refreshing}
            onRowClick={(row) =>
              setInspector((current) =>
                current?.view === "detail" && current.row.id === row.id
                  ? null
                  : { view: "detail", row, fromPresent: false },
              )
            }
          />
        )}
      </div>

      <TivazoInspector
        id={menuId}
        open={inspectorOpen}
        view={inspector?.view === "present" ? "present" : "detail"}
        count={presentCount}
        rows={presentRows}
        detail={selectedRow}
        loading={inspector?.view === "present" ? activities.loading && presentRows.length === 0 : false}
        error={
          inspector?.view === "present" && presentRows.length === 0
            ? activities.error
            : null
        }
        onRetry={activities.reload}
        onClose={() => setInspector(null)}
        onBack={
          inspector?.view === "detail" && inspector.fromPresent
            ? () => setInspector({ view: "present" })
            : undefined
        }
        onSelect={(row) =>
          setInspector({ view: "detail", row, fromPresent: true })
        }
      />
    </div>
  );
}
