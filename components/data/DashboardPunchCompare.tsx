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
import { useEffect, useMemo, useState } from "react";

function peopleLabel(count: number, noun: string): string {
  if (count <= 0) return "No data";
  if (count === 1) {
    if (noun === "people") return "1 person";
    if (noun === "punches") return "1 punch";
    return `1 ${noun}`;
  }
  return `${count} ${noun}`;
}

function uniqueByPerson(rows: DashboardRosterPerson[]): DashboardRosterPerson[] {
  const seen = new Set<string>();
  const out: DashboardRosterPerson[] = [];
  for (const row of rows) {
    const key = row.email.trim().toLowerCase() || row.id.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function Cell({
  label,
  value,
  meta,
  tone,
  onOpen,
  ariaDetail,
}: {
  label: string;
  value: string;
  meta: string;
  tone: "bio" | "tivazo" | "gap" | "overall";
  onOpen?: () => void;
  ariaDetail?: string;
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
        aria-label={ariaDetail || `View ${label}: ${value} · ${meta}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="smp-punch-cell" data-tone={tone} data-static="true">
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
          ariaDetail={`${title} · ${firstLabel}: ${first.time}, ${peopleLabel(first.people, countNoun)}. Open people.`}
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
          ariaDetail={
            canOpen(gap.people)
              ? `${title} · Between: ${gap.label}, ${gap.note}. Open paired people.`
              : undefined
          }
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
          ariaDetail={`${title} · ${secondLabel}: ${second.time}, ${peopleLabel(second.people, countNoun)}. Open people.`}
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
          ariaDetail={`${title} · Overall: ${lane.overall.time}, ${peopleLabel(lane.overall.people, countNoun)}. Open people.`}
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
  avgGap: "—",
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
  const base = {
    startDate: scope.startDate,
    endDate: scope.endDate,
    teamId: scope.teamId,
    memberId: scope.memberId,
  };
  if (slotSource(slot) === "tivazo") {
    return tivazoHref({ ...base, view: "members" });
  }
  return biomaticHref({ ...base, view: "logs" });
}

function slotHint(slot: PunchCompareSlot, count: number, countNoun: string): string {
  const label = peopleLabel(count, "people");
  if (slot.includes("gap")) {
    return `${label} with both punches · same paired set as Between`;
  }
  if (slot.includes("overall")) {
    return `${label} in the overall median · earliest in / latest confirmed out`;
  }
  if (slot.includes("bio")) {
    return `${label} on Biometrics · same set as the card`;
  }
  return `${label} on Tivazo · same set as the card`;
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

  useEffect(() => {
    setSpec(null);
  }, [teamId, memberId, startDate, endDate, countNoun, periodLabel]);

  const resolvedFocus = useMemo(() => {
    if (focus) return focus;
    if (bio.length || tivazo.length) {
      return buildPunchCompareBundle(bio, tivazo, {
        period: String(periodLabel || "").startsWith("Average") ? "range" : "day",
      }).focus;
    }
    return emptyPunchCompareFocus();
  }, [focus, bio, tivazo, periodLabel]);

  const openSlot = (
    slot: PunchCompareSlot,
    title: string,
    moment: PunchMoment | PunchGap,
  ) => {
    const raw = resolvedFocus[slot] ?? [];
    const rows = uniqueByPerson(raw);
    if (!rows.length) return;
    const count =
      "people" in moment && typeof moment.people === "number" && moment.people > 0
        ? moment.people
        : rows.length;
    const focusKeys = new Set(
      rows.map((row) => row.email.trim().toLowerCase() || row.id.trim().toLowerCase()).filter(Boolean),
    );
    const inFocus = (row: DashboardRosterPerson) => {
      const key = row.email.trim().toLowerCase() || row.id.trim().toLowerCase();
      return Boolean(key && focusKeys.has(key));
    };
    setSpec({
      id: `punch:${slot}`,
      source: slotSource(slot),
      title,
      hint: slotHint(slot, count, countNoun),
      focus: rows,
      // Freeze the scoped roster slice used for this card (Group/Member/range).
      bioSnap: bio.filter(inFocus),
      tivazoSnap: tivazo.filter(inFocus),
      pageHref: slotPageHref(slot, scope),
    });
  };

  return (
    <section className="smp-punch-block" aria-label="Check-in and check-out comparison">
      <header className="smp-punch-block__head">
        <div>
          <h3 className="smp-punch-block__title">Check-in and check-out</h3>
          <p className="smp-punch-block__sub">Click a card to see the people behind that median</p>
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
