import assert from "node:assert/strict";
import test from "node:test";
import {
  diffDocumentText,
  diffPaperHistory,
  fetchHistoryCommits,
  fetchHistorySnapshot,
  fetchHistoryText,
  historyEntityKey,
  paperHistoryPath,
} from "../src/shared/paper-history.ts";

const paperId = "https://example.org/papers/vo/55055";
const path = "docs/papers/55055.json";
const sha = "a".repeat(40);

test("history follows the mirror record id rather than the route slug", () => {
  assert.equal(paperHistoryPath(paperId), path);
  assert.equal(paperHistoryPath("https://example.org/papers/ag/55055/"), path);
  assert.equal(
    paperHistoryPath("https://example.org/papers/../x.json"),
    undefined,
  );
  assert.equal(paperHistoryPath(""), undefined);
});

test("metadata comparison shows values, additions and removals", () => {
  const changes = diffPaperHistory(
    {
      name: "Alter Titel",
      auxiliaryFile: [{ id: "files/1", name: "Anlage alt" }],
      consultation: [{ id: "consultations/1", role: "Vorberatung" }],
    },
    {
      name: "Neuer Titel",
      deleted: true,
      auxiliaryFile: [{ id: "files/2", name: "Anlage neu" }],
      consultation: [{ id: "consultations/1", role: "Entscheidung" }],
    },
  );
  assert.deepEqual(
    changes.find(({ label }) => label === "Titel"),
    {
      label: "Titel",
      kind: "changed",
      before: "Alter Titel",
      after: "Neuer Titel",
    },
  );
  assert.deepEqual(
    changes
      .filter(({ label }) => label === "Anlage")
      .map(({ kind, before, after }) => [kind, before || after]),
    [
      ["removed", "Anlage alt"],
      ["added", "Anlage neu"],
    ],
  );
  assert.equal(
    changes.find(({ label }) => label === "Beratung").after,
    "Entscheidung",
  );
  assert.equal(
    changes.find(({ label }) => label === "Als gelöscht markiert").after,
    "Ja",
  );
});

test("reordering fields, attachments and organizations is not a source change", () => {
  assert.deepEqual(
    diffPaperHistory(
      {
        modified: "old",
        underDirectionOf: ["b", "a"],
        auxiliaryFile: [
          { id: "files/1", name: "Vorlage", modified: "old" },
          { id: "files/2", name: "Anlage" },
        ],
        consultation: [
          { id: "consultations/1", organization: ["a", "b"], modified: "old" },
        ],
      },
      {
        modified: "new",
        underDirectionOf: ["a", "b"],
        auxiliaryFile: [
          { name: "Anlage", id: "files/2" },
          { name: "Vorlage", id: "files/1", modified: "new" },
        ],
        consultation: [
          { modified: "new", organization: ["b", "a"], id: "consultations/1" },
        ],
      },
    ),
    [],
  );
  assert.deepEqual(diffPaperHistory({ auxiliaryFile: null }, {}), []);
});

test("file metadata changes do not claim that document text was changed", () => {
  const changes = diffPaperHistory(
    { auxiliaryFile: [{ id: "files/1", name: "Vorlage", mimeType: "old" }] },
    {
      auxiliaryFile: [
        { id: "files/1", name: "Vorlage", mimeType: "application/pdf" },
      ],
    },
  );
  assert.equal(changes[0].kind, "changed");
  assert.equal(changes[0].after, "Vorlage");
  assert.match(changes[0].note, /technische Angaben/);
});

test("references read as names, or as labelled ids when unresolved", () => {
  const body = "https://example.org/oparl/bodies/0001";
  const changes = diffPaperHistory(
    {
      underDirectionOf: [`${body}/organizations/at/1`],
      consultation: [
        {
          id: `${body}/consultations/1`,
          role: "Vorberatung",
          meeting: `${body}/meetings/1284`,
        },
      ],
    },
    {
      underDirectionOf: [`${body}/organizations/at/2`],
      consultation: [
        {
          id: `${body}/consultations/1`,
          role: "Vorberatung",
          meeting: `${body}/meetings/1300`,
        },
      ],
    },
    { "meetings/1300": "Gemeinderat am 12.03.2024" },
  );
  assert.deepEqual(
    changes.map(({ label, kind, before, after }) => [
      label,
      kind,
      before,
      after,
    ]),
    [
      ["Federführung", "removed", "Gremium 1", ""],
      ["Federführung", "added", "", "Gremium 2"],
      [
        "Beratung",
        "changed",
        "Vorberatung · Sitzung 1284",
        "Vorberatung · Gemeinderat am 12.03.2024",
      ],
    ],
  );
  assert.equal(historyEntityKey(`${body}/meetings/1284`), "meetings/1284");
});

test("text comparisons preserve changes with context and normalize CRLF", () => {
  assert.deepEqual(diffDocumentText("a\r\nb", "a\nb"), []);
  assert.deepEqual(
    diffDocumentText(
      "Anfang\nAlter Beschluss\nEnde",
      "Anfang\nNeuer Beschluss\nEnde",
    ),
    [
      { kind: "same", text: "Anfang" },
      { kind: "removed", text: "Alter Beschluss" },
      { kind: "added", text: "Neuer Beschluss" },
      { kind: "same", text: "Ende" },
    ],
  );
  assert.deepEqual(
    diffDocumentText("a\nb", "a\nzusätzlich\nb").filter(
      ({ kind }) => kind !== "same",
    ),
    [{ kind: "added", text: "zusätzlich" }],
  );
  assert.deepEqual(
    diffDocumentText("a\nentfernt\nb", "a\nb").filter(
      ({ kind }) => kind !== "same",
    ),
    [{ kind: "removed", text: "entfernt" }],
  );
});

test("text comparisons handle repeated lines, whitespace and large replacements", () => {
  assert.deepEqual(
    diffDocumentText(
      "a\nwiederholt\nb\nwiederholt\nc",
      "a\nwiederholt\nx\nwiederholt\nc",
    ).filter(({ kind }) => kind !== "same"),
    [
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
    ],
  );
  assert.equal(diffDocumentText("a b", "a  b").length, 2);
  const oldText = Array.from({ length: 2000 }, (_, i) => `alt ${i}`).join("\n");
  const newText = Array.from({ length: 2000 }, (_, i) => `neu ${i}`).join("\n");
  assert.deepEqual(diffDocumentText(oldText, newText), [
    { kind: "removed", text: oldText },
    { kind: "added", text: newText },
  ]);
});

test("paginated history is pinned to a revision and detects older pages", async () => {
  const result = await fetchHistoryCommits(path, 2, sha, async (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get("sha"), sha);
    assert.equal(params.get("path"), path);
    assert.equal(params.get("page"), "2");
    return Response.json(
      [{ sha, commit: { committer: { date: "2026-10-29T07:57:42Z" } } }],
      { headers: { link: '<https://api.github.com/next>; rel="next"' } },
    );
  });
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.commits, [{ sha, date: "2026-10-29T07:57:42Z" }]);
});

test("invalid or rate-limited responses never become an empty history", async () => {
  await assert.rejects(
    fetchHistoryCommits(path, 1, undefined, async () =>
      Response.json({ message: "error" }),
    ),
    /Ungültige/,
  );
  await assert.rejects(
    fetchHistoryCommits(
      path,
      1,
      undefined,
      async () => new Response("", { status: 429 }),
    ),
    /GitHub begrenzt/,
  );
  await assert.rejects(
    fetchHistoryCommits(path, 1, undefined, async () =>
      Response.json([{ sha: "<script>", commit: {} }]),
    ),
    /Ungültiger Stand/,
  );
});

test("snapshots must belong to the full OParl id, including its namespace", async () => {
  await assert.rejects(
    fetchHistorySnapshot(path, sha, paperId, async () =>
      Response.json({ id: paperId.replace("/vo/", "/ag/") }),
    ),
    /passt nicht/,
  );
  assert.deepEqual(
    await fetchHistorySnapshot(path, sha, paperId, async () =>
      Response.json({ id: paperId, name: "Vorlage" }),
    ),
    { id: paperId, name: "Vorlage" },
  );
});

test("document snapshots use the independent text archive", async () => {
  assert.equal(
    await fetchHistoryText(
      "docs/file-contents/681621.txt",
      sha,
      async (url) => {
        assert.equal(
          url,
          `https://raw.githubusercontent.com/maxliesegang/karlsruhe-oparl-syndication/${sha}/docs/file-contents/681621.txt`,
        );
        return new Response("Archivierter Text");
      },
    ),
    "Archivierter Text",
  );
});
