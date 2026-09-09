"use client";

import { buildSmoothAreaPath, buildSmoothPath } from "@/components/data/chart-curve";
import { ChartHoverOverlay } from "@/components/data/ChartHoverOverlay";
import { pickNearestIndex, useChartWidth } from "@/components/data/useChartWidth";
import type { HourlyPoint } from "@/lib/api";
import { useCallback, useId, useMemo, useRef, useState } from "react";

const HEIGHT = 200;
const PAD_LEFT = 20;
const PAD_RIGHT = 20;
const PAD_TOP = 28;
const PAD_BOTTOM = 36;
const HOURS = 24;

function compactHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

export function HourlyChart({ points }: { points: HourlyPoint[] }) {
  const gradientId = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const { containerRef, width } = useChartWidth();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const series = useMemo(() => {
    const byHour = new Map(points.map((point) => [point.hour, point]));
    return Array.from({ length: HOURS }, (_, hour) => {
      const existing = byHour.get(hour);
      return {
        hour,
        label: existing?.label ?? compactHourLabel(hour),
        value: existing?.value ?? 0,
      };
    });
  }, [points]);

  const total = series.reduce((sum, point) => sum + point.value, 0);

  const geometry = useMemo(() => {
    const values = series.map((point) => point.value);
    const max = Math.max(...values, 1);
    const innerW = width - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const step = innerW / (HOURS - 1);
    const baseline = HEIGHT - PAD_BOTTOM;

    const coords = series.map((point, index) => {
      const x = PAD_LEFT + step * index;
      const y = PAD_TOP + innerH - (point.value / max) * innerH;
      return { x, y, label: point.label, value: point.value, hour: point.hour };
    });

    const line = buildSmoothPath(coords);
    const area = buildSmoothAreaPath(coords, baseline);

    return { coords, line, area, baseline, max };
  }, [series, width]);

  const pickIndex = useCallback(
    (clientX: number) => {
      if (!svgRef.current) return;
      const nearest = pickNearestIndex(
        clientX,
        svgRef.current.getBoundingClientRect(),
        width,
        geometry.coords.map((point) => point.x),
      );
      setActiveIndex((prev) => (prev === nearest ? prev : nearest));
    },
    [geometry.coords, width],
  );

  if (total === 0) {
    return (
      <div className="smp-chart-wrap smp-chart-wrap--hourly">
        <p className="smp-chart-empty">No clock-ins recorded yet for this day.</p>
      </div>
    );
  }

  const active =
    activeIndex !== null ? geometry.coords[activeIndex] : null;
  const tooltipX = active
    ? Math.min(Math.max(active.x, 52), width - 52)
    : 0;

  return (
    <div
      ref={containerRef}
      className="smp-chart-wrap smp-chart-wrap--hourly"
      onMouseLeave={() => setActiveIndex(null)}
    >
      <div className="smp-chart-stage">
        <svg
          ref={svgRef}
          className="smp-chart smp-chart--hourly smp-chart--interactive"
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="img"
          aria-label="Hourly clock-ins"
          onMouseMove={(event) => pickIndex(event.clientX)}
          onTouchMove={(event) => {
            const touch = event.touches[0];
            if (touch) pickIndex(touch.clientX);
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--smp-accent)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--smp-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            className="smp-chart__baseline"
            x1={PAD_LEFT}
            x2={width - PAD_RIGHT}
            y1={geometry.baseline}
            y2={geometry.baseline}
          />
          <path
            className="smp-chart__area"
            d={geometry.area}
            fill={`url(#${gradientId})`}
          />
          <path className="smp-chart__line" d={geometry.line} />
          {geometry.coords.map((point) => (
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
            width={width}
            height={HEIGHT}
            padTop={PAD_TOP}
            padBottom={PAD_BOTTOM}
            x={active.x}
            y={active.y}
          />
        ) : null}
      </div>
      {active ? (
        <div
          className="smp-chart-tooltip smp-chart-tooltip--smooth"
          style={{ left: `${(tooltipX / width) * 100}%` }}
        >
          <span className="smp-chart-tooltip__date">{active.label}</span>
          <span className="smp-chart-tooltip__value">
            {Math.round(active.value)} clock-ins
          </span>
        </div>
      ) : (
        <p className="smp-chart-hint">Hover to see clock-ins by hour</p>
      )}
    </div>
  );
}
