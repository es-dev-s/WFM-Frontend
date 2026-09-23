import { query } from "@/lib/server/auth/db";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS wfm_bio_members (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    designation TEXT NOT NULL DEFAULT '',
    joined_at TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_members_name_idx ON wfm_bio_members (lower(name))`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_members_email_idx ON wfm_bio_members (lower(email))`,
  `CREATE TABLE IF NOT EXISTS wfm_bio_day_logs (
    employee_id TEXT NOT NULL,
    day TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    groups TEXT[] NOT NULL DEFAULT '{}',
    role TEXT NOT NULL DEFAULT '',
    designation TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Absent',
    in_time TEXT NOT NULL DEFAULT '',
    out_time TEXT NOT NULL DEFAULT '',
    tracked_time TEXT NOT NULL DEFAULT '',
    manual_time TEXT NOT NULL DEFAULT '',
    break_time TEXT NOT NULL DEFAULT '',
    occupancy TEXT NOT NULL DEFAULT '0%',
    utilization TEXT NOT NULL DEFAULT '0%',
    wtr TEXT NOT NULL DEFAULT '0%',
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (employee_id, day),
    CONSTRAINT wfm_bio_day_logs_day_chk CHECK (day ~ '^\\d{4}-\\d{2}-\\d{2}$')
  )`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_day_logs_day_idx ON wfm_bio_day_logs (day)`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_day_logs_name_idx ON wfm_bio_day_logs (lower(name), day)`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_day_logs_day_name_idx ON wfm_bio_day_logs (day DESC, lower(name))`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_day_logs_day_status_idx ON wfm_bio_day_logs (day, status)`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_day_logs_day_dept_idx ON wfm_bio_day_logs (day, lower(department))`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_day_logs_email_idx ON wfm_bio_day_logs (lower(email), day)`,
  `CREATE INDEX IF NOT EXISTS wfm_bio_members_dept_idx ON wfm_bio_members (lower(department))`,
  `CREATE TABLE IF NOT EXISTS wfm_tivazo_members (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    designation TEXT NOT NULL DEFAULT '',
    groups TEXT[] NOT NULL DEFAULT '{}',
    role TEXT NOT NULL DEFAULT '',
    workspace_id TEXT NOT NULL DEFAULT '',
    disabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_members_name_idx ON wfm_tivazo_members (lower(name))`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_members_email_idx ON wfm_tivazo_members (lower(email))`,
  `CREATE TABLE IF NOT EXISTS wfm_tivazo_day_logs (
    member_id TEXT NOT NULL,
    day TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    groups TEXT[] NOT NULL DEFAULT '{}',
    role TEXT NOT NULL DEFAULT '',
    designation TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Absent',
    in_time TEXT NOT NULL DEFAULT '',
    out_time TEXT NOT NULL DEFAULT '',
    tracked_time TEXT NOT NULL DEFAULT '',
    manual_time TEXT NOT NULL DEFAULT '',
    break_time TEXT NOT NULL DEFAULT '',
    occupancy TEXT NOT NULL DEFAULT '0%',
    utilization TEXT NOT NULL DEFAULT '0%',
    wtr TEXT NOT NULL DEFAULT '0%',
    employee_id TEXT NOT NULL DEFAULT '',
    workspace_id TEXT NOT NULL DEFAULT '',
    clocked_in_ms BIGINT NOT NULL DEFAULT 0,
    last_screenshot_ms BIGINT NOT NULL DEFAULT 0,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, day),
    CONSTRAINT wfm_tivazo_day_logs_day_chk CHECK (day ~ '^\\d{4}-\\d{2}-\\d{2}$')
  )`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_day_logs_day_idx ON wfm_tivazo_day_logs (day)`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_day_logs_name_idx ON wfm_tivazo_day_logs (lower(name), day)`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_day_logs_day_name_idx ON wfm_tivazo_day_logs (day DESC, lower(name))`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_day_logs_day_status_idx ON wfm_tivazo_day_logs (day, status)`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_day_logs_email_idx ON wfm_tivazo_day_logs (lower(email), day)`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_day_logs_groups_idx ON wfm_tivazo_day_logs USING GIN (groups)`,
  `CREATE INDEX IF NOT EXISTS wfm_tivazo_members_groups_idx ON wfm_tivazo_members USING GIN (groups)`,
  `CREATE INDEX IF NOT EXISTS wfm_ingest_days_sealed_idx ON wfm_ingest_days (source, sealed, day)`,
  `CREATE TABLE IF NOT EXISTS wfm_ingest_days (
    source TEXT NOT NULL CHECK (source IN ('biometrics', 'tivazo')),
    day TEXT NOT NULL,
    sealed BOOLEAN NOT NULL DEFAULT false,
    row_count INTEGER NOT NULL DEFAULT 0,
    present_count INTEGER NOT NULL DEFAULT 0,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, day),
    CONSTRAINT wfm_ingest_days_day_chk CHECK (day ~ '^\\d{4}-\\d{2}-\\d{2}$')
  )`,
  `ALTER TABLE wfm_ingest_days ADD COLUMN IF NOT EXISTS present_count INTEGER NOT NULL DEFAULT 0`,
];

const SCHEMA_VERSION = 3;

let applied = 0;
let inflight: Promise<void> | null = null;

export async function ensureAttendanceSchema(): Promise<void> {
  if (applied >= SCHEMA_VERSION) return;
  if (!inflight) {
    inflight = (async () => {
      for (const statement of STATEMENTS) {
        await query(statement);
      }
      applied = SCHEMA_VERSION;
    })().catch((error) => {
      throw error;
    }).finally(() => {
      inflight = null;
    });
  }
  await inflight;
}
