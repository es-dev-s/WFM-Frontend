"use client";

import { useSession } from "@/components/auth/SessionProvider";
import { CellText, PersonCell } from "@/components/data/cells";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable, type DataColumn } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import {
  TransferPanel,
  emptyTransferDraft,
  validateTransferDraft,
  type TransferDraft,
} from "@/components/data/TransferPanel";
import { namedTeamOptions } from "@/components/data/users-admin";
import { FilterSearch } from "@/components/ui/FilterSearch";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  ApiError,
  apiSend,
  useQuery,
  type FilterOption,
  type Transfer,
  type TransferPage,
} from "@/lib/api";
import { addDaysISO, formatDisplayDate, isoDateInZone } from "@/lib/datetime";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const PAGE_LIMIT = 200;
const EMPTY: Transfer[] = [];

const columns: DataColumn<Transfer>[] = [
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
    id: "from",
    header: "Previous team",
    width: "180px",
    render: (row) => <CellText value={row.previousTeam} tone="muted" />,
  },
  {
    id: "to",
    header: "New team",
    width: "180px",
    render: (row) => (
      <span className="smp-transfer-to">
        <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
        <CellText value={row.newTeam} />
      </span>
    ),
  },
  {
    id: "date",
    header: "Transfer date",
    width: "130px",
    render: (row) => <CellText value={formatDisplayDate(row.transferDate)} />,
  },
  {
    id: "reason",
    header: "Reason",
    width: "170px",
    priority: 2,
    render: (row) => <CellText value={row.reason} tone="muted" />,
  },
  {
    id: "notes",
    header: "Details",
    width: "260px",
    flex: true,
    priority: 3,
    render: (row) => <CellText value={row.notes} tone="muted" />,
  },
  {
    id: "by",
    header: "Recorded by",
    width: "150px",
    priority: 3,
    render: (row) => <CellText value={row.recordedBy} tone="muted" />,
  },
];

export function TransferHistory() {
  const session = useSession();
  const canRecord = session.role === "wfm";
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Transfer | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<TransferDraft>(emptyTransferDraft);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);

  const needle = useDebouncedValue(query.trim(), 250);
  const url = useMemo(() => {
    const params = new URLSearchParams({ limit: String(PAGE_LIMIT), rev: String(revision) });
    if (needle) params.set("q", needle);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return `/transfers?${params.toString()}`;
  }, [needle, from, to, revision]);

  const list = useQuery<TransferPage>(url);
  const options = useQuery<{ tivazo: FilterOption[]; biometrics: FilterOption[] }>(
    canRecord ? "/admin/team-options" : null,
  );

  const rows = list.data?.items ?? EMPTY;
  const total = list.data?.total ?? 0;
  const filtered = Boolean(needle || from || to);
  const recentCutoff = addDaysISO(isoDateInZone(), -30);
  const recent = rows.filter((row) => row.transferDate >= recentCutoff).length;

  const teamOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of namedTeamOptions(options.data?.tivazo ?? [])) names.add(item.label);
    for (const item of namedTeamOptions(options.data?.biometrics ?? [])) names.add(item.label);
    for (const row of rows) {
      names.add(row.previousTeam);
      names.add(row.newTeam);
    }
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [options.data, rows]);

  function openCreate() {
    setSelected(null);
    setError("");
    setDraft(emptyTransferDraft());
    setCreating(true);
  }

  function closePanel() {
    if (saving) return;
    setCreating(false);
    setSelected(null);
    setError("");
  }

  async function save() {
    if (busyRef.current) return;
    const issue = validateTransferDraft(draft);
    if (issue) {
      setError(issue);
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError("");
    try {
      await apiSend<Transfer>("/transfers", "POST", draft);
      setCreating(false);
      setQuery("");
      setFrom("");
      setTo("");
      setRevision((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not record this transfer.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  const mode = creating ? "create" : selected ? "view" : null;

  return (
    <div className="smp-page-stack smp-page-stack--fill" data-inspector={mode ? "true" : "false"}>
      <div className="smp-stage">
        <ControlBar
          stats={[
            { label: filtered ? "Matches" : "Transfers", value: String(total) },
            { label: "Last 30 days", value: String(recent) },
          ]}
        >
          <div className="smp-filters--inline">
            <FilterSearch value={query} onChange={setQuery} placeholder="Employee, team, reason" />
            <DateFilter label="From" value={from} max={to || undefined} onChange={setFrom} />
            <DateFilter label="To" value={to} min={from || undefined} onChange={setTo} />
            {canRecord ? (
              <button type="button" className="smp-users-new" onClick={openCreate}>
                <ArrowLeftRight size={15} strokeWidth={1.75} />
                Record transfer
              </button>
            ) : null}
          </div>
        </ControlBar>

        {list.error && rows.length === 0 ? (
          <QueryState loading={false} error={list.error} onRetry={list.reload} label="transfers" />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.id}
            selectedKey={selected?.id ?? null}
            empty={
              list.loading
                ? "Loading transfers…"
                : filtered
                  ? "No transfers match these filters."
                  : "No transfers recorded yet."
            }
            refreshing={list.loading || list.refreshing}
            resetKey={url}
            onRowClick={(row) => {
              setCreating(false);
              setError("");
              setSelected((current) => (current?.id === row.id ? null : row));
            }}
          />
        )}
        {list.data?.hasMore ? (
          <p className="smp-transfer-note">
            Showing the latest {rows.length} of {total} transfers. Search or set dates to narrow
            the list.
          </p>
        ) : null}
      </div>

      <TransferPanel
        mode={mode}
        record={selected}
        draft={draft}
        teamOptions={teamOptions}
        error={error}
        saving={saving}
        onChange={setDraft}
        onClose={closePanel}
        onSave={save}
      />
    </div>
  );
}

function DateFilter({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="smp-filter-search">
      <span className="smp-field__label">{label}</span>
      <span className="smp-filter-search__field">
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          aria-label={`${label} date`}
          title={`${label} date`}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </label>
  );
}
