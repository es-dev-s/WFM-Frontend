"use client";

import {
  PersonCell,
  RecordFacts,
  isEmptyFactValue,
  type FactGroup,
  type FactItem,
  visibleFactGroups,
} from "@/components/data/cells";
import type { ReactNode } from "react";

export type RecordCount = {
  label: string;
  value: string;
};

export function RecordHero({
  name,
  email,
  avatarUrl,
  meta,
  counts,
}: {
  name: string;
  email?: string;
  avatarUrl?: string;
  meta?: ReactNode;
  counts?: RecordCount[];
}) {
  return (
    <header className="smp-record__hero">
      <div className="smp-record__hero-identity">
        <PersonCell name={name} email={email} avatarUrl={avatarUrl} size="lg" />
        {meta ? <div className="smp-record__hero-meta">{meta}</div> : null}
      </div>
      {counts && counts.length > 0 ? (
        <dl className="smp-record__hero-counts" aria-label="Totals">
          {counts.map((item) => (
            <div key={item.label} className="smp-stat-inline">
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

export function RecordProfile({
  name,
  email,
  avatarUrl,
  meta,
  counts,
  facts,
}: {
  name: string;
  email?: string;
  avatarUrl?: string;
  meta?: ReactNode;
  counts?: RecordCount[];
  facts?: FactItem[];
}) {
  const items = (facts ?? []).filter(
    (item) => !isEmptyFactValue(item.value, item.keep),
  );

  return (
    <header className="smp-profile">
      <div className="smp-profile__top">
        <div className="smp-record__hero-identity">
          <PersonCell name={name} email={email} avatarUrl={avatarUrl} size="lg" />
          {meta ? <div className="smp-record__hero-meta">{meta}</div> : null}
        </div>
        {counts && counts.length > 0 ? (
          <dl className="smp-record__hero-counts" aria-label="Totals">
            {counts.map((item) => (
              <div key={item.label} className="smp-stat-inline">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      {items.length > 0 ? <RecordFacts items={items} /> : null}
    </header>
  );
}

export function RecordSheet({ groups }: { groups: FactGroup[] }) {
  const visible = visibleFactGroups(groups);
  if (visible.length === 0) return null;

  return (
    <section className="smp-sheet">
      {visible.map((group) => (
        <div key={group.title} className="smp-sheet__group">
          <h3 className="smp-sheet__title">{group.title}</h3>
          <RecordFacts items={group.items} />
        </div>
      ))}
    </section>
  );
}

export function RecordTable({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="smp-sheet smp-sheet--table">
      <div className="smp-sheet__head">
        <h3 className="smp-sheet__title">{title}</h3>
      </div>
      {children}
    </section>
  );
}
