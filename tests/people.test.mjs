import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  countSeatsByFaction,
  findFactionMember,
  getBerlinCalendarDate,
  isActiveOn,
  selectBodyMembers,
  selectCurrentFactionMembers,
} from "../src/shared/people.ts";

const COUNCIL = "https://example.org/oparl/organizations/gr/1";
const OTHER = "https://example.org/oparl/organizations/gr/2";

function person(id, familyName, extra = {}) {
  return {
    id: `https://example.org/oparl/people/${id}`,
    type: "https://schema.oparl.org/1.1/Person",
    name: `Vorname ${familyName}`,
    familyName,
    ...extra,
  };
}

function membership(personId, role, extra = {}) {
  return {
    id: `https://example.org/oparl/memberships/${personId}-${role}`,
    type: "https://schema.oparl.org/1.1/Membership",
    person: `https://example.org/oparl/people/${personId}`,
    organization: COUNCIL,
    role,
    startDate: "2024-07-23",
    ...extra,
  };
}

function peopleById(...people) {
  return new Map(people.map((entry) => [entry.id, entry]));
}

test("membership bounds are inclusive calendar days", () => {
  assert.equal(isActiveOn("2024-07-23", "2026-03-31", "2024-07-23"), true);
  assert.equal(isActiveOn("2024-07-23", "2026-03-31", "2026-03-31"), true);
  assert.equal(isActiveOn("2024-07-23", "2026-03-31", "2026-04-01"), false);
  assert.equal(isActiveOn(undefined, undefined, "2026-11-02"), true);
  assert.equal(
    isActiveOn("2024-07-23T00:00:00+02:00", null, "2024-07-23"),
    true,
  );
});

test("calendar day follows Karlsruhe time, not UTC", () => {
  assert.equal(
    getBerlinCalendarDate(new Date("2026-11-01T23:30:00Z")),
    "2026-11-02",
  );
});

test("body members keep mandate roles only and order by role, then family name", () => {
  const people = peopleById(
    person(1, "Zeller"),
    person(2, "Albrecht"),
    person(3, "Mayer"),
    person(4, "Becker"),
  );
  const members = selectBodyMembers(
    [
      membership(1, "Ordentliches Mitglied"),
      membership(2, "Ordentliches Mitglied"),
      membership(3, "Vorsitz"),
      membership(4, "Fraktionsgeschäftsstelle"),
      membership(4, undefined),
    ],
    COUNCIL,
    people,
    "2026-11-02",
  );
  assert.deepEqual(
    members.map(({ person: entry }) => entry.familyName),
    ["Mayer", "Albrecht", "Zeller"],
  );
});

test("a person with several memberships appears once, with the strongest role", () => {
  const members = selectBodyMembers(
    [
      membership(1, "Stellvertretendes Mitglied"),
      membership(1, "Ordentliches Mitglied"),
    ],
    COUNCIL,
    peopleById(person(1, "Huber")),
    "2026-11-02",
  );
  assert.equal(members.length, 1);
  assert.equal(members[0].membership.role, "Ordentliches Mitglied");
});

test("ended, future, deleted and other-body memberships are left out", () => {
  const members = selectBodyMembers(
    [
      membership(1, "Ordentliches Mitglied", { endDate: "2026-03-31" }),
      membership(2, "Ordentliches Mitglied", { startDate: "2027-01-01" }),
      membership(3, "Ordentliches Mitglied", { deleted: true }),
      membership(4, "Ordentliches Mitglied", { organization: OTHER }),
    ],
    COUNCIL,
    peopleById(person(1, "A"), person(2, "B"), person(3, "C"), person(4, "D")),
    "2026-11-02",
  );
  assert.deepEqual(members, []);
});

test("memberships of unpublished or deleted people never surface", () => {
  const members = selectBodyMembers(
    [
      membership(1, "Ordentliches Mitglied"),
      membership(2, "Ordentliches Mitglied"),
    ],
    COUNCIL,
    peopleById(person(2, "Gelöscht", { deleted: true })),
    "2026-11-02",
  );
  assert.deepEqual(members, []);
});

function factionIndex(members) {
  return {
    version: 1,
    organization: COUNCIL,
    legislativeTerm: "2024-2029",
    source: { url: "https://example.org", retrieved: "2026-11-02", note: "" },
    factions: {
      gruene: { name: "GRÜNE", submitterIds: ["gruene"] },
      cdu: { name: "CDU", submitterIds: ["cdu"] },
      "fdp-fw": { name: "FDP/FW", submitterIds: ["fdp", "fw"] },
    },
    members,
  };
}

function seat(id, faction, councilSince = "2024-07-23", councilUntil = null) {
  return {
    person: `https://example.org/oparl/people/${id}`,
    name: `Person ${id}`,
    faction,
    risLabel: faction,
    role: faction ? "Ordentliches Mitglied" : "Vorsitz",
    councilSince,
    councilUntil,
  };
}

test("seat counts skip the mayor and former members, largest faction first", () => {
  const index = factionIndex([
    seat(1, null),
    seat(2, "cdu"),
    seat(3, "gruene"),
    seat(4, "gruene"),
    seat(5, "fdp-fw"),
    seat(6, "cdu", "2019-07-23", "2026-03-31"),
  ]);
  assert.deepEqual(countSeatsByFaction(index, "2026-11-02"), [
    { factionId: "gruene", name: "GRÜNE", seats: 2 },
    { factionId: "cdu", name: "CDU", seats: 1 },
    { factionId: "fdp-fw", name: "FDP/FW", seats: 1 },
  ]);
});

test("seat counts follow the day they are asked for", () => {
  const index = factionIndex([
    seat(1, "cdu", "2019-07-23", "2026-03-31"),
    seat(2, "gruene", "2026-04-01"),
  ]);
  assert.deepEqual(
    countSeatsByFaction(index, "2026-03-31").map((entry) => entry.factionId),
    ["cdu"],
  );
  assert.deepEqual(
    countSeatsByFaction(index, "2026-04-01").map((entry) => entry.factionId),
    ["gruene"],
  );
});

test("faction lookup only answers for people on the council that day", () => {
  const index = factionIndex([seat(1, "cdu", "2019-07-23", "2026-03-31")]);
  const personId = "https://example.org/oparl/people/1";
  assert.equal(
    findFactionMember(index, personId, "2026-01-01")?.faction,
    "cdu",
  );
  assert.equal(findFactionMember(index, personId, "2026-11-02"), undefined);
});

test("the shipped faction mapping is consistent", async () => {
  const index = JSON.parse(
    await readFile(
      new URL("../src/data/faction-members.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(index.version, 1);

  const people = index.members.map((member) => member.person);
  assert.equal(new Set(people).size, people.length, "duplicate person");

  for (const member of index.members) {
    assert.match(member.councilSince, /^\d{4}-\d{2}-\d{2}$/);
    if (member.councilUntil !== null) {
      assert.ok(member.councilUntil >= member.councilSince, member.name);
    }
    if (member.faction !== null) {
      assert.ok(index.factions[member.faction], `unknown ${member.faction}`);
    }
  }

  // The Gemeinderat has 48 seats plus the mayor, who holds no faction seat.
  const current = selectCurrentFactionMembers(index, "2026-11-02");
  assert.equal(current.length, 49);
  assert.equal(
    countSeatsByFaction(index, "2026-11-02").reduce(
      (sum, entry) => sum + entry.seats,
      0,
    ),
    48,
  );
});
