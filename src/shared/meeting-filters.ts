import {
  buildMeetingMonthOptions,
  getMeetingMonth,
  hasMeetingProtocol,
} from "./meeting-archive";
import { parseOrtschaftName } from "./meeting-presentation";
import {
  MEETING_BODY_TYPES,
  type MeetingBodyType,
  type MeetingFilterOptions,
  type MeetingFilterValues,
  type Meeting,
  type Organization,
} from "./types";

export const UNKNOWN_MEETING_ORGANIZATION = "Keine Angabe";

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function resolveOrganizationNames(
  meeting: Meeting,
  organizationsById: Map<string, Organization>,
): string[] {
  return uniqueNonEmpty(
    (meeting.organization ?? []).flatMap((organizationId) => {
      const name = organizationsById.get(organizationId)?.name;
      return name ? [name] : [];
    }),
  );
}

function classifyOrganization(name: string): MeetingBodyType {
  const normalizedName = name.toLocaleLowerCase("de-DE");

  if (normalizedName.includes("gemeinderat")) return "Gemeinderat";
  if (normalizedName.includes("ortschaftsrat")) return "Ortschaftsrat";
  if (normalizedName.includes("ausschuss")) return "Ausschuss";
  if (normalizedName.includes("beirat")) return "Beirat";
  return "Sonstiges";
}

function getBodyTypes(
  meeting: Meeting,
  organizationNames: string[],
): MeetingBodyType[] {
  const sourceNames =
    organizationNames.length > 0 ? organizationNames : [meeting.name];
  const bodyTypes = uniqueNonEmpty(sourceNames).map(classifyOrganization);
  return MEETING_BODY_TYPES.filter((bodyType) => bodyTypes.includes(bodyType));
}

function getDistricts(organizationNames: string[]): string[] {
  return uniqueNonEmpty(organizationNames.map(parseOrtschaftName));
}

export function getPublicAgendaCount(meeting: Meeting): number {
  return (meeting.agendaItem ?? []).filter((item) => item.public !== false)
    .length;
}

function getSearchText(
  meeting: Meeting,
  organizationNames: string[],
  location: string,
  districts: string[],
): string {
  return [meeting.name, ...organizationNames, ...districts, location]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("de-DE");
}

/** Build filter values once during the static build; the browser only matches these values. */
export function buildMeetingFilterModel(
  meetings: Meeting[],
  organizationsById: Map<string, Organization>,
): {
  valuesById: Record<string, MeetingFilterValues>;
  options: MeetingFilterOptions;
} {
  const valuesById: Record<string, MeetingFilterValues> = {};
  const bodyTypeSet = new Set<MeetingBodyType>();
  const organizationSet = new Set<string>();
  const districtSet = new Set<string>();

  for (const meeting of meetings) {
    const resolvedOrganizationNames = resolveOrganizationNames(
      meeting,
      organizationsById,
    );
    const organizationValues =
      resolvedOrganizationNames.length > 0
        ? resolvedOrganizationNames
        : [UNKNOWN_MEETING_ORGANIZATION];
    const districts = getDistricts(resolvedOrganizationNames);
    const location = meeting.location?.description?.trim() ?? "";
    const bodyTypes = getBodyTypes(meeting, resolvedOrganizationNames);
    const publicAgendaCount = getPublicAgendaCount(meeting);

    const filterValues: MeetingFilterValues = {
      bodyTypes,
      organizations: organizationValues,
      organizationLabel: organizationValues.join(", "),
      districts,
      location,
      searchText: getSearchText(
        meeting,
        resolvedOrganizationNames,
        location,
        districts,
      ),
      publicAgendaCount,
      month: getMeetingMonth(meeting.start),
      hasProtocol: hasMeetingProtocol(meeting),
    };

    valuesById[meeting.id] = filterValues;
    bodyTypes.forEach((bodyType) => bodyTypeSet.add(bodyType));
    organizationValues.forEach((organization) =>
      organizationSet.add(organization),
    );
    districts.forEach((district) => districtSet.add(district));
  }

  return {
    valuesById,
    options: {
      bodyTypes: MEETING_BODY_TYPES.filter((bodyType) =>
        bodyTypeSet.has(bodyType),
      ),
      organizations: [...organizationSet].sort((left, right) =>
        left.localeCompare(right, "de-DE"),
      ),
      districts: [...districtSet].sort((left, right) =>
        left.localeCompare(right, "de-DE"),
      ),
      months: buildMeetingMonthOptions(meetings),
    },
  };
}
