import type { DataColumn } from "@/components/data/DataTable";
import { StatusPill } from "@/components/data/StatusPill";
import {
  CellText,
  GroupsCell,
  IdCell,
  PersonCell,
} from "@/components/data/cells";
import type { DailyEntry, DailyLogRow, MemberDirectoryRow, Team } from "@/lib/api";
import { formatInstantMs } from "@/lib/datetime";
import { workdayTimeMetrics } from "@/lib/tracked-time";

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
    header: "Department",
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
    width: "88px",
    align: "right",
    priority: 1,
    render: (row) => {
      const m = workdayTimeMetrics({
        source: "bio",
        trackedTime: row.trackedTime,
        inTime: row.inTime,
        outTime: row.outTime,
      });
      return <CellText value={m.trackedLabel} />;
    },
  },
  {
    id: "shortfall",
    header: "Shortfall",
    width: "88px",
    align: "right",
    priority: 2,
    render: (row) => {
      const m = workdayTimeMetrics({
        source: "bio",
        trackedTime: row.trackedTime,
        inTime: row.inTime,
        outTime: row.outTime,
      });
      return <CellText value={m.shortfallLabel} tone={m.met ? "ok" : "primary"} />;
    },
  },
];

export const TIVAZO_ACTIVITY_COLUMNS: DataColumn<DailyLogRow>[] = [
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
    header: "Tivazo group",
    width: "150px",
    priority: 1,
    render: (row) => <GroupsCell group={row.group} groups={row.groups} />,
  },
  {
    id: "designation",
    header: "Designation",
    width: "160px",
    priority: 1,
    render: (row) => <CellText value={row.designation} />,
  },
  {
    id: "live",
    header: "Live",
    width: "104px",
    align: "center",
    priority: 2,
    render: (row) => <StatusPill value={row.userStatus} />,
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
    header: "Last shot",
    width: "88px",
    align: "right",
    priority: 2,
    render: (row) => <CellText value={row.outTime} />,
  },
  {
    id: "tracked",
    header: "Tracked",
    width: "88px",
    align: "right",
    priority: 1,
    render: (row) => {
      const m = workdayTimeMetrics({
        source: "tivazo",
        trackedTime: row.trackedTime,
        inTime: row.inTime,
        outTime: row.outTime,
      });
      return <CellText value={m.trackedLabel} />;
    },
  },
  {
    id: "shortfall",
    header: "Shortfall",
    width: "88px",
    align: "right",
    priority: 2,
    render: (row) => {
      const m = workdayTimeMetrics({
        source: "tivazo",
        trackedTime: row.trackedTime,
        inTime: row.inTime,
        outTime: row.outTime,
      });
      return <CellText value={m.shortfallLabel} tone={m.met ? "ok" : "primary"} />;
    },
  },
  {
    id: "manual",
    header: "Manual",
    width: "96px",
    align: "right",
    priority: 3,
    render: (row) => <CellText value={row.manualTime} />,
  },
  {
    id: "break",
    header: "Break",
    width: "96px",
    align: "right",
    priority: 3,
    render: (row) => <CellText value={row.breakTime} />,
  },
  {
    id: "lastActive",
    header: "Last active",
    width: "148px",
    align: "right",
    priority: 3,
    render: (row) => (
      <CellText
        value={
          row.lastActiveAt ? formatInstantMs(Date.parse(row.lastActiveAt)) : ""
        }
      />
    ),
  },
];

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
    header: "Department",
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
    id: "in",
    header: "In",
    width: "88px",
    align: "right",
    priority: 1,
    render: (row) => <CellText value={row.inTime} />,
  },
  {
    id: "groups",
    header: "Groups",
    width: "160px",
    priority: 2,
    render: (row) => <GroupsCell group={row.teamName} groups={row.groups} />,
  },
  {
    id: "joined",
    header: "Joined",
    width: "120px",
    align: "right",
    priority: 2,
    render: (row) => <CellText value={row.joinedAt} />,
  },
];

export const TEAM_MEMBER_COLUMNS = MEMBER_COLUMNS.filter(
  (column) => column.id !== "team",
);

export const TIVAZO_GROUP_COLUMNS: DataColumn<{ id: string; label: string }>[] = [
  {
    id: "name",
    header: "Tivazo group",
    width: "280px",
    sticky: true,
    flex: true,
    priority: 1,
    render: (row) => <CellText value={row.label} />,
  },
];

export const TEAM_COLUMNS: DataColumn<Team>[] = [
  {
    id: "name",
    header: "Department",
    width: "220px",
    sticky: true,
    align: "center",
    priority: 1,
    render: (row) => <CellText value={row.name} />,
  },
  {
    id: "members",
    header: "Member",
    width: "120px",
    align: "center",
    priority: 1,
    render: (row) => <CellText value={row.members} />,
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
  {
    id: "tracked",
    header: "Tracked",
    width: "88px",
    align: "right",
    priority: 1,
    render: (row) => {
      const m = workdayTimeMetrics({
        source: "bio",
        inTime: row.inTime,
        outTime: row.outTime,
      });
      return <CellText value={m.trackedLabel} />;
    },
  },
  {
    id: "shortfall",
    header: "Shortfall",
    width: "88px",
    align: "right",
    priority: 2,
    render: (row) => {
      const m = workdayTimeMetrics({
        source: "bio",
        inTime: row.inTime,
        outTime: row.outTime,
      });
      return <CellText value={m.shortfallLabel} tone={m.met ? "ok" : "primary"} />;
    },
  },
];
