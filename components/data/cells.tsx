import { StatusPill } from "@/components/data/StatusPill";
import type { DailyLogRow, Member, MemberComposition } from "@/lib/api";
import { formatInstantMs } from "@/lib/datetime";
import { workdayTimeMetrics, type TrackedSource } from "@/lib/tracked-time";
import type { ReactNode } from "react";

export function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text === "" ? "—" : text;
}

const OPAQUE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readableToken(value: string | number | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text || OPAQUE_ID.test(text)) return "";
  return text;
}

export function joinGroups(groups: string[] | undefined, fallback = ""): string {
  const names = (groups ?? [])
    .map((item) => readableToken(item))
    .filter(Boolean);
  const extra = readableToken(fallback);
  if (names.length === 0) return extra || "—";
  return names.join(", ");
}

export function CellText({
  value,
  tone = "primary",
}: {
  value: string | number | null | undefined;
  tone?: "primary" | "muted" | "ok";
}) {
  const text = dash(value);
  const className =
    tone === "muted"
      ? "smp-cell-text smp-muted"
      : tone === "ok"
        ? "smp-cell-text smp-cell-text--ok"
        : "smp-cell-text";
  return (
    <span
      className={className}
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
  const text = dash(readableToken(value));
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
  offboarding,
}: {
  name: string;
  email?: string;
  avatarUrl?: string;
  size?: "md" | "lg";
  /** Resignation record, when HR has recorded one. */
  offboarding?: { status: string; lastWorkingDate: string };
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
        <span className="smp-person__name">
          {fullName}
          {offboarding ? (
            <span
              className="smp-pill smp-person__notice"
              data-tone={offboarding.status === "Resigned" ? "bad" : "warn"}
              title={`${offboarding.status} · last working day ${offboarding.lastWorkingDate}`}
            >
              {offboarding.status === "Resigned" ? "Resigned" : `Notice · ${offboarding.lastWorkingDate}`}
            </span>
          ) : null}
        </span>
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
  const names = (groups ?? [])
    .map((item) => readableToken(item))
    .filter(Boolean);
  const primary = dash(names[0] || readableToken(group));
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

export function activityFactGroups(
  row: DailyLogRow,
  source: TrackedSource = "auto",
): FactGroup[] {
  const groupNames = joinGroups(row.groups, row.group);
  const primaryGroup = dash(row.group);
  const metrics = workdayTimeMetrics({
    source,
    status: row.status,
    trackedTime: row.trackedTime,
    inTime: row.inTime,
    outTime: row.outTime,
  });

  const hasPunch = Boolean(row.inTime || row.outTime);
  const hasTracked = Boolean(
    row.trackedTime &&
      row.trackedTime !== "—" &&
      row.trackedTime !== "0:00:00" &&
      row.trackedTime !== "0h",
  );

  const bioMetrics =
    source === "tivazo" && hasPunch
      ? workdayTimeMetrics({
          source: "bio",
          status: row.status,
          inTime: row.inTime,
          outTime: row.outTime,
        })
      : null;

  const tivazoMetrics =
    source === "bio" && hasTracked
      ? workdayTimeMetrics({
          source: "tivazo",
          trackedTime: row.trackedTime,
        })
      : null;

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
        { label: "Live", value: optionalStatus(row.userStatus) },
      ],
    },
    {
      title: "Target & Performance",
      items: [
        {
          label: "Target metric",
          value: `${metrics.metricName} (Target: ${metrics.targetLabel})`,
          keep: true,
        },
        {
          label: "Target",
          value: metrics.targetLabel,
          keep: true,
        },
        {
          label: "Actual value",
          value: metrics.trackedLabel,
          keep: true,
        },
        {
          label: "Target status",
          value:
            metrics.trackedSeconds > 0
              ? metrics.met
                ? "Met"
                : `${metrics.shortfallLabel} needed`
              : "—",
          keep: true,
        },
        {
          label: "OT",
          value: metrics.overtimeLabel,
          keep: true,
        },
        ...(bioMetrics && bioMetrics.trackedSeconds > 0
          ? [
              {
                label: "Shift presence (Bio)",
                value: `Actual: ${bioMetrics.trackedLabel} vs Target: ${bioMetrics.targetLabel} (${bioMetrics.met ? "Met" : `${bioMetrics.shortfallLabel} needed`})`,
                keep: true,
              },
            ]
          : []),
        ...(tivazoMetrics && tivazoMetrics.trackedSeconds > 0
          ? [
              {
                label: "Active tracked (Tivazo)",
                value: `Actual: ${tivazoMetrics.trackedLabel} vs Target: ${tivazoMetrics.targetLabel} (${tivazoMetrics.met ? "Met" : `${tivazoMetrics.shortfallLabel} needed`})`,
                keep: true,
              },
            ]
          : []),
      ],
    },
    {
      title: "This day",
      items: [
        { label: "Date", value: dash(row.date), keep: true },
        { label: "Day", value: optionalStatus(row.status), keep: true },
        { label: "In", value: dash(row.inTime), keep: true },
        { label: "Out", value: dash(row.outTime), keep: true },
        { label: "Actual tracked", value: metrics.trackedLabel, keep: true },
        { label: "Goal time", value: metrics.targetLabel, keep: true },
        {
          label: "Target status",
          value:
            metrics.trackedSeconds > 0
              ? metrics.met
                ? "Met"
                : `${metrics.shortfallLabel} needed`
              : "—",
          keep: true,
        },
        {
          label: "OT",
          value: metrics.overtimeLabel,
          keep: true,
        },
        { label: "Manual", value: dash(row.manualTime), keep: true },
        { label: "Break", value: dash(row.breakTime), keep: true },
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
        { label: "Employee ID", value: dash(readableToken(row.employeeId)) },
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
    { label: "Joined", value: dash(member.joinedAt) },
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
        { label: "Joined", value: dash(member.joinedAt) },
        { label: "All-time hours", value: member.allTimeWorkHour || "—" },
        {
          label: "Screenshot frequency",
          value: member.screenshotFrequency || "—",
        },
        { label: "Employee ID", value: dash(readableToken(member.employeeId)) },
      ],
    },
  ];
}
