"use client";

import { useMenu } from "@/hooks/use-menu";
import type { Transfer } from "@/lib/api";
import { formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { ArrowRight, X } from "lucide-react";
import { useId } from "react";
import { createPortal } from "react-dom";

export type TransferDraft = {
  employeeName: string;
  employeeEmail: string;
  previousTeam: string;
  newTeam: string;
  transferDate: string;
  reason: string;
  notes: string;
};

export const REASON_SUGGESTIONS = [
  "Employee request",
  "Business need",
  "Skills match",
  "Performance",
  "Restructure",
];

export function emptyTransferDraft(): TransferDraft {
  return {
    employeeName: "",
    employeeEmail: "",
    previousTeam: "",
    newTeam: "",
    transferDate: isoDateInZone(),
    reason: "",
    notes: "",
  };
}

export function validateTransferDraft(draft: TransferDraft): string {
  if (!draft.employeeName.trim()) return "Enter the employee name.";
  if (!draft.previousTeam.trim()) return "Enter the previous team.";
  if (!draft.newTeam.trim()) return "Enter the new team.";
  if (draft.previousTeam.trim().toLowerCase() === draft.newTeam.trim().toLowerCase()) {
    return "The new team must differ from the previous team.";
  }
  if (!draft.transferDate) return "Choose the transfer date.";
  if (draft.transferDate > isoDateInZone()) return "The transfer date cannot be in the future.";
  if (draft.notes.length > 1000) return "Keep details under 1000 characters.";
  return "";
}

type PanelProps = {
  mode: "view" | "create" | null;
  record: Transfer | null;
  draft: TransferDraft;
  teamOptions: string[];
  error: string;
  saving: boolean;
  onChange: (draft: TransferDraft) => void;
  onClose: () => void;
  onSave: () => void;
};

export function TransferPanel({
  mode,
  record,
  draft,
  teamOptions,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: PanelProps) {
  const listId = useId();
  const reasonId = useId();
  const open = mode === "create" || (mode === "view" && record !== null);
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => {
      if (!saving) onClose();
    },
  });

  // Only ever open after a click, so it never renders during SSR or hydration.
  if (!open || typeof document === "undefined") return null;
  const creating = mode === "create";

  const panel = (
    <div
      id={menuId}
      ref={rootRef}
      className="smp-inspector smp-inspector--users"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smp-transfer-title"
    >
      <header className="smp-inspector__head">
        <div className="smp-inspector__head-start">
          <div>
            <h2 id="smp-transfer-title" className="smp-inspector__title">
              {creating ? "Record transfer" : record?.employeeName}
            </h2>
            <p className="smp-inspector__meta">
              {creating
                ? "Log a move between teams"
                : `${record?.previousTeam} → ${record?.newTeam}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="smp-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={saving}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className="smp-inspector__body smp-users-editor">
        {creating ? (
          <>
            <label className="smp-users-field">
              <span>Employee name</span>
              <input
                value={draft.employeeName}
                disabled={saving}
                maxLength={120}
                onChange={(event) => onChange({ ...draft, employeeName: event.target.value })}
                placeholder="Full name"
                autoFocus
              />
            </label>
            <label className="smp-users-field">
              <span>Employee email (optional)</span>
              <input
                type="email"
                value={draft.employeeEmail}
                disabled={saving}
                maxLength={120}
                onChange={(event) => onChange({ ...draft, employeeEmail: event.target.value })}
                placeholder="name@example.com"
              />
            </label>
            <label className="smp-users-field">
              <span>Previous team</span>
              <input
                list={listId}
                value={draft.previousTeam}
                disabled={saving}
                maxLength={120}
                onChange={(event) => onChange({ ...draft, previousTeam: event.target.value })}
                placeholder="Team they are leaving"
              />
            </label>
            <label className="smp-users-field">
              <span>New team</span>
              <input
                list={listId}
                value={draft.newTeam}
                disabled={saving}
                maxLength={120}
                onChange={(event) => onChange({ ...draft, newTeam: event.target.value })}
                placeholder="Team they are joining"
              />
            </label>
            <datalist id={listId}>
              {teamOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <label className="smp-users-field">
              <span>Transfer date</span>
              <input
                type="date"
                value={draft.transferDate}
                max={isoDateInZone()}
                disabled={saving}
                onChange={(event) => onChange({ ...draft, transferDate: event.target.value })}
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
                placeholder="Why the move happened"
              />
            </label>
            <datalist id={reasonId}>
              {REASON_SUGGESTIONS.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <label className="smp-users-field">
              <span>Details (optional)</span>
              <textarea
                value={draft.notes}
                disabled={saving}
                maxLength={1000}
                rows={4}
                onChange={(event) => onChange({ ...draft, notes: event.target.value })}
                placeholder="Approvals, handover, effective notes"
              />
            </label>
          </>
        ) : record ? (
          <dl className="smp-transfer-facts">
            <Fact label="Employee" value={record.employeeName} />
            {record.employeeEmail ? <Fact label="Email" value={record.employeeEmail} /> : null}
            <div className="smp-transfer-facts__move">
              <span className="smp-users-chip">{record.previousTeam}</span>
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              <span className="smp-users-chip">{record.newTeam}</span>
            </div>
            <Fact label="Transfer date" value={formatDisplayDate(record.transferDate)} />
            <Fact label="Reason" value={record.reason} />
            <Fact label="Details" value={record.notes} multiline />
            <Fact label="Recorded by" value={record.recordedBy} />
            <Fact label="Recorded on" value={recordedOn(record.createdAt)} />
          </dl>
        ) : null}

        {error ? (
          <p className="smp-login__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="smp-users-editor__foot">
        <button type="button" className="smp-users-ghost" onClick={onClose} disabled={saving}>
          {creating ? "Cancel" : "Close"}
        </button>
        {creating ? (
          <button type="button" className="smp-users-new" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Record transfer"}
          </button>
        ) : null}
      </footer>
    </div>
  );

  return createPortal(panel, document.body);
}

function recordedOn(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Fact({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="smp-transfer-facts__row">
      <dt>{label}</dt>
      <dd data-multiline={multiline ? "true" : undefined}>{value.trim() || "—"}</dd>
    </div>
  );
}
