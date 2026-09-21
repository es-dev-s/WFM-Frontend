export type ChartTick = {
  value: number;
  label: string;
  y: number;
};

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
  if (max <= min) return [min];
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step / 2 && ticks.length < 8; value += step) {
    const rounded = Number(value.toPrecision(8));
    if (rounded >= min - step / 4) ticks.push(rounded);
  }
  if (!ticks.length) return [min, max];
  return ticks.filter((value) => value <= max + step * 0.05);
}

export function tickY(
  value: number,
  min: number,
  max: number,
  padTop: number,
  innerH: number,
): number {
  const range = max - min || 1;
  return padTop + innerH - ((value - min) / range) * innerH;
}

export function formatAxisValue(value: number, kind: "count" | "percent"): string {
  if (kind === "percent") {
    return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
  }
  if (Math.abs(value) >= 100) return `${Math.round(value)}`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function compactIsoDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1]}`;
}
