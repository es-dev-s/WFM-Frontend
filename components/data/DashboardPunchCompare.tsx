"use client";

import { DashboardPeopleModal, type PeopleModalSpec } from "@/components/data/DashboardPeopleModal";
import type { PunchCompare, PunchGap, PunchLane, PunchMoment, DashboardRosterPerson } from "@/lib/api";
import {
  buildPunchCompareBundle,
  emptyPunchCompareFocus,
  type PunchCompareFocus,
  type PunchCompareSlot,
} from "@/lib/dashboard-scope";
import { biomaticHref, tivazoHref } from "@/lib/href";
import { useMemo, useState } from "react";

function peopleLabel(count: number, noun: string): string {
  if (count <= 0) return "No data";
  if (count === 1) {
    if (noun === "people") return "1 person";
    if (noun === "punches") return "1 punch";
    return `1 ${noun}`;
  }
  return `${count} ${noun}`;
}

function Cell({
  label,
  value,
  meta,
  tone,
  onOpen,
}: {
  label: string;
  value: string;
  meta: string;
  tone: "bio" | "tivazo" | "gap" | "overall";
  onOpen?: () => void;
}) {
  const inner = (
    <>
      <p className="smp-punch-cell__label">{label}</p>
      <p className="smp-punch-cell__value" data-empty={value === "—" ? "true" : undefined}>
        {value}
      </p>
      <p className="smp-punch-cell__meta">{meta}</p>
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        className="smp-punch-cell"
        data-tone={tone}
        data-interactive="true"
        onClick={onOpen}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="smp-punch-cell" data-tone={tone}>
      {inner}
    </div>
  );
}

function LaneCard({
  title,
  hint,
  period,
  firstLabel,
  secondLabel,
  firstTone,
  secondTone,
  lane,
  countNoun,
  onOpen,
  firstSlot,
  secondSlot,
  gapSlot,
  overallSlot,
}: {
  title: string;
  hint: string;
  period?: string;
  firstLabel: string;
  secondLabel: string;
  firstTone: "bio" | "tivazo";
  secondTone: "bio" | "tivazo";
  lane: PunchLane;
  countNoun: string;
  onOpen: (slot: PunchCompareSlot, label: string, moment: PunchMoment | PunchGap) => void;
  firstSlot: PunchCompareSlot;
  secondSlot: PunchCompareSlot;
  gapSlot: PunchCompareSlot;
  overallSlot: PunchCompareSlot;
}) {
  const gap: PunchGap = lane.gap;
  const first: PunchMoment = lane.first;
  const second: PunchMoment = lane.second;
  const canOpen = (count: number) => count > 0;
  return (
    <article className="smp-punch-card">
      <header className="smp-punch-card__head">
        <div>
          <h3 className="smp-punch-card__title">{title}</h3>
          <p className="smp-punch-card__hint">{hint}</p>
        </div>
        {period ? <p className="smp-punch-card__period">{period}</p> : null}
      </header>
      <div className="smp-punch-card__grid">
        <Cell
          label={firstLabel}
          value={first.time}
          meta={peopleLabel(first.people, countNoun)}
          tone={firstTone}
          onOpen={
            canOpen(first.people)
              ? () => onOpen(firstSlot, `${title} · ${firstLabel}`, first)
              : undefined
          }
        />
        <Cell
          label="Between"
          value={gap.label}
          meta={gap.note}
          tone="gap"
          onOpen={
            canOpen(gap.people)
              ? () => onOpen(gapSlot, `${title} · Between`, gap)
              : undefined
          }
        />
        <Cell
          label={secondLabel}
          value={second.time}
          meta={peopleLabel(second.people, countNoun)}
          tone={secondTone}
          onOpen={
            canOpen(second.people)
              ? () => onOpen(secondSlot, `${title} · ${secondLabel}`, second)
              : undefined
          }
        />
        <Cell
          label="Overall"
          value={lane.overall.time}
          meta={peopleLabel(lane.overall.people, countNoun)}
          tone="overall"
          onOpen={
            canOpen(lane.overall.people)
              ? () => onOpen(overallSlot, `${title} · Overall`, lane.overall)
              : undefined
          }
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

function slotSource(slot: PunchCompareSlot): "bio" | "tivazo" | "combined" {
  if (slot.includes("gap") || slot.includes("overall")) return "combined";
  if (slot.includes("tivazo")) return "tivazo";
  return "bio";
}

function slotPageHref(
  slot: PunchCompareSlot,
  scope: { startDate?: string; endDate?: string; teamId?: string; memberId?: string },
): string {
  // Punch cells are person-day punches — open Logs / activity, not Present members (that showed 0).
  const base = {
    startDate: scope.startDate,
    endDate: scope.endDate,
    teamId: scope.teamId,
    memberId: scope.memberId,
  };
  if (slotSource(slot) === "tivazo") {
    return tivazoHref({ ...base, view: "members" });
  }
  if (slotSource(slot) === "bio") {
    return biomaticHref({ ...base, view: "logs" });
  }
  return biomaticHref({ ...base, view: "logs" });
}

export function DashboardPunchCompare({
  compare,
  focus,
  bio = [],
  tivazo = [],
  periodLabel,
  dateLabel,
  countNoun = "people",
  startDate,
  endDate,
  teamId,
  memberId,
}: {
  compare: PunchCompare | null;
  /** Precomputed contributors matching the medians. Prefer this over rebuilding. */
  focus?: PunchCompareFocus | null;
  bio?: DashboardRosterPerson[];
  tivazo?: DashboardRosterPerson[];
  periodLabel?: string;
  dateLabel?: string;
  countNoun?: string;
  startDate?: string;
  endDate?: string;
  teamId?: string;
  memberId?: string;
}) {
  const data = compare ?? EMPTY_PUNCH_COMPARE;
  const scope = { startDate, endDate, teamId, memberId };
  const [spec, setSpec] = useState<PeopleModalSpec | null>(null);

  const resolvedFocus = useMemo(() => {
    if (focus) return focus;
    if (bio.length || tivazo.length) {
      return buildPunchCompareBundle(bio, tivazo, {
        period: countNoun === "punches" ? "range" : "day",
      }).focus;
    }
    return emptyPunchCompareFocus();
  }, [focus, bio, tivazo, countNoun]);

  const openSlot = (
    slot: PunchCompareSlot,
    title: string,
    moment: PunchMoment | PunchGap,
  ) => {
    const rows = resolvedFocus[slot] ?? [];
    if (!rows.length) return;
    const count =
      "people" in moment && typeof moment.people === "number" ? moment.people : rows.length;
    const noun = countNoun === "punches" ? "punches" : "people";
    setSpec({
      id: `punch:${slot}`,
      source: slotSource(slot),
      title,
      hint:
        countNoun === "punches"
          ? `${peopleLabel(count, "punches")} in this median · same people as the card`
          : `${peopleLabel(count, noun)} in this median · same people as the card`,
      focus: rows,
      bioSnap: bio,
      tivazoSnap: tivazo,
      pageHref: slotPageHref(slot, scope),
    });
  };

  return (
    <section className="smp-punch-block" aria-label="Check-in and check-out comparison">
      <header className="smp-punch-block__head">
        <div>
          <h3 className="smp-punch-block__title">Check-in and check-out</h3>
          <p className="smp-punch-block__hint">
            Medians of confirmed punches — rest days and unconfirmed live outs are excluded
          </p>
        </div>
      </header>
      <div className="smp-punch-compare">
        <LaneCard
          title="Check-in"
          hint="Biometrics → Tivazo"
          period={periodLabel}
          firstLabel="Biometrics"
          secondLabel="Tivazo"
          firstTone="bio"
          secondTone="tivazo"
          lane={data.checkIn}
          countNoun={countNoun}
          onOpen={openSlot}
          firstSlot="checkIn-bio"
          secondSlot="checkIn-tivazo"
          gapSlot="checkIn-gap"
          overallSlot="checkIn-overall"
        />
        <LaneCard
          title="Check-out"
          hint="Tivazo → Biometrics"
          period={periodLabel}
          firstLabel="Tivazo"
          secondLabel="Biometrics"
          firstTone="tivazo"
          secondTone="bio"
          lane={data.checkOut}
          countNoun={countNoun}
          onOpen={openSlot}
          firstSlot="checkOut-tivazo"
          secondSlot="checkOut-bio"
          gapSlot="checkOut-gap"
          overallSlot="checkOut-overall"
        />
      </div>
      <DashboardPeopleModal
        open={Boolean(spec)}
        spec={spec}
        bio={spec?.bioSnap ?? bio}
        tivazo={spec?.tivazoSnap ?? tivazo}
        dateLabel={dateLabel || periodLabel || "Selected period"}
        onClose={() => setSpec(null)}
      />
    </section>
  );
}
