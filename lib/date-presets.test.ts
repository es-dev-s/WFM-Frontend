import assert from "node:assert/strict";
import test from "node:test";
import { datePresets } from "@/lib/date-presets";

function rangesFor(today: string) {
  return Object.fromEntries(
    datePresets(today).map(({ id, start, end }) => [id, [start, end]]),
  );
}

test("dashboard date presets use exact calendar boundaries", () => {
  assert.deepEqual(rangesFor("2026-10-06"), {
    today: ["2026-10-06", "2026-10-06"],
    week: ["2026-10-04", "2026-10-10"],
    lastMonth: ["2026-09-01", "2026-09-30"],
    thisMonth: ["2026-10-01", "2026-10-31"],
    last3Months: ["2026-07-09", "2026-10-06"],
  });
});

test("dashboard date presets handle year rollover and leap-year dates", () => {
  assert.deepEqual(rangesFor("2027-01-03"), {
    today: ["2027-01-03", "2027-01-03"],
    week: ["2027-01-03", "2027-01-09"],
    lastMonth: ["2026-12-01", "2026-12-31"],
    thisMonth: ["2027-01-01", "2027-01-31"],
    last3Months: ["2026-10-06", "2027-01-03"],
  });
  assert.deepEqual(rangesFor("2024-03-01").last3Months, ["2023-12-03", "2024-03-01"]);
});
