"use client";

import { activityFactGroups } from "@/components/data/cells";
import { QueryState } from "@/components/data/QueryState";
import { RecordHero, RecordSheet } from "@/components/data/RecordView";
import { StatusPill } from "@/components/data/StatusPill";
import { PageMeta } from "@/components/layout/PageMeta";
import { type DailyLogRow, useQuery } from "@/lib/api";
import { readParamId } from "@/lib/href";
import { useParams } from "next/navigation";
import { useMemo } from "react";

export default function BiomaticLogPage() {
  const params = useParams();
  const id = readParamId(params.id as string | string[] | undefined);
  const record = useQuery<DailyLogRow>(
    id ? `/daily-logs/${encodeURIComponent(id)}` : null,
  );
  const row = record.data;
  const groups = useMemo(
    () => (row ? activityFactGroups(row) : []),
    [row],
  );

  return (
    <div className="smp-page-stack smp-page-stack--fill smp-record">
      <PageMeta
        crumbs={[
          { label: "Biomatic", href: "/biomatic" },
          { label: "Daily logs", href: "/biomatic" },
          { label: row?.name || "Log" },
        ]}
      />
      <div className="smp-stage">
      <QueryState
        loading={record.loading && !row}
        error={row ? null : record.error}
        onRetry={record.reload}
        label="daily log"
      >
        {row ? (
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
            />
            <RecordSheet groups={groups} />
          </>
        ) : null}
      </QueryState>
      </div>
    </div>
  );
}
