"use client";

import { CellText, PersonCell } from "@/components/data/cells";
import { ControlBar } from "@/components/data/ControlBar";
import { DataTable, type DataColumn } from "@/components/data/DataTable";
import { QueryState } from "@/components/data/QueryState";
import { StatusPill } from "@/components/data/StatusPill";
import { UsersEditor } from "@/components/data/UsersEditor";
import {
  assignmentKey,
  assignmentLabel,
  generateLeadPassword,
  lastSeen,
  namedTeamOptions,
  validateUserDraft,
  type UserDraft,
} from "@/components/data/users-admin";
import { useSession } from "@/components/auth/SessionProvider";
import { FilterSearch } from "@/components/ui/FilterSearch";
import {
  apiSend,
  ApiError,
  authRoleLabel,
  useQuery,
  type AdminUser,
  type FilterOption,
  type TeamAssignment,
} from "@/lib/api";
import { Briefcase, Shield, UserPlus, Users, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

const emptyDraft = (): UserDraft => ({
  name: "",
  email: "",
  password: generateLeadPassword(),
  status: "active",
  initialStatus: "active",
  role: "team_lead",
  assignments: [],
  lastLoginAt: null,
  passwordTouched: true,
});

function newerThan(pending: AdminUser, live: AdminUser): boolean {
  const pendingTs = Date.parse(pending.updatedAt || "");
  const liveTs = Date.parse(live.updatedAt || "");
  if (!Number.isFinite(pendingTs) || !Number.isFinite(liveTs)) return false;
  return pendingTs > liveTs;
}

type DirectoryFilter = "all" | "wfm" | "team_lead" | "hr";

const EMPTY_USERS: AdminUser[] = [];

function directoryColumns(
  tivazo: FilterOption[],
  biometrics: FilterOption[],
): DataColumn<AdminUser>[] {
  return [
    {
    id: "person",
    header: "User",
    width: "280px",
    sticky: true,
    flex: true,
    person: true,
    render: (row) => <PersonCell name={row.name} email={row.email} />,
  },
  {
    id: "role",
    header: "Role",
    width: "132px",
    render: (row) => (
      <StatusPill value={authRoleLabel(row.role)} />
    ),
  },
  {
    id: "status",
    header: "Status",
    width: "110px",
    render: (row) => (
      <StatusPill value={row.status === "active" ? "Active" : "Disabled"} />
    ),
  },
  {
    id: "teams",
    header: "Teams",
    width: "280px",
    flex: true,
    priority: 2,
    render: (row) =>
      row.role === "wfm" || row.role === "hr" ? (
        <CellText value="All teams" tone="muted" />
      ) : (
        <TeamChips assignments={row.assignments} tivazo={tivazo} biometrics={biometrics} />
      ),
  },
  {
    id: "seen",
    header: "Last sign-in",
    width: "160px",
    priority: 3,
    render: (row) => <CellText value={lastSeen(row.lastLoginAt)} tone="muted" />,
  },
  ];
}

function TeamChips({
  assignments,
  tivazo,
  biometrics,
}: {
  assignments: TeamAssignment[];
  tivazo: FilterOption[];
  biometrics: FilterOption[];
}) {
  if (!assignments.length) return <CellText value="No teams" tone="muted" />;
  const shown = assignments.slice(0, 2);
  const extra = assignments.length - shown.length;
  return (
    <span className="smp-users-chips">
      {shown.map((item) => {
        const label = assignmentLabel(item, item.source === "tivazo" ? tivazo : biometrics);
        return (
          <span
            key={assignmentKey(item)}
            className="smp-users-chip"
            data-source={item.source}
            title={`${item.source === "tivazo" ? "Tivazo" : "Biometrics"} · ${label}`}
          >
            {label}
          </span>
        );
      })}
      {extra > 0 ? <span className="smp-users-chip smp-users-chip--more">+{extra}</span> : null}
    </span>
  );
}

export function UsersDirectory() {
  const session = useSession();
  const users = useQuery<{ items: AdminUser[] }>("/admin/users");
  const options = useQuery<{ tivazo: FilterOption[]; biometrics: FilterOption[] }>(
    "/admin/team-options",
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DirectoryFilter>("all");
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<AdminUser[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const busyRef = useRef(false);
  const tivazo = namedTeamOptions(options.data?.tivazo ?? []);
  const biometrics = namedTeamOptions(options.data?.biometrics ?? []);
  const columns = directoryColumns(tivazo, biometrics);
  const editorOpen = draft !== null;

  const remote = users.data?.items ?? EMPTY_USERS;
  useEffect(() => {
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    setPending((current) => {
      if (current.length === 0) return current;
      const next = current.filter((item) => {
        const live = remoteById.get(item.id);
        return !live || newerThan(item, live);
      });
      return next.length === current.length ? current : next;
    });
    setRemovedIds((current) => {
      if (current.length === 0) return current;
      const next = current.filter((id) => remoteById.has(id));
      return next.length === current.length ? current : next;
    });
  }, [remote]);

  const items = useMemo(() => {
    const gone = new Set(removedIds);
    const byId = new Map(remote.map((item) => [item.id, item]));
    for (const item of pending) {
      const existing = byId.get(item.id);
      byId.set(item.id, existing ? { ...existing, ...item } : item);
    }
    return [...byId.values()].filter((item) => !gone.has(item.id));
  }, [remote, pending, removedIds]);
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "wfm" && item.role !== "wfm") return false;
        if (filter === "team_lead" && item.role !== "team_lead") return false;
        if (filter === "hr" && item.role !== "hr") return false;
        if (!needle) return true;
        const haystack = [
          item.name,
          item.email,
          item.role,
          item.status,
          ...item.assignments.map((entry) => entry.teamLabel),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      }),
    [items, needle, filter],
  );

  const leads = items.filter((item) => item.role === "team_lead");
  const hrUsers = items.filter((item) => item.role === "hr");
  const active = items.filter((item) => item.status === "active").length;
  const superadmins = items.filter((item) => item.role === "wfm");
  const activeSuperadmins = superadmins.filter((item) => item.status === "active").length;
  const lastActiveSuperadmin = activeSuperadmins <= 1;

  function openCreate() {
    setError("");
    setDraft(emptyDraft());
  }

  function openRow(row: AdminUser) {
    setError("");
    setDraft({
      id: row.id,
      name: row.name,
      email: row.email,
      password: "",
      status: row.status,
      initialStatus: row.status,
      role: row.role,
      assignments: row.assignments,
      lastLoginAt: row.lastLoginAt,
      updatedAt: row.updatedAt,
      passwordTouched: false,
    });
  }

  function toggleAssignment(next: TeamAssignment) {
    setDraft((current) => {
      if (!current || current.role === "wfm" || current.role === "hr") return current;
      const key = assignmentKey(next);
      const exists = current.assignments.some((item) => assignmentKey(item) === key);
      return {
        ...current,
        assignments: exists
          ? current.assignments.filter((item) => assignmentKey(item) !== key)
          : [...current.assignments, next],
      };
    });
  }

  async function save() {
    if (!draft || busyRef.current) return;
    const snapshot = draft;
    const issue = validateUserDraft(snapshot, snapshot.id ? "update" : "create");
    if (issue) {
      setError(issue);
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (snapshot.id) {
        const updated = await apiSend<{ user: AdminUser }>(`/admin/users/${snapshot.id}`, "PATCH", {
          name: snapshot.name,
          email: snapshot.email,
          role: snapshot.role,
          status: snapshot.status,
          password:
            snapshot.passwordTouched && snapshot.password ? snapshot.password : undefined,
          assignments: snapshot.role === "wfm" || snapshot.role === "hr" ? [] : snapshot.assignments,
        });
        if (updated.user) {
          setPending((current) => [
            updated.user,
            ...current.filter((item) => item.id !== updated.user.id),
          ]);
        }
        setDraft(null);
      } else {
        const created = await apiSend<{ user: AdminUser }>("/admin/users", "POST", {
          name: snapshot.name,
          email: snapshot.email,
          password: snapshot.password,
          role: snapshot.role,
          assignments: snapshot.role === "wfm" || snapshot.role === "hr" ? [] : snapshot.assignments,
        });
        if (created.user) {
          setPending((current) => [
            created.user,
            ...current.filter((item) => item.id !== created.user.id),
          ]);
          setDraft({
            id: created.user.id,
            name: created.user.name,
            email: created.user.email,
            password: snapshot.password,
            status: created.user.status,
            initialStatus: created.user.status,
            role: created.user.role,
            assignments: created.user.assignments,
            lastLoginAt: created.user.lastLoginAt,
            updatedAt: created.user.updatedAt,
            justCreated: true,
            passwordTouched: false,
          });
          setFilter("all");
          setQuery("");
        } else {
          setDraft(null);
        }
      }
      users.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save this user.");
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft?.id || busyRef.current) return;
    if (draft.id === session.id) {
      setError("You cannot remove your own account.");
      return;
    }
    if (draft.role === "wfm" && lastActiveSuperadmin && draft.initialStatus === "active") {
      setError("Keep at least one active Superadmin.");
      return;
    }
    const id = draft.id;
    busyRef.current = true;
    setRemoving(true);
    setError("");
    setRemovedIds((current) => (current.includes(id) ? current : [...current, id]));
    setPending((current) => current.filter((item) => item.id !== id));
    try {
      await apiSend<{ ok: boolean }>(`/admin/users/${id}`, "DELETE");
      setDraft(null);
      users.reload();
    } catch (caught) {
      setRemovedIds((current) => current.filter((item) => item !== id));
      setError(caught instanceof ApiError ? caught.message : "Could not remove this user.");
      users.reload();
    } finally {
      busyRef.current = false;
      setRemoving(false);
    }
  }

  return (
    <div
      className="smp-page-stack smp-page-stack--fill"
      data-inspector={editorOpen ? "true" : "false"}
    >
      <div className="smp-stage">
        <section className="smp-users-stat-cards" aria-label="Users overview">
          <UserStat label="Users" value={items.length} icon={Users} tone="blue" />
          <UserStat label="Superadmin" value={superadmins.length} icon={Shield} tone="green" />
          <UserStat label="Team leads" value={leads.length} icon={UserPlus} tone="orange" />
          <UserStat label="HR" value={hrUsers.length} icon={Briefcase} tone="blue" />
          <UserStat label="Active" value={active} icon={UserCheck} tone="teal" />
        </section>

        <ControlBar
          stats={[
            {
              label: "Accounts",
              value: String(items.length),
              active: filter === "all",
              onClick: () => setFilter("all"),
            },
            {
              label: "Team leads",
              value: String(leads.length),
              active: filter === "team_lead",
              onClick: () => setFilter("team_lead"),
            },
            {
              label: "HR",
              value: String(hrUsers.length),
              active: filter === "hr",
              onClick: () => setFilter("hr"),
            },
            {
              label: "Superadmin",
              value: String(superadmins.length),
              active: filter === "wfm",
              onClick: () => setFilter("wfm"),
            },
          ]}
        >
          <div className="smp-filters--inline">
            <FilterSearch
              value={query}
              onChange={setQuery}
              placeholder="Name, email, team"
            />
            <button type="button" className="smp-users-new" onClick={openCreate}>
              <UserPlus size={15} strokeWidth={1.75} />
              New user
            </button>
          </div>
        </ControlBar>

        {users.error && items.length === 0 ? (
          <QueryState
            loading={false}
            error={users.error}
            onRetry={users.reload}
            label="users"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            getKey={(row) => row.id}
            selectedKey={draft?.id ?? null}
            empty={
              users.loading
                ? "Loading users…"
                : needle
                  ? "No users match this search."
                  : "No users yet. Create a Superadmin, Team lead, or HR user."
            }
            refreshing={users.loading || users.refreshing}
            onRowClick={(row) => {
              if (draft?.id === row.id) {
                if (draft.justCreated) return;
                setDraft(null);
                return;
              }
              openRow(row);
            }}
          />
        )}
      </div>

      <UsersEditor
        open={editorOpen}
        draft={draft}
        error={error}
        saving={saving}
        removing={removing}
        tivazo={tivazo}
        biometrics={biometrics}
        onChange={setDraft}
        onToggle={toggleAssignment}
        onClose={() => {
          if (!saving && !removing) setDraft(null);
        }}
        onSave={save}
        onDelete={remove}
        currentUserId={session.id}
        lastActiveSuperadmin={lastActiveSuperadmin}
      />
    </div>
  );
}

function UserStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "green" | "blue" | "orange" | "teal";
}) {
  return (
    <article className="smp-stat-card" data-tone={tone}>
      <span className="smp-stat-card__icon" aria-hidden="true">
        <Icon size={17} strokeWidth={2} />
      </span>
      <div className="smp-stat-card__body">
        <span className="smp-stat-card__label">{label}</span>
        <p className="smp-stat-card__value">{value}</p>
      </div>
    </article>
  );
}
