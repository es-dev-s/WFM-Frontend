import assert from "node:assert/strict";
import test from "node:test";
import {
  annotateOffboarding,
  excludeSeparated,
  runWithOffboarding,
  setOffboardingLoaderForTests,
} from "@/lib/server/offboarding-scope";

const record = {
  id: "off_1",
  memberId: "",
  employeeName: "Test Person",
  employeeEmail: "test@example.com",
  team: "Ops",
  resignationDate: "2026-11-01",
  lastWorkingDate: "2026-11-30",
  effectiveDate: "2026-12-01",
  status: "Serving notice",
  reason: "",
  notes: "",
  recordedBy: "",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

function mockRecords() {
  setOffboardingLoaderForTests(async () => ({
    items: [record as never],
    today: "2026-11-20",
  }));
}

const members = [
  { id: "1", name: "Test Person", email: "TEST@example.com" },
  { id: "2", name: "Someone Else", email: "else@example.com" },
];

test("employee stays in headcount through the last working date", async () => {
  mockRecords();
  for (const day of ["2026-11-20", "2026-11-30"]) {
    const kept = await runWithOffboarding(day, async () => excludeSeparated(members));
    assert.equal(kept.length, 2, `still counted on ${day}`);
  }
});

test("employee leaves headcount from the effective date", async () => {
  mockRecords();
  const kept = await runWithOffboarding("2026-12-01", async () => excludeSeparated(members));
  assert.deepEqual(kept.map((m) => m.id), ["2"]);
});

test("a past range ending before the effective date still includes them", async () => {
  mockRecords();
  const kept = await runWithOffboarding("2026-11-15", async () => excludeSeparated(members));
  assert.equal(kept.length, 2);
});

test("rows get an offboarding tag without mutating the shared payload", async () => {
  mockRecords();
  const payload = { items: members };
  const tagged = await runWithOffboarding("2026-11-20", async () => annotateOffboarding(payload));
  assert.equal(
    (tagged.items[0] as { offboarding?: { status: string } }).offboarding?.status,
    "Serving notice",
  );
  assert.equal("offboarding" in payload.items[0], false);
  assert.equal("offboarding" in tagged.items[1], false);
});

test("a failing records service does not break headcount", async () => {
  setOffboardingLoaderForTests(async () => {
    throw new Error("connection refused");
  });
  const kept = await runWithOffboarding("2026-12-01", async () => excludeSeparated(members));
  assert.equal(kept.length, 2);
});
