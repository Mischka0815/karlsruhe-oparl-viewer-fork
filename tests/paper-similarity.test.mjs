import test from "node:test";
import assert from "node:assert/strict";
import { selectSimilarPapers } from "../src/shared/paper-similarity.ts";

function paper(recordId, reference = `2026/${recordId}`) {
  return {
    id: `https://example.org/oparl/papers/${recordId}`,
    routeReference: reference.replaceAll("/", "-"),
    reference,
  };
}

function inventory(...papers) {
  return new Map(papers.map((entry) => [entry.id.split("/").at(-1), entry]));
}

test("optional recommendations leave no placeholder", () => {
  assert.deepEqual(selectSimilarPapers(paper("1"), undefined, new Map()), []);
});

test("recommendations preserve the entire upstream ranking and use record ids", () => {
  const candidates = [paper("2"), paper("3"), paper("4"), paper("5")];
  assert.deepEqual(
    selectSimilarPapers(
      paper("1"),
      ["4", "2", "3", "5"],
      inventory(...candidates),
    ),
    [candidates[2], candidates[0], candidates[1], candidates[3]],
  );
});

test("recommendation counts follow the upstream list without a viewer limit", () => {
  for (const count of [0, 1, 3, 5, 20]) {
    const candidates = Array.from({ length: count }, (_, i) =>
      paper(String(i + 2)),
    );
    assert.deepEqual(
      selectSimilarPapers(
        paper("1"),
        candidates.map((candidate) => candidate.id.split("/").at(-1)),
        inventory(...candidates),
      ),
      candidates,
    );
  }
});

test("missing, deleted, self and procedural links cannot become recommendations", () => {
  const current = paper("1");
  const parent = paper("2");
  const child = paper("3");
  const deleted = { ...paper("4"), deleted: true };
  const similar = paper("5");
  current.superordinatedPaper = [parent.id];
  current.subordinatedPaper = [child.id];

  assert.deepEqual(
    selectSimilarPapers(
      current,
      ["missing", "1", "2", "3", "4", "5"],
      inventory(current, parent, child, deleted, similar),
    ),
    [similar],
  );
});

test("duplicate ids and colliding references produce one link per destination", () => {
  const current = paper("1");
  const selfAlias = paper("2", current.reference);
  const first = paper("3");
  const alias = paper("4", first.reference);
  const second = paper("5");
  assert.deepEqual(
    selectSimilarPapers(
      current,
      ["2", "3", "3", "4", "5"],
      inventory(current, selfAlias, first, alias, second),
    ),
    [first, second],
  );
});

test("recommendations remain directed rather than inventing reciprocal links", () => {
  const current = paper("1");
  const target = paper("2");
  const papers = inventory(current, target);
  const index = { 1: ["2"] };
  assert.deepEqual(selectSimilarPapers(current, index["1"], papers), [target]);
  assert.deepEqual(selectSimilarPapers(target, index["2"], papers), []);
});
