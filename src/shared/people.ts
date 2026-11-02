import type {
  FactionMember,
  FactionMemberIndex,
  FactionSeatCount,
} from "./types/faction-members.ts";
import type { Membership, Person, ResolvedMembership } from "./types/person.ts";

/**
 * Membership roles held by elected or appointed mandate holders, strongest
 * first. Staff roles ("Fraktionsgeschäftsstelle", "Verwaltung",
 * "Schriftführer") and memberships without a role are left out: those people
 * are employees, not members of the body, and get no pages.
 */
export const MANDATE_ROLES = [
  "Vorsitz",
  "Ordentliches Mitglied",
  "Stellvertretendes Mitglied",
  "Beratendes Mitglied",
  "Sachkundige Einwohner",
] as const;

const MANDATE_ROLE_RANK = new Map<string, number>(
  MANDATE_ROLES.map((role, rank) => [role, rank]),
);

export function isMandateMembership(membership: Membership): boolean {
  return MANDATE_ROLE_RANK.has(membership.role ?? "");
}

/** Today's calendar day in Karlsruhe, as `YYYY-MM-DD`. */
export function getBerlinCalendarDate(date: Date = new Date()): string {
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

/** Both bounds are inclusive calendar days; a missing bound is open. */
export function isActiveOn(
  start: string | null | undefined,
  end: string | null | undefined,
  day: string,
): boolean {
  return (
    (!start || start.slice(0, 10) <= day) && (!end || end.slice(0, 10) >= day)
  );
}

function compareByFamilyName(left: Person, right: Person): number {
  return (
    (left.familyName ?? left.name).localeCompare(
      right.familyName ?? right.name,
      "de",
    ) || left.name.localeCompare(right.name, "de")
  );
}

/**
 * Mandate holders of one body on `day`, one entry per person with their
 * strongest role, ordered by role and then family name. Memberships whose
 * person the mirror does not publish (the RIS answers 401 for non-public
 * people) drop out here, so no name is ever invented for them.
 */
export function selectBodyMembers(
  memberships: readonly Membership[],
  organizationId: string,
  peopleById: ReadonlyMap<string, Person>,
  day: string,
): ResolvedMembership[] {
  const strongestByPerson = new Map<string, ResolvedMembership>();

  for (const membership of memberships) {
    if (
      membership.deleted ||
      membership.organization !== organizationId ||
      !isMandateMembership(membership) ||
      !isActiveOn(membership.startDate, membership.endDate, day)
    ) {
      continue;
    }
    const person = peopleById.get(membership.person);
    if (!person || person.deleted) continue;

    const current = strongestByPerson.get(person.id);
    if (!current || roleRank(membership) < roleRank(current.membership)) {
      strongestByPerson.set(person.id, { membership, person });
    }
  }

  return [...strongestByPerson.values()].sort(
    (left, right) =>
      roleRank(left.membership) - roleRank(right.membership) ||
      compareByFamilyName(left.person, right.person),
  );
}

function roleRank(membership: Membership): number {
  return MANDATE_ROLE_RANK.get(membership.role ?? "") ?? MANDATE_ROLES.length;
}

/** Council members on `day`, as listed in the curated faction mapping. */
export function selectCurrentFactionMembers(
  index: FactionMemberIndex,
  day: string,
): FactionMember[] {
  return index.members.filter((member) =>
    isActiveOn(member.councilSince, member.councilUntil, day),
  );
}

/** The mapping entry for one person on `day`, if they sat on the council then. */
export function findFactionMember(
  index: FactionMemberIndex,
  personId: string,
  day: string,
): FactionMember | undefined {
  return selectCurrentFactionMembers(index, day).find(
    (member) => member.person === personId,
  );
}

/**
 * Seats per faction on `day`, largest first. Members without a faction (the
 * mayor, unlabeled entries) hold no faction seat and are not counted.
 */
export function countSeatsByFaction(
  index: FactionMemberIndex,
  day: string,
): FactionSeatCount[] {
  const seats = new Map<string, number>();
  for (const member of selectCurrentFactionMembers(index, day)) {
    if (!member.faction) continue;
    seats.set(member.faction, (seats.get(member.faction) ?? 0) + 1);
  }

  return [...seats]
    .map(([factionId, count]) => ({
      factionId,
      name: index.factions[factionId]?.name ?? factionId,
      seats: count,
    }))
    .sort(
      (left, right) =>
        right.seats - left.seats || left.name.localeCompare(right.name, "de"),
    );
}
