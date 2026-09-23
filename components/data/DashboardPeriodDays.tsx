"use client";

import { QueryState } from "@/components/data/QueryState";
import { FilterSearch } from "@/components/ui/FilterSearch";
import type { DailyLogRow, DashboardRosterPerson, FilterOption } from "@/lib/api";
import { scopeRosterPeople } from "@/lib/dashboard-scope";
import { enumerateDaysISO, formatDisplayDate } from "@/lib/datetime";
import {
  createIdentityIndex,
  identityCanonical,
  normalizeEmail,
  normalizePersonName,
  type IdentityLike,
} from "@/lib/identity";
import { biomaticHref, emailsParam, recordHref, tivazoHref } from "@/lib/href";
import { isRestStatus, normalizeDayStatus, formatHours } from "@/lib/server/metrics";
import { dailyLogToRoster, completedWorkSeconds } from "@/lib/workday-clock";
import Link from "next/link";
import { useMemo, useState } from "react";

type PeriodPerson = {
  key: string;
  id: string;
  bioId: string;
  tivazoId: string;
  name: string;
  email: string;
  hasBio: boolean;
  hasTivazo: boolean;
};

type PeriodDayRow = {
  key: string;
  date: string;
  name: string;
  email: string;
  bioId: string;
  tivazoId: string;
  bioLogId: string;
  tivazoLogId: string;
  hasBio: boolean;
  hasTivazo: boolean;
  bioStatus: string;
  bioIn: string;
  bioOut: string;
  tivazoStatus: string;
  tivazoIn: string;
  tivazoOut: string;
  tracked: string;
};

function asIdentity(row: IdentityLike): IdentityLike {
  return {
    email: row.email,
    id: row.memberId || row.employeeId || row.id,
    memberId: row.memberId,
    employeeId: row.employeeId,
    name: row.name,
    source: row.source,
  };
}

function logIdentity(row: DailyLogRow, source: "bio" | "tivazo"): IdentityLike {
  return {
    email: row.email,
    id: row.memberId || row.employeeId,
    memberId: row.memberId,
    employeeId: row.employeeId,
    name: row.name,
    source,
  };
}

function personLookups(person: PeriodPerson): string[] {
  return [
    person.key,
    normalizeEmail(person.email),
    String(person.id || "").trim().toLowerCase(),
    normalizePersonName(person.name),
  ].filter(Boolean);
}

function clock(value: string | undefined): string {
  const next = String(value || "").trim();
  return next || "—";
}

function statusTone(status: string): "ok" | "bad" | "warn" | undefined {
  if (status === "Present") return "ok";
  if (status === "Upcoming") return undefined; // neutral pill
  if (status === "Absent" || status === "Not on Tivazo" || status === "Not on Bio") return "bad";
  if (status === "Leave" || status === "Weekly off" || status === "Half day") return "warn";
  return undefined;
}

function bioDayHref(row: PeriodDayRow): string | undefined {
  if (!row.hasBio && row.bioStatus === "Not on Bio") return undefined;
  if (row.bioLogId) return recordHref("/biomatic/logs", row.bioLogId);
  if (row.bioId) return recordHref("/biomatic/members", row.bioId);
  if (!row.email) return undefined;
  return biomaticHref({
    view: "logs",
    emails: emailsParam([row.email]),
    startDate: row.date,
    endDate: row.date,
  });
}

function tivazoDayHref(row: PeriodDayRow): string | undefined {
  if (!row.hasTivazo && row.tivazoStatus === "Not on Tivazo") return undefined;
  if (row.tivazoLogId) return recordHref("/tivazo", row.tivazoLogId);
  return tivazoHref({
    memberId: row.tivazoId || undefined,
    emails: emailsParam([row.email]),
    startDate: row.date,
    endDate: row.date,
  });
}

function nameHref(row: PeriodDayRow): string | undefined {
  if (row.hasBio && row.bioId) return recordHref("/biomatic/members", row.bioId);
  if (row.hasTivazo) {
    return tivazoHref({
      memberId: row.tivazoId || undefined,
      emails: emailsParam([row.email]),
      startDate: row.date,
      endDate: row.date,
    });
  }
  return emailsParam([row.email])
    ? biomaticHref({
        view: "members",
        emails: emailsParam([row.email]),
        startDate: row.date,
        endDate: row.date,
      })
    : undefined;
}

function PairCell({
  source,
  href,
  status,
  inTime,
  outTime,
}: {
  source: "bio" | "tivazo";
  href?: string;
  status: string;
  inTime: string;
  outTime: string;
}) {
  const inner = (
    <>
      <span className="smp-pill" data-tone={statusTone(status)}>
        {status}
      </span>
      <span className="smp-period-days__times">
        <span data-empty={inTime ? undefined : "true"}>
          <small>In</small>
          {clock(inTime)}
        </span>
        <span data-empty={outTime ? undefined : "true"}>
          <small>Out</small>
          {clock(outTime)}
        </span>
      </span>
    </>
  );
  if (!href) {
    return (
      <span className="smp-clockins-pair" data-source={source}>
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="smp-clockins-pair"
      data-source={source}
      data-clickable="true"
      prefetch={false}
      aria-label={`Open ${source === "bio" ? "Biometrics" : "Tivazo"} for this day`}
    >
      {inner}
    </Link>
  );
}

function logDay(row: DailyLogRow): string {
  return row.date || row.rawDate || "";
}

function overlayLog(
  saved: DailyLogRow | undefined,
  live: DashboardRosterPerson | undefined,
  day: string,
  today: string,
  enrolled: boolean,
  missingLabel: string,
  restDay: boolean,
): { status: string; inTime: string; outTime: string; tracked: string } {
  if (!enrolled) {
    return { status: missingLabel, inTime: "", outTime: "", tracked: "" };
  }
  const livePunch =
    day === today && live && (live.startTime || live.endTime || normalizeDayStatus(live.attendance) === "Present")
      ? live
      : undefined;
  const rawStatus = normalizeDayStatus(livePunch?.attendance || saved?.status);
  const rest = restDay || isRestStatus(rawStatus);
  if (rest) {
    return {
      status: isRestStatus(rawStatus) ? rawStatus : "Weekly off",
      inTime: "",
      outTime: "",
      tracked: "",
    };
  }
  // Future calendar days are not absences — they have not happened yet.
  if (day > today) {
    return { status: "Upcoming", inTime: "", outTime: "", tracked: "" };
  }
  const inTime = livePunch?.startTime || saved?.inTime || "";
  const outTime = livePunch?.endTime || saved?.outTime || "";
  const tracked = livePunch?.trackedLabel || saved?.trackedTime || "";
  const status = rawStatus || (inTime || outTime || tracked ? "Present" : "Absent");
  return { status, inTime, outTime, tracked };
}

function putLog(
  map: Map<string, DailyLogRow>,
  index: ReturnType<typeof createIdentityIndex>,
  row: DailyLogRow,
  source: "bio" | "tivazo",
) {
  const day = logDay(row);
  if (!day) return;
  const keys = new Set(
    [
      identityCanonical(index, logIdentity(row, source)),
      normalizeEmail(row.email),
      String(row.memberId || "").trim().toLowerCase(),
      String(row.employeeId || "").trim().toLowerCase(),
      normalizePersonName(row.name),
    ].filter(Boolean),
  );
  for (const key of keys) map.set(`${key}:${day}`, row);
}

function getLog(map: Map<string, DailyLogRow>, person: PeriodPerson, day: string): DailyLogRow | undefined {
  for (const key of personLookups(person)) {
    const hit = map.get(`${key}:${day}`);
    if (hit) return hit;
  }
  return undefined;
}

function weekdayLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isWeekend(iso: string): boolean {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

export function DashboardPeriodDays({
  bioLogs,
  tivazoLogs,
  rosterBio,
  rosterTivazo,
  liveBio,
  liveTivazo,
  loading,
  error,
  onRetry,
  teamId,
  memberId,
  teams,
  supervisors,
  startDate,
  endDate,
  today,
  teamLabel,
  onPickDay,
}: {
  bioLogs: DailyLogRow[];
  tivazoLogs: DailyLogRow[];
  rosterBio: DashboardRosterPerson[];
  rosterTivazo: DashboardRosterPerson[];
  liveBio: DashboardRosterPerson[];
  liveTivazo: DashboardRosterPerson[];
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  teamId: string;
  memberId: string;
  teams: FilterOption[];
  supervisors: FilterOption[];
  startDate: string;
  endDate: string;
  today: string;
  teamLabel: string;
  onPickDay?: (day: string) => void;
}) {
  const [query, setQuery] = useState("");
  const scopedLogs = useMemo(() => {
    const bio = bioLogs.map((row) => dailyLogToRoster(row, "bio"));
    const tivazo = tivazoLogs.map((row) => dailyLogToRoster(row, "tivazo"));
    return scopeRosterPeople(bio, tivazo, teamId, memberId, teams, supervisors);
  }, [bioLogs, tivazoLogs, teamId, memberId, teams, supervisors]);
  const scopedRoster = useMemo(
    () => scopeRosterPeople(rosterBio, rosterTivazo, teamId, memberId, teams, supervisors),
    [rosterBio, rosterTivazo, teamId, memberId, teams, supervisors],
  );

  const index = useMemo(
    () =>
      createIdentityIndex([
        ...rosterBio.map((row) => asIdentity(row)),
        ...rosterTivazo.map((row) => asIdentity(row)),
        ...liveBio.map((row) => asIdentity(row)),
        ...liveTivazo.map((row) => asIdentity(row)),
        ...bioLogs.map((row) => logIdentity(row, "bio")),
        ...tivazoLogs.map((row) => logIdentity(row, "tivazo")),
      ]),
    [rosterBio, rosterTivazo, liveBio, liveTivazo, bioLogs, tivazoLogs],
  );

  const people = useMemo(() => {
    const map = new Map<string, PeriodPerson>();
    const add = (row: DashboardRosterPerson, source: "bio" | "tivazo") => {
      const key = identityCanonical(index, asIdentity(row));
      if (!key) return;
      const prev = map.get(key);
      map.set(key, {
        key,
        id: prev?.id || row.id,
        bioId: source === "bio" ? row.id || prev?.bioId || "" : prev?.bioId || "",
        tivazoId: source === "tivazo" ? row.id || prev?.tivazoId || "" : prev?.tivazoId || "",
        name: prev?.name || row.name,
        email: prev?.email || row.email,
        hasBio: Boolean(prev?.hasBio) || source === "bio",
        hasTivazo: Boolean(prev?.hasTivazo) || source === "tivazo",
      });
    };
    for (const row of [...scopedRoster.bio, ...scopedLogs.bio]) add(row, "bio");
    for (const row of [...scopedRoster.tivazo, ...scopedLogs.tivazo]) add(row, "tivazo");
    for (const person of map.values()) {
      if (!person.hasBio) {
        person.hasBio = bioLogs.some((row) => {
          const key = identityCanonical(index, logIdentity(row, "bio"));
          return key === person.key || personLookups(person).includes(key) || personLookups(person).includes(normalizeEmail(row.email));
        });
      }
      if (!person.hasTivazo) {
        person.hasTivazo = tivazoLogs.some((row) => {
          const key = identityCanonical(index, logIdentity(row, "tivazo"));
          return key === person.key || personLookups(person).includes(key) || personLookups(person).includes(normalizeEmail(row.email));
        });
      }
    }
    return [...map.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [scopedRoster, scopedLogs, index, bioLogs, tivazoLogs]);

  const rows = useMemo(() => {
    const bioMap = new Map<string, DailyLogRow>();
    const tivazoMap = new Map<string, DailyLogRow>();
    for (const row of bioLogs) putLog(bioMap, index, row, "bio");
    for (const row of tivazoLogs) putLog(tivazoMap, index, row, "tivazo");
    const liveBioMap = new Map<string, DashboardRosterPerson>();
    const liveTivazoMap = new Map<string, DashboardRosterPerson>();
    for (const row of liveBio) {
      const key = identityCanonical(index, asIdentity(row));
      if (key) liveBioMap.set(key, row);
    }
    for (const row of liveTivazo) {
      const key = identityCanonical(index, asIdentity(row));
      if (key) liveTivazoMap.set(key, row);
    }
    const days = enumerateDaysISO(startDate, endDate);
    const out: PeriodDayRow[] = [];
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const day = days[i];
      for (const person of people) {
        const bioSaved = getLog(bioMap, person, day);
        const tivazoSaved = getLog(tivazoMap, person, day);
        const restDay = isRestStatus(bioSaved?.status) || isRestStatus(tivazoSaved?.status);
        const bio = overlayLog(
          bioSaved,
          liveBioMap.get(person.key),
          day,
          today,
          person.hasBio || Boolean(bioSaved),
          "Not on Bio",
          restDay,
        );
        const tivazo = overlayLog(
          tivazoSaved,
          liveTivazoMap.get(person.key),
          day,
          today,
          person.hasTivazo || Boolean(tivazoSaved),
          "Not on Tivazo",
          restDay,
        );
        out.push({
          key: `${person.key}:${day}`,
          date: day,
          name: person.name,
          email: person.email,
          bioId: person.bioId || bioSaved?.employeeId || bioSaved?.memberId || "",
          tivazoId: person.tivazoId || tivazoSaved?.memberId || "",
          bioLogId: bioSaved?.id || "",
          tivazoLogId: tivazoSaved?.id || "",
          hasBio: person.hasBio || Boolean(bioSaved),
          hasTivazo: person.hasTivazo || Boolean(tivazoSaved),
          bioStatus: bio.status,
          bioIn: bio.inTime,
          bioOut: bio.outTime,
          tivazoStatus: tivazo.status,
          tivazoIn: tivazo.inTime,
          tivazoOut: tivazo.outTime,
          tracked: tivazo.tracked,
        });
      }
    }
    return out;
  }, [bioLogs, tivazoLogs, liveBio, liveTivazo, startDate, endDate, people, today, index]);

  const visible = useMemo(() => {
    // Group or member: only today and past days (no Upcoming rows in the list).
    const base = rows.filter((row) => row.date <= today);
    const needle = query.trim().toLowerCase();
    if (!needle) return base;
    return base.filter((row) =>
      [row.name, row.email, row.date, row.bioStatus, row.tivazoStatus].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [rows, query, today]);

  const PAGE_CHUNK = 120;
  const [rowLimit, setRowLimit] = useState(PAGE_CHUNK);
  const windowKey = `${startDate}:${endDate}:${query}:${memberId || ""}:${teamId || ""}:${rows.length}`;
  const [seenWindow, setSeenWindow] = useState(windowKey);
  if (seenWindow !== windowKey) {
    setSeenWindow(windowKey);
    setRowLimit(PAGE_CHUNK);
  }
  const painted = visible.length > rowLimit ? visible.slice(0, rowLimit) : visible;
  const hiddenCount = Math.max(0, visible.length - painted.length);

  const bioPresent = rows.filter((row) => row.date <= today && row.bioStatus === "Present").length;
  const tivazoPresent = rows.filter((row) => row.date <= today && row.tivazoStatus === "Present").length;
  // List hides future days; meta counts calendar days through today.
  const dayCount = enumerateDaysISO(startDate, endDate).filter((day) => day <= today).length;
  const memberRangeStats = useMemo(() => {
    if (!memberId) return null;
    let presentDays = 0;
    let absentDays = 0;
    let restDays = 0;
    let upcomingDays = 0;
    let workSeconds = 0;
    const totalDays = enumerateDaysISO(startDate, endDate).length;
    for (const row of rows) {
      if (row.date > today) {
        // Future calendar days — not Absent.
        upcomingDays += 1;
        continue;
      }
      const resting =
        isRestStatus(row.bioStatus) ||
        isRestStatus(row.tivazoStatus) ||
        row.bioStatus === "Weekly off" ||
        row.tivazoStatus === "Weekly off";
      if (resting) {
        restDays += 1;
        continue;
      }
      // Salary-safe Present only (Half day / Leave stay out of Present).
      const present = row.bioStatus === "Present" || row.tivazoStatus === "Present";
      if (present) {
        presentDays += 1;
        const seconds = completedWorkSeconds({
          tracked: row.tracked,
          inTime: row.tivazoIn,
          outTime: row.tivazoOut,
          inTimeAlt: row.bioIn,
          outTimeAlt: row.bioOut,
        });
        if (seconds != null && seconds > 0) workSeconds += seconds;
      } else {
        absentDays += 1;
      }
    }
    return {
      presentDays,
      absentDays,
      restDays,
      upcomingDays,
      workSeconds,
      totalDays,
      accountedDays: presentDays + absentDays + restDays + upcomingDays,
    };
  }, [memberId, rows, today, startDate, endDate]);
  const showName = !memberId && people.length > 1;

  if (loading && bioLogs.length === 0 && tivazoLogs.length === 0) {
    return <QueryState loading error={null} label="day by day Bio and Tivazo" />;
  }

  if (error && rows.length === 0) {
    return <QueryState loading={false} error={error} onRetry={onRetry} label="day by day Bio and Tivazo" />;
  }

  return (
    <div className="smp-period-days">
      <div className="smp-period-days__head">
        <div>
          <h3 className="smp-period-days__title">Attendance by day</h3>
          <p className="smp-period-days__meta">
            <span>{teamLabel}</span>
            <span>
              {formatDisplayDate(startDate)} – {formatDisplayDate(endDate)}
            </span>
            <span>
              {dayCount} {dayCount === 1 ? "day" : "days"}
            </span>
            <span>
              {people.length} {people.length === 1 ? "person" : "people"}
            </span>
            <span>Bio {bioPresent} present</span>
            <span>Tivazo {tivazoPresent} present</span>
          </p>
        </div>
        {people.length > 1 ? (
          <FilterSearch value={query} onChange={setQuery} placeholder="Search days or names" />
        ) : null}
      </div>
      {memberRangeStats ? (
        <div className="smp-period-days__summary" aria-label="Selected range totals">
          <article className="smp-period-days__summary-card" data-tone="present">
            <p className="smp-period-days__summary-label">Present</p>
            <p className="smp-period-days__summary-value">{memberRangeStats.presentDays}</p>
            <p className="smp-period-days__summary-hint">Status Present</p>
          </article>
          <article className="smp-period-days__summary-card" data-tone="hours">
            <p className="smp-period-days__summary-label">Work hours</p>
            <p className="smp-period-days__summary-value">
              {memberRangeStats.presentDays > 0 && memberRangeStats.workSeconds <= 0
                ? "—"
                : formatHours(memberRangeStats.workSeconds)}
            </p>
            <p className="smp-period-days__summary-hint">
              {memberRangeStats.presentDays > 0 && memberRangeStats.workSeconds <= 0
                ? "Still in or no completed out yet"
                : "Across Present days"}
            </p>
          </article>
          <article className="smp-period-days__summary-card" data-tone="absent">
            <p className="smp-period-days__summary-label">Absent</p>
            <p className="smp-period-days__summary-value">{memberRangeStats.absentDays}</p>
            <p className="smp-period-days__summary-hint">Past days not Present</p>
          </article>
          {memberRangeStats.restDays > 0 ? (
            <article className="smp-period-days__summary-card" data-tone="rest">
              <p className="smp-period-days__summary-label">Off</p>
              <p className="smp-period-days__summary-value">{memberRangeStats.restDays}</p>
              <p className="smp-period-days__summary-hint">Weekly off / rest</p>
            </article>
          ) : null}
          <p className="smp-period-days__summary-total">
            {memberRangeStats.presentDays} present
            {" · "}
            {memberRangeStats.absentDays} absent
            {memberRangeStats.restDays ? ` · ${memberRangeStats.restDays} off` : ""}
            {" · "}
            {memberRangeStats.presentDays +
              memberRangeStats.absentDays +
              memberRangeStats.restDays}{" "}
            days through today
          </p>
        </div>
      ) : null}
      {people.length === 0 ? (
        <p className="smp-period-days__empty">No people in this group for the selected range.</p>
      ) : (
        <div className="smp-period-days__scroller">
          <div className="smp-period-days__cols" data-name={showName ? "true" : "false"}>
            <span>Date</span>
            {showName ? <span>Name</span> : null}
            <span className="smp-period-days__pair-head" data-source="bio">
              Bio
              <small>
                <span>In</span>
                <span>Out</span>
              </small>
            </span>
            <span className="smp-period-days__pair-head" data-source="tivazo">
              Tivazo
              <small>
                <span>In</span>
                <span>Out</span>
              </small>
            </span>
            <span>Tracked</span>
          </div>
          <ul className="smp-period-days__list">
            {painted.map((row) => {
              const bioHref = bioDayHref(row);
              const tivazoPage = tivazoDayHref(row);
              const personHref = nameHref(row);
              return (
              <li key={row.key}>
                <div
                  className="smp-period-days__row"
                  data-name={showName ? "true" : "false"}
                  data-weekend={isWeekend(row.date) ? "true" : undefined}
                  data-upcoming={row.date > today ? "true" : undefined}
                >
                  {onPickDay ? (
                    <button
                      type="button"
                      className="smp-period-days__day"
                      data-clickable="true"
                      onClick={() => onPickDay(row.date)}
                    >
                      <strong>{weekdayLabel(row.date)}</strong>
                      <span>{row.date === today ? "Today" : row.date}</span>
                    </button>
                  ) : (
                    <span className="smp-period-days__day">
                      <strong>{weekdayLabel(row.date)}</strong>
                      <span>{row.date === today ? "Today" : row.date}</span>
                    </span>
                  )}
                  {showName ? (
                    personHref ? (
                      <Link href={personHref} className="smp-period-days__name" prefetch={false}>
                        {row.name}
                      </Link>
                    ) : (
                      <span className="smp-period-days__name">{row.name}</span>
                    )
                  ) : null}
                  <PairCell
                    source="bio"
                    href={bioHref}
                    status={row.bioStatus}
                    inTime={row.bioIn}
                    outTime={row.bioOut}
                  />
                  <PairCell
                    source="tivazo"
                    href={tivazoPage}
                    status={row.tivazoStatus}
                    inTime={row.tivazoIn}
                    outTime={row.tivazoOut}
                  />
                  {tivazoPage ? (
                    <Link
                      href={tivazoPage}
                      className="smp-period-days__tracked"
                      data-empty={row.tracked ? undefined : "true"}
                      data-clickable="true"
                      prefetch={false}
                    >
                      {clock(row.tracked)}
                    </Link>
                  ) : (
                    <span className="smp-period-days__tracked" data-empty={row.tracked ? undefined : "true"}>
                      {clock(row.tracked)}
                    </span>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
          {hiddenCount > 0 ? (
            <div className="smp-period-days__more">
              <button
                type="button"
                className="smp-btn smp-btn--ghost"
                onClick={() => setRowLimit((n) => n + PAGE_CHUNK)}
              >
                Show more ({hiddenCount} remaining)
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
