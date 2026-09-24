"use client";

import { DashboardClockIns } from "@/components/data/DashboardClockIns";
import { DashboardPeriodDays } from "@/components/data/DashboardPeriodDays";
import { PunchSourceSwitch } from "@/components/data/PunchSourceSwitch";
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
import { buildPunchCompareBundle, scopeRosterPeople } from "@/lib/dashboard-scope";
import { addDaysISO, formatDisplayDate, formatRangeLabel, isoDateInZone } from "@/lib/datetime";
import { createIdentityIndex, identityCanonical } from "@/lib/identity";
import { isPresentAttendance, normalizeDayStatus } from "@/lib/server/metrics";
import {
  averageWorkdayTimes,
  dailyLogToRoster,
  mergeWorkdayPeople,
  parseClockMinutes,
  presentPeople,
} from "@/lib/workday-clock";
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
      const livePresent = isPresentAttendance(now.attendance);
      return {
        ...rec,
        status: livePresent ? now.status || rec.status : rec.status,
        attendance: preferAttendanceStatus(now.attendance, rec.attendance),
        // Only blend live punches when live is Present — never paint Absent/Leave
        // with another day's clocked_in / tracked.
        startTime: livePresent ? pickEarlierLabel(now.startTime, rec.startTime) : rec.startTime,
        endTime: livePresent ? pickLaterLabel(now.endTime, rec.endTime) : rec.endTime,
        clockedIn: livePresent ? pickEarlierLabel(now.clockedIn, rec.clockedIn) : rec.clockedIn,
        lastScreenshot: livePresent
          ? pickLaterLabel(now.lastScreenshot, rec.lastScreenshot)
          : rec.lastScreenshot,
        trackedSeconds: livePresent
          ? Math.max(now.trackedSeconds || 0, rec.trackedSeconds || 0)
          : rec.trackedSeconds,
        trackedLabel: livePresent ? now.trackedLabel || rec.trackedLabel : rec.trackedLabel,
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
  source = "all",
  onSourceChange,
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
  source?: "all" | "bio" | "tivazo";
  onSourceChange?: (source: "all" | "bio" | "tivazo") => void;
}) {
  const today = isoDateInZone();
  const dashboardRange = startDate !== endDate;
  const rangeKey = `${startDate}:${endDate}`;
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [seenRange, setSeenRange] = useState(rangeKey);

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
  // Attendance-by-day table stays scoped-only (heavy UI).
  // Full-org week/month/3-month must NOT pull all daily-logs + activities — that
  // freezes the UI for many seconds. Overview roster already has period aggregates.
  const needPeriodDays = dashboardRange && hasScope;
  const needPeriodRoster = viewingRange && hasScope;

  const logs = useQuery<ListPage<DailyLogRow>>(
    dayFocus
      ? withQuery("/daily-logs", {
          startDate: viewStart,
          endDate: viewStart,
          all: 1,
          teamId: memberId ? undefined : teamId || undefined,
          q: memberId || undefined,
        })
      : needPeriodRoster
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
      ? withQuery("/tivazo/activities", {
          startDate: viewStart,
          endDate: viewStart,
          all: 1,
          teamId: memberId ? undefined : teamId || undefined,
          group: memberId ? undefined : teamId || undefined,
          q: memberId || undefined,
        })
      : needPeriodRoster
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
    // Prefetch only the selected person (or skip full-org adjacent days). Full
    // `/tivazo/activities?all=1` for neighboring days was taking 10–20s each and
    // flooding the network while flipping calendar days.
    const prev = addDaysISO(viewStart, -1);
    const next = addDaysISO(viewStart, 1);
    const maxDay = dashboardRange ? (endDate < today ? endDate : today) : today;
    const minDay = dashboardRange ? startDate : undefined;
    const scope = {
      all: 1 as const,
      teamId: memberId ? undefined : teamId || undefined,
      group: memberId ? undefined : teamId || undefined,
      q: memberId || undefined,
    };
    const urls: string[] = [];
    if (!minDay || prev >= minDay) {
      urls.push(withQuery("/daily-logs", { startDate: prev, endDate: prev, ...scope }));
      if (memberId || teamId) {
        urls.push(withQuery("/tivazo/activities", { startDate: prev, endDate: prev, ...scope }));
      }
    }
    if (next <= maxDay) {
      urls.push(withQuery("/daily-logs", { startDate: next, endDate: next, ...scope }));
      if (memberId || teamId) {
        urls.push(withQuery("/tivazo/activities", { startDate: next, endDate: next, ...scope }));
      }
    }
    prefetchQueries(urls, 2);
  }, [dayFocus, viewStart, dashboardRange, startDate, endDate, today, memberId, teamId]);

  const roster = useMemo(() => {
    const liveBioRows = stampDate(liveBio?.length ? liveBio : bio, viewStart);
    const liveTivazoRows = stampDate(liveTivazo?.length ? liveTivazo : tivazo, viewStart);
    if (viewingRange) {
      const logItems = logs.data?.items ?? [];
      const activityItems = activities.data?.items ?? [];
      if (needPeriodRoster && (logItems.length > 0 || activityItems.length > 0)) {
        const bioRows = logItems.map((row) => dailyLogToRoster(row, "bio"));
        const tivazoRows = activityItems.map((row) => dailyLogToRoster(row, "tivazo"));
        const scoped = scopeRosterPeople(bioRows, tivazoRows, teamId, memberId, teams, supervisors);
        return {
          bio: overlayRangeToday(scoped.bio, liveBioRows, today),
          tivazo: overlayRangeToday(scoped.tivazo, liveTivazoRows, today),
        };
      }
      // Keep overview roster visible while scoped period logs load — never blank the panel.
      const scoped = scopeRosterPeople(bio, tivazo, teamId, memberId, teams, supervisors);
      return { bio: scoped.bio, tivazo: scoped.tivazo };
    }
    const logItems = logs.data?.items ?? [];
    const activityItems = activities.data?.items ?? [];
    const logsPending = (logs.loading && !logs.data) || (activities.loading && !activities.data);
    const bioRows = logItems.filter((row) => onDay(row, viewStart)).map((row) => dailyLogToRoster(row, "bio"));
    const tivazoRows = activityItems
      .filter((row) => onDay(row, viewStart))
      .map((row) => dailyLogToRoster(row, "tivazo"));
    const hasDayRows = bioRows.length > 0 || tivazoRows.length > 0;
    const todayView = viewStart === today;
    // Soft-kept previous-day payloads must not blank this day — fall back to overview.
    if (!hasDayRows) {
      if (logsPending) {
        return { bio: liveBioRows, tivazo: liveTivazoRows };
      }
      const scopedOverview = scopeRosterPeople(bio, tivazo, teamId, memberId, teams, supervisors);
      return {
        bio: todayView ? overlayLivePunches(scopedOverview.bio, liveBioRows) : scopedOverview.bio,
        tivazo: todayView ? overlayLivePunches(scopedOverview.tivazo, liveTivazoRows) : scopedOverview.tivazo,
      };
    }
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
    needPeriodRoster,
    logs.loading,
    activities.loading,
  ]);

  const sourceBio = source === "tivazo" ? [] : roster.bio;
  const sourceTivazo = source === "bio" ? [] : roster.tivazo;
  const punchBundle = useMemo(() => {
    // Punch compare is Bio↔Tivazo by design — only meaningful for Combined.
    const options = {
      todayDate: today,
      undatedIsToday: !viewingRange && viewStart === today,
      period,
    } as const;
    return source === "all"
      ? buildPunchCompareBundle(roster.bio, roster.tivazo, options)
      : buildPunchCompareBundle(sourceBio, sourceTivazo, options);
  }, [roster.bio, roster.tivazo, sourceBio, sourceTivazo, source, today, viewingRange, viewStart, period]);
  const compare = punchBundle.compare;
  const kpis = useMemo(() => {
    const merged = mergeWorkdayPeople(sourceBio, sourceTivazo, today);
    // Median Clock in / out among Present for the selected Source only.
    return averageWorkdayTimes(presentPeople(merged, source));
  }, [sourceBio, sourceTivazo, source, today]);

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
        <div className="smp-dashboard-hourly-copy">
          <h2 className="smp-panel__title">Daily clock-ins</h2>
        </div>
        <div className="smp-dashboard-hourly-tools">
          {onSourceChange ? (
            <PunchSourceSwitch
              value={source}
              onChange={onSourceChange}
              className="smp-dashboard-hourly-source"
              id="daily-clockins-source"
            />
          ) : null}
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
              source={source}
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
            onSourceChange={onSourceChange}
          />
          {source === "all" ? (
            <DashboardPunchCompare
              compare={compare}
              focus={punchBundle.focus}
              bio={roster.bio}
              tivazo={roster.tivazo}
              periodLabel={viewingRange ? `Average · ${periodLabel}` : periodLabel}
              dateLabel={periodLabel}
              countNoun="people"
              startDate={viewStart}
              endDate={viewEnd}
              teamId={teamId}
              memberId={memberId}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
