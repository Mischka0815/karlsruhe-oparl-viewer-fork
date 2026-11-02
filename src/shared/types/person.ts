import type { Entity } from "./entity.ts";

/**
 * OParl person as the mirror is meant to publish it: public records only, and
 * without the contact fields (`email`, `phone`, `locationObject`) the RIS
 * exposes. The viewer never renders those even if an older export carries them.
 */
export interface Person extends Entity {
  type: string;
  name: string;
  familyName?: string;
  givenName?: string;
  formOfAddress?: string;
  title?: string[];
  /** Free-text office label from the RIS, e.g. "Stadträtin" or "Ortschaftsrat". */
  affix?: string;
  created?: string;
  modified?: string;
  deleted?: boolean;
}

/** OParl membership of a person in a body (`organizations/gr/…`). */
export interface Membership extends Entity {
  type: string;
  person: string;
  organization: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  votingRight?: boolean;
  created?: string;
  modified?: string;
  deleted?: boolean;
}

/** An active mandate membership with its person resolved. */
export interface ResolvedMembership {
  membership: Membership;
  person: Person;
}
