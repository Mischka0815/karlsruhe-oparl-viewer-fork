import {
  dateMatches,
  effectiveSort,
  invalidDateRange,
  referenceKey,
  type SearchState,
} from "./search-state.ts";
import { rankResultsByPaperDate } from "./search-ranking.ts";
import { BULK_MODIFIED_DATE } from "./constants.ts";
import { getDateTimestamp } from "./utils.ts";

export interface PagefindResultData {
  url?: string;
  excerpt?: string;
  content?: string;
  anchors?: { id?: string; location?: number }[];
  meta?: Record<string, string | undefined>;
  word_count?: number;
}

export interface PagefindSearchResult {
  id?: string;
  /** Pagefind's relevance score (`balanced_score`), descending in `results`. */
  score?: number;
  data?: () => Promise<PagefindResultData>;
}

export interface PagefindSearchOptions {
  sort?: Record<string, "asc" | "desc">;
  filters?: Record<string, string | { any: string[] }>;
}

interface PagefindSearchResponse {
  results?: PagefindSearchResult[];
}

export interface PagefindFreshnessStats {
  total: number;
  newCount: number;
  updatedCount: number;
}

export interface PagefindModule {
  search: (
    term: string | null,
    options?: PagefindSearchOptions,
  ) => Promise<PagefindSearchResponse>;
  filters: () => Promise<Record<string, Record<string, number>>>;
  options?: (options: Record<string, unknown>) => Promise<void>;
}

const pagefindModulePromises = new Map<string, Promise<PagefindModule>>();

function getPagefindBundlePath(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}pagefind/`;
}

export async function loadPagefindModule(
  baseUrl: string,
): Promise<PagefindModule> {
  const bundlePath = getPagefindBundlePath(baseUrl);
  let modulePromise = pagefindModulePromises.get(bundlePath);

  if (!modulePromise) {
    const moduleUrl = `${bundlePath}pagefind.js`;
    modulePromise = import(/* @vite-ignore */ moduleUrl).then(
      (module) => module as PagefindModule,
      (error) => {
        // Forget the failure so a retry can load the bundle again.
        pagefindModulePromises.delete(bundlePath);
        throw error;
      },
    );
    pagefindModulePromises.set(bundlePath, modulePromise);
  }

  return modulePromise;
}

export async function searchPapers(
  pagefind: PagefindModule,
  state: SearchState,
  extraFilters: NonNullable<PagefindSearchOptions["filters"]> = {},
): Promise<PagefindSearchResult[]> {
  if (invalidDateRange(state)) throw new Error("Ungültiger Datumsbereich");
  const available = await pagefind.filters();
  const filters: NonNullable<PagefindSearchOptions["filters"]> = {
    ...extraFilters,
  };
  for (const field of ["district", "faction", "committee", "type"] as const) {
    if (state[field]) filters[field] = state[field];
  }
  if (state.from || state.to) {
    const days = Object.keys(available.day ?? {}).filter((day) =>
      dateMatches(day, state),
    );
    if (!days.length) return [];
    filters.day = { any: days };
  }
  const reference = referenceKey(state.q);
  const exactReference = Boolean(state.q && available.reference?.[reference]);
  if (exactReference) filters.reference = reference;
  const term = exactReference ? null : state.q || null;
  const sort = effectiveSort(state);
  const response = await pagefind.search(term, {
    filters,
    ...(sort === "date"
      ? { sort: { date: "desc" as const } }
      : sort === "modified"
        ? { sort: { changed: "asc" as const } }
        : {}),
  });
  const results = response.results ?? [];
  if (sort !== "relevance" || results.length < 2 || exactReference)
    return results;
  const byDate = await pagefind.search(term, {
    filters,
    sort: { date: "desc" },
  });
  return rankResultsByPaperDate(results, byDate.results ?? []);
}

export async function getPagefindFreshnessStats(
  baseUrl: string,
  state: SearchState,
  since: string,
): Promise<PagefindFreshnessStats> {
  const pagefind = await loadPagefindModule(baseUrl);
  const matches = await searchPapers(pagefind, state);
  let newCount = 0,
    updatedCount = 0;
  for await (const change of recentPaperChanges(pagefind, state, since)) {
    if (change === "new") newCount++;
    else updatedCount++;
  }
  return { total: matches.length, newCount, updatedCount };
}

export async function hasPagefindUpdates(
  pagefind: PagefindModule,
  state: SearchState,
  since: string,
): Promise<boolean> {
  for await (const _change of recentPaperChanges(pagefind, state, since)) {
    return true;
  }
  return false;
}

async function* recentPaperChanges(
  pagefind: PagefindModule,
  state: SearchState,
  since: string,
): AsyncGenerator<"new" | "updated"> {
  const available = await pagefind.filters();
  const days = Object.keys(available.freshness ?? {}).filter(
    (day) => day >= since.slice(0, 10),
  );
  const recent = days.length
    ? await searchPapers(
        pagefind,
        { ...state, sort: "modified" },
        { freshness: { any: days } },
      )
    : [];
  const cutoff = getDateTimestamp(since) ?? 0;
  // Only potentially changed fragments are loaded; the navigation stops at
  // the first confirmed change rather than counting every matching paper.
  for (let offset = 0; offset < recent.length; offset += 20) {
    const entries = await Promise.all(
      recent.slice(offset, offset + 20).map((result) => result.data?.()),
    );
    for (const data of entries) {
      const created = getDateTimestamp(data?.meta?.["paper-created"]);
      const rawModified = data?.meta?.["paper-modified"] ?? "";
      const modified = rawModified.startsWith(BULK_MODIFIED_DATE)
        ? undefined
        : getDateTimestamp(rawModified);
      if (created !== undefined && created > cutoff) yield "new";
      else if (modified !== undefined && modified > cutoff) yield "updated";
    }
  }
}
