"use client";

import type { DashboardSummary } from "@/lib/api";
import { AlarmClock, Clock, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type StatCardConfig = {
  label: string;
  hint: string;
  icon: LucideIcon;
  tone?: "rose" | "blue" | "orange";
  value: (summary: DashboardSummary) => string | number;
};

const STAT_CARDS: StatCardConfig[] = [
  {
    label: "Avg Attendance",
    hint: "Unique people across both platforms",
    icon: UserCheck,
    tone: "orange",
    value: (summary) => summary.avgAttendance,
  },
  {
    label: "Avg Work Hour",
    hint: "Tracked time for people who clocked in",
    icon: Clock,
    tone: "blue",
    value: (summary) => summary.avgWorkHours,
  },
  {
    label: "Avg Clock-in",
    hint: "Combined first punches across Biometrics and Tivazo",
    icon: AlarmClock,
    value: (summary) => summary.avgClockIn,
  },
];

export function DashboardStatCards({
  summary,
}: {
  summary: DashboardSummary | null;
}) {
  return (
    <section className="smp-stat-cards smp-stat-cards--dashboard" aria-label="Workspace averages">
      {STAT_CARDS.map(({ label, hint, icon: Icon, tone, value }) => (
        <article
          key={label}
          className="smp-stat-card"
          data-pending={summary ? undefined : "true"}
          {...(tone ? { "data-tone": tone } : {})}
        >
          <span className="smp-stat-card__icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2} />
          </span>
          <div className="smp-stat-card__body">
            <span className="smp-stat-card__label">{label}</span>
            <p className="smp-stat-card__value">{summary ? String(value(summary)) : "—"}</p>
            <p className="smp-stat-card__meta">{hint}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
