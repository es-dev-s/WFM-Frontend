"use client";

type ChartHoverOverlayProps = {
  width: number;
  height: number;
  padTop: number;
  padBottom: number;
  x: number;
  y: number;
};

export function ChartHoverOverlay({
  width,
  height,
  padTop,
  padBottom,
  x,
  y,
}: ChartHoverOverlayProps) {
  const xPct = (x / width) * 100;
  const yPct = (y / height) * 100;
  const crosshairTop = (padTop / height) * 100;
  const crosshairBottom = (padBottom / height) * 100;

  return (
    <div className="smp-chart-overlay" aria-hidden="true">
      <div
        className="smp-chart-crosshair"
        style={{
          left: `${xPct}%`,
          top: `${crosshairTop}%`,
          bottom: `${crosshairBottom}%`,
        }}
      />
      <div
        className="smp-chart-dot-overlay"
        style={{ left: `${xPct}%`, top: `${yPct}%` }}
      />
    </div>
  );
}
