"use client";



import { dashboardMetricInfo } from "@/components/data/dashboard-metrics";

import { Delta } from "@/components/data/StatusPill";

import type { Leaderboard, TrendMetric } from "@/lib/api";

import { useState } from "react";



type RankView = "leaders" | "attention";



export function DashboardLeaderboardPanel({

  board,

  loading,

  metric,

  teamLabel,

  dateRangeLabel,

}: {

  board: Leaderboard | null;

  loading: boolean;

  metric: TrendMetric;

  teamLabel: string;

  dateRangeLabel: string;

}) {

  const [view, setView] = useState<RankView>("leaders");

  const info = dashboardMetricInfo(metric);

  const leaders = board?.leaders ?? [];

  const attention = board?.attention ?? [];



  return (

    <section className="smp-panel smp-dashboard-panel" aria-label="Performance ranking">

      <header className="smp-panel__head">

        <div>

          <h2 className="smp-panel__title">Member ranking</h2>

          <p className="smp-panel__meta">

            {info.valueLabel} · {teamLabel} · {dateRangeLabel} · Tivazo

          </p>

        </div>

        <div className="smp-segment smp-dashboard-segment" role="tablist" aria-label="Ranking view">

          <button

            type="button"

            role="tab"

            className="smp-segment__btn"

            data-active={view === "leaders" ? "true" : "false"}

            aria-selected={view === "leaders"}

            onClick={() => setView("leaders")}

          >

            Top leaders

          </button>

          <button

            type="button"

            role="tab"

            className="smp-segment__btn"

            data-active={view === "attention" ? "true" : "false"}

            aria-selected={view === "attention"}

            onClick={() => setView("attention")}

          >

            Needs attention

          </button>

        </div>

      </header>



      <div className="smp-dashboard-rank-groups" aria-busy={loading ? "true" : undefined}>

        {view === "leaders" ? (

          <div className="smp-dashboard-rank-group">

            <h3 className="smp-dashboard-rank-group__title">

              Highest {info.valueLabel.toLowerCase()}

            </h3>

            {loading && leaders.length === 0 ? (

              <ul className="smp-rank">

                {Array.from({ length: 4 }, (_, index) => (

                  <li key={index} className="smp-dashboard-skeleton-row" />

                ))}

              </ul>

            ) : leaders.length === 0 ? (

              <p className="smp-muted">No members ranked for this metric and team.</p>

            ) : (

              <ul className="smp-rank">

                {leaders.map((row, index) => (

                  <li key={row.id} className="smp-rank__row">

                    <span className="smp-rank__index" aria-hidden="true">

                      {index + 1}

                    </span>

                    <div className="smp-rank__copy">

                      <span className="smp-rank__name">{row.name}</span>

                      <span className="smp-rank__team">{row.team}</span>

                    </div>

                    <div className="smp-rank__value">

                      <span>{row.value}</span>

                      {row.delta ? (

                        <Delta value={row.delta} positive={row.positive} />

                      ) : null}

                    </div>

                  </li>

                ))}

              </ul>

            )}

          </div>

        ) : (

          <div className="smp-dashboard-rank-group" data-tone="attention">

            <h3 className="smp-dashboard-rank-group__title">

              Lowest {info.valueLabel.toLowerCase()}

            </h3>

            {loading && attention.length === 0 ? (

              <ul className="smp-rank">

                {Array.from({ length: 3 }, (_, index) => (

                  <li key={index} className="smp-dashboard-skeleton-row" />

                ))}

              </ul>

            ) : attention.length === 0 ? (

              <p className="smp-muted">No members flagged below peer average.</p>

            ) : (

              <ul className="smp-attention">

                {attention.map((item) => (

                  <li key={item.id} className="smp-attention__row">

                    <div className="smp-rank__copy">

                      <span className="smp-rank__name">{item.name}</span>

                      <span className="smp-attention__reason">{item.reason}</span>

                    </div>

                    <span className="smp-rank__value">{item.value}</span>

                  </li>

                ))}

              </ul>

            )}

          </div>

        )}

      </div>

    </section>

  );

}


