"use client";

import { useQuery, withQuery, type DailyLogRow, type ListPage } from "@/lib/api";
import {
  enumerateDaysISO,
  formatDisplayDate,
  isoDateInZone,
  parseISODate,
} from "@/lib/datetime";
import {
  formatHours,
  isLeaveStatus,
  isRestStatus,
  isWeeklyOffStatus,
  normalizeDayStatus,
} from "@/lib/server/metrics";
import { completedWorkSeconds } from "@/lib/workday-clock";
import { MotionSection } from "@/components/ui/MotionSection";
import { useMemo } from "react";

type DayTone = "present" | "absent" | "leave" | "off" | "holiday" | "upcoming";

type DayCell = {
  date: string;
  dow: string;
  dayNum: number;
  tone: DayTone;
  label: string;
  saturday: boolean;
  today: boolean;
};

type WindowStats = {
  label: string;
  rangeLabel: string;
  start: string;
  end: string;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  restDays: number;
  holidayDays: number;
  upcomingDays: number;
  totalDays: number;
  workSeconds: number;
  loading: boolean;
  days: DayCell[];
  layout: "week" | "month" | "range";
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type MonthBlock = {
  key: string;
  label: string;
  days: DayCell[];
  pad: number;
};

function monthBlocksFromDays(days: DayCell[]): MonthBlock[] {
  const blocks: MonthBlock[] = [];
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const last = blocks[blocks.length - 1];
    if (!last || last.key !== key) {
      const [y, m] = key.split("-").map(Number);
      blocks.push({
        key,
        label: `${MONTH_NAMES[(m || 1) - 1] ?? key} ${y}`,
        days: [day],
        pad: 0,
      });
    } else {
      last.days.push(day);
    }
  }
  return blocks;
}


function dayKey(row: DailyLogRow): string {
  return (row.date || row.rawDate || "").slice(0, 10);
}

function statusOf(row: DailyLogRow | undefined): string {
  if (!row) return "";
  return normalizeDayStatus(row.status || "");
}

function isHolidayStatus(value: string | undefined | null): boolean {
  const status = normalizeDayStatus(value);
  const compact = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return status === "Holiday" || compact === "holiday" || compact === "publicholiday";
}

function rowPresent(row: DailyLogRow | undefined): boolean {
  if (!row) return false;
  const status = statusOf(row);
  if (status === "Present") return true;
  if (status === "Half day" || status === "Leave" || status === "Absent") return false;
  if (status && isRestStatus(row.status || "")) return false;
  if (isHolidayStatus(row.status)) return false;
  return Boolean(String(row.inTime || "").trim());
}

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

function utcWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
}

function dowOf(iso: string): string {
  return DOW[utcWeekday(iso)] ?? "";
}

function dayNumOf(iso: string): number {
  return Number(iso.slice(8, 10)) || 0;
}

function isSaturday(iso: string): boolean {
  return utcWeekday(iso) === 6;
}

function summarizeWindow(
  label: string,
  start: string,
  end: string,
  bio: DailyLogRow[],
  tivazo: DailyLogRow[],
  loading: boolean,
  today: string,
  source: "all" | "bio" | "tivazo" = "all",
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
  let leaveDays = 0;
  let restDays = 0;
  let holidayDays = 0;
  let upcomingDays = 0;
  let workSeconds = 0;
  const allDays = enumerateDaysISO(start, end);
  const dayCells: DayCell[] = [];

  for (const day of allDays) {
    const base = {
      date: day,
      dow: dowOf(day),
      dayNum: dayNumOf(day),
      saturday: isSaturday(day),
      today: day === today,
    };

    if (day > today) {
      upcomingDays += 1;
      dayCells.push({ ...base, tone: "upcoming", label: "Upcoming" });
      continue;
    }

    const bioRow = bioByDay.get(day);
    const tivRow = tivByDay.get(day);

    const bioIsPresent = rowPresent(bioRow);
    const tivIsPresent = rowPresent(tivRow);
    const isPresent =
      source === "bio" ? bioIsPresent : source === "tivazo" ? tivIsPresent : bioIsPresent || tivIsPresent;
    if (isPresent) {
      presentDays += 1;
      const seconds = completedWorkSeconds({
        tracked: source === "bio" ? bioRow?.trackedTime : tivRow?.trackedTime,
        trackedAlt: source === "tivazo" ? undefined : bioRow?.trackedTime,
        inTime: source === "bio" ? bioRow?.inTime : tivRow?.inTime,
        outTime: source === "bio" ? bioRow?.outTime : tivRow?.outTime,
        inTimeAlt: source === "all" ? bioRow?.inTime : undefined,
        outTimeAlt: source === "all" ? bioRow?.outTime : undefined,
      });
      if (seconds != null && seconds > 0) workSeconds += seconds;
      dayCells.push({ ...base, tone: "present", label: "Present" });
      continue;
    }

    // Leave / Off / Holiday: still visible from either source (status calendar), even when
    // punch Source is Bio- or Tivazo-only — only Present is source-gated above.
    if (isLeaveStatus(bioRow?.status) || isLeaveStatus(tivRow?.status)) {
      leaveDays += 1;
      dayCells.push({ ...base, tone: "leave", label: "Leave" });
      continue;
    }

    if (isHolidayStatus(bioRow?.status) || isHolidayStatus(tivRow?.status)) {
      holidayDays += 1;
      dayCells.push({ ...base, tone: "holiday", label: "Holiday" });
      continue;
    }

    if (isWeeklyOffStatus(bioRow?.status) || isWeeklyOffStatus(tivRow?.status)) {
      restDays += 1;
      dayCells.push({ ...base, tone: "off", label: "Week off" });
      continue;
    }

    if (isRestStatus(bioRow?.status) || isRestStatus(tivRow?.status)) {
      restDays += 1;
      dayCells.push({ ...base, tone: "off", label: "Week off" });
      continue;
    }

    absentDays += 1;
    dayCells.push({ ...base, tone: "absent", label: "Absent" });
  }

  const span = allDays.length;
  const layout: WindowStats["layout"] =
    span <= 8 ? "week" : span <= 31 ? "month" : "range";

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
    leaveDays,
    restDays,
    holidayDays,
    upcomingDays,
    totalDays: allDays.length,
    workSeconds,
    loading,
    days: dayCells,
    layout,
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
  tone?: "present" | "hours" | "absent" | "rest" | "leave" | "holiday" | "upcoming";
}) {
  return (
    <article className="smp-member-period__stat" data-tone={tone}>
      <div className="smp-member-period__stat-copy">
        <p className="smp-member-period__stat-label">{label}</p>
        <p className="smp-member-period__stat-hint">{hint}</p>
      </div>
      <p className="smp-member-period__stat-value">{value}</p>
    </article>
  );
}

function RhythmLegend({
  showLeave,
  showHoliday,
}: {
  showLeave: boolean;
  showHoliday: boolean;
}) {
  return (
    <ul className="smp-member-period__legend" aria-label="Status legend">
      <li data-tone="present">Present</li>
      <li data-tone="absent">Absent</li>
      {showLeave ? <li data-tone="leave">Leave</li> : null}
      <li data-tone="off">Week off</li>
      {showHoliday ? <li data-tone="holiday">Holiday</li> : null}
    </ul>
  );
}

export function DashboardMemberPeriodStats({
  memberId,
  memberLabel,
  startDate,
  endDate,
  anchorDate,
  source = "all",
}: {
  memberId: string;
  memberLabel?: string;
  startDate?: string;
  endDate?: string;
  /** @deprecated Prefer startDate/endDate from the overview filter. */
  anchorDate?: string;
  /** Punch Source: Bio / Tivazo / Combined — gates Present only. */
  source?: "all" | "bio" | "tivazo";
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
        source,
      ),
    [window.label, window.start, window.end, logs.bio, logs.tivazo, logs.loading, today, source],
  );

  const monthBlocks = useMemo(() => {
    const blocks = monthBlocksFromDays(stats.days);
    return blocks.map((block) => ({
      ...block,
      pad: block.days.length ? utcWeekday(block.days[0].date) : 0,
    }));
  }, [stats.days]);

  if (!memberId) return null;

  const showCalendar = stats.days.length >= 1;
  const isWeek = stats.layout === "week";
  const isStacked = !isWeek && monthBlocks.length > 1;
  const isMonth = !isWeek && monthBlocks.length === 1;
  const calendarLayout = isWeek ? "week" : isStacked ? "stacked" : "month";
  const density = isStacked ? "compact" : "comfortable";
  const statCount =
    4 +
    (stats.leaveDays > 0 ? 1 : 0) +
    (stats.holidayDays > 0 ? 1 : 0) +
    (stats.upcomingDays > 0 ? 1 : 0);

  const renderDayCell = (day: DayCell, opts?: { showDow?: boolean }) => (
    <div
      key={day.date}
      role="listitem"
      className="smp-member-period__rhythm-cell"
      data-tone={day.tone}
      data-weekend={day.saturday ? "true" : undefined}
      data-today={day.today ? "true" : undefined}
      title={`${day.date} · ${day.label}`}
      aria-label={`${day.dow} ${day.dayNum}, ${day.label}`}
    >
      {opts?.showDow ? (
        <span className="smp-member-period__rhythm-dow">{day.dow}</span>
      ) : null}
      <span className="smp-member-period__rhythm-date">{day.dayNum}</span>
      <span className="smp-member-period__rhythm-label">{day.label}</span>
    </div>
  );

  return (
    <MotionSection
      as="section"
      className="smp-panel smp-dashboard-panel smp-member-period smp-member-period--single smp-member-period--calendar"
      aria-label={`Attendance rhythm · ${stats.label}`}
      delay={0.04}
    >
      <header className="smp-member-period__head">
        <div className="smp-member-period__heading">
          <p className="smp-member-period__eyebrow">Attendance rhythm</p>
          <h2 className="smp-member-period__title">{stats.label}</h2>
          <p className="smp-member-period__meta">
            <span className="smp-member-period__member">{memberLabel || "Selected member"}</span>
            <span className="smp-member-period__dot" aria-hidden="true">
              ·
            </span>
            <span>{stats.rangeLabel}</span>
            {stats.loading ? (
              <>
                <span className="smp-member-period__dot" aria-hidden="true">
                  ·
                </span>
                <span>Updating…</span>
              </>
            ) : null}
          </p>
        </div>
        <RhythmLegend showLeave={stats.leaveDays > 0} showHoliday={stats.holidayDays > 0} />
      </header>

      {showCalendar ? (
        <div
          className="smp-member-period__calendar"
          data-layout={calendarLayout}
          data-density={density}
          aria-label={`${stats.label} calendar`}
        >
          {isWeek ? (
            <div
              className="smp-member-period__rhythm"
              data-layout="week"
              role="list"
              style={{ ["--rhythm-cols" as string]: String(Math.max(stats.days.length, 1)) }}
            >
              {stats.days.map((day) => renderDayCell(day, { showDow: true }))}
            </div>
          ) : null}

          {isMonth
            ? monthBlocks.map((block) => (
                <div key={block.key} className="smp-member-period__month" data-density={density}>
                  <div className="smp-member-period__weekday-row" aria-hidden="true">
                    {DOW.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="smp-member-period__rhythm" data-layout="month" role="list">
                    {Array.from({ length: block.pad }, (_, i) => (
                      <div
                        key={`pad-${block.key}-${i}`}
                        className="smp-member-period__rhythm-cell"
                        data-tone="pad"
                        aria-hidden="true"
                      />
                    ))}
                    {block.days.map((day) => renderDayCell(day))}
                  </div>
                </div>
              ))
            : null}

          {isStacked ? (
            <div className="smp-member-period__months" role="list">
              {monthBlocks.map((block) => (
                <article
                  key={block.key}
                  className="smp-member-period__month"
                  data-density={density}
                  role="listitem"
                  aria-label={block.label}
                >
                  <header className="smp-member-period__month-head">
                    <h3 className="smp-member-period__month-title">{block.label}</h3>
                  </header>
                  <div className="smp-member-period__weekday-row" aria-hidden="true">
                    {DOW.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                  <div className="smp-member-period__rhythm" data-layout="month" role="list">
                    {Array.from({ length: block.pad }, (_, i) => (
                      <div
                        key={`pad-${block.key}-${i}`}
                        className="smp-member-period__rhythm-cell"
                        data-tone="pad"
                        aria-hidden="true"
                      />
                    ))}
                    {block.days.map((day) => renderDayCell(day))}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="smp-member-period__stats" data-count={String(statCount)}>
        <StatCard
          label="Present"
          value={stats.loading ? "—" : String(stats.presentDays)}
          hint="Days marked Present"
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
              ? "Still in / no out yet"
              : "Across Present days"
          }
          tone="hours"
        />
        <StatCard
          label="Absent"
          value={stats.loading ? "—" : String(stats.absentDays)}
          hint="Past days not Present"
          tone="absent"
        />
        <StatCard
          label="Week off"
          value={stats.loading ? "—" : String(stats.restDays)}
          hint="Weekly off / rest"
          tone="rest"
        />
        {stats.leaveDays > 0 ? (
          <StatCard
            label="Leave"
            value={stats.loading ? "—" : String(stats.leaveDays)}
            hint="On leave"
            tone="leave"
          />
        ) : null}
        {stats.holidayDays > 0 ? (
          <StatCard
            label="Holiday"
            value={stats.loading ? "—" : String(stats.holidayDays)}
            hint="Public holiday"
            tone="holiday"
          />
        ) : null}
        {stats.upcomingDays > 0 ? (
          <StatCard
            label="Upcoming"
            value={stats.loading ? "—" : String(stats.upcomingDays)}
            hint="After today"
            tone="upcoming"
          />
        ) : null}
      </div>
    </MotionSection>
  );
}
