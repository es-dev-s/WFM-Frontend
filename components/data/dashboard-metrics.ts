import type { TrendMetric } from "@/lib/api";

export const DASHBOARD_TREND_TABS: {
  metric: TrendMetric;
  label: string;
  title: string;
  description: string;
  valueLabel: string;
}[] = [
  {
    metric: "present",
    label: "Present",
    title: "Daily clock-ins",
    description: "Number of Tivazo members who clocked in on each day.",
    valueLabel: "Days present",
  },
  {
    metric: "attendance",
    label: "Attendance",
    title: "Attendance rate",
    description: "Share of active members who were present each day.",
    valueLabel: "Attendance %",
  },
  {
    metric: "utilization",
    label: "Utilization",
    title: "Work utilization",
    description: "Average tracked work time as a percentage of an 8-hour day.",
    valueLabel: "Utilization %",
  },
];

export function dashboardMetricInfo(metric: TrendMetric) {
  return (
    DASHBOARD_TREND_TABS.find((tab) => tab.metric === metric) ??
    DASHBOARD_TREND_TABS[0]
  );
}
