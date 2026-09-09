"use client";

import type { TivazoSummary } from "@/lib/api";
import {
  AlarmClock,
  Coffee,
  PauseCircle,
  Timer,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type CardTone = "green" | "blue" | "purple" | "orange" | "amber" | "rose" | "teal";

type StatCardConfig = {
  key: keyof TivazoSummary;
  label: string;
  icon: LucideIcon;
  tone: CardTone;
};

const STAT_CARDS: StatCardConfig[] = [
  { key: "totalMembers", label: "Total Members", icon: Users, tone: "green" },
  { key: "activeMembers", label: "Active", icon: UserCheck, tone: "blue" },
  { key: "idleMembers", label: "Idle", icon: PauseCircle, tone: "purple" },
  { key: "breakMembers", label: "Break", icon: Coffee, tone: "orange" },
  { key: "lateMembers", label: "Late", icon: AlarmClock, tone: "amber" },
  { key: "absentMembers", label: "Absent", icon: UserX, tone: "rose" },
  { key: "avgWorkHours", label: "Avg Working Hr", icon: Timer, tone: "teal" },
];

export function TivazoStatCards({ summary }: { summary: TivazoSummary }) {
  return (
    <section className="smp-tivazo-stat-cards" aria-label="Tivazo overview">
      {STAT_CARDS.map(({ key, label, icon: Icon, tone }) => (
        <article key={key} className="smp-stat-card" data-tone={tone}>
          <span className="smp-stat-card__icon" aria-hidden="true">
            <Icon size={17} strokeWidth={2} />
          </span>
          <div className="smp-stat-card__body">
            <span className="smp-stat-card__label">{label}</span>
            <p className="smp-stat-card__value">{String(summary[key])}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
