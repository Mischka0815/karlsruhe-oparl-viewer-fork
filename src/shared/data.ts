import { dataSource, FILE_READ_CONCURRENCY } from "./data-source";
import { comparePapersForList, isBulkImportedPaper } from "./paper-grouping";
import { mapConcurrent, memoizeAsync } from "./async-utils";
import {
  buildSyndicationFeedCatalog,
  type SyndicationFeedCatalog,
} from "./syndication-feeds";
import {
  compareDateStrings,
  getEffectiveMeetingEnd,
  getOParlEntityId,
  normalizeStringList,
  slugify,
} from "./utils";
import {
  getBodyGroup,
  isCouncilBody,
  summarizeBodyMeetings,
  type BodyGroup,
  type BodyMeetingSummary,
} from "./bodies";
import { MEETING_DIGEST_LEADS } from "./meeting-digest";
import { buildMeetingFilterModel } from "./meeting-filters";
import { parseOrtschaftName } from "./meeting-presentation";
import { selectSimilarPapers } from "./paper-similarity";
import {
  countSeatsByFaction,
  findFactionMember,
  getBerlinCalendarDate,
  selectBodyMembers,
} from "./people";
import factionMemberIndex from "../data/faction-members.json";
import type {
  FactionMember,
  FactionMemberIndex,
  FactionSeatCount,
  FileContent,
  Membership,
  Meeting,
  MeetingDigest,
  MeetingDigestLead,
  Organization,
  Paper,
  PaperDistrictEntry,
  PaperDistrictIndex,
  PaperSummary,
  PaperSimilarityIndex,
  PaperSubmitter,
  PaperSubmitterIndex,
  Person,
  ResolvedMembership,
  ResolvedPaperSubmitter,
  ResolvedAgendaItem,
  ResolvedConsultation,
  ResolvedAuxiliaryFile,
  SyndicationFeed,
} from "./types";

const PAPER_SUBMITTER_INDEX_VERSION = 3;
const FACTION_MEMBER_INDEX_VERSION = 1;

const SUBMITTER_NAME_OVERRIDES: Record<string, string> = {
  afd: "-",
};

const EMPTY_PAPER_SUBMITTER_INDEX: PaperSubmitterIndex = {
  version: PAPER_SUBMITTER_INDEX_VERSION,
  factions: {},
  papers: {},
};

interface LoadedPaperDistrictData {
  byPaperKey: Map<string, string[]>;
  districts: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUnknownStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeStringList(
      value.filter((entry): entry is string => typeof entry === "string"),
    );
  }
  return normalizeStringList(typeof value === "string" ? value : null);
}

function normalizePaperDistrictEntry(value: unknown): string[] {
  if (!isRecord(value)) return normalizeUnknownStringList(value);

  const entry = value as Partial<PaperDistrictEntry>;
  return normalizeStringList([
    ...normalizeUnknownStringList(entry.primary),
    ...normalizeUnknownStringList(entry.mentioned),
  ]);
}

function isPaperDistrictIndex(value: unknown): value is PaperDistrictIndex {
  if (!isRecord(value)) return false;

  return (
    Array.isArray(value.districts) &&
    isRecord(value.papers) &&
    Object.values(value.papers).every(
      (entry) => isRecord(entry) || entry === undefined,
    )
  );
}

const loadPaperDistrictData = memoizeAsync(
  async (): Promise<LoadedPaperDistrictData> => {
    const rawData = await dataSource.loadRecord<unknown>("paper-stadtteile");

    if (isPaperDistrictIndex(rawData)) {
      const byPaperKey = new Map(
        Object.entries(rawData.papers).map(([recordId, entry]) => [
          recordId,
          normalizePaperDistrictEntry(entry),
        ]),
      );
      return {
        byPaperKey,
        districts: normalizeUnknownStringList(rawData.districts),
      };
    }

    // Version 1 keyed the map by paper.reference. Keep it readable for local
    // checkouts that have not regenerated the syndication artifact yet.
    const byPaperKey = new Map(
      Object.entries(rawData).map(([paperReference, rawValue]) => [
        paperReference,
        normalizePaperDistrictEntry(rawValue),
      ]),
    );
    return {
      byPaperKey,
      districts: [...new Set([...byPaperKey.values()].flat())],
    };
  },
);

function buildPaperCountsByDistrict(papers: Paper[]): Map<string, number> {
  const paperCountsByDistrict = new Map<string, number>();

  for (const paper of papers) {
    for (const districtName of paper.stadtteile) {
      const normalizedDistrictName = districtName.trim();
      if (!normalizedDistrictName) continue;

      paperCountsByDistrict.set(
        normalizedDistrictName,
        (paperCountsByDistrict.get(normalizedDistrictName) ?? 0) + 1,
      );
    }
  }

  return paperCountsByDistrict;
}

// --- Loaders ---

export const loadPapers = memoizeAsync(async (): Promise<Paper[]> => {
  const [papers, paperDistrictData] = await Promise.all([
    dataSource.loadArray<Paper>("papers"),
    loadPaperDistrictData(),
  ]);
  const activePapers = papers
    .filter((paper) => !paper.deleted)
    .map((paper) => ({
      ...paper,
      routeReference: paper.reference.replaceAll("/", "-"),
      stadtteile:
        paperDistrictData.byPaperKey.get(getOParlEntityId(paper.id)) ??
        paperDistrictData.byPaperKey.get(paper.reference) ??
        [],
    }))
    .sort(comparePapersForList);

  return activePapers;
});

export const loadMeetings = memoizeAsync(
  async (): Promise<Map<string, Meeting>> => {
    const meetings = await dataSource.loadArray<Meeting>("meetings");
    return new Map(
      meetings
        .filter((meeting) => !meeting.deleted)
        .map((meeting) => [meeting.id, meeting]),
    );
  },
);

export const loadOrganizations = memoizeAsync(
  async (): Promise<Map<string, Organization>> => {
    const organizations =
      await dataSource.loadArray<Organization>("organizations");
    return new Map(
      organizations.map((organization) => [organization.id, organization]),
    );
  },
);

export const loadSyndicationFeedCatalog = memoizeAsync(
  async (): Promise<SyndicationFeedCatalog> => {
    const feeds = await dataSource.loadArray<SyndicationFeed>("feed-index");
    return buildSyndicationFeedCatalog(feeds);
  },
);

export const loadFileContents = memoizeAsync(
  async (): Promise<Map<string, FileContent>> => {
    const fileContents =
      await dataSource.loadArray<FileContent>("file-contents");
    const fileContentsById = new Map(
      fileContents.map((fileContent) => [fileContent.id, fileContent]),
    );

    const filesWithExtractedText = fileContents.filter(
      (fileContent) => fileContent.hasExtractedText,
    );
    let missingTextCount = 0;
    await mapConcurrent(
      filesWithExtractedText,
      FILE_READ_CONCURRENCY,
      async (fileContent) => {
        const fileId = new URL(fileContent.id).pathname
          .split("/")
          .filter(Boolean)
          .at(-1);
        if (!fileId) {
          missingTextCount++;
          return;
        }
        const extractedText = await dataSource.loadText(fileId);
        if (extractedText === undefined) {
          missingTextCount++;
        } else {
          fileContent.extractedText = extractedText;
        }
      },
    );
    if (missingTextCount > 0) {
      console.warn(
        `Missing extracted text for ${missingTextCount} of ${filesWithExtractedText.length} indexed files`,
      );
    }

    return fileContentsById;
  },
);

export const loadPaperDistricts = memoizeAsync(
  async (): Promise<Map<string, string[]>> => {
    const { byPaperKey } = await loadPaperDistrictData();
    return byPaperKey;
  },
);

export const loadPaperSubmitters = memoizeAsync(
  async (): Promise<PaperSubmitterIndex> => {
    const index =
      await dataSource.loadOptionalObject<PaperSubmitterIndex>(
        "paper-submitters",
      );
    if (index === undefined) return EMPTY_PAPER_SUBMITTER_INDEX;

    if (index.version !== PAPER_SUBMITTER_INDEX_VERSION) {
      throw new Error(
        `Unsupported paper submitter index version: ${String(index.version)} (expected ${PAPER_SUBMITTER_INDEX_VERSION})`,
      );
    }

    const factions: typeof index.factions = {};
    for (const [id, name] of Object.entries(index.factions)) {
      factions[id] = SUBMITTER_NAME_OVERRIDES[id] ?? name;
    }

    return { ...index, factions };
  },
);

const HIDDEN_SUBMITTER_IDS = new Set(["afd"]);

function isHiddenSubmitterId(id: string): boolean {
  return HIDDEN_SUBMITTER_IDS.has(id);
}

export const getAvailablePaperSubmitters = memoizeAsync(
  async (): Promise<PaperSubmitter[]> => {
    const index = await loadPaperSubmitters();
    return Object.entries(index.factions)
      .filter(([id]) => !isHiddenSubmitterId(id))
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  },
);

export const getPaperCountsBySubmitter = memoizeAsync(
  async (): Promise<Map<string, number>> => {
    const [papers, index] = await Promise.all([
      loadPapers(),
      loadPaperSubmitters(),
    ]);
    const counts = new Map(
      Object.keys(index.factions).map((factionId) => [factionId, 0]),
    );

    for (const paper of papers) {
      const recordId = getOParlEntityId(paper.id);
      for (const factionId of index.papers[recordId] ?? []) {
        if (counts.has(factionId)) {
          counts.set(factionId, (counts.get(factionId) ?? 0) + 1);
        }
      }
    }

    return counts;
  },
);

// --- Derived data ---

export function getPaperYear(paper: Paper): string {
  if (isBulkImportedPaper(paper) && paper.date) {
    return paper.date.slice(0, 4);
  }
  return paper.modified.slice(0, 4);
}

export const getAvailableYears = memoizeAsync(async (): Promise<string[]> => {
  const papers = await loadPapers();
  return [...new Set(papers.map((paper) => getPaperYear(paper)))].sort();
});

export const getMeetings = memoizeAsync(async (): Promise<Meeting[]> => {
  const meetingsById = await loadMeetings();
  return [...meetingsById.values()].sort((a, b) =>
    compareDateStrings(a.start, b.start),
  );
});

export const getUpcomingMeetings = memoizeAsync(
  async (): Promise<Meeting[]> => {
    const meetings = await getMeetings();
    const now = new Date();
    return meetings.filter(
      (meeting) => getEffectiveMeetingEnd(meeting.start, meeting.end) >= now,
    );
  },
);

/** Everything the upcoming list leaves out, newest first — the archive order. */
export const getPastMeetings = memoizeAsync(async (): Promise<Meeting[]> => {
  const meetings = await getMeetings();
  const now = new Date();
  return meetings
    .filter(
      (meeting) => getEffectiveMeetingEnd(meeting.start, meeting.end) < now,
    )
    .reverse();
});

/**
 * Ortschaften with their own council, and those of them with an upcoming
 * sitting. The second list is the meeting filter's own `ortschaft` options, so
 * a link built from it always selects something on `/sitzungen`.
 */
export const getOrtschaften = memoizeAsync(
  async (): Promise<{ all: string[]; withUpcomingMeetings: string[] }> => {
    const [organizationsById, upcomingMeetings] = await Promise.all([
      loadOrganizations(),
      getUpcomingMeetings(),
    ]);
    const all = [
      ...new Set(
        [...organizationsById.values()]
          .map((organization) => parseOrtschaftName(organization.name ?? ""))
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right, "de-DE"));
    const { options } = buildMeetingFilterModel(
      upcomingMeetings,
      organizationsById,
    );
    return { all, withUpcomingMeetings: options.districts };
  },
);

export const getAvailableDistricts = memoizeAsync(
  async (): Promise<string[]> => {
    const [paperDistrictData, paperCountsByDistrict] = await Promise.all([
      loadPaperDistrictData(),
      getPaperCountsByDistrict(),
    ]);
    return [
      ...new Set([
        ...paperDistrictData.districts,
        ...paperCountsByDistrict.keys(),
      ]),
    ].sort();
  },
);

export const getPaperCountsByDistrict = memoizeAsync(
  async (): Promise<Map<string, number>> => {
    const papers = await loadPapers();
    return buildPaperCountsByDistrict(papers);
  },
);

// --- Council bodies ---

export interface CouncilBody {
  organization: Organization;
  /** `/gremien/[slug]`; slugs are unique across the 28 current bodies. */
  slug: string;
  group: BodyGroup;
  meetings: BodyMeetingSummary;
}

/** Every body (`organizations/gr/…`) with its meeting summary, by name. */
export const getCouncilBodies = memoizeAsync(
  async (): Promise<CouncilBody[]> => {
    const [organizationsById, meetings] = await Promise.all([
      loadOrganizations(),
      getMeetings(),
    ]);
    const now = new Date();
    const isPast = (meeting: Meeting) =>
      getEffectiveMeetingEnd(meeting.start, meeting.end) < now;

    const meetingsByOrganization = new Map<string, Meeting[]>();
    for (const meeting of meetings) {
      for (const organizationId of meeting.organization ?? []) {
        const list = meetingsByOrganization.get(organizationId) ?? [];
        list.push(meeting);
        meetingsByOrganization.set(organizationId, list);
      }
    }

    const bodies = [...organizationsById.values()]
      .filter(isCouncilBody)
      .map((organization) => ({
        organization,
        slug: slugify(organization.name),
        group: getBodyGroup(organization.name),
        meetings: summarizeBodyMeetings(
          meetingsByOrganization.get(organization.id) ?? [],
          isPast,
        ),
      }))
      .sort((left, right) =>
        left.organization.name.localeCompare(right.organization.name, "de"),
      );

    const slugs = new Set<string>();
    for (const body of bodies) {
      if (slugs.has(body.slug)) {
        throw new Error(`Duplicate body slug: ${body.slug}`);
      }
      slugs.add(body.slug);
    }
    return bodies;
  },
);

/** Upcoming or past meetings of one body, nearest first. */
export async function getBodyMeetings(
  organizationId: string,
  when: "upcoming" | "past",
  limit: number,
): Promise<Meeting[]> {
  const meetings =
    when === "upcoming" ? await getUpcomingMeetings() : await getPastMeetings();
  return meetings
    .filter((meeting) => (meeting.organization ?? []).includes(organizationId))
    .slice(0, limit);
}

// --- People, memberships, factions ---

/**
 * Public people from the optional `people` store. Older checkouts have none,
 * which leaves every people-dependent view empty rather than failing.
 */
export const loadPeople = memoizeAsync(
  async (): Promise<Map<string, Person>> => {
    const people = await dataSource.loadOptionalArray<Person>("people");
    return new Map(
      people
        .filter((person) => !person.deleted)
        .map((person) => [person.id, person]),
    );
  },
);

export const loadMemberships = memoizeAsync(async (): Promise<Membership[]> => {
  const memberships =
    await dataSource.loadOptionalArray<Membership>("memberships");
  return memberships.filter((membership) => !membership.deleted);
});

/** The curated faction mapping is shipped with the viewer, not the mirror. */
export const loadFactionMembers = memoizeAsync(
  async (): Promise<FactionMemberIndex> => {
    const index = factionMemberIndex as FactionMemberIndex;
    if (index.version !== FACTION_MEMBER_INDEX_VERSION) {
      throw new Error(
        `Unsupported faction member index version: ${String(index.version)} (expected ${FACTION_MEMBER_INDEX_VERSION})`,
      );
    }
    return index;
  },
);

/** Mandate holders of one body on `day` (default: today in Karlsruhe). */
export async function resolveBodyMembers(
  organizationId: string,
  day: string = getBerlinCalendarDate(),
): Promise<ResolvedMembership[]> {
  const [memberships, peopleById] = await Promise.all([
    loadMemberships(),
    loadPeople(),
  ]);
  return selectBodyMembers(memberships, organizationId, peopleById, day);
}

export async function getCouncilSeatsByFaction(
  day: string = getBerlinCalendarDate(),
): Promise<FactionSeatCount[]> {
  return countSeatsByFaction(await loadFactionMembers(), day);
}

export async function resolvePersonFaction(
  person: Person,
  day: string = getBerlinCalendarDate(),
): Promise<FactionMember | undefined> {
  return findFactionMember(await loadFactionMembers(), person.id, day);
}

// --- Per-paper resolvers ---

function resolveEntityIds<T>(
  ids: readonly string[] | null | undefined,
  entitiesById: Map<string, T>,
): T[] {
  return (ids ?? [])
    .map((id) => entitiesById.get(id))
    .filter((entity): entity is T => entity !== undefined);
}

export async function resolveOrganizations(
  paper: Paper,
): Promise<Organization[]> {
  const organizationsById = await loadOrganizations();
  return resolveEntityIds(paper.underDirectionOf, organizationsById);
}

export async function resolvePaperSubmitters(
  paper: Paper,
): Promise<ResolvedPaperSubmitter[]> {
  const index = await loadPaperSubmitters();
  const recordId = getOParlEntityId(paper.id);
  if (!recordId) return [];

  return (index.papers[recordId] ?? []).flatMap((factionId) => {
    const name = index.factions[factionId];
    if (!name) return [];
    // Hidden factions still get credited — they just have no page to link to.
    return [isHiddenSubmitterId(factionId) ? { name } : { name, factionId }];
  });
}

/** Includes joint submissions, which `resolvePaperSubmitters` can't reveal for the hidden AfD. */
export async function isPaperSubmittedByAfd(paper: Paper): Promise<boolean> {
  const index = await loadPaperSubmitters();
  const recordId = getOParlEntityId(paper.id);
  return recordId ? (index.papers[recordId] ?? []).includes("afd") : false;
}

export async function resolveMeetingOrganizations(
  meeting: Meeting,
): Promise<Organization[]> {
  const organizationsById = await loadOrganizations();
  return resolveEntityIds(meeting.organization, organizationsById);
}

export async function resolveConsultations(
  paper: Paper,
): Promise<ResolvedConsultation[]> {
  const meetingsById = await loadMeetings();
  return (paper.consultation || []).map((consultation) => {
    const meeting = meetingsById.get(consultation.meeting);
    const agendaItem = meeting?.agendaItem?.find(
      (item) => item.id === consultation.agendaItem,
    );
    return { consultation, meeting, agendaItem };
  });
}

export async function resolveAuxiliaryFiles(
  paper: Paper,
): Promise<ResolvedAuxiliaryFile[]> {
  const fileContentsById = await loadFileContents();
  return (paper.auxiliaryFile || []).map((auxiliaryFile) => ({
    file: auxiliaryFile,
    content: fileContentsById.get(auxiliaryFile.id),
  }));
}

/**
 * Summaries live in `summaries/papers/<numeric paper id>.json` and are being
 * backfilled, so only a subset of papers has one and the directory may be
 * absent entirely. Keying by each summary's own `id` (the full paper URL)
 * tolerates numeric file names that repeat across paper id namespaces
 * (`.../papers/vo/1` vs `.../papers/ag/1`).
 */
export const loadPaperSummaries = memoizeAsync(
  async (): Promise<Map<string, PaperSummary>> => {
    const summaries =
      await dataSource.loadDirectory<PaperSummary>("summaries/papers");
    return new Map(summaries.map((summary) => [summary.id, summary]));
  },
);

export async function resolvePaperSummary(
  paper: Paper,
): Promise<PaperSummary | undefined> {
  const summariesByPaperId = await loadPaperSummaries();
  return summariesByPaperId.get(paper.id);
}

/**
 * Which generated previews `digests/meetings/` held at build time, keyed by the
 * meeting's OParl entity id. Only the lead times are kept: the preview text
 * itself is fetched in the browser, so building it in would put ~3 kB of prose
 * into a page that already links everything it summarizes.
 *
 * The directory is absent until the scraper has run with previews enabled, and
 * `loadDirectory` answers that with `[]`.
 */
export const loadMeetingDigestLeads = memoizeAsync(
  async (): Promise<Map<string, MeetingDigestLead[]>> => {
    const digests =
      await dataSource.loadDirectory<MeetingDigest>("digests/meetings");
    const leadsByMeetingId = new Map<string, MeetingDigestLead[]>();
    for (const digest of digests) {
      if (!MEETING_DIGEST_LEADS.includes(digest.lead)) continue;
      const meetingId = getOParlEntityId(digest.meetingId);
      if (!meetingId) continue;
      const leads = leadsByMeetingId.get(meetingId) ?? [];
      if (!leads.includes(digest.lead)) leads.push(digest.lead);
      leadsByMeetingId.set(meetingId, leads);
    }
    return leadsByMeetingId;
  },
);

export async function resolveMeetingDigestLeads(
  meeting: Meeting,
): Promise<MeetingDigestLead[]> {
  const leadsByMeetingId = await loadMeetingDigestLeads();
  return leadsByMeetingId.get(getOParlEntityId(meeting.id)) ?? [];
}

const loadPapersById = memoizeAsync(async (): Promise<Map<string, Paper>> => {
  const papers = await loadPapers();
  return new Map(papers.map((paper) => [paper.id, paper]));
});

const loadPapersByRecordId = memoizeAsync(async () => {
  const papers = await loadPapers();
  return new Map(papers.map((paper) => [getOParlEntityId(paper.id), paper]));
});

const loadPaperSimilarity = memoizeAsync(async () => {
  return dataSource.loadOptionalObject<PaperSimilarityIndex>("paper-similar");
});

const loadPapersByConsultationId = memoizeAsync(
  async (): Promise<Map<string, Paper>> => {
    const papers = await loadPapers();
    return new Map(
      papers.flatMap((paper) =>
        (paper.consultation ?? []).map(
          (consultation) => [consultation.id, paper] as const,
        ),
      ),
    );
  },
);

export async function resolveMeetingAgenda(
  meeting: Meeting,
): Promise<ResolvedAgendaItem[]> {
  const papersByConsultationId = await loadPapersByConsultationId();
  return (meeting.agendaItem ?? [])
    .filter((agendaItem) => agendaItem.public !== false)
    .sort((left, right) => left.order - right.order)
    .map((agendaItem) => ({
      agendaItem,
      paper: agendaItem.consultation
        ? papersByConsultationId.get(agendaItem.consultation)
        : undefined,
    }));
}

export async function resolveRelatedPapers(paper: Paper): Promise<{
  superordinated: Paper[];
  subordinated: Paper[];
  similar: Paper[];
}> {
  const [papersById, papersByRecordId, similarity] = await Promise.all([
    loadPapersById(),
    loadPapersByRecordId(),
    loadPaperSimilarity(),
  ]);

  return {
    superordinated: resolveEntityIds(paper.superordinatedPaper, papersById),
    subordinated: resolveEntityIds(paper.subordinatedPaper, papersById),
    similar: selectSimilarPapers(
      paper,
      similarity?.papers[getOParlEntityId(paper.id)],
      papersByRecordId,
    ),
  };
}
