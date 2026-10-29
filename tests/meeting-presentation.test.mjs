import test from "node:test";
import assert from "node:assert/strict";
import {
  formatMeetingName,
  getDistrictOrtschaft,
  getUnnamedOrganizations,
  groupMeetingsByMonth,
  parseOrtschaftName,
} from "../src/shared/meeting-presentation.ts";

test("the publicity suffix and its typo variants are dropped", () => {
  for (const name of [
    "Sozialausschuss (öffentlich/nicht öffentlich)",
    "Sozialausschuss (öffentlich/nichtöffentlich)",
    "Sozialausschuss (öffentlich/nicht töffentlich)",
    "Sozialausschuss (öffentlich)",
    "Sozialausschuss (öffentlicher Teil)",
  ]) {
    assert.equal(formatMeetingName(name), "Sozialausschuss");
  }
});

test("a non-public session keeps its marker, other parentheses stay", () => {
  assert.equal(
    formatMeetingName("Ältestenrat (nicht öffentlich)"),
    "Ältestenrat (nicht öffentlich)",
  );
  assert.equal(
    formatMeetingName(
      'Betriebsausschuss "Eigenbetrieb Fußballstadion im Wildpark" (öffentlich/nicht öffentlich)',
    ),
    'Betriebsausschuss "Eigenbetrieb Fußballstadion im Wildpark"',
  );
  assert.equal(formatMeetingName("(öffentlich)"), "(öffentlich)");
});

test("an organization the name already spells out is not repeated", () => {
  assert.deepEqual(
    getUnnamedOrganizations("Klausurtagung Kulturausschuss", [
      "Kulturausschuss",
    ]),
    [],
  );
  assert.deepEqual(
    getUnnamedOrganizations(
      "Eigenbetrieb Abfallwirtschaft und Stadtreinigung",
      ["Betriebsausschuss Eigenbetrieb Abfallwirtschaft und Stadtreinigung"],
    ),
    ["Betriebsausschuss Eigenbetrieb Abfallwirtschaft und Stadtreinigung"],
  );
});

test("meetings group by consecutive local month, undated last", () => {
  const groups = groupMeetingsByMonth([
    { id: "a", start: "2026-11-03T18:30:00+01:00" },
    { id: "b", start: "2026-11-30T18:30:00+01:00" },
    { id: "c", start: "2026-12-01T18:30:00+01:00" },
    { id: "d", start: "" },
  ]);
  assert.deepEqual(
    groups.map(({ key, meetings }) => [key, meetings.map(({ id }) => id)]),
    [
      ["2026-11", ["a", "b"]],
      ["2026-12", ["c"]],
      ["ohne-datum", ["d"]],
    ],
  );
  assert.equal(groups[0].label, "November 2026");
});

test("districts map to their Ortschaft, Wettersbach covers two", () => {
  const ortschaften = ["Durlach", "Wettersbach"];
  assert.equal(parseOrtschaftName("Ortschaftsrat Durlach"), "Durlach");
  assert.equal(parseOrtschaftName("Gemeinderat"), "");
  assert.equal(getDistrictOrtschaft("Durlach", ortschaften), "Durlach");
  assert.equal(getDistrictOrtschaft("Palmbach", ortschaften), "Wettersbach");
  assert.equal(
    getDistrictOrtschaft("Grünwettersbach", ortschaften),
    "Wettersbach",
  );
  assert.equal(getDistrictOrtschaft("Südstadt", ortschaften), "");
});
