import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDate,
  dateMatches,
  effectiveSort,
  invalidDateRange,
  parseSearchState,
  serializeSearchState,
} from "../src/shared/search-state.ts";
import {
  readSavedSearches,
  upsertSavedSearch,
  markSavedSearchViewed,
  buildSavedSearchUrl,
} from "../src/shared/saved-searches.ts";
import { searchPapers } from "../src/shared/pagefind-client.ts";
const state = (values) => parseSearchState(new URLSearchParams(values));
test("full combined state round trips and drops unknown parameters", () => {
  const search = state({
    q: "  Klima   Schutz ",
    district: "Durlach",
    faction: "gruene",
    committee: "https://example/org/2",
    from: "2024-01-01",
    to: "2024-12-31",
    type: "Antrag",
    sort: "modified",
    obsolete: "x",
  });
  assert.deepEqual(
    state(
      Object.fromEntries(new URLSearchParams(serializeSearchState(search))),
    ),
    search,
  );
  assert.equal(search.q, "Klima Schutz");
  assert.ok(!serializeSearchState(search).includes("obsolete"));
});
test("inclusive one-sided calendar boundaries use paper date and exclude missing or invalid dates", () => {
  assert.equal(calendarDate("2024-02-29T23:59:59-05:00"), "2024-02-29");
  assert.equal(calendarDate("2023-02-29"), "");
  assert.equal(calendarDate(undefined), "");
  assert.equal(calendarDate("2024-01-01invalid"), "");
  assert.ok(
    dateMatches("2024-02-29", state({ from: "2024-02-29", to: "2024-02-29" })),
  );
  assert.ok(dateMatches("2024-12-31", state({ from: "2024-01-01" })));
  assert.ok(dateMatches("2020-01-01", state({ to: "2024-01-01" })));
  assert.ok(!dateMatches("", state({ from: "2024-01-01" })));
  assert.ok(dateMatches("", state({})));
  assert.ok(invalidDateRange(state({ from: "2025-01-01", to: "2024-01-01" })));
  assert.ok(invalidDateRange(state({ from: "not-a-date" })));
});
test("automatic sort tracks text, explicit sort persists, relevance without text uses changed order", () => {
  assert.equal(effectiveSort(state({})), "modified");
  assert.equal(effectiveSort(state({ q: "Klima" })), "relevance");
  assert.equal(effectiveSort(state({ q: "Klima", sort: "date" })), "date");
  assert.equal(effectiveSort(state({ sort: "date" })), "date");
  assert.equal(effectiveSort(state({ sort: "relevance" })), "modified");
  assert.equal(state({ sort: "obsolete" }).sort, "");
});
test("legacy year becomes paper calendar date range while explicit boundaries win", () => {
  assert.deepEqual(
    state({ year: "2024" }),
    state({ from: "2024-01-01", to: "2024-12-31" }),
  );
  assert.equal(state({ year: "2024", from: "2024-06-01" }).from, "2024-06-01");
  assert.equal(state({ year: "garbage" }).from, "");
  assert.equal(
    buildSavedSearchUrl("/base/", state({ year: "2024" })),
    "/base/?from=2024-01-01&to=2024-12-31",
  );
});
test("old saved searches preserve checkpoints, full state deduplicates and permits filter-only searches", () => {
  const old = [
    {
      query: " Klima ",
      savedAt: "2024-01-01T00:00:00Z",
      lastViewedAt: "2024-02-01T00:00:00Z",
    },
  ];
  const migrated = readSavedSearches({ getItem: () => JSON.stringify(old) });
  assert.equal(migrated[0].lastViewedAt, "2024-02-01T00:00:00.000Z");
  let saved = upsertSavedSearch(
    migrated,
    state({ district: "Durlach", faction: "gruene" }),
    new Date("2024-03-01"),
  );
  saved = upsertSavedSearch(
    saved,
    state({ district: "Durlach", faction: "spd" }),
    new Date("2024-03-02"),
  );
  saved = upsertSavedSearch(
    saved,
    state({ q: "klima" }),
    new Date("2024-03-03"),
  );
  assert.equal(saved.length, 3);
  assert.equal(
    saved.find((s) => s.query === "klima").lastViewedAt,
    migrated[0].lastViewedAt,
  );
  const viewed = markSavedSearchViewed(
    saved,
    state({ district: "Durlach", faction: "gruene" }),
    new Date("2024-04-01"),
  );
  assert.equal(
    viewed.find((s) => s.state.faction === "gruene").lastViewedAt,
    "2024-04-01T00:00:00.000Z",
  );
  assert.equal(
    viewed.find((s) => s.state.faction === "spd").lastViewedAt,
    "2024-03-02T00:00:00.000Z",
  );
});
test("Pagefind receives combined filters and all eligible inclusive days before pagination", async () => {
  const calls = [];
  const module = {
    filters: async () => ({
      day: {
        "2023-12-31": 1,
        "2024-01-01": 1,
        "2024-12-31": 1,
        "2025-01-01": 1,
      },
    }),
    search: async (term, options) => {
      calls.push({ term, options });
      return { results: [] };
    },
  };
  await searchPapers(
    module,
    state({
      district: "Durlach",
      faction: "gruene",
      committee: "org2",
      from: "2024-01-01",
      to: "2024-12-31",
      type: "Antrag",
    }),
  );
  assert.equal(calls[0].term, null);
  assert.deepEqual(calls[0].options, {
    filters: {
      district: "Durlach",
      faction: "gruene",
      committee: "org2",
      type: "Antrag",
      day: { any: ["2024-01-01", "2024-12-31"] },
    },
    sort: { changed: "asc" },
  });
});
test("reference slash and route forms use the same exact filter without fetching fragments", async () => {
  const calls = [];
  const module = {
    filters: async () => ({ reference: { "2024-123": 1 } }),
    search: async (term, options) => {
      calls.push({ term, options });
      return { results: [] };
    },
  };
  await searchPapers(module, state({ q: "2024/123" }));
  await searchPapers(module, state({ q: "2024-123" }));
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].options.filters.reference, "2024-123");
});

test("public committee history includes non-leading organizations and excludes private or unresolved agenda entries", async () => {
  const { publicCommitteeIds } =
    await import("../src/shared/public-consultations.ts");
  const organizations = new Map(
    ["lead", "later", "meeting", "private"].map((id) => [id, { id, name: id }]),
  );
  const meetings = new Map([
    [
      "one",
      {
        organization: ["meeting"],
        agendaItem: [
          { id: "public", public: true },
          { id: "unknown-public" },
          { id: "private", public: false },
        ],
      },
    ],
  ]);
  const paper = {
    underDirectionOf: ["lead"],
    consultation: [
      { meeting: "one", agendaItem: "public", organization: ["later"] },
      { meeting: "one", agendaItem: "unknown-public", organization: ["lead"] },
      { meeting: "one", agendaItem: "private", organization: ["private"] },
      { meeting: "missing", agendaItem: "missing", organization: ["private"] },
    ],
  };
  assert.deepEqual(publicCommitteeIds(paper, meetings, organizations), [
    "later",
    "meeting",
    "lead",
  ]);
});

test("freshness candidate day filters remain separate from the paper date range and visible sort", async () => {
  const calls = [];
  const module = {
    filters: async () => ({
      day: { "2024-01-01": 1 },
      freshness: { "2026-09-15": 1 },
    }),
    search: async (term, options) => {
      calls.push(options);
      return { results: [] };
    },
  };
  await searchPapers(
    module,
    state({ from: "2024-01-01", to: "2024-12-31", sort: "date" }),
    { freshness: { any: ["2026-09-15"] } },
  );
  assert.deepEqual(calls[0].filters.day, { any: ["2024-01-01"] });
  assert.deepEqual(calls[0].filters.freshness, { any: ["2026-09-15"] });
  assert.deepEqual(calls[0].sort, { date: "desc" });
});
