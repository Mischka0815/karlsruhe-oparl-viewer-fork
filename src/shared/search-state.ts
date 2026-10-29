export const filterFields = [
  "district",
  "faction",
  "from",
  "to",
  "committee",
  "type",
] as const;
export type FilterField = (typeof filterFields)[number];
export type SearchSortMode = "relevance" | "date" | "modified";
export interface SearchState {
  q: string;
  district: string;
  faction: string;
  from: string;
  to: string;
  committee: string;
  type: string;
  sort: "" | SearchSortMode;
}
export function calendarDate(value: string | null | undefined): string {
  const raw = value ?? "";
  const day = raw.slice(0, 10);
  if (raw.length > 10 && !Number.isFinite(Date.parse(raw))) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === day
    ? day
    : "";
}
export function parseSearchState(params: URLSearchParams): SearchState {
  const state: SearchState = {
    q: (params.get("q") ?? "").trim().replace(/\s+/g, " "),
    district: "",
    faction: "",
    from: "",
    to: "",
    committee: "",
    type: "",
    sort: "",
  };
  for (const field of filterFields)
    state[field] = params.get(field)?.trim() ?? "";
  state.committee = committeeKey(state.committee);
  const year = params.get("year");
  if (year && /^\d{4}$/.test(year)) {
    state.from ||= `${year}-01-01`;
    state.to ||= `${year}-12-31`;
  }
  const sort = params.get("sort");
  if (sort === "date" || sort === "modified" || sort === "relevance")
    state.sort = sort;
  return state;
}
export function serializeSearchState(state: SearchState): string {
  const params = new URLSearchParams();
  for (const field of ["q", ...filterFields, "sort"] as const)
    if (state[field]) params.set(field, state[field]);
  return params.toString();
}
export function effectiveSort(state: SearchState): SearchSortMode {
  const sort = state.sort || (state.q ? "relevance" : "modified");
  return sort === "relevance" && !state.q ? "modified" : sort;
}
export function invalidDateRange(state: SearchState): boolean {
  return Boolean(
    (state.from && calendarDate(state.from) !== state.from) ||
    (state.to && calendarDate(state.to) !== state.to) ||
    (state.from && state.to && state.from > state.to),
  );
}
export function dateMatches(day: string, state: SearchState): boolean {
  if (!state.from && !state.to) return true;
  return (
    !invalidDateRange(state) &&
    Boolean(calendarDate(day)) &&
    (!state.from || day >= state.from) &&
    (!state.to || day <= state.to)
  );
}
/** Short stable committee key for URLs and filters (`gr-32130`); full OParl
 * organization IDs from older links collapse to the same key. */
export function committeeKey(id: string): string {
  return id.includes("/")
    ? id.split("/").filter(Boolean).slice(-2).join("-")
    : id;
}
/** Names used for active filters and saved-search labels alike. */
export const filterLabels = {
  district: "Stadtteil",
  faction: "Fraktion",
  committee: "Gremium",
  type: "Vorlagenart",
} as const;
function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return calendarDate(day) ? `${date}.${month}.${year}` : day;
}
/** One label for the paper-date range, whichever boundaries are set. */
export function dateRangeLabel(state: SearchState): string {
  const from = state.from ? formatDay(state.from) : "";
  const to = state.to ? formatDay(state.to) : "";
  if (from && to) return `Vorlagendatum: ${from}–${to}`;
  if (from) return `Vorlagendatum ab ${from}`;
  return to ? `Vorlagendatum bis ${to}` : "";
}
export function referenceKey(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replaceAll("/", "-");
}
export function searchLabel(
  state: SearchState,
  labels: Record<string, Record<string, string>> = {},
): string {
  return (
    [
      state.q,
      ...(["district", "faction"] as const).map((field) =>
        state[field]
          ? `${filterLabels[field]}: ${labels[field]?.[state[field]] ?? state[field]}`
          : "",
      ),
      dateRangeLabel(state),
      ...(["committee", "type"] as const).map((field) =>
        state[field]
          ? `${filterLabels[field]}: ${labels[field]?.[state[field]] ?? state[field]}`
          : "",
      ),
      state.sort
        ? `Sortierung: ${{ relevance: "Relevanz", date: "Neueste Vorlagen", modified: "Zuletzt geändert" }[state.sort]}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Alle Vorlagen"
  );
}
