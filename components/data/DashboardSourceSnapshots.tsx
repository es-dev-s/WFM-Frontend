"use client";

import { DashboardPeopleModal, type PeopleModalSpec } from "@/components/data/DashboardPeopleModal";
import type { BiomaticSummary, DashboardRosterPerson, FilterOption, TivazoSummary } from "@/lib/api";
import { cardPeople, isBioTeam, isTivazoTeam, sourceCardHref, type CardKind } from "@/lib/dashboard-links";
import { biomaticHref, tivazoHref, type PageScope } from "@/lib/href";
import {
  PauseCircle,
  UserCheck,
  UserMinus,
  UserX,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type MiniStat = {
  id: string;
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: "green" | "rose" | "blue" | "orange" | "amber";
  kind: CardKind;
  view: string;
};

function SourcePanel({
  title,
  href,
  stats,
  loading,
  skeletonCount,
  meta,
  activeId,
  onOpen,
}: {
  title: string;
  href: string;
  stats: MiniStat[];
  loading: boolean;
  skeletonCount: number;
  meta: string;
  activeId?: string;
  onOpen: (stat: MiniStat) => void;
}) {
  return (
    <section className="smp-panel smp-dashboard-panel smp-dashboard-source" aria-label={title}>
      <header className="smp-panel__head">
        <div>
          <h2 className="smp-panel__title">{title}</h2>
          <p className="smp-panel__meta">{meta}</p>
        </div>
        <Link className="smp-dashboard-source__link" href={href}>
          Open page
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
              <button
                key={stat.id}
                type="button"
                className="smp-stat-card smp-dashboard-source-stat"
                data-interactive="true"
                data-active={activeId === stat.id ? "true" : undefined}
                {...(stat.tone ? { "data-tone": stat.tone } : {})}
                aria-label={`View ${title} ${stat.label}: ${stat.value}`}
                onClick={() => onOpen(stat)}
              >
                <span className="smp-stat-card__icon" aria-hidden="true">
                  <stat.icon size={16} strokeWidth={2} />
                </span>
                <div className="smp-stat-card__body">
                  <span className="smp-stat-card__label">{stat.label}</span>
                  <p className="smp-stat-card__value">{stat.value}</p>
                </div>
              </button>
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
  bioPeople,
  tivazoPeople,
  bioTeams,
  tivazoGroups,
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
  bioPeople: DashboardRosterPerson[];
  tivazoPeople: DashboardRosterPerson[];
  bioTeams: FilterOption[];
  tivazoGroups: FilterOption[];
}) {
  const [spec, setSpec] = useState<PeopleModalSpec | null>(null);
  const range = { startDate, endDate, teamId, memberId };
  const bioNative = isBioTeam(teamId, bioPeople, bioTeams);
  const tivazoNative = isTivazoTeam(teamId, tivazoPeople, tivazoGroups);
  const bioLink = (view: string, kind: CardKind) =>
    sourceCardHref("bio", view, cardPeople(bioPeople, kind), { ...range, native: bioNative });
  const tivazoLink = (view: string, kind: CardKind) =>
    sourceCardHref("tivazo", view, cardPeople(tivazoPeople, kind), { ...range, native: tivazoNative });
  const homeScope: PageScope = { startDate, endDate, memberId: memberId || undefined };
  const bioHome = bioNative || memberId ? biomaticHref({ ...homeScope, teamId: bioNative ? teamId : undefined }) : bioLink("members", "all");
  const tivazoHome = tivazoNative || memberId ? tivazoHref({ ...homeScope, teamId: tivazoNative ? teamId : undefined }) : tivazoLink("members", "all");

  // Prefer live roster counts so cards match Daily clock-ins for the same people set.
  const bioPresentCount = cardPeople(bioPeople, "present").length;
  const bioLeaveCount = cardPeople(bioPeople, "leave").length;
  const bioAbsentCount = cardPeople(bioPeople, "absent").length;
  const tivazoPresentCount = cardPeople(tivazoPeople, "present").length;
  const tivazoAbsentCount = cardPeople(tivazoPeople, "absent").length;
  const tivazoActiveCount = cardPeople(tivazoPeople, "active").length;
  const tivazoIdleCount = cardPeople(tivazoPeople, "idle").length;
  const tivazoOfflineCount = cardPeople(tivazoPeople, "offline").length;
  const useBioLive = bioPeople.length > 0;
  const useTivazoLive = tivazoPeople.length > 0;

  const biomaticStats: MiniStat[] = biomatic
    ? [
        { id: "bio-present", label: "Present", value: useBioLive ? bioPresentCount : biomatic.presentMembers, icon: UserCheck, tone: "green", kind: "present", view: "present" },
        { id: "bio-leave", label: "Leave", value: useBioLive ? bioLeaveCount : biomatic.leaveMembers, icon: Users, tone: "amber", kind: "leave", view: "leave" },
        { id: "bio-absent", label: "Absent", value: useBioLive ? bioAbsentCount : biomatic.absentMembers, icon: UserX, tone: "rose", kind: "absent", view: "absent" },
        { id: "bio-total", label: "Total", value: useBioLive ? bioPeople.length : biomatic.totalMembers, icon: Users, tone: "blue", kind: "all", view: "members" },
      ]
    : [];

  const tivazoStats: MiniStat[] = tivazo
    ? [
        { id: "tivazo-present", label: "Present", value: useTivazoLive ? tivazoPresentCount : tivazo.presentMembers, icon: UserCheck, tone: "blue", kind: "present", view: "present" },
        { id: "tivazo-active", label: "Active", value: useTivazoLive ? tivazoActiveCount : tivazo.activeMembers, icon: UserCheck, tone: "green", kind: "active", view: "active" },
        { id: "tivazo-idle", label: "Idle", value: useTivazoLive ? tivazoIdleCount : tivazo.idleMembers, icon: PauseCircle, tone: "orange", kind: "idle", view: "idle" },
        { id: "tivazo-offline", label: "Offline", value: useTivazoLive ? tivazoOfflineCount : tivazo.offlineMembers, icon: UserMinus, tone: "amber", kind: "offline", view: "offline" },
        { id: "tivazo-absent", label: "Absent", value: useTivazoLive ? tivazoAbsentCount : tivazo.absentMembers, icon: UserX, tone: "rose", kind: "absent", view: "absent" },
      ]
    : [];

  const hints = useMemo(
    () => ({
      present: "Present on this source for the selected range",
      leave: "On leave for the selected range",
      absent: "Absent on this source for the selected range",
      all: "Everyone counted on this source",
      active: "Live Active on Tivazo",
      idle: "Live Idle on Tivazo",
      offline: "Live Offline on Tivazo",
    }),
    [],
  );

  return (
    <div className="smp-dashboard-sources">
      <SourcePanel
        title="Biometrics"
        href={bioHome}
        stats={biomaticStats}
        loading={biomaticLoading}
        skeletonCount={4}
        meta={dateRangeLabel}
        activeId={spec?.id}
        onOpen={(stat) => {
          const focus = cardPeople(bioPeople, stat.kind);
          setSpec({
            id: stat.id,
            source: "bio",
            title: `Biometrics · ${stat.label}`,
            hint: `${hints[stat.kind]} · ${focus.length} people`,
            focus,
            pageHref: bioLink(stat.view, stat.kind),
            bioSnap: bioPeople.slice(),
            tivazoSnap: tivazoPeople.slice(),
          });
        }}
      />
      <SourcePanel
        title="Tivazo"
        href={tivazoHome}
        stats={tivazoStats}
        loading={tivazoLoading}
        skeletonCount={5}
        meta={dateRangeLabel}
        activeId={spec?.id}
        onOpen={(stat) => {
          const focus = cardPeople(tivazoPeople, stat.kind);
          setSpec({
            id: stat.id,
            source: "tivazo",
            title: `Tivazo · ${stat.label}`,
            hint: `${hints[stat.kind]} · ${focus.length} people`,
            focus,
            pageHref: tivazoLink(stat.view, stat.kind),
            bioSnap: bioPeople.slice(),
            tivazoSnap: tivazoPeople.slice(),
          });
        }}
      />
      <DashboardPeopleModal
        open={Boolean(spec)}
        spec={spec}
        bio={bioPeople}
        tivazo={tivazoPeople}
        dateLabel={dateRangeLabel}
        onClose={() => setSpec(null)}
      />
    </div>
  );
}
