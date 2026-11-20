import { randomBytes } from "node:crypto";
import { query } from "@/lib/server/auth/db";
import { ensureRecordsSchema } from "@/lib/server/records/schema";
import {
  isValidDay,
  normalizeTransfer,
  validateTransfer,
} from "@/lib/server/records/validation";
import { BffError } from "@/lib/server/upstream";

export type TransferRecord = {
  id: string;
  memberId: string;
  employeeName: string;
  employeeEmail: string;
  previousTeam: string;
  newTeam: string;
  transferDate: string;
  reason: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
};

export type TransferPage = {
  items: TransferRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type TransferInput = {
  memberId?: string;
  employeeName: string;
  employeeEmail?: string;
  previousTeam: string;
  newTeam: string;
  transferDate: string;
  reason?: string;
  notes?: string;
  recordedBy?: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type TransferRow = {
  id: string;
  member_id: string;
  employee_name: string;
  employee_email: string;
  previous_team: string;
  new_team: string;
  transfer_date: string;
  reason: string;
  notes: string;
  recorded_by: string;
  created_at: Date;
};

const COLUMNS = `id, member_id, employee_name, employee_email, previous_team, new_team,
  to_char(transfer_date, 'YYYY-MM-DD') AS transfer_date, reason, notes, recorded_by, created_at`;

function toRecord(row: TransferRow): TransferRecord {
  return {
    id: row.id,
    memberId: row.member_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    previousTeam: row.previous_team,
    newTeam: row.new_team,
    transferDate: row.transfer_date,
    reason: row.reason,
    notes: row.notes,
    recordedBy: row.recorded_by,
    createdAt: row.created_at.toISOString(),
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function positiveInt(value: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function listTransfers(
  search: URLSearchParams,
  _signal?: AbortSignal,
): Promise<TransferPage> {
  await ensureRecordsSchema();
  const text = (key: string) => search.get(key)?.trim() ?? "";
  const from = text("from");
  const to = text("to");
  if (from && !isValidDay(from)) throw new BffError(400, "invalid_argument", "from must be YYYY-MM-DD");
  if (to && !isValidDay(to)) throw new BffError(400, "invalid_argument", "to must be YYYY-MM-DD");

  const limit = Math.min(Math.max(positiveInt(search.get("limit"), DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = positiveInt(search.get("offset"), 0);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (from) add("transfer_date >= ?::date", from);
  if (to) add("transfer_date <= ?::date", to);
  const team = text("team");
  if (team) {
    params.push(team);
    where.push(`(lower(previous_team) = lower($${params.length}) OR lower(new_team) = lower($${params.length}))`);
  }
  const needle = text("q");
  if (needle) {
    add(
      `lower(concat_ws(' ', employee_name, employee_email, member_id,
        previous_team, new_team, reason, notes, recorded_by)) LIKE ?`,
      `%${escapeLike(needle.toLowerCase())}%`,
    );
  }
  const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  const count = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM team_transfers${clause}`,
    params,
  );
  const total = count.rows[0]?.total ?? 0;
  const rows = await query<TransferRow>(
    `SELECT ${COLUMNS} FROM team_transfers${clause}
     ORDER BY transfer_date DESC, created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const items = rows.rows.map(toRecord);
  return { items, total, limit, offset, hasMore: offset + items.length < total };
}

export async function createTransfer(input: TransferInput): Promise<TransferRecord> {
  const fields = normalizeTransfer(input as unknown as Record<string, unknown>);
  validateTransfer(fields);
  await ensureRecordsSchema();
  const id = `trf_${randomBytes(8).toString("hex")}`;
  const result = await query<TransferRow>(
    `INSERT INTO team_transfers
       (id, member_id, employee_name, employee_email, previous_team, new_team,
        transfer_date, reason, notes, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      id,
      fields.memberId,
      fields.employeeName,
      fields.employeeEmail,
      fields.previousTeam,
      fields.newTeam,
      fields.transferDate,
      fields.reason,
      fields.notes,
      fields.recordedBy,
    ],
  );
  return toRecord(result.rows[0]);
}
