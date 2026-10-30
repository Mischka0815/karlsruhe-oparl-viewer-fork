import { mapConcurrent } from "./async-utils";
import { initDocumentHistory } from "./paper-document-history-loader";
import {
  diffPaperHistory,
  fetchHistoryCommits,
  fetchHistorySnapshot,
  paperHistoryCommitUrl,
  paperHistoryPath,
  type HistoryChange,
  type HistoryCommit,
  type HistoryLabels,
} from "./paper-history";

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

const KIND_TAGS: Partial<Record<HistoryChange["kind"], string>> = {
  added: "hinzugefügt",
  removed: "entfernt",
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function formatDate(commit: HistoryCommit): string {
  return `${DATE_FORMAT.format(new Date(commit.date))} Uhr`;
}

function commitTime(commit: HistoryCommit): HTMLTimeElement {
  const time = element("time", "history-date", formatDate(commit));
  time.dateTime = commit.date;
  return time;
}

function sourceLink(commit: HistoryCommit, text = "Quelle"): HTMLAnchorElement {
  const link = element("a", "history-source", text);
  link.href = paperHistoryCommitUrl(commit.sha);
  link.title = `Archivierter Stand vom ${formatDate(commit)} auf GitHub`;
  return link;
}

/** `del`/`ins` carry the meaning; the hidden prefixes make it audible. */
function value(tag: "del" | "ins", text: string): HTMLElement {
  const node = element(tag);
  node.append(
    element(
      "span",
      "visually-hidden",
      tag === "del" ? "Vorher: " : "Nachher: ",
    ),
    text,
  );
  return node;
}

function changeRow(change: HistoryChange): HTMLLIElement {
  const row = element("li", "history-change");
  row.dataset.kind = change.kind;
  const label = element("span", "history-label", change.label);
  const tag = KIND_TAGS[change.kind];
  if (tag) label.append(" ", element("span", "history-tag", tag));
  const values = element("div", "history-values");
  if (change.note) {
    values.append(element("span", "", change.after));
    values.append(element("span", "history-change-note", change.note));
  } else {
    if (change.before) values.append(value("del", change.before));
    if (change.after) values.append(value("ins", change.after));
  }
  row.append(label, values);
  return row;
}

function entry(kind: string, marker = true): HTMLLIElement {
  const item = element("li", "history-entry");
  item.dataset.kind = kind;
  if (marker) {
    const dot = element("span", "history-marker");
    dot.setAttribute("aria-hidden", "true");
    item.append(dot);
  }
  return item;
}

function readLabels(details: HTMLElement): HistoryLabels {
  try {
    const labels: unknown = JSON.parse(details.dataset.historyLabels ?? "{}");
    return labels && typeof labels === "object"
      ? (labels as HistoryLabels)
      : {};
  } catch {
    return {};
  }
}

function init(details: HTMLDetailsElement): void {
  const paperId = details.dataset.paperHistory;
  const path = paperId && paperHistoryPath(paperId);
  const status = details.querySelector<HTMLElement>("[data-history-status]");
  const list = details.querySelector<HTMLOListElement>("[data-history-list]");
  const more = details.querySelector<HTMLButtonElement>("[data-history-more]");
  const documents = details.querySelector<HTMLElement>(
    "[data-history-documents]",
  );
  if (!paperId || !path || !status || !list || !more || !documents) return;
  const labels = readLabels(details);

  const fileIds = new Set<string>();
  function addDocument(fileId: string, name: string, current: boolean): void {
    if (!/^\d+$/.test(fileId) || fileIds.has(fileId)) return;
    fileIds.add(fileId);
    const documentHistory = element("details", "history-document");
    const summary = element("summary");
    summary.append(element("span", "history-document-name", name));
    const meta = element("span", "history-document-meta", `Datei ${fileId}`);
    if (!current)
      meta.append(" · ", element("span", "history-tag", "frühere Anlage"));
    summary.append(meta);
    documentHistory.append(summary);
    initDocumentHistory(documentHistory, fileId);
    documents!.append(documentHistory);
  }
  for (const file of documents.querySelectorAll<HTMLElement>(
    "[data-history-file]",
  )) {
    addDocument(
      file.dataset.historyFile ?? "",
      file.textContent ?? "Dokument",
      true,
    );
    file.remove();
  }

  let commits: HistoryCommit[] = [];
  const snapshots = new Map<string, Record<string, unknown>>();
  let page = 1;
  let hasMore = true;
  let loading = false;
  let loaded = false;

  function render(combined: HistoryCommit[], olderPending: boolean) {
    const entries: HTMLLIElement[] = [];
    // Consecutive revisions without a visible change collapse into one row.
    let quiet: HistoryCommit[] = [];
    function flushQuiet(): void {
      if (!quiet.length) return;
      const item = entry("quiet");
      const body = element("div", "history-entry-body");
      body.append(
        element(
          "p",
          "history-quiet",
          quiet.length === 1
            ? "Technisch aktualisiert, ohne sichtbare Änderung"
            : `${quiet.length}× technisch aktualisiert, ohne sichtbare Änderung`,
        ),
      );
      const dates = element("p", "history-quiet-dates");
      quiet.forEach((commit, index) => {
        if (index) dates.append(" · ");
        dates.append(sourceLink(commit, formatDate(commit)));
      });
      body.append(dates);
      item.append(body);
      entries.push(item);
      quiet = [];
    }

    combined.forEach((commit, index) => {
      const after = snapshots.get(commit.sha)!;
      const previous = combined[index + 1];
      const changes = previous
        ? diffPaperHistory(snapshots.get(previous.sha)!, after, labels)
        : [];
      if (previous && !changes.length) {
        quiet.push(commit);
        return;
      }
      flushQuiet();
      const item = entry(previous ? "changes" : "origin");
      const body = element("div", "history-entry-body");
      const head = element("div", "history-entry-head");
      head.append(commitTime(commit));
      if (changes.length) {
        head.append(
          element(
            "span",
            "history-count",
            changes.length === 1
              ? "1 Änderung"
              : `${changes.length} Änderungen`,
          ),
        );
      }
      head.append(sourceLink(commit));
      body.append(head);
      if (changes.length) {
        const rows = element("ul", "history-changes");
        rows.append(...changes.map(changeRow));
        body.append(rows);
      } else {
        body.append(
          element(
            "p",
            "history-origin",
            olderPending
              ? "Ältere Stände laden, um diesen Stand zu vergleichen."
              : "Ältester archivierter Stand. Er belegt nicht die erstmalige Veröffentlichung.",
          ),
        );
        const title = String(after.name ?? after.reference ?? "");
        if (title) body.append(element("p", "history-origin-title", title));
      }
      item.append(body);
      entries.push(item);
    });
    flushQuiet();
    list!.replaceChildren(...entries);
  }

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    more!.hidden = true;
    status!.textContent = "Archivierte Stände werden geladen …";
    list!.setAttribute("aria-busy", "true");
    status!.classList.remove("visually-hidden");
    try {
      const batch = await fetchHistoryCommits(path!, page, commits[0]?.sha);
      // Keep pagination pinned to the first commit even if the mirror updates.
      const combined = [...commits, ...batch.commits];
      await mapConcurrent(
        combined.filter(({ sha }) => !snapshots.has(sha)),
        3,
        async ({ sha }) => {
          const snapshot = await fetchHistorySnapshot(path!, sha, paperId!);
          snapshots.set(sha, snapshot);
        },
      );
      render(combined, batch.hasMore);
      for (const snapshot of snapshots.values()) {
        const files = [
          ...(Array.isArray(snapshot.auxiliaryFile)
            ? snapshot.auxiliaryFile
            : []),
          snapshot.mainFile,
        ];
        for (const file of files) {
          if (file && typeof file === "object" && typeof file.id === "string") {
            addDocument(
              file.id.split("/").at(-1) ?? "",
              String(file.name ?? file.fileName ?? "Dokument"),
              false,
            );
          }
        }
      }
      commits = combined;
      hasMore = batch.hasMore;
      page++;
      loaded = true;
      status!.textContent = commits.length
        ? `${commits.length} archivierte Stände geladen.`
        : "Für diese Vorlage sind keine archivierten Stände verfügbar.";
      // The list speaks for itself; the count only matters to screen readers.
      status!.classList.toggle("visually-hidden", commits.length > 0);
      more!.textContent = "Ältere Stände laden";
      more!.hidden = !hasMore;
    } catch (error) {
      status!.textContent =
        error instanceof Error
          ? error.message
          : "Die Änderungshistorie konnte nicht geladen werden.";
      more!.textContent = "Erneut versuchen";
      more!.hidden = false;
    } finally {
      loading = false;
      list!.removeAttribute("aria-busy");
    }
  }

  details.addEventListener("toggle", () => {
    if (details.open && !loaded) void load();
  });
  more.addEventListener("click", () => {
    if (hasMore) void load();
  });
  if (details.open) void load();
}

export function initPaperHistoryLoader(root: ParentNode = document): void {
  for (const details of root.querySelectorAll<HTMLDetailsElement>(
    "[data-paper-history]",
  )) {
    init(details);
  }
}
