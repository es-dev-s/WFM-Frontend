"use client";

import { dashboardMetricInfo } from "@/components/data/dashboard-metrics";
import { RankMemberRow, DashboardRankingModal } from "@/components/data/DashboardRankingModal";
import type { Leaderboard, TrendMetric } from "@/lib/api";
import { emailsParam, tivazoHref } from "@/lib/href";
import { useState } from "react";

type RankView = "leaders" | "attention";

const PREVIEW = 4;

export function DashboardLeaderboardPanel({
  board,
  loading,
  metric,
  teamLabel,
  dateRangeLabel,
  startDate,
  endDate,
}: {
  board: Leaderboard | null;
  loading: boolean;
  metric: TrendMetric;
  teamLabel: string;
  dateRangeLabel: string;
  startDate?: string;
  endDate?: string;
}) {
  const [view, setView] = useState<RankView>("leaders");
  const [open, setOpen] = useState(false);
  const info = dashboardMetricInfo(metric);
  const leaders = board?.leaders ?? [];
  const attention = board?.attention ?? [];
  const leaderPreview = leaders.slice(0, PREVIEW);
  const attentionPreview = attention.slice(0, PREVIEW);
  const rows = view === "leaders" ? leaders : attention;
  const leftover = Math.max(0, rows.length - PREVIEW);
  const memberHref = (id: string, email: string) =>
    tivazoHref({
      memberId: id,
      emails: emailsParam([email]),
      startDate,
      endDate,
    });

  return (
    <section className="smp-panel smp-dashboard-panel" aria-label="Performance ranking">
      <header className="smp-panel__head">
        <div>
          <h2 className="smp-panel__title">Member ranking</h2>
          <p className="smp-panel__meta">
            {view === "attention" ? "Days absent" : info.valueLabel} · {teamLabel} · {dateRangeLabel}
          </p>
        </div>
        <div className="smp-dashboard-rank-tools">
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
          {rows.length > 0 ? (
            <button
              type="button"
              className="smp-dashboard-source__link"
              onClick={() => setOpen(true)}
            >
              See more{leftover > 0 ? ` · ${rows.length}` : ""}
            </button>
          ) : null}
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
            ) : leaderPreview.length === 0 ? (
              <p className="smp-muted">No members ranked for this metric and team.</p>
            ) : (
              <ul className="smp-rank">
                {leaderPreview.map((row, index) => (
                  <RankMemberRow
                    key={row.id || `${row.email}:${index}`}
                    rank={index + 1}
                    id={row.id}
                    name={row.name}
                    email={row.email || ""}
                    team={row.team}
                    value={row.value}
                    delta={row.delta}
                    positive={row.positive}
                    href={memberHref(row.id, row.email)}
                  />
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
            ) : attentionPreview.length === 0 ? (
              <p className="smp-muted">No members flagged below peer average.</p>
            ) : (
              <ul className="smp-rank">
                {attentionPreview.map((item, index) => (
                  <RankMemberRow
                    key={item.id || `${item.email}:${index}`}
                    rank={index + 1}
                    id={item.id}
                    name={item.name}
                    email={item.email || ""}
                    team={item.team}
                    value={item.value}
                    reason={item.reason}
                    href={memberHref(item.id, item.email)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <DashboardRankingModal
        open={open}
        title={view === "leaders" ? `Highest ${info.valueLabel.toLowerCase()}` : `Needs attention`}
        meta={`${view === "attention" ? "Days absent" : info.valueLabel} · ${teamLabel} · ${dateRangeLabel}`}
        leaders={leaders}
        attention={attention}
        view={view}
        memberHref={memberHref}
        onClose={() => setOpen(false)}
      />
    </section>
  );
}
