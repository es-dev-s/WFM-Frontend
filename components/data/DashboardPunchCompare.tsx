"use client";

import type { PunchCompare, PunchGap, PunchLane, PunchMoment } from "@/lib/api";

function peopleLabel(count: number): string {
  if (count <= 0) return "No punches";
  return `${count} ${count === 1 ? "person" : "people"}`;
}

function Cell({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta: string;
  tone: "bio" | "tivazo" | "gap" | "overall";
}) {
  return (
    <div className="smp-punch-cell" data-tone={tone}>
      <p className="smp-punch-cell__label">{label}</p>
      <p className="smp-punch-cell__value">{value}</p>
      <p className="smp-punch-cell__meta">{meta}</p>
    </div>
  );
}

function LaneCard({
  title,
  hint,
  firstLabel,
  secondLabel,
  firstTone,
  secondTone,
  lane,
}: {
  title: string;
  hint: string;
  firstLabel: string;
  secondLabel: string;
  firstTone: "bio" | "tivazo";
  secondTone: "bio" | "tivazo";
  lane: PunchLane;
}) {
  const gap: PunchGap = lane.gap;
  const first: PunchMoment = lane.first;
  const second: PunchMoment = lane.second;
  return (
    <article className="smp-punch-card">
      <header className="smp-punch-card__head">
        <h3 className="smp-punch-card__title">{title}</h3>
        <p className="smp-punch-card__hint">{hint}</p>
      </header>
      <div className="smp-punch-card__grid">
        <Cell
          label={firstLabel}
          value={first.time}
          meta={peopleLabel(first.people)}
          tone={firstTone}
        />
        <Cell label="Between" value={gap.label} meta={gap.note} tone="gap" />
        <Cell
          label={secondLabel}
          value={second.time}
          meta={peopleLabel(second.people)}
          tone={secondTone}
        />
        <Cell
          label="Overall"
          value={lane.overall.time}
          meta={peopleLabel(lane.overall.people)}
          tone="overall"
        />
      </div>
    </article>
  );
}

const EMPTY_MOMENT: PunchMoment = { time: "—", people: 0 };
const EMPTY_GAP: PunchGap = {
  label: "—",
  minutes: null,
  people: 0,
  note: "No paired punches",
};
const EMPTY_LANE: PunchLane = {
  first: EMPTY_MOMENT,
  second: EMPTY_MOMENT,
  gap: EMPTY_GAP,
  overall: EMPTY_MOMENT,
};

export const EMPTY_PUNCH_COMPARE: PunchCompare = {
  checkIn: EMPTY_LANE,
  checkOut: EMPTY_LANE,
};

export function DashboardPunchCompare({
  compare,
}: {
  compare: PunchCompare | null;
}) {
  const data = compare ?? EMPTY_PUNCH_COMPARE;
  return (
    <div className="smp-punch-compare" aria-label="Check-in and check-out comparison">
      <LaneCard
        title="Check-in"
        hint="Biometrics first, then Tivazo"
        firstLabel="Biometrics"
        secondLabel="Tivazo"
        firstTone="bio"
        secondTone="tivazo"
        lane={data.checkIn}
      />
      <LaneCard
        title="Check-out"
        hint="Tivazo first, then Biometrics"
        firstLabel="Tivazo"
        secondLabel="Biometrics"
        firstTone="tivazo"
        secondTone="bio"
        lane={data.checkOut}
      />
    </div>
  );
}
