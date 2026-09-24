"use client";

import { PersonCell } from "@/components/data/cells";
import { StatusPill } from "@/components/data/StatusPill";
import type { ArrivalStatus, DepartureStatus, WorkdayPerson } from "@/lib/workday-clock";
import { workdayPresentOn } from "@/lib/workday-clock";
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ClockInsFilter = "all" | "present" | "on-time" | "late" | "absent";
type ClockInsSource = "all" | "bio" | "tivazo";

function matches(person: WorkdayPerson, needle: string): boolean {
  if (!needle) return true;
  return (
    person.name.toLowerCase().includes(needle) ||
    person.email.toLowerCase().includes(needle) ||
    person.team.toLowerCase().includes(needle)
  );
}

function flagPills(person: WorkdayPerson, source: ClockInsSource) {
  const flags: string[] = [];
  const present = workdayPresentOn(person, source);
  if (present) flags.push("Present");
  if (person.arrival === "on-time") flags.push("On time");
  if (person.arrival === "late") flags.push("Late");
  if (person.departure === "early") flags.push("Early");
  if (person.departure === "on-time") flags.push("Full day");
  if (person.departure === "pending") flags.push("Still in");
  return flags;
}

function matchesFilter(
  person: WorkdayPerson,
  filter: ClockInsFilter,
  source: ClockInsSource,
): boolean {
  const present = workdayPresentOn(person, source);
  if (filter === "all") return true;
  if (filter === "present") return present;
  if (filter === "absent") return !present;
  if (filter === "on-time") return present && person.arrival === "on-time";
  if (filter === "late") return present && person.arrival === "late";
  return true;
}

function TimePair({
  source,
  inLabel,
  outLabel,
  inTone,
  outTone,
}: {
  source: "bio" | "tivazo";
  inLabel: string;
  outLabel: string;
  inTone: ArrivalStatus;
  outTone: DepartureStatus;
}) {
  return (
    <span className="smp-clockins-pair" data-source={source}>
      <span className="smp-clockins-row__time" data-tone={inTone === "missing" ? undefined : inTone}>
        {inLabel}
      </span>
      <span className="smp-clockins-row__time" data-tone={outTone === "missing" ? undefined : outTone}>
        {outLabel}
      </span>
    </span>
  );
}

const FILTERS: { id: ClockInsFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "present", label: "Present" },
  { id: "on-time", label: "On time" },
  { id: "late", label: "Late" },
  { id: "absent", label: "Not present" },
];

export function DashboardClockInsModal({
  open,
  title,
  meta,
  people,
  onClose,
  onSelect,
  source = "all",
  initialFilter = "all",
  eyebrow = "Daily clock-ins",
  loading = false,
  emptyMessage = "No one Present this day",
}: {
  open: boolean;
  title: string;
  meta: string;
  people: WorkdayPerson[];
  onClose: () => void;
  onSelect?: (person: WorkdayPerson) => void;
  source?: ClockInsSource;
  initialFilter?: ClockInsFilter;
  eyebrow?: string;
  loading?: boolean;
  emptyMessage?: string;
}) {
  const titleId = useId();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ClockInsFilter>(initialFilter);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    setFilter(initialFilter);
  }, [open, initialFilter, people]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      if (!loading) searchRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, loading]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(
    () => people.filter((person) => matchesFilter(person, filter, source)),
    [people, filter, source],
  );
  const rows = useMemo(
    () => filtered.filter((person) => matches(person, needle)),
    [needle, filtered],
  );
  const presentCount = useMemo(
    () => people.filter((person) => workdayPresentOn(person, source)).length,
    [people, source],
  );

  if (!mounted || !open || typeof document === "undefined") return null;

  const metaLine = loading
    ? `${meta} · Loading people…`
    : `${meta} · ${filtered.length} ${filtered.length === 1 ? "person" : "people"}` +
      (needle ? ` · ${rows.length} match${rows.length === 1 ? "" : "es"}` : "") +
      (!needle && people.length > 0 ? ` · ${presentCount} Present` : "");

  return createPortal(
    <div className="smp-coverage-layer">
      <div className="smp-coverage-backdrop" onClick={onClose} />
      <div
        className="smp-coverage-dialog smp-clockins-dialog smp-clockins-dialog--premium smp-clockins-dialog--dense"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading ? "true" : undefined}
      >
        <header className="smp-coverage-dialog__head">
          <div className="smp-coverage-dialog__intro">
            <p className="smp-coverage-dialog__eyebrow">{eyebrow}</p>
            <h2 id={titleId} className="smp-coverage-dialog__title">
              {title}
            </h2>
            <p className="smp-coverage-dialog__meta">{metaLine}</p>
          </div>
          <div className="smp-coverage-dialog__tools">
            {!loading && people.length > 0 ? (
              <label className="smp-coverage-search" htmlFor={searchId}>
                <Search size={14} strokeWidth={1.75} />
                <input
                  id={searchId}
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter by name, email, or team"
                  autoComplete="off"
                />
              </label>
            ) : null}
            <button type="button" className="smp-icon-btn" aria-label="Close" onClick={onClose}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="smp-clockins-filters" role="tablist" aria-label="Presence filter">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="smp-clockins-filters__btn"
              data-active={filter === item.id ? "true" : "false"}
              data-filter={item.id}
              disabled={loading}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="smp-clockins-table">
          <div className="smp-clockins-cols" aria-hidden="true">
            <span>#</span>
            <span>Person</span>
            <span>Team</span>
            <span className="smp-clockins-cols__pair" data-source="bio">
              Biometrics
              <small>
                <span>In</span>
                <span>Out</span>
              </small>
            </span>
            <span className="smp-clockins-cols__pair" data-source="tivazo">
              Tivazo
              <small>
                <span>In</span>
                <span>Out</span>
              </small>
            </span>
            <span>Status</span>
          </div>

          {loading ? (
            <div className="smp-coverage-empty" role="status" aria-live="polite">
              <p>Loading people for this day…</p>
              <div
                className="smp-dashboard-skeleton-row"
                style={{ marginTop: 12, height: 44, borderRadius: 10 }}
                aria-hidden="true"
              />
              <div
                className="smp-dashboard-skeleton-row"
                style={{ marginTop: 8, height: 44, borderRadius: 10 }}
                aria-hidden="true"
              />
              <div
                className="smp-dashboard-skeleton-row"
                style={{ marginTop: 8, height: 44, borderRadius: 10 }}
                aria-hidden="true"
              />
            </div>
          ) : rows.length === 0 ? (
            <p className="smp-coverage-empty">
              {needle
                ? "No members match this search."
                : filter === "all" || filter === "present"
                  ? emptyMessage
                  : "No people match this filter."}
            </p>
          ) : (
            <ul className="smp-coverage-list smp-clockins-list">
              {rows.map((person, index) => (
                <li key={person.date ? `${person.id}:${person.date}` : person.id || `${person.email}:${index}`}>
                  <button
                    type="button"
                    className="smp-clockins-row"
                    data-clickable={onSelect ? "true" : undefined}
                    onClick={() => onSelect?.(person)}
                  >
                    <span className="smp-rank__index" aria-hidden="true">
                      {index + 1}
                    </span>
                    <PersonCell name={person.name} email={person.email} />
                    <span
                      className="smp-clockins-row__team"
                      title={[person.team, person.designation, person.date].filter(Boolean).join(" · ")}
                    >
                      {person.team}
                      {person.date ? (
                        <small className="smp-clockins-row__role">{person.date}</small>
                      ) : person.designation ? (
                        <small className="smp-clockins-row__role">{person.designation}</small>
                      ) : null}
                    </span>
                    <TimePair
                      source="bio"
                      inLabel={person.bioInLabel}
                      outLabel={person.bioOutLabel}
                      inTone={person.bioArrival}
                      outTone={person.bioDeparture}
                    />
                    <TimePair
                      source="tivazo"
                      inLabel={person.tivazoInLabel}
                      outLabel={person.tivazoOutLabel}
                      inTone={person.tivazoArrival}
                      outTone={person.tivazoDeparture}
                    />
                    <span className="smp-clockins-row__flags">
                      {flagPills(person, source).map((flag) => (
                        <StatusPill key={flag} value={flag} />
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
