"use client";

import {
  DashboardDateRangePicker,
  defaultDashboardRange,
} from "@/components/data/DashboardDateRangePicker";
import { DashboardHourlyPanel } from "@/components/data/DashboardHourlyPanel";
import { DashboardLeaderboardPanel } from "@/components/data/DashboardLeaderboardPanel";
import { DashboardSourceSnapshots } from "@/components/data/DashboardSourceSnapshots";
import { DashboardStatCards } from "@/components/data/DashboardStatCards";
import { DashboardTrendPanel } from "@/components/data/DashboardTrendPanel";
import { QueryState } from "@/components/data/QueryState";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { formatDisplayDate } from "@/lib/datetime";
import {
  type DashboardOverview as DashboardOverviewData,
  type TrendMetric,
  useQuery,
  withQuery,
} from "@/lib/api";
import { useMemo, useState } from "react";

export function DashboardOverview() {
  const defaultRange = useMemo(() => defaultDashboardRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("present");
  const [teamId, setTeamId] = useState("");

  const overviewParams = useMemo(
    () => ({
      startDate,
      endDate,
      teamId: teamId || undefined,
      metric: trendMetric,
    }),
    [startDate, endDate, teamId, trendMetric],
  );

  const overview = useQuery<DashboardOverviewData>(
    withQuery("/dashboard/overview", overviewParams),
  );

  const teamLabel = useMemo(() => {
    if (!teamId) return "All teams";
    return (
      overview.data?.filters.teams.find((team) => team.id === teamId)?.label ??
      "Selected team"
    );
  }, [overview.data?.filters.teams, teamId]);

  const dateRangeLabel = useMemo(
    () => `${formatDisplayDate(startDate)} – ${formatDisplayDate(endDate)}`,
    [startDate, endDate],
  );

  const hourlyDateLabel = useMemo(
    () => formatDisplayDate(endDate),
    [endDate],
  );

  return (
    <div className="smp-stage smp-stage--pad smp-dashboard">
      <QueryState
        loading={overview.loading}
        error={overview.error}
        onRetry={overview.reload}
        label="dashboard"
      >
        {overview.data ? (
          <DashboardStatCards summary={overview.data.summary} />
        ) : null}
      </QueryState>

      <DashboardSourceSnapshots
        biomatic={overview.data?.biomatic ?? null}
        tivazo={overview.data?.tivazo ?? null}
        biomaticLoading={overview.loading}
        tivazoLoading={overview.loading}
      />

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
          label="Team"
          value={teamId}
          options={overview.data?.filters.teams ?? []}
          allLabel="All teams"
          onChange={setTeamId}
        />
      </div>

      <div className="smp-split smp-dashboard-split">
        <DashboardTrendPanel
          metric={trendMetric}
          onMetricChange={setTrendMetric}
          points={overview.data?.trend ?? null}
          loading={overview.loading}
          teamLabel={teamLabel}
          dateRangeLabel={dateRangeLabel}
        />
        <DashboardLeaderboardPanel
          board={overview.data?.leaderboard ?? null}
          loading={overview.loading}
          metric={trendMetric}
          teamLabel={teamLabel}
          dateRangeLabel={dateRangeLabel}
        />
      </div>

      <DashboardHourlyPanel
        points={overview.data?.hourly ?? null}
        loading={overview.loading}
        error={overview.error}
        onRetry={overview.reload}
        teamLabel={teamLabel}
        dateLabel={hourlyDateLabel}
      />
    </div>
  );
}
