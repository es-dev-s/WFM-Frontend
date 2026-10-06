import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardRosterPerson } from "@/lib/api";
import {
  averageDashboardClockIn,
  buildPunchCompareBundle,
} from "@/lib/dashboard-scope";
import { cardPeople } from "@/lib/dashboard-links";
import {
  DASHBOARD_LATE_AFTER_MIN,
  averageWorkdayTimes,
  isLateClockIn,
  mergeWorkdayPeople,
  workdayLateOn,
} from "@/lib/workday-clock";

function rosterPerson(id: string, clockIn: string): DashboardRosterPerson {
  return {
    source: "bio",
    id,
    email: `${id}@example.test`,
    name: id,
    teams: [],
    department: "",
    groups: [],
    attendance: "Present",
    status: "",
    startTime: clockIn,
    endTime: "15:00",
    clockedIn: clockIn,
    lastScreenshot: "15:00",
    trackedSeconds: 0,
    trackedLabel: "",
    designation: "",
    joinDate: "",
  };
}

test("clock-in average includes only first punches strictly before 08:00", () => {
  const people = mergeWorkdayPeople(
    [
      rosterPerson("early", "07:00"),
      rosterPerson("middle", "07:10"),
      rosterPerson("last-on-time", "07:59"),
      rosterPerson("exactly-eight", "08:00"),
      rosterPerson("after-eight", "08:01"),
    ],
    [],
    false,
    DASHBOARD_LATE_AFTER_MIN,
  );

  assert.equal(
    averageWorkdayTimes(people, DASHBOARD_LATE_AFTER_MIN).inTime,
    "07:23",
  );
  assert.equal(
    people.find((person) => person.id === "last-on-time")?.arrival,
    "on-time",
  );
  assert.equal(
    people.find((person) => person.id === "exactly-eight")?.arrival,
    "late",
  );
  assert.equal(
    people.find((person) => person.id === "after-eight")?.arrival,
    "late",
  );
});

test("late highlighting uses 08:00 boundary and selected attendance source", () => {
  const makeSourcePerson = (
    source: "bio" | "tivazo",
    clockIn: string,
  ): DashboardRosterPerson => ({
    ...rosterPerson("paired-member", clockIn),
    source,
    startTime: source === "bio" ? clockIn : "",
    clockedIn: source === "tivazo" ? clockIn : "",
  });
  const [paired] = mergeWorkdayPeople(
    [makeSourcePerson("bio", "07:59")],
    [makeSourcePerson("tivazo", "08:00")],
    false,
    DASHBOARD_LATE_AFTER_MIN,
  );
  const [atEight] = mergeWorkdayPeople(
    [makeSourcePerson("bio", "08:00")],
    [],
    false,
    DASHBOARD_LATE_AFTER_MIN,
  );

  assert.equal(workdayLateOn(paired, "bio"), false);
  assert.equal(workdayLateOn(paired, "tivazo"), true);
  assert.equal(workdayLateOn(paired, "all"), true);
  assert.equal(workdayLateOn(atEight, "bio"), true);
  assert.equal(workdayLateOn(atEight, "all"), true);
  assert.equal(isLateClockIn("07:59"), false);
  assert.equal(isLateClockIn("08:00"), true);
  assert.equal(isLateClockIn("08:01"), true);
  assert.equal(isLateClockIn(""), false);
});

test("clock-in average is unavailable when all present members are late", () => {
  const people = mergeWorkdayPeople(
    [rosterPerson("exactly-eight", "08:00"), rosterPerson("late", "08:30")],
    [],
    false,
    DASHBOARD_LATE_AFTER_MIN,
  );

  assert.equal(averageWorkdayTimes(people, DASHBOARD_LATE_AFTER_MIN).inTime, "—");
});

test("shared arrival defaults retain their prior 07:15 policy", () => {
  const [person] = mergeWorkdayPeople([rosterPerson("legacy-cutoff", "07:30")], [], false);
  assert.equal(person?.arrival, "late");
  const legacyAverage = mergeWorkdayPeople(
    [rosterPerson("legacy-1", "07:30"), rosterPerson("legacy-2", "08:00")],
    [],
    false,
  );
  assert.equal(averageWorkdayTimes(legacyAverage).inTime, "07:45");
});

test("range average uses eligible person-day aggregates only", () => {
  const early = {
    ...rosterPerson("early-range", "07:30"),
    clockInSumMinutes: 1_470,
    clockInSamples: 3,
    clockInBeforeEightSumMinutes: 900,
    clockInBeforeEightSamples: 2,
  };
  const late = {
    ...rosterPerson("late-range", "08:15"),
    clockInSumMinutes: 1_005,
    clockInSamples: 2,
    clockInBeforeEightSumMinutes: 0,
    clockInBeforeEightSamples: 0,
  };

  assert.equal(averageDashboardClockIn([early, late], [], "bio"), "07:30");
  assert.equal(averageDashboardClockIn([late], [], "bio"), "—");
});

test("range comparison averages each member's daily source means, not earliest/latest extremes", () => {
  const rangePerson = (
    id: string,
    source: "bio" | "tivazo",
    inSum: number,
    inSamples: number,
    outSum: number,
    outSamples: number,
  ): DashboardRosterPerson => ({
    ...rosterPerson(id, "07:00"),
    source,
    startTime: "07:00",
    clockedIn: source === "tivazo" ? "07:00" : "",
    endTime: "16:00",
    lastScreenshot: source === "tivazo" ? "16:00" : "",
    clockInSumMinutes: inSum,
    clockInSamples: inSamples,
    clockInBeforeEightSumMinutes: inSum,
    clockInBeforeEightSamples: inSamples,
    clockOutSumMinutes: outSum,
    clockOutSamples: outSamples,
  });
  const bio = [
    rangePerson("member-a", "bio", 900, 2, 1_980, 2),
    rangePerson("member-b", "bio", 360, 1, 930, 1),
    {
      ...rangePerson("member-c", "bio", 480, 1, 1_020, 1),
      clockInBeforeEightSumMinutes: 0,
      clockInBeforeEightSamples: 0,
    },
  ];
  const tivazo = [
    rangePerson("member-a", "tivazo", 930, 2, 1_920, 2),
    rangePerson("member-b", "tivazo", 375, 1, 900, 1),
    {
      ...rangePerson("member-c", "tivazo", 510, 1, 1_000, 1),
      clockInBeforeEightSumMinutes: 0,
      clockInBeforeEightSamples: 0,
    },
  ];

  const { compare } = buildPunchCompareBundle(bio, tivazo, { period: "range" });

  assert.deepEqual(compare.checkIn, {
    first: { time: "06:45", people: 2 },
    second: { time: "07:00", people: 2 },
    gap: {
      label: "15 min",
      minutes: 15,
      people: 2,
      note: "Tivazo after Biometrics",
    },
    overall: { time: "06:45", people: 2 },
  });
  assert.deepEqual(compare.checkOut, {
    first: { time: "15:53:20", people: 3 },
    second: { time: "16:20", people: 3 },
    gap: {
      label: "26 min 40 sec",
      minutes: 26 + 40 / 60,
      people: 3,
      note: "Biometrics after Tivazo",
    },
    overall: { time: "16:20", people: 3 },
  });
});

test("check-in comparison excludes punches at or after 08:00", () => {
  const tivazoPerson = (id: string, clockIn: string): DashboardRosterPerson => ({
    ...rosterPerson(id, clockIn),
    source: "tivazo",
    startTime: "",
    clockedIn: clockIn,
  });
  const bio = [
    rosterPerson("early", "07:59"),
    rosterPerson("at-eight", "08:00"),
    rosterPerson("after-eight", "08:15"),
  ];
  const tivazo = [
    tivazoPerson("early", "07:40"),
    tivazoPerson("at-eight", "07:45"),
    tivazoPerson("after-eight", "08:10"),
  ];

  const { compare } = buildPunchCompareBundle(bio, tivazo);

  assert.deepEqual(compare.checkIn, {
    first: { time: "07:59", people: 1 },
    second: { time: "07:42:30", people: 2 },
    gap: {
      label: "19 min",
      minutes: 19,
      people: 1,
      note: "Tivazo before Biometrics",
    },
    overall: { time: "07:42:30", people: 2 },
  });
});

test("range comparison retains fractional-minute precision through averages and paired gaps", () => {
  const rangePerson = (
    id: string,
    source: "bio" | "tivazo",
    inSum: number,
    inSamples: number,
  ): DashboardRosterPerson => ({
    ...rosterPerson(id, "07:00"),
    source,
    startTime: source === "bio" ? "07:00" : "",
    clockedIn: source === "tivazo" ? "07:00" : "",
    endTime: "15:00",
    lastScreenshot: source === "tivazo" ? "15:00" : "",
    clockInSumMinutes: inSum,
    clockInSamples: inSamples,
    clockInBeforeEightSumMinutes: inSum,
    clockInBeforeEightSamples: inSamples,
    clockOutSumMinutes: 900,
    clockOutSamples: 1,
  });

  const bio = [
    rangePerson("member-a", "bio", 847, 2),
    rangePerson("member-b", "bio", 847, 2),
    rangePerson("member-c", "bio", 424, 1),
    rangePerson("member-d", "bio", 424, 1),
    rangePerson("member-e", "bio", 424, 1),
  ];
  const tivazo = [
    rangePerson("member-a", "tivazo", 870, 2),
    rangePerson("member-b", "tivazo", 870, 2),
    rangePerson("member-c", "tivazo", 435, 1),
    rangePerson("member-d", "tivazo", 435, 1),
    rangePerson("member-e", "tivazo", 437, 1),
  ];

  const { compare } = buildPunchCompareBundle(bio, tivazo, { period: "range" });

  assert.deepEqual(compare.checkIn, {
    first: { time: "07:03:48", people: 5 },
    second: { time: "07:15:24", people: 5 },
    gap: {
      label: "11 min 36 sec",
      minutes: 11.6,
      people: 5,
      note: "Tivazo after Biometrics",
    },
    overall: { time: "07:03:48", people: 5 },
  });
});

test("range source cards include people with any absent or leave day", () => {
  const people: DashboardRosterPerson[] = [
    {
      ...rosterPerson("present-and-absent", "07:30"),
      attendedDays: 2,
      absentDays: 1,
      leaveDays: 0,
    },
    {
      ...rosterPerson("leave-only", ""),
      attendance: "Absent",
      attendedDays: 0,
      absentDays: 0,
      leaveDays: 1,
    },
    {
      ...rosterPerson("present-only", "07:45"),
      attendedDays: 3,
      absentDays: 0,
      leaveDays: 0,
    },
  ];

  assert.deepEqual(
    cardPeople(people, "present").map((person) => person.id),
    ["present-and-absent", "present-only"],
  );
  assert.deepEqual(
    cardPeople(people, "absent").map((person) => person.id),
    ["present-and-absent"],
  );
  assert.deepEqual(
    cardPeople(people, "leave").map((person) => person.id),
    ["leave-only"],
  );
  assert.equal(cardPeople(people, "all").length, 3);
  assert.equal(
    cardPeople([rosterPerson("single-day-absent", "")], "absent").length,
    0,
  );
  assert.equal(
    cardPeople([{ ...rosterPerson("single-day-absent", ""), attendance: "Absent" }], "absent").length,
    1,
  );
});
