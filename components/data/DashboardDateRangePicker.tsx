"use client";

import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { prefetchQueries } from "@/lib/api";
import { dateRangeQueryUrls } from "@/lib/dashboard-prefetch";
import { datePresets, matchDatePreset, presetRange, type DatePresetId } from "@/lib/date-presets";
import { formatRangeLabel, isoDateInZone, normalizeDateRange } from "@/lib/datetime";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RANGE_STORAGE_KEY = "wfm.dashboard.dateRange";

export function defaultDashboardRange() {
  return presetRange("last3Months");
}

function readStoredRange(today: string): { start: string; end: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(RANGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { start?: string; end?: string };
    return normalizeDateRange(parsed.start || "", parsed.end || "", today);
  } catch {
    return null;
  }
}

function writeStoredRange(start: string, end: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify({ start, end }));
  } catch {
    /* ignore quota / private mode */
  }
}

function writeRangeUrl(pathname: string, start: string, end: string) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("startDate") === start && params.get("endDate") === end) return;
  params.set("startDate", start);
  params.set("endDate", end);
  const next = `${pathname}?${params.toString()}`;
  window.history.replaceState(window.history.state, "", next);
}

export function useDashboardDateRange() {
  const today = useMemo(() => isoDateInZone(), []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const startParam = searchParams.get("startDate") || "";
  const endParam = searchParams.get("endDate") || "";
  const [range, setRangeState] = useState(() =>
    startParam || endParam
      ? normalizeDateRange(startParam, endParam, today)
      : defaultDashboardRange(),
  );
  const skipParamSync = useRef(false);

  const setRange = useCallback(
    (start: string, end: string) => {
      const next = normalizeDateRange(start, end, today);
      setRangeState((prev) => {
        if (prev.start === next.start && prev.end === next.end) return prev;
        return next;
      });
      writeStoredRange(next.start, next.end);
      skipParamSync.current = true;
      writeRangeUrl(pathname, next.start, next.end);
    },
    [today, pathname],
  );

  useEffect(() => {
    if (skipParamSync.current) {
      skipParamSync.current = false;
      return;
    }
    if (startParam || endParam) {
      const fromUrl = normalizeDateRange(startParam, endParam, today);
      setRangeState((prev) =>
        prev.start === fromUrl.start && prev.end === fromUrl.end ? prev : fromUrl,
      );
      writeStoredRange(fromUrl.start, fromUrl.end);
      return;
    }
    const stored = readStoredRange(today);
    if (stored && stored.start !== stored.end) {
      setRange(stored.start, stored.end);
      return;
    }
    const fallback = defaultDashboardRange();
    setRange(fallback.start, fallback.end);
  }, [startParam, endParam, setRange, today]);

  return { start: range.start, end: range.end, setRange, today };
}

export function DashboardDateRangePicker({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const today = useMemo(() => isoDateInZone(), []);
  const presets = useMemo(() => datePresets(today), [today]);
  const active = matchDatePreset(start, end, today);
  const activeLabel = presets.find((item) => item.id === active)?.label || "Custom";

  const choose = (id: DatePresetId) => {
    const next = presets.find((item) => item.id === id);
    if (!next) return;
    prefetchQueries(dateRangeQueryUrls(next.start, next.end), 3);
    onChange(next.start, next.end);
  };

  const warm = (id: DatePresetId) => {
    const next = presets.find((item) => item.id === id);
    if (!next) return;
    prefetchQueries(dateRangeQueryUrls(next.start, next.end), 3);
  };

  return (
    <div className="smp-dashboard-date">
      <div className="smp-date-presets" role="group" aria-label="Date range presets">
        {presets.map((item) => (
          <button
            key={item.id}
            type="button"
            className="smp-date-presets__btn"
            data-active={active === item.id ? "true" : "false"}
            aria-pressed={active === item.id}
            onMouseEnter={() => warm(item.id)}
            onFocus={() => warm(item.id)}
            onClick={() => choose(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="smp-dashboard-date__pick">
        <DateRangePicker
          variant="dashboard"
          showPresets={false}
          applyOnFirstDay={false}
          start={start}
          end={end}
          max={today}
          onChange={onChange}
        />
        <span className="smp-dashboard-date__label" aria-live="polite">
          <strong>{formatRangeLabel(start, end)}</strong>
          <small>{activeLabel}</small>
        </span>
      </div>
    </div>
  );
}
