"use client";

import { CellText, PersonCell } from "@/components/data/cells";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable, type DataColumn } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { StatusPill } from "@/components/data/StatusPill";
import { FilterSearch } from "@/components/ui/FilterSearch";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useMenu } from "@/hooks/use-menu";
import {
  ApiError,
  apiSend,
  useQuery,
  type ListPage,
  type MemberDirectoryRow,
  type OffboardingDiscrepancies,
  type OffboardingDiscrepancy,
  type OffboardingList,
  type OffboardingRecord,
} from "@/lib/api";
import { formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { DoorOpen, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const EMPTY_RECORDS: OffboardingRecord[] = [];
const EMPTY_ISSUES: OffboardingDiscrepancy[] = [];

const REASON_SUGGESTIONS = ["Better opportunity", "Personal reasons", "Relocation", "Higher studies", "Contract end"];

const KIND_LABEL: Record<OffboardingDiscrepancy["kind"], string> = {
  still_active: "Still active",
  inactive_without_record: "No resignation record",
  not_in_systems: "Not found",
};

type Draft = {
  employeeName: string;
  employeeEmail: string;
  memberId: string;
  team: string;
  resignationDate: string;
  lastWorkingDate: string;
  reason: string;
  notes: string;
};

function emptyDraft(): Draft {
  const today = isoDateInZone();
  return {
    employeeName: "",
    employeeEmail: "",
    memberId: "",
    team: "",
    resignationDate: today,
    lastWorkingDate: today,
    reason: "",
    notes: "",
  };
}

function draftFrom(record: OffboardingRecord): Draft {
  return {
    employeeName: record.employeeName,
    employeeEmail: record.employeeEmail,
    memberId: record.memberId,
    team: record.team,
    resignationDate: record.resignationDate,
    lastWorkingDate: record.lastWorkingDate,
    reason: record.reason,
    notes: record.notes,
  };
}

function validate(draft: Draft): string {
  if (!draft.employeeName.trim()) return "Enter the employee name.";
  if (!draft.employeeEmail.trim() && !draft.memberId.trim()) {
    return "Enter the employee email so the record matches Tivazo and Biometrics.";
  }
  if (!draft.resignationDate) return "Choose the resignation date.";
  if (!draft.lastWorkingDate) return "Choose the confirmed last working date.";
  if (draft.lastWorkingDate < draft.resignationDate) {
    return "The last working date cannot be before the resignation date.";
  }
  if (draft.notes.length > 1000) return "Keep notes under 1000 characters.";
  return "";
}

const recordColumns: DataColumn<OffboardingRecord>[] = [
  {
    id: "employee",
    header: "Employee",
    width: "260px",
    sticky: true,
    flex: true,
    person: true,
    render: (row) => <PersonCell name={row.employeeName} email={row.employeeEmail} />,
  },
  {
    id: "status",
    header: "Status",
    width: "130px",
    render: (row) => <StatusPill value={row.status} />,
  },
  {
    id: "team",
    header: "Team",
    width: "170px",
    priority: 2,
    render: (row) => <CellText value={row.team} tone="muted" />,
  },
  {
    id: "resigned",
    header: "Resigned on",
    width: "130px",
    priority: 2,
    render: (row) => <CellText value={formatDisplayDate(row.resignationDate)} />,
  },
  {
    id: "last",
    header: "Last working day",
    width: "150px",
    render: (row) => <CellText value={formatDisplayDate(row.lastWorkingDate)} />,
  },
  {
    id: "effective",
    header: "Off headcount from",
    width: "160px",
    priority: 2,
    render: (row) => <CellText value={formatDisplayDate(row.effectiveDate)} tone="muted" />,
  },
  {
    id: "reason",
    header: "Reason",
    width: "170px",
    priority: 3,
    render: (row) => <CellText value={row.reason} tone="muted" />,
  },
  {
    id: "by",
    header: "Recorded by",
    width: "150px",
    priority: 3,
    render: (row) => <CellText value={row.recordedBy} tone="muted" />,
  },
];

const issueColumns: DataColumn<OffboardingDiscrepancy>[] = [
  {
    id: "employee",
    header: "Employee",
    width: "260px",
    sticky: true,
    flex: true,
    person: true,
    render: (row) => <PersonCell name={row.name} email={row.email} />,
  },
  {
    id: "kind",
    header: "Issue",
    width: "190px",
    render: (row) => <CellText value={KIND_LABEL[row.kind]} />,
  },
  {
    id: "systems",
    header: "Systems",
    width: "170px",
    priority: 2,
    render: (row) => <CellText value={row.systems.join(", ")} tone="muted" />,
  },
  {
    id: "last",
    header: "Last working day",
    width: "150px",
    priority: 2,
    render: (row) => <CellText value={row.lastWorkingDate ? formatDisplayDate(row.lastWorkingDate) : ""} />,
  },
  {
    id: "detail",
    header: "What to fix",
    width: "420px",
    flex: true,
    render: (row) => <CellText value={row.detail} tone="muted" />,
  },
];

export function OffboardingManager() {
  const [tab, setTab] = useState<"records" | "issues">("records");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<OffboardingRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const list = useQuery<OffboardingList>(`/offboarding?rev=${revision}`);
  const issues = useQuery<OffboardingDiscrepancies>(
    tab === "issues" ? `/offboarding/discrepancies?rev=${revision}` : null,
  );
  const members = useQuery<ListPage<MemberDirectoryRow>>(
    creating ? "/members?all=1" : null,
  );

  const needle = useDebouncedValue(query.trim().toLowerCase(), 200);
  const records = list.data?.items ?? EMPTY_RECORDS;
  const filtered = useMemo(
    () =>
      needle
        ? records.filter((row) =>
            [row.employeeName, row.employeeEmail, row.team, row.reason, row.recordedBy]
              .join(" ")
              .toLowerCase()
              .includes(needle),
          )
        : records,
    [records, needle],
  );
  const notice = records.filter((row) => row.status === "Serving notice").length;
  const resigned = records.length - notice;
  const issueRows = issues.data?.items ?? EMPTY_ISSUES;

  const memberChoices = members.data?.items ?? [];

  function openCreate() {
    setSelected(null);
    setError("");
    setDraft(emptyDraft());
    setCreating(true);
  }

  function openRecord(record: OffboardingRecord) {
    setCreating(false);
    setError("");
    setDraft(draftFrom(record));
    setSelected((current) => (current?.id === record.id ? null : record));
  }

  function close() {
    if (saving) return;
    setCreating(false);
    setSelected(null);
    setError("");
  }

  function pickMember(name: string) {
    const match = memberChoices.find((member) => member.name === name);
    if (!match) return;
    setDraft((current) => ({
      ...current,
      employeeName: match.name,
      employeeEmail: match.email || current.employeeEmail,
      memberId: match.id,
      team: current.team || match.teamName || "",
    }));
  }

  async function save() {
    if (busyRef.current) return;
    const issue = validate(draft);
    if (issue) {
      setError(issue);
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError("");
    try {
      await apiSend<OffboardingRecord>("/offboarding", "POST", draft);
      setCreating(false);
      setSelected(null);
      setRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save this record.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  async function withdraw() {
    if (busyRef.current || !selected) return;
    if (!window.confirm(`Withdraw the resignation record for ${selected.employeeName}? They will count toward headcount again.`)) {
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError("");
    try {
      await apiSend<{ ok: boolean }>(`/offboarding?id=${encodeURIComponent(selected.id)}`, "DELETE");
      setSelected(null);
      setRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not withdraw this record.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  const editing = creating || selected !== null;

  return (
    <div className="smp-page-stack smp-page-stack--fill" data-inspector={editing ? "true" : "false"}>
      <div className="smp-stage">
        <ControlBar
          stats={
            tab === "records"
              ? [
                  { label: "Records", value: String(records.length) },
                  { label: "Serving notice", value: String(notice) },
                  { label: "Resigned", value: String(resigned) },
                ]
              : [{ label: "To fix", value: String(issueRows.length) }]
          }
        >
          <div className="smp-filters--inline">
            <button
              type="button"
              className={tab === "records" ? "smp-users-new" : "smp-users-ghost"}
              aria-pressed={tab === "records"}
              onClick={() => setTab("records")}
            >
              Records
            </button>
            <button
              type="button"
              className={tab === "issues" ? "smp-users-new" : "smp-users-ghost"}
              aria-pressed={tab === "issues"}
              onClick={() => setTab("issues")}
            >
              Discrepancies
            </button>
            {tab === "records" ? (
              <>
                <FilterSearch value={query} onChange={setQuery} placeholder="Employee, team, reason" />
                <button type="button" className="smp-users-new" onClick={openCreate}>
                  <DoorOpen size={15} strokeWidth={1.75} />
                  Record resignation
                </button>
              </>
            ) : null}
          </div>
        </ControlBar>

        {tab === "records" ? (
          list.error && records.length === 0 ? (
            <QueryState loading={false} error={list.error} onRetry={list.reload} label="resignations" />
          ) : (
            <DataTable
              columns={recordColumns}
              rows={filtered}
              getKey={(row) => row.id}
              selectedKey={selected?.id ?? null}
              empty={
                list.loading
                  ? "Loading resignations…"
                  : needle
                    ? "No records match this search."
                    : "No resignations recorded yet."
              }
              refreshing={list.loading || list.refreshing}
              resetKey={`${needle}:${revision}`}
              onRowClick={openRecord}
            />
          )
        ) : issues.error && issueRows.length === 0 ? (
          <QueryState loading={false} error={issues.error} onRetry={issues.reload} label="discrepancies" />
        ) : (
          <>
            <DataTable
              columns={issueColumns}
              rows={issueRows}
              getKey={(row) => `${row.kind}:${row.recordId || row.email || row.name}`}
              selectedKey={null}
              empty={
                issues.loading
                  ? "Checking Tivazo and Biometrics…"
                  : "No discrepancies. Resignation records match Tivazo and Biometrics."
              }
              refreshing={issues.loading || issues.refreshing}
              resetKey={`issues:${revision}`}
              onRowClick={() => undefined}
            />
            {issues.data ? (
              <p className="smp-transfer-note">
                Checked against today’s Tivazo and Biometrics rosters ({formatDisplayDate(issues.data.asOf)}).
              </p>
            ) : null}
          </>
        )}
      </div>

      <OffboardingPanel
        open={editing}
        isNew={creating}
        record={selected}
        draft={draft}
        memberNames={memberChoices.map((member) => member.name).filter(Boolean)}
        error={error}
        saving={saving}
        onChange={setDraft}
        onPickMember={pickMember}
        onClose={close}
        onSave={save}
        onWithdraw={withdraw}
      />
    </div>
  );
}

type PanelProps = {
  open: boolean;
  isNew: boolean;
  record: OffboardingRecord | null;
  draft: Draft;
  memberNames: string[];
  error: string;
  saving: boolean;
  onChange: (draft: Draft) => void;
  onPickMember: (name: string) => void;
  onClose: () => void;
  onSave: () => void;
  onWithdraw: () => void;
};

function OffboardingPanel({
  open,
  isNew,
  record,
  draft,
  memberNames,
  error,
  saving,
  onChange,
  onPickMember,
  onClose,
  onSave,
  onWithdraw,
}: PanelProps) {
  const namesId = useId();
  const reasonId = useId();
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => {
      if (!saving) onClose();
    },
  });

  if (!open || typeof document === "undefined") return null;

  const panel = (
    <div
      id={menuId}
      ref={rootRef}
      className="smp-inspector smp-inspector--users"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smp-offboarding-title"
    >
      <header className="smp-inspector__head">
        <div className="smp-inspector__head-start">
          <div>
            <h2 id="smp-offboarding-title" className="smp-inspector__title">
              {isNew ? "Record resignation" : record?.employeeName}
            </h2>
            <p className="smp-inspector__meta">
              {isNew
                ? "Confirm the last working date. They leave active headcount the day after."
                : `${record?.status} · off headcount from ${record ? formatDisplayDate(record.effectiveDate) : ""}`}
            </p>
          </div>
        </div>
        <button type="button" className="smp-icon-btn" aria-label="Close" onClick={onClose} disabled={saving}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className="smp-inspector__body smp-users-editor">
        <label className="smp-users-field">
          <span>Employee name</span>
          <input
            list={namesId}
            value={draft.employeeName}
            disabled={saving || !isNew}
            maxLength={120}
            onChange={(event) => {
              onChange({ ...draft, employeeName: event.target.value });
              onPickMember(event.target.value);
            }}
            placeholder="Start typing to pick from Tivazo / Biometrics"
            autoFocus
          />
        </label>
        <datalist id={namesId}>
          {memberNames.slice(0, 500).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <label className="smp-users-field">
          <span>Employee email</span>
          <input
            type="email"
            value={draft.employeeEmail}
            disabled={saving || !isNew}
            maxLength={120}
            onChange={(event) => onChange({ ...draft, employeeEmail: event.target.value })}
            placeholder="Must match the email in Tivazo and Biometrics"
          />
        </label>
        <label className="smp-users-field">
          <span>Team</span>
          <input
            value={draft.team}
            disabled={saving}
            maxLength={120}
            onChange={(event) => onChange({ ...draft, team: event.target.value })}
          />
        </label>
        <label className="smp-users-field">
          <span>Resignation date</span>
          <input
            type="date"
            value={draft.resignationDate}
            disabled={saving}
            onChange={(event) => onChange({ ...draft, resignationDate: event.target.value })}
          />
        </label>
        <label className="smp-users-field">
          <span>Confirmed last working date</span>
          <input
            type="date"
            value={draft.lastWorkingDate}
            min={draft.resignationDate || undefined}
            disabled={saving}
            onChange={(event) => onChange({ ...draft, lastWorkingDate: event.target.value })}
          />
        </label>
        <label className="smp-users-field">
          <span>Reason (optional)</span>
          <input
            list={reasonId}
            value={draft.reason}
            disabled={saving}
            maxLength={120}
            onChange={(event) => onChange({ ...draft, reason: event.target.value })}
          />
        </label>
        <datalist id={reasonId}>
          {REASON_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <label className="smp-users-field">
          <span>Notes (optional)</span>
          <textarea
            value={draft.notes}
            disabled={saving}
            maxLength={1000}
            rows={4}
            onChange={(event) => onChange({ ...draft, notes: event.target.value })}
            placeholder="Handover, clearance, approvals"
          />
        </label>

        {error ? (
          <p className="smp-login__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="smp-users-editor__foot">
        {!isNew && record ? (
          <button type="button" className="smp-users-ghost" onClick={onWithdraw} disabled={saving}>
            Withdraw record
          </button>
        ) : null}
        <button type="button" className="smp-users-ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="smp-users-new" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : isNew ? "Record resignation" : "Save changes"}
        </button>
      </footer>
    </div>
  );

  return createPortal(panel, document.body);
}
