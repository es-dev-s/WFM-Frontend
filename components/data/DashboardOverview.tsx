"use client";

import { DashboardCoverageModal } from "@/components/data/DashboardCoverageModal";
import {
  DashboardDateRangePicker,
  useDashboardDateRange,
} from "@/components/data/DashboardDateRangePicker";
import { DashboardMemberProfile } from "@/components/data/DashboardMemberProfile";
import { DashboardStatCards } from "@/components/data/DashboardStatCards";
import { QueryState } from "@/components/data/QueryState";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { MotionSection } from "@/components/ui/MotionSection";
import { formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { scopeDashboard, selectVisibleRoster } from "@/lib/dashboard-scope";
import {
  type DashboardOverview as DashboardOverviewData,
  prefetchQueries,
  useQuery,
  withQuery,
} from "@/lib/api";
import { presetQueryUrls } from "@/lib/dashboard-prefetch";
import {
  readDashboardFilters,
  writeDashboardFilters,
} from "@/lib/dashboard-filter-storage";
import { GitCompareArrows } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense, startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

const panelFallback = (
  <div className="smp-panel smp-dashboard-panel smp-dashboard-panel--lazy" aria-busy="true" />
);

const DashboardHourlyPanel = dynamic(
  () =>
    import("@/components/data/DashboardHourlyPanel").then((m) => ({
      default: m.DashboardHourlyPanel,
    })),
  { loading: () => panelFallback },
);
const DashboardLeaderboardPanel = dynamic(
  () =>
    import("@/components/data/DashboardLeaderboardPanel").then((m) => ({
      default: m.DashboardLeaderboardPanel,
    })),
  { loading: () => panelFallback },
);
const DashboardSourceSnapshots = dynamic(
  () =>
    import("@/components/data/DashboardSourceSnapshots").then((m) => ({
      default: m.DashboardSourceSnapshots,
    })),
  { loading: () => panelFallback },
);
const DashboardMemberPeriodStats = dynamic(
  () =>
    import("@/components/data/DashboardMemberPeriodStats").then((m) => ({
      default: m.DashboardMemberPeriodStats,
    })),
  { loading: () => panelFallback },
);

const EMPTY_FILTERS: DashboardOverviewData["filters"]["members"] = [];

export function DashboardOverview() {
  const { start: startDate, end: endDate, setRange } = useDashboardDateRange();
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [filtersReady, setFiltersReady] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [punchSource, setPunchSource] = useState<"all" | "bio" | "tivazo">("all");

  useEffect(() => {
    const stored = readDashboardFilters();
    setTeamId(stored.teamId);
    setMemberId(stored.memberId);
    setFiltersReady(true);
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    writeDashboardFilters({ teamId, memberId });
  }, [teamId, memberId, filtersReady]);

  const today = isoDateInZone();
  const overview = useQuery<DashboardOverviewData>(
    withQuery("/dashboard/overview", { startDate, endDate }),
  );
  const todayOverview = useQuery<DashboardOverviewData>(
    startDate === today && endDate === today
      ? null
      : withQuery("/dashboard/overview", { startDate: today, endDate: today }),
  );
  // Defer heavy rescope so preset buttons stay responsive while large ranges commit.
  const overviewData = useDeferredValue(overview.data);

  useEffect(() => {
    if (!overview.data) return;
    const id = window.setTimeout(() => prefetchQueries(presetQueryUrls(), 2), 200);
    return () => window.clearTimeout(id);
  }, [overview.data]);

  const view = useMemo(
    () => (overviewData ? scopeDashboard(overviewData, teamId, memberId, punchSource) : null),
    [overviewData, teamId, memberId, punchSource],
  );
  const visibleRoster = useMemo(
    () => (overviewData ? selectVisibleRoster(overviewData, teamId, memberId) : { bio: [], tivazo: [] }),
    [overviewData, teamId, memberId],
  );
  const todayRoster = useMemo(
    () =>
      todayOverview.data
        ? selectVisibleRoster(todayOverview.data, teamId, memberId)
        : startDate === today && endDate === today
          ? visibleRoster
          : { bio: [], tivazo: [] },
    [todayOverview.data, teamId, memberId, startDate, endDate, today, visibleRoster],
  );

  // Member dropdown catalog: everyone in the current group scope (or all groups).
  // Intentionally ignores memberId so selecting a member does not shrink searchable options.
  const memberOptions = useMemo(() => {
    if (!overviewData) return EMPTY_FILTERS;
    return scopeDashboard(overviewData, teamId, "").filters.members;
  }, [overviewData, teamId]);
  const memberIdsKey = memberOptions.map((member) => member.id).join("\n");
  // Only clear after options have loaded — avoid wiping a restored selection during fetch.
  if (
    filtersReady &&
    memberId &&
    memberIdsKey &&
    !memberOptions.some((member) => member.id === memberId)
  ) {
    setMemberId("");
  }

  const teamLabel = useMemo(() => {
    if (memberId) {
      return memberOptions.find((member) => member.id === memberId)?.label ?? "Selected member";
    }
    if (!teamId) return "All groups";
    return view?.filters.teams.find((team) => team.id === teamId)?.label ?? "Selected team";
  }, [memberId, memberOptions, view?.filters.teams, teamId]);

  const dateRangeLabel = useMemo(
    () => `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)}`,
    [startDate, endDate],
  );
  const coverage = view?.coverage ?? null;
  const coverageGaps = (coverage?.bioOnly.length ?? 0) + (coverage?.tivazoOnly.length ?? 0);
  const coverageLabel = !coverage
    ? overview.loading || overview.refreshing
      ? "Checking…"
      : "Check sources"
    : coverageGaps
      ? `${coverageGaps} not on both`
      : "All on both";
  const rangeUpdating = overview.refreshing || (overview.loading && Boolean(overview.data));

  return (
    <div
      className="smp-stage smp-stage--pad smp-dashboard"
      data-updating={rangeUpdating ? "true" : undefined}
      aria-busy={overview.loading && !overview.data ? "true" : undefined}
    >
      {overview.error && !overview.data ? (
        <QueryState
          loading={false}
          error={overview.error}
          onRetry={overview.reload}
          label="dashboard"
        />
      ) : (
        <MotionSection delay={0}>
          <DashboardStatCards
            summary={view?.summary ?? null}
            scope={{
              teamId,
              memberId,
              startDate,
              endDate,
            }}
          />
        </MotionSection>
      )}

      <MotionSection as="section" className="smp-dashboard-filters" aria-label="Dashboard filters" delay={0.03}>
        <div className="smp-dashboard-filters__inner">
          <DashboardDateRangePicker
            start={startDate}
            end={endDate}
            onChange={(start, end) => {
              startTransition(() => setRange(start, end));
            }}
          />
          {rangeUpdating ? (
            <span className="smp-dashboard-filters__updating" aria-live="polite">
              Updating…
            </span>
          ) : null}
          <FilterSelect
            label="Group"
            value={teamId}
            options={overviewData?.filters.teams ?? []}
            allLabel="All groups"
            searchable
            hideLabel
            onChange={(next) => {
              setTeamId(next);
              setMemberId("");
            }}
          />
          <FilterSelect
            label="Member"
            value={memberId}
            options={memberOptions}
            allLabel="All members"
            searchable
            hideLabel
            onChange={setMemberId}
          />
          <div className="smp-dashboard-coverage">
            <button
              type="button"
              className="smp-filter-select__trigger"
              data-gaps={coverageGaps > 0 ? "true" : "false"}
              aria-haspopup="dialog"
              aria-expanded={coverageOpen}
              aria-label={`Coverage: ${coverageLabel}`}
              onClick={() => setCoverageOpen(true)}
            >
              <span className="smp-filter-select__value">{coverageLabel}</span>
              {coverageGaps > 0 ? (
                <span className="smp-dashboard-coverage__badge">{coverageGaps}</span>
              ) : (
                <GitCompareArrows size={14} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      </MotionSection>

      <DashboardCoverageModal
        open={coverageOpen}
        coverage={coverage}
        loading={!coverage && overview.loading}
        startDate={startDate}
        endDate={endDate}
        onClose={() => setCoverageOpen(false)}
      />

      {/* Selected member sits directly under the filter bar. */}
      {view?.member ? (
        <MotionSection delay={0.05}>
          <DashboardMemberProfile member={view.member} />
        </MotionSection>
      ) : null}

      {memberId ? (
        <Suspense fallback={panelFallback}>
          <DashboardMemberPeriodStats
            memberId={memberId}
            memberLabel={teamLabel}
            startDate={startDate}
            endDate={endDate}
            source={punchSource}
          />
        </Suspense>
      ) : null}

      {/* Single-member view: Bio/Tivazo Present/Leave/Total cards are always 0/1 — hide them. */}
      {!memberId ? (
        <Suspense fallback={panelFallback}>
        <MotionSection delay={0.06}>
        <DashboardSourceSnapshots
          biomatic={view?.biomatic ?? null}
          tivazo={view?.tivazo ?? null}
          biomaticLoading={overview.loading && !overview.data}
          tivazoLoading={overview.loading && !overview.data}
          dateRangeLabel={dateRangeLabel}
          startDate={startDate}
          endDate={endDate}
          teamId={teamId}
          memberId={memberId}
          bioPeople={visibleRoster.bio}
          tivazoPeople={visibleRoster.tivazo}
          bioTeams={overviewData?.filters.teams ?? []}
          tivazoGroups={overviewData?.filters.supervisors ?? []}
        />
        </MotionSection>
        </Suspense>
      ) : null}

      <div className="smp-dashboard-stack">
        <Suspense fallback={panelFallback}>
        <MotionSection delay={0.08}>
        <DashboardHourlyPanel
          bio={visibleRoster.bio}
          tivazo={visibleRoster.tivazo}
          liveBio={todayRoster.bio}
          liveTivazo={todayRoster.tivazo}
          loading={overview.loading && !overview.data}
          error={overview.data ? null : overview.error}
          onRetry={overview.reload}
          teamLabel={teamLabel}
          teamId={teamId}
          memberId={memberId}
          teams={overviewData?.filters.teams ?? []}
          supervisors={overviewData?.filters.supervisors ?? []}
          startDate={startDate}
          endDate={endDate}
          source={punchSource}
          onSourceChange={setPunchSource}
        />
        </MotionSection>
        </Suspense>
        {!memberId ? (
          <Suspense fallback={panelFallback}>
          <MotionSection delay={0.1}>
          <DashboardLeaderboardPanel
            board={view?.leaderboards?.present ?? view?.leaderboard ?? null}
            loading={overview.loading && !overview.data}
            metric="present"
            teamLabel={teamLabel}
            dateRangeLabel={dateRangeLabel}
            startDate={startDate}
            endDate={endDate}
          />
          </MotionSection>
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
