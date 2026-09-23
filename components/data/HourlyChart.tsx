"use client";

import { buildSmoothAreaPath, buildSmoothPath } from "@/components/data/chart-curve";
import { ChartHoverOverlay } from "@/components/data/ChartHoverOverlay";
import { formatAxisValue, niceTicks, tickY } from "@/components/data/chart-axis";
import { pickNearestIndex } from "@/components/data/useChartWidth";
import type { ClockSource, HourlyPoint } from "@/lib/api";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

const VIEW_W = 1000;
const HEIGHT = 200;
const PAD_LEFT = 12;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const HOURS = 24;

function compactHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

function formatShare(share: number): string {
  return `${Number.isInteger(share) ? share.toFixed(0) : share.toFixed(1)}%`;
}

export function HourlyChart({
  points,
  source,
  memberView = false,
}: {
  points: HourlyPoint[];
  source?: ClockSource;
  memberView?: boolean;
}) {
  const gradientId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const rafPickRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const seriesKey = `${source ?? ""}:${points.map((point) => `${point.hour}:${point.value}`).join(",")}`;
  useEffect(() => {
    setActiveIndex(null);
  }, [seriesKey]);

  const series = useMemo(() => {
    const byHour = new Map(points.map((point) => [point.hour, point]));
    const filled = Array.from({ length: HOURS }, (_, hour) => {
      const existing = byHour.get(hour);
      return {
        hour,
        label: existing?.label ?? compactHourLabel(hour),
        value: existing?.value ?? 0,
        share: existing?.share ?? 0,
        exact: existing?.exact,
      };
    });
    const total = filled.reduce((sum, point) => sum + point.value, 0);
    return filled.map((point) => ({
      ...point,
      share: point.share || (total ? Math.round((point.value / total) * 1000) / 10 : 0),
    }));
  }, [points]);

  const total = series.reduce((sum, point) => sum + point.value, 0);
  const empty = total === 0;

  const geometry = useMemo(() => {
    const values = series.map((point) => point.share);
    const max = Math.max(...values, 1);
    const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const step = innerW / (HOURS - 1);
    const baseline = HEIGHT - PAD_BOTTOM;
    const yTicks = niceTicks(0, max, 4).map((value) => ({
      value,
      label: formatAxisValue(value, "percent"),
      y: tickY(value, 0, max, PAD_TOP, innerH),
    }));

    const coords = series.map((point, index) => {
      const x = PAD_LEFT + step * index;
      const y = PAD_TOP + innerH - (point.share / max) * innerH;
      return {
        x,
        y,
        label: point.label,
        value: point.value,
        share: point.share,
        exact: point.exact,
        hour: point.hour,
      };
    });

    return {
      coords,
      line: buildSmoothPath(coords),
      area: buildSmoothAreaPath(coords, baseline),
      baseline,
      yTicks,
    };
  }, [series]);

  const pickIndex = useCallback(
    (clientX: number) => {
      if (!svgRef.current) return;
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

  const active = !empty && activeIndex !== null ? geometry.coords[activeIndex] : null;
  const tooltipX = active ? Math.min(Math.max(active.x, 64), VIEW_W - 64) : 0;

  return (
    <div
      className="smp-chart-wrap smp-chart-wrap--hourly smp-chart-wrap--axis"
      data-source={source}
      data-empty={empty ? "true" : "false"}
      onMouseLeave={() => setActiveIndex(null)}
    >
      {empty ? (
        <p className="smp-chart-empty">
          {source === "tivazo"
            ? "No Tivazo clock-ins recorded for this day."
            : source === "biometrics"
              ? "No Biometrics punches recorded for this day."
              : "No clock-ins recorded yet for this day."}
        </p>
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
                source === "tivazo"
                  ? "Tivazo hourly clock-in share"
                  : source === "biometrics"
                    ? "Biometrics hourly clock-in share"
                    : "Average hourly clock-in share"
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
              {geometry.coords
                .filter((point) => point.hour % 3 === 0)
                .map((point) => (
                  <text
                    key={point.hour}
                    className="smp-chart__label smp-chart__label--dense"
                    x={point.x}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                  >
                    {point.label}
                  </text>
                ))}
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
                  {memberView && active.exact ? `In at ${active.exact}` : active.label}
                </span>
                <span className="smp-chart-tooltip__value">
                  {memberView
                    ? source === "tivazo"
                      ? "Tivazo first clock-in"
                      : "Biometrics first punch"
                    : `${formatShare(active.share)} of clock-ins`}
                </span>
                <span className="smp-chart-tooltip__meta">
                  {memberView
                    ? `${active.label} hour`
                    : `${Math.round(active.value)} ${Math.round(active.value) === 1 ? "person" : "people"}`}
                </span>
              </div>
            ) : null}
            </div>
          </div>
          <p className="smp-chart-hint">
            Hover an hour to see {source === "tivazo" ? "Tivazo" : "Biometrics"} clock-ins
          </p>
        </>
      )}
    </div>
  );
}
