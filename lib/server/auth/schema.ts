import { query } from "@/lib/server/auth/db";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS wfm_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('wfm', 'team_lead', 'hr')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_by UUID REFERENCES wfm_users(id) ON DELETE SET NULL,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS wfm_team_assignments (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES wfm_users(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('tivazo', 'biometrics')),
    team_id TEXT NOT NULL,
    team_label TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, source, team_id)
  )`,
  `CREATE TABLE IF NOT EXISTS wfm_audit_events (
    id UUID PRIMARY KEY,
    actor_id UUID REFERENCES wfm_users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS wfm_users_email_idx ON wfm_users (lower(email))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS wfm_users_email_lower_uidx ON wfm_users (lower(email))`,
  `CREATE INDEX IF NOT EXISTS wfm_users_role_idx ON wfm_users (role, status)`,
  `CREATE INDEX IF NOT EXISTS wfm_team_assignments_user_idx ON wfm_team_assignments (user_id)`,
  `CREATE INDEX IF NOT EXISTS wfm_audit_created_idx ON wfm_audit_events (created_at DESC)`,
];

const ROLE_CHECK = `
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'wfm_users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
      AND pg_get_constraintdef(oid) NOT ILIKE '%''hr''%'
  LOOP
    EXECUTE format('ALTER TABLE wfm_users DROP CONSTRAINT %I', item.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'wfm_users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
      AND pg_get_constraintdef(oid) ILIKE '%''hr''%'
  ) THEN
    ALTER TABLE wfm_users
      ADD CONSTRAINT wfm_users_role_check
      CHECK (role IN ('wfm', 'team_lead', 'hr'));
  END IF;
END $$;
`;

let ready: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const statement of STATEMENTS) {
        await query(statement);
      }
      await query(ROLE_CHECK);
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
}
