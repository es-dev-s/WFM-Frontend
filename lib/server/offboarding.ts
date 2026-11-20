import { randomBytes } from "node:crypto";
import { query } from "@/lib/server/auth/db";
import { ensureRecordsSchema } from "@/lib/server/records/schema";
import {
  addOneDay,
  normalizeOffboarding,
  offboardingKey,
  validateOffboarding,
} from "@/lib/server/records/validation";
import { BffError, todayInAppZone } from "@/lib/server/upstream";

export type OffboardingStatus = "Serving notice" | "Resigned";

export type OffboardingRecord = {
  id: string;
  memberId: string;
  employeeName: string;
  employeeEmail: string;
  team: string;
  resignationDate: string;
  lastWorkingDate: string;
  /** First day the employee no longer counts toward active headcount. */
  effectiveDate: string;
  status: OffboardingStatus;
  reason: string;
  notes: string;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OffboardingList = {
  items: OffboardingRecord[];
  total: number;
  /** Today in the business timezone (YYYY-MM-DD). */
  today: string;
};

export type OffboardingInput = {
  memberId?: string;
  employeeName: string;
  employeeEmail?: string;
  team?: string;
  resignationDate: string;
  lastWorkingDate: string;
  reason?: string;
  notes?: string;
  recordedBy?: string;
};

type OffboardingRow = {
  id: string;
  member_id: string;
  employee_name: string;
  employee_email: string;
  team: string;
  resignation_date: string;
  last_working_date: string;
  reason: string;
  notes: string;
  recorded_by: string;
  created_at: Date;
  updated_at: Date;
};

const COLUMNS = `id, member_id, employee_name, employee_email, team,
  to_char(resignation_date, 'YYYY-MM-DD') AS resignation_date,
  to_char(last_working_date, 'YYYY-MM-DD') AS last_working_date,
  reason, notes, recorded_by, created_at, updated_at`;

/** Status and effective date follow the last working date, in the business timezone. */
function toRecord(row: OffboardingRow, today: string): OffboardingRecord {
  return {
    id: row.id,
    memberId: row.member_id,
    employeeName: row.employee_name,
    employeeEmail: row.employee_email,
    team: row.team,
    resignationDate: row.resignation_date,
    lastWorkingDate: row.last_working_date,
    effectiveDate: addOneDay(row.last_working_date),
    status: today > row.last_working_date ? "Resigned" : "Serving notice",
    reason: row.reason,
    notes: row.notes,
    recordedBy: row.recorded_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listOffboarding(_signal?: AbortSignal): Promise<OffboardingList> {
  await ensureRecordsSchema();
  const today = todayInAppZone();
  const result = await query<OffboardingRow>(
    `SELECT ${COLUMNS} FROM employee_offboarding
     ORDER BY last_working_date DESC, updated_at DESC`,
  );
  const items = result.rows.map((row) => toRecord(row, today));
  return { items, total: items.length, today };
}

/** Record or update an employee's resignation (one record per employee). */
export async function saveOffboarding(input: OffboardingInput): Promise<OffboardingRecord> {
  const fields = normalizeOffboarding(input as unknown as Record<string, unknown>);
  validateOffboarding(fields);
  await ensureRecordsSchema();
  const result = await query<OffboardingRow>(
    `INSERT INTO employee_offboarding
       (id, employee_key, member_id, employee_name, employee_email, team,
        resignation_date, last_working_date, reason, notes, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11)
     ON CONFLICT (employee_key) DO UPDATE SET
       member_id = EXCLUDED.member_id,
       employee_name = EXCLUDED.employee_name,
       employee_email = EXCLUDED.employee_email,
       team = EXCLUDED.team,
       resignation_date = EXCLUDED.resignation_date,
       last_working_date = EXCLUDED.last_working_date,
       reason = EXCLUDED.reason,
       notes = EXCLUDED.notes,
       recorded_by = EXCLUDED.recorded_by,
       updated_at = now()
     RETURNING ${COLUMNS}`,
    [
      `off_${randomBytes(8).toString("hex")}`,
      offboardingKey(fields),
      fields.memberId,
      fields.employeeName,
      fields.employeeEmail,
      fields.team,
      fields.resignationDate,
      fields.lastWorkingDate,
      fields.reason,
      fields.notes,
      fields.recordedBy,
    ],
  );
  return toRecord(result.rows[0], todayInAppZone());
}

export async function removeOffboarding(id: string): Promise<void> {
  await ensureRecordsSchema();
  const result = await query(`DELETE FROM employee_offboarding WHERE id = $1`, [id]);
  if (!result.rowCount) throw new BffError(404, "not_found", "That record no longer exists.");
}
