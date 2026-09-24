"use client";

import { StatusPill } from "@/components/data/StatusPill";
import type { DashboardRosterPerson } from "@/lib/api";
import { pairRosterPeople, type PairedPerson } from "@/lib/dashboard-links";
import { biomaticHref, recordHref, tivazoHref } from "@/lib/href";
import { normalizeDayStatus } from "@/lib/server/metrics";
import {
  bioToTivazoInGap,
  formatClockDuration,
  medianSignedMinutes,
  sourceInLabel,
  type ClockGap,
} from "@/lib/workday-clock";
import { Fingerprint, Search, Timer, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type PeopleModalSpec = {
  id: string;
  source: "bio" | "tivazo" | "combined";
  title: string;
  hint: string;
  focus: DashboardRosterPerson[];
  pageHref?: string;
  /** Frozen at open — avoids deferred-roster races while the dialog is up. */
  bioSnap?: DashboardRosterPerson[];
  tivazoSnap?: DashboardRosterPerson[];
};

function clock(value: string | undefined): string {
  const next = String(value || "").trim();
  return next || "—";
}

function dayStatus(row: DashboardRosterPerson | undefined): string {
  if (!row) return "Not on source";
  return normalizeDayStatus(row.attendance) || "—";
}

function matchesRow(row: PairedPerson, gap: ClockGap, needle: string): boolean {
  if (!needle) return true;
  return [
    row.name,
    row.email,
    row.team,
    dayStatus(row.bio),
    dayStatus(row.tivazo),
    gap.label,
    gap.note,
    gap.fromLabel,
    gap.toLabel,
  ].some((value) => value.toLowerCase().includes(needle));
}

function SourcePair({
  source,
  row,
  href,
}: {
  source: "bio" | "tivazo";
  row?: DashboardRosterPerson;
  href?: string;
}) {
  const enrolled = Boolean(row);
  const status = enrolled ? dayStatus(row) : source === "bio" ? "Not on Bio" : "Not on Tivazo";
  const inTime = sourceInLabel(row, source);
  const outTime = source === "bio" ? row?.endTime : row?.lastScreenshot || row?.endTime;
  const inner = (
    <>
      <span className="smp-people-pair__status">
        <StatusPill value={status} />
        {source === "tivazo" && row?.status ? (
          <span className="smp-people-pair__live">{row.status}</span>
        ) : null}
      </span>
      <span className="smp-people-pair__times" data-cols="3">
        <span data-empty={inTime ? undefined : "true"}>
          <small>In</small>
          {clock(inTime)}
        </span>
        <span data-empty={outTime ? undefined : "true"}>
          <small>Out</small>
          {clock(outTime)}
        </span>
        <span data-empty={source === "tivazo" && row?.trackedLabel ? undefined : "true"}>
          <small>Tracked</small>
          {source === "tivazo" ? clock(row?.trackedLabel) : "—"}
        </span>
      </span>
    </>
  );
  if (!href || !enrolled) {
    return (
      <span className="smp-people-pair" data-source={source} data-missing={enrolled ? undefined : "true"}>
        {inner}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="smp-people-pair"
      data-source={source}
      data-clickable="true"
      prefetch={false}
    >
      {inner}
    </Link>
  );
}

function InTimeGap({ gap }: { gap: ClockGap }) {
  return (
    <div className="smp-people-gap" data-tone={gap.tone} title={gap.note}>
      <span className="smp-people-gap__label">In-time</span>
      <span className="smp-people-gap__value">{gap.label}</span>
      {gap.tone === "missing" ? null : (
        <span className="smp-people-gap__path">
          <span>{clock(gap.fromLabel)}</span>
          <span className="smp-people-gap__sep" aria-hidden>to</span>
          <span>{clock(gap.toLabel)}</span>
        </span>
      )}
      <span className="smp-people-gap__note">{gap.note}</span>
    </div>
  );
}

export function DashboardPeopleModal({
  open,
  spec,
  bio,
  tivazo,
  dateLabel,
  onClose,
}: {
  open: boolean;
  spec: PeopleModalSpec | null;
  bio: DashboardRosterPerson[];
  tivazo: DashboardRosterPerson[];
  dateLabel: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open, spec?.title]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    const focusables = () => {
      const root = dialogRef.current;
      if (!root) return [];
      return [...root.querySelectorAll<HTMLElement>(
        'button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const rows = useMemo(
    () =>
      pairRosterPeople(spec?.focus ?? [], spec?.bioSnap ?? bio, spec?.tivazoSnap ?? tivazo).map((row) => ({
        ...row,
        gap: bioToTivazoInGap(row.bio, row.tivazo),
      })),
    [spec?.focus, spec?.bioSnap, spec?.tivazoSnap, bio, tivazo],
  );
  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      rows
        .filter((row) => matchesRow(row, row.gap, needle))
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" })),
    [rows, needle],
  );
  const both = rows.filter((row) => row.bio && row.tivazo).length;
  const bioOnly = rows.filter((row) => row.bio && !row.tivazo).length;
  const tivazoOnly = rows.filter((row) => row.tivazo && !row.bio).length;
  const pairedGaps = rows
    .map((row) => row.gap.signed)
    .filter((value): value is number => value != null);
  const medianGap = medianSignedMinutes(pairedGaps);
  const medianGapLabel =
    medianGap == null ? "—" : medianGap === 0 ? "0 min" : formatClockDuration(medianGap, true);
  const medianGapHint =
    medianGap == null
      ? "Need both in-times"
      : medianGap === 0
        ? "Same typical in-time"
        : medianGap > 0
          ? "Tivazo typically after Bio"
          : "Tivazo typically before Bio";
  const sourceLabel =
    spec?.source === "bio" ? "Biometrics" : spec?.source === "tivazo" ? "Tivazo" : "Combined";

  if (!mounted || !open || !spec || typeof document === "undefined") return null;

  return createPortal(
    <div className="smp-coverage-layer">
      <div className="smp-coverage-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className="smp-coverage-dialog smp-people-dialog smp-people-dialog--dense"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="smp-coverage-dialog__head">
          <div className="smp-coverage-dialog__intro">
            <p className="smp-coverage-dialog__eyebrow">{sourceLabel}</p>
            <h2 id={titleId} className="smp-coverage-dialog__title">
              {spec.title}
            </h2>
            <p className="smp-coverage-dialog__meta">
              {spec.hint} · {dateLabel} · {rows.length}{" "}
              {rows.some((row) => row.date)
                ? rows.length === 1
                  ? "person-day"
                  : "person-days"
                : rows.length === 1
                  ? "person"
                  : "people"}
            </p>
          </div>
          <div className="smp-coverage-dialog__tools">
            {rows.length > 0 ? (
              <label className="smp-coverage-search" htmlFor={searchId}>
                <Search size={14} strokeWidth={1.75} />
                <input
                  id={searchId}
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Filter by name, team, or in-time"
                  autoComplete="off"
                />
              </label>
            ) : null}
            {spec.pageHref ? (
              <Link className="smp-dashboard-source__link" href={spec.pageHref}>
                Open page
              </Link>
            ) : null}
            <button type="button" className="smp-icon-btn" aria-label="Close" onClick={onClose}>
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="smp-coverage-summary smp-people-dialog__summary">
          <div className="smp-coverage-stat">
            <span className="smp-coverage-stat__value">{rows.length}</span>
            <span className="smp-coverage-stat__label">In this card</span>
            <span className="smp-coverage-stat__hint">
              {rows.some((row) => row.date) ? "Same person-days as the chip count" : "Same people as the dashboard count"}
            </span>
          </div>
          <div className="smp-coverage-stat" data-source="biometrics">
            <span className="smp-coverage-stat__value">{both}</span>
            <span className="smp-coverage-stat__label">
              <Fingerprint size={13} strokeWidth={1.75} />
              On both
            </span>
            <span className="smp-coverage-stat__hint">{bioOnly} Bio only</span>
          </div>
          <div className="smp-coverage-stat" data-source="tivazo">
            <span className="smp-coverage-stat__value">{tivazoOnly + both}</span>
            <span className="smp-coverage-stat__label">
              <Users size={13} strokeWidth={1.75} />
              On Tivazo
            </span>
            <span className="smp-coverage-stat__hint">{tivazoOnly} Tivazo only</span>
          </div>
          <div className="smp-coverage-stat" data-source="gap">
            <span className="smp-coverage-stat__value">{medianGapLabel}</span>
            <span className="smp-coverage-stat__label">
              <Timer size={13} strokeWidth={1.75} />
              Median in-gap
            </span>
            <span className="smp-coverage-stat__hint">
              {pairedGaps.length} paired · {medianGapHint}
            </span>
          </div>
        </div>

        <div className="smp-people-dialog__cols" aria-hidden="true">
          <span>Person</span>
          <span className="smp-people-dialog__cols-bio">Biometrics</span>
          <span className="smp-people-dialog__cols-gap">In-time gap</span>
          <span className="smp-people-dialog__cols-tivazo">Tivazo</span>
        </div>

        {visible.length === 0 ? (
          <p className="smp-coverage-empty">
            {needle ? "No people match this search." : "No people in this card for the selected range."}
          </p>
        ) : (
          <ul className="smp-coverage-list smp-people-dialog__list">
            {visible.map((row) => {
              const bioHref = row.bio?.id
                ? recordHref("/biomatic/members", row.bio.id)
                : row.email
                  ? biomaticHref({ view: "members", emails: row.email, memberId: row.bio?.id })
                  : undefined;
              const tivazoPage = row.tivazo
                ? tivazoHref({
                    memberId: row.tivazo.id,
                    emails: row.email || undefined,
                  })
                : undefined;
              const nameHref = bioHref || tivazoPage;
              return (
                <li key={row.key}>
                  <div className="smp-people-dialog__row">
                    {nameHref ? (
                      <Link href={nameHref} className="smp-people-dialog__person" prefetch={false}>
                        <span className="smp-person" data-size="md">
                          <span className="smp-person__mark" aria-hidden>
                            {(row.name || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="smp-person__copy">
                            <span className="smp-person__name">{row.name}</span>
                            <span className="smp-person__email" data-missing={row.email ? undefined : "true"}>
                              {row.date ? `${row.date} · ` : ""}
                              {row.email || "No email"}
                            </span>
                          </span>
                        </span>
                        <span className="smp-people-dialog__team">{row.team || "Unassigned"}</span>
                      </Link>
                    ) : (
                      <span className="smp-people-dialog__person">
                        <span className="smp-person" data-size="md">
                          <span className="smp-person__mark" aria-hidden>
                            {(row.name || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <span className="smp-person__copy">
                            <span className="smp-person__name">{row.name}</span>
                            <span className="smp-person__email">
                              {row.date ? `${row.date} · ` : ""}
                              {row.email || "No email"}
                            </span>
                          </span>
                        </span>
                      </span>
                    )}
                    <SourcePair source="bio" row={row.bio} href={bioHref} />
                    <InTimeGap gap={row.gap} />
                    <SourcePair source="tivazo" row={row.tivazo} href={tivazoPage} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
