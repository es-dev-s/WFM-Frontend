"use client";

import type { DashboardMemberFocus } from "@/lib/api";

function fact(value: string): string {
  return value.trim() || "—";
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
  rows: { label: string; value: string }[];
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
              <dd>{fact(row.value)}</dd>
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
            { label: "Team", value: member.biometrics.department },
            { label: "Role", value: member.biometrics.designation },
            { label: "Joined", value: member.biometrics.joined },
          ]}
        />
        <SourceColumn
          title="Tivazo"
          available={hasTivazo}
          status={member.tivazo.live || member.tivazo.day}
          rows={[
            { label: "In", value: member.tivazo.inTime },
            { label: "Out", value: member.tivazo.outTime },
            { label: "Team", value: member.tivazo.group },
            { label: "Role", value: member.tivazo.designation },
            { label: "Tracked", value: member.tivazo.tracked },
          ]}
        />
      </div>
    </section>
  );
}
