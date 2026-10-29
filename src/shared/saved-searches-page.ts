import {
  serializeSearchState,
  parseSearchState,
  searchLabel,
} from "./search-state";
import { getPagefindFreshnessStats } from "./pagefind-client";
import {
  buildSavedSearchUrl,
  getBrowserStorage,
  readSavedSearches,
  removeSavedSearch,
  type SavedSearch,
  writeSavedSearches,
} from "./saved-searches";

const ITEM_FADE_MS = 300;
const DEFAULT_SEARCH_CHECKPOINT = new Date(0).toISOString();

const BOOKMARK_SVG = `<svg class="empty-icon" width="48" height="48" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2z"/></svg>`;

const CLOSE_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>`;

interface SearchItem {
  element: HTMLLIElement;
  query: string;
  countBadge: HTMLSpanElement;
  freshnessBadge: HTMLSpanElement;
}

function createSearchItem(
  search: SavedSearch,
  baseUrl: string,
  labels: Record<string, Record<string, string>>,
): SearchItem {
  const item = document.createElement("li");
  item.className = "saved-search-item";

  const link = document.createElement("a");
  link.className = "saved-search-link";
  link.href = buildSavedSearchUrl(baseUrl, search.state);

  const queryLabel = document.createElement("span");
  queryLabel.className = "saved-search-query";
  queryLabel.textContent = searchLabel(search.state, labels);

  const countBadge = document.createElement("span");
  countBadge.className = "saved-search-count-badge";
  countBadge.dataset.state = "loading";
  countBadge.setAttribute("aria-live", "polite");
  countBadge.setAttribute("aria-label", "Treffer werden geladen");

  const freshnessBadge = document.createElement("span");
  freshnessBadge.className = "saved-search-freshness-badge";
  freshnessBadge.dataset.state = "loading";
  freshnessBadge.setAttribute("aria-live", "polite");
  freshnessBadge.setAttribute("aria-label", "Neue Treffer werden ermittelt");

  link.append(queryLabel, freshnessBadge, countBadge);

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "saved-search-remove-button";
  removeButton.innerHTML = CLOSE_SVG;
  removeButton.dataset.removeSavedSearch = "true";
  removeButton.dataset.query = serializeSearchState(search.state);
  removeButton.setAttribute(
    "aria-label",
    `Suche "${searchLabel(search.state, labels)}" entfernen`,
  );

  item.append(link, removeButton);

  return {
    element: item,
    query: serializeSearchState(search.state),
    countBadge,
    freshnessBadge,
  };
}

function setUnavailableBadge(badge: HTMLSpanElement, label: string): void {
  badge.textContent = "–";
  badge.dataset.state = "error";
  badge.setAttribute("aria-label", label);
}

async function loadResultCounts(
  items: SearchItem[],
  baseUrl: string,
  searches: SavedSearch[],
): Promise<void> {
  const searchesByQuery = new Map(
    searches.map((search) => [serializeSearchState(search.state), search]),
  );
  const results = await Promise.allSettled(
    items.map(({ query }) => {
      const search = searchesByQuery.get(query);
      return getPagefindFreshnessStats(
        baseUrl,
        parseSearchState(new URLSearchParams(query)),
        search?.lastViewedAt ?? search?.savedAt ?? DEFAULT_SEARCH_CHECKPOINT,
      );
    }),
  );

  for (const [i, result] of results.entries()) {
    const item = items[i];
    if (!item) continue;

    const { countBadge: badge, freshnessBadge } = item;

    if (result.status === "fulfilled") {
      const { total: count, newCount, updatedCount } = result.value;
      badge.textContent = count === 1 ? "1 Treffer" : `${count} Treffer`;
      badge.dataset.state = "ok";
      badge.setAttribute("aria-label", `${count} Treffer`);
      const freshnessParts = [
        newCount > 0 ? `${newCount} neu` : "",
        updatedCount > 0 ? `${updatedCount} aktualisiert` : "",
      ].filter(Boolean);
      freshnessBadge.textContent =
        freshnessParts.length > 0 ? freshnessParts.join(" · ") : "Nichts Neues";
      freshnessBadge.dataset.state = freshnessParts.length > 0 ? "fresh" : "ok";
      freshnessBadge.setAttribute(
        "aria-label",
        freshnessParts.length > 0
          ? freshnessParts.join(", ")
          : "Keine neuen oder aktualisierten Treffer",
      );
    } else {
      setUnavailableBadge(badge, "Treffer nicht verfügbar");
      setUnavailableBadge(freshnessBadge, "Neuigkeiten nicht verfügbar");
    }
  }
}

function getSummaryText(searchCount: number): string {
  const noun = searchCount === 1 ? "Suchanfrage" : "Suchanfragen";
  return `${new Intl.NumberFormat("de-DE").format(searchCount)} gespeicherte ${noun}`;
}

function setEmptyContent(
  container: HTMLElement,
  options: { text: string; linkText?: string; linkHref?: string },
): void {
  container.replaceChildren();

  container.insertAdjacentHTML("beforeend", BOOKMARK_SVG);

  const textEl = document.createElement("p");
  textEl.className = "empty-text";

  if (options.linkHref && options.linkText) {
    textEl.textContent = options.text + " ";
    const link = document.createElement("a");
    link.href = options.linkHref;
    link.textContent = options.linkText;
    textEl.append(link);
  } else {
    textEl.textContent = options.text;
  }

  container.append(textEl);
}

function fadeOutElement(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    element.style.opacity = "0";
    setTimeout(() => {
      element.remove();
      resolve();
    }, ITEM_FADE_MS);
  });
}

export function initSavedSearchesPage(): void {
  const root = document.querySelector<HTMLElement>(
    "[data-saved-searches-root]",
  );
  if (!root) return;

  const labels = JSON.parse(root.dataset.searchLabels ?? "{}");
  const baseUrl = root.dataset.baseUrl ?? "/";
  const pagefindEnabled = root.dataset.pagefindEnabled === "true";

  const listEl = root.querySelector<HTMLUListElement>(
    "[data-saved-searches-list]",
  );
  const emptyEl = root.querySelector<HTMLElement>(
    "[data-saved-searches-empty]",
  );
  const toolbarEl = root.querySelector<HTMLElement>(
    "[data-saved-searches-toolbar]",
  );
  const summaryEl = root.querySelector<HTMLElement>(
    "[data-saved-searches-summary]",
  );
  const clearButton = root.querySelector<HTMLButtonElement>(
    "[data-clear-saved-searches-button]",
  );
  if (!listEl || !emptyEl || !toolbarEl || !summaryEl || !clearButton) {
    return;
  }

  const updateSummary = (searchCount: number): void => {
    summaryEl.textContent = getSummaryText(searchCount);
    clearButton.disabled = searchCount === 0;
  };

  const showEmptyState = (
    message: "default" | "cleared" | "unavailable" = "default",
  ): void => {
    if (message === "cleared") {
      setEmptyContent(emptyEl, {
        text: "Alle gespeicherten Suchen wurden gelöscht.",
        linkText: "Zur Suche",
        linkHref: baseUrl,
      });
    } else if (message === "unavailable") {
      setEmptyContent(emptyEl, {
        text: "Gespeicherte Suchen sind hier nicht verfügbar.",
      });
    } else {
      setEmptyContent(emptyEl, {
        text: "Noch keine Suche gespeichert.",
        linkText: "Zur Suche",
        linkHref: baseUrl,
      });
    }

    emptyEl.hidden = false;
    listEl.hidden = true;
    listEl.replaceChildren();
    toolbarEl.hidden = true;
    updateSummary(0);
  };

  const showListState = (): void => {
    emptyEl.hidden = true;
    toolbarEl.hidden = false;
    listEl.hidden = false;
  };

  const storage = getBrowserStorage();
  if (!storage) {
    showEmptyState("unavailable");
    return;
  }

  let searches = readSavedSearches(storage);

  const renderSearches = (): void => {
    if (searches.length === 0) {
      showEmptyState();
      return;
    }

    const items = searches.map((search) =>
      createSearchItem(search, baseUrl, labels),
    );
    listEl.replaceChildren(...items.map((item) => item.element));

    showListState();
    updateSummary(searches.length);

    if (!pagefindEnabled) {
      for (const { countBadge, freshnessBadge } of items) {
        setUnavailableBadge(countBadge, "Treffer nicht verfügbar");
        setUnavailableBadge(freshnessBadge, "Neuigkeiten nicht verfügbar");
      }
      return;
    }

    void loadResultCounts(items, baseUrl, searches);
  };

  listEl.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const removeButton = target?.closest<HTMLButtonElement>(
      "[data-remove-saved-search]",
    );
    if (!removeButton) return;

    const query = removeButton.dataset.query ?? "";
    const nextSearches = removeSavedSearch(
      searches,
      parseSearchState(new URLSearchParams(query)),
    );
    if (nextSearches.length === searches.length) return;

    const saved = writeSavedSearches(storage, nextSearches);
    if (!saved) return;

    searches = nextSearches;

    const itemEl = removeButton.closest<HTMLElement>(".saved-search-item");
    if (itemEl) {
      void fadeOutElement(itemEl).then(() => {
        if (searches.length === 0) {
          showEmptyState();
        } else {
          updateSummary(searches.length);
        }
      });
    } else {
      renderSearches();
    }
  });

  clearButton.addEventListener("click", () => {
    if (searches.length === 0) return;

    const confirmed = window.confirm(
      "Sollen wirklich alle gespeicherten Suchen gelöscht werden?",
    );
    if (!confirmed) return;

    const cleared = writeSavedSearches(storage, []);
    if (!cleared) return;

    searches = [];
    showEmptyState("cleared");
  });

  if (searches.length === 0) {
    showEmptyState();
    return;
  }

  renderSearches();
}
