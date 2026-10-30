import { mapConcurrent } from "./async-utils";
import {
  diffDocumentText,
  fetchHistoryCommits,
  fetchHistoryText,
  paperHistoryCommitUrl,
  paperHistoryUrl,
  type HistoryCommit,
  type TextChange,
} from "./paper-history";

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});
/** Unchanged lines kept on each side of a change. */
const CONTEXT_LINES = 3;
/** Rendered characters per comparison; GitHub has the full diff. */
const RENDER_BUDGET = 20000;

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

function lineCount(changes: TextChange[], kind: TextChange["kind"]): number {
  return changes
    .filter((change) => change.kind === kind)
    .reduce((sum, change) => sum + change.text.split("\n").length, 0);
}

function gap(count: number): HTMLElement {
  return element(
    "div",
    "diff-gap",
    count === 1 ? "1 unveränderte Zeile" : `${count} unveränderte Zeilen`,
  );
}

/** One row per line: `del`/`ins` for changes, with a sign gutter. */
function comparison(changes: TextChange[]): {
  node: HTMLElement;
  truncated: boolean;
} {
  const node = element("div", "history-text-diff");
  let remaining = RENDER_BUDGET;
  let truncated = false;
  changes.forEach((change, index) => {
    if (truncated) return;
    let lines = change.text.split("\n");
    let skipped = 0;
    if (change.kind === "same") {
      // Keep only context next to changes; the outer spans are already short.
      const keepBefore = index > 0 ? CONTEXT_LINES : 0;
      const keepAfter = index < changes.length - 1 ? CONTEXT_LINES : 0;
      if (lines.length > keepBefore + keepAfter + 1) {
        skipped = lines.length - keepBefore - keepAfter;
        const head = lines.slice(0, keepBefore);
        const tail = keepAfter ? lines.slice(-keepAfter) : [];
        appendLines("same", head);
        node.append(gap(skipped));
        lines = tail;
      }
    }
    appendLines(change.kind, lines);
  });
  return { node, truncated };

  function appendLines(kind: TextChange["kind"], lines: string[]): void {
    for (const line of lines) {
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const row = element(
        kind === "added" ? "ins" : kind === "removed" ? "del" : "div",
        "diff-line",
      );
      row.dataset.change = kind;
      const sign = element(
        "span",
        "diff-sign",
        kind === "added" ? "+" : kind === "removed" ? "−" : "",
      );
      sign.setAttribute("aria-hidden", "true");
      const shown = line.slice(0, remaining);
      truncated ||= shown.length < line.length;
      remaining -= Math.max(1, shown.length);
      row.append(sign);
      if (kind !== "same") {
        row.append(
          element(
            "span",
            "visually-hidden",
            kind === "added" ? "Hinzugefügt: " : "Entfernt: ",
          ),
        );
      }
      // A blank row still needs height in the grid.
      row.append(element("span", "diff-text", shown || " "));
      node.append(row);
    }
  }
}

/** Each PDF's extracted text has its own git history, independent of the paper. */
export function initDocumentHistory(
  details: HTMLDetailsElement,
  fileId: string,
): void {
  if (!/^\d+$/.test(fileId)) return;
  const path = `docs/file-contents/${fileId}.txt`;
  const body = element("div", "history-document-body");
  const status = element(
    "p",
    "history-status",
    "Textstände werden beim Öffnen geladen.",
  );
  status.setAttribute("role", "status");
  const list = element("ol", "history-revisions");
  const actions = element("div", "history-actions");
  const more = element("button", "history-more");
  more.type = "button";
  more.hidden = true;
  const source = element("a", "history-source", "Textarchiv auf GitHub");
  source.href = paperHistoryUrl(path);
  actions.append(more, source);
  body.append(status, list, actions);
  details.append(body);
  let commits: HistoryCommit[] = [];
  const texts = new Map<string, string>();
  let page = 1;
  let loading = false;
  let loaded = false;

  async function load(): Promise<void> {
    if (loading) return;
    loading = true;
    more.hidden = true;
    status.classList.remove("visually-hidden");
    status.textContent = "Textstände werden geladen …";
    list.setAttribute("aria-busy", "true");
    try {
      const batch = await fetchHistoryCommits(path, page, commits[0]?.sha);
      const combined = [...commits, ...batch.commits];
      await mapConcurrent(
        combined.filter(({ sha }) => !texts.has(sha)),
        3,
        async ({ sha }) => {
          texts.set(sha, await fetchHistoryText(path, sha));
        },
      );
      const entries = combined.map((commit, index) => {
        const item = element("li", "history-revision");
        const head = element("div", "history-entry-head");
        const time = element(
          "time",
          "history-date",
          `${DATE_FORMAT.format(new Date(commit.date))} Uhr`,
        );
        time.dateTime = commit.date;
        head.append(time);
        const previous = combined[index + 1];
        const changes = previous
          ? diffDocumentText(texts.get(previous.sha)!, texts.get(commit.sha)!)
          : [];
        if (changes.length) {
          const added = lineCount(changes, "added");
          const removed = lineCount(changes, "removed");
          const stats = element("span", "history-count");
          stats.append(
            element("span", "diff-stat-added", `+${added}`),
            " ",
            element("span", "diff-stat-removed", `−${removed}`),
            " Zeilen",
          );
          head.append(stats);
        }
        const source = element("a", "history-source", "Quelle");
        source.href = paperHistoryCommitUrl(commit.sha);
        head.append(source);
        item.append(head);
        if (!previous) {
          item.append(
            element(
              "p",
              "history-origin",
              batch.hasMore
                ? "Ältere Textstände laden, um diesen Stand zu vergleichen."
                : "Ältester archivierter Textstand.",
            ),
          );
          return item;
        }
        if (!changes.length) {
          item.dataset.kind = "quiet";
          item.append(element("p", "history-quiet", "Text unverändert."));
          return item;
        }
        const { node, truncated } = comparison(changes);
        item.append(node);
        if (truncated)
          item.append(
            element(
              "p",
              "history-origin",
              "Vergleich gekürzt. Der vollständige Unterschied steht unter „Quelle“.",
            ),
          );
        return item;
      });
      list.replaceChildren(...entries);
      commits = combined;
      page++;
      loaded = true;
      status.textContent = commits.length
        ? `${commits.length} Textstände geladen.`
        : "Für dieses Dokument ist kein extrahierter Text archiviert.";
      status.classList.toggle("visually-hidden", commits.length > 0);
      more.textContent = "Ältere Textstände laden";
      more.hidden = !batch.hasMore;
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Textstände konnten nicht geladen werden.";
      more.textContent = "Erneut versuchen";
      more.hidden = false;
    } finally {
      loading = false;
      list.removeAttribute("aria-busy");
    }
  }
  details.addEventListener("toggle", () => {
    if (details.open && !loaded) void load();
  });
  more.addEventListener("click", () => {
    void load();
  });
}
