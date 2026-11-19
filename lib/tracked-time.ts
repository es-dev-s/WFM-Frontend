import { trackedSecondsOf } from "@/lib/server/metrics";
import { formatClockDuration, parseClockMinutes } from "@/lib/workday-clock";

/** Tivazo active tracked time target: 6 hours 30 minutes (23,400s). */
export const TARGET_TIVAZO_SECONDS = 6 * 3600 + 30 * 60;
export const TARGET_TIVAZO_LABEL = "6h 30m";
export const TARGET_TIVAZO_METRIC_NAME = "Tivazo Active Tracked Time";

/** Biometrics shift attendance target: 7 hours 5 minutes (25,500s). */
export const TARGET_BIO_SECONDS = 7 * 3600 + 5 * 60;
export const TARGET_BIO_LABEL = "7h 5m";
export const TARGET_BIO_METRIC_NAME = "Biometrics Shift Attendance";

/** Backward-compatible alias for the default 6h 30m office tracking target. */
export const TARGET_WORK_SECONDS = TARGET_TIVAZO_SECONDS;

export type TrackedSource = "bio" | "tivazo" | "auto";

export type WorkdayTimeMetrics = {
  trackedSeconds: number;
  trackedLabel: string;
  targetSeconds: number;
  targetLabel: string;
  metricName: string;
  varianceSeconds: number;
  varianceLabel: string;
  shortfallSeconds: number;
  shortfallLabel: string;
  /** Plain language label easier for non-native English speakers (e.g. "Goal met", "45m needed"). */
  remainingLabel: string;
  met: boolean;
  statusLabel: "Met" | "Not met";
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

/** Formatted signed variance duration: e.g. "+15m", "-45m", "0m". */
export function formatSignedVariance(seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) < 30) return "0m";
  const sign = seconds > 0 ? "+" : "-";
  const abs = Math.abs(seconds);
  const formatted = formatTrackedDuration(abs);
  return formatted === "—" ? "0m" : `${sign}${formatted}`;
}

/**
 * Resolve target seconds, label, and user-facing metric name for a given source.
 * - bio: 7 hours 5 minutes (Biometrics Shift Attendance)
 * - tivazo: 6 hours 30 minutes (Tivazo Active Tracked Time)
 * - auto: prefer Tivazo target if tracked time is present, else Bio target
 */
export function resolveTarget(input: {
  source?: TrackedSource;
  targetSeconds?: number;
  trackedTime?: string | number | null;
  inTime?: string | null;
  outTime?: string | null;
}): { targetSeconds: number; targetLabel: string; metricName: string } {
  if (input.targetSeconds && input.targetSeconds > 0) {
    return {
      targetSeconds: input.targetSeconds,
      targetLabel: formatTrackedDuration(input.targetSeconds),
      metricName: "Workday Target",
    };
  }

  const source = input.source ?? "auto";
  if (source === "bio") {
    return {
      targetSeconds: TARGET_BIO_SECONDS,
      targetLabel: TARGET_BIO_LABEL,
      metricName: TARGET_BIO_METRIC_NAME,
    };
  }

  if (source === "tivazo") {
    return {
      targetSeconds: TARGET_TIVAZO_SECONDS,
      targetLabel: TARGET_TIVAZO_LABEL,
      metricName: TARGET_TIVAZO_METRIC_NAME,
    };
  }

  // source === "auto": if tracked time is specified, apply Tivazo target; else Biometrics target
  const hasTracked =
    input.trackedTime != null &&
    String(input.trackedTime).trim() !== "" &&
    String(input.trackedTime).trim() !== "—";

  if (!hasTracked && (input.inTime || input.outTime)) {
    return {
      targetSeconds: TARGET_BIO_SECONDS,
      targetLabel: TARGET_BIO_LABEL,
      metricName: TARGET_BIO_METRIC_NAME,
    };
  }

  return {
    targetSeconds: TARGET_TIVAZO_SECONDS,
    targetLabel: TARGET_TIVAZO_LABEL,
    metricName: TARGET_TIVAZO_METRIC_NAME,
  };
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
  targetSeconds?: number;
  trackedTime?: string | number | null;
  inTime?: string | null;
  outTime?: string | null;
}): WorkdayTimeMetrics {
  const { targetSeconds, targetLabel, metricName } = resolveTarget(input);
  const trackedSeconds = resolveTrackedSeconds(input);

  const shortfallSeconds =
    trackedSeconds > 0
      ? Math.max(0, targetSeconds - trackedSeconds)
      : 0;
  const met = trackedSeconds > 0 && shortfallSeconds === 0;
  const varianceSeconds = trackedSeconds > 0 ? trackedSeconds - targetSeconds : -targetSeconds;

  const shortfallLabel = met
    ? "Met"
    : trackedSeconds > 0
      ? formatTrackedDuration(shortfallSeconds)
      : "—";

  const remainingLabel = met
    ? "Goal met"
    : trackedSeconds > 0
      ? `${formatTrackedDuration(shortfallSeconds)} needed`
      : "—";

  const varianceLabel = trackedSeconds > 0 ? formatSignedVariance(varianceSeconds) : "—";
  const statusLabel: "Met" | "Not met" = met ? "Met" : "Not met";

  return {
    trackedSeconds,
    trackedLabel: trackedSeconds > 0 ? formatTrackedDuration(trackedSeconds) : "—",
    targetSeconds,
    targetLabel,
    metricName,
    varianceSeconds,
    varianceLabel,
    shortfallSeconds,
    shortfallLabel,
    remainingLabel,
    met,
    statusLabel,
  };
}
