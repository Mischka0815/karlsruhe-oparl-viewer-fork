import {
  getMeetingSelectFilters,
  MEETING_FILTER_IDS,
  MEETING_FILTER_QUERY_PARAMETERS,
  type MeetingListVariant,
  type MeetingSelectFilterDefinition,
  type MeetingSelectFilterKey,
} from "./meeting-filter-definitions";
import { getDateTimestamp } from "./utils";

const INIT_DATA_KEY = "meetingFiltersInitialized";

type FilterState = Record<MeetingSelectFilterKey, string> & {
  bodyType: string;
  search: string;
};

type FilterControls = Partial<
  Record<MeetingSelectFilterKey, HTMLSelectElement>
> & {
  fields: readonly MeetingSelectFilterDefinition[];
  bodyTypeOptions: HTMLButtonElement[];
  search: HTMLInputElement;
  reset: HTMLButtonElement;
};

interface MeetingListItem {
  element: HTMLElement;
  bodyTypes: Set<string>;
  organizations: Set<string>;
  districts: Set<string>;
  startTimestamp?: number;
  month: string;
  hasPublicAgenda: boolean;
  hasProtocol: boolean;
  searchText: string;
}

interface MeetingFilterContext {
  controls: FilterControls;
  items: MeetingListItem[];
  /** Month sections of `MeetingList`; hidden when none of their rows match. */
  groups: HTMLElement[];
  status: HTMLElement | null;
  noResults: HTMLElement | null;
  toggle: HTMLButtonElement | null;
  activeFilters: HTMLElement | null;
  filterCount: HTMLElement | null;
  /** Re-applies and syncs the URL after a chip removed its filter. */
  onChange: () => void;
}

interface ActiveFilter {
  label: string;
  clear: () => void;
}

function parseDelimitedValues(raw: string | null): Set<string> {
  return new Set((raw ?? "").split("|").filter(Boolean));
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE");
}

function hasSelectOption(select: HTMLSelectElement, value: string): boolean {
  return Array.from(select.options).some((option) => option.value === value);
}

function readVariant(container: HTMLElement): MeetingListVariant {
  return container.dataset.meetingFilters === "archive"
    ? "archive"
    : "upcoming";
}

function collectControls(container: HTMLElement): FilterControls | null {
  const controls = {} as Partial<FilterControls>;
  const fields = getMeetingSelectFilters(readVariant(container));

  for (const field of fields) {
    const control = container.querySelector<HTMLSelectElement>(`#${field.id}`);
    if (!control) return null;
    controls[field.key] = control;
  }
  controls.fields = fields;

  const search = container.querySelector<HTMLInputElement>(
    `#${MEETING_FILTER_IDS.search}`,
  );
  const reset = container.querySelector<HTMLButtonElement>(
    `#${MEETING_FILTER_IDS.reset}`,
  );
  if (!search || !reset) return null;

  const bodyTypeGroup = container.querySelector<HTMLElement>(
    `#${MEETING_FILTER_IDS.bodyType}`,
  );
  const bodyTypeOptions = bodyTypeGroup
    ? Array.from(
        bodyTypeGroup.querySelectorAll<HTMLButtonElement>(
          "[data-meeting-body-type-option]",
        ),
      )
    : [];
  if (bodyTypeOptions.length === 0) return null;

  controls.bodyTypeOptions = bodyTypeOptions;
  controls.search = search;
  controls.reset = reset;
  return controls as FilterControls;
}

function collectMeetingItems(container: HTMLElement): MeetingListItem[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-meeting-item]"),
  ).flatMap((element) => {
    const card = element.querySelector<HTMLElement>("[data-meeting-card]");
    if (!card) return [];

    return [
      {
        element,
        bodyTypes: parseDelimitedValues(card.getAttribute("data-body-types")),
        organizations: parseDelimitedValues(
          card.getAttribute("data-organizations"),
        ),
        districts: parseDelimitedValues(card.getAttribute("data-districts")),
        startTimestamp: getDateTimestamp(card.dataset.start),
        month: card.dataset.month ?? "",
        hasPublicAgenda: card.dataset.hasPublicAgenda === "true",
        hasProtocol: card.dataset.hasProtocol === "true",
        searchText: card.dataset.search ?? "",
      },
    ];
  });
}

function readFilterState(controls: FilterControls): FilterState {
  const state = {
    bodyType:
      controls.bodyTypeOptions.find(
        (option) => option.getAttribute("aria-pressed") === "true",
      )?.dataset.value ?? "",
    organization: "",
    district: "",
    timeRange: "",
    month: "",
    agenda: "",
    protocol: "",
    search: normalizeSearchValue(controls.search.value),
  } satisfies FilterState;

  for (const field of controls.fields) {
    state[field.key] = controls[field.key]?.value ?? "";
  }

  return state;
}

function setSelectedBodyType(
  controls: FilterControls,
  selectedValue: string,
): void {
  const hasSelectedValue = controls.bodyTypeOptions.some(
    (option) => option.dataset.value === selectedValue,
  );
  const normalizedValue = hasSelectedValue ? selectedValue : "";

  for (const option of controls.bodyTypeOptions) {
    const isSelected = option.dataset.value === normalizedValue;
    option.setAttribute("aria-pressed", String(isSelected));
    option.classList.toggle("active", isSelected);
  }
}

function applyFilterStateFromUrl(controls: FilterControls): void {
  const params = new URL(window.location.href).searchParams;

  setSelectedBodyType(
    controls,
    params.get(MEETING_FILTER_QUERY_PARAMETERS.bodyType) ?? "",
  );

  for (const field of controls.fields) {
    const control = controls[field.key];
    const value = params.get(MEETING_FILTER_QUERY_PARAMETERS[field.key]) ?? "";
    if (control && hasSelectOption(control, value)) {
      control.value = value;
    }
  }

  controls.search.value =
    params.get(MEETING_FILTER_QUERY_PARAMETERS.search) ?? "";
}

function syncFilterStateToUrl(controls: FilterControls): void {
  const url = new URL(window.location.href);
  const state = readFilterState(controls);

  if (state.bodyType) {
    url.searchParams.set(
      MEETING_FILTER_QUERY_PARAMETERS.bodyType,
      state.bodyType,
    );
  } else {
    url.searchParams.delete(MEETING_FILTER_QUERY_PARAMETERS.bodyType);
  }

  for (const field of controls.fields) {
    const parameter = MEETING_FILTER_QUERY_PARAMETERS[field.key];
    const value = state[field.key];
    if (value) {
      url.searchParams.set(parameter, value);
    } else {
      url.searchParams.delete(parameter);
    }
  }

  if (state.search) {
    url.searchParams.set(MEETING_FILTER_QUERY_PARAMETERS.search, state.search);
  } else {
    url.searchParams.delete(MEETING_FILTER_QUERY_PARAMETERS.search);
  }

  history.replaceState(history.state, "", url);
}

function matchesTimeRange(
  item: MeetingListItem,
  selectedRange: string,
  now: number,
): boolean {
  if (!selectedRange) return true;
  if (item.startTimestamp === undefined) return false;

  const days = Number(selectedRange);
  if (!Number.isFinite(days) || days <= 0) return true;

  const rangeEnd = now + days * 24 * 60 * 60 * 1_000;
  return item.startTimestamp >= now && item.startTimestamp <= rangeEnd;
}

function matchesItem(
  item: MeetingListItem,
  state: FilterState,
  now: number,
): boolean {
  if (state.bodyType && !item.bodyTypes.has(state.bodyType)) return false;
  if (state.organization && !item.organizations.has(state.organization)) {
    return false;
  }
  if (state.district && !item.districts.has(state.district)) return false;
  if (!matchesTimeRange(item, state.timeRange, now)) return false;
  if (state.month && item.month !== state.month) return false;

  if (state.agenda === "available" && !item.hasPublicAgenda) return false;
  if (state.agenda === "missing" && item.hasPublicAgenda) return false;
  if (state.protocol === "available" && !item.hasProtocol) return false;
  if (state.protocol === "missing" && item.hasProtocol) return false;
  if (state.search && !item.searchText.includes(state.search)) return false;

  return true;
}

function updateStatus(
  status: HTMLElement | null,
  state: FilterState,
  matchingCount: number,
  totalCount: number,
): void {
  if (!status) return;

  const isFiltered = Object.values(state).some(Boolean);
  status.textContent = isFiltered
    ? `${matchingCount} von ${totalCount} Sitzungen`
    : `${totalCount} Sitzungen`;
}

/** The panel's filters with a value — the body-type chips show their own state. */
function describeActiveFilters(controls: FilterControls): ActiveFilter[] {
  const active: ActiveFilter[] = [];

  for (const field of controls.fields) {
    const control = controls[field.key];
    if (!control?.value) continue;
    const option =
      control.selectedOptions[0]?.textContent?.trim() || control.value;
    active.push({
      label: `${field.label}: ${option}`,
      clear: () => {
        control.value = "";
      },
    });
  }

  const search = controls.search.value.trim();
  if (search) {
    active.push({
      label: `„${search}“`,
      clear: () => {
        controls.search.value = "";
      },
    });
  }

  return active;
}

function renderActiveFilters(context: MeetingFilterContext): void {
  const active = describeActiveFilters(context.controls);

  if (context.filterCount) {
    context.filterCount.textContent = String(active.length);
    context.filterCount.hidden = active.length === 0;
  }
  if (context.toggle) {
    context.toggle.setAttribute(
      "aria-label",
      active.length > 0 ? `Filter (${active.length} aktiv)` : "Filter",
    );
  }

  const container = context.activeFilters;
  if (!container) return;

  container.replaceChildren(
    ...active.map((filter, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Filter entfernen: ${filter.label}`);
      const remove = document.createElement("span");
      remove.className = "chip-remove";
      remove.setAttribute("aria-hidden", "true");
      remove.textContent = "×";
      button.append(filter.label, remove);
      button.addEventListener("click", () => {
        filter.clear();
        context.onChange();
        // The chip is gone; keep focus in the toolbar rather than dropping it
        // to the page.
        const chips = container.querySelectorAll<HTMLButtonElement>("button");
        (chips[Math.min(index, chips.length - 1)] ?? context.toggle)?.focus();
      });
      return button;
    }),
  );
}

function applyFilters(context: MeetingFilterContext): void {
  const state = readFilterState(context.controls);
  const now = Date.now();
  let matchingCount = 0;

  for (const item of context.items) {
    const isMatch = matchesItem(item, state, now);
    item.element.hidden = !isMatch;
    if (isMatch) matchingCount += 1;
  }

  for (const group of context.groups) {
    group.hidden = !group.querySelector("[data-meeting-item]:not([hidden])");
  }

  updateStatus(context.status, state, matchingCount, context.items.length);
  renderActiveFilters(context);
  if (context.noResults) context.noResults.hidden = matchingCount > 0;
}

function resetFilters(context: MeetingFilterContext): void {
  setSelectedBodyType(context.controls, "");
  for (const field of context.controls.fields) {
    const control = context.controls[field.key];
    if (control) control.value = "";
  }
  context.controls.search.value = "";
  syncFilterStateToUrl(context.controls);
  applyFilters(context);
}

function initMeetingFilterElement(container: HTMLElement): void {
  if (container.dataset[INIT_DATA_KEY] === "true") return;

  const controls = collectControls(container);
  if (!controls) return;

  container.dataset[INIT_DATA_KEY] = "true";
  const scope = container.parentElement ?? document.body;
  const context: MeetingFilterContext = {
    controls,
    items: collectMeetingItems(scope),
    groups: Array.from(
      scope.querySelectorAll<HTMLElement>("[data-meeting-group]"),
    ),
    status: container.querySelector<HTMLElement>(
      "[data-meeting-filter-status]",
    ),
    noResults: scope.querySelector<HTMLElement>("[data-meeting-no-results]"),
    toggle: container.querySelector<HTMLButtonElement>(
      "[data-meeting-filter-toggle]",
    ),
    activeFilters: container.querySelector<HTMLElement>(
      "[data-meeting-active-filters]",
    ),
    filterCount: container.querySelector<HTMLElement>(
      "[data-meeting-filter-count]",
    ),
    onChange: () => {},
  };

  const panel = container.querySelector<HTMLElement>(
    "[data-meeting-filter-panel]",
  );
  context.toggle?.addEventListener("click", () => {
    if (!panel) return;
    panel.hidden = !panel.hidden;
    context.toggle?.setAttribute("aria-expanded", String(!panel.hidden));
  });
  applyFilterStateFromUrl(controls);

  const applyAndSync = () => {
    applyFilters(context);
    syncFilterStateToUrl(controls);
  };
  context.onChange = applyAndSync;

  for (const option of controls.bodyTypeOptions) {
    option.addEventListener("click", () => {
      setSelectedBodyType(controls, option.dataset.value ?? "");
      applyAndSync();
    });
  }

  for (const field of controls.fields) {
    controls[field.key]?.addEventListener("change", applyAndSync);
  }
  controls.search.addEventListener("input", applyAndSync);
  controls.reset.addEventListener("click", () => resetFilters(context));
  window.addEventListener("popstate", () => {
    applyFilterStateFromUrl(controls);
    applyFilters(context);
  });

  applyFilters(context);
}

export function initMeetingFilters(): void {
  document
    .querySelectorAll<HTMLElement>("[data-meeting-filters]")
    .forEach(initMeetingFilterElement);
}
