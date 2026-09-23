"use client";

import { DashboardClockIns } from "@/components/data/DashboardClockIns";
import { DashboardPeriodDays } from "@/components/data/DashboardPeriodDays";
import { DashboardPunchCompare } from "@/components/data/DashboardPunchCompare";
import { QueryState } from "@/components/data/QueryState";
import {
  type DailyLogRow,
  type DashboardRosterPerson,
  type FilterOption,
  type ListPage,
  prefetchQueries,
  useQuery,
  withQuery,
} from "@/lib/api";
import { buildPunchCompare, scopeRosterPeople } from "@/lib/dashboard-scope";
import { addDaysISO, formatDisplayDate, formatRangeLabel, isoDateInZone } from "@/lib/datetime";
import { createIdentityIndex, identityCanonical } from "@/lib/identity";
import { normalizeDayStatus } from "@/lib/server/metrics";
import { averageWorkdayTimes, dailyLogToRoster, mergeWorkdayPeople, parseClockMinutes } from "@/lib/workday-clock";
import { useEffect, useMemo, useState } from "react";

function stampDate(rows: DashboardRosterPerson[], date: string): DashboardRosterPerson[] {
  return rows.map((row) => (row.date ? row : { ...row, date }));
}

function onDay(row: DailyLogRow, day: string): boolean {
  return row.date === day || row.rawDate === day;
}

function rosterKey(row: DashboardRosterPerson): string {
  return row.email.trim().toLowerCase() || row.id;
}

function overlayRangeToday(
  history: DashboardRosterPerson[],
  live: DashboardRosterPerson[],
  today: string,
): DashboardRosterPerson[] {
  const past = history.filter((row) => row.date !== today);
  const todayHist = history.filter((row) => row.date === today);
  return [...past, ...overlayLivePunches(todayHist, stampDate(live, today))];
}



function pickEarlierLabel(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b) return a;
  const am = parseClockMinutes(a);
  const bm = parseClockMinutes(b);
  if (am == null) return b;
  if (bm == null) return a;
  return am <= bm ? a : b;
}

function pickLaterLabel(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b) return a;
  const am = parseClockMinutes(a);
  const bm = parseClockMinutes(b);
  if (am == null) return b;
  if (bm == null) return a;
  return am >= bm ? a : b;
}

function preferAttendanceStatus(live: string, hist: string): string {
  const left = normalizeDayStatus(live);
  const right = normalizeDayStatus(hist);
  if (left === "Present" || right === "Present") return "Present";
  return live || hist;
}

function overlayLivePunches(
  history: DashboardRosterPerson[],
  live: DashboardRosterPerson[],
): DashboardRosterPerson[] {
  if (!live.length) return history;
  const index = createIdentityIndex([...history, ...live]);
  const keyOf = (row: DashboardRosterPerson) => identityCanonical(index, row) || rosterKey(row);
  const histMap = new Map(history.map((row) => [keyOf(row), row]));
  const liveMap = new Map(live.map((row) => [keyOf(row), row]));
  const keys = new Set([...histMap.keys(), ...liveMap.keys()].filter(Boolean));
  return [...keys].map((key) => {
    const rec = histMap.get(key);
    const now = liveMap.get(key);
    if (rec && now) {
      return {
        ...rec,
        status: now.status || rec.status,
        attendance: preferAttendanceStatus(now.attendance, rec.attendance),
        // Earliest in / latest out across live + history so overlays cannot erase a real punch.
        startTime: pickEarlierLabel(now.startTime, rec.startTime),
        endTime: pickLaterLabel(now.endTime, rec.endTime),
        clockedIn: pickEarlierLabel(now.clockedIn, rec.clockedIn),
        lastScreenshot: pickLaterLabel(now.lastScreenshot, rec.lastScreenshot),
        trackedSeconds: Math.max(now.trackedSeconds || 0, rec.trackedSeconds || 0),
        trackedLabel: now.trackedLabel || rec.trackedLabel,
      };
    }
    return rec ?? now!;
  });
}

export function DashboardHourlyPanel({
  bio,
  tivazo,
  liveBio,
  liveTivazo,
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
  bio: DashboardRosterPerson[];
  tivazo: DashboardRosterPerson[];
  liveBio?: DashboardRosterPerson[];
  liveTivazo?: DashboardRosterPerson[];
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
  const dashboardRange = startDate !== endDate;
  const rangeKey = `${startDate}:${endDate}`;
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [seenRange, setSeenRange] = useState(rangeKey);
  const [source, setSource] = useState<"all" | "bio" | "tivazo">("all");

  if (seenRange !== rangeKey) {
    setSeenRange(rangeKey);
    setPickedDay(null);
  }

  const focus = pickedDay ?? (dashboardRange ? "range" : endDate);
  const setFocus = (next: string) => {
    setPickedDay(next);
  };

  const viewingRange = focus === "range" && dashboardRange;
  const viewStart = viewingRange ? startDate : focus === "range" ? startDate : focus;
  const viewEnd = viewingRange ? endDate : focus === "range" ? endDate : focus;
  const period = viewingRange ? "range" : "day";
  const periodLabel = viewingRange
    ? formatRangeLabel(viewStart, viewEnd)
    : formatDisplayDate(viewStart);
  const dayFocus = !viewingRange;
  const hasScope = Boolean(teamId || memberId);
  const needPeriodDays = dashboardRange && hasScope;

  const logs = useQuery<ListPage<DailyLogRow>>(
    dayFocus
      ? withQuery("/daily-logs", { startDate: viewStart, endDate: viewStart, all: 1 })
      : needPeriodDays
        ? withQuery("/daily-logs", {
            startDate,
            endDate,
            all: 1,
            teamId: memberId ? undefined : teamId || undefined,
            q: memberId || undefined,
          })
        : null,
  );
  const activities = useQuery<ListPage<DailyLogRow>>(
    dayFocus
      ? withQuery("/tivazo/activities", { startDate: viewStart, endDate: viewStart, all: 1 })
      : needPeriodDays
        ? withQuery("/tivazo/activities", {
            startDate,
            endDate,
            all: 1,
            teamId: memberId ? undefined : teamId || undefined,
            group: memberId ? undefined : teamId || undefined,
            q: memberId || undefined,
          })
        : null,
  );

  useEffect(() => {
    if (!dayFocus) return;
    const prev = addDaysISO(viewStart, -1);
    const next = addDaysISO(viewStart, 1);
    const maxDay = dashboardRange ? (endDate < today ? endDate : today) : today;
    const minDay = dashboardRange ? startDate : undefined;
    const urls: string[] = [];
    if (!minDay || prev >= minDay) {
      urls.push(withQuery("/daily-logs", { startDate: prev, endDate: prev, all: 1 }));
      urls.push(withQuery("/tivazo/activities", { startDate: prev, endDate: prev, all: 1 }));
    }
    if (next <= maxDay) {
      urls.push(withQuery("/daily-logs", { startDate: next, endDate: next, all: 1 }));
      urls.push(withQuery("/tivazo/activities", { startDate: next, endDate: next, all: 1 }));
    }
    prefetchQueries(urls, 2);
  }, [dayFocus, viewStart, dashboardRange, startDate, endDate, today]);

  const roster = useMemo(() => {
    const liveBioRows = stampDate(liveBio?.length ? liveBio : bio, viewStart);
    const liveTivazoRows = stampDate(liveTivazo?.length ? liveTivazo : tivazo, viewStart);
    if (viewingRange) {
      const logItems = logs.data?.items ?? [];
      const activityItems = activities.data?.items ?? [];
      if (needPeriodDays && (logItems.length > 0 || activityItems.length > 0)) {
        const bioRows = logItems.map((row) => dailyLogToRoster(row, "bio"));
        const tivazoRows = activityItems.map((row) => dailyLogToRoster(row, "tivazo"));
        const scoped = scopeRosterPeople(bioRows, tivazoRows, teamId, memberId, teams, supervisors);
        return {
          bio: overlayRangeToday(scoped.bio, liveBioRows, today),
          tivazo: overlayRangeToday(scoped.tivazo, liveTivazoRows, today),
        };
      }
      const scoped = scopeRosterPeople(bio, tivazo, teamId, memberId, teams, supervisors);
      return { bio: scoped.bio, tivazo: scoped.tivazo };
    }
    const logItems = logs.data?.items ?? [];
    const activityItems = activities.data?.items ?? [];
    const hasHistory = logItems.length > 0 || activityItems.length > 0;
    const todayView = viewStart === today;
    if (!hasHistory) {
      return { bio: liveBioRows, tivazo: liveTivazoRows };
    }
    const bioRows = logItems.filter((row) => onDay(row, viewStart)).map((row) => dailyLogToRoster(row, "bio"));
    const tivazoRows = activityItems
      .filter((row) => onDay(row, viewStart))
      .map((row) => dailyLogToRoster(row, "tivazo"));
    const scoped = scopeRosterPeople(bioRows, tivazoRows, teamId, memberId, teams, supervisors);
    return {
      bio: todayView ? overlayLivePunches(scoped.bio, liveBioRows) : scoped.bio,
      tivazo: todayView ? overlayLivePunches(scoped.tivazo, liveTivazoRows) : scoped.tivazo,
    };
  }, [
    bio,
    tivazo,
    liveBio,
    liveTivazo,
    logs.data?.items,
    activities.data?.items,
    viewingRange,
    viewStart,
    today,
    teamId,
    memberId,
    teams,
    supervisors,
    needPeriodDays,
  ]);

  const compare = useMemo(
    () =>
      buildPunchCompare(roster.bio, roster.tivazo, {
        todayDate: today,
        undatedIsToday: !viewingRange && viewStart === today,
        period,
      }),
    [roster.bio, roster.tivazo, today, viewingRange, viewStart, period],
  );
  const kpis = useMemo(
    () =>
      averageWorkdayTimes(
        mergeWorkdayPeople(
          source === "tivazo" ? [] : roster.bio,
          source === "bio" ? [] : roster.tivazo,
          today,
        ),
      ),
    [roster.bio, roster.tivazo, source, today],
  );

  const dayLoading =
    dayFocus &&
    ((logs.loading && !logs.data) || (activities.loading && !activities.data)) &&
    !bio.length &&
    !tivazo.length;
  const dayError = logs.error || activities.error || error;
  const overallIn = kpis.inTime;
  const overallOut = kpis.outTime;

  return (
    <section
      className="smp-panel smp-dashboard-panel smp-dashboard-panel--hourly"
      aria-label="Daily clock-ins"
    >
      <header className="smp-panel__head smp-dashboard-hourly-head">
        <h2 className="smp-panel__title">Daily clock-ins</h2>
        <div className="smp-clockins-kpis" aria-label="Average clock times">
          <p className="smp-clockins-kpi" data-empty={overallIn === "—" ? "true" : undefined}>
            <span>Clock in</span>
            <strong>{overallIn}</strong>
          </p>
          <p className="smp-clockins-kpi" data-empty={overallOut === "—" ? "true" : undefined}>
            <span>Clock out</span>
            <strong>{overallOut}</strong>
          </p>
        </div>
      </header>

      {loading && bio.length === 0 && tivazo.length === 0 && !logs.data && !activities.data ? (
        <QueryState loading error={null} label="daily clock-ins" />
      ) : dayError && roster.bio.length === 0 && roster.tivazo.length === 0 ? (
        <QueryState
          loading={false}
          error={dayError}
          onRetry={() => {
            onRetry?.();
            logs.reload();
            activities.reload();
          }}
          label="daily clock-ins"
        />
      ) : dayLoading ? (
        <QueryState loading error={null} label="daily clock-ins" />
      ) : (
        <>
          {viewingRange && needPeriodDays ? (
            <DashboardPeriodDays
              bioLogs={logs.data?.items ?? []}
              tivazoLogs={activities.data?.items ?? []}
              rosterBio={bio}
              rosterTivazo={tivazo}
              liveBio={liveBio ?? []}
              liveTivazo={liveTivazo ?? []}
              loading={(logs.loading && !logs.data) || (activities.loading && !activities.data)}
              error={logs.error || activities.error}
              onRetry={() => {
                logs.reload();
                activities.reload();
              }}
              teamId={teamId}
              memberId={memberId}
              teams={teams}
              supervisors={supervisors}
              startDate={startDate}
              endDate={endDate}
              today={today}
              teamLabel={teamLabel}
              onPickDay={setFocus}
            />
          ) : null}
          <DashboardClockIns
            bio={roster.bio}
            tivazo={roster.tivazo}
            today={today}
            teamLabel={teamLabel}
            dateLabel={periodLabel}
            memberId={memberId}
            teamId={teamId}
            day={viewEnd}
            period={period}
            startDate={viewStart}
            endDate={viewEnd}
            source={source}
            onSourceChange={setSource}
          />
          <DashboardPunchCompare
            compare={compare}
            periodLabel={viewingRange ? `Average · ${periodLabel}` : periodLabel}
            countNoun={viewingRange ? "punches" : "people"}
            startDate={viewStart}
            endDate={viewEnd}
            teamId={teamId}
            memberId={memberId}
          />
        </>
      )}
    </section>
  );
}
