/**
 * One-time import of records the old WFM-Backend service kept in JSON files
 * (USE_DATABASE=false) into the frontend's Postgres.
 *
 *   npm run import:records -- --transfers path/to/transfers.json --offboarding path/to/offboarding.json
 *
 * Safe to re-run: existing ids are skipped. If WFM-Backend ran with
 * USE_DATABASE=true against this same database, the tables already exist and
 * nothing needs importing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../lib/server/auth/db";
import { ensureRecordsSchema } from "../lib/server/records/schema";

function loadEnvFile(file: string) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? (process.argv[index + 1] ?? "") : "";
}

function readJsonArray(path: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(readFileSync(resolve(path), "utf8") || "[]");
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON array`);
  return parsed as Array<Record<string, unknown>>;
}

const s = (value: unknown) => (typeof value === "string" ? value : "");

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const transfersPath = arg("transfers");
  const offboardingPath = arg("offboarding");
  if (!transfersPath && !offboardingPath) {
    console.error("Pass --transfers <file> and/or --offboarding <file>.");
    process.exit(2);
  }
  await ensureRecordsSchema();
  const pool = getPool();

  if (transfersPath) {
    let added = 0;
    const rows = readJsonArray(transfersPath);
    for (const row of rows) {
      const result = await pool.query(
        `INSERT INTO team_transfers
           (id, member_id, employee_name, employee_email, previous_team, new_team,
            transfer_date, reason, notes, recorded_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, COALESCE($11::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING`,
        [
          s(row.id), s(row.memberId), s(row.employeeName), s(row.employeeEmail),
          s(row.previousTeam), s(row.newTeam), s(row.transferDate), s(row.reason),
          s(row.notes), s(row.recordedBy), s(row.createdAt) || null,
        ],
      );
      added += result.rowCount ?? 0;
    }
    console.log(`transfers: ${added} imported, ${rows.length - added} already present`);
  }

  if (offboardingPath) {
    let added = 0;
    const rows = readJsonArray(offboardingPath);
    for (const row of rows) {
      const email = s(row.employeeEmail).toLowerCase();
      const key = s(row.key) || (email ? `email:${email}` : `member:${s(row.memberId).toLowerCase()}`);
      const result = await pool.query(
        `INSERT INTO employee_offboarding
           (id, employee_key, member_id, employee_name, employee_email, team,
            resignation_date, last_working_date, reason, notes, recorded_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11,
                 COALESCE($12::timestamptz, now()), COALESCE($13::timestamptz, now()))
         ON CONFLICT DO NOTHING`,
        [
          s(row.id), key, s(row.memberId), s(row.employeeName), email, s(row.team),
          s(row.resignationDate), s(row.lastWorkingDate), s(row.reason), s(row.notes),
          s(row.recordedBy), s(row.createdAt) || null, s(row.updatedAt) || null,
        ],
      );
      added += result.rowCount ?? 0;
    }
    console.log(`offboarding: ${added} imported, ${rows.length - added} already present`);
  }
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
