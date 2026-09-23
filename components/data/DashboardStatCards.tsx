"use client";

import type { DashboardSummary } from "@/lib/api";
import { biomaticHref, type PageScope } from "@/lib/href";
import { AlarmClock, Clock, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type StatCardConfig = {
  label: string;
  hint: string;
  icon: LucideIcon;
  tone?: "rose" | "blue" | "orange";
  value: (summary: DashboardSummary) => string;
  href: (scope: PageScope) => string;
};

const STAT_CARDS: StatCardConfig[] = [
  {
    label: "Avg Attendance",
    hint: "Combined Present ratio across Biometrics and Tivazo",
    icon: UserCheck,
    tone: "orange",
    value: (summary) => summary.avgAttendance,
    href: (scope) => biomaticHref({ ...scope, view: "present" }),
  },
  {
    label: "Avg Work Hour",
    hint: "Average clock-in to clock-out span across both sources",
    icon: Clock,
    tone: "blue",
    value: (summary) => summary.avgWorkHours,
    href: (scope) => biomaticHref({ ...scope, view: "present" }),
  },
  {
    label: "Avg Clock-in",
    hint: "Average first punch · one per person across both sources",
    icon: AlarmClock,
    value: (summary) => summary.avgClockIn,
    href: (scope) => biomaticHref({ ...scope, view: "present" }),
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
      {STAT_CARDS.map(({ label, hint, icon: Icon, tone, value, href }) => (
        <Link
          key={label}
          href={href(next)}
          className="smp-stat-card"
          data-interactive="true"
          data-pending={summary ? undefined : "true"}
          {...(tone ? { "data-tone": tone } : {})}
          aria-label={`Open ${label}`}
        >
          <span className="smp-stat-card__icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2} />
          </span>
          <div className="smp-stat-card__body">
            <span className="smp-stat-card__label">{label}</span>
            <p className="smp-stat-card__value">{summary ? String(value(summary)) : "—"}</p>
            <p className="smp-stat-card__meta">{hint}</p>
          </div>
        </Link>
      ))}
    </section>
  );
}
