import { BffError } from "@/lib/server/upstream";

const MAX_FIELD = 120;
const MAX_NOTES = 1000;

/** Trim and collapse inner whitespace on single-line fields. */
export function line(value: unknown): string {
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ") : "";
}

export function multiline(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True for a real calendar day written as YYYY-MM-DD. */
export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addOneDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function fail(message: string): never {
  throw new BffError(400, "invalid_argument", message);
}

function checkLengths(fields: Array<[label: string, value: string, max: number]>) {
  for (const [label, value, max] of fields) {
    if ([...value].length > max) fail(`${label} must be at most ${max} characters`);
  }
}

export type TransferFields = {
  memberId: string;
  employeeName: string;
  employeeEmail: string;
  previousTeam: string;
  newTeam: string;
  transferDate: string;
  reason: string;
  notes: string;
  recordedBy: string;
};

export function normalizeTransfer(input: Record<string, unknown>): TransferFields {
  return {
    memberId: line(input.memberId),
    employeeName: line(input.employeeName),
    employeeEmail: line(input.employeeEmail).toLowerCase(),
    previousTeam: line(input.previousTeam),
    newTeam: line(input.newTeam),
    transferDate: multiline(input.transferDate),
    reason: line(input.reason),
    notes: multiline(input.notes),
    recordedBy: line(input.recordedBy),
  };
}

/** `now` is injected so tests are stable. */
export function validateTransfer(input: TransferFields, now = new Date()): void {
  if (!input.employeeName) fail("employee name is required");
  if (!input.previousTeam) fail("previous team is required");
  if (!input.newTeam) fail("new team is required");
  if (input.previousTeam.toLowerCase() === input.newTeam.toLowerCase()) {
    fail("new team must differ from the previous team");
  }
  if (!input.transferDate) fail("transfer date is required");
  if (!isValidDay(input.transferDate)) fail("transfer date must be YYYY-MM-DD");
  // One day of slack covers timezones ahead of UTC.
  const limit = new Date(now.getTime() + 24 * 3600 * 1000);
  if (new Date(`${input.transferDate}T00:00:00Z`) > limit) {
    fail("transfer date cannot be in the future");
  }
  checkLengths([
    ["employee name", input.employeeName, MAX_FIELD],
    ["employee email", input.employeeEmail, MAX_FIELD],
    ["member id", input.memberId, MAX_FIELD],
    ["previous team", input.previousTeam, MAX_FIELD],
    ["new team", input.newTeam, MAX_FIELD],
    ["recorded by", input.recordedBy, MAX_FIELD],
    ["reason", input.reason, MAX_FIELD],
    ["notes", input.notes, MAX_NOTES],
  ]);
}

export type OffboardingFields = {
  memberId: string;
  employeeName: string;
  employeeEmail: string;
  team: string;
  resignationDate: string;
  lastWorkingDate: string;
  reason: string;
  notes: string;
  recordedBy: string;
};

export function normalizeOffboarding(input: Record<string, unknown>): OffboardingFields {
  return {
    memberId: line(input.memberId),
    employeeName: line(input.employeeName),
    employeeEmail: line(input.employeeEmail).toLowerCase(),
    team: line(input.team),
    resignationDate: multiline(input.resignationDate),
    lastWorkingDate: multiline(input.lastWorkingDate),
    reason: line(input.reason),
    notes: multiline(input.notes),
    recordedBy: line(input.recordedBy),
  };
}

/** One record per employee: email first, member id otherwise. */
export function offboardingKey(input: OffboardingFields): string {
  return input.employeeEmail
    ? `email:${input.employeeEmail}`
    : `member:${input.memberId.toLowerCase()}`;
}

export function validateOffboarding(input: OffboardingFields): void {
  if (!input.employeeName) fail("employee name is required");
  if (!input.employeeEmail && !input.memberId) fail("employee email or member id is required");
  if (!input.resignationDate) fail("resignation date is required");
  if (!isValidDay(input.resignationDate)) fail("resignation date must be YYYY-MM-DD");
  if (!input.lastWorkingDate) fail("last working date is required");
  if (!isValidDay(input.lastWorkingDate)) fail("last working date must be YYYY-MM-DD");
  if (input.lastWorkingDate < input.resignationDate) {
    fail("last working date cannot be before the resignation date");
  }
  checkLengths([
    ["employee name", input.employeeName, MAX_FIELD],
    ["employee email", input.employeeEmail, MAX_FIELD],
    ["member id", input.memberId, MAX_FIELD],
    ["team", input.team, MAX_FIELD],
    ["reason", input.reason, MAX_FIELD],
    ["recorded by", input.recordedBy, MAX_FIELD],
    ["notes", input.notes, MAX_NOTES],
  ]);
}
