import type { DataColumn } from "@/components/data/DataTable";
import { StatusPill } from "@/components/data/StatusPill";
import {
  CellText,
  GroupsCell,
  IdCell,
  PersonCell,
} from "@/components/data/cells";
import type { DailyEntry, DailyLogRow, MemberDirectoryRow, Team } from "@/lib/api";

export const ACTIVITY_COLUMNS: DataColumn<DailyLogRow>[] = [
  {
    id: "name",
    header: "Person",
    width: "360px",
    sticky: true,
    flex: true,
    person: true,
    priority: 1,
    render: (row) => (
      <PersonCell name={row.name} email={row.email} avatarUrl={row.avatarUrl} />
    ),
  },
  {
    id: "date",
    header: "Date",
    width: "112px",
    priority: 1,
    render: (row) => <CellText value={row.date} />,
  },
  {
    id: "employeeId",
    header: "Employee ID",
    width: "108px",
    priority: 2,
    render: (row) => <IdCell value={row.employeeId} />,
  },
  {
    id: "group",
    header: "Group",
    width: "150px",
    priority: 1,
    render: (row) => <GroupsCell group={row.group} groups={row.groups} />,
  },
  {
    id: "role",
    header: "Role",
    width: "120px",
    priority: 2,
    render: (row) => <CellText value={row.role} />,
  },
  {
    id: "status",
    header: "Day",
    width: "104px",
    align: "center",
    priority: 1,
    render: (row) => <StatusPill value={row.status} />,
  },
  {
    id: "in",
    header: "In",
    width: "88px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.inTime} />,
  },
  {
    id: "out",
    header: "Out",
    width: "88px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.outTime} />,
  },
  {
    id: "tracked",
    header: "Tracked",
    width: "96px",
    align: "right",
    priority: 2,
    render: (row) => <CellText value={row.trackedTime} />,
  },
  {
    id: "lastActive",
    header: "Last active",
    width: "148px",
    align: "right",
    priority: 3,
    render: (row) => <CellText value={row.lastActiveAt} />,
  },
];

export const TIVAZO_ACTIVITY_COLUMNS: DataColumn<DailyLogRow>[] =
  ACTIVITY_COLUMNS.map((column) =>
    column.id === "group"
      ? { ...column, header: "Tivazo group" }
      : column.id === "role"
        ? { ...column, header: "Designation" }
        : column,
  );

export const MEMBER_COLUMNS: DataColumn<MemberDirectoryRow>[] = [
  {
    id: "name",
    header: "Person",
    width: "360px",
    sticky: true,
    flex: true,
    person: true,
    priority: 1,
    render: (row) => (
      <PersonCell name={row.name} email={row.email} avatarUrl={row.avatarUrl} />
    ),
  },
  {
    id: "employeeId",
    header: "Employee ID",
    width: "108px",
    priority: 1,
    render: (row) => <IdCell value={row.employeeId} />,
  },
  {
    id: "team",
    header: "Team",
    width: "160px",
    priority: 1,
    render: (row) => <CellText value={row.teamName} />,
  },
  {
    id: "role",
    header: "Role",
    width: "120px",
    priority: 1,
    render: (row) => <CellText value={row.role} />,
  },
  {
    id: "day",
    header: "Day",
    width: "104px",
    align: "center",
    priority: 1,
    render: (row) => <StatusPill value={row.dayStatus} />,
  },
  {
    id: "groups",
    header: "Groups",
    width: "160px",
    priority: 2,
    render: (row) => <GroupsCell group={row.teamName} groups={row.groups} />,
  },
  {
    id: "lastActive",
    header: "Last active",
    width: "148px",
    align: "right",
    priority: 2,
    render: (row) => <CellText value={row.lastActiveAt} />,
  },
];

export const TEAM_MEMBER_COLUMNS = MEMBER_COLUMNS.filter(
  (column) => column.id !== "team",
);

export const TEAM_COLUMNS: DataColumn<Team>[] = [
  {
    id: "name",
    header: "Team",
    width: "168px",
    sticky: true,
    priority: 1,
    render: (row) => <CellText value={row.name} />,
  },
  {
    id: "members",
    header: "Member",
    width: "120px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.members} />,
  },
  {
    id: "agents",
    header: "Agents",
    width: "120px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.composition.agents} />,
  },
];

export const ENTRY_COLUMNS: DataColumn<DailyEntry>[] = [
  {
    id: "date",
    header: "Date",
    width: "140px",
    priority: 1,
    render: (row) => row.date,
  },
  {
    id: "status",
    header: "Status",
    width: "120px",
    align: "center",
    priority: 1,
    render: (row) => <StatusPill value={row.status} />,
  },
  {
    id: "in",
    header: "In",
    width: "100px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.inTime} />,
  },
  {
    id: "out",
    header: "Out",
    width: "100px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.outTime} />,
  },
];
