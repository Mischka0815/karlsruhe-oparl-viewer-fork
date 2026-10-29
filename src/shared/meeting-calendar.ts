import {
  buildOfficialMeetingUrl,
  getEffectiveMeetingEnd,
  getOParlEntityId,
} from "./utils.ts";
import { formatMeetingName } from "./meeting-presentation.ts";
import type { Meeting } from "./types";

const encoder = new TextEncoder();

function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** RFC 5545 content lines may contain at most 75 UTF-8 octets. */
function foldContentLine(line: string): string {
  const parts: string[] = [];
  let part = "";
  let byteLength = 0;
  let byteLimit = 75;

  for (const character of line) {
    const characterByteLength = encoder.encode(character).length;
    if (part && byteLength + characterByteLength > byteLimit) {
      parts.push(part);
      part = "";
      byteLength = 0;
      // Continuation lines start with one whitespace octet.
      byteLimit = 74;
    }
    part += character;
    byteLength += characterByteLength;
  }

  parts.push(part);
  return parts.join("\r\n ");
}

function formatCalendarDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid calendar date: ${String(value)}`);
  }
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** How far back the subscription feed reaches, so a sitting does not vanish from calendars the moment it ends. */
export const CALENDAR_FEED_LOOKBACK_DAYS = 30;

/** Calendar apps should re-fetch the feed about as often as the site deploys. */
const CALENDAR_FEED_REFRESH_INTERVAL = "PT12H";

interface CalendarOptions {
  productName: string;
  /** Extra VCALENDAR properties, e.g. a display name for subscriptions. */
  properties?: string[];
}

function createCalendar(
  events: string[][],
  { productName, properties = [] }: CalendarOptions,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//GemeinderatsRadar Karlsruhe//${productName}//DE`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...properties,
    ...events.flat(),
    "END:VCALENDAR",
  ];

  return `${lines.map(foldContentLine).join("\r\n")}\r\n`;
}

/**
 * The UID matches across the single download and the feed, so a calendar that
 * holds both treats them as the same event.
 */
function buildMeetingEventLines(
  meeting: Meeting,
  meetingUrl: string,
): string[] {
  const meetingId = getOParlEntityId(meeting.id);
  if (!meetingId) {
    throw new TypeError(`Meeting has no stable id: ${meeting.id}`);
  }

  return [
    "BEGIN:VEVENT",
    `UID:sitzung-${meetingId}@gemeinderatsradar.karlsruhe`,
    `DTSTAMP:${formatCalendarDate(meeting.modified)}`,
    `DTSTART:${formatCalendarDate(meeting.start)}`,
    `DTEND:${formatCalendarDate(
      getEffectiveMeetingEnd(meeting.start, meeting.end),
    )}`,
    `SUMMARY:${escapeCalendarText(formatMeetingName(meeting.name))}`,
    meeting.location?.description
      ? `LOCATION:${escapeCalendarText(meeting.location.description)}`
      : undefined,
    `DESCRIPTION:${escapeCalendarText(
      [
        "Öffentliche Sitzung.",
        "",
        `Details und Tagesordnung: ${meetingUrl}`,
        `Offizielles Ratsinformationssystem: ${buildOfficialMeetingUrl(meetingId)}`,
      ].join("\n"),
    )}`,
    `URL:${meetingUrl}`,
    `CREATED:${formatCalendarDate(meeting.created)}`,
    `LAST-MODIFIED:${formatCalendarDate(meeting.modified)}`,
    "END:VEVENT",
  ].filter((line): line is string => Boolean(line));
}

export function createMeetingCalendar(
  meeting: Meeting,
  meetingUrl: string,
): string {
  return createCalendar([buildMeetingEventLines(meeting, meetingUrl)], {
    productName: "Sitzungstermin",
  });
}

/** Meetings the subscription feed carries: upcoming ones plus the recent past. */
export function selectCalendarFeedMeetings(
  meetings: Meeting[],
  now: Date = new Date(),
): Meeting[] {
  const cutoff =
    now.getTime() - CALENDAR_FEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000;
  return meetings.filter(
    (meeting) =>
      getEffectiveMeetingEnd(meeting.start, meeting.end).getTime() >= cutoff,
  );
}

export function createMeetingCalendarFeed(
  meetings: { meeting: Meeting; meetingUrl: string }[],
): string {
  const name = "Sitzungen Karlsruhe (GemeinderatsRadar)";
  return createCalendar(
    meetings.map(({ meeting, meetingUrl }) =>
      buildMeetingEventLines(meeting, meetingUrl),
    ),
    {
      productName: "Sitzungskalender",
      properties: [
        `NAME:${escapeCalendarText(name)}`,
        `X-WR-CALNAME:${escapeCalendarText(name)}`,
        `X-WR-CALDESC:${escapeCalendarText(
          "Öffentliche Sitzungen des Karlsruher Gemeinderats und seiner Gremien.",
        )}`,
        `REFRESH-INTERVAL;VALUE=DURATION:${CALENDAR_FEED_REFRESH_INTERVAL}`,
        `X-PUBLISHED-TTL:${CALENDAR_FEED_REFRESH_INTERVAL}`,
      ],
    },
  );
}
