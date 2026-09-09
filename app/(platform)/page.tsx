import { DashboardOverview } from "@/components/data/DashboardOverview";

export default function HomePage() {
  return (
    <div className="smp-page-stack">
      <DashboardOverview />
      <h2 className="smp-sr-only">Home</h2>
    </div>
  );
}
