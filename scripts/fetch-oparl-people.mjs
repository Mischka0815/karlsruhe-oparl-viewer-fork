/**
 * Fetches people and memberships straight from the Karlsruhe OParl API into
 * the local data checkout, until the mirror publishes them itself. Output is
 * what the mirror is meant to publish (see docs/konzept-ausbau.md, Phase 1):
 *
 * - `people.json`: public people only, without `email`, `phone`,
 *   `locationObject`/`location` and the embedded membership list.
 * - `memberships.json`: only memberships whose person is public (the API
 *   answers 401 for the others, so they never appear in the people list).
 *
 * Usage: node scripts/fetch-oparl-people.mjs  (honours DATA_LOCAL_DIR)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BODY = "https://web2.karlsruhe.de/ris/oparl/bodies/0001";
const PAGE_SIZE = 100;
/** Keep the public API comfortable; ~50 pages in total. */
const DELAY_MS = 300;

const PERSON_FIELDS = [
  "id",
  "type",
  "body",
  "name",
  "familyName",
  "givenName",
  "formOfAddress",
  "title",
  "affix",
  "created",
  "modified",
  "deleted",
];

const dataRoot = resolve(
  process.cwd(),
  process.env.DATA_LOCAL_DIR ?? "syndication-data/docs",
);

async function fetchList(path) {
  const items = [];
  let url = `${BODY}/${path}?limit=${PAGE_SIZE}`;
  while (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }
    const page = await response.json();
    items.push(...page.data);
    url = page.links?.next;
    if (url) await new Promise((done) => setTimeout(done, DELAY_MS));
  }
  return items;
}

function pick(record, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => field in record)
      .map((field) => [field, record[field]]),
  );
}

const people = (await fetchList("people")).map((person) =>
  pick(person, PERSON_FIELDS),
);
const publicIds = new Set(people.map((person) => person.id));
const allMemberships = await fetchList("memberships");
const memberships = allMemberships.filter((membership) =>
  publicIds.has(membership.person),
);

await mkdir(dataRoot, { recursive: true });
await writeFile(resolve(dataRoot, "people.json"), JSON.stringify(people));
await writeFile(
  resolve(dataRoot, "memberships.json"),
  JSON.stringify(memberships),
);

console.log(
  `people.json: ${people.length} · memberships.json: ${memberships.length} ` +
    `(${allMemberships.length - memberships.length} of non-public people left out) → ${dataRoot}`,
);
