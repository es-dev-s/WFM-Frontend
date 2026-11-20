import assert from "node:assert/strict";
import test from "node:test";
import {
  addOneDay,
  isValidDay,
  normalizeOffboarding,
  normalizeTransfer,
  offboardingKey,
  validateOffboarding,
  validateTransfer,
} from "@/lib/server/records/validation";

const NOW = new Date("2026-11-20T06:00:00Z");

function transfer(overrides: Record<string, unknown> = {}) {
  return normalizeTransfer({
    employeeName: "  Test   Person ",
    employeeEmail: " T@X.com ",
    previousTeam: "Ops",
    newTeam: "Sales",
    transferDate: "2026-11-10",
    ...overrides,
  });
}

function offboarding(overrides: Record<string, unknown> = {}) {
  return normalizeOffboarding({
    employeeName: "Test Person",
    employeeEmail: "T@X.com",
    resignationDate: "2026-11-01",
    lastWorkingDate: "2026-11-30",
    ...overrides,
  });
}

test("normalize trims, collapses whitespace and lowercases email", () => {
  const fields = transfer();
  assert.equal(fields.employeeName, "Test Person");
  assert.equal(fields.employeeEmail, "t@x.com");
});

test("calendar days must be real dates", () => {
  assert.equal(isValidDay("2026-11-30"), true);
  assert.equal(isValidDay("2026-02-30"), false);
  assert.equal(isValidDay("11/30/2026"), false);
  assert.equal(addOneDay("2026-11-30"), "2026-12-01");
  assert.equal(addOneDay("2026-12-31"), "2027-01-01");
});

test("transfer: valid input passes", () => {
  assert.doesNotThrow(() => validateTransfer(transfer(), NOW));
});

test("transfer: same team (any case) is rejected", () => {
  assert.throws(() => validateTransfer(transfer({ newTeam: "ops" }), NOW), /differ/);
});

test("transfer: future dates are rejected, with a day of timezone slack", () => {
  assert.throws(() => validateTransfer(transfer({ transferDate: "2026-11-25" }), NOW), /future/);
  assert.doesNotThrow(() => validateTransfer(transfer({ transferDate: "2026-11-21" }), NOW));
});

test("transfer: required fields", () => {
  assert.throws(() => validateTransfer(transfer({ employeeName: "" }), NOW), /employee name/);
  assert.throws(() => validateTransfer(transfer({ previousTeam: "" }), NOW), /previous team/);
  assert.throws(() => validateTransfer(transfer({ transferDate: "" }), NOW), /transfer date/);
});

test("offboarding: valid input passes and keys by email", () => {
  const fields = offboarding();
  assert.doesNotThrow(() => validateOffboarding(fields));
  assert.equal(offboardingKey(fields), "email:t@x.com");
  assert.equal(offboardingKey(offboarding({ employeeEmail: "", memberId: "AB-1" })), "member:ab-1");
});

test("offboarding: last day cannot precede the resignation date", () => {
  assert.throws(
    () => validateOffboarding(offboarding({ lastWorkingDate: "2026-10-31" })),
    /before the resignation/,
  );
});

test("offboarding: needs an email or member id", () => {
  assert.throws(() => validateOffboarding(offboarding({ employeeEmail: "" })), /email or member id/);
});
