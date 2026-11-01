import { hasPagefindUpdates, loadPagefindModule } from "./pagefind-client";
import {
  getBrowserStorage,
  readSavedSearches,
  SAVED_SEARCHES_CHANGED_EVENT,
  SAVED_SEARCHES_STORAGE_KEY,
} from "./saved-searches";

export function initSavedSearchUpdates(): void {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  if (header?.dataset.pagefindEnabled !== "true") return;
  const storage = getBrowserStorage();
  if (!storage) return;

  const indicators = document.querySelectorAll<HTMLElement>(
    "[data-saved-updates]",
  );
  const description = document.getElementById("saved-search-updates");
  let previousSearches = "";
  let generation = 0;

  const showUpdates = (visible: boolean): void => {
    for (const indicator of indicators) indicator.hidden = !visible;
    if (description) {
      description.textContent = visible
        ? "Neue oder aktualisierte Treffer in gespeicherten Suchen"
        : "";
    }
  };

  const refresh = async (): Promise<void> => {
    const searches = readSavedSearches(storage);
    const signature = JSON.stringify(searches);
    if (signature === previousSearches) return;
    previousSearches = signature;
    const current = ++generation;
    showUpdates(false);
    if (!searches.length) return;

    try {
      const pagefind = await loadPagefindModule(header.dataset.baseUrl ?? "/");
      for (const search of searches) {
        if (current !== generation) return;
        try {
          const hasUpdates = await hasPagefindUpdates(
            pagefind,
            search.state,
            search.lastViewedAt,
          );
          if (current !== generation) return;
          if (hasUpdates) {
            showUpdates(true);
            return;
          }
        } catch {
          // One unavailable query must not hide updates in the other searches.
          previousSearches = "";
        }
      }
    } catch {
      // A later visit or storage update can retry an unavailable index.
      if (current === generation) previousSearches = "";
    }
  };

  window.addEventListener(SAVED_SEARCHES_CHANGED_EVENT, () => void refresh());
  window.addEventListener("storage", (event) => {
    if (event.key === SAVED_SEARCHES_STORAGE_KEY || event.key === null) {
      void refresh();
    }
  });
  window.addEventListener("pageshow", () => void refresh());
  void refresh();
}
