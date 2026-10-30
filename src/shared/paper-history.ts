/** The mirror's per-paper git archive, independent of the viewer checkout. */
const REPOSITORY = "maxliesegang/karlsruhe-oparl-syndication";
const GITHUB = `https://github.com/${REPOSITORY}`;
export const HISTORY_PAGE_SIZE = 6;

export interface HistoryCommit {
  sha: string;
  date: string;
}

export interface HistoryChange {
  label: string;
  kind: "changed" | "added" | "removed";
  before: string;
  after: string;
  /** Set when the record changed in ways its displayed summary cannot show. */
  note?: string;
}

/** Display names resolved at build time, keyed by `historyEntityKey`. */
export type HistoryLabels = Record<string, string>;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function paperHistoryPath(paperId: string): string | undefined {
  // Same basename contract as the mirror's recordFileName; never accept a path.
  const id = paperId.split("/").filter(Boolean).at(-1);
  return id && /^\d+$/.test(id) ? `docs/papers/${id}.json` : undefined;
}

export function paperHistoryUrl(path: string): string {
  return `${GITHUB}/commits/main/${path}`;
}

export function paperHistoryCommitUrl(sha: string): string {
  return `${GITHUB}/commit/${sha}`;
}

function scalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

/** Normalize object keys and unordered arrays, ignoring bookkeeping timestamps. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !["created", "modified"].includes(key))
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function records(value: unknown): Map<string, RecordValue> {
  return new Map(
    (Array.isArray(value) ? value : [])
      .filter((item) => isRecord(item) && typeof item.id === "string")
      .map((item) => [item.id as string, item]),
  );
}

/** Body-relative OParl path ("meetings/1284"), short enough to embed per page. */
export function historyEntityKey(url: string): string {
  return /\/bodies\/[^/]+\/(.+?)\/?$/.exec(url)?.[1] ?? url;
}

const ENTITY_NOUNS: Record<string, string> = {
  meetings: "Sitzung",
  organizations: "Gremium",
  papers: "Vorlage",
};

/** Raw OParl URLs mean nothing to readers; fall back to "Sitzung 1284". */
function entityLabel(url: string, labels: HistoryLabels): string {
  const key = historyEntityKey(url);
  const noun = ENTITY_NOUNS[key.split("/")[0]];
  const id = key.split("/").at(-1);
  return labels[key] ?? (noun && id ? `${noun} ${id}` : url);
}

function changeKind(before: string, after: string): HistoryChange["kind"] {
  return !before ? "added" : !after ? "removed" : "changed";
}

/** Only compare saved source data: file metadata cannot prove a PDF text edit. */
export function diffPaperHistory(
  before: RecordValue,
  after: RecordValue,
  labels: HistoryLabels = {},
): HistoryChange[] {
  const changes: HistoryChange[] = [];
  for (const [key, label] of [
    ["name", "Titel"],
    ["reference", "Vorlagennummer"],
    ["paperType", "Vorlagenart"],
    ["date", "Vorlagendatum"],
    ["deleted", "Als gelöscht markiert"],
  ]) {
    const oldValue = scalar(before[key]);
    const newValue = scalar(after[key]);
    if (oldValue !== newValue) {
      changes.push({
        label,
        kind: changeKind(oldValue, newValue),
        before: oldValue,
        after: newValue,
      });
    }
  }
  // One row per added or removed entry instead of reprinting the whole list.
  for (const [key, label] of [
    ["underDirectionOf", "Federführung"],
    ["superordinatedPaper", "Übergeordnete Vorlage"],
    ["subordinatedPaper", "Zugehörige Vorlage"],
  ]) {
    const oldItems = new Set(strings(before[key]));
    const newItems = new Set(strings(after[key]));
    for (const item of oldItems) {
      if (!newItems.has(item)) {
        const text = entityLabel(item, labels);
        changes.push({ label, kind: "removed", before: text, after: "" });
      }
    }
    for (const item of newItems) {
      if (!oldItems.has(item)) {
        const text = entityLabel(item, labels);
        changes.push({ label, kind: "added", before: "", after: text });
      }
    }
  }
  for (const [key, label] of [
    ["auxiliaryFile", "Anlage"],
    ["mainFile", "Hauptdokument"],
    ["consultation", "Beratung"],
  ]) {
    const oldItems = records(
      key === "mainFile" && isRecord(before[key]) ? [before[key]] : before[key],
    );
    const newItems = records(
      key === "mainFile" && isRecord(after[key]) ? [after[key]] : after[key],
    );
    for (const id of new Set([...oldItems.keys(), ...newItems.keys()])) {
      const oldItem = oldItems.get(id);
      const newItem = newItems.get(id);
      if (
        JSON.stringify(canonical(oldItem)) ===
        JSON.stringify(canonical(newItem))
      )
        continue;
      const describe = (item: RecordValue | undefined) => {
        if (!item) return "";
        if (key === "consultation") {
          const place =
            typeof item.meeting === "string"
              ? entityLabel(item.meeting, labels)
              : strings(item.organization)
                  .map((organization) => entityLabel(organization, labels))
                  .join(", ");
          return [scalar(item.role), place].filter(Boolean).join(" · ") || id;
        }
        return scalar(item.name) || scalar(item.fileName) || id;
      };
      const oldText = describe(oldItem);
      const newText = describe(newItem);
      changes.push({
        label,
        kind: !oldItem ? "added" : !newItem ? "removed" : "changed",
        before: oldText,
        after: newText,
        // Other metadata (e.g. MIME type) can change without changing the label.
        ...(oldItem && newItem && oldText === newText
          ? { note: "Nur technische Angaben geändert." }
          : {}),
      });
    }
  }
  return changes;
}

async function request(url: string, fetcher: typeof fetch): Promise<Response> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(
      response.status === 403 || response.status === 429
        ? "GitHub begrenzt gerade die Abrufe. Bitte später erneut versuchen oder die Quellhistorie öffnen."
        : "Die Änderungshistorie konnte nicht geladen werden. Bitte erneut versuchen.",
    );
  }
  return response;
}

export async function fetchHistoryCommits(
  path: string,
  page: number,
  head?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ commits: HistoryCommit[]; hasMore: boolean }> {
  const url = new URL(`https://api.github.com/repos/${REPOSITORY}/commits`);
  url.search = new URLSearchParams({
    path,
    per_page: String(HISTORY_PAGE_SIZE),
    page: String(page),
    sha: head ?? "main",
  }).toString();
  const response = await request(url.href, fetcher);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Ungültige Quellhistorie.");
  const commits = payload.map((item): HistoryCommit => {
    if (
      !isRecord(item) ||
      typeof item.sha !== "string" ||
      !/^[a-f0-9]{40}$/.test(item.sha) ||
      !isRecord(item.commit) ||
      !isRecord(item.commit.committer) ||
      typeof item.commit.committer.date !== "string" ||
      !Number.isFinite(Date.parse(item.commit.committer.date))
    )
      throw new Error("Ungültiger Stand in der Quellhistorie.");
    return { sha: item.sha, date: item.commit.committer.date };
  });
  return {
    commits,
    hasMore: (response.headers.get("link") ?? "").includes('rel="next"'),
  };
}

export async function fetchHistorySnapshot(
  path: string,
  sha: string,
  paperId: string,
  fetcher: typeof fetch = fetch,
): Promise<RecordValue> {
  const response = await request(
    `https://raw.githubusercontent.com/${REPOSITORY}/${sha}/${path}`,
    fetcher,
  );
  const payload: unknown = await response.json();
  if (!isRecord(payload) || payload.id !== paperId) {
    throw new Error("Der archivierte Stand passt nicht zu dieser Vorlage.");
  }
  return payload;
}

export async function fetchHistoryText(
  path: string,
  sha: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  return (
    await request(
      `https://raw.githubusercontent.com/${REPOSITORY}/${sha}/${path}`,
      fetcher,
    )
  ).text();
}

export interface TextChange {
  kind: "same" | "removed" | "added";
  text: string;
}

/** Exact line diff for ordinary edits, with bounded work for replaced documents. */
export function diffDocumentText(before: string, after: string): TextChange[] {
  const oldLines = before.replaceAll("\r\n", "\n").split("\n");
  const newLines = after.replaceAll("\r\n", "\n").split("\n");
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  )
    start++;
  if (start === oldLines.length && start === newLines.length) return [];
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const oldMiddle = oldLines.slice(start, oldEnd);
  const newMiddle = newLines.slice(start, newEnd);
  const parts: { kind: TextChange["kind"]; lines: string[] }[] = [];
  function push(kind: TextChange["kind"], lines: string[]) {
    if (!lines.length) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.lines.push(...lines);
    else parts.push({ kind, lines });
  }
  push("same", oldLines.slice(Math.max(0, start - 2), start));
  const width = newMiddle.length + 1;
  // A huge rewrite should not freeze the reader's browser with quadratic work.
  if ((oldMiddle.length + 1) * width > 250000) {
    push("removed", oldMiddle);
    push("added", newMiddle);
  } else {
    const lengths = new Uint32Array((oldMiddle.length + 1) * width);
    for (let i = oldMiddle.length - 1; i >= 0; i--) {
      for (let j = newMiddle.length - 1; j >= 0; j--) {
        lengths[i * width + j] =
          oldMiddle[i] === newMiddle[j]
            ? 1 + lengths[(i + 1) * width + j + 1]
            : Math.max(
                lengths[(i + 1) * width + j],
                lengths[i * width + j + 1],
              );
      }
    }
    let i = 0;
    let j = 0;
    while (i < oldMiddle.length || j < newMiddle.length) {
      if (
        i < oldMiddle.length &&
        j < newMiddle.length &&
        oldMiddle[i] === newMiddle[j]
      ) {
        push("same", [oldMiddle[i++]]);
        j++;
      } else if (
        i < oldMiddle.length &&
        (j === newMiddle.length ||
          lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])
      ) {
        push("removed", [oldMiddle[i++]]);
      } else {
        push("added", [newMiddle[j++]]);
      }
    }
  }
  push("same", oldLines.slice(oldEnd, oldEnd + 2));
  return parts.map(({ kind, lines }) => ({ kind, text: lines.join("\n") }));
}
