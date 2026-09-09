"use client";

import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

export type ControlStat = {
  label: string;
  value: string;
  onClick?: () => void;
  active?: boolean;
};

export function ControlBar({
  stats,
  leading,
  children,
}: {
  stats: ControlStat[];
  leading?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "smp-control-bar",
        children ? "smp-control-bar--split" : undefined,
      )}
    >
      <div className="smp-control-bar__inner">
        <div className="smp-control-bar__left">
          {leading ? (
            <div className="smp-control-bar__leading">{leading}</div>
          ) : null}
          {stats.length > 0 ? (
            <div className="smp-control-bar__stats" aria-label="Totals">
              {stats.map((stat) =>
                stat.onClick ? (
                  <button
                    key={stat.label}
                    type="button"
                    className="smp-stat-inline smp-stat-inline--action"
                    data-active={stat.active ? "true" : "false"}
                    aria-pressed={stat.active ? true : undefined}
                    onClick={stat.onClick}
                  >
                    <span className="smp-stat-inline__value">{stat.value}</span>
                    <span className="smp-stat-inline__label">{stat.label}</span>
                  </button>
                ) : (
                  <div key={stat.label} className="smp-stat-inline">
                    <span className="smp-stat-inline__value">{stat.value}</span>
                    <span className="smp-stat-inline__label">{stat.label}</span>
                  </div>
                ),
              )}
            </div>
          ) : null}
        </div>
        {children ? (
          <div className="smp-control-bar__filters">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
