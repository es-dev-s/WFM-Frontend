"use client";

import type { BiomaticSummary } from "@/lib/api";
import { Building2, Fingerprint, UserCheck, UserX, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type CardTone = "green" | "rose" | "blue" | "amber";

export type BiomaticCardId =
  | "presentMembers"
  | "leaveMembers"
  | "absentMembers"
  | "totalMembers"
  | "teams";

type StatCardConfig = {
  key: BiomaticCardId;
  label: string;
  icon: LucideIcon;
  tone: CardTone;
};

const STAT_CARDS: StatCardConfig[] = [
  { key: "presentMembers", label: "Present", icon: UserCheck, tone: "green" },
  { key: "leaveMembers", label: "Leave", icon: Fingerprint, tone: "amber" },
  { key: "absentMembers", label: "Absent", icon: UserX, tone: "rose" },
  { key: "teams", label: "Departments", icon: Building2, tone: "blue" },
  { key: "totalMembers", label: "Total Members", icon: Users, tone: "blue" },
];

export function BiomaticStatCards({
  summary,
  teams = 0,
  selected,
  onSelect,
}: {
  summary: BiomaticSummary;
  teams?: number;
  selected?: BiomaticCardId | null;
  onSelect?: (key: BiomaticCardId) => void;
}) {
  return (
    <section className="smp-biomatic-stat-cards" aria-label="Biometrics attendance">
      {STAT_CARDS.map(({ key, label, icon: Icon, tone }) => {
        const value = key === "teams" ? teams : summary[key];
        const active = selected === key;
        const clickable = Boolean(onSelect);
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
