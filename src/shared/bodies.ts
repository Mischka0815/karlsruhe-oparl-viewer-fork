import type { Meeting } from "./types/meeting.ts";
import type { Organization } from "./types/organization.ts";
import type { ResolvedMembership } from "./types/person.ts";
import { MANDATE_ROLES } from "./people.ts";

/** Path segment that marks a council body ("Gremium") in OParl ids. */
const BODY_ID_SEGMENT = "/organizations/gr/";

export const BODY_GROUPS = [
  "Gemeinderat",
  "Ausschüsse",
  "Ortschaftsräte",
  "Beiräte und Sonstige",
] as const;

export type BodyGroup = (typeof BODY_GROUPS)[number];

export function isCouncilBody(organization: Organization): boolean {
  return organization.id.includes(BODY_ID_SEGMENT);
}

/** OParl has no usable classification for most bodies, so the name decides. */
export function getBodyGroup(name: string): BodyGroup {
  if (name.startsWith("Gemeinderat")) return "Gemeinderat";
  if (name.startsWith("Ortschaftsrat")) return "Ortschaftsräte";
  if (/ausschuss/i.test(name)) return "Ausschüsse";
  return "Beiräte und Sonstige";
}

export interface BodyMeetingSummary {
  count: number;
  next?: Meeting;
  last?: Meeting;
}

/**
 * Meeting count plus the next and the most recent sitting of one body, given
 * meetings in ascending start order and the moment that splits them.
 */
export function summarizeBodyMeetings(
  meetings: readonly Meeting[],
  isPast: (meeting: Meeting) => boolean,
): BodyMeetingSummary {
  let last: Meeting | undefined;
  let next: Meeting | undefined;
  for (const meeting of meetings) {
    if (isPast(meeting)) last = meeting;
    else next ??= meeting;
  }
  return { count: meetings.length, next, last };
}

export interface MembersByRole {
  role: string;
  members: ResolvedMembership[];
}

/**
 * Seats in the body: chair plus full members. Deputies, advisory members and
 * citizen experts are listed on the body's page but would inflate a headcount
 * (a committee with 15 seats has about 34 deputies).
 */
export function countSeatHolders(
  members: readonly ResolvedMembership[],
): number {
  return members.filter(({ membership }) =>
    ["Vorsitz", "Ordentliches Mitglied"].includes(membership.role ?? ""),
  ).length;
}

const FULL_DATE = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Berlin",
});

/** "Mi., 17. März 2027" — with the year, since a next sitting can be months away. */
export function formatMeetingDate(start: string | undefined): string {
  const timestamp = start ? new Date(start).getTime() : NaN;
  return Number.isNaN(timestamp) ? "" : FULL_DATE.format(timestamp);
}

/** Members split by mandate role, in `MANDATE_ROLES` order; empty roles drop out. */
export function groupMembersByRole(
  members: readonly ResolvedMembership[],
): MembersByRole[] {
  return MANDATE_ROLES.map((role) => ({
    role,
    members: members.filter((entry) => entry.membership.role === role),
  })).filter((group) => group.members.length > 0);
}
