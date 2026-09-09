"use client";

import type { BiomaticSummary } from "@/lib/api";
import { UserCheck, UserX, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type CardTone = "green" | "rose" | "blue";

type StatCardConfig = {
  key: keyof BiomaticSummary;
  label: string;
  icon: LucideIcon;
  tone: CardTone;
};

const STAT_CARDS: StatCardConfig[] = [
  { key: "presentMembers", label: "Present", icon: UserCheck, tone: "green" },
  { key: "absentMembers", label: "Absent", icon: UserX, tone: "rose" },
  { key: "totalMembers", label: "Total Members", icon: Users, tone: "blue" },
];

export function BiomaticStatCards({ summary }: { summary: BiomaticSummary }) {
  return (
    <section className="smp-biomatic-stat-cards" aria-label="Biomatic attendance">
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
