"use client";

import { DashboardCoverageModal } from "@/components/data/DashboardCoverageModal";
import {
  DashboardDateRangePicker,
  defaultDashboardRange,
} from "@/components/data/DashboardDateRangePicker";
import { DashboardHourlyPanel } from "@/components/data/DashboardHourlyPanel";
import { DashboardLeaderboardPanel } from "@/components/data/DashboardLeaderboardPanel";
import { DashboardMemberProfile } from "@/components/data/DashboardMemberProfile";
import { DashboardSourceSnapshots } from "@/components/data/DashboardSourceSnapshots";
import { DashboardStatCards } from "@/components/data/DashboardStatCards";
import { DashboardTrendPanel } from "@/components/data/DashboardTrendPanel";
import { QueryState } from "@/components/data/QueryState";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { addDaysISO, formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { scopeDashboard, selectVisibleRoster } from "@/lib/dashboard-scope";
import {
  type DashboardOverview as DashboardOverviewData,
  type TrendMetric,
  type TrendPoint,
  useQuery,
  withQuery,
} from "@/lib/api";
import { GitCompareArrows } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EMPTY_FILTERS: DashboardOverviewData["filters"]["members"] = [];

export function DashboardOverview() {
  const defaultRange = useMemo(() => defaultDashboardRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("present");
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [coverageOpen, setCoverageOpen] = useState(false);

  const overview = useQuery<DashboardOverviewData>(
    withQuery("/dashboard/overview", { startDate, endDate }),
  );
  const scopedTrend = useQuery<{ trend: TrendPoint[] }>(
    teamId || memberId
      ? withQuery("/dashboard/trend", {
          teamId: teamId || undefined,
          memberId: memberId || undefined,
        })
      : null,
  );
  const view = useMemo(
    () => (overview.data ? scopeDashboard(overview.data, teamId, memberId) : null),
    [overview.data, teamId, memberId],
  );
  const visibleRoster = useMemo(
    () => (overview.data ? selectVisibleRoster(overview.data, teamId, memberId) : { bio: [], tivazo: [] }),
    [overview.data, teamId, memberId],
  );

  const memberOptions = view?.filters.members ?? EMPTY_FILTERS;
  const memberIdsKey = memberOptions.map((member) => member.id).join("\n");

  useEffect(() => {
    if (!memberId || !memberIdsKey) return;
    if (memberOptions.some((member) => member.id === memberId)) return;
    setMemberId("");
  }, [memberId, memberIdsKey, memberOptions]);

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
    ? overview.loading
      ? "Checking…"
      : "Check sources"
    : coverageGaps
      ? `${coverageGaps} not on both`
      : "All on both";

  const trendSource =
    teamId || memberId
      ? scopedTrend.refreshing || scopedTrend.loading
        ? []
        : scopedTrend.data?.trend ?? []
      : view?.trend ?? [];
  const trendPoints = useMemo(() => {
    const points = trendSource;
    const headcount = view?.summary.totalMembers || 1;
    return points.map((point) => {
      const clockIns = point.clockIns ?? point.value;
      const tracked = point.trackedSeconds ?? 0;
      if (trendMetric === "attendance") {
        return {
          day: point.day,
          value: headcount ? Math.round((clockIns / headcount) * 1000) / 10 : 0,
        };
      }
      if (trendMetric === "utilization") {
        const capacity = 8 * 60 * 60;
        return {
          day: point.day,
          value: capacity ? Math.round((tracked / headcount / capacity) * 1000) / 10 : 0,
        };
      }
      return { day: point.day, value: clockIns };
    });
  }, [trendSource, view?.summary.totalMembers, trendMetric]);
  const trendRangeLabel = useMemo(() => {
    const today = isoDateInZone();
    return `${formatDisplayDate(addDaysISO(today, -29))} – ${formatDisplayDate(today)}`;
  }, []);

  const scopeEmails = useMemo(() => {
    const emails = new Set<string>();
    for (const row of [...visibleRoster.bio, ...visibleRoster.tivazo]) {
      const email = row.email.trim().toLowerCase();
      if (email) emails.add(email);
    }
    return [...emails];
  }, [visibleRoster]);

  return (
    <div
      className="smp-stage smp-stage--pad smp-dashboard"
      aria-busy={overview.loading || overview.refreshing ? "true" : undefined}
    >
      {overview.error && !overview.data ? (
        <QueryState
          loading={false}
          error={overview.error}
          onRetry={overview.reload}
          label="dashboard"
        />
      ) : (
        <DashboardStatCards summary={view?.summary ?? null} />
      )}

      <div className="smp-dashboard-toolbar">
        <DashboardDateRangePicker
          start={startDate}
          end={endDate}
          onChange={(start, end) => {
            setStartDate(start);
            setEndDate(end);
          }}
        />
        <FilterSelect
          label="Group"
          value={teamId}
          options={view?.filters.teams ?? []}
          allLabel="All groups"
          searchable
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
          onChange={setMemberId}
        />
        <div className="smp-dashboard-coverage">
          <span className="smp-field__label">Coverage</span>
          <button
            type="button"
            className="smp-filter-select__trigger"
            data-gaps={coverageGaps > 0 ? "true" : "false"}
            aria-haspopup="dialog"
            aria-expanded={coverageOpen}
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

      <DashboardCoverageModal
        open={coverageOpen}
        coverage={coverage}
        loading={!coverage && overview.loading}
        onClose={() => setCoverageOpen(false)}
      />

      {view?.member ? <DashboardMemberProfile member={view.member} /> : null}

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
        emails={scopeEmails}
        bioMemberId={visibleRoster.bio[0]?.id || ""}
        tivazoMemberId={visibleRoster.tivazo[0]?.id || ""}
      />

      <div className="smp-split smp-dashboard-split">
        <DashboardTrendPanel
          metric={trendMetric}
          onMetricChange={setTrendMetric}
          points={view ? trendPoints : null}
          loading={overview.loading && !overview.data}
          teamLabel={teamLabel}
          dateRangeLabel={trendRangeLabel}
        />
        <DashboardLeaderboardPanel
          board={view?.leaderboards?.[trendMetric] ?? view?.leaderboard ?? null}
          loading={overview.loading && !overview.data}
          metric={trendMetric}
          teamLabel={teamLabel}
          dateRangeLabel={dateRangeLabel}
        />
      </div>

      <DashboardHourlyPanel
        compare={view?.hourly?.compare ?? null}
        bio={visibleRoster.bio}
        tivazo={visibleRoster.tivazo}
        loading={overview.loading && !overview.data}
        error={overview.data ? null : overview.error}
        onRetry={overview.reload}
        teamLabel={teamLabel}
        teamId={teamId}
        memberId={memberId}
        teams={overview.data?.filters.teams ?? []}
        supervisors={overview.data?.filters.supervisors ?? []}
        startDate={startDate}
        endDate={endDate}
      />
    </div>
  );
}
