"use client";

import type { BiomaticSummary, TivazoSummary } from "@/lib/api";
import {
  AlarmClock,
  Coffee,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

type MiniStat = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "green" | "rose" | "blue" | "orange" | "amber";
};

function SourcePanel({
  title,
  href,
  stats,
  loading,
  skeletonCount,
}: {
  title: string;
  href: string;
  stats: MiniStat[];
  loading: boolean;
  skeletonCount: number;
}) {
  return (
    <section className="smp-panel smp-dashboard-panel smp-dashboard-source" aria-label={title}>
      <header className="smp-panel__head">
        <div>
          <h2 className="smp-panel__title">{title}</h2>
          <p className="smp-panel__meta">Today&apos;s snapshot</p>
        </div>
        <Link href={href} className="smp-dashboard-source__link">
          View all
        </Link>
      </header>
      <div className="smp-dashboard-source-stats" aria-busy={loading ? "true" : undefined}>
        {loading && stats.length === 0
          ? Array.from({ length: skeletonCount }, (_, index) => (
              <article
                key={index}
                className="smp-stat-card smp-dashboard-source-stat smp-dashboard-source-stat--skeleton"
              />
            ))
          : stats.map((stat) => (
              <article
                key={stat.label}
                className="smp-stat-card smp-dashboard-source-stat"
                {...(stat.tone ? { "data-tone": stat.tone } : {})}
              >
                <span className="smp-stat-card__icon" aria-hidden="true">
                  <stat.icon size={16} strokeWidth={2} />
                </span>
                <div className="smp-stat-card__body">
                  <span className="smp-stat-card__label">{stat.label}</span>
                  <p className="smp-stat-card__value">{stat.value}</p>
                </div>
              </article>
            ))}
      </div>
    </section>
  );
}

export function DashboardSourceSnapshots({
  biomatic,
  tivazo,
  biomaticLoading,
  tivazoLoading,
}: {
  biomatic: BiomaticSummary | null;
  tivazo: TivazoSummary | null;
  biomaticLoading: boolean;
  tivazoLoading: boolean;
}) {
  const biomaticStats: MiniStat[] = biomatic
    ? [
        { label: "Present", value: biomatic.presentMembers, icon: UserCheck, tone: "green" },
        { label: "Absent", value: biomatic.absentMembers, icon: UserX, tone: "rose" },
        { label: "Total", value: biomatic.totalMembers, icon: Users, tone: "blue" },
      ]
    : [];

  const tivazoStats: MiniStat[] = tivazo
    ? [
        { label: "Active", value: tivazo.activeMembers, icon: UserCheck, tone: "green" },
        { label: "Break", value: tivazo.breakMembers, icon: Coffee, tone: "orange" },
        { label: "Late", value: tivazo.lateMembers, icon: AlarmClock, tone: "amber" },
        { label: "Absent", value: tivazo.absentMembers, icon: UserX, tone: "rose" },
      ]
    : [];

  return (
    <div className="smp-dashboard-sources">
      <SourcePanel
        title="Biomatic"
        href="/biomatic"
        stats={biomaticStats}
        loading={biomaticLoading}
        skeletonCount={3}
      />
      <SourcePanel
        title="Tivazo"
        href="/tivazo"
        stats={tivazoStats}
        loading={tivazoLoading}
        skeletonCount={4}
      />
    </div>
  );
}
