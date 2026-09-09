"use client";

import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { FilterSearch } from "@/components/ui/FilterSearch";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { ACTIVITY_COLUMNS } from "@/components/data/activity-columns";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { TivazoStatCards } from "@/components/data/TivazoStatCards";
import { TivazoInspector } from "@/components/data/TivazoInspector";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMenu } from "@/hooks/use-menu";
import {
  type DailyLogRow,
  type TivazoActivitiesPage,
  type TivazoGroupsResponse,
  type TivazoSummary,
  useInfinitePage,
  useQuery,
  withQuery,
} from "@/lib/api";
import { isoDateInZone } from "@/lib/datetime";
import { useCallback, useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 50;

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
  const [inspector, setInspector] = useState<Inspector | null>(null);
  const debouncedQuery = useDebouncedValue(query);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("group");
    if (fromUrl) setGroup(fromUrl);
  }, []);

  useEffect(() => {
    setInspector(null);
  }, [startDate, endDate, group, debouncedQuery]);

  const inspectorOpen = inspector !== null;
  const { menuId, rootRef } = useMenu({
    open: inspectorOpen,
    onClose: () => setInspector(null),
  });

  const listParams = useMemo(
    () => ({
      startDate,
      endDate,
      group: group || undefined,
      q: debouncedQuery || undefined,
    }),
    [startDate, endDate, group, debouncedQuery],
  );

  const filterKey = withQuery("/tivazo/activities", listParams);
  const buildListUrl = useCallback(
    (offset: number) =>
      withQuery("/tivazo/activities", {
        ...listParams,
        limit: PAGE_SIZE,
        offset,
      }),
    [listParams],
  );

  const groups = useQuery<TivazoGroupsResponse>("/tivazo/groups");
  const summaryKey = withQuery("/tivazo/summary", listParams);
  const summary = useQuery<TivazoSummary>(summaryKey);
  const page = useInfinitePage<DailyLogRow, TivazoActivitiesPage>(
    filterKey,
    buildListUrl,
    rowKey,
  );

  const keepPresent =
    inspector?.view === "present" ||
    (inspector?.view === "detail" && inspector.fromPresent);
  const presentKey = keepPresent
    ? withQuery("/tivazo/activities", { ...listParams, status: "Present" })
    : null;
  const buildPresentUrl = useCallback(
    (offset: number) =>
      withQuery("/tivazo/activities", {
        ...listParams,
        status: "Present",
        limit: PAGE_SIZE,
        offset,
      }),
    [listParams],
  );
  const present = useInfinitePage<DailyLogRow, TivazoActivitiesPage>(
    presentKey,
    buildPresentUrl,
    rowKey,
  );

  const items = page.items;
  const total = page.total;
  const catalog = groups.data?.groups ?? [];
  const presentRows = present.items;
  const presentCount = String(page.data?.present ?? present.data?.total ?? "—");
  const selectedRow = inspector?.view === "detail" ? inspector.row : null;

  return (
    <div
      className="smp-page-stack smp-page-stack--fill"
      ref={rootRef}
      data-inspector={inspectorOpen ? "true" : "false"}
    >
      <div className="smp-stage">
        {summary.data ? (
          <TivazoStatCards summary={summary.data} />
        ) : (
          <QueryState
            loading={summary.loading}
            error={summary.error}
            onRetry={summary.reload}
            label="Tivazo summary"
          />
        )}

        <ControlBar
          stats={[
            {
              label: "Present",
              value: String(page.data?.present ?? "—"),
              onClick: () =>
                setInspector((current) =>
                  current?.view === "present" ? null : { view: "present" },
                ),
              active: inspector?.view === "present",
            },
            { label: "Absent", value: String(page.data?.absent ?? "—") },
            { label: "Records", value: String(total || "—") },
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
              onChange={setGroup}
            />
            <FilterSearch
              value={query}
              onChange={setQuery}
              placeholder="Name, email, group"
            />
          </div>
        </ControlBar>

        {page.error && items.length === 0 ? (
          <QueryState
            loading={false}
            error={page.error}
            onRetry={page.reload}
            label="Tivazo activity"
          />
        ) : (
          <DataTable
            columns={ACTIVITY_COLUMNS}
            rows={items}
            getKey={rowKey}
            selectedKey={selectedRow?.id ?? null}
            resetKey={filterKey}
            hasMore={page.hasMore}
            loadingMore={page.loadingMore}
            totalCount={total}
            onNearEnd={page.loadMore}
            empty={
              page.loading
                ? "Loading Tivazo activity…"
                : "No Tivazo activity for this range."
            }
            refreshing={page.loading || page.refreshing}
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
        loading={
          inspector?.view === "present"
            ? present.loading && presentRows.length === 0
            : false
        }
        loadingMore={present.loadingMore}
        hasMore={present.hasMore}
        onNearEnd={present.loadMore}
        error={
          inspector?.view === "present" && presentRows.length === 0
            ? present.error
            : null
        }
        onRetry={present.reload}
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
