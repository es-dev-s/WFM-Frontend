import { query } from "@/lib/server/auth/db";

/**
 * Transfer history and HR offboarding records. These tables used to live in the
 * WFM-Backend Go service; the definitions are identical to its migrations
 * (002_team_transfers.sql, 003_offboarding.sql), so a database that already has
 * them is reused as-is.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS team_transfers (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL DEFAULT '',
    employee_name TEXT NOT NULL,
    employee_email TEXT NOT NULL DEFAULT '',
    previous_team TEXT NOT NULL,
    new_team TEXT NOT NULL,
    transfer_date DATE NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT team_transfers_teams_differ_chk CHECK (lower(previous_team) <> lower(new_team))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_transfers_date ON team_transfers (transfer_date DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_team_transfers_member ON team_transfers (member_id)`,
  `CREATE TABLE IF NOT EXISTS employee_offboarding (
    id TEXT PRIMARY KEY,
    employee_key TEXT NOT NULL UNIQUE,
    member_id TEXT NOT NULL DEFAULT '',
    employee_name TEXT NOT NULL,
    employee_email TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    resignation_date DATE NOT NULL,
    last_working_date DATE NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    recorded_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT employee_offboarding_dates_chk CHECK (last_working_date >= resignation_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_employee_offboarding_lwd ON employee_offboarding (last_working_date DESC)`,
];

let ready: Promise<void> | null = null;

export async function ensureRecordsSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const statement of STATEMENTS) {
        await query(statement);
      }
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}
