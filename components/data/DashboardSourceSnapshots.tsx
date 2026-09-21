"use client";

import type { BiomaticSummary, TivazoSummary } from "@/lib/api";
import {
  bioMemberHref,
  dashboardSourceHref,
  tivazoMemberHref,
} from "@/lib/dashboard-links";
import {
  PauseCircle,
  UserCheck,
  UserMinus,
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
  href: string;
};

function SourcePanel({
  title,
  href,
  stats,
  loading,
  skeletonCount,
  meta,
}: {
  title: string;
  href: string;
  stats: MiniStat[];
  loading: boolean;
  skeletonCount: number;
  meta: string;
}) {
  return (
    <section className="smp-panel smp-dashboard-panel smp-dashboard-source" aria-label={title}>
      <header className="smp-panel__head">
        <div>
          <h2 className="smp-panel__title">{title}</h2>
          <p className="smp-panel__meta">{meta}</p>
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
              <Link
                key={stat.label}
                href={stat.href}
                className="smp-stat-card smp-dashboard-source-stat"
                data-interactive="true"
                {...(stat.tone ? { "data-tone": stat.tone } : {})}
                aria-label={`${stat.label}: ${stat.value}. Open ${title} ${stat.label.toLowerCase()}.`}
              >
                <span className="smp-stat-card__icon" aria-hidden="true">
                  <stat.icon size={16} strokeWidth={2} />
                </span>
                <div className="smp-stat-card__body">
                  <span className="smp-stat-card__label">{stat.label}</span>
                  <p className="smp-stat-card__value">{stat.value}</p>
                </div>
              </Link>
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
  dateRangeLabel,
  startDate,
  endDate,
  teamId,
  memberId,
  emails,
  bioMemberId,
  tivazoMemberId,
}: {
  biomatic: BiomaticSummary | null;
  tivazo: TivazoSummary | null;
  biomaticLoading: boolean;
  tivazoLoading: boolean;
  dateRangeLabel: string;
  startDate: string;
  endDate: string;
  teamId: string;
  memberId: string;
  emails: string[];
  bioMemberId: string;
  tivazoMemberId: string;
}) {
  const extras = {
    startDate,
    endDate,
    teamId: teamId || undefined,
    memberId: memberId || undefined,
    emails: memberId || teamId ? emails : undefined,
  };
  const dates = { startDate, endDate };
  const bioHref = (view: string) =>
    memberId && bioMemberId
      ? bioMemberHref(bioMemberId, dates)
      : dashboardSourceHref("/biomatic", view, extras);
  const tivazoHref = (view: string) =>
    memberId && tivazoMemberId
      ? tivazoMemberHref(tivazoMemberId)
      : dashboardSourceHref("/tivazo", view, extras);

  const biomaticStats: MiniStat[] = biomatic
    ? [
        {
          label: "Present",
          value: biomatic.presentMembers,
          icon: UserCheck,
          tone: "green",
          href: bioHref("present"),
        },
        {
          label: "Leave",
          value: biomatic.leaveMembers,
          icon: Users,
          tone: "amber",
          href: bioHref("leave"),
        },
        {
          label: "Absent",
          value: biomatic.absentMembers,
          icon: UserX,
          tone: "rose",
          href: bioHref("absent"),
        },
        {
          label: "Total",
          value: biomatic.totalMembers,
          icon: Users,
          tone: "blue",
          href: bioHref("members"),
        },
      ]
    : [];

  const tivazoStats: MiniStat[] = tivazo
    ? [
        {
          label: "Present",
          value: tivazo.presentMembers,
          icon: UserCheck,
          tone: "blue",
          href: tivazoHref("present"),
        },
        {
          label: "Active",
          value: tivazo.activeMembers,
          icon: UserCheck,
          tone: "green",
          href: tivazoHref("active"),
        },
        {
          label: "Idle",
          value: tivazo.idleMembers,
          icon: PauseCircle,
          tone: "orange",
          href: tivazoHref("idle"),
        },
        {
          label: "Offline",
          value: tivazo.offlineMembers,
          icon: UserMinus,
          tone: "amber",
          href: tivazoHref("offline"),
        },
        {
          label: "Absent",
          value: tivazo.absentMembers,
          icon: UserX,
          tone: "rose",
          href: tivazoHref("absent"),
        },
      ]
    : [];

  return (
    <div className="smp-dashboard-sources">
      <SourcePanel
        title="Biometrics"
        href={bioHref("members")}
        stats={biomaticStats}
        loading={biomaticLoading}
        skeletonCount={4}
        meta={dateRangeLabel}
      />
      <SourcePanel
        title="Tivazo"
        href={tivazoHref("total")}
        stats={tivazoStats}
        loading={tivazoLoading}
        skeletonCount={5}
        meta={dateRangeLabel}
      />
    </div>
  );
}
