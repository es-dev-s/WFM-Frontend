"use client";

import { DashboardClockInsModal } from "@/components/data/DashboardClockInsModal";
import { FilterSearch } from "@/components/ui/FilterSearch";
import { FilterSelect } from "@/components/ui/FilterSelect";
import type { DashboardRosterPerson } from "@/lib/api";
import { bioMemberHref, dashboardSourceHref } from "@/lib/dashboard-links";
import {
  LATE_AFTER_MIN,
  type ClockInsFocus,
  type ClockSlot,
  type WorkdayPerson,
  buildClockSlots,
  focusTitle,
  mergeWorkdayPeople,
  peopleForFocus,
} from "@/lib/workday-clock";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function Chip({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: "ok" | "late" | "early" | "present";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="smp-clockins-chip"
      data-tone={tone}
      data-active={active ? "true" : "false"}
      onClick={onClick}
    >
      <span className="smp-clockins-chip__label">{label}</span>
      <span className="smp-clockins-chip__value">{value}</span>
    </button>
  );
}

function ClockInsChart({
  slots,
  kind,
  selectedSlot,
  onSelect,
}: {
  slots: ClockSlot[];
  kind: "in" | "out";
  selectedSlot: number | null;
  onSelect: (slot: number) => void;
}) {
  const max = Math.max(1, ...slots.map((slot) => slot.total));
  return (
    <div className="smp-clockins-chart" role="img" aria-label={kind === "in" ? "Clock-ins by time" : "Check-outs by time"}>
      {slots.map((slot) => {
        const onTimeH = Math.round((slot.onTime / max) * 100);
        const lateH = Math.round((slot.late / max) * 100);
        const earlyH = Math.round((slot.early / max) * 100);
        return (
          <button
            key={`${kind}-${slot.minutes}`}
            type="button"
            className="smp-clockins-bar"
            disabled={slot.total === 0}
            data-active={selectedSlot === slot.minutes ? "true" : undefined}
            data-late={kind === "in" && slot.minutes === LATE_AFTER_MIN ? "true" : undefined}
            data-end={kind === "out" && slot.minutes === 15 * 60 ? "true" : undefined}
            title={`${slot.label}: ${slot.total} ${slot.total === 1 ? "person" : "people"}`}
            aria-label={`${slot.label}, ${slot.total} people`}
            onClick={() => onSelect(slot.minutes)}
          >
            <span className="smp-clockins-bar__stack">
              {kind === "in" ? (
                <>
                  {slot.late > 0 ? (
                    <span className="smp-clockins-bar__fill" data-tone="late" style={{ height: `${lateH}%` }} />
                  ) : null}
                  {slot.onTime > 0 ? (
                    <span className="smp-clockins-bar__fill" data-tone="ok" style={{ height: `${onTimeH}%` }} />
                  ) : null}
                </>
              ) : (
                <>
                  {slot.early > 0 ? (
                    <span className="smp-clockins-bar__fill" data-tone="early" style={{ height: `${earlyH}%` }} />
                  ) : null}
                  {slot.onTime > 0 ? (
                    <span className="smp-clockins-bar__fill" data-tone="ok" style={{ height: `${onTimeH}%` }} />
                  ) : null}
                </>
              )}
            </span>
            <span className="smp-clockins-bar__count">{slot.total || ""}</span>
            <span
              className="smp-clockins-bar__tick"
              data-hour={slot.minutes % 60 === 0 ? "true" : undefined}
              data-mark={kind === "in" && slot.minutes === LATE_AFTER_MIN ? "true" : undefined}
            >
              {slot.minutes % 60 === 0
                ? slot.hourLabel
                : kind === "in" && slot.minutes === LATE_AFTER_MIN
                  ? "7:15"
                  : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function DashboardClockIns({
  bio,
  tivazo,
  today,
  teamLabel,
  dateLabel,
  memberId = "",
  day,
}: {
  bio: DashboardRosterPerson[];
  tivazo: DashboardRosterPerson[];
  today: boolean;
  teamLabel: string;
  dateLabel: string;
  memberId?: string;
  day: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "out">("in");
  const [focus, setFocus] = useState<ClockInsFocus | null>(null);
  const [personId, setPersonId] = useState(memberId);
  const [personQuery, setPersonQuery] = useState("");

  useEffect(() => {
    setPersonId(memberId);
  }, [memberId]);

  const people = useMemo(() => mergeWorkdayPeople(bio, tivazo, today), [bio, tivazo, today]);
  const personOptions = useMemo(
    () =>
      people
        .map((person) => ({
          id: person.email || person.id,
          label: person.name,
        }))
        .filter((option, index, list) => list.findIndex((item) => item.id === option.id) === index),
    [people],
  );
  const visible = useMemo(() => {
    if (personId) {
      const key = personId.trim().toLowerCase();
      return people.filter(
        (person) =>
          person.email.toLowerCase() === key ||
          person.id.toLowerCase() === key ||
          person.name.toLowerCase() === key,
      );
    }
    const needle = personQuery.trim().toLowerCase();
    if (!needle) return people;
    return people.filter(
      (person) =>
        person.name.toLowerCase().includes(needle) ||
        person.email.toLowerCase().includes(needle) ||
        person.team.toLowerCase().includes(needle),
    );
  }, [people, personId, personQuery]);
  const present = useMemo(() => visible.filter((person) => person.inMinutes != null), [visible]);
  const onTime = useMemo(() => present.filter((person) => person.arrival === "on-time"), [present]);
  const late = useMemo(() => present.filter((person) => person.arrival === "late"), [present]);
  const early = useMemo(() => visible.filter((person) => person.departure === "early"), [visible]);
  const fullDay = useMemo(
    () => visible.filter((person) => person.arrival !== "missing" && person.departure === "on-time"),
    [visible],
  );
  const slots = useMemo(() => buildClockSlots(present, mode), [present, mode]);
  const openPeople = focus ? peopleForFocus(visible, focus) : [];
  const spotlight = personId && visible[0] ? visible[0] : null;

  const selectFocus = (next: ClockInsFocus) => {
    setFocus((current) => {
      if (current === next) return null;
      if (
        current &&
        typeof current === "object" &&
        typeof next === "object" &&
        current.kind === next.kind &&
        current.slot === next.slot
      ) {
        return null;
      }
      return next;
    });
  };

  return (
    <div className="smp-clockins">
      <div className="smp-clockins-tools">
        <FilterSelect
          label="Person"
          value={personId}
          allLabel="Everyone in this view"
          options={personOptions}
          searchable
          onChange={setPersonId}
        />
        <FilterSearch
          value={personQuery}
          onChange={(value) => {
            setPersonQuery(value);
            if (personId) setPersonId("");
          }}
          placeholder="Search name, email, or team"
        />
      </div>

      {spotlight ? (
        <article className="smp-clockins-spot">
          <div>
            <p className="smp-clockins-spot__name">{spotlight.name}</p>
            <p className="smp-clockins-spot__meta">
              {spotlight.email || spotlight.team} · {dateLabel}
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
        </article>
      ) : null}

      <div className="smp-clockins-chips" role="group" aria-label="Clock-in status">
        <Chip
          label="Present"
          value={present.length}
          tone="present"
          active={focus === "present"}
          onClick={() => selectFocus("present")}
        />
        <Chip
          label="On time"
          value={onTime.length}
          tone="ok"
          active={focus === "on-time"}
          onClick={() => selectFocus("on-time")}
        />
        <Chip
          label="Late after 7:15"
          value={late.length}
          tone="late"
          active={focus === "late"}
          onClick={() => selectFocus("late")}
        />
        <Chip
          label="Left before 3:00"
          value={early.length}
          tone="early"
          active={focus === "early"}
          onClick={() => selectFocus("early")}
        />
        <Chip
          label="Till 3:00"
          value={fullDay.length}
          active={focus === "full-day"}
          onClick={() => selectFocus("full-day")}
        />
      </div>

      <div className="smp-clockins-board">
        <div className="smp-clockins-board__head">
          <div>
            <p className="smp-dashboard-hourly-chart-title">
              {mode === "in" ? "Clock-ins by time" : "Check-outs by time"}
            </p>
            <p className="smp-clockins-rule">
              7:00 AM – 3:00 PM · On time until 7:15 · Early leave before 3:00
            </p>
          </div>
          <div className="smp-segment smp-dashboard-source-switch" role="tablist" aria-label="Punch direction">
            <button
              type="button"
              className="smp-segment__btn"
              data-active={mode === "in" ? "true" : "false"}
              onClick={() => setMode("in")}
            >
              Clock-in
            </button>
            <button
              type="button"
              className="smp-segment__btn"
              data-active={mode === "out" ? "true" : "false"}
              onClick={() => setMode("out")}
            >
              Check-out
            </button>
          </div>
        </div>
        {present.length === 0 ? (
          <p className="smp-chart-empty">
            {personId || personQuery
              ? "No punches for this person on this day."
              : "No punches for this day yet."}
          </p>
        ) : (
          <ClockInsChart
            slots={slots}
            kind={mode}
            selectedSlot={focus && typeof focus === "object" && focus.kind === mode ? focus.slot : null}
            onSelect={(slot) => selectFocus({ kind: mode, slot })}
          />
        )}
        <div className="smp-clockins-legend">
          <span data-tone="ok">On time</span>
          <span data-tone="late">Late in</span>
          <span data-tone="early">Left early</span>
          <span>{spotlight ? "Showing this person’s punches" : "Click a bar or Present to see people"}</span>
        </div>
      </div>

      <DashboardClockInsModal
        open={focus !== null}
        title={focus ? focusTitle(focus) : ""}
        meta={`${dateLabel} · ${teamLabel}`}
        people={openPeople}
        onClose={() => setFocus(null)}
        onSelect={(person: WorkdayPerson) => {
          const href = person.sources.includes("bio")
            ? bioMemberHref(person.id, { startDate: day, endDate: day })
            : dashboardSourceHref("/tivazo", "total", {
                memberId: person.email || person.id,
                startDate: day,
                endDate: day,
              });
          router.push(href);
        }}
      />
    </div>
  );
}
