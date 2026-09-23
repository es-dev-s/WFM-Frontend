"use client";

import { buildSmoothAreaPath, buildSmoothPath } from "@/components/data/chart-curve";
import { ChartHoverOverlay } from "@/components/data/ChartHoverOverlay";
import { compactIsoDay, formatAxisValue, niceTicks, tickY } from "@/components/data/chart-axis";
import { pickNearestIndex } from "@/components/data/useChartWidth";
import { formatDisplayDate } from "@/lib/datetime";
import { formatMinutes } from "@/lib/workday-clock";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

const VIEW_W = 1000;
const HEIGHT = 200;
const PAD_LEFT = 12;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;

export type ClockInsHourlyPoint = {
  hour: number;
  label: string;
  value: number;
  share: number;
  exact?: string;
};

export type ClockInsDailyPoint = {
  day: string;
  label: string;
  value: number;
  typicalIn: number | null;
};

function compactHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

function formatShare(share: number): string {
  return `${Number.isInteger(share) ? share.toFixed(0) : share.toFixed(1)}%`;
}

function weekdayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function ClockInsSeriesChart({
  mode,
  hourly = [],
  daily = [],
  sourceName,
  periodLabel,
  memberView = false,
}: {
  mode: "hourly" | "daily";
  hourly?: ClockInsHourlyPoint[];
  daily?: ClockInsDailyPoint[];
  sourceName: string;
  periodLabel: string;
  memberView?: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const rafPickRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const seriesKey =
    mode === "hourly"
      ? `h:${hourly.map((p) => `${p.hour}:${p.value}`).join(",")}`
      : `d:${daily.map((p) => `${p.day}:${p.value}`).join(",")}`;

  useEffect(() => {
    setActiveIndex(null);
  }, [seriesKey]);

  const geometry = useMemo(() => {
    if (mode === "hourly") {
      const byHour = new Map(hourly.map((point) => [point.hour, point]));
      const filled = Array.from({ length: 24 }, (_, hour) => {
        const existing = byHour.get(hour);
        return {
          key: String(hour),
          axis: compactHourLabel(hour),
          value: existing?.value ?? 0,
          share: existing?.share ?? 0,
          exact: existing?.exact,
          day: "",
          typicalIn: null as number | null,
        };
      });
      const total = filled.reduce((sum, point) => sum + point.value, 0);
      const series = filled.map((point) => ({
        ...point,
        share: point.share || (total ? Math.round((point.value / total) * 1000) / 10 : 0),
      }));
      const values = series.map((point) => point.share);
      const max = Math.max(...values, 1);
      const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
      const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
      const step = innerW / 23;
      const baseline = HEIGHT - PAD_BOTTOM;
      const yTicks = niceTicks(0, max, 4).map((value) => ({
        value,
        label: formatAxisValue(value, "percent"),
        y: tickY(value, 0, max, PAD_TOP, innerH),
      }));
      const coords = series.map((point, index) => {
        const x = PAD_LEFT + step * index;
        const y = PAD_TOP + innerH - (point.share / max) * innerH;
        return { x, y, ...point };
      });
      return {
        empty: total === 0,
        total,
        coords,
        line: buildSmoothPath(coords),
        area: buildSmoothAreaPath(coords, baseline),
        baseline,
        yTicks,
        axisEvery: 3,
        valueKind: "share" as const,
      };
    }

    const series = daily.map((point) => ({
      key: point.day,
      axis: daily.length <= 10 ? weekdayShort(point.day) : compactIsoDay(point.day),
      value: point.value,
      share: 0,
      exact: undefined as string | undefined,
      day: point.day,
      typicalIn: point.typicalIn,
    }));
    const total = series.reduce((sum, point) => sum + point.value, 0);
    const values = series.map((point) => point.value);
    const max = Math.max(...values, 1);
    const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const step = series.length <= 1 ? 0 : innerW / (series.length - 1);
    const baseline = HEIGHT - PAD_BOTTOM;
    const yTicks = niceTicks(0, max, 4).map((value) => ({
      value,
      label: formatAxisValue(value, "count"),
      y: tickY(value, 0, max, PAD_TOP, innerH),
    }));
    const coords = series.map((point, index) => {
      const x = PAD_LEFT + step * index;
      const y = PAD_TOP + innerH - (point.value / max) * innerH;
      return { x, y, ...point };
    });
    const axisEvery =
      series.length <= 8 ? 1 : series.length <= 16 ? 2 : Math.ceil(series.length / 8);
    return {
      empty: series.length === 0,
      total,
      coords,
      line: buildSmoothPath(coords),
      area: buildSmoothAreaPath(coords, baseline),
      baseline,
      yTicks,
      axisEvery,
      valueKind: "count" as const,
    };
  }, [mode, hourly, daily]);

  const pickIndex = useCallback(
    (clientX: number) => {
      if (!svgRef.current || !geometry.coords.length) return;
      const svg = svgRef.current;
      const xs = geometry.coords.map((point) => point.x);
      if (rafPickRef.current != null) cancelAnimationFrame(rafPickRef.current);
      rafPickRef.current = requestAnimationFrame(() => {
        rafPickRef.current = null;
        const nearest = pickNearestIndex(clientX, svg.getBoundingClientRect(), VIEW_W, xs);
        setActiveIndex((prev) => (prev === nearest ? prev : nearest));
      });
    },
    [geometry.coords],
  );

  useEffect(() => {
    return () => {
      if (rafPickRef.current != null) cancelAnimationFrame(rafPickRef.current);
    };
  }, []);

  const active =
    !geometry.empty && activeIndex != null ? geometry.coords[activeIndex] : null;
  const tooltipX = active ? Math.min(Math.max(active.x, 64), VIEW_W - 64) : 0;

  const emptyCopy =
    mode === "hourly"
      ? `No ${sourceName} clock-ins recorded for ${periodLabel}.`
      : `No presence days in ${periodLabel} for this view.`;

  return (
    <div
      className="smp-chart-wrap smp-chart-wrap--hourly smp-chart-wrap--axis smp-clockins-series"
      data-mode={mode}
      data-empty={geometry.empty ? "true" : "false"}
      onMouseLeave={() => setActiveIndex(null)}
    >
      <header className="smp-clockins-series__head">
        <div>
          <p className="smp-clockins-series__title">
            {mode === "hourly" ? "Clock-in rhythm" : "Present by day"}
          </p>
          <p className="smp-clockins-series__meta">
            {sourceName} · {periodLabel}
          </p>
        </div>
        <p className="smp-clockins-series__hint">
          {mode === "hourly" ? "Hover an hour for people and time" : "Hover a day for present and typical in"}
        </p>
      </header>

      {geometry.empty ? (
        <p className="smp-chart-empty">{emptyCopy}</p>
      ) : (
        <>
          <div className="smp-chart-plot">
            <div className="smp-chart-y" aria-hidden="true">
              {geometry.yTicks.map((tick) => (
                <span
                  key={`${tick.value}:${tick.label}`}
                  className="smp-chart-y__tick"
                  style={{ top: `${(tick.y / HEIGHT) * 100}%` }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            <div className="smp-chart-stage">
              <svg
                ref={svgRef}
                className="smp-chart smp-chart--hourly smp-chart--interactive"
                viewBox={`0 0 ${VIEW_W} ${HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={
                  mode === "hourly"
                    ? `${sourceName} hourly clock-in share · ${periodLabel}`
                    : `${sourceName} present by day · ${periodLabel}`
                }
                onMouseMove={(event) => pickIndex(event.clientX)}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--smp-accent)" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="var(--smp-accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {geometry.yTicks.map((tick) => (
                  <line
                    key={`grid-${tick.value}`}
                    className="smp-chart__grid"
                    x1={PAD_LEFT}
                    x2={VIEW_W - PAD_RIGHT}
                    y1={tick.y}
                    y2={tick.y}
                  />
                ))}
                <line
                  className="smp-chart__baseline"
                  x1={PAD_LEFT}
                  x2={VIEW_W - PAD_RIGHT}
                  y1={geometry.baseline}
                  y2={geometry.baseline}
                />
                <path className="smp-chart__area" d={geometry.area} fill={`url(#${gradientId})`} />
                <path className="smp-chart__line" d={geometry.line} />
                {geometry.coords.map((point, index) =>
                  index % geometry.axisEvery === 0 ? (
                    <text
                      key={point.key}
                      className="smp-chart__label smp-chart__label--dense"
                      x={point.x}
                      y={HEIGHT - 6}
                      textAnchor="middle"
                    >
                      {point.axis}
                    </text>
                  ) : null,
                )}
              </svg>
              {active ? (
                <ChartHoverOverlay
                  width={VIEW_W}
                  height={HEIGHT}
                  padTop={PAD_TOP}
                  padBottom={PAD_BOTTOM}
                  x={active.x}
                  y={active.y}
                />
              ) : null}
              {active ? (
                <div
                  className="smp-chart-tooltip smp-chart-tooltip--smooth"
                  style={{ left: `${(tooltipX / VIEW_W) * 100}%` }}
                >
                  <span className="smp-chart-tooltip__date">
                    {mode === "hourly"
                      ? memberView && active.exact
                        ? `In at ${active.exact}`
                        : active.axis
                      : `${weekdayShort(active.day)} · ${formatDisplayDate(active.day)}`}
                  </span>
                  <span className="smp-chart-tooltip__value">
                    {mode === "hourly"
                      ? memberView
                        ? `${sourceName} first clock-in`
                        : `${formatShare(active.share)} of clock-ins`
                      : `${Math.round(active.value)} present`}
                  </span>
                  <span className="smp-chart-tooltip__meta">
                    {mode === "hourly"
                      ? memberView
                        ? `${active.axis} hour`
                        : `${Math.round(active.value)} ${Math.round(active.value) === 1 ? "person" : "people"}`
                      : active.typicalIn != null
                        ? `Typical in ${formatMinutes(active.typicalIn)}`
                        : "No typical in yet"}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
