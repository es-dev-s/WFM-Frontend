import { cn } from "@/lib/cn";

export function StatusPill({ value }: { value: string }) {
  const normalized = value.trim().toLowerCase();
  const tone =
    normalized === "present" || normalized === "active" || normalized === "yes"
      ? "ok"
      : normalized === "absent" ||
          normalized === "inactive" ||
          normalized === "no"
        ? "bad"
        : "neutral";

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
