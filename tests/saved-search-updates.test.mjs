import test from "node:test";
import assert from "node:assert/strict";
import { hasPagefindUpdates } from "../src/shared/pagefind-client.ts";
import { parseSearchState } from "../src/shared/search-state.ts";

const state = parseSearchState(new URLSearchParams({ district: "Durlach" }));
const checkpoint = "2026-10-01T12:00:00.000Z";

function indexFor(metadata, freshness = { "2026-10-01": 1 }) {
  const calls = [];
  let loaded = 0;
  return {
    calls,
    get loaded() {
      return loaded;
    },
    filters: async () => ({ freshness }),
    search: async (term, options) => {
      calls.push({ term, options });
      return {
        results: metadata.map((meta) => ({
          data: async () => {
            loaded++;
            return { meta };
          },
        })),
      };
    },
  };
}

test("navigation detects same-day new and updated matches with saved filters", async () => {
  for (const field of ["paper-created", "paper-modified"]) {
    const index = indexFor([{ [field]: "2026-10-01T12:00:01Z" }]);
    assert.equal(await hasPagefindUpdates(index, state, checkpoint), true);
    assert.deepEqual(index.calls[0].options.filters, {
      district: "Durlach",
      freshness: { any: ["2026-10-01"] },
    });
  }
});

test("viewed matches, missing dates and the bulk import do not light the indicator", async () => {
  const index = indexFor(
    [
      { "paper-created": checkpoint, "paper-modified": checkpoint },
      {},
      { "paper-modified": "2025-03-03T18:00:00Z" },
    ],
    { "2024-01-01": 1, "2025-03-03": 1, "2026-10-01": 1 },
  );
  assert.equal(await hasPagefindUpdates(index, state, checkpoint), false);
  assert.equal(
    await hasPagefindUpdates(
      indexFor(
        [
          {
            "paper-created": "2024-01-01",
            "paper-modified": "2025-03-03T18:00:00Z",
          },
        ],
        { "2025-03-03": 1 },
      ),
      state,
      "2025-03-03T00:00:00Z",
    ),
    false,
  );
});

test("no candidate days avoids a search and any result downloads", async () => {
  const index = indexFor([], { "2026-09-30": 1 });
  assert.equal(await hasPagefindUpdates(index, state, checkpoint), false);
  assert.equal(index.calls.length, 0);
  assert.equal(index.loaded, 0);
});

test("the indicator stops after the first changed batch without relevance reranking", async () => {
  const index = indexFor(
    Array.from({ length: 45 }, () => ({
      "paper-created": "2026-10-01T13:00:00Z",
    })),
  );
  const query = parseSearchState(new URLSearchParams({ q: "Klima" }));
  assert.equal(await hasPagefindUpdates(index, query, checkpoint), true);
  assert.equal(index.calls.length, 1);
  assert.equal(index.loaded, 20);
});

test("freshness checks continue past an already-viewed first batch", async () => {
  const index = indexFor([
    ...Array.from({ length: 20 }, () => ({ "paper-created": checkpoint })),
    { "paper-modified": "2026-10-01T13:00:00Z" },
  ]);
  assert.equal(await hasPagefindUpdates(index, state, checkpoint), true);
  assert.equal(index.loaded, 21);
});
