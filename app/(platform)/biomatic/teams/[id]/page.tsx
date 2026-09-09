"use client";

import { TEAM_MEMBER_COLUMNS } from "@/components/data/activity-columns";
import { DataTable } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { RecordHero, RecordTable } from "@/components/data/RecordView";
import { PageMeta } from "@/components/layout/PageMeta";
import {
  type Member,
  type MemberDirectoryRow,
  type Team,
  useQuery,
} from "@/lib/api";
import { readParamId, recordHref } from "@/lib/href";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";

export default function BiomaticTeamPage() {
  const params = useParams();
  const router = useRouter();
  const id = readParamId(params.id as string | string[] | undefined);
  const team = useQuery<Team>(id ? `/teams/${id}` : null);
  const people = useQuery<Member[]>(id ? `/teams/${id}/members` : null);
  const rows: MemberDirectoryRow[] = useMemo(
    () =>
      (people.data ?? []).map((member) => ({
        ...member,
        teamName: team.data?.name ?? member.teamId,
      })),
    [people.data, team.data?.name],
  );

  return (
    <div className="smp-page-stack smp-page-stack--fill smp-record">
      <PageMeta
        crumbs={[
          { label: "Biomatic", href: "/biomatic" },
          { label: "Teams", href: "/biomatic" },
          { label: team.data?.name || "Team" },
        ]}
      />
      <div className="smp-stage">
      <QueryState
        loading={team.loading && !team.data}
        error={team.data ? null : team.error}
        onRetry={team.reload}
        label="team"
      >
        {team.data ? (
          <>
            <RecordHero
              name={team.data.name}
              counts={[
                { label: "People", value: String(team.data.members) },
                {
                  label: "Agents",
                  value: String(team.data.composition.agents),
                },
                {
                  label: "Leads",
                  value: String(team.data.composition.leads),
                },
                {
                  label: "Supervisors",
                  value: String(team.data.composition.supervisors),
                },
              ]}
            />
            <RecordTable title="Members">
              <QueryState
                loading={people.loading && !people.data}
                error={people.data ? null : people.error}
                onRetry={people.reload}
                label="members"
              >
                <DataTable
                  columns={TEAM_MEMBER_COLUMNS}
                  rows={rows}
                  getKey={(row) => row.id}
                  empty="No members in this team."
                  onRowClick={(row) =>
                    router.push(recordHref("/biomatic/members", row.id))
                  }
                />
              </QueryState>
            </RecordTable>
          </>
        ) : null}
      </QueryState>
      </div>
    </div>
  );
}
