"use client";

import { PersonCell } from "@/components/data/cells";
import { StatusPill } from "@/components/data/StatusPill";
import type { WorkdayPerson } from "@/lib/workday-clock";
import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function matches(person: WorkdayPerson, needle: string): boolean {
  if (!needle) return true;
  return (
    person.name.toLowerCase().includes(needle) ||
    person.email.toLowerCase().includes(needle) ||
    person.team.toLowerCase().includes(needle)
  );
}

function flagPills(person: WorkdayPerson) {
  const flags: string[] = [];
  if (person.arrival === "on-time") flags.push("On time");
  if (person.arrival === "late") flags.push("Late");
  if (person.departure === "early") flags.push("Early");
  if (person.departure === "on-time") flags.push("Full day");
  if (person.departure === "pending") flags.push("Still in");
  return flags;
}

function sourceLabel(source: "bio" | "tivazo"): string {
  return source === "bio" ? "Bio" : "Tivazo";
}

export function DashboardClockInsModal({
  open,
  title,
  meta,
  people,
  onClose,
  onSelect,
}: {
  open: boolean;
  title: string;
  meta: string;
  people: WorkdayPerson[];
  onClose: () => void;
  onSelect?: (person: WorkdayPerson) => void;
}) {
  const titleId = useId();
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
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
  }, [open, onClose]);

  const needle = search.trim().toLowerCase();
  const rows = useMemo(
    () => people.filter((person) => matches(person, needle)),
    [needle, people],
  );

  if (!mounted || !open || typeof document === "undefined") return null;

  return createPortal(
    <div className="smp-coverage-layer">
      <div className="smp-coverage-backdrop" onClick={onClose} />
      <div
        className="smp-coverage-dialog smp-clockins-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="smp-coverage-dialog__head">
          <div className="smp-coverage-dialog__intro">
            <p className="smp-coverage-dialog__eyebrow">Daily clock-ins</p>
            <h2 id={titleId} className="smp-coverage-dialog__title">
              {title}
            </h2>
            <p className="smp-coverage-dialog__meta">
              {meta} · {people.length} {people.length === 1 ? "person" : "people"}
            </p>
          </div>
          <div className="smp-coverage-dialog__tools">
            {people.length > 0 ? (
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

        <div className="smp-clockins-cols" aria-hidden="true">
          <span>#</span>
          <span>Person</span>
          <span>Team</span>
          <span>In</span>
          <span>Out</span>
          <span>Flags</span>
        </div>

        {rows.length === 0 ? (
          <p className="smp-coverage-empty">
            {needle ? "No members match this search." : "No people in this view."}
          </p>
        ) : (
          <ul className="smp-coverage-list smp-clockins-list">
            {rows.map((person, index) => (
              <li key={person.id || `${person.email}:${index}`}>
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
                    title={[person.team, person.designation].filter(Boolean).join(" · ")}
                  >
                    {person.team}
                    {person.designation ? (
                      <small className="smp-clockins-row__role">{person.designation}</small>
                    ) : null}
                  </span>
                  <span className="smp-clockins-row__time" data-tone={person.arrival}>
                    {person.inLabel}
                  </span>
                  <span className="smp-clockins-row__time" data-tone={person.departure}>
                    {person.outLabel}
                  </span>
                  <span className="smp-clockins-row__flags">
                    {flagPills(person).map((flag) => (
                      <StatusPill key={flag} value={flag} />
                    ))}
                    {person.sources.map((source) => (
                      <span key={source} className="smp-clockins-src">
                        {sourceLabel(source)}
                      </span>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
