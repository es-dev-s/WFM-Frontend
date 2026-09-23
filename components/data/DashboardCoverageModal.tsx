"use client";

import { StatusPill } from "@/components/data/StatusPill";
import type { CoverageGaps, CoveragePerson } from "@/lib/api";
import { biomaticHref, emailsParam, tivazoHref } from "@/lib/href";
import { CheckCircle2, Fingerprint, GitCompareArrows, Loader2, Search, Users, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function matchesPerson(person: CoveragePerson, needle: string): boolean {
  if (!needle) return true;
  return (
    person.name.toLowerCase().includes(needle) ||
    person.email.toLowerCase().includes(needle) ||
    person.team.toLowerCase().includes(needle)
  );
}

function CoveragePersonRow({ person, href }: { person: CoveragePerson; href?: string }) {
  const initial = (person.name || "?").slice(0, 1).toUpperCase();
  const email = person.email.trim();
  const body = (
    <>
      <span className="smp-person" data-size="md">
        <span className="smp-person__mark" aria-hidden>
          {initial}
        </span>
        <span className="smp-person__copy">
          <span className="smp-person__name">{person.name}</span>
          <span
            className="smp-person__email"
            data-missing={email ? undefined : "true"}
          >
            {email || "No email to match"}
          </span>
        </span>
      </span>
      <span className="smp-coverage-row__team" title={person.team || undefined}>
        {person.team || "Unassigned"}
      </span>
      <StatusPill value={person.status} />
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="smp-coverage-row" data-clickable="true" prefetch={false}>
          {body}
        </Link>
      ) : (
        <div className="smp-coverage-row">{body}</div>
      )}
    </li>
  );
}

function CoverageColumn({
  source,
  icon: Icon,
  title,
  hint,
  people,
  total,
  searching,
  personHref,
}: {
  source: "biometrics" | "tivazo";
  icon: typeof Fingerprint;
  title: string;
  hint: string;
  people: CoveragePerson[];
  total: number;
  searching: boolean;
  personHref?: (person: CoveragePerson) => string;
}) {
  return (
    <section className="smp-coverage-col" data-source={source}>
      <header className="smp-coverage-col__head">
        <div className="smp-coverage-col__heading">
          <Icon size={15} strokeWidth={1.75} />
          <div>
            <h3 className="smp-coverage-col__title">{title}</h3>
            <p className="smp-coverage-col__hint">{hint}</p>
          </div>
        </div>
        <span className="smp-coverage-count" title={searching ? `${people.length} shown of ${total}` : undefined}>
          {searching ? `${people.length}/${total}` : total}
        </span>
      </header>
      <div className="smp-coverage-cols" aria-hidden="true">
        <span>Person</span>
        <span>Team</span>
        <span>Day</span>
      </div>
      {people.length === 0 ? (
        <p className="smp-coverage-empty">
          {searching ? "No matches in this list." : "Nobody is missing from the other source."}
        </p>
      ) : (
        <ul className="smp-coverage-list">
          {[...people]
            .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
            .map((person) => (
            <CoveragePersonRow
              key={`${source}:${person.id}:${person.email}`}
              person={person}
              href={personHref?.(person)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardCoverageModal({
  open,
  coverage,
  loading = false,
  startDate,
  endDate,
  onClose,
}: {
  open: boolean;
  coverage: CoverageGaps | null;
  loading?: boolean;
  startDate?: string;
  endDate?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const searchId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const scope = coverage?.scope || "All groups";
  const scopeKind = coverage?.memberId ? "member" : coverage?.teamId ? "team" : "all";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    setSearch("");
  }, [coverage?.scope, coverage?.teamId, coverage?.memberId]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const target =
        searchRef.current ??
        dialogRef.current?.querySelector<HTMLElement>("button, input");
      target?.focus();
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

  const bioOnly = coverage?.bioOnly ?? [];
  const tivazoOnly = coverage?.tivazoOnly ?? [];
  const linked = coverage?.linked ?? 0;
  const needle = search.trim().toLowerCase();
  const searching = Boolean(needle);
  const visibleBio = useMemo(
    () => bioOnly.filter((person) => matchesPerson(person, needle)),
    [bioOnly, needle],
  );
  const visibleTivazo = useMemo(
    () => tivazoOnly.filter((person) => matchesPerson(person, needle)),
    [tivazoOnly, needle],
  );
  const unmatched = bioOnly.length + tivazoOnly.length;

  if (!mounted || !open || typeof document === "undefined") return null;

  return createPortal(
    <div className="smp-coverage-layer">
      <div className="smp-coverage-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className="smp-coverage-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading ? "true" : undefined}
      >
        <header className="smp-coverage-dialog__head">
          <div className="smp-coverage-dialog__intro">
            <p className="smp-coverage-dialog__eyebrow">
              {scopeKind === "all" ? "Coverage" : `Coverage · ${scope}`}
            </p>
            <h2 id={titleId} className="smp-coverage-dialog__title">
              On one source only
            </h2>
            <p className="smp-coverage-dialog__meta">
              {scopeKind === "member"
                ? `Checking ${scope} only. Matched by work email against the other source.`
                : scopeKind === "team"
                  ? `People in ${scope}. Matched by work email against the other source, even if their group name differs.`
                  : "Everyone across all groups. Matched by work email. People with no email stay unmatched."}
            </p>
          </div>
          <div className="smp-coverage-dialog__tools">
            {unmatched > 0 ? (
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

        <div className="smp-coverage-summary">
          <div className="smp-coverage-stat">
            <span className="smp-coverage-stat__value">{loading && !coverage ? "—" : linked}</span>
            <span className="smp-coverage-stat__label">
              <GitCompareArrows size={13} strokeWidth={1.75} />
              On both
            </span>
            <span className="smp-coverage-stat__hint">
              {scopeKind === "member"
                ? "This person has both records"
                : scopeKind === "team"
                  ? "In this group, same email on both sources"
                  : "Same email in Biometrics and Tivazo"}
            </span>
          </div>
          <div className="smp-coverage-stat" data-source="biometrics">
            <span className="smp-coverage-stat__value">{loading && !coverage ? "—" : bioOnly.length}</span>
            <span className="smp-coverage-stat__label">
              <Fingerprint size={13} strokeWidth={1.75} />
              Biometrics only
            </span>
            <span className="smp-coverage-stat__hint">Door access, no Tivazo account</span>
          </div>
          <div className="smp-coverage-stat" data-source="tivazo">
            <span className="smp-coverage-stat__value">{loading && !coverage ? "—" : tivazoOnly.length}</span>
            <span className="smp-coverage-stat__label">
              <Users size={13} strokeWidth={1.75} />
              Tivazo only
            </span>
            <span className="smp-coverage-stat__hint">Tivazo account, no door record</span>
          </div>
        </div>

        {loading && !coverage ? (
          <div className="smp-coverage-ok" role="status">
            <Loader2 size={22} strokeWidth={1.75} className="smp-spin" />
            <strong>Updating coverage…</strong>
            <p>Matching this group against Biometrics and Tivazo.</p>
          </div>
        ) : unmatched === 0 ? (
          <div className="smp-coverage-ok" role="status">
            <CheckCircle2 size={22} strokeWidth={1.75} />
            <strong>
              {scopeKind === "member"
                ? `${scope} is on both platforms.`
                : scopeKind === "team"
                  ? `Everyone in ${scope} with an email is on both platforms.`
                  : "Everyone with an email is on both platforms."}
            </strong>
            <p>
              {scopeKind === "member"
                ? "No Biometrics-only or Tivazo-only record for this person."
                : "No Biometrics-only or Tivazo-only people to review."}
            </p>
          </div>
        ) : (
          <div className="smp-coverage-grid">
            <CoverageColumn
              source="biometrics"
              icon={Fingerprint}
              title="In Biometrics, not Tivazo"
              hint={
                scopeKind === "team"
                  ? `In ${scope} on Biometrics. No Tivazo account with this email.`
                  : "Has door access. No Tivazo account with this email."
              }
              people={visibleBio}
              total={bioOnly.length}
              searching={searching}
              personHref={(person) =>
                biomaticHref({
                  view: "members",
                  memberId: person.id,
                  emails: emailsParam([person.email]),
                  startDate,
                  endDate,
                })
              }
            />
            <CoverageColumn
              source="tivazo"
              icon={Users}
              title="In Tivazo, not Biometrics"
              hint={
                scopeKind === "team"
                  ? `In ${scope} on Tivazo. No Biometrics record with this email.`
                  : "Has a Tivazo account. No Biometrics record with this email."
              }
              people={visibleTivazo}
              total={tivazoOnly.length}
              searching={searching}
              personHref={(person) =>
                tivazoHref({
                  memberId: person.id,
                  emails: emailsParam([person.email]),
                  startDate,
                  endDate,
                })
              }
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
