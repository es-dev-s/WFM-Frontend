"use client";

import { activityFactGroups } from "@/components/data/cells";
import { QueryState } from "@/components/data/QueryState";
import { RecordHero, RecordSheet } from "@/components/data/RecordView";
import { StatusPill } from "@/components/data/StatusPill";
import { PageMeta } from "@/components/layout/PageMeta";
import { type DailyLogRow, useQuery, withQuery } from "@/lib/api";
import { readParamId } from "@/lib/href";
import { workdayTimeMetrics } from "@/lib/tracked-time";
import { useParams } from "next/navigation";
import { useMemo } from "react";

export default function TivazoActivityPage() {
  const params = useParams();
  const id = readParamId(params.id as string | string[] | undefined);
  const record = useQuery<DailyLogRow>(
    id ? withQuery("/tivazo/activity", { id }) : null,
  );
  const row = record.data;
  const groups = useMemo(
    () => (row ? activityFactGroups(row, "tivazo") : []),
    [row],
  );

  const metrics = useMemo(
    () =>
      row
        ? workdayTimeMetrics({
            source: "tivazo",
            trackedTime: row.trackedTime,
            inTime: row.inTime,
            outTime: row.outTime,
          })
        : null,
    [row],
  );

  return (
    <div className="smp-page-stack smp-page-stack--fill smp-record">
      <PageMeta
        crumbs={[
          { label: "Tivazo", href: "/tivazo" },
          { label: row?.name || "Activity" },
        ]}
      />
      <div className="smp-stage">
      <QueryState
        loading={record.loading && !row}
        error={row ? null : record.error}
        onRetry={record.reload}
        label="activity"
      >
        {row && metrics ? (
          <>
            <RecordHero
              name={row.name}
              email={row.email}
              avatarUrl={row.avatarUrl}
              meta={
                <>
                  <StatusPill value={row.status} />
                  {row.date ? (
                    <span className="smp-muted">{row.date}</span>
                  ) : null}
                  {row.group ? (
                    <span className="smp-muted">{row.group}</span>
                  ) : null}
                </>
              }
              counts={[
                { label: "Target (Active)", value: metrics.targetLabel },
                { label: "Actual Tracked", value: metrics.trackedLabel },
                {
                  label: "Target Status",
                  value:
                    metrics.trackedSeconds > 0
                      ? metrics.met
                        ? "Met"
                        : "Not met"
                      : "—",
                },
              ]}
            />
            <RecordSheet groups={groups} />
          </>
        ) : null}
      </QueryState>
      </div>
    </div>
  );
}
