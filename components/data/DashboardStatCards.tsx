"use client";

import type { DashboardSummary } from "@/lib/api";
import { biomaticHref, type PageScope } from "@/lib/href";
import { AlarmClock, Clock, Timer, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type StatCardConfig = {
  label: string;
  icon: LucideIcon;
  tone?: "rose" | "blue" | "orange";
  value: (summary: DashboardSummary) => string;
  href?: (scope: PageScope) => string;
};

const STAT_CARDS: StatCardConfig[] = [
  {
    label: "Avg Attendance",
    icon: UserCheck,
    tone: "orange",
    value: (summary) => summary.avgAttendance,
    href: (scope) => biomaticHref({ ...scope, view: "present" }),
  },
  {
    label: "Avg Work Hour",
    icon: Clock,
    tone: "blue",
    value: (summary) => summary.avgWorkHours,
    href: (scope) => biomaticHref({ ...scope, view: "present" }),
  },
  {
    label: "Avg Clock-in",
    icon: AlarmClock,
    value: (summary) => summary.avgClockIn,
    href: (scope) => biomaticHref({ ...scope, view: "present" }),
  },
  {
    label: "Avg time loss",
    icon: Timer,
    tone: "rose",
    value: (summary) => summary.avgSourceGap || "—",
  },
];

export function DashboardStatCards({
  summary,
  scope,
}: {
  summary: DashboardSummary | null;
  scope?: PageScope;
}) {
  const next = scope ?? {};
  return (
    <section className="smp-stat-cards smp-stat-cards--dashboard" aria-label="Workspace averages">
      {STAT_CARDS.map(({ label, icon: Icon, tone, value, href }) => {
        const body = (
          <>
            <span className="smp-stat-card__icon" aria-hidden="true">
              <Icon size={18} strokeWidth={2} />
            </span>
            <div className="smp-stat-card__body">
              <span className="smp-stat-card__label">{label}</span>
              <p className="smp-stat-card__value">{summary ? String(value(summary)) : "—"}</p>
            </div>
          </>
        );
        if (href) {
          return (
            <Link
              key={label}
              href={href(next)}
              className="smp-stat-card"
              data-interactive="true"
              data-pending={summary ? undefined : "true"}
              {...(tone ? { "data-tone": tone } : {})}
              aria-label={`Open ${label}`}
            >
              {body}
            </Link>
          );
        }
        return (
          <div
            key={label}
            className="smp-stat-card"
            data-pending={summary ? undefined : "true"}
            {...(tone ? { "data-tone": tone } : {})}
            title="Average Bio↔Tivazo lag at clock-in and clock-out (Combined source only)"
          >
            {body}
          </div>
        );
      })}
    </section>
  );
}
