import type { MetricCard } from "@/lib/api";
import { Delta } from "./StatusPill";

export function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <article className="smp-metric">
      <span className="smp-metric__label">{label}</span>
      <p className="smp-metric__value">{value}</p>
    </article>
  );
}

export function MetricCards({ metrics }: { metrics: MetricCard[] }) {
  return (
    <section className="smp-metrics" aria-label="Workspace totals">
      {metrics.map((metric) => (
        <article key={metric.key} className="smp-metric">
          <span className="smp-metric__label">{metric.label}</span>
          <p className="smp-metric__value">{metric.value}</p>
          {metric.delta ? (
            <Delta value={metric.delta} positive={metric.positive} />
          ) : null}
        </article>
      ))}
    </section>
  );
}
