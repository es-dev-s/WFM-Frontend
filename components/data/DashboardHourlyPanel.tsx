"use client";

import { HourlyChart } from "@/components/data/HourlyChart";
import { QueryState } from "@/components/data/QueryState";
import type { HourlyPoint } from "@/lib/api";

export function DashboardHourlyPanel({
  points,
  loading,
  error,
  onRetry,
  teamLabel,
  dateLabel,
}: {
  points: HourlyPoint[] | null;
  loading: boolean;
  error: Error | null;
  onRetry?: () => void;
  teamLabel: string;
  dateLabel: string;
}) {
  return (
    <section
      className="smp-panel smp-dashboard-panel smp-dashboard-panel--hourly"
      aria-label="Hourly clock-ins"
    >
      <header className="smp-panel__head">
        <div>
          <h2 className="smp-panel__title">Hourly clock-ins</h2>
          <p className="smp-panel__meta">
            When members clocked in on {dateLabel} · {teamLabel} · Tivazo
          </p>
        </div>
      </header>
      {loading && !points?.length ? (
        <div className="smp-dashboard-chart smp-dashboard-chart--hourly" aria-busy="true">
          <div className="smp-dashboard-chart__skeleton smp-dashboard-chart__skeleton--hourly" />
        </div>
      ) : error ? (
        <QueryState loading={false} error={error} onRetry={onRetry} label="hourly clock-ins" />
      ) : (
        <div className="smp-dashboard-chart smp-dashboard-chart--hourly">
          <HourlyChart points={points ?? []} />
        </div>
      )}
    </section>
  );
}
