/**
 * Curated person → faction mapping for the Gemeinderat, kept in
 * `src/data/faction-members.json` because OParl memberships only point at
 * bodies, never at factions. See docs/konzept-ausbau.md, Phase 1.
 */
export interface FactionMemberIndex {
  version: number;
  /** OParl organization id of the body the mapping describes. */
  organization: string;
  legislativeTerm: string;
  source: {
    url: string;
    retrieved: string;
    note: string;
  };
  factions: Record<string, FactionDefinition | undefined>;
  members: FactionMember[];
}

export interface FactionDefinition {
  name: string;
  /** Keys in `paper-submitters.json`; FDP/FW is one faction with two keys. */
  submitterIds: string[];
}

export interface FactionMember {
  /** OParl person id (full URL). */
  person: string;
  name: string;
  /** `null` for the mayor (party, not faction) and entries without a label. */
  faction: string | null;
  /** Label exactly as the RIS shows it, kept for traceability. */
  risLabel: string | null;
  role: string;
  /** Council membership dates — not the date of joining the faction. */
  councilSince: string;
  councilUntil: string | null;
  note?: string;
}

export interface FactionSeatCount {
  factionId: string;
  name: string;
  seats: number;
}
