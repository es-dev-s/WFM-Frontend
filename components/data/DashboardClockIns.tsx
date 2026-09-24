"use client";

import { DashboardClockInsHeatmap } from "@/components/data/DashboardClockInsHeatmap";
import { DashboardClockInsModal } from "@/components/data/DashboardClockInsModal";
import { DashboardPeopleModal, type PeopleModalSpec } from "@/components/data/DashboardPeopleModal";
import {
  type DailyLogRow,
  type DashboardRosterPerson,
  type ListPage,
  useQuery,
  withQuery,
} from "@/lib/api";
import { isoDateInZone } from "@/lib/datetime";
import { biomaticHref, peopleScopeParam, tivazoHref } from "@/lib/href";
import {
  LATE_AFTER_MIN,
  type ArrivalStatus,
  type DepartureStatus,
  type WorkdayPerson,
  dailyLogToRoster,
  formatMinutes,
  mergeWorkdayPeople,
  uniqueWorkdayPeople,
  workdayPresentOn,
} from "@/lib/workday-clock";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";


function formatDayTitle(iso: string): string {
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    new Date(`${iso}T00:00:00Z`).getUTCDay()
  ];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const mon = months[m - 1] ?? iso.slice(5, 7);
  return `${weekday} ${mon} ${d}`;
}

function Chip({
  label,
  hint,
  value,
  tone,
  active,
  onOpen,
}: {
  label: string;
  hint?: string;
  value: number;
  tone?: "ok" | "late" | "early" | "present";
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="smp-clockins-chip"
      data-tone={tone}
      data-interactive="true"
      data-active={active ? "true" : undefined}
      data-empty={value === 0 ? "true" : undefined}
      aria-label={`View ${label} · ${value}`}
      onClick={onOpen}
    >
      <span className="smp-clockins-chip__label">{label}</span>
      {hint ? <span className="smp-clockins-chip__hint">{hint}</span> : null}
      <span className="smp-clockins-chip__value">{value}</span>
    </button>
  );
}

function dayKey(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

function onLogDay(row: DailyLogRow, day: string): boolean {
  return row.date === day || row.rawDate === day;
}

type DayModalStatus = "ready" | "loading" | "upcoming" | "error";

type DayModalState = {
  date: string;
  mode: "all" | "present" | "absent";
  people: WorkdayPerson[];
  /** Freeze at open — do not overwrite from the multi-day `visible` roster. */
  frozen: boolean;
  status: DayModalStatus;
  /** Fetch this day's Bio/Tivazo logs into the modal (no panel setFocus). */
  fetch: boolean;
};


function arrivalOn(
  person: WorkdayPerson,
  source: "all" | "bio" | "tivazo",
): ArrivalStatus {
  if (source === "bio") return person.bioArrival;
  if (source === "tivazo") return person.tivazoArrival;
  return person.arrival;
}

function departureOn(
  person: WorkdayPerson,
  source: "all" | "bio" | "tivazo",
): DepartureStatus {
  if (source === "bio") return person.bioDeparture;
  if (source === "tivazo") return person.tivazoDeparture;
  return person.departure;
}

export function DashboardClockIns({
  bio,
  tivazo,
  today,
  dateLabel,
  memberId = "",
  teamId = "",
  day,
  period = "day",
  startDate,
  endDate,
  source = "all",
  onSourceChange: _onSourceChange,
  onDaySelect: _onDaySelect,
}: {
  bio: DashboardRosterPerson[];
  tivazo: DashboardRosterPerson[];
  today: boolean | string;
  teamLabel?: string;
  dateLabel: string;
  memberId?: string;
  teamId?: string;
  day?: string;
  period?: "day" | "range";
  startDate?: string;
  endDate?: string;
  source?: "all" | "bio" | "tivazo";
  onSourceChange?: (source: "all" | "bio" | "tivazo") => void;
  onDaySelect?: (day: string) => void;
}) {
  void _onDaySelect; // retained for callers; Presence day open is modal-only
  void _onSourceChange; // Source UI lives in top dashboard filter strip
  const [peopleSpec, setPeopleSpec] = useState<PeopleModalSpec | null>(null);
  const [dayModal, setDayModal] = useState<DayModalState | null>(null);

  // Drop open chip/day dialogs when filters change so lists cannot stay office-wide.
  useEffect(() => {
    setPeopleSpec(null);
    setDayModal(null);
  }, [teamId, memberId, source, startDate, endDate, day, period]);


  const todayIso = typeof today === "string" && today ? today : isoDateInZone();

  const allPeople = useMemo(() => mergeWorkdayPeople(bio, tivazo, today), [bio, tivazo, today]);
  const people = useMemo(() => {
    if (source === "all") return allPeople;
    return mergeWorkdayPeople(source === "bio" ? bio : [], source === "tivazo" ? tivazo : [], today);
  }, [allPeople, bio, tivazo, source, today]);
  const sourceName = source === "bio" ? "Biometrics" : source === "tivazo" ? "Tivazo" : "Combined";
  const focusedDay =
    startDate && endDate && dayKey(startDate) === dayKey(endDate)
      ? dayKey(endDate)
      : dayKey(day) || dayKey(startDate);
  const singleDay = Boolean(
    startDate && endDate && dayKey(startDate) === dayKey(endDate),
  );
  const singleMember = Boolean(memberId.trim());
  const visible = useMemo(() => {
    const key = memberId.trim().toLowerCase();
    if (!key) return people;
    return people.filter(
      (person) =>
        person.email.toLowerCase() === key ||
        person.id.toLowerCase() === key ||
        person.name.toLowerCase() === key,
    );
  }, [people, memberId]);
  // Multi-day range: counts are person-days (events). Today/single-day: people that day.
  const present = useMemo(
    () => visible.filter((person) => workdayPresentOn(person, source)),
    [visible, source],
  );
  const absent = useMemo(
    () => visible.filter((person) => !workdayPresentOn(person, source)),
    [visible, source],
  );
  const onTime = useMemo(
    () =>
      visible.filter(
        (person) => workdayPresentOn(person, source) && arrivalOn(person, source) === "on-time",
      ),
    [visible, source],
  );
  const late = useMemo(
    () =>
      visible.filter(
        (person) => workdayPresentOn(person, source) && arrivalOn(person, source) === "late",
      ),
    [visible, source],
  );
  const early = useMemo(
    () =>
      visible.filter(
        (person) => workdayPresentOn(person, source) && departureOn(person, source) === "early",
      ),
    [visible, source],
  );
  const fullDay = useMemo(
    () =>
      visible.filter(
        (person) =>
          workdayPresentOn(person, source) &&
          arrivalOn(person, source) === "on-time" &&
          departureOn(person, source) === "on-time",
      ),
    [visible, source],
  );
  const spotlight = useMemo(() => {
    if (!memberId.trim() || visible.length === 0) return null;
    if (visible.length === 1) return visible[0];
    const ins = visible.map((person) => person.inMinutes).filter((value): value is number => value != null);
    const outs = visible.map((person) => person.outMinutes).filter((value): value is number => value != null);
    const inMinutes = ins.length ? ins.reduce((sum, value) => sum + value, 0) / ins.length : null;
    const outMinutes = outs.length ? outs.reduce((sum, value) => sum + value, 0) / outs.length : null;
    const first = visible[0];
    const arrival =
      inMinutes == null ? "missing" : inMinutes > LATE_AFTER_MIN ? "late" : "on-time";
    const departure =
      outMinutes == null
        ? "missing"
        : outMinutes < 15 * 60
          ? "early"
          : "on-time";
    return {
      ...first,
      inMinutes,
      outMinutes,
      inLabel: inMinutes == null ? "—" : formatMinutes(inMinutes),
      outLabel: outMinutes == null ? "—" : formatMinutes(outMinutes),
      arrival,
      departure,
      bioPresent: visible.some((person) => person.bioPresent),
      tivazoPresent: visible.some((person) => person.tivazoPresent),
    } satisfies WorkdayPerson;
  }, [memberId, visible]);

  const range = {
    teamId: teamId || undefined,
    memberId: memberId || undefined,
    startDate: startDate || day,
    endDate: endDate || day,
  };
  const peopleHref = (rows: WorkdayPerson[], view: "present") => {
    const pinned = peopleScopeParam(rows);
    const next = {
      startDate: range.startDate,
      endDate: range.endDate,
      memberId: range.memberId,
      view,
      ...pinned,
      teamId: pinned.ids || pinned.emails ? undefined : range.teamId,
    };
    if (source === "tivazo") return tivazoHref(next);
    return biomaticHref(next);
  };
  const pickRosterMatch = (
    pool: DashboardRosterPerson[],
    person: WorkdayPerson,
  ): DashboardRosterPerson | undefined => {
    const email = person.email.trim().toLowerCase();
    const id = person.id.trim().toLowerCase();
    const matches = pool.filter(
      (row) =>
        (email && row.email.trim().toLowerCase() === email) ||
        (id && row.id.trim().toLowerCase() === id),
    );
    if (!matches.length) return undefined;
    // Prefer the person-day that matches the chip person date, then Present, then any.
    const day = dayKey(person.date);
    const sameDay = day ? matches.filter((row) => dayKey(row.date) === day) : [];
    const ranked = (sameDay.length ? sameDay : matches).slice().sort((left, right) => {
      const lp = String(left.attendance || "").toLowerCase() === "present" ? 1 : 0;
      const rp = String(right.attendance || "").toLowerCase() === "present" ? 1 : 0;
      return rp - lp;
    });
    return ranked[0];
  };

  const focusPeople = (rows: WorkdayPerson[]): DashboardRosterPerson[] => {
    const out: DashboardRosterPerson[] = [];
    const seen = new Set<string>();
    for (const person of rows) {
      const day = dayKey(person.date);
      const who = person.email.trim().toLowerCase() || person.id.trim().toLowerCase();
      if (!who) continue;
      const stamp = day ? `${who}|${day}` : who;
      if (seen.has(stamp)) continue;
      const bioHit = pickRosterMatch(bio, person);
      const tivHit = pickRosterMatch(tivazo, person);
      const hit = bioHit || tivHit;
      if (!hit) continue;
      seen.add(stamp);
      out.push(day ? { ...hit, date: day } : hit);
    }
    return out;
  };

  const openChip = (
    id: string,
    title: string,
    hint: string,
    rows: WorkdayPerson[],
  ) => {
    setDayModal(null);
    const focus = focusPeople(rows);
    const focusStamps = new Set(
      focus.map((row) => {
        const who = row.email.trim().toLowerCase() || row.id.trim().toLowerCase();
        const day = dayKey(row.date);
        return day ? `${who}|${day}` : who;
      }).filter(Boolean),
    );
    const inFocus = (row: DashboardRosterPerson) => {
      const who = row.email.trim().toLowerCase() || row.id.trim().toLowerCase();
      if (!who) return false;
      const day = dayKey(row.date);
      if (day && focusStamps.has(`${who}|${day}`)) return true;
      // Undated snap rows still pair when focus has that person any day.
      return [...focusStamps].some((stamp) => stamp === who || stamp.startsWith(`${who}|`));
    };
    // Freeze the same scoped roster the chip counts used — prevents office-wide or
    // live-overview bleed if filters change while the dialog is open.
    setPeopleSpec({
      id,
      source: source === "all" ? "combined" : source === "bio" ? "bio" : "tivazo",
      title,
      hint,
      focus,
      pageHref: peopleHref(rows, "present"),
      bioSnap: bio.filter(inFocus),
      tivazoSnap: tivazo.filter(inFocus),
    });
  };
  const scopeFetchedPeople = (rows: WorkdayPerson[]): WorkdayPerson[] => {
    // Day fetch already sends teamId/group + q to the BFF. Re-applying an exact
    // person.team === teamId check drops valid people when id/label differ.
    let next = rows;
    const mid = memberId.trim().toLowerCase();
    if (mid) {
      next = next.filter(
        (person) =>
          person.email.toLowerCase() === mid ||
          person.id.toLowerCase() === mid ||
          person.name.toLowerCase() === mid,
      );
    }
    return uniqueWorkdayPeople(next);
  };
  const peopleForDay = (dayIso: string): WorkdayPerson[] => {
    if (singleDay && dayKey(focusedDay) === dayKey(dayIso)) {
      return period === "range" ? uniqueWorkdayPeople(visible) : visible;
    }
    const rows = visible.filter((person) => {
      const date = dayKey(person.date);
      if (date) return date === dayIso;
      // Undated live-roster rows count on the focused single day only.
      return focusedDay === dayIso;
    });
    return uniqueWorkdayPeople(rows);
  };
  const openDayModal = (dayIso: string, mode: "all" | "present" | "absent" = "all") => {
    // Do NOT call onDaySelect / setFocus — day detail is the modal alone.
    setPeopleSpec(null);
    if (dayIso > todayIso) {
      setDayModal({
        date: dayIso,
        mode,
        people: [],
        frozen: true,
        status: "upcoming",
        fetch: false,
      });
      return;
    }
    const local = peopleForDay(dayIso);
    // Parent already loaded this single focused day into bio/tivazo — trust local.
    const alreadyLoaded = singleDay && dayKey(focusedDay) === dayKey(dayIso);
    // Multi-day heatmap cells come from /dashboard/presence; always fetch that day's
    // roster with the same Source + Group/Member params so the modal matches the cell.
    const needFetch = !alreadyLoaded;
    setDayModal({
      date: dayIso,
      mode,
      people: local,
      frozen: true,
      status: needFetch ? "loading" : "ready",
      fetch: needFetch,
    });
  };

  // Fetch the clicked day's Present roster in-place (same APIs as Daily clock-ins day focus).
  const fetchDay = dayModal?.fetch ? dayModal.date : null;
  const scopeMember = memberId.trim() || undefined;
  const scopeTeam = scopeMember ? undefined : teamId || undefined;
  const dayLogs = useQuery<ListPage<DailyLogRow>>(
    fetchDay
      ? withQuery("/daily-logs", {
          startDate: fetchDay,
          endDate: fetchDay,
          all: 1,
          teamId: scopeTeam,
          q: scopeMember,
        })
      : null,
  );
  const dayActivities = useQuery<ListPage<DailyLogRow>>(
    fetchDay
      ? withQuery("/tivazo/activities", {
          startDate: fetchDay,
          endDate: fetchDay,
          all: 1,
          teamId: scopeTeam,
          group: scopeTeam,
          q: scopeMember,
        })
      : null,
  );

  useEffect(() => {
    if (!dayModal?.fetch || !fetchDay) return;
    const logsLoading = dayLogs.loading && !dayLogs.data;
    const actsLoading = dayActivities.loading && !dayActivities.data;
    if (logsLoading || actsLoading) {
      setDayModal((prev) =>
        prev && prev.date === fetchDay && prev.status !== "loading"
          ? { ...prev, status: "loading" }
          : prev,
      );
      return;
    }
    if (dayLogs.error && dayActivities.error && !dayLogs.data && !dayActivities.data) {
      setDayModal((prev) => {
        if (!prev || prev.date !== fetchDay) return prev;
        // Keep any optimistic local rows; mark error only when still empty.
        return {
          ...prev,
          status: prev.people.length ? "ready" : "error",
          fetch: false,
        };
      });
      return;
    }
    const bioRows = (dayLogs.data?.items ?? [])
      .filter((row) => onLogDay(row, fetchDay))
      .map((row) => dailyLogToRoster(row, "bio"));
    const tivazoRows = (dayActivities.data?.items ?? [])
      .filter((row) => onLogDay(row, fetchDay))
      .map((row) => dailyLogToRoster(row, "tivazo"));
    const sourceBio = source === "tivazo" ? [] : bioRows;
    const sourceTivazo = source === "bio" ? [] : tivazoRows;
    const merged = scopeFetchedPeople(
      mergeWorkdayPeople(sourceBio, sourceTivazo, fetchDay === todayIso ? todayIso : false),
    );
    setDayModal((prev) => {
      if (!prev || prev.date !== fetchDay) return prev;
      return {
        ...prev,
        people: merged,
        status: "ready",
        fetch: false,
        frozen: true,
      };
    });
    // Intentionally keyed on fetch completion — not on visible (frozen snapshot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fetchDay,
    dayModal?.fetch,
    dayLogs.data,
    dayLogs.loading,
    dayLogs.error,
    dayActivities.data,
    dayActivities.loading,
    dayActivities.error,
    source,
    todayIso, memberId,
    teamId, ]);

  const spotlightHref = spotlight
    ? spotlight.sources.includes("bio")
      ? biomaticHref({
          startDate: range.startDate,
          endDate: range.endDate,
          view: "members",
          memberId: spotlight.id,
          ...peopleScopeParam([spotlight]),
        })
      : tivazoHref({
          startDate: range.startDate,
          endDate: range.endDate,
          memberId: spotlight.id,
          ...peopleScopeParam([spotlight]),
        })
    : undefined;

  const dayModalTitle =
    dayModal == null
      ? ""
      : (() => {
          const dayLabel = formatDayTitle(dayModal.date);
          const who =
            memberId.trim() && (spotlight?.name || visible[0]?.name || dayModal.people[0]?.name)
              ? spotlight?.name || visible[0]?.name || dayModal.people[0]?.name
              : null;
          if (dayModal.status === "upcoming") {
            return who ? `${who} · ${dayLabel}` : dayLabel;
          }
          if (who) {
            // Member scope — personal day detail, not office "view people" language.
            if (dayModal.mode === "present") return `${who} · Present · ${dayLabel}`;
            if (dayModal.mode === "absent") return `${who} · Not present · ${dayLabel}`;
            return `${who} · ${dayLabel}`;
          }
          // Team / office — people list for that day.
          if (dayModal.mode === "present") return `Present on ${dayLabel}`;
          if (dayModal.mode === "absent") return `Not present on ${dayLabel}`;
          return `Present on ${dayLabel}`;
        })();
  const dayModalFilter =
    dayModal?.mode === "present"
      ? "present"
      : dayModal?.mode === "absent"
        ? "absent"
        : "all";
  const dayModalMeta =
    dayModal == null
      ? dateLabel
      : dayModal.status === "upcoming"
        ? `${sourceName} · Upcoming`
        : dayModal.status === "loading"
          ? `${sourceName} · Loading…`
          : sourceName;

  return (
    <div className="smp-clockins">
      {spotlight && spotlightHref ? (
          <Link href={spotlightHref} className="smp-clockins-spot" data-clickable="true">
            <div>
              <p className="smp-clockins-spot__name">{spotlight.name}</p>
              <p className="smp-clockins-spot__meta">
                {spotlight.email || spotlight.team} · {dateLabel}
                {visible.length > 1 ? ` · avg of ${visible.length} days` : ""}
              </p>
            </div>
            <dl className="smp-clockins-spot__times">
              <div>
                <dt>In</dt>
                <dd data-tone={spotlight.arrival}>{spotlight.inLabel}</dd>
              </div>
              <div>
                <dt>Out</dt>
                <dd data-tone={spotlight.departure}>{spotlight.outLabel}</dd>
              </div>
              <div>
                <dt>Arrival</dt>
                <dd>{spotlight.arrival === "late" ? "Late after 7:15" : spotlight.arrival === "on-time" ? "On time" : "No in"}</dd>
              </div>
              <div>
                <dt>Leave</dt>
                <dd>
                  {spotlight.departure === "early"
                    ? "Left before 3:00"
                    : spotlight.departure === "on-time"
                      ? "Till 3:00"
                      : spotlight.departure === "pending"
                        ? "Still in"
                        : "No out"}
                </dd>
              </div>
            </dl>
          </Link>
      ) : null}

      {/* Team/office rollups only — single-member focus already has spotlight + period stats. */}
      {!singleMember ? (
        <>
          <div className="smp-clockins-chips" role="group" aria-label="Clock-in status">
            <Chip
              label="Present"
              hint={period === "range" ? "Person-days Present" : "Status Present"}
              value={present.length}
              tone="present"
              active={peopleSpec?.id === "present"}
              onOpen={() =>
                openChip(
                  "present",
                  `${sourceName} · Present`,
                  period === "range"
                    ? "Present person-days in this range (one row per person per day)"
                    : "Same Present rule as Biometrics / Tivazo cards",
                  present,
                )
              }
            />
            <Chip
              label="On time"
              hint={period === "range" ? "Person-days · in by 7:15" : "In by 7:15"}
              value={onTime.length}
              tone="ok"
              active={peopleSpec?.id === "on-time"}
              onOpen={() =>
                openChip(
                  "on-time",
                  `${sourceName} · On time`,
                  period === "range" ? "Person-days in by 7:15" : "In by 7:15",
                  onTime,
                )
              }
            />
            <Chip
              label="Late"
              hint={period === "range" ? "Person-days · after 7:15" : "After 7:15"}
              value={late.length}
              tone="late"
              active={peopleSpec?.id === "late"}
              onOpen={() =>
                openChip(
                  "late",
                  `${sourceName} · Late`,
                  period === "range" ? "Person-days after 7:15" : "After 7:15",
                  late,
                )
              }
            />
            <Chip
              label="Early leave"
              hint={period === "range" ? "Person-days · out before 3:00" : "Out before 3:00"}
              value={early.length}
              tone="early"
              active={peopleSpec?.id === "early"}
              onOpen={() =>
                openChip(
                  "early",
                  `${sourceName} · Early leave`,
                  period === "range" ? "Person-days out before 3:00" : "Out before 3:00",
                  early,
                )
              }
            />
            <Chip
              label="Full day"
              hint={period === "range" ? "Person-days · full day" : "In by 7:15 · till 3:00"}
              value={fullDay.length}
              active={peopleSpec?.id === "full-day"}
              onOpen={() =>
                openChip(
                  "full-day",
                  `${sourceName} · Full day`,
                  period === "range" ? "Person-days in by 7:15 and till 3:00" : "Till 3:00",
                  fullDay,
                )
              }
            />
          </div>

          <div className="smp-clockins-board" data-absent={absent.length}>
            <DashboardClockInsHeatmap
              people={visible}
              source={source}
              kind="in"
              startDate={startDate || day}
              endDate={endDate || day}
              sourceName={sourceName}
              teamId={teamId}
              memberId={memberId}
              onDayOpen={openDayModal}
              active={peopleSpec?.id === "presence" || dayModal != null}
              onOpen={() => {
                if (singleDay && focusedDay) {
                  openDayModal(focusedDay, "present");
                  return;
                }
                setDayModal(null);
                setPeopleSpec({
                  id: "presence",
                  source: source === "all" ? "combined" : source === "bio" ? "bio" : "tivazo",
                  title: `Presence · ${sourceName}`,
                  hint:
                    period === "range"
                      ? "Present person-days in this view (same rule as the Present chip)"
                      : "Present people in this view (same rule as the Present chip)",
                  focus: focusPeople(present),
                  pageHref: peopleHref(present, "present"),
                });
              }}
            />
            <div className="smp-clockins-legend">
              <span data-tone="ok">On time</span>
              <span data-tone="late">Late in</span>
              <span data-tone="early">Left early</span>
              <span className="smp-clockins-legend__hint">
                {singleDay
                  ? "Click Present or Not present to open people · Weekly off and leave excluded"
                  : "Click a day to open people in a modal · Weekly off and leave excluded"}
              </span>
            </div>
          </div>
        </>
      ) : null}

      <DashboardPeopleModal
        open={Boolean(peopleSpec)}
        spec={peopleSpec}
        bio={bio}
        tivazo={tivazo}
        dateLabel={dateLabel}
        onClose={() => setPeopleSpec(null)}
      />
      <DashboardClockInsModal
        open={Boolean(dayModal)}
        title={dayModalTitle}
        meta={dayModalMeta}
        people={dayModal?.people ?? []}
        source={source}
        initialFilter={dayModalFilter}
        eyebrow={
          dayModal?.status === "upcoming"
            ? "Upcoming"
            : memberId
              ? "Day detail"
              : "Presence"
        }
        loading={dayModal?.status === "loading"}
        emptyMessage={
          dayModal?.status === "upcoming"
            ? "Upcoming · no presence data yet for this day."
            : dayModal?.status === "error"
              ? "Could not load this day’s people. Try again."
              : "No one Present this day"
        }
        onClose={() => setDayModal(null)}
      />
    </div>
  );
}
