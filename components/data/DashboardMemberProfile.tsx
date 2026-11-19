"use client";

import type { DashboardMemberFocus } from "@/lib/api";
import { workdayTimeMetrics } from "@/lib/tracked-time";
import type { ReactNode } from "react";

function fact(value: ReactNode): ReactNode {
  if (value == null) return "—";
  if (typeof value === "string") return value.trim() || "—";
  return value;
}

function displayStatus(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  if (/^tracking$/i.test(raw)) return "Active";
  return raw;
}

function statusTone(value: string): "ok" | "warn" | "bad" | "neutral" {
  const compact = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["present", "active", "tracking"].includes(compact)) return "ok";
  if (["leave", "onleave", "idle", "halfday"].includes(compact)) return "warn";
  if (["absent", "offline", "inactive", "missing"].includes(compact)) return "bad";
  return "neutral";
}

function SourceColumn({
  title,
  available,
  status,
  rows,
}: {
  title: string;
  available: boolean;
  status: string;
  rows: {
    label: string;
    value: ReactNode;
    tone?: "ok" | "warn" | "bad" | "neutral";
  }[];
}) {
  const label = available ? displayStatus(status) : "Not linked";
  const tone = available ? statusTone(label) : "neutral";
  return (
    <article
      className="smp-dashboard-member__source"
      data-empty={available ? "false" : "true"}
      data-source={title.toLowerCase()}
    >
      <header className="smp-dashboard-member__source-head">
        <h3 className="smp-dashboard-member__source-title">{title}</h3>
        <p className="smp-dashboard-member__status" data-tone={tone} title={label || "No status"}>
          <span className="smp-dashboard-member__status-dot" aria-hidden="true" />
          <span>{fact(label)}</span>
        </p>
      </header>
      {available ? (
        <dl className="smp-dashboard-member__facts">
          {rows.map((row) => (
            <div key={row.label} className="smp-dashboard-member__fact">
              <dt>{row.label}</dt>
              <dd
                className={
                  row.tone === "ok"
                    ? "smp-cell-text--ok"
                    : row.tone === "bad"
                      ? "smp-cell-text--bad"
                      : undefined
                }
              >
                {fact(row.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="smp-dashboard-member__empty">
          No record on this platform for the selected person.
        </p>
      )}
    </article>
  );
}

export function DashboardMemberProfile({ member }: { member: DashboardMemberFocus }) {
  const hasBio = member.sources.includes("Biometrics");
  const hasTivazo = member.sources.includes("Tivazo");
  const bioMetrics = workdayTimeMetrics({
    source: "bio",
    inTime: member.biometrics.inTime,
    outTime: member.biometrics.outTime,
  });
  const tivazoMetrics = workdayTimeMetrics({
    source: "tivazo",
    trackedTime: member.tivazo.tracked,
    inTime: member.tivazo.inTime,
    outTime: member.tivazo.outTime,
  });

  return (
    <section className="smp-panel smp-dashboard-panel smp-dashboard-member" aria-label="Member overview">
      <header className="smp-dashboard-member__head">
        <div className="smp-dashboard-member__identity">
          <p className="smp-dashboard-member__eyebrow">Selected member</p>
          <h2 className="smp-dashboard-member__name">{member.name || "Selected member"}</h2>
          <p className="smp-dashboard-member__meta">
            {[member.email, member.employeeId].filter(Boolean).join(" · ") ||
              "Linked across Biometrics and Tivazo"}
          </p>
        </div>
        <div className="smp-dashboard-member__pills" aria-label="Data sources">
          <span className="smp-dashboard-member__pill" data-on={hasBio ? "true" : "false"}>
            Biometrics {hasBio ? "linked" : "missing"}
          </span>
          <span className="smp-dashboard-member__pill" data-on={hasTivazo ? "true" : "false"}>
            Tivazo {hasTivazo ? "linked" : "missing"}
          </span>
        </div>
      </header>
      <div className="smp-dashboard-member__grid">
        <SourceColumn
          title="Biometrics"
          available={hasBio}
          status={member.biometrics.day}
          rows={[
            { label: "In", value: member.biometrics.inTime },
            { label: "Out", value: member.biometrics.outTime },
            { label: "Goal time", value: bioMetrics.targetLabel },
            { label: "Actual shift", value: bioMetrics.trackedLabel },
            {
              label: "Time needed",
              value:
                bioMetrics.trackedSeconds > 0
                  ? bioMetrics.met
                    ? "Goal met"
                    : `${bioMetrics.shortfallLabel} needed`
                  : "—",
              tone: bioMetrics.trackedSeconds > 0 ? (bioMetrics.met ? "ok" : "bad") : undefined,
            },
            {
              label: "Target status",
              value:
                bioMetrics.trackedSeconds > 0
                  ? bioMetrics.met
                    ? "Met"
                    : "Not met"
                  : "—",
              tone: bioMetrics.trackedSeconds > 0 ? (bioMetrics.met ? "ok" : "bad") : undefined,
            },
            { label: "Team", value: member.biometrics.department },
            { label: "Role", value: member.biometrics.designation },
          ]}
        />
        <SourceColumn
          title="Tivazo"
          available={hasTivazo}
          status={member.tivazo.live || member.tivazo.day}
          rows={[
            { label: "In", value: member.tivazo.inTime },
            { label: "Out", value: member.tivazo.outTime },
            { label: "Goal time", value: tivazoMetrics.targetLabel },
            { label: "Actual tracked", value: tivazoMetrics.trackedLabel },
            {
              label: "Time needed",
              value:
                tivazoMetrics.trackedSeconds > 0
                  ? tivazoMetrics.met
                    ? "Goal met"
                    : `${tivazoMetrics.shortfallLabel} needed`
                  : "—",
              tone: tivazoMetrics.trackedSeconds > 0 ? (tivazoMetrics.met ? "ok" : "bad") : undefined,
            },
            {
              label: "Target status",
              value:
                tivazoMetrics.trackedSeconds > 0
                  ? tivazoMetrics.met
                    ? "Met"
                    : "Not met"
                  : "—",
              tone: tivazoMetrics.trackedSeconds > 0 ? (tivazoMetrics.met ? "ok" : "bad") : undefined,
            },
            { label: "Team", value: member.tivazo.group },
            { label: "Role", value: member.tivazo.designation },
          ]}
        />
      </div>
    </section>
  );
}
