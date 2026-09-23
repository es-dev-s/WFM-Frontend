"use client";

import { buildSmoothAreaPath, buildSmoothPath } from "@/components/data/chart-curve";
import { ChartHoverOverlay } from "@/components/data/ChartHoverOverlay";
import {
  compactIsoDay,
  formatAxisValue,
  niceTicks,
  tickY,
} from "@/components/data/chart-axis";
import { pickNearestIndex } from "@/components/data/useChartWidth";
import type { TrendMetric, TrendPoint } from "@/lib/api";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

const VIEW_W = 1000;
const HEIGHT = 168;
const PAD_LEFT = 12;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

function formatValue(value: number, metric: TrendMetric): string {
  if (metric === "present") return `${Math.round(value)} members`;
  if (metric === "attendance" || metric === "occupancy" || metric === "utilization") {
    return `${value.toFixed(1)}%`;
  }
  return value.toFixed(1);
}

function isPercentMetric(metric: TrendMetric): boolean {
  return metric === "attendance" || metric === "occupancy" || metric === "utilization";
}

export function TrendChart({
  points,
  label,
  metric = "present",
}: {
  points: TrendPoint[];
  label: string;
  metric?: TrendMetric;
}) {
  const gradientId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const rafPickRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const seriesKey = `${metric}:${points.map((point) => `${point.day}:${point.value}`).join(",")}`;
  useEffect(() => {
    setActiveIndex(null);
  }, [seriesKey]);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const percent = isPercentMetric(metric);
    const paddedMin = percent ? 0 : Math.max(0, min - (max - min || 1) * 0.08);
    const paddedMax = percent ? Math.max(max * 1.08, 5) : max + (max - min || 1) * 0.12;
    const range = paddedMax - paddedMin || 1;
    const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const step = points.length === 1 ? 0 : innerW / (points.length - 1);
    const baseline = HEIGHT - PAD_BOTTOM;
    const kind = percent ? "percent" : "count";
    const yTicks = niceTicks(paddedMin, paddedMax, 4).map((value) => ({
      value,
      label: formatAxisValue(value, kind),
      y: tickY(value, paddedMin, paddedMax, PAD_TOP, innerH),
    }));

    const coords = points.map((point, index) => {
      const x = PAD_LEFT + step * index;
      const y = PAD_TOP + innerH - ((point.value - paddedMin) / range) * innerH;
      return { x, y, label: point.day, value: point.value };
    });

    const axisLabels = [
      coords[0],
      coords[Math.floor((coords.length - 1) / 2)],
      coords[coords.length - 1],
    ].filter(
      (point, index, list) => list.findIndex((item) => item.label === point.label) === index,
    );

    return {
      coords,
      line: buildSmoothPath(coords),
      area: buildSmoothAreaPath(coords, baseline),
      baseline,
      axisLabels,
      yTicks,
    };
  }, [points, metric]);

  const pickIndex = useCallback(
    (clientX: number) => {
      if (!geometry || !svgRef.current) return;
      const svg = svgRef.current;
      const xs = geometry.coords.map((point) => point.x);
      if (rafPickRef.current != null) cancelAnimationFrame(rafPickRef.current);
      rafPickRef.current = requestAnimationFrame(() => {
        rafPickRef.current = null;
        const nearest = pickNearestIndex(clientX, svg.getBoundingClientRect(), VIEW_W, xs);
        setActiveIndex((prev) => (prev === nearest ? prev : nearest));
      });
    },
    [geometry],
  );

  useEffect(() => {
    return () => {
      if (rafPickRef.current != null) cancelAnimationFrame(rafPickRef.current);
    };
  }, []);

  if (!geometry) {
    return (
      <div className="smp-chart-wrap" data-empty="true">
        <p className="smp-chart-empty">No trend data for this period.</p>
      </div>
    );
  }

  const active = activeIndex !== null ? geometry.coords[activeIndex] : null;
  const tooltipX = active ? Math.min(Math.max(active.x, 52), VIEW_W - 52) : 0;

  return (
    <div className="smp-chart-wrap smp-chart-wrap--axis" onMouseLeave={() => setActiveIndex(null)}>
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
          className="smp-chart smp-chart--minimal smp-chart--interactive"
          viewBox={`0 0 ${VIEW_W} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} trend`}
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
          {geometry.axisLabels.map((point) => (
            <text
              key={point.label}
              className="smp-chart__label"
              x={point.x}
              y={HEIGHT - 8}
              textAnchor="middle"
            >
              {compactIsoDay(point.label)}
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
            <span className="smp-chart-tooltip__date">{active.label}</span>
            <span className="smp-chart-tooltip__value">{formatValue(active.value, metric)}</span>
          </div>
        ) : null}
        </div>
      </div>
      <p className="smp-chart-hint">Hover the line to inspect each day</p>
    </div>
  );
}
