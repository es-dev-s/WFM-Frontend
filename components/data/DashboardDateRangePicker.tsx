"use client";

import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { addDaysISO, formatDisplayDate, isoDateInZone } from "@/lib/datetime";

export function defaultDashboardRange() {
  const today = isoDateInZone();
  return { start: addDaysISO(today, -13), end: today };
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
  return (
    <div className="smp-dashboard-date">
      <DateRangePicker
        variant="dashboard"
        showPresets
        start={start}
        end={end}
        onChange={onChange}
      />
      <span className="smp-dashboard-date__label" aria-live="polite">
        {formatDisplayDate(start)} – {formatDisplayDate(end)}
      </span>
    </div>
  );
}
