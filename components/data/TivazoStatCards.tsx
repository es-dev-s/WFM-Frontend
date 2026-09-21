"use client";

import type { TivazoSummary } from "@/lib/api";
import {
  Building2,
  PauseCircle,
  Timer,
  UserCheck,
  UserMinus,
  UserX,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type CardTone = "green" | "blue" | "purple" | "orange" | "amber" | "rose" | "teal";

export type TivazoCardId =
  | "totalMembers"
  | "presentMembers"
  | "activeMembers"
  | "idleMembers"
  | "offlineMembers"
  | "absentMembers"
  | "teams"
  | "avgWorkHours";

type StatCardConfig = {
  key: TivazoCardId;
  label: string;
  icon: LucideIcon;
  tone: CardTone;
  interactive?: boolean;
};

const STAT_CARDS: StatCardConfig[] = [
  { key: "totalMembers", label: "Total Members", icon: Users, tone: "green", interactive: true },
  { key: "presentMembers", label: "Present", icon: UserCheck, tone: "blue", interactive: true },
  { key: "teams", label: "Teams", icon: Building2, tone: "amber", interactive: true },
  { key: "activeMembers", label: "Active", icon: Timer, tone: "teal", interactive: true },
  { key: "idleMembers", label: "Idle", icon: PauseCircle, tone: "purple", interactive: true },
  { key: "offlineMembers", label: "Offline", icon: UserMinus, tone: "orange", interactive: true },
  { key: "absentMembers", label: "Absent", icon: UserX, tone: "rose", interactive: true },
  { key: "avgWorkHours", label: "Avg Working Hr", icon: Timer, tone: "teal" },
];

export function TivazoStatCards({
  summary,
  teams = 0,
  selected,
  onSelect,
}: {
  summary: TivazoSummary;
  teams?: number;
  selected?: TivazoCardId | null;
  onSelect?: (key: TivazoCardId) => void;
}) {
  return (
    <section className="smp-tivazo-stat-cards" aria-label="Tivazo overview">
      {STAT_CARDS.map(({ key, label, icon: Icon, tone, interactive }) => {
        const value = key === "teams" ? teams : summary[key];
        const active = selected === key;
        const clickable = Boolean(interactive && onSelect);
        const Tag = clickable ? "button" : "article";
        return (
          <Tag
            key={key}
            type={clickable ? "button" : undefined}
            className="smp-stat-card"
            data-tone={tone}
            data-interactive={clickable ? "true" : undefined}
            data-active={active ? "true" : undefined}
            aria-pressed={clickable ? active : undefined}
            onClick={clickable ? () => onSelect?.(key) : undefined}
          >
            <span className="smp-stat-card__icon" aria-hidden="true">
              <Icon size={17} strokeWidth={2} />
            </span>
            <div className="smp-stat-card__body">
              <span className="smp-stat-card__label">{label}</span>
              <p className="smp-stat-card__value">{String(value)}</p>
            </div>
          </Tag>
        );
      })}
    </section>
  );
}
