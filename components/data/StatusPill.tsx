import { cn } from "@/lib/cn";

export function StatusPill({ value }: { value: string }) {
  const normalized = value.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  const tone =
    normalized === "present" ||
    normalized === "active" ||
    normalized === "tracking" ||
    normalized === "superadmin" ||
    normalized === "yes" ||
    compact === "ontime" ||
    compact === "fullday" ||
    compact === "stillin"
      ? "ok"
      : compact === "leave" ||
          compact === "onleave" ||
          compact === "halfday" ||
          compact === "late" ||
          compact === "early" ||
          compact === "weeklyoff" ||
          compact === "weekoff"
        ? "warn"
        : normalized === "absent" ||
            normalized === "inactive" ||
            normalized === "offline" ||
            normalized === "disabled" ||
            normalized === "no"
          ? "bad"
          : "neutral"; // Upcoming, Not on Bio/Tivazo, empty

  return (
    <span className="smp-pill" data-tone={tone} title={value || "—"}>
      {value || "—"}
    </span>
  );
}

export function Delta({
  value,
  positive,
}: {
  value: string;
  positive: boolean;
}) {
  return (
    <span
      className={cn("smp-metric__delta")}
      data-positive={positive ? "true" : "false"}
    >
      {value}
    </span>
  );
}
