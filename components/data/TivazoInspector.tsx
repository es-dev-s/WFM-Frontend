"use client";

import {
  PersonCell,
  RecordFacts,
  activityFactGroups,
  visibleFactGroups,
} from "@/components/data/cells";
import { QueryState } from "@/components/data/QueryState";
import { StatusPill } from "@/components/data/StatusPill";
import type { DailyLogRow } from "@/lib/api";
import { ChevronLeft, X } from "lucide-react";
import { useEffect, useRef } from "react";

export function TivazoInspector({
  id,
  open,
  view,
  count,
  rows,
  detail,
  loading,
  loadingMore = false,
  hasMore = false,
  onNearEnd,
  error,
  onRetry,
  onClose,
  onBack,
  onSelect,
}: {
  id?: string;
  open: boolean;
  view: "present" | "detail";
  count: string;
  rows: DailyLogRow[];
  detail: DailyLogRow | null;
  loading: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onNearEnd?: () => void;
  error: Error | null;
  onRetry: () => void;
  onClose: () => void;
  onBack?: () => void;
  onSelect?: (row: DailyLogRow) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const groups = detail ? visibleFactGroups(activityFactGroups(detail)) : [];
  const title = view === "present" ? "Present" : detail?.name || "Details";

  useEffect(() => {
    if (!open || view !== "present" || !onNearEnd || !hasMore || loadingMore) {
      return;
    }
    const root = bodyRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onNearEnd();
      },
      { root, rootMargin: "240px 0px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [open, view, onNearEnd, hasMore, loadingMore, rows.length]);

  if (!open) return null;

  return (
    <aside
      id={id}
      className="smp-inspector"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smp-inspector-title"
    >
      <header className="smp-inspector__head">
        <div className="smp-inspector__head-start">
          {view === "detail" && onBack ? (
            <button
              type="button"
              className="smp-icon-btn"
              aria-label="Back to present"
              onClick={onBack}
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </button>
          ) : null}
          <div className="smp-inspector__title-block">
            <h2 id="smp-inspector-title" className="smp-inspector__title">
              {title}
            </h2>
            {view === "present" ? (
              <p className="smp-inspector__meta">{count} people</p>
            ) : detail ? (
              <p className="smp-inspector__meta">{detail.date}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="smp-icon-btn"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className="smp-inspector__body" ref={bodyRef}>
        {view === "present" ? (
          <QueryState
            loading={loading && rows.length === 0}
            error={rows.length ? null : error}
            onRetry={onRetry}
            label="present people"
          >
            {rows.length === 0 ? (
              <p className="smp-inspector__empty">
                No one is present in this range.
              </p>
            ) : (
              <>
                <ul className="smp-inspector__list">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="smp-inspector__row"
                        onClick={() => onSelect?.(row)}
                      >
                        <PersonCell
                          name={row.name}
                          email={row.email}
                          avatarUrl={row.avatarUrl}
                        />
                        <div className="smp-inspector__aside">
                          <span className="smp-inspector__times">
                            {row.inTime}
                            <span aria-hidden="true"> – </span>
                            {row.outTime}
                          </span>
                          <span className="smp-inspector__sub">
                            {row.employeeId || "—"}
                            {row.group && row.group !== "—"
                              ? ` · ${row.group}`
                              : ""}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                  <li
                    ref={sentinelRef}
                    className="smp-inspector__sentinel"
                    aria-hidden
                  />
                </ul>
                {loadingMore ? (
                  <p className="smp-inspector__more">Loading</p>
                ) : null}
              </>
            )}
          </QueryState>
        ) : (
          <QueryState
            loading={loading && !detail}
            error={detail ? null : error}
            onRetry={onRetry}
            label="activity"
          >
            {detail ? (
              <div className="smp-inspector__detail">
                <div className="smp-inspector__person">
                  <PersonCell
                    name={detail.name}
                    email={detail.email}
                    avatarUrl={detail.avatarUrl}
                    size="lg"
                  />
                  <div className="smp-inspector__chips">
                    <StatusPill value={detail.status} />
                    {detail.employeeId ? (
                      <span className="smp-id-cell">{detail.employeeId}</span>
                    ) : null}
                  </div>
                </div>
                {groups.map((group) => (
                  <section
                    key={group.title}
                    className="smp-inspector__group"
                  >
                    <h3 className="smp-inspector__group-title">{group.title}</h3>
                    <RecordFacts items={group.items} />
                  </section>
                ))}
              </div>
            ) : null}
          </QueryState>
        )}
      </div>
    </aside>
  );
}
