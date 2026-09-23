"use client";

import { PersonCell } from "@/components/data/cells";
import { Delta } from "@/components/data/StatusPill";
import type { AttentionItem, LeaderRow } from "@/lib/api";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function matchesRank(
  name: string,
  email: string,
  team: string,
  needle: string,
): boolean {
  if (!needle) return true;
  return (
    name.toLowerCase().includes(needle) ||
    email.toLowerCase().includes(needle) ||
    team.toLowerCase().includes(needle)
  );
}

export function RankMemberRow({
  rank,
  id: _id,
  name,
  email,
  team,
  value,
  delta,
  positive,
  reason,
  href,
}: {
  rank: number;
  id?: string;
  name: string;
  email: string;
  team: string;
  value: string;
  delta?: string;
  positive?: boolean;
  reason?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="smp-rank__index" aria-hidden="true">
        {rank}
      </span>
      <PersonCell name={name} email={email} />
      <span className="smp-rank__team" title={team || undefined}>
        {team || "Unassigned"}
      </span>
      <div className="smp-rank__value">
        <span>{value || "—"}</span>
        {reason ? <span className="smp-rank__reason">{reason}</span> : null}
        {delta && typeof positive === "boolean" ? (
          <Delta value={delta} positive={positive} />
        ) : null}
      </div>
    </>
  );
  return (
    <li className="smp-rank__row-wrap">
      {href ? (
        <Link href={href} className="smp-rank__row" data-clickable="true" prefetch={false}>
          {body}
        </Link>
      ) : (
        <div className="smp-rank__row">{body}</div>
      )}
    </li>
  );
}

export function DashboardRankingModal({
  open,
  title,
  meta,
  leaders,
  attention,
  view,
  memberHref,
  onClose,
}: {
  open: boolean;
  title: string;
  meta: string;
  leaders: LeaderRow[];
  attention: AttentionItem[];
  view: "leaders" | "attention";
  memberHref?: (id: string, email: string) => string;
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      searchRef.current?.focus();
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
  }, [open, onClose]);

  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (view === "attention") {
      return attention.filter((item) =>
        matchesRank(item.name, item.email, item.team, needle),
      );
    }
    return leaders.filter((item) =>
      matchesRank(item.name, item.email, item.team, needle),
    );
  }, [attention, leaders, needle, view]);

  if (!mounted || !open || typeof document === "undefined") return null;

  return createPortal(
    <div className="smp-coverage-layer">
      <div className="smp-coverage-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        className="smp-coverage-dialog smp-rank-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="smp-coverage-dialog__head">
          <div className="smp-coverage-dialog__intro">
            <p className="smp-coverage-dialog__eyebrow">Member ranking</p>
            <h2 id={titleId} className="smp-coverage-dialog__title">
              {title}
            </h2>
            <p className="smp-coverage-dialog__meta">{meta}</p>
          </div>
          <div className="smp-coverage-dialog__tools">
            {leaders.length + attention.length > 0 ? (
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

        <div className="smp-rank-dialog__cols" aria-hidden="true">
          <span>#</span>
          <span>Person</span>
          <span>Team</span>
          <span>{view === "attention" ? "Days absent" : "Days present"}</span>
        </div>

        {rows.length === 0 ? (
          <p className="smp-coverage-empty">
            {needle ? "No members match this search." : "No members ranked for this view."}
          </p>
        ) : (
          <ul className="smp-coverage-list smp-rank-dialog__list">
            {view === "attention"
              ? rows.map((item, index) => {
                  const row = item as AttentionItem;
                  return (
                    <RankMemberRow
                      key={row.id || `${row.email}:${index}`}
                      rank={index + 1}
                      id={row.id}
                      name={row.name}
                      email={row.email}
                      team={row.team}
                      value={row.value}
                      reason={row.reason}
                      href={memberHref?.(row.id, row.email)}
                    />
                  );
                })
              : rows.map((item, index) => {
                  const row = item as LeaderRow;
                  return (
                    <RankMemberRow
                      key={row.id || `${row.email}:${index}`}
                      rank={index + 1}
                      id={row.id}
                      name={row.name}
                      email={row.email}
                      team={row.team}
                      value={row.value}
                      delta={row.delta}
                      positive={row.positive}
                      href={memberHref?.(row.id, row.email)}
                    />
                  );
                })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
