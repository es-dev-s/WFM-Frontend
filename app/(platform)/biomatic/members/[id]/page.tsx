"use client";

import { memberProfileFacts } from "@/components/data/cells";
import { ENTRY_COLUMNS } from "@/components/data/activity-columns";
import { DataTable } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { RecordProfile, RecordTable } from "@/components/data/RecordView";
import { StatusPill } from "@/components/data/StatusPill";
import { PageMeta } from "@/components/layout/PageMeta";
import {
  type MemberDetail,
  type Team,
  useQuery,
} from "@/lib/api";
import { readParamId, recordHref } from "@/lib/href";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";

export default function BiomaticMemberPage() {
  const params = useParams();
  const router = useRouter();
  const id = readParamId(params.id as string | string[] | undefined);
  const detail = useQuery<MemberDetail>(id ? `/members/${id}/detail` : null);
  const member = detail.data?.member;
  const team = useQuery<Team>(
    member?.teamId ? `/teams/${member.teamId}` : null,
  );
  const facts = useMemo(
    () =>
      member
        ? memberProfileFacts(member, { teamName: team.data?.name })
        : [],
    [member, team.data?.name],
  );

  return (
    <div className="smp-page-stack smp-page-stack--fill smp-record">
      <PageMeta
        crumbs={[
          { label: "Biomatic", href: "/biomatic" },
          { label: "Members", href: "/biomatic" },
          { label: member?.name || "Member" },
        ]}
      />
      <div className="smp-stage">
      <QueryState
        loading={detail.loading && !member}
        error={member ? null : detail.error}
        onRetry={detail.reload}
        label="member"
      >
        {member && detail.data ? (
          <>
            <RecordProfile
              name={member.name}
              email={member.email}
              avatarUrl={member.avatarUrl}
              meta={
                <>
                  <StatusPill value={member.status} />
                  {member.employeeId ? (
                    <span className="smp-id-cell">{member.employeeId}</span>
                  ) : null}
                </>
              }
              counts={[
                { label: "Present", value: detail.data.cards.present },
                { label: "Absent", value: detail.data.cards.absent },
                { label: "Entries", value: detail.data.cards.entries },
              ]}
              facts={facts}
            />
            <RecordTable title="Daily entries">
              <DataTable
                columns={ENTRY_COLUMNS}
                rows={detail.data.dailyEntries}
                getKey={(row) => row.id}
                empty="No daily entries for this member."
                onRowClick={(row) =>
                  router.push(recordHref("/biomatic/logs", row.id))
                }
              />
            </RecordTable>
          </>
        ) : null}
      </QueryState>
      </div>
    </div>
  );
}
