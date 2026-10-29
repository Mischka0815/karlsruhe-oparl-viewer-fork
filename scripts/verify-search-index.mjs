/** Run after build:quiet. Exercises the production WASM index without a browser. */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseSearchState,
  calendarDate,
  committeeKey,
} from "../src/shared/search-state.ts";
import {
  searchPapers,
  getPagefindFreshnessStats,
} from "../src/shared/pagefind-client.ts";
import { comparePapersForList } from "../src/shared/paper-grouping.ts";
import { publicCommitteeIds } from "../src/shared/public-consultations.ts";
const root = process.cwd();
const docs = resolve(
  root,
  process.env.DATA_LOCAL_DIR ?? "syndication-data/docs",
);
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const shards = async (dir) =>
  Promise.all(
    (await readdir(resolve(docs, dir)))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => json(resolve(docs, dir, name))),
  );
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) =>
  String(url).startsWith("file:")
    ? new Response(await readFile(new URL(url)))
    : originalFetch(url, options);
const pf = await import(
  pathToFileURL(resolve(root, "dist/pagefind/pagefind.js"))
);
const base = pathToFileURL(resolve(root, "dist") + "/").href;
await pf.options({
  bundlePath: `${base}pagefind/`,
  baseUrl: "/karlsruhe-oparl-viewer/",
});
await pf.init("de");
const [rawPapers, rawMeetings, rawOrganizations, districts, submitters] =
  await Promise.all([
    shards("papers"),
    shards("meetings"),
    json(resolve(docs, "organizations.json")),
    json(resolve(docs, "paper-stadtteile.json")),
    json(resolve(docs, "paper-submitters.json")),
  ]);
const organizations = new Map(rawOrganizations.map((o) => [o.id, o]));
const meetings = new Map(
  rawMeetings.filter((m) => !m.deleted).map((m) => [m.id, m]),
);
const id = (url) => url.split("/").filter(Boolean).at(-1);
// Map preserves the first route winner, matching the detail route builder.
const unique = new Map();
for (const p of rawPapers.filter((p) => !p.deleted).sort(comparePapersForList))
  if (!unique.has(p.reference.replaceAll("/", "-")))
    unique.set(p.reference.replaceAll("/", "-"), p);
const canonical = [...unique.values()];
const state = (values) => parseSearchState(new URLSearchParams(values));
const all = await searchPapers(pf, state({}));
assert.equal(all.length, canonical.length);
const first = await Promise.all(all.slice(0, 20).map((r) => r.data()));
assert.deepEqual(
  first.map((d) => d.meta["paper-reference"]),
  canonical.slice(0, 20).map((p) => p.reference),
);
console.log(
  `Browse: ${all.length} canonical papers; first 20 match bulk-aware ordering.`,
);
const q = "Klimaschutz";
const topic = await searchPapers(pf, state({ q }));
const chosen = {
  district: "Durlach",
  faction: "gruene",
  from: "2000-01-01",
  to: "2026-12-31",
};
// A broad filter combination is also checked independently of text ranking.
const filterOnly = await searchPapers(pf, state(chosen));
const combined = await searchPapers(pf, state({ q, ...chosen }));
const expectedEligible = canonical.filter((p) => {
  const district = districts.papers[id(p.id)];
  const names = Array.isArray(district)
    ? district
    : [...(district?.primary ?? []), ...(district?.mentioned ?? [])];
  const day = calendarDate(p.date);
  return (
    names.includes(chosen.district) &&
    (submitters.papers[id(p.id)] ?? []).includes(chosen.faction) &&
    day >= chosen.from &&
    day <= chosen.to
  );
});
assert.equal(filterOnly.length, expectedEligible.length);

assert.ok(
  combined.length > 20,
  "Representative combination must exercise a later batch",
);
const eligible = new Set(filterOnly.map((r) => r.id));
assert.deepEqual(
  new Set(combined.map((r) => r.id)),
  new Set(topic.filter((r) => eligible.has(r.id)).map((r) => r.id)),
);
for (let offset = 0; offset < combined.length; offset += 20) {
  const batch = await Promise.all(
    combined.slice(offset, offset + 20).map((r) => r.data()),
  );
  for (const d of batch) {
    const day = calendarDate(d.meta["paper-date"]);
    assert.ok(day >= chosen.from && day <= chosen.to);
  }
}
console.log(
  `Combined text/district/faction/date: ${combined.length} matches; complete-set intersection and batches checked.`,
  chosen,
);
const reference = canonical.find((p) => p.reference.includes("/")).reference;
const exact = await searchPapers(pf, state({ q: reference }));
const alias = await searchPapers(
  pf,
  state({ q: reference.replaceAll("/", "-") }),
);
assert.deepEqual(
  exact.map((r) => r.id),
  alias.map((r) => r.id),
);
assert.equal(exact.length, 1);
assert.equal((await exact[0].data()).meta["paper-reference"], reference);
console.log(
  `Reference: ${reference} and route alias resolve to the same detail.`,
);
let nonLeading;
for (const p of canonical) {
  const committee = publicCommitteeIds(p, meetings, organizations).find(
    (org) => !p.underDirectionOf?.includes(org),
  );
  if (committee && (p.consultation?.length ?? 0) > 1) {
    nonLeading = { paper: p, committee };
    break;
  }
}
assert.ok(nonLeading);
const committeeResults = await searchPapers(
  pf,
  state({
    q: nonLeading.paper.reference,
    committee: committeeKey(nonLeading.committee),
  }),
);
assert.equal(committeeResults.length, 1);
console.log(
  `Non-leading public committee: ${organizations.get(nonLeading.committee).name}, ${nonLeading.paper.reference}.`,
);
const freshness = await getPagefindFreshnessStats(
  base,
  state(chosen),
  "2999-01-01T00:00:00Z",
);
assert.equal(freshness.total, filterOnly.length);
assert.equal(freshness.newCount + freshness.updatedCount, 0);
console.log(
  "Filter-only freshness: matching total, future checkpoint yields no new/updated records.",
);
// Pick a term present in PDF text but absent from that paper's deployed HTML.
let pdfCheck;
for (const p of canonical.slice(0, 150)) {
  const html = await readFile(
    resolve(root, "dist/vorlagen", p.reference.replaceAll("/", "-") + ".html"),
    "utf8",
  );
  for (const file of p.auxiliaryFile ?? []) {
    let text;
    try {
      text = await readFile(
        resolve(docs, "file-contents", id(file.id) + ".txt"),
        "utf8",
      );
    } catch {
      continue;
    }
    const term = [...text.matchAll(/[A-Za-zÄÖÜäöüß]{13,}/g)]
      .map((m) => m[0])
      .find((word) => !html.toLowerCase().includes(word.toLowerCase()));
    if (!term) continue;
    const hits = await searchPapers(pf, state({ q: term }));
    for (const hit of hits.slice(0, 100)) {
      const data = await hit.data();
      if (data.meta["paper-reference"] === p.reference) {
        pdfCheck = { term, reference: p.reference };
        break;
      }
    }
    if (pdfCheck) break;
  }
  if (pdfCheck) break;
}
assert.ok(
  pdfCheck,
  "Expected an extracted-PDF-only term to remain searchable after stripping",
);
console.log("PDF-only term survives production index-and-strip:", pdfCheck);
const cutoff = "2026-09-01T00:00:00Z";
const stats = await getPagefindFreshnessStats(base, state(chosen), cutoff);
const eligibleData = await Promise.all(filterOnly.map((r) => r.data()));
let expectedNew = 0,
  expectedUpdated = 0;
for (const data of eligibleData) {
  const created = Date.parse(data.meta["paper-created"]);
  const modified = data.meta["paper-modified"] ?? "";
  if (created > Date.parse(cutoff)) expectedNew++;
  else if (
    !modified.startsWith("2025-03-03") &&
    Date.parse(modified) > Date.parse(cutoff)
  )
    expectedUpdated++;
}
assert.equal(stats.newCount, expectedNew);
assert.equal(stats.updatedCount, expectedUpdated);
console.log(
  "Freshness matches exact creation/genuine modification timestamps:",
  stats,
);
const filters = await pf.filters();
console.log("Available indexed days:", Object.keys(filters.day).length);
