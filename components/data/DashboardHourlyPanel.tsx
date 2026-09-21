"use client";

import { DashboardClockIns } from "@/components/data/DashboardClockIns";
import { DashboardPunchCompare } from "@/components/data/DashboardPunchCompare";
import { QueryState } from "@/components/data/QueryState";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import {
  type DailyLogRow,
  type DashboardRosterPerson,
  type FilterOption,
  type ListPage,
  type PunchCompare,
  useQuery,
  withQuery,
} from "@/lib/api";
import { scopeRosterPeople } from "@/lib/dashboard-scope";
import { addDaysISO, formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { dailyLogToRoster } from "@/lib/workday-clock";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function DashboardHourlyPanel({
  compare,
  bio,
  tivazo,
  loading,
  error,
  onRetry,
  teamLabel,
  teamId,
  memberId,
  teams,
  supervisors,
  startDate,
  endDate,
}: {
  compare: PunchCompare | null;
  bio: DashboardRosterPerson[];
  tivazo: DashboardRosterPerson[];
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  teamLabel: string;
  teamId: string;
  memberId: string;
  teams: FilterOption[];
  supervisors: FilterOption[];
  startDate: string;
  endDate: string;
}) {
  const today = isoDateInZone();
  const [day, setDay] = useState(endDate);

  useEffect(() => {
    setDay(endDate);
  }, [endDate, startDate]);

  const sameDashboardDay = day === startDate && startDate === endDate;
  const logs = useQuery<ListPage<DailyLogRow>>(
    sameDashboardDay ? null : withQuery("/daily-logs", { startDate: day, endDate: day, all: 1 }),
  );
  const activities = useQuery<ListPage<DailyLogRow>>(
    sameDashboardDay
      ? null
      : withQuery("/tivazo/activities", { startDate: day, endDate: day, all: 1 }),
  );

  const roster = useMemo(() => {
    if (sameDashboardDay) return { bio, tivazo };
    return scopeRosterPeople(
      (logs.data?.items ?? []).map((row) => dailyLogToRoster(row, "bio")),
      (activities.data?.items ?? []).map((row) => dailyLogToRoster(row, "tivazo")),
      teamId,
      memberId,
      teams,
      supervisors,
    );
  }, [
    sameDashboardDay,
    bio,
    tivazo,
    logs.data?.items,
    activities.data?.items,
    teamId,
    memberId,
    teams,
    supervisors,
  ]);

  const dayLoading =
    !sameDashboardDay &&
    ((logs.loading && !logs.data) || (activities.loading && !activities.data));
  const dayError = sameDashboardDay ? error : logs.error || activities.error;
  const showCompare = sameDashboardDay;
  const overallIn = compare?.checkIn.overall.time ?? "—";
  const overallOut = compare?.checkOut.overall.time ?? "—";
  const prevDay = addDaysISO(day, -1);
  const nextDay = addDaysISO(day, 1);
  const canNext = nextDay <= today;

  return (
    <section
      className="smp-panel smp-dashboard-panel smp-dashboard-panel--hourly"
      aria-label="Daily clock-ins"
    >
      <header className="smp-panel__head smp-dashboard-hourly-head">
        <div>
          <h2 className="smp-panel__title">Daily clock-ins</h2>
          <p className="smp-panel__meta">
            {formatDisplayDate(day)} · {teamLabel} · Office 7:00 AM – 3:00 PM · Late after 7:15 AM
          </p>
        </div>
        <div className="smp-dashboard-hourly-tools">
          <div className="smp-clockins-day">
            <button
              type="button"
              className="smp-icon-btn"
              aria-label="Previous day"
              onClick={() => setDay(prevDay)}
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </button>
            <DateRangePicker
              variant="dashboard"
              showPresets={false}
              start={day}
              end={day}
              max={today}
              onChange={(next) => setDay(next)}
            />
            <span className="smp-clockins-day__label">{formatDisplayDate(day)}</span>
            <button
              type="button"
              className="smp-icon-btn"
              aria-label="Next day"
              disabled={!canNext}
              onClick={() => canNext && setDay(nextDay)}
            >
              <ChevronRight size={16} strokeWidth={1.75} />
            </button>
          </div>
          {showCompare ? (
            <p className="smp-dashboard-hourly-avg">
              <span>Overall in {overallIn}</span>
              <span>Overall out {overallOut}</span>
            </p>
          ) : null}
        </div>
      </header>

      {loading && bio.length === 0 && tivazo.length === 0 && !compare ? (
        <QueryState loading error={null} label="daily clock-ins" />
      ) : dayError && roster.bio.length === 0 && roster.tivazo.length === 0 ? (
        <QueryState
          loading={false}
          error={dayError}
          onRetry={sameDashboardDay ? onRetry : () => {
            logs.reload();
            activities.reload();
          }}
          label="daily clock-ins"
        />
      ) : dayLoading ? (
        <QueryState loading error={null} label="daily clock-ins" />
      ) : (
        <>
          <DashboardClockIns
            bio={roster.bio}
            tivazo={roster.tivazo}
            today={day === today}
            teamLabel={teamLabel}
            dateLabel={formatDisplayDate(day)}
            memberId={memberId}
            day={day}
          />
          {showCompare ? <DashboardPunchCompare compare={compare} /> : null}
        </>
      )}
    </section>
  );
}
