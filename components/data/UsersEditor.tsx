"use client";

import {
  assignmentKey,
  assignmentLabel,
  generateLeadPassword,
  roleLabel,
  type UserDraft,
} from "@/components/data/users-admin";
import { useMenu } from "@/hooks/use-menu";
import type { FilterOption, TeamAssignment } from "@/lib/api";
import { Check, ChevronDown, Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function UsersEditor({
  open,
  draft,
  error,
  saving,
  removing,
  tivazo,
  biometrics,
  onChange,
  onToggle,
  onClose,
  onSave,
  onDelete,
  currentUserId,
  lastActiveSuperadmin,
}: {
  open: boolean;
  draft: UserDraft | null;
  error: string;
  saving: boolean;
  removing: boolean;
  tivazo: FilterOption[];
  biometrics: FilterOption[];
  onChange: (draft: UserDraft | null) => void;
  onToggle: (item: TeamAssignment) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  currentUserId: string;
  lastActiveSuperadmin: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "disable" | null>(null);
  const copyTimer = useRef<number>(0);
  const creating = Boolean(draft && !draft.id);
  const self = Boolean(draft?.id && draft.id === currentUserId);
  const superadmin = draft?.role === "wfm";
  const orgWide = draft?.role === "wfm" || draft?.role === "hr";
  const protectLast =
    Boolean(superadmin && lastActiveSuperadmin && draft?.initialStatus === "active" && !creating);
  const canRemove = Boolean(draft?.id && !self && !protectLast);
  const canDisable = !self && !protectLast;
  const busy = saving || removing;
  const draftKey = draft ? draft.id ?? "new" : "";
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setCopied(false);
    setConfirm(null);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, [draftKey]);

  if (!mounted || !open || !draft || typeof document === "undefined") return null;

  const panel = (
    <div
      id={menuId}
      ref={rootRef}
      className="smp-inspector smp-inspector--users"
      role="dialog"
      aria-modal="true"
      aria-labelledby="smp-users-editor-title"
    >
      <header className="smp-inspector__head">
        <div className="smp-inspector__head-start">
          <div>
            <h2 id="smp-users-editor-title" className="smp-inspector__title">
              {confirm === "delete"
                ? `Remove ${roleLabel(draft.role).toLowerCase()}`
                : confirm === "disable"
                  ? "Disable access"
                  : creating
                    ? "New user"
                    : draft.name || roleLabel(draft.role)}
            </h2>
            <p className="smp-inspector__meta">
              {confirm
                ? draft.email
                : creating
                  ? "Choose a role, then add name and password"
                  : `${roleLabel(draft.role)}${self ? " · you" : ""}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="smp-icon-btn"
          aria-label="Close"
          onClick={onClose}
          disabled={busy}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className="smp-inspector__body smp-users-editor">
        {confirm ? (
          <div className="smp-users-confirm" role="alertdialog" aria-labelledby="smp-users-confirm-title">
            <strong id="smp-users-confirm-title">
              {confirm === "delete"
                ? `Remove ${draft.name || roleLabel(draft.role)}?`
                : `Disable ${draft.name || roleLabel(draft.role)}?`}
            </strong>
            <p>
              {confirm === "delete"
                ? "They lose access immediately. This cannot be undone."
                : "They will be signed out now and cannot sign in until you enable the account again."}
            </p>
          </div>
        ) : (
          <>
            {draft.justCreated ? (
              <div className="smp-users-notice" role="status">
                <strong>{roleLabel(draft.role)} created</strong>
                <p>Copy the password now. It is not emailed and will not be shown again after you close this panel.</p>
              </div>
            ) : null}
            <label className="smp-users-field">
              <span>Role</span>
              <select
                value={draft.role}
                disabled={self || busy}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    role: event.target.value as UserDraft["role"],
                    assignments:
                      event.target.value === "wfm" || event.target.value === "hr"
                        ? []
                        : draft.assignments,
                  })
                }
              >
                <option value="team_lead">Team lead</option>
                <option value="hr">HR</option>
                <option value="wfm">Superadmin</option>
              </select>
            </label>
            <label className="smp-users-field">
              <span>Name</span>
              <input
                value={draft.name}
                disabled={busy}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
                placeholder="Full name"
              />
            </label>
            <label className="smp-users-field">
              <span>Email</span>
              <input
                type="email"
                value={draft.email}
                disabled={busy}
                onChange={(event) => onChange({ ...draft, email: event.target.value })}
                placeholder="nina.v@example.com"
              />
            </label>
            <label className="smp-users-field">
              <span>{creating ? "Password" : draft.justCreated ? "Password" : "New password"}</span>
              <div className="smp-users-password">
                <input
                  value={draft.password}
                  disabled={busy}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      password: event.target.value,
                      passwordTouched: true,
                    })
                  }
                  placeholder={
                    creating || draft.justCreated
                      ? "At least 12 characters"
                      : "Leave blank to keep"
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onChange({
                      ...draft,
                      password: generateLeadPassword(),
                      passwordTouched: true,
                    });
                    setCopied(false);
                  }}
                >
                  Generate
                </button>
                <button
                  type="button"
                  className="smp-users-password__icon"
                  aria-label={copied ? "Copied" : "Copy password"}
                  disabled={!draft.password || busy}
                  onClick={async () => {
                    if (!draft.password) return;
                    try {
                      await navigator.clipboard.writeText(draft.password);
                      setCopied(true);
                      if (copyTimer.current) window.clearTimeout(copyTimer.current);
                      copyTimer.current = window.setTimeout(() => setCopied(false), 1400) as unknown as number;
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
                </button>
              </div>
            </label>
            {creating || draft.justCreated ? (
              <p className="smp-users-hint">Letters and numbers · 12+ characters · share this once.</p>
            ) : (
              <p className="smp-users-hint">Leave blank to keep the current password.</p>
            )}
            {!creating ? (
              <label className="smp-users-field">
                <span>Status</span>
                <select
                  value={draft.status}
                  disabled={!canDisable || busy}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      status: event.target.value as UserDraft["status"],
                    })
                  }
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            ) : null}
            {self ? <p className="smp-users-hint">You cannot disable or remove your own account.</p> : null}
            {protectLast && !self ? (
              <p className="smp-users-hint">This is the last active Superadmin, so it cannot be disabled or removed.</p>
            ) : null}

            {orgWide ? (
              <div className="smp-users-notice">
                <strong>Full workspace</strong>
                <p>
                  {superadmin
                    ? "Superadmins can see every Tivazo group and Biometrics department. Team assignment is not needed."
                    : "HR can see every Tivazo group and Biometrics department, same as Superadmin. Team assignment is not needed."}
                </p>
              </div>
            ) : (
              <>
                <div className="smp-users-selected">
                  {draft.assignments.length === 0 ? (
                    <p>Choose at least one Tivazo group or Biometrics department.</p>
                  ) : (
                    draft.assignments.map((item) => (
                      <button
                        key={assignmentKey(item)}
                        type="button"
                        className="smp-users-chip"
                        data-source={item.source}
                        onClick={() => onToggle(item)}
                        disabled={busy}
                      >
                        {assignmentLabel(
                          item,
                          item.source === "tivazo" ? tivazo : biometrics,
                        )}
                        <X size={12} strokeWidth={2} />
                      </button>
                    ))
                  )}
                </div>
                <TeamPicker
                  title="Tivazo"
                  source="tivazo"
                  options={tivazo}
                  selected={draft.assignments}
                  onToggle={onToggle}
                  disabled={busy}
                />
                <TeamPicker
                  title="Biometrics"
                  source="biometrics"
                  options={biometrics}
                  selected={draft.assignments}
                  onToggle={onToggle}
                  disabled={busy}
                />
              </>
            )}
          </>
        )}

        {error ? (
          <p className="smp-login__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="smp-users-editor__foot">
        {confirm ? (
          <>
            <button
              type="button"
              className="smp-users-ghost"
              onClick={() => setConfirm(null)}
              disabled={busy}
            >
              Back
            </button>
            <button
              type="button"
              className="smp-users-danger"
              onClick={confirm === "delete" ? onDelete : onSave}
              disabled={busy}
            >
              {confirm === "delete"
                ? removing
                  ? "Removing…"
                  : "Remove account"
                : saving
                  ? "Saving…"
                  : "Disable account"}
            </button>
          </>
        ) : (
          <>
            {creating || !canRemove ? null : (
              <button
                type="button"
                className="smp-users-danger"
                onClick={() => setConfirm("delete")}
                disabled={busy}
              >
                Remove
              </button>
            )}
            <button type="button" className="smp-users-ghost" onClick={onClose} disabled={busy}>
              {draft.justCreated ? "Done" : "Cancel"}
            </button>
            <button
              type="button"
              className="smp-users-new"
              onClick={() => {
                if (
                  !creating &&
                  canDisable &&
                  draft.status === "disabled" &&
                  draft.initialStatus !== "disabled"
                ) {
                  setConfirm("disable");
                  return;
                }
                onSave();
              }}
              disabled={busy}
            >
              {saving
                ? "Saving…"
                : creating
                  ? `Create ${roleLabel(draft.role).toLowerCase()}`
                  : "Save changes"}
            </button>
          </>
        )}
      </footer>
    </div>
  );

  return createPortal(panel, document.body);
}

function TeamPicker({
  title,
  source,
  options,
  selected,
  onToggle,
  disabled = false,
}: {
  title: string;
  source: TeamAssignment["source"];
  options: FilterOption[];
  selected: TeamAssignment[];
  onToggle: (item: TeamAssignment) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { menuId, rootRef } = useMenu({
    open,
    onClose: () => {
      setOpen(false);
      setSearch("");
    },
  });
  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setSearch("");
  }, [disabled]);
  const chosen = selected.filter((entry) => entry.source === source);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      options.filter((item) =>
        needle ? item.label.toLowerCase().includes(needle) : true,
      ),
    [options, needle],
  );
  const summary =
    chosen.length === 0
      ? `Select ${title} teams`
      : `${chosen.length} of ${options.length} selected`;

  return (
    <div className="smp-users-picker" ref={rootRef} data-open={open ? "true" : "false"}>
      <span className="smp-users-field">
        <span>
          {title}
          {chosen.length > 0 ? <em>{chosen.length}</em> : null}
        </span>
      </span>
      <button
        type="button"
        className="smp-users-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span>{options.length === 0 ? `Loading ${title} teams…` : summary}</span>
        <ChevronDown size={14} strokeWidth={1.75} />
      </button>
      <div className="smp-users-picker__menu" id={menuId} hidden={!open}>
        <input
          type="search"
          value={search}
          placeholder={`Search ${title} teams`}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="smp-users-picker__list" role="listbox" aria-label={title}>
          {visible.length === 0 ? (
            <p className="smp-users-source__empty">No teams match.</p>
          ) : (
            visible.map((option) => {
              const item = { source, teamId: option.id, teamLabel: option.label };
              const on = chosen.some((entry) => assignmentKey(entry) === assignmentKey(item));
              return (
                <button
                  key={`${source}-${option.id}`}
                  type="button"
                  className="smp-users-check"
                  role="option"
                  aria-selected={on}
                  data-on={on ? "true" : "false"}
                  disabled={disabled}
                  onClick={() => onToggle(item)}
                >
                  <span>{option.label}</span>
                  {on ? <Check size={14} strokeWidth={2} /> : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
