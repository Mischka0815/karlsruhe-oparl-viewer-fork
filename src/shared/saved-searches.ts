import {
  parseSearchState,
  serializeSearchState,
  type SearchState,
} from "./search-state.ts";
export const SAVED_SEARCHES_STORAGE_KEY = "gemeinderatsradar.saved-searches";
export const SAVED_SEARCHES_CHANGED_EVENT = "saved-searches-changed";
export const SAVED_SEARCH_QUERY_PARAM = "q";
export const SAVED_SEARCH_RESULTS_PATH = "";
export const MAX_SAVED_SEARCHES = 25;
export interface SavedSearch {
  query: string;
  state: SearchState;
  savedAt: string;
  lastViewedAt: string;
}
export function normalizeSavedSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}
type SearchInput = string | SearchState;
export function toSearchState(value: SearchInput): SearchState {
  return typeof value === "string"
    ? parseSearchState(new URLSearchParams({ q: value }))
    : parseSearchState(new URLSearchParams(serializeSearchState(value)));
}
function key(value: SearchInput): string {
  const state = toSearchState(value);
  state.q = state.q.toLocaleLowerCase("de-DE");
  return serializeSearchState(state);
}
export function isSameSavedSearchQuery(
  left: SearchInput,
  right: SearchInput,
): boolean {
  return key(left) === key(right);
}
function timestamp(value: unknown, fallback: string): string {
  const date = typeof value === "string" ? new Date(value) : new Date(NaN);
  return Number.isFinite(+date) ? date.toISOString() : fallback;
}
export function sanitizeSavedSearches(searches: unknown[]): SavedSearch[] {
  const seen = new Set<string>();
  return searches
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Partial<SavedSearch>;
      if (typeof candidate.query !== "string") return [];
      const state =
        candidate.state && typeof candidate.state === "object"
          ? toSearchState(candidate.state)
          : toSearchState(candidate.query);
      if (!serializeSearchState(state)) return [];
      const savedAt = timestamp(candidate.savedAt, new Date(0).toISOString());
      return [
        {
          query: state.q,
          state,
          savedAt,
          lastViewedAt: timestamp(candidate.lastViewedAt, savedAt),
        },
      ];
    })
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .filter((search) => {
      const id = key(search.state);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_SAVED_SEARCHES);
}
export function readSavedSearches(storage: Storage): SavedSearch[] {
  try {
    const parsed = JSON.parse(
      storage.getItem(SAVED_SEARCHES_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? sanitizeSavedSearches(parsed) : [];
  } catch {
    return [];
  }
}
export function writeSavedSearches(
  storage: Storage,
  searches: SavedSearch[],
): boolean {
  try {
    storage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify(sanitizeSavedSearches(searches)),
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SAVED_SEARCHES_CHANGED_EVENT));
    }
    return true;
  } catch {
    return false;
  }
}
export function upsertSavedSearch(
  searches: SavedSearch[],
  input: SearchInput,
  now = new Date(),
): SavedSearch[] {
  const state = toSearchState(input);
  if (!serializeSearchState(state)) return searches;
  const existing = searches.find((s) => isSameSavedSearchQuery(s.state, state));
  return sanitizeSavedSearches([
    {
      query: state.q,
      state,
      savedAt: existing?.savedAt ?? now.toISOString(),
      lastViewedAt: existing?.lastViewedAt ?? now.toISOString(),
    },
    ...searches.filter((s) => !isSameSavedSearchQuery(s.state, state)),
  ]);
}
export function markSavedSearchViewed(
  searches: SavedSearch[],
  input: SearchInput,
  now = new Date(),
): SavedSearch[] {
  return sanitizeSavedSearches(
    searches.map((s) =>
      isSameSavedSearchQuery(s.state, input)
        ? { ...s, lastViewedAt: now.toISOString() }
        : s,
    ),
  );
}
export function removeSavedSearch(
  searches: SavedSearch[],
  input: SearchInput,
): SavedSearch[] {
  return searches.filter((s) => !isSameSavedSearchQuery(s.state, input));
}
export function buildSavedSearchUrl(
  baseUrl: string,
  input: SearchInput,
): string {
  const params = serializeSearchState(toSearchState(input));
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}${params ? `?${params}` : ""}`;
}
export function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
