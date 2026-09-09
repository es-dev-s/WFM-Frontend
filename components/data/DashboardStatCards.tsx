"use client";

import type { DashboardSummary } from "@/lib/api";
import { Clock, Coffee, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type StatCardConfig = {
  label: string;
  icon: LucideIcon;
  tone?: "rose" | "blue" | "orange";
  value: (summary: DashboardSummary) => string | number;
};

const STAT_CARDS: StatCardConfig[] = [
  {
    label: "Tivazo Teams",
    icon: UsersRound,
    value: (summary) => summary.tivazoTeams,
  },
  {
    label: "Avg Work Hour",
    icon: Clock,
    tone: "blue",
    value: (summary) => summary.avgWorkHours,
  },
  {
    label: "Avg Break Time",
    icon: Coffee,
    tone: "orange",
    value: (summary) => summary.avgBreakTime,
  },
];

export function DashboardStatCards({ summary }: { summary: DashboardSummary }) {
  return (
    <section className="smp-stat-cards smp-stat-cards--dashboard" aria-label="Workspace overview">
      {STAT_CARDS.map(({ label, icon: Icon, tone, value }) => (
        <article
          key={label}
          className="smp-stat-card"
          {...(tone ? { "data-tone": tone } : {})}
        >
          <span className="smp-stat-card__icon" aria-hidden="true">
            <Icon size={18} strokeWidth={2} />
          </span>
          <div className="smp-stat-card__body">
            <span className="smp-stat-card__label">{label}</span>
            <p className="smp-stat-card__value">{String(value(summary))}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
