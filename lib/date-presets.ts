import {
  addMonthsISO,
  endOfMonthISO,
  endOfWeekSaturday,
  isoDateInZone,
  startOfMonthISO,
  startOfWeekSunday,
} from "@/lib/datetime";

export type DatePresetId = "today" | "week" | "lastMonth" | "thisMonth" | "last3Months";

export type DatePreset = {
  id: DatePresetId;
  label: string;
  start: string;
  end: string;
};

export function datePresets(today = isoDateInZone()): DatePreset[] {
  const thisMonthStart = startOfMonthISO(today);
  const lastMonth = addMonthsISO(thisMonthStart, -1);
  return [
    { id: "today", label: "Today", start: today, end: today },
    { id: "week", label: "Weekly", start: startOfWeekSunday(today), end: endOfWeekSaturday(today) },
    {
      id: "lastMonth",
      label: "Last month",
      start: startOfMonthISO(lastMonth),
      end: endOfMonthISO(lastMonth),
    },
    { id: "thisMonth", label: "This month", start: thisMonthStart, end: endOfMonthISO(today) },
    {
      id: "last3Months",
      label: "Past 3 months",
      start: startOfMonthISO(addMonthsISO(thisMonthStart, -3)),
      end: endOfMonthISO(today),
    },
  ];
}

export function matchDatePreset(
  start: string,
  end: string,
  today = isoDateInZone(),
): DatePresetId | null {
  return datePresets(today).find((item) => item.start === start && item.end === end)?.id ?? null;
}

export function presetRange(
  id: DatePresetId,
  today = isoDateInZone(),
): { start: string; end: string } {
  const hit = datePresets(today).find((item) => item.id === id);
  return hit ? { start: hit.start, end: hit.end } : { start: today, end: today };
}
