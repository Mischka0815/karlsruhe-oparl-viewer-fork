import test from "node:test";
import assert from "node:assert/strict";
import {
  countSeatHolders,
  formatMeetingDate,
  getBodyGroup,
  groupMembersByRole,
  isCouncilBody,
  summarizeBodyMeetings,
} from "../src/shared/bodies.ts";

function resolved(familyName, role) {
  return {
    membership: {
      id: `https://example.org/oparl/memberships/${familyName}`,
      type: "https://schema.oparl.org/1.1/Membership",
      person: `https://example.org/oparl/people/${familyName}`,
      organization: "https://example.org/oparl/organizations/gr/1",
      role,
    },
    person: {
      id: `https://example.org/oparl/people/${familyName}`,
      type: "https://schema.oparl.org/1.1/Person",
      name: `Vorname ${familyName}`,
      familyName,
    },
  };
}

function meeting(id, start) {
  return {
    id: `https://example.org/oparl/meetings/${id}`,
    type: "https://schema.oparl.org/1.1/Meeting",
    start,
  };
}

test("isCouncilBody only accepts organizations under /organizations/gr/", () => {
  assert.equal(
    isCouncilBody({ id: "https://example.org/oparl/organizations/gr/7" }),
    true,
  );
  assert.equal(
    isCouncilBody({ id: "https://example.org/oparl/organizations/at/7" }),
    false,
  );
});

test("getBodyGroup sorts bodies by their name", () => {
  assert.equal(getBodyGroup("Gemeinderat"), "Gemeinderat");
  assert.equal(getBodyGroup("Gemeinderat - Beratungen zum DHH"), "Gemeinderat");
  assert.equal(getBodyGroup("Ortschaftsrat Durlach"), "Ortschaftsräte");
  assert.equal(getBodyGroup("Bauausschuss"), "Ausschüsse");
  assert.equal(
    getBodyGroup("Ausschuss für Umwelt und Gesundheit"),
    "Ausschüsse",
  );
  assert.equal(getBodyGroup("Migrationsbeirat"), "Beiräte und Sonstige");
});

test("summarizeBodyMeetings picks the first upcoming and the latest past sitting", () => {
  const meetings = [
    meeting("a", "2026-09-01T17:00:00+02:00"),
    meeting("b", "2026-10-01T17:00:00+02:00"),
    meeting("c", "2026-11-10T17:00:00+01:00"),
    meeting("d", "2026-12-10T17:00:00+01:00"),
  ];
  const cutoff = Date.parse("2026-11-02T12:00:00+01:00");
  const summary = summarizeBodyMeetings(
    meetings,
    (entry) => Date.parse(entry.start) < cutoff,
  );
  assert.equal(summary.count, 4);
  assert.equal(summary.last?.id, meetings[1].id);
  assert.equal(summary.next?.id, meetings[2].id);
});

test("summarizeBodyMeetings handles bodies without sittings", () => {
  assert.deepEqual(
    summarizeBodyMeetings([], () => true),
    { count: 0, next: undefined, last: undefined },
  );
});

test("countSeatHolders counts chair and full members, not deputies", () => {
  const members = [
    resolved("A", "Vorsitz"),
    resolved("B", "Ordentliches Mitglied"),
    resolved("C", "Ordentliches Mitglied"),
    resolved("D", "Stellvertretendes Mitglied"),
    resolved("E", "Beratendes Mitglied"),
    resolved("F", "Sachkundige Einwohner"),
  ];
  assert.equal(countSeatHolders(members), 3);
});

test("groupMembersByRole follows the mandate role order and drops empty roles", () => {
  const groups = groupMembersByRole([
    resolved("B", "Stellvertretendes Mitglied"),
    resolved("A", "Ordentliches Mitglied"),
    resolved("C", "Vorsitz"),
    resolved("D", "Ordentliches Mitglied"),
  ]);
  assert.deepEqual(
    groups.map((group) => [group.role, group.members.length]),
    [
      ["Vorsitz", 1],
      ["Ordentliches Mitglied", 2],
      ["Stellvertretendes Mitglied", 1],
    ],
  );
});

test("formatMeetingDate includes weekday and year in Berlin time", () => {
  // 23:30 UTC on 16 March is already 17 March in Berlin.
  assert.equal(formatMeetingDate("2027-03-16T23:30:00Z"), "Mi., 17. März 2027");
  assert.equal(formatMeetingDate(undefined), "");
  assert.equal(formatMeetingDate("kein Datum"), "");
});
