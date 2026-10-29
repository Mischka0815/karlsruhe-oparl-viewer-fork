/**
 * How meetings are named and grouped on the page. Import-free, like
 * `meeting-archive.ts`, so `tests/` can load it without the data layer.
 */

/**
 * The RIS appends the session's publicity to ~1,800 of ~2,600 meeting names —
 * "(öffentlich/nicht öffentlich)" and its typo variants. Next to nearly every
 * name it says nothing, so it is dropped for display. "(nicht öffentlich)" is
 * kept: it is rare and tells a reader there is nothing public to attend.
 */
const PUBLIC_SESSION_SUFFIX =
  /\s*\(öffentlich(?:er Teil|\s*\/\s*nicht\s*t?öffentlich)?\)\s*$/i;

export function formatMeetingName(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(PUBLIC_SESSION_SUFFIX, "") || trimmed;
}

/**
 * The organizations worth printing under a meeting name: those the name does
 * not already spell out. "Sozialausschuss" under "Sozialausschuss" is noise;
 * "Betriebsausschuss Eigenbetrieb Abfallwirtschaft…" under "Eigenbetrieb
 * Abfallwirtschaft…" is not. Pass only resolved names, never a placeholder.
 */
export function getUnnamedOrganizations(
  meetingName: string,
  organizationNames: readonly string[],
): string[] {
  const name = meetingName.toLocaleLowerCase("de-DE");
  return organizationNames.filter(
    (organization) =>
      organization.trim() &&
      !name.includes(organization.trim().toLocaleLowerCase("de-DE")),
  );
}

export interface MeetingMonthGroup<T> {
  /** "2026-11" — stable, sortable, usable as an id. */
  key: string;
  /** "November 2026" */
  label: string;
  meetings: T[];
}

const MONTH_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});

/**
 * Consecutive meetings of the same calendar month, in the order given. Months
 * use the same local-time reading as `getMeetingMonth`, so a heading never
 * disagrees with the month filter. Undated meetings share one trailing group.
 */
export function groupMeetingsByMonth<T extends { start?: string }>(
  meetings: readonly T[],
): MeetingMonthGroup<T>[] {
  const groups: MeetingMonthGroup<T>[] = [];

  for (const meeting of meetings) {
    const timestamp = meeting.start ? new Date(meeting.start).getTime() : NaN;
    const date = Number.isNaN(timestamp) ? undefined : new Date(timestamp);
    const key = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      : "ohne-datum";
    const last = groups.at(-1);

    if (last?.key === key) {
      last.meetings.push(meeting);
    } else {
      groups.push({
        key,
        label: date ? MONTH_FORMATTER.format(date) : "Ohne Datum",
        meetings: [meeting],
      });
    }
  }

  return groups;
}

const DAY_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "Di., 3. Nov." and "18:30" — the month heading carries the year. */
export function formatMeetingDayAndTime(start: string | undefined): {
  day: string;
  time: string;
} {
  const timestamp = start ? new Date(start).getTime() : NaN;
  if (Number.isNaN(timestamp)) return { day: "", time: "" };
  return {
    day: DAY_FORMATTER.format(timestamp),
    time: TIME_FORMATTER.format(timestamp),
  };
}

/** "Ortschaftsrat Durlach" → "Durlach"; anything else → "". */
export function parseOrtschaftName(organizationName: string): string {
  return /^Ortschaftsrat\s+(.+)$/i.exec(organizationName.trim())?.[1] ?? "";
}

/**
 * Wettersbach's Ortschaftsrat speaks for two districts the classifier names
 * separately. Every other Ortschaft shares its district's name.
 */
const ORTSCHAFT_BY_DISTRICT: Readonly<Record<string, string>> = {
  Grünwettersbach: "Wettersbach",
  Palmbach: "Wettersbach",
};

/** The Ortschaft a district belongs to, or "" for districts without one. */
export function getDistrictOrtschaft(
  district: string,
  ortschaften: readonly string[],
): string {
  const name = ORTSCHAFT_BY_DISTRICT[district] ?? district;
  return ortschaften.includes(name) ? name : "";
}
