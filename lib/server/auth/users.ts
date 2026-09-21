import type { PoolClient } from "pg";
import { query, withTransaction } from "@/lib/server/auth/db";
import { ensureSchema } from "@/lib/server/auth/schema";
import { hashPassword } from "@/lib/server/auth/password";
import { BffError } from "@/lib/server/upstream";
import type { AuthUser, TeamAssignment } from "@/lib/server/auth/types";
import { isAuthRole, isOrgWideAuthRole, type AuthRole } from "@/lib/auth-role";

const USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: AuthRole;
  status: "active" | "disabled";
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  source: "tivazo" | "biometrics";
  team_id: string;
  team_label: string;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  status: "active" | "disabled";
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignments: TeamAssignment[];
};

function toAdminUser(row: UserRow, assignments: TeamAssignment[]): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assignments,
  };
}

function assertUserId(id: string): string {
  if (!USER_ID.test(id)) throw new BffError(404, "not_found", "User not found.");
  return id;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505",
  );
}

function rethrowWriteError(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw new BffError(409, "email_taken", "That email already has an account.");
  }
  throw error;
}

function mapUser(row: UserRow, assignments: TeamAssignment[]): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    assignments,
  };
}

function mapAssignments(rows: AssignmentRow[]): TeamAssignment[] {
  return rows.map((row) => ({
    source: row.source,
    teamId: row.team_id,
    teamLabel: row.team_label,
  }));
}

export async function loadAssignments(userId: string): Promise<TeamAssignment[]> {
  const result = await query<AssignmentRow>(
    `SELECT source, team_id, team_label
     FROM wfm_team_assignments
     WHERE user_id = $1
     ORDER BY source, team_label`,
    [userId],
  );
  return mapAssignments(result.rows);
}

export async function loadUserById(id: string): Promise<AuthUser | null> {
  await ensureSchema();
  const result = await query<UserRow>(
    `SELECT id, email, name, password_hash, role, status, last_login_at, created_at, updated_at
     FROM wfm_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return mapUser(row, await loadAssignments(row.id));
}

export async function loadUserByEmail(email: string): Promise<(AuthUser & { passwordHash: string }) | null> {
  await ensureSchema();
  const result = await query<UserRow>(
    `SELECT id, email, name, password_hash, role, status, last_login_at, created_at, updated_at
     FROM wfm_users WHERE lower(email) = lower($1) LIMIT 1`,
    [email.trim()],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...mapUser(row, await loadAssignments(row.id)),
    passwordHash: row.password_hash,
  };
}

export async function markLogin(userId: string): Promise<void> {
  await query(
    `UPDATE wfm_users SET last_login_at = now(), updated_at = now() WHERE id = $1`,
    [userId],
  );
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  await ensureSchema();
  const users = await query<UserRow>(
    `SELECT id, email, name, password_hash, role, status, last_login_at, created_at, updated_at
     FROM wfm_users
     ORDER BY CASE WHEN role = 'wfm' THEN 0 WHEN role = 'hr' THEN 1 ELSE 2 END, created_at DESC, name ASC`,
  );
  const assignments = await query<AssignmentRow & { user_id: string }>(
    `SELECT user_id, source, team_id, team_label FROM wfm_team_assignments ORDER BY team_label`,
  );
  const byUser = new Map<string, TeamAssignment[]>();
  for (const row of assignments.rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({ source: row.source, teamId: row.team_id, teamLabel: row.team_label });
    byUser.set(row.user_id, list);
  }
  return users.rows.map((row) => toAdminUser(row, byUser.get(row.id) ?? []));
}

function normalizeEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new BffError(400, "invalid_email", "Enter a valid work email.");
  }
  return value;
}

function normalizeName(name: string): string {
  const value = name.trim().replace(/\s+/g, " ");
  if (value.length < 2) throw new BffError(400, "invalid_name", "Enter the user’s name.");
  return value;
}

function normalizeRole(raw: unknown): AuthRole {
  if (isAuthRole(raw)) return raw;
  throw new BffError(400, "invalid_role", "Choose Superadmin, Team lead, or HR.");
}

async function lockActiveWfm(client: PoolClient): Promise<void> {
  await client.query(
    `SELECT id FROM wfm_users WHERE role = 'wfm' AND status = 'active' FOR UPDATE`,
  );
}

async function countActiveWfm(client: PoolClient, excludeId?: string): Promise<number> {
  const result = excludeId
    ? await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM wfm_users
         WHERE role = 'wfm' AND status = 'active' AND id <> $1`,
        [excludeId],
      )
    : await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM wfm_users
         WHERE role = 'wfm' AND status = 'active'`,
      );
  return Number(result.rows[0]?.count || 0);
}

function normalizeAssignments(raw: TeamAssignment[]): TeamAssignment[] {
  const seen = new Set<string>();
  const assignments: TeamAssignment[] = [];
  for (const item of raw) {
    const source = item.source === "tivazo" ? "tivazo" : item.source === "biometrics" ? "biometrics" : null;
    const teamId = String(item.teamId || "").trim();
    const teamLabel = String(item.teamLabel || item.teamId || "").trim();
    if (!source || !teamId || !teamLabel) continue;
    const key = `${source}:${teamId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({ source, teamId, teamLabel });
  }
  if (!assignments.length) {
    throw new BffError(400, "teams_required", "Choose at least one Tivazo group or Biometrics department.");
  }
  return assignments;
}

async function replaceAssignments(
  client: PoolClient,
  userId: string,
  assignments: TeamAssignment[],
): Promise<void> {
  await client.query(`DELETE FROM wfm_team_assignments WHERE user_id = $1`, [userId]);
  for (const assignment of assignments) {
    await client.query(
      `INSERT INTO wfm_team_assignments (id, user_id, source, team_id, team_label)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), userId, assignment.source, assignment.teamId, assignment.teamLabel],
    );
  }
}

async function loadAssignmentsWith(client: PoolClient, userId: string): Promise<TeamAssignment[]> {
  const result = await client.query<AssignmentRow>(
    `SELECT source, team_id, team_label
     FROM wfm_team_assignments
     WHERE user_id = $1
     ORDER BY source, team_label`,
    [userId],
  );
  return mapAssignments(result.rows);
}

export async function createAdminUser(input: {
  name: string;
  email: string;
  password: string;
  role?: AuthRole;
  assignments: TeamAssignment[];
  createdBy: string;
}): Promise<AdminUser> {
  await ensureSchema();
  const role = normalizeRole(input.role ?? "team_lead");
  const email = normalizeEmail(input.email);
  const name = normalizeName(input.name);
  const assignments = isOrgWideAuthRole(role) ? [] : normalizeAssignments(input.assignments);
  const existing = await query(`SELECT id FROM wfm_users WHERE lower(email) = $1 LIMIT 1`, [email]);
  if (existing.rows[0]) {
    throw new BffError(409, "email_taken", "That email already has an account.");
  }
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch (error) {
    throw new BffError(
      400,
      "weak_password",
      error instanceof Error ? error.message : "Choose a stronger password.",
    );
  }
  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query<UserRow>(
        `INSERT INTO wfm_users (id, email, name, password_hash, role, status, created_by)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)
         RETURNING id, email, name, password_hash, role, status, last_login_at, created_at, updated_at`,
        [crypto.randomUUID(), email, name, passwordHash, role, input.createdBy],
      );
      const row = inserted.rows[0];
      if (assignments.length) await replaceAssignments(client, row.id, assignments);
      return toAdminUser(row, assignments);
    });
  } catch (error) {
    rethrowWriteError(error);
  }
}

export async function updateAdminUser(
  id: string,
  patch: {
    name?: string;
    email?: string;
    role?: AuthRole;
    status?: "active" | "disabled";
    password?: string;
    assignments?: TeamAssignment[];
  },
  actorId?: string,
  keepSessionId?: string,
): Promise<AdminUser> {
  await ensureSchema();
  const userId = assertUserId(id);
  let passwordHash: string | undefined;
  if (patch.password) {
    try {
      passwordHash = await hashPassword(patch.password);
    } catch (error) {
      throw new BffError(
        400,
        "weak_password",
        error instanceof Error ? error.message : "Choose a stronger password.",
      );
    }
  }

  let emailChanged = false;
  let roleChanged = false;
  let statusChanged = false;
  let updated: AdminUser;
  try {
    updated = await withTransaction(async (client) => {
      await lockActiveWfm(client);
      const current = await client.query<UserRow>(
        `SELECT id, email, name, password_hash, role, status, last_login_at, created_at, updated_at
         FROM wfm_users WHERE id = $1 LIMIT 1 FOR UPDATE`,
        [userId],
      );
      const row = current.rows[0];
      if (!row) throw new BffError(404, "not_found", "User not found.");

      const name = patch.name ? normalizeName(patch.name) : row.name;
      const role = patch.role ? normalizeRole(patch.role) : row.role;
      const status =
        patch.status === "disabled" || patch.status === "active" ? patch.status : row.status;
      const self = actorId === userId;

      if (self && status === "disabled") {
        throw new BffError(400, "self_disable", "You cannot disable your own account.");
      }
      if (self && role !== "wfm") {
        throw new BffError(400, "self_role", "You cannot change your own role.");
      }
      if (
        row.role === "wfm" &&
        row.status === "active" &&
        (status === "disabled" || role !== "wfm") &&
        (await countActiveWfm(client, userId)) === 0
      ) {
        throw new BffError(400, "last_superadmin", "Keep at least one active Superadmin.");
      }

      let email = row.email;
      if (patch.email) {
        email = normalizeEmail(patch.email);
        if (email !== row.email.toLowerCase()) {
          const taken = await client.query(
            `SELECT id FROM wfm_users WHERE lower(email) = $1 AND id <> $2 LIMIT 1`,
            [email, userId],
          );
          if (taken.rows[0]) {
            throw new BffError(409, "email_taken", "That email already has an account.");
          }
        }
      }

      const nextHash = passwordHash ?? row.password_hash;
      const written = await client.query<UserRow>(
        `UPDATE wfm_users
         SET name = $2, email = $3, role = $4, status = $5, password_hash = $6,
             password_changed_at = CASE WHEN $6 <> password_hash THEN now() ELSE password_changed_at END,
             updated_at = now()
         WHERE id = $1
         RETURNING id, email, name, password_hash, role, status, last_login_at, created_at, updated_at`,
        [userId, name, email, role, status, nextHash],
      );

      let assignments: TeamAssignment[] = [];
      if (isOrgWideAuthRole(role)) {
        await replaceAssignments(client, userId, []);
      } else if (patch.assignments) {
        assignments = normalizeAssignments(patch.assignments);
        await replaceAssignments(client, userId, assignments);
      } else {
        assignments = await loadAssignmentsWith(client, userId);
        if (!assignments.length) {
          throw new BffError(
            400,
            "teams_required",
            "Choose at least one Tivazo group or Biometrics department.",
          );
        }
      }

      emailChanged = email.toLowerCase() !== row.email.toLowerCase();
      roleChanged = role !== row.role;
      statusChanged = status !== row.status;
      return toAdminUser(written.rows[0], assignments);
    });
  } catch (error) {
    rethrowWriteError(error);
  }

  if (statusChanged || Boolean(patch.password) || emailChanged || roleChanged) {
    const { destroyUserSessions } = await import("@/lib/server/auth/session");
    await destroyUserSessions(userId, actorId === userId ? keepSessionId : undefined);
  }
  return updated;
}

export async function deleteAdminUser(
  id: string,
  actorId?: string,
): Promise<{ id: string; email: string; name: string; role: AuthRole }> {
  await ensureSchema();
  const userId = assertUserId(id);
  const removed = await withTransaction(async (client) => {
    await lockActiveWfm(client);
    const current = await client.query<UserRow>(
      `SELECT id, email, name, password_hash, role, status, last_login_at, created_at, updated_at
       FROM wfm_users WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [userId],
    );
    const row = current.rows[0];
    if (!row) throw new BffError(404, "not_found", "User not found.");
    if (actorId === userId) {
      throw new BffError(400, "self_delete", "You cannot remove your own account.");
    }
    if (row.role === "wfm" && (await countActiveWfm(client, userId)) === 0) {
      throw new BffError(400, "last_superadmin", "Keep at least one active Superadmin.");
    }
    await client.query(`DELETE FROM wfm_users WHERE id = $1`, [userId]);
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  });
  const { destroyUserSessions } = await import("@/lib/server/auth/session");
  await destroyUserSessions(removed.id);
  return removed;
}

export async function seedWfmUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ created: boolean; email: string }> {
  await ensureSchema();
  const email = normalizeEmail(input.email);
  const existing = await query(`SELECT id FROM wfm_users WHERE role = 'wfm' LIMIT 1`);
  if (existing.rows[0]) {
    return { created: false, email };
  }
  const passwordHash = await hashPassword(input.password);
  const created = await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(87234101)");
    const locked = await client.query(`SELECT id FROM wfm_users WHERE role = 'wfm' LIMIT 1`);
    if (locked.rows[0]) return false;
    await client.query(
      `INSERT INTO wfm_users (id, email, name, password_hash, role, status)
       VALUES ($1, $2, $3, $4, 'wfm', 'active')`,
      [crypto.randomUUID(), email, normalizeName(input.name || "WFM"), passwordHash],
    );
    return true;
  });
  return { created, email };
}
