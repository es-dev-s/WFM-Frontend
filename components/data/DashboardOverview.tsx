"use client";

import { DashboardCoverageModal } from "@/components/data/DashboardCoverageModal";
import {
  DashboardDateRangePicker,
  useDashboardDateRange,
} from "@/components/data/DashboardDateRangePicker";
import { DashboardHourlyPanel } from "@/components/data/DashboardHourlyPanel";
import { DashboardLeaderboardPanel } from "@/components/data/DashboardLeaderboardPanel";
import { DashboardMemberProfile } from "@/components/data/DashboardMemberProfile";
import { DashboardSourceSnapshots } from "@/components/data/DashboardSourceSnapshots";
import { DashboardMemberPeriodStats } from "@/components/data/DashboardMemberPeriodStats";
import { DashboardStatCards } from "@/components/data/DashboardStatCards";
import { QueryState } from "@/components/data/QueryState";
import { FilterSelect } from "@/components/ui/FilterSelect";
import { formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { scopeDashboard, selectVisibleRoster } from "@/lib/dashboard-scope";
import {
  type DashboardOverview as DashboardOverviewData,
  prefetchQueries,
  useQuery,
  withQuery,
} from "@/lib/api";
import { presetQueryUrls } from "@/lib/dashboard-prefetch";
import { GitCompareArrows } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EMPTY_FILTERS: DashboardOverviewData["filters"]["members"] = [];

export function DashboardOverview() {
  const { start: startDate, end: endDate, setRange } = useDashboardDateRange();
  const [teamId, setTeamId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [coverageOpen, setCoverageOpen] = useState(false);

  const today = isoDateInZone();
  const overview = useQuery<DashboardOverviewData>(
    withQuery("/dashboard/overview", { startDate, endDate }),
  );
  const todayOverview = useQuery<DashboardOverviewData>(
    startDate === today && endDate === today
      ? null
      : withQuery("/dashboard/overview", { startDate: today, endDate: today }),
  );

  useEffect(() => {
    if (!overview.data) return;
    const id = window.setTimeout(() => prefetchQueries(presetQueryUrls(), 2), 200);
    return () => window.clearTimeout(id);
  }, [overview.data]);

  const view = useMemo(
    () => (overview.data ? scopeDashboard(overview.data, teamId, memberId) : null),
    [overview.data, teamId, memberId],
  );
  const visibleRoster = useMemo(
    () => (overview.data ? selectVisibleRoster(overview.data, teamId, memberId) : { bio: [], tivazo: [] }),
    [overview.data, teamId, memberId],
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

  const memberOptions = view?.filters.members ?? EMPTY_FILTERS;
  const memberIdsKey = memberOptions.map((member) => member.id).join("\n");
  if (memberId && memberIdsKey && !memberOptions.some((member) => member.id === memberId)) {
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
    ? overview.loading
      ? "Checking…"
      : "Check sources"
    : coverageGaps
      ? `${coverageGaps} not on both`
      : "All on both";

  return (
    <div
      className="smp-stage smp-stage--pad smp-dashboard"
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
        <DashboardStatCards
          summary={view?.summary ?? null}
          scope={{
            teamId,
            memberId,
            startDate,
            endDate,
          }}
        />
      )}

      <div className="smp-dashboard-toolbar">
        <DashboardDateRangePicker start={startDate} end={endDate} onChange={setRange} />
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
        startDate={startDate}
        endDate={endDate}
        onClose={() => setCoverageOpen(false)}
      />

      {view?.member ? <DashboardMemberProfile member={view.member} /> : null}

      {memberId ? (
        <DashboardMemberPeriodStats
          memberId={memberId}
          memberLabel={teamLabel}
          startDate={startDate}
          endDate={endDate}
        />
      ) : null}

      {/* Single-member view: Bio/Tivazo Present/Leave/Total cards are always 0/1 — hide them. */}
      {!memberId ? (
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
          bioTeams={overview.data?.filters.teams ?? []}
          tivazoGroups={overview.data?.filters.supervisors ?? []}
        />
      ) : null}

      {/* Daily clock-ins first; Member ranking below (hidden for single-member focus). */}
      <div className="smp-dashboard-stack">
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
          teams={overview.data?.filters.teams ?? []}
          supervisors={overview.data?.filters.supervisors ?? []}
          startDate={startDate}
          endDate={endDate}
        />
        {!memberId ? (
          <DashboardLeaderboardPanel
            board={view?.leaderboards?.present ?? view?.leaderboard ?? null}
            loading={overview.loading && !overview.data}
            metric="present"
            teamLabel={teamLabel}
            dateRangeLabel={dateRangeLabel}
            startDate={startDate}
            endDate={endDate}
          />
        ) : null}
      </div>
    </div>
  );
}
