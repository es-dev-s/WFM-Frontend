import { withQuery } from "@/lib/api";
import { datePresets } from "@/lib/date-presets";

export function dateRangeQueryUrls(start: string, end: string): string[] {
  return [withQuery("/dashboard/overview", { startDate: start, endDate: end })];
}

export function presetQueryUrls(today?: string): string[] {
  const order = ["today", "thisMonth", "week", "lastMonth", "last3Months"] as const;
  const presets = datePresets(today);
  return order.flatMap((id) => {
    const preset = presets.find((item) => item.id === id);
    return preset ? dateRangeQueryUrls(preset.start, preset.end) : [];
  });
}
