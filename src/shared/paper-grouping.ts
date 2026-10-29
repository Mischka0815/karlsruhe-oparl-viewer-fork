import { BULK_MODIFIED_DATE } from "./constants.ts";
import type { Paper } from "./types";
import {
  compareDateStrings,
  formatDateLong,
  formatMonthLong,
  getDateTimestamp,
} from "./utils.ts";

/**
 * Ordering and grouping for the paper list.
 *
 * The bulk import flattened `modified` onto a single day for ~87% of all
 * papers, so sorting by `modified` alone puts one undifferentiated block of
 * twelve thousand records — Vorlagen from 2004 through 2025 in arbitrary order
 * — under a single heading. Papers with a genuine `modified` timestamp are
 * therefore ordered and grouped by the day they changed, while bulk-imported
 * ones fall back to their own Vorlagendatum, grouped by month. Day granularity
 * for the archive would emit thousands of near-empty headings.
 *
 * `getPaperYear()` in `data.ts` applies the same fallback to the year filter.
 */

/** Papers modified by the bulk import carry no real edit date. */
export function isBulkImportedPaper(paper: Paper): boolean {
  return paper.modified.startsWith(BULK_MODIFIED_DATE);
}

/**
 * Some papers are published without a `date`, so the fallback only applies
 * where there is a usable one.
 */
function getUsablePaperDate(paper: Paper): string | undefined {
  return isBulkImportedPaper(paper) && getDateTimestamp(paper.date)
    ? paper.date
    : undefined;
}

/** The date the list actually orders by. */
export function getPaperSortDate(paper: Paper): string {
  return getUsablePaperDate(paper) ?? paper.modified;
}

export interface PaperDateGroup {
  /** Stable key shared by the heading and its papers, matched by the client filter. */
  key: string;
  label: string;
  /** Last day the group covers — see `comparePapersForList()`. */
  boundary: string;
  /** Groups built from the Vorlagendatum rather than a real modification. */
  isArchive: boolean;
}

/** Months sort as their last day so they stay adjacent to surrounding day groups. */
function getMonthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function getPaperDateGroup(paper: Paper): PaperDateGroup {
  const paperDate = getUsablePaperDate(paper);

  if (paperDate) {
    const month = paperDate.slice(0, 7);
    return {
      key: `vorlage:${month}`,
      label: `Vorlage vom ${formatMonthLong(paperDate)}`,
      boundary: getMonthEnd(month),
      isArchive: true,
    };
  }

  const day = paper.modified.slice(0, 10);
  return {
    key: `aktualisiert:${day}`,
    label: `Aktualisiert am ${formatDateLong(paper.modified)}`,
    boundary: day,
    isArchive: false,
  };
}

/**
 * Newest first. Groups are ordered by the last day they cover and compared by
 * key when two boundaries coincide, so every group stays contiguous — the list
 * renders one heading per group and the client filter shows a heading whenever
 * any of its papers is visible, both of which break if a group is interrupted.
 */
export function comparePapersForList(left: Paper, right: Paper): number {
  const leftGroup = getPaperDateGroup(left);
  const rightGroup = getPaperDateGroup(right);

  if (leftGroup.key !== rightGroup.key) {
    const byBoundary = compareDateStrings(
      rightGroup.boundary,
      leftGroup.boundary,
    );
    if (byBoundary !== 0) return byBoundary;
    return leftGroup.key.localeCompare(rightGroup.key);
  }

  return compareDateStrings(getPaperSortDate(right), getPaperSortDate(left));
}
