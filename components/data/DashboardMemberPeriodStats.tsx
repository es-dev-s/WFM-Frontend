"use client";

import { useQuery, withQuery, type DailyLogRow, type ListPage } from "@/lib/api";
import {
  enumerateDaysISO,
  formatDisplayDate,
  isoDateInZone,
  parseISODate,
} from "@/lib/datetime";
import { formatHours, isRestStatus, normalizeDayStatus } from "@/lib/server/metrics";
import { completedWorkSeconds } from "@/lib/workday-clock";
import { useMemo } from "react";

type WindowStats = {
  label: string;
  rangeLabel: string;
  start: string;
  end: string;
  presentDays: number;
  absentDays: number;
  restDays: number;
  upcomingDays: number;
  totalDays: number;
  workdayCount: number;
  workSeconds: number;
  loading: boolean;
};

function dayKey(row: DailyLogRow): string {
  return (row.date || row.rawDate || "").slice(0, 10);
}

function statusOf(row: DailyLogRow | undefined): string {
  if (!row) return "";
  return normalizeDayStatus(row.status || "");
}

function rowPresent(row: DailyLogRow | undefined): boolean {
  if (!row) return false;
  const status = statusOf(row);
  if (status === "Present") return true;
  if (status === "Half day" || status === "Leave" || status === "Absent") return false;
  if (status && isRestStatus(row.status || "")) return false;
  // Empty status: a first punch still counts as present for salary-safe day tallies.
  return Boolean(String(row.inTime || "").trim());
}

function rowRest(row: DailyLogRow | undefined): boolean {
  if (!row) return false;
  return isRestStatus(row.status || "");
}



/**
 * Resolve the single panel window from the dashboard date filter.
 * Prefer explicit start/end; fall back to a single anchor/today day.
 * Never invent a parallel week+month pair.
 */
function filterWindow(
  startDate: string | undefined,
  endDate: string | undefined,
  anchorDate: string | undefined,
  today: string,
): { start: string; end: string; label: string } {
  const startRaw = parseISODate(startDate) ? startDate! : "";
  const endRaw = parseISODate(endDate) ? endDate! : "";
  const anchorRaw = parseISODate(anchorDate) ? anchorDate! : "";

  let start = "";
  let end = "";

  // Keep the full filter window (incl. future days in week/month presets).
  // summarizeWindow skips day > today so future ≠ absent in salary stats.
  if (startRaw && endRaw) {
    start = startRaw;
    end = endRaw;
    if (start > end) start = end;
  } else if (endRaw) {
    end = endRaw;
    start = end;
  } else if (startRaw) {
    start = startRaw;
    end = start;
  } else if (anchorRaw) {
    start = anchorRaw;
    end = start;
  } else {
    start = today;
    end = today;
  }

  const days = enumerateDaysISO(start, end).length;
  let label = "Selected period";
  if (start === end) {
    label = start === today ? "Today" : formatDisplayDate(start);
  } else if (days <= 8) {
    label = "This week";
  } else if (days <= 31) {
    label = "This month";
  }

  return { start, end, label };
}

function summarizeWindow(
  label: string,
  start: string,
  end: string,
  bio: DailyLogRow[],
  tivazo: DailyLogRow[],
  loading: boolean,
  today: string,
): WindowStats {
  const bioByDay = new Map<string, DailyLogRow>();
  const tivByDay = new Map<string, DailyLogRow>();
  for (const row of bio) {
    const day = dayKey(row);
    if (day) bioByDay.set(day, row);
  }
  for (const row of tivazo) {
    const day = dayKey(row);
    if (day) tivByDay.set(day, row);
  }

  let presentDays = 0;
  let absentDays = 0;
  let restDays = 0;
  let upcomingDays = 0;
  let workSeconds = 0;
  const allDays = enumerateDaysISO(start, end);
  const totalDays = allDays.length;

  // Every calendar day in the filter counts — including weekends.
  // Future days are Upcoming (not Absent). Present wins over rest on the other source.
  for (const day of allDays) {
    if (day > today) {
      upcomingDays += 1;
      continue;
    }
    const bioRow = bioByDay.get(day);
    const tivRow = tivByDay.get(day);
    const present = rowPresent(bioRow) || rowPresent(tivRow);
    if (present) {
      presentDays += 1;
      const seconds = completedWorkSeconds({
        tracked: tivRow?.trackedTime,
        trackedAlt: bioRow?.trackedTime,
        inTime: tivRow?.inTime,
        outTime: tivRow?.outTime,
        inTimeAlt: bioRow?.inTime,
        outTimeAlt: bioRow?.outTime,
      });
      if (seconds != null && seconds > 0) workSeconds += seconds;
      continue;
    }

    if (rowRest(bioRow) || rowRest(tivRow)) {
      restDays += 1;
      continue;
    }

    // Not Present and not Rest (including weekends with no row) → absent.
    absentDays += 1;
  }

  return {
    label,
    rangeLabel:
      start === end
        ? formatDisplayDate(start)
        : `${formatDisplayDate(start)} – ${formatDisplayDate(end)}`,
    start,
    end,
    presentDays,
    absentDays,
    restDays,
    upcomingDays,
    totalDays,
    workdayCount: presentDays + absentDays,
    workSeconds,
    loading,
  };
}

function useWindowLogs(memberId: string, start: string, end: string) {
  const bio = useQuery<ListPage<DailyLogRow>>(
    memberId
      ? withQuery("/daily-logs", { startDate: start, endDate: end, q: memberId, all: 1 })
      : null,
  );
  const tivazo = useQuery<ListPage<DailyLogRow>>(
    memberId
      ? withQuery("/tivazo/activities", {
          startDate: start,
          endDate: end,
          q: memberId,
          all: 1,
        })
      : null,
  );
  return {
    bio: bio.data?.items ?? [],
    tivazo: tivazo.data?.items ?? [],
    loading: (bio.loading && !bio.data) || (tivazo.loading && !tivazo.data),
  };
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "present" | "hours" | "absent" | "rest" | "upcoming";
}) {
  return (
    <article className="smp-member-period__stat" data-tone={tone}>
      <p className="smp-member-period__stat-label">{label}</p>
      <p className="smp-member-period__stat-value">{value}</p>
      <p className="smp-member-period__stat-hint">{hint}</p>
    </article>
  );
}

function PeriodPanel({ stats }: { stats: WindowStats }) {
  const accounted =
    stats.presentDays + stats.absentDays + stats.restDays + stats.upcomingDays;
  return (
    <section className="smp-member-period__panel" aria-label={stats.label}>
      <header className="smp-member-period__panel-head">
        <div>
          <h3 className="smp-member-period__panel-title">{stats.label}</h3>
          <p className="smp-member-period__panel-meta">{stats.rangeLabel}</p>
        </div>
        {stats.loading ? (
          <span className="smp-member-period__loading">Updating…</span>
        ) : (
          <span className="smp-member-period__panel-meta">
            {stats.presentDays} present · {stats.absentDays} absent
            {stats.restDays ? ` · ${stats.restDays} off` : ""}
            {stats.upcomingDays ? ` · ${stats.upcomingDays} upcoming` : ""}
            {` = ${accounted}/${stats.totalDays} days`}
          </span>
        )}
      </header>
      <div className="smp-member-period__stats" data-rich="true">
        <StatCard
          label="Present"
          value={stats.loading ? "—" : String(stats.presentDays)}
          hint="Status Present (Bio or Tivazo)"
          tone="present"
        />
        <StatCard
          label="Work hours"
          value={
            stats.loading
              ? "—"
              : stats.presentDays > 0 && stats.workSeconds <= 0
                ? "—"
                : formatHours(stats.workSeconds)
          }
          hint={
            stats.presentDays > 0 && stats.workSeconds <= 0
              ? "Still in or no completed out yet"
              : "Tracked / in→out across Present days"
          }
          tone="hours"
        />
        <StatCard
          label="Absent"
          value={stats.loading ? "—" : String(stats.absentDays)}
          hint="Past/today not Present"
          tone="absent"
        />
        {stats.restDays > 0 ? (
          <StatCard
            label="Off"
            value={stats.loading ? "—" : String(stats.restDays)}
            hint="Weekly off / rest"
            tone="rest"
          />
        ) : null}
        {stats.upcomingDays > 0 ? (
          <StatCard
            label="Upcoming"
            value={stats.loading ? "—" : String(stats.upcomingDays)}
            hint="After today · not absent"
            tone="upcoming"
          />
        ) : null}
      </div>
    </section>
  );
}

export function DashboardMemberPeriodStats({
  memberId,
  memberLabel,
  startDate,
  endDate,
  anchorDate,
}: {
  memberId: string;
  memberLabel?: string;
  /** Dashboard filter start (ISO). Prefer over week/month dual panels. */
  startDate?: string;
  /** Dashboard filter end (ISO). */
  endDate?: string;
  /** @deprecated Prefer startDate/endDate from the overview filter. */
  anchorDate?: string;
}) {
  const today = isoDateInZone();
  const window = useMemo(
    () => filterWindow(startDate, endDate, anchorDate, today),
    [startDate, endDate, anchorDate, today],
  );

  const logs = useWindowLogs(memberId, window.start, window.end);

  const stats = useMemo(
    () =>
      summarizeWindow(
        window.label,
        window.start,
        window.end,
        logs.bio,
        logs.tivazo,
        logs.loading,
        today,
      ),
    [window.label, window.start, window.end, logs.bio, logs.tivazo, logs.loading, today],
  );

  if (!memberId) return null;

  return (
    <section
      className="smp-panel smp-dashboard-panel smp-member-period"
      data-single="true"
      aria-label={stats.label}
    >
      <header className="smp-member-period__head">
        <div>
          <p className="smp-member-period__eyebrow">Attendance rhythm</p>
          <h2 className="smp-member-period__title">{stats.label}</h2>
          <p className="smp-member-period__meta">
            {[memberLabel, "Every day in the range accounted for"].filter(Boolean).join(" · ")}
          </p>
        </div>
      </header>
      <div className="smp-member-period__grid" data-single="true">
        <PeriodPanel stats={stats} />
      </div>
    </section>
  );
}
