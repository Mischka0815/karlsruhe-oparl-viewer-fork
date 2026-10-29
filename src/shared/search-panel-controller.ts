import {
  loadPagefindModule,
  searchPapers,
  type PagefindSearchResult,
  type PagefindResultData,
} from "./pagefind-client";
import {
  effectiveSort,
  dateRangeLabel,
  filterLabels,
  referenceKey,
  filterFields,
  invalidDateRange,
  parseSearchState,
  serializeSearchState,
  type FilterField,
  type SearchState,
} from "./search-state";
import {
  getBrowserStorage,
  readSavedSearches,
  writeSavedSearches,
  upsertSavedSearch,
  markSavedSearchViewed,
  isSameSavedSearchQuery,
} from "./saved-searches";
import { BULK_MODIFIED_DATE } from "./constants";
import {
  excerptBodyStart,
  compactDistricts,
  contextNames,
  startsMidSentence,
  followUpBase,
  excerptLeadStart,
  summaryFromContent,
  leadOffice,
} from "./search-presentation";
import { formatDateShort } from "./utils";
export type { SearchSortMode } from "./search-state";
export const SEARCH_RESULT_BATCH_SIZE = 20;
function element(tag: string, className: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
/** Remove the first `count` characters of text, keeping the markup intact. */
function dropLeadingText(el: HTMLElement, count: number): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while (count > 0 && (node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    node.textContent = node.textContent!.slice(Math.min(count, length));
    count -= length;
  }
}
/** Pagefind's highlighted excerpt when a body match remains, otherwise the AI
 * summary; one muted line either way, so cards stay uniform. */
function cardText(
  data: PagefindResultData,
  state: SearchState,
): HTMLElement | undefined {
  const meta = data.meta ?? {};
  if (
    state.q &&
    data.excerpt &&
    referenceKey(state.q) !== referenceKey(meta["paper-reference"] ?? "")
  ) {
    const excerpt = element("span", "search-result-excerpt", "");
    // Pagefind supplies escaped document text with mark tags. Remove only a
    // leading repeated title / interface labels; retain actual body matches.
    excerpt.innerHTML = data.excerpt;
    dropLeadingText(
      excerpt,
      excerptBodyStart(excerpt.textContent ?? "", meta.title ?? ""),
    );
    const mark = [...excerpt.querySelectorAll("mark")].find((m) =>
      m.textContent?.trim(),
    );
    if (mark) {
      // The excerpt is clamped to two lines; start shortly before the first
      // highlight so it is not cut off on narrow screens.
      const range = document.createRange();
      range.setStart(excerpt, 0);
      range.setEndBefore(mark);
      const text = excerpt.textContent ?? "";
      dropLeadingText(excerpt, excerptLeadStart(text, range.toString().length));
      if (startsMidSentence(excerpt.textContent ?? "")) excerpt.prepend("… ");
      return excerpt;
    }
  }
  const summary = summaryFromContent(data.content ?? "", data.anchors ?? []);
  if (!summary) return undefined;
  const text = element("span", "search-result-excerpt", "");
  text.title = "KI-generierte Zusammenfassung – kann Fehler enthalten";
  // "KI" stays visible; the hidden rest completes "KI-Zusammenfassung:".
  const badge = element("span", "search-result-ai", "KI");
  badge.append(element("span", "visually-hidden", "-Zusammenfassung: "));
  text.append(badge, summary);
  return text;
}
function card(data: PagefindResultData, state: SearchState): HTMLElement {
  const meta = data.meta ?? {};
  const li = element("li", "search-result", "");
  const link = document.createElement("a");
  link.className = "search-result-link";
  link.href = data.url ?? "#";
  link.append(
    element("span", "search-result-title", meta.title ?? "Ohne Titel"),
  );
  const modified = meta["paper-modified"] ?? "";
  const date =
    effectiveSort(state) === "modified" &&
    !modified.startsWith(BULK_MODIFIED_DATE)
      ? `Geändert am ${formatDateShort(modified)}`
      : `Vorlage vom ${formatDateShort(meta["paper-date"]) || "unbekannten Datum"}`;
  const reference = meta["paper-reference"] ?? "";
  const base = followUpBase(reference);
  const identifiers = element("span", "search-result-identifiers", "");
  if (reference)
    identifiers.append(
      element("span", "search-result-reference", reference),
      " · ",
    );
  identifiers.append(
    [base ? "Folgevorlage" : "", date].filter(Boolean).join(" · "),
  );
  if (base) identifiers.title = `Folgevorlage zu ${base}`;
  link.append(identifiers);
  const text = cardText(data, state);
  if (text) link.append(text);
  const districts = meta["paper-districts"]?.trim() ?? "";
  const faction = contextNames(meta["paper-submitters"] ?? "").join(", ");
  const office = faction
    ? ""
    : leadOffice(meta["paper-organizations"] ?? "", meta["paper-type"] ?? "");
  const origin = faction || office;
  if (districts || origin) {
    // Who the paper comes from is the one fixed point to scan for, so it gets
    // the card's only pill; districts stay plain text beside it.
    const context = element(
      "span",
      "search-result-context",
      districts ? compactDistricts(districts) : "",
    );
    if (origin) context.append(element("span", "search-result-origin", origin));
    context.title = [
      districts ? `Stadtteile (Zuordnungen und Erwähnungen): ${districts}` : "",
      faction ? `Eingereicht von: ${faction}` : "",
      office ? `Federführend: ${office}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    context.setAttribute("aria-label", context.title);
    link.append(context);
  }
  li.append(link);
  return li;
}
export function initSearchPanel(): void {
  const root = document.querySelector<HTMLElement>("[data-search-panel]");
  if (!root) return;
  const input = root.querySelector<HTMLInputElement>("[data-search-input]")!;
  const status = root.querySelector<HTMLElement>("[data-search-status]")!;
  const announcer = root.querySelector<HTMLElement>("[data-search-announce]")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-retry]")!;
  const list = root.querySelector<HTMLElement>("[data-search-results]")!;
  const active = root.querySelector<HTMLElement>("[data-active-filters]")!;
  const progress = root.querySelector<HTMLElement>("[data-search-progress]")!;
  const more = root.querySelector<HTMLButtonElement>(
    "[data-search-load-trigger]",
  )!;
  const save = root.querySelector<HTMLButtonElement>("[data-save-search]")!;
  const savedLink = root.querySelector<HTMLAnchorElement>("[data-saved-link]")!;
  const sort = root.querySelector<HTMLSelectElement>("[data-sort]")!;
  const toggle = root.querySelector<HTMLButtonElement>("[data-filter-toggle]")!;
  const panel = root.querySelector<HTMLElement>("[data-filter-panel]")!;
  const dateError = root.querySelector<HTMLElement>("[data-date-error]")!;
  const scope = JSON.parse(root.dataset.scope ?? "{}") as Partial<SearchState>;
  const storage = getBrowserStorage();
  const control = (field: string) =>
    root.querySelector<HTMLInputElement | HTMLSelectElement>(
      `#search-${field}`,
    )!;
  let state = parseSearchState(new URLSearchParams(location.search));
  let results: PagefindSearchResult[] = [],
    rendered = 0,
    token = 0,
    loading = false,
    successful = false,
    // Typing pushes one history entry, then refines it in place, so Back
    // leaves the search instead of replaying every pause.
    typing = false,
    countText = "",
    chipKey = "",
    retryAction: () => void = () => {};
  let timer: ReturnType<typeof setTimeout>,
    dateTimer: ReturnType<typeof setTimeout>,
    announceTimer: ReturnType<typeof setTimeout>;
  let pagefind = loadPagefindModule(root.dataset.baseUrl ?? "/");
  // Attach immediately: missing bundles must not produce unhandled rejections.
  void pagefind.catch(() => {});
  /** The visible status updates at once; screen readers hear only the result
   * that is still current once typing settles. */
  function announce(text: string, delay = 900) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      announcer.textContent = "";
      requestAnimationFrame(() => (announcer.textContent = text));
    }, delay);
  }
  const userSet = (field: FilterField) =>
    Boolean(state[field]) && !scope[field];
  function optionLabel(
    field: "district" | "faction" | "committee" | "type",
  ): string {
    const select = control(field) as HTMLSelectElement;
    return select.selectedOptions[0]?.textContent ?? state[field];
  }
  function chip(text: string, clear: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.append(text, element("span", "chip-remove", "×"));
    button.setAttribute("aria-label", `${text} entfernen`);
    button.onclick = () => {
      const index = [...active.querySelectorAll("button")].indexOf(button);
      clear();
      typing = false;
      sync();
      // Keep keyboard users in the chip row: next chip, else previous one.
      const buttons = active.querySelectorAll("button");
      (buttons[index] ?? buttons[index - 1] ?? toggle).focus();
      void run("push");
    };
    return button;
  }
  function renderChips() {
    const chips: HTMLElement[] = [];
    for (const field of ["district", "faction"] as const) {
      if (!state[field]) continue;
      const label = optionLabel(field);
      if (scope[field]) {
        const span = element("span", "search-scope", `Nur ${label}`);
        span.title = `Diese Seite zeigt nur Vorlagen ${field === "district" ? "dieses Stadtteils" : "dieser Fraktion"}.`;
        chips.push(span);
      } else
        chips.push(
          chip(`${filterLabels[field]}: ${label}`, () => (state[field] = "")),
        );
    }
    const dates = dateRangeLabel(state);
    if (dates)
      chips.push(
        chip(dates, () => {
          state.from = "";
          state.to = "";
        }),
      );
    for (const field of ["committee", "type"] as const)
      if (state[field])
        chips.push(
          chip(`${filterLabels[field]}: ${optionLabel(field)}`, () => {
            state[field] = "";
          }),
        );
    // Rebuild only when the chips change, so focus inside the row survives.
    const key = chips.map((c) => c.textContent).join("|");
    if (key === chipKey) return;
    chipKey = key;
    active.replaceChildren(...chips);
  }
  function syncSave() {
    const saveable =
      Boolean(storage) &&
      (Boolean(state.q) || filterFields.some((field) => state[field]));
    const saved =
      saveable &&
      readSavedSearches(storage!).some((search) =>
        isSameSavedSearchQuery(search.state, state),
      );
    save.hidden = !saveable || saved;
    save.disabled = !successful;
    savedLink.hidden = !saved;
  }
  function sync(updateInput = false) {
    Object.assign(state, scope);
    if (updateInput) input.value = state.q;
    // The select shows the order in effect. An explicit choice stays in the
    // state (and URL) until reset, so relevance returns once text is typed.
    sort.value = effectiveSort(state);
    sort.querySelector<HTMLOptionElement>('[value="relevance"]')!.disabled =
      !state.q;
    root.querySelector<HTMLButtonElement>("[data-search-clear]")!.hidden =
      !state.q;
    for (const field of filterFields) {
      const el = control(field);
      if (
        el instanceof HTMLSelectElement &&
        state[field] &&
        !scope[field] &&
        !Array.from(el.options).some((option) => option.value === state[field])
      )
        state[field] = "";
      el.value = state[field];
      // The page itself fixes this field; there is nothing to choose.
      if (scope[field]) el.closest<HTMLElement>(".filter-group")!.hidden = true;
    }
    // The page scope is not a filter the visitor set.
    const count = [
      userSet("district"),
      userSet("faction"),
      state.from || state.to,
      userSet("committee"),
      userSet("type"),
    ].filter(Boolean).length;
    const counter = root.querySelector<HTMLElement>("[data-filter-count]")!;
    counter.textContent = String(count);
    counter.hidden = !count;
    toggle.setAttribute(
      "aria-label",
      count ? `Filter, ${count} aktiv` : "Filter",
    );
    const invalid = invalidDateRange(state);
    for (const field of ["from", "to"] as const)
      control(field).setAttribute("aria-invalid", String(invalid));
    dateError.hidden = !invalid;
    renderChips();
    root.querySelector<HTMLElement>("[data-reset-row]")!.hidden =
      !state.sort && !filterFields.some(userSet);
    syncSave();
  }
  function showError(text: string, action: () => void) {
    status.textContent = text;
    announce(text, 0);
    retryAction = action;
    retry.hidden = false;
  }
  async function batch(replace = false) {
    if (loading) return;
    loading = true;
    const current = token,
      snapshot = { ...state };
    more.disabled = true;
    try {
      const entries = await Promise.all(
        results
          .slice(rendered, rendered + SEARCH_RESULT_BATCH_SIZE)
          .map((r) => r.data!()),
      );
      if (current !== token) return;
      rendered += entries.length;
      const cards = entries.map((data) => card(data, snapshot));
      if (replace) list.replaceChildren(...cards);
      else list.append(...cards);
      more.hidden = progress.hidden = rendered >= results.length;
      progress.textContent = `${rendered.toLocaleString("de-DE")} von ${results.length.toLocaleString("de-DE")} angezeigt`;
    } finally {
      loading = false;
      more.disabled = false;
    }
  }
  function clearResults() {
    list.replaceChildren();
    results = [];
    rendered = 0;
    more.hidden = progress.hidden = true;
  }
  async function run(mode: "push" | "replace" = "replace") {
    const current = ++token;
    successful = false;
    retry.hidden = true;
    sync();
    // Scope comes from the page path, so the URL does not repeat it.
    const visible = { ...state };
    for (const field of Object.keys(scope) as (keyof SearchState)[])
      visible[field] = "";
    const query = serializeSearchState(visible);
    const url = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
    if (url !== `${location.pathname}${location.search}${location.hash}`)
      history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
    if (invalidDateRange(state)) {
      clearResults();
      const text =
        "Bitte einen gültigen Zeitraum angeben: Von muss vor oder am Bis-Datum liegen.";
      status.textContent = text;
      announce(text, 0);
      root.setAttribute("aria-busy", "false");
      return;
    }
    // Earlier results stay (dimmed) until the new ones replace them.
    if (!list.childElementCount)
      status.textContent = "Vorlagen werden geladen …";
    root.setAttribute("aria-busy", "true");
    try {
      const module = await pagefind;
      const found = await searchPapers(module, { ...state });
      if (current !== token) return;
      results = found;
      rendered = 0;
      loading = false;
      await batch(true);
      if (current !== token) return;
      countText = `${results.length.toLocaleString("de-DE")} ${state.q ? "Treffer" : "Vorlagen"}${results.length ? "" : " – versuchen Sie andere Begriffe oder weniger Filter."}`;
      status.textContent = countText;
      announce(countText);
      successful = true;
      if (storage)
        writeSavedSearches(
          storage,
          markSavedSearchViewed(readSavedSearches(storage), state),
        );
      syncSave();
    } catch (error) {
      if (current !== token) return;
      console.warn("Search failed", error);
      clearResults();
      showError("Die Suche ist momentan nicht verfügbar.", () => {
        pagefind = loadPagefindModule(root.dataset.baseUrl ?? "/");
        void pagefind.catch(() => {});
        void run();
      });
    } finally {
      if (current === token) root.setAttribute("aria-busy", "false");
    }
  }
  function loadMore() {
    retry.hidden = true;
    void batch().catch(() =>
      showError(
        `${countText} · Weitere Treffer konnten nicht geladen werden.`,
        loadMore,
      ),
    );
  }
  input.addEventListener("input", () => {
    ++token;
    state.q = input.value.trim().replace(/\s+/g, " ");
    successful = false;
    save.disabled = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void run(typing ? "replace" : "push");
      typing = true;
    }, 180);
  });
  input.addEventListener("blur", () => (typing = false));
  root.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    void run(typing ? "replace" : "push");
    typing = false;
  });
  for (const field of filterFields) {
    const el = control(field);
    const apply = () => {
      clearTimeout(dateTimer);
      typing = false;
      if (state[field] === el.value) return;
      state[field] = el.value;
      void run("push");
    };
    if (field !== "from" && field !== "to") {
      el.addEventListener("change", apply);
      continue;
    }
    // Typing a year emits 0002, 0020, 0202 before 2024: wait for a full year
    // and a short pause, or for the field to lose focus.
    el.addEventListener("change", () => {
      clearTimeout(dateTimer);
      if (el.value && Number(el.value.slice(0, 4)) < 1000) return;
      dateTimer = setTimeout(apply, 500);
    });
    el.addEventListener("blur", apply);
  }
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
  });
  sort.addEventListener("change", () => {
    typing = false;
    state.sort = sort.value as SearchState["sort"];
    void run("push");
  });
  root.querySelector("[data-reset]")!.addEventListener("click", () => {
    const q = state.q;
    typing = false;
    state = parseSearchState(new URLSearchParams());
    state.q = q;
    void run("push");
    // The reset row hides once nothing is left to reset; keep focus nearby.
    toggle.focus();
  });
  root.querySelector("[data-search-clear]")!.addEventListener("click", () => {
    typing = false;
    clearTimeout(timer);
    state.q = "";
    input.value = "";
    input.focus();
    void run("push");
  });
  retry.addEventListener("click", () => retryAction());
  more.addEventListener("click", loadMore);
  save.addEventListener("click", () => {
    if (!storage || !successful) return;
    if (
      writeSavedSearches(
        storage,
        upsertSavedSearch(readSavedSearches(storage), state),
      )
    ) {
      syncSave();
      // The button gives way to the "Gespeichert" link; keep focus there.
      savedLink.focus();
      announce("Suche gespeichert.", 0);
    } else {
      status.textContent = `${countText} · Speichern fehlgeschlagen`;
      announce("Suche konnte nicht gespeichert werden.", 0);
    }
  });
  window.addEventListener("popstate", () => {
    clearTimeout(timer);
    clearTimeout(dateTimer);
    typing = false;
    state = parseSearchState(new URLSearchParams(location.search));
    sync(true);
    void run();
  });
  sync(true);
  void run();
}
