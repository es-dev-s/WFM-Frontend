"use client";



import { dashboardMetricInfo, DASHBOARD_TREND_TABS } from "@/components/data/dashboard-metrics";

import { TrendChart } from "@/components/data/TrendChart";

import { type TrendMetric, type TrendPoint } from "@/lib/api";



export function DashboardTrendPanel({

  metric,

  onMetricChange,

  points,

  loading,

  teamLabel,

  dateRangeLabel,

}: {

  metric: TrendMetric;

  onMetricChange: (metric: TrendMetric) => void;

  points: TrendPoint[] | null;

  loading: boolean;

  teamLabel: string;

  dateRangeLabel: string;

}) {

  const info = dashboardMetricInfo(metric);



  return (

    <section className="smp-panel smp-dashboard-panel" aria-label="Trend">

      <header className="smp-panel__head">

        <div>

          <h2 className="smp-panel__title">{info.title}</h2>

          <p className="smp-panel__meta">

            {info.description} · {teamLabel} · {dateRangeLabel} · Tivazo

          </p>

        </div>

        <div className="smp-chip-row smp-dashboard-tabs" role="tablist" aria-label="Trend metric">

          {DASHBOARD_TREND_TABS.map((tab) => (

            <button

              key={tab.metric}

              type="button"

              role="tab"

              className="smp-chip"

              data-active={metric === tab.metric ? "true" : "false"}

              aria-selected={metric === tab.metric}

              onClick={() => onMetricChange(tab.metric)}

            >

              {tab.label}

            </button>

          ))}

        </div>

      </header>

      <div className="smp-dashboard-chart" aria-busy={loading ? "true" : undefined}>

        {loading && !points?.length ? (

          <div className="smp-dashboard-chart__skeleton" />

        ) : (

          <TrendChart points={points ?? []} label={info.title} metric={metric} />

        )}

      </div>

    </section>

  );

}


