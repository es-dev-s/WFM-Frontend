"use client";

import type { TrendPoint } from "@/lib/api";
import { useId, useMemo } from "react";

const WIDTH = 640;
const HEIGHT = 180;
const PAD_X = 12;
const PAD_Y = 18;

export function TrendChart({
  points,
  label,
}: {
  points: TrendPoint[];
  label: string;
}) {
  const gradientId = useId().replace(/:/g, "");

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const paddedMin = min - span * 0.12;
    const paddedMax = max + span * 0.12;
    const range = paddedMax - paddedMin || 1;
    const innerW = WIDTH - PAD_X * 2;
    const innerH = HEIGHT - PAD_Y * 2;
    const step = points.length === 1 ? 0 : innerW / (points.length - 1);

    const coords = points.map((point, index) => {
      const x = PAD_X + step * index;
      const y = PAD_Y + innerH - ((point.value - paddedMin) / range) * innerH;
      return { x, y, label: point.day, value: point.value };
    });

    const line = coords
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
      .join(" ");
    const area = `${line} L${coords[coords.length - 1].x} ${HEIGHT - PAD_Y} L${coords[0].x} ${HEIGHT - PAD_Y} Z`;

    return { coords, line, area };
  }, [points]);

  if (!geometry) {
    return <p className="smp-muted">No trend for this window.</p>;
  }

  return (
    <svg
      className="smp-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`${label} trend`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--smp-accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--smp-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line
        className="smp-chart__grid"
        x1={PAD_X}
        x2={WIDTH - PAD_X}
        y1={HEIGHT / 2}
        y2={HEIGHT / 2}
      />
      <path d={geometry.area} fill={`url(#${gradientId})`} />
      <path className="smp-chart__line" d={geometry.line} />
      {geometry.coords.map((point) => (
        <circle
          key={`${point.label}-${point.x}`}
          className="smp-chart__dot"
          cx={point.x}
          cy={point.y}
          r={2.5}
        >
          <title>
            {point.label}: {point.value.toFixed(1)}
          </title>
        </circle>
      ))}
    </svg>
  );
}
