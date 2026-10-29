import { OFFICIAL_RIS_BASE_URL, SYNDICATION_BASE_URL } from "./constants.ts";
import { MEETING_FILTER_QUERY_PARAMETERS } from "./meeting-filter-definitions.ts";

/**
 * Trims each entry, drops empties, and de-duplicates — accepting a single
 * string, an array, or a nullish value. Preserves first-seen order.
 */
export function normalizeStringList(
  value: string[] | string | null | undefined,
): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];

  return [...new Set(rawValues.map((entry) => entry.trim()).filter(Boolean))];
}

export function normalizeOParlUrl(url: string): string {
  if (url.includes("/ris/")) {
    return url;
  }
  return url.replace("/oparl/", "/ris/oparl/");
}

export const PAPERS_YEAR_QUERY_PARAMETER = "year";

export function buildPapersUrl(baseUrl: string, year?: string | null): string {
  const normalizedYear = year?.trim() ?? "";
  if (!normalizedYear) {
    return baseUrl;
  }

  const params = new URLSearchParams([
    ["from", `${normalizedYear}-01-01`],
    ["to", `${normalizedYear}-12-31`],
  ]);
  return `${baseUrl}?${params.toString()}`;
}

export function buildPaperDetailUrl(
  baseUrl: string,
  reference: string,
): string {
  return `${baseUrl}vorlagen/${encodeURIComponent(reference)}`;
}

export function getOParlEntityId(id: string): string {
  return id.split("/").filter(Boolean).at(-1) ?? "";
}

/**
 * Where the syndication mirror publishes one file's extracted PDF text. Mirrors
 * the layout `dataSource.loadText()` reads at build time, so the browser and the
 * build resolve the same document.
 */
export function buildFileTextUrl(fileId: string): string {
  return `${SYNDICATION_BASE_URL}file-contents/${encodeURIComponent(fileId)}.txt`;
}

export function buildMeetingDetailUrl(baseUrl: string, id: string): string {
  return `${baseUrl}sitzungen/${encodeURIComponent(id)}`;
}

/**
 * Detail URL for a resolved meeting, or `undefined` when the meeting is missing
 * or carries no usable id — callers then render its name unlinked instead of
 * pointing at a bare `/sitzungen/`.
 */
export function buildMeetingUrl(
  baseUrl: string,
  meeting: { id: string } | undefined,
): string | undefined {
  const id = meeting ? getOParlEntityId(meeting.id) : "";
  return id ? buildMeetingDetailUrl(baseUrl, id) : undefined;
}

export function buildDistrictUrl(baseUrl: string, name: string): string {
  return `${baseUrl}stadtteil/${slugify(name)}`;
}

export function buildFactionUrl(baseUrl: string, factionId: string): string {
  return `${baseUrl}fraktion/${encodeURIComponent(factionId)}`;
}

export function buildMeetingCalendarUrl(baseUrl: string, id: string): string {
  return `${baseUrl}sitzungen/kalender/${encodeURIComponent(id)}.ics`;
}

/** The meeting's page in the city's official Ratsinformationssystem. */
export function buildOfficialMeetingUrl(id: string): string {
  return `${OFFICIAL_RIS_BASE_URL}termin-${encodeURIComponent(id)}`;
}

/** The subscribable calendar with every upcoming meeting. */
export function buildMeetingCalendarFeedUrl(baseUrl: string): string {
  return `${baseUrl}sitzungen/kalender.ics`;
}

/** Upcoming meetings filtered to one Ortschaftsrat. */
export function buildOrtschaftMeetingsUrl(
  baseUrl: string,
  ortschaft: string,
): string {
  const params = new URLSearchParams([
    [MEETING_FILTER_QUERY_PARAMETERS.district, ortschaft],
  ]);
  return `${baseUrl}sitzungen?${params}`;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "long",
  timeStyle: "short",
});
const DATE_SHORT_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const DATE_LONG_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const MONTH_LONG_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  year: "numeric",
  month: "long",
});

export function getDateTimestamp(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const timestamp = new Date(date).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/** Sorts valid dates chronologically and keeps invalid values deterministic. */
export function compareDateStrings(
  left: string | undefined,
  right: string | undefined,
): number {
  const leftTimestamp = getDateTimestamp(left);
  const rightTimestamp = getDateTimestamp(right);

  if (leftTimestamp !== undefined && rightTimestamp !== undefined) {
    return leftTimestamp - rightTimestamp;
  }
  if (leftTimestamp !== undefined) return -1;
  if (rightTimestamp !== undefined) return 1;
  return (left ?? "").localeCompare(right ?? "");
}

export function formatDateTime(date: string | undefined): string {
  const timestamp = getDateTimestamp(date);
  return timestamp === undefined ? "" : DATE_TIME_FORMATTER.format(timestamp);
}

/**
 * The "when" of a meeting slot as one line — date and time, then whatever
 * further details the caller has ("TOP 5", the consultation role). Both the
 * detail header and the timeline print this, so the separator lives here.
 * Empty details drop out, so an undated meeting yields an empty string.
 */
export function formatMeetingSlot(
  start: string | undefined,
  ...details: (string | undefined)[]
): string {
  const startedAt = formatDateTime(start);
  return [startedAt && `${startedAt} Uhr`, ...details]
    .filter(Boolean)
    .join(" · ");
}

/** "TOP 5", or an empty string when the agenda item is unnumbered. */
export function formatAgendaItemLabel(number: string | undefined): string {
  const trimmed = number?.trim();
  return trimmed ? `TOP ${trimmed}` : "";
}

/** Some OParl meetings use midnight as a placeholder end before their start. */
export function getEffectiveMeetingEnd(start: string, end: string): Date {
  const startTimestamp = getDateTimestamp(start);
  if (startTimestamp === undefined) return new Date(Number.NaN);

  const endTimestamp = getDateTimestamp(end);
  return new Date(
    endTimestamp !== undefined && endTimestamp > startTimestamp
      ? endTimestamp
      : startTimestamp + 2 * 60 * 60 * 1_000,
  );
}

export function hasPublishedMeetingEnd(start: string, end: string): boolean {
  const startTimestamp = getDateTimestamp(start);
  const endTimestamp = getDateTimestamp(end);
  return (
    startTimestamp !== undefined &&
    endTimestamp !== undefined &&
    endTimestamp > startTimestamp
  );
}

/** Formats a date string as "dd.MM.yyyy" in German locale. */
export function formatDateShort(date: string | undefined): string {
  const timestamp = getDateTimestamp(date);
  return timestamp === undefined ? "" : DATE_SHORT_FORMATTER.format(timestamp);
}

/** Formats a date string as "d. MMMM yyyy" in German locale. */
export function formatDateLong(date: string | undefined): string {
  const timestamp = getDateTimestamp(date);
  return timestamp === undefined ? "" : DATE_LONG_FORMATTER.format(timestamp);
}

/** Formats a date string as "MMMM yyyy" in German locale. */
export function formatMonthLong(date: string | undefined): string {
  const timestamp = getDateTimestamp(date);
  return timestamp === undefined ? "" : MONTH_LONG_FORMATTER.format(timestamp);
}

/** Converts a display string (e.g. Stadtteil name) into a URL-safe slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
