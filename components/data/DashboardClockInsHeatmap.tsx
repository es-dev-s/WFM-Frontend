"use client";

import {
  GitHubActivity,
  type Contribution,
  type ContributionLevel,
} from "@/components/ui/github-activity";
import { useQuery, withQuery } from "@/lib/api";
import {
  addDaysISO,
  enumerateDaysISO,
  formatDisplayDate,
  isoDateInZone,
  parseISODate,
} from "@/lib/datetime";
import {
  formatMinutes,
  presenceHeatLevel,
  sourcePunchMinutes,
  uniqueWorkdayPeople,
  workdayPresentOn,
  type WorkdayPerson,
} from "@/lib/workday-clock";
import { useCallback, useMemo } from "react";

const ACCENTS = {
  // Soft GitHub-like ramps — empty cell matches surface, peaks stay readable not neon.
  all: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  bio: ["#ebedf0", "#fbd38d", "#f6ad55", "#ed8936", "#c05621"],
  tivazo: ["#ebedf0", "#bfdbfe", "#60a5fa", "#3b82f6", "#1d4ed8"],
} as const;

/** Short multi-day windows (week / ~2 weeks) use a linear strip instead of the year grid. */
const STRIP_MAX_DAYS = 16;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Always honor the filter window. Do NOT clamp end ≤ today —
 * full calendar presets (Sun–Sat week, month-end) must survive.
 * Single date (or missing start) → start === end for that day.
 * NEVER expand to a trailing year.
 */
function heatWindow(startDate?: string, endDate?: string) {
  const today = isoDateInZone();
  const startRaw = parseISODate(startDate) ? startDate! : "";
  const endRaw = parseISODate(endDate) ? endDate! : "";

  if (startRaw && endRaw) {
    let start = startRaw;
    let end = endRaw;
    if (start > end) start = end;
    return { start, end };
  }

  if (endRaw) {
    return { start: endRaw, end: endRaw };
  }

  if (startRaw) {
    return { start: startRaw, end: startRaw };
  }

  return { start: today, end: today };
}

/** Pad only for GitHub calendar column alignment (Sun-first). Never treat as attendance. */
function sundayPadDates(first: string): string[] {
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  if (!weekday) return [];
  return Array.from({ length: weekday }, (_, index) => addDaysISO(first, index - weekday));
}

function dayKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function quantileLevel(present: number, ranks: number[]): ContributionLevel {
  if (present <= 0) return 0;
  if (!ranks.length) return 4;
  if (present <= ranks[0]) return 1;
  if (present <= ranks[1]) return 2;
  if (present <= ranks[2]) return 3;
  return 4;
}

function punchLabel(
  kind: "in" | "out",
  minutes: number | null,
  pending: boolean,
  presentCount: number,
): string {
  if (!presentCount) return "No presence";
  const head = presentCount === 1 ? "1 present" : `${presentCount} present`;
  if (minutes == null) return head;
  const typical = formatMinutes(minutes);
  if (kind === "in") {
    return minutes <= 7 * 60 + 15 ? `${head} · on time ${typical}` : `${head} · late ${typical}`;
  }
  if (pending) return `${head} · still in`;
  return minutes >= 15 * 60 ? `${head} · till ${typical}` : `${head} · left ${typical}`;
}

function segWidth(count: number, total: number): string {
  if (total <= 0) return "50%";
  if (count <= 0) return "0%";
  // Keep a readable min when the other side dominates.
  const pct = Math.max(8, Math.round((count / total) * 100));
  return `${Math.min(92, pct)}%`;
}

function weekdayShort(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return WEEKDAY_SHORT[weekday] ?? "";
}

type DayMetric = {
  date: string;
  present: number;
  level: ContributionLevel;
  label: string;
  /** Interactive / countable day (in filter and ≤ today). */
  inRange: boolean;
  /** Calendar day after today — render muted, never absent. */
  isFuture: boolean;
};

export function DashboardClockInsHeatmap({
  people,
  source,
  kind,
  startDate,
  endDate,
  sourceName,
  teamId = "",
  memberId = "",
  active = false,
  onOpen,
  onDaySelect,
  onDayOpen,
}: {
  people: WorkdayPerson[];
  source: "all" | "bio" | "tivazo";
  kind: "in" | "out";
  startDate?: string;
  endDate?: string;
  sourceName: string;
  teamId?: string;
  memberId?: string;
  active?: boolean;
  onOpen?: () => void;
  /** Optional day focus for non-modal callers. Day cells prefer onDayOpen only. */
  onDaySelect?: (day: string) => void;
  /** Open the day people modal (present / absent / all). */
  onDayOpen?: (day: string, mode?: "present" | "absent" | "all") => void;
}) {
  const window = useMemo(() => heatWindow(startDate, endDate), [startDate, endDate]);
  const today = isoDateInZone();
  const focusedDay =
    window.start === window.end ? window.start : "";
  const singleDay = Boolean(focusedDay);
  const daysInRange = useMemo(
    () => enumerateDaysISO(window.start, window.end),
    [window.start, window.end],
  );
  const spanDays = daysInRange.length;
  const useStrip = !singleDay && spanDays > 0 && spanDays <= STRIP_MAX_DAYS;
  const months = Math.max(1, Math.min(12, Math.round(spanDays / 30) || 1));
  const presence = useQuery<{
    days: { day: string; present: number; typicalIn: number | null; typicalOut: number | null }[];
  }>(
    withQuery("/dashboard/presence", {
      startDate: window.start,
      endDate: window.end,
      // Match chip source: Combined → all (max Bio/Tivazo), Bio → bio, Tivazo → tivazo.
      source: source === "tivazo" ? "tivazo" : source === "bio" ? "bio" : "all",
      teamId: teamId || undefined,
      memberId: memberId || undefined,
    }),
  );

  // Defense in depth: even if the parent passes a wider roster, day cells must
  // only count the selected member/team — never the whole office.
  const scopedPeople = useMemo(() => {
    if (memberId) {
      const key = memberId.trim().toLowerCase();
      return people.filter(
        (person) =>
          person.email.toLowerCase() === key ||
          person.id.toLowerCase() === key ||
          person.name.toLowerCase() === key,
      );
    }
    if (teamId) {
      const key = teamId.trim().toLowerCase();
      return people.filter((person) => person.team.trim().toLowerCase() === key);
    }
    return people;
  }, [people, memberId, teamId]);

  const todayCounts = useMemo(() => {
    if (!singleDay) return { present: 0, absent: 0, total: 0 };
    // Same uniqueness as Present chip on a single day (no unique fold needed for day period,
    // but unique protects against duplicate person-days if the roster still has range rows).
    const roster = uniqueWorkdayPeople(scopedPeople);
    const presentRows = roster.filter((person) => workdayPresentOn(person, source));
    const presentCount = presentRows.length;
    const absentCount = Math.max(0, roster.length - presentCount);
    return { present: presentCount, absent: absentCount, total: roster.length };
  }, [scopedPeople, source, singleDay]);

  const dayMetrics = useMemo<DayMetric[]>(() => {
    if (singleDay) return [];
    if (!daysInRange.length) return [];
    const byPeople = new Map<string, WorkdayPerson[]>();
    for (const person of scopedPeople) {
      // Live roster rows are often undated; attribute them to the focused day so the chart matches chips.
      const date = dayKey(person.date) || focusedDay;
      if (!date) continue;
      const list = byPeople.get(date) ?? [];
      list.push(person);
      byPeople.set(date, list);
    }
    const byDay = new Map(
      (presence.data?.days ?? []).map((row) => [
        dayKey(row.day),
        {
          present: Number(row.present) || 0,
          typicalIn: row.typicalIn,
          typicalOut: row.typicalOut,
        },
      ]),
    );
    const populated = [...byDay.values()]
      .map((row) => row.present)
      .filter((value) => value > 0)
      .sort((left, right) => left - right);
    const at = (share: number) =>
      populated.length ? populated[Math.min(populated.length - 1, Math.floor(share * (populated.length - 1)))] : 0;
    const ranks = [at(0.25), at(0.5), at(0.75)];

    // Punch tone still uses Bio vs Tivazo arrival/departure fields for heat color.
    const destSource: "bio" | "tivazo" = source === "tivazo" ? "tivazo" : "bio";
    // Every calendar day in the filter — including Sat/Sun. Never invent weekend "rest".
    return daysInRange.map((date) => {
      const rows = byPeople.get(date) ?? [];
      // Same Present rule as Daily clock-ins chips / source cards.
      const presentRows = rows.filter((row) => workdayPresentOn(row, source));
      const punchMinutes = presentRows
        .map((row) => sourcePunchMinutes(row, destSource, kind))
        .filter((value): value is number => value != null);
      const pending = presentRows.some(
        (row) => kind === "out" && (destSource === "bio" ? row.bioDeparture : row.tivazoDeparture) === "pending",
      );
      const stored = byDay.get(date);
      // If this day is in the loaded roster, trust local Present only — never fall back to API
      // (API fallback on an all-Absent local day would resurrect a stale Present count).
      const hasLocalDay = byPeople.has(date);
      const isFuture = date > today;
      // Member/team scope must never fall back to office-wide /dashboard/presence
      // headcounts (those ignore or mishandle memberId and show 280+ in a 1-person view).
      // Days without a scoped local row are 0 Present, not the office series.
      const scoped = Boolean(memberId || teamId);
      let present = 0;
      if (!isFuture) {
        if (hasLocalDay) {
          present = presentRows.length;
          // Single member → at most one Present per day.
          if (memberId) present = Math.min(1, present);
        } else if (!scoped) {
          present = stored?.present || 0;
        }
      }
      // Under scope, ignore API typicals (they reflect the whole office).
      const typical = isFuture
        ? null
        : punchMinutes.length
          ? median(punchMinutes)
          : scoped
            ? null
            : kind === "in"
              ? stored?.typicalIn ?? null
              : stored?.typicalOut ?? null;
      const level = !present
        ? 0
        : punchMinutes.length || pending
          ? presenceHeatLevel(typical, kind, pending)
          : quantileLevel(present, ranks);
      const inRange = date >= window.start && date <= window.end && !isFuture;
      return {
        date,
        present,
        level,
        label: isFuture
          ? "Upcoming"
          : punchLabel(kind, typical, pending, present),
        inRange,
        isFuture,
      };
    });
  }, [
    scopedPeople,
    presence.data?.days,
    daysInRange,
    window.start,
    window.end,
    source,
    kind,
    focusedDay,
    singleDay,
    today,
    memberId,
    teamId,
  ]);

  const contributions = useMemo<Contribution[]>(() => {
    if (singleDay || useStrip) return [];
    if (!dayMetrics.length) return [];
    const pads = sundayPadDates(dayMetrics[0].date).map((date) => ({
      date,
      count: 0,
      level: 0 as ContributionLevel,
      label: "Outside selected range",
      // Inert alignment pad — not attendance / not clickable.
      href: undefined,
      activatable: false,
      pad: true,
    }));
    const real = dayMetrics.map((day) => ({
      date: day.date,
      count: day.present,
      level: day.level,
      label: day.label,
      // No hash href — day click opens one modal only (preventDefault alone still left # in status).
      href: undefined,
      // Past/today: people modal. Future (in window): soft Upcoming modal — not a blank office list.
      activatable: day.date >= window.start && day.date <= window.end,
      pad: false,
    }));
    return [...pads, ...real];
  }, [dayMetrics, singleDay, useStrip, window.start, window.end]);

  const presentDays = dayMetrics.filter(
    (day) => day.present > 0 && day.date >= window.start && day.date <= window.end && day.date <= today,
  ).length;
  // Under member/team scope, day cells come from the scoped roster — don't block on the
  // office presence series (it is untrusted for headcounts when scoped).
  const scopedView = Boolean(memberId || teamId);
  const loading = scopedView
    ? false
    : presence.loading && !presence.data;
  const onDayActivate = useCallback(
    (day: Contribution) => {
      if (day.pad) return;
      if (!day.activatable && !day.href) return;
      // Modal only — do not call onDaySelect (that focuses Daily clock-ins panel = second UI).
      if (onDayOpen) {
        onDayOpen(day.date, "present");
        return;
      }
      onDaySelect?.(day.date);
    },
    [onDaySelect, onDayOpen],
  );

  const rangeLabel = singleDay
    ? formatDisplayDate(focusedDay)
    : `${formatDisplayDate(window.start)} – ${formatDisplayDate(window.end)}`;
  const daysLabel = singleDay
    ? `${todayCounts.present} present · ${todayCounts.absent} not present`
    : loading && !presence.data
      ? "Loading…"
      : presentDays
        ? `${presentDays} present day${presentDays === 1 ? "" : "s"}`
        : "No present days yet";

  const openPresent = () => {
    if (singleDay && focusedDay) {
      onDayOpen?.(focusedDay, "present");
      return;
    }
    onOpen?.();
  };

  const head = (
    <div className="smp-github-activity__head">
      {onOpen || onDayOpen ? (
        <button
          type="button"
          className="smp-github-activity__open"
          data-active={active ? "true" : undefined}
          onClick={openPresent}
          aria-label={
            memberId
              ? `View Presence · ${sourceName} day detail`
              : `View Presence · ${sourceName} people`
          }
        >
          <p className="smp-github-activity__title">
            Presence
            <span className="smp-github-activity__source">{sourceName}</span>
          </p>
          <p className="smp-github-activity__meta">
            <span>{rangeLabel}</span>
            <span className="smp-github-activity__dot" aria-hidden="true" />
            <span>{daysLabel}</span>
          </p>
        </button>
      ) : (
        <div className="smp-github-activity__copy">
          <p className="smp-github-activity__title">
            Presence
            <span className="smp-github-activity__source">{sourceName}</span>
          </p>
          <p className="smp-github-activity__meta">
            <span>{rangeLabel}</span>
            <span className="smp-github-activity__dot" aria-hidden="true" />
            <span>{daysLabel}</span>
          </p>
        </div>
      )}
      <div className="smp-github-activity__aside">
        <p className="smp-github-activity__hint">
          {memberId
            ? singleDay
              ? "Click a segment for day detail"
              : "Click a day for detail"
            : singleDay
              ? "Click a segment to view people"
              : "Click a day to view people"}
        </p>
        {!singleDay && !useStrip ? (
          <div className="smp-github-activity__scale" aria-hidden="true">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <i
                key={level}
                style={{ background: ACCENTS[source][level as 0 | 1 | 2 | 3 | 4] }}
              />
            ))}
            <span>More</span>
          </div>
        ) : null}
      </div>
    </div>
  );

  if (singleDay) {
    const presentFlex = todayCounts.present > 0 ? Math.max(1, todayCounts.present) : 0;
    const absentFlex = todayCounts.absent > 0 ? Math.max(1, todayCounts.absent) : 0;
    const barTotal = presentFlex + absentFlex;

    return (
      <div
        className="smp-github-activity smp-presence-today"
        data-source={source}
        data-mode="today"
      >
        {head}

        <div
          className="smp-presence-today__bar"
          role="group"
          aria-label={`Presence for ${rangeLabel}`}
        >
          {todayCounts.total === 0 ? (
            <div className="smp-presence-today__empty">No people in this view</div>
          ) : (
            <>
              <button
                type="button"
                className="smp-presence-today__seg"
                data-tone="present"
                disabled={todayCounts.present === 0}
                style={{
                  flexGrow: presentFlex || 0,
                  flexBasis: segWidth(todayCounts.present, todayCounts.total),
                  width: barTotal ? undefined : "50%",
                }}
                onClick={() => onDayOpen?.(focusedDay, "present")}
                aria-label={`${todayCounts.present} present`}
              >
                <span className="smp-presence-today__seg-label">Present</span>
                <span className="smp-presence-today__seg-value">{todayCounts.present}</span>
              </button>
              <button
                type="button"
                className="smp-presence-today__seg"
                data-tone="absent"
                disabled={todayCounts.absent === 0}
                style={{
                  flexGrow: absentFlex || 0,
                  flexBasis: segWidth(todayCounts.absent, todayCounts.total),
                  width: barTotal ? undefined : "50%",
                }}
                onClick={() => onDayOpen?.(focusedDay, "absent")}
                aria-label={`${todayCounts.absent} not present`}
              >
                <span className="smp-presence-today__seg-label">Not present</span>
                <span className="smp-presence-today__seg-value">{todayCounts.absent}</span>
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (useStrip) {
    return (
      <div
        className="smp-github-activity smp-presence-strip"
        data-source={source}
        data-mode="strip"
        data-loading={loading ? "true" : undefined}
      >
        {head}
        <div
          className="smp-presence-strip__row"
          role="list"
          aria-label={`Presence by day · ${rangeLabel}`}
          style={{
            gridTemplateColumns: `repeat(${Math.max(dayMetrics.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          {dayMetrics.map((day) => {
            const tone = day.isFuture
              ? "muted"
              : day.present > 0
                ? "present"
                : day.inRange
                  ? "absent"
                  : "muted";
            const bg =
              !day.isFuture && day.present > 0
                ? ACCENTS[source][Math.max(1, day.level) as 1 | 2 | 3 | 4]
                : undefined;
            return (
              <button
                key={day.date}
                type="button"
                role="listitem"
                className="smp-presence-strip__cell"
                data-tone={tone}
                data-level={day.level}
                data-future={day.isFuture ? "true" : undefined}
                disabled={day.date < window.start || day.date > window.end}
                style={bg ? { background: bg } : undefined}
                title={`${weekdayShort(day.date)} ${formatDisplayDate(day.date)} · ${day.label}`}
                aria-label={`${weekdayShort(day.date)} ${formatDisplayDate(day.date)} · ${day.label}`}
                onClick={() => {
                  if (day.date < window.start || day.date > window.end) return;
                  // Modal only — avoid onDaySelect panel focus competing with the day modal.
                  // Future days open an Upcoming soft state in the modal (not a blank roster).
                  if (onDayOpen) {
                    onDayOpen(day.date, "present");
                    return;
                  }
                  if (!day.isFuture) onDaySelect?.(day.date);
                }}
              >
                <span className="smp-presence-strip__dow">{weekdayShort(day.date)}</span>
                <span className="smp-presence-strip__dom">{Number(day.date.slice(8, 10))}</span>
                <span className="smp-presence-strip__count">
                  {day.isFuture
                    ? ""
                    : day.present > 0
                      ? day.present
                      : day.inRange
                        ? "—"
                        : ""}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="smp-github-activity"
      data-source={source}
      data-loading={loading ? "true" : undefined}
    >
      {head}
      <div className="smp-github-activity__grid">
        <GitHubActivity
          contributions={contributions}
          repos={[]}
          accent={[...ACCENTS[source]]}
          cellSize={10}
          months={months}
          showMonths={spanDays > 14}
          fill
          heading=""
          onDayActivate={onDayActivate}
        />
      </div>
    </div>
  );
}
