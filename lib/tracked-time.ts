import { trackedSecondsOf } from "@/lib/server/metrics";
import { formatClockDuration, parseClockMinutes } from "@/lib/workday-clock";

/** Office target: 6 hours 30 minutes. */
export const TARGET_WORK_SECONDS = 6 * 3600 + 30 * 60;

export type TrackedSource = "bio" | "tivazo" | "auto";

export type WorkdayTimeMetrics = {
  trackedSeconds: number;
  trackedLabel: string;
  shortfallSeconds: number;
  shortfallLabel: string;
  met: boolean;
};

/** In→out span in seconds (handles overnight wrap). Null when incomplete. */
export function punchSpanSeconds(
  inTime: string | null | undefined,
  outTime: string | null | undefined,
): number | null {
  const a = parseClockMinutes(String(inTime ?? "").trim());
  const b = parseClockMinutes(String(outTime ?? "").trim());
  if (a == null || b == null) return null;
  let span = b - a;
  if (span < 0) span += 24 * 60;
  if (span <= 0) return null;
  return span * 60;
}

/** Compact duration: 7h 12m (matches workday-clock formatClockDuration). */
export function formatTrackedDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return formatClockDuration(seconds / 60);
}

/**
 * Resolve tracked seconds for a day row.
 * - bio: prefer punch in→out; fall back to API trackedTime label/seconds
 * - tivazo: prefer API trackedTime; fall back to punch in→out
 * - auto: API tracked first, then punch span
 */
export function resolveTrackedSeconds(input: {
  source?: TrackedSource;
  trackedTime?: string | number | null;
  inTime?: string | null;
  outTime?: string | null;
}): number {
  const source = input.source ?? "auto";
  const fromApi = trackedSecondsOf(input.trackedTime);
  const fromPunch = punchSpanSeconds(input.inTime, input.outTime) ?? 0;

  if (source === "bio") {
    if (fromPunch > 0) return fromPunch;
    return fromApi > 0 ? fromApi : 0;
  }
  if (source === "tivazo") {
    if (fromApi > 0) return fromApi;
    return fromPunch > 0 ? fromPunch : 0;
  }
  if (fromApi > 0) return fromApi;
  return fromPunch > 0 ? fromPunch : 0;
}

export function workdayTimeMetrics(input: {
  source?: TrackedSource;
  trackedTime?: string | number | null;
  inTime?: string | null;
  outTime?: string | null;
}): WorkdayTimeMetrics {
  const trackedSeconds = resolveTrackedSeconds(input);
  const shortfallSeconds =
    trackedSeconds > 0
      ? Math.max(0, TARGET_WORK_SECONDS - trackedSeconds)
      : 0;
  const met = trackedSeconds > 0 && shortfallSeconds === 0;
  return {
    trackedSeconds,
    trackedLabel: trackedSeconds > 0 ? formatTrackedDuration(trackedSeconds) : "—",
    shortfallSeconds,
    shortfallLabel: met
      ? "Met"
      : trackedSeconds > 0
        ? formatTrackedDuration(shortfallSeconds)
        : "—",
    met,
  };
}
