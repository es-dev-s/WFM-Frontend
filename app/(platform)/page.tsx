import { DashboardOverview } from "@/components/data/DashboardOverview";
import { Suspense } from "react";

export default function HomePage() {
  return (
    <div className="smp-page-stack smp-page-stack--fill smp-page-stack--dashboard">
      <Suspense
        fallback={
          <div
            className="smp-stage smp-stage--pad smp-dashboard"
            aria-busy="true"
          />
        }
      >
        <DashboardOverview />
      </Suspense>
      <h2 className="smp-sr-only">Home</h2>
    </div>
  );
}
