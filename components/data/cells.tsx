import { StatusPill } from "@/components/data/StatusPill";
import type { DailyLogRow, Member, MemberComposition } from "@/lib/api";
import { formatInstantMs } from "@/lib/datetime";
import type { ReactNode } from "react";

export function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text === "" ? "—" : text;
}

export function joinGroups(groups: string[] | undefined, fallback = ""): string {
  const names = (groups ?? []).map((item) => item.trim()).filter(Boolean);
  if (names.length === 0) return fallback || "—";
  return names.join(", ");
}

export function CellText({
  value,
  tone = "primary",
}: {
  value: string | number | null | undefined;
  tone?: "primary" | "muted";
}) {
  const text = dash(value);
  return (
    <span
      className={tone === "muted" ? "smp-cell-text smp-muted" : "smp-cell-text"}
      title={text === "—" ? undefined : text}
    >
      {text}
    </span>
  );
}

export function IdCell({
  value,
}: {
  value: string | number | null | undefined;
}) {
  const text = dash(value);
  return (
    <span className="smp-id-cell" title={text === "—" ? undefined : text}>
      {text}
    </span>
  );
}

export function PersonCell({
  name,
  email,
  avatarUrl,
  size = "md",
}: {
  name: string;
  email?: string;
  avatarUrl?: string;
  size?: "md" | "lg";
}) {
  const src = avatarUrl?.trim();
  const show = Boolean(src && /^https?:\/\//i.test(src));
  const fullName = dash(name);
  const mail = email ? dash(email) : "";
  return (
    <span
      className="smp-person"
      data-size={size}
      title={mail && mail !== "—" ? `${fullName} · ${mail}` : fullName}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="smp-person__avatar" src={src} alt="" />
      ) : (
        <span className="smp-person__mark" aria-hidden>
          {(fullName || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="smp-person__copy">
        <span className="smp-person__name">{fullName}</span>
        {mail && mail !== "—" ? (
          <span className="smp-person__email">{mail}</span>
        ) : null}
      </span>
    </span>
  );
}

export function GroupsCell({
  group,
  groups,
}: {
  group?: string;
  groups?: string[];
}) {
  const names = (groups ?? []).map((item) => item.trim()).filter(Boolean);
  const primary = dash(names[0] || group);
  const extra = Math.max(0, names.length - 1);
  return (
    <span className="smp-groups" title={joinGroups(names, primary)}>
      <span className="smp-cell-text">{primary}</span>
      {extra > 0 ? <span className="smp-pill smp-pill--count">+{extra}</span> : null}
    </span>
  );
}

export function CompositionBar({
  composition,
}: {
  composition: MemberComposition;
}) {
  const voice = Math.max(0, composition.voice);
  const chat = Math.max(0, composition.chat);
  const backoffice = Math.max(0, composition.backoffice);
  return (
    <div className="smp-mix">
      <div className="smp-mix__bar" aria-hidden>
        {voice > 0 ? (
          <span className="smp-mix__seg" data-kind="voice" style={{ width: `${voice}%` }} />
        ) : null}
        {chat > 0 ? (
          <span className="smp-mix__seg" data-kind="chat" style={{ width: `${chat}%` }} />
        ) : null}
        {backoffice > 0 ? (
          <span
            className="smp-mix__seg"
            data-kind="backoffice"
            style={{ width: `${backoffice}%` }}
          />
        ) : null}
      </div>
      <p className="smp-muted">
        Voice {voice}% · Chat {chat}% · Back office {backoffice}%
      </p>
    </div>
  );
}

function optionalStatus(value: string | undefined): ReactNode {
  const text = dash(value);
  return text === "—" ? "—" : <StatusPill value={text} />;
}

export type FactItem = { label: string; value: ReactNode; keep?: boolean };
export type FactGroup = { title: string; items: FactItem[] };

export function isEmptyFactValue(value: ReactNode, keep?: boolean): boolean {
  if (keep) return false;
  if (value == null || value === false) return true;
  if (typeof value === "number") return false;
  if (typeof value === "string") {
    const text = value.trim();
    return text === "" || text === "—";
  }
  return false;
}

export function visibleFactGroups(groups: FactGroup[]): FactGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !isEmptyFactValue(item.value, item.keep)),
    }))
    .filter((group) => group.items.length > 0);
}

export function RecordFacts({
  items,
}: {
  items: FactItem[];
}) {
  return (
    <dl className="smp-facts">
      {items.map((item) => (
        <div key={item.label} className="smp-facts__item">
          <dt className="smp-facts__label">{item.label}</dt>
          <dd
            className="smp-facts__value"
            title={typeof item.value === "string" ? item.value : undefined}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function activityFactGroups(row: DailyLogRow): FactGroup[] {
  const groupNames = joinGroups(row.groups, row.group);
  const primaryGroup = dash(row.group);
  return [
    {
      title: "Assignment",
      items: [
        {
          label: "Group",
          value: groupNames !== "—" ? groupNames : primaryGroup,
        },
        { label: "Role", value: dash(row.role) },
        { label: "Designation", value: dash(row.designation) },
      ],
    },
    {
      title: "This day",
      items: [
        { label: "Date", value: dash(row.date), keep: true },
        { label: "Day", value: optionalStatus(row.status), keep: true },
        { label: "In", value: dash(row.inTime), keep: true },
        { label: "Out", value: dash(row.outTime), keep: true },
        { label: "Tracked", value: dash(row.trackedTime), keep: true },
        { label: "Manual", value: dash(row.manualTime), keep: true },
        { label: "Clocked in", value: formatInstantMs(row.clockedInMs), keep: true },
      ],
    },
    {
      title: "Account",
      items: [
        { label: "User status", value: optionalStatus(row.userStatus) },
        { label: "Last active", value: dash(row.lastActiveAt) },
        { label: "All-time hours", value: row.allTimeWorkHour || "—" },
        {
          label: "Screenshot frequency",
          value: row.screenshotFrequency || "—",
        },
        { label: "Employee ID", value: dash(row.employeeId) },
      ],
    },
  ];
}

export function memberProfileFacts(
  member: Member,
  extras: { teamName?: string } = {},
): FactItem[] {
  return [
    { label: "Role", value: dash(member.role) },
    { label: "Designation", value: dash(member.designation) },
    { label: "Team", value: dash(extras.teamName || member.teamId) },
    { label: "Groups", value: joinGroups(member.groups) },
    { label: "Reports to", value: dash(member.reportsTo) },
    { label: "Last active", value: dash(member.lastActiveAt) },
  ].filter((item) => !isEmptyFactValue(item.value));
}

export function memberFactGroups(
  member: Member,
  extras: { teamName?: string } = {},
): FactGroup[] {
  return [
    {
      title: "Assignment",
      items: [
        { label: "Role", value: dash(member.role) },
        { label: "Designation", value: dash(member.designation) },
        { label: "Team", value: dash(extras.teamName || member.teamId) },
        { label: "Groups", value: joinGroups(member.groups) },
        { label: "Reports to", value: dash(member.reportsTo) },
      ],
    },
    {
      title: "Activity",
      items: [
        { label: "User status", value: optionalStatus(member.userStatus) },
        { label: "Last active", value: dash(member.lastActiveAt) },
        { label: "All-time hours", value: member.allTimeWorkHour || "—" },
        {
          label: "Screenshot frequency",
          value: member.screenshotFrequency || "—",
        },
        { label: "Employee ID", value: dash(member.employeeId) },
      ],
    },
  ];
}
