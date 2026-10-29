import {
  getAvailablePaperSubmitters,
  loadMeetings,
  loadOrganizations,
  loadPaperSubmitters,
} from "./data";
import { getPaperDetailStaticPaths } from "./paper-detail-paths";
import { calendarDate, committeeKey, referenceKey } from "./search-state";
import { getOParlEntityId } from "./utils";

import { publicCommitteeIds } from "./public-consultations";
let promise: ReturnType<typeof buildSearchIndex> | undefined;
async function buildSearchIndex() {
  const [paths, meetings, organizations, submitters, factions] =
    await Promise.all([
      getPaperDetailStaticPaths(),
      loadMeetings(),
      loadOrganizations(),
      loadPaperSubmitters(),
      getAvailablePaperSubmitters(),
    ]);
  const visible = new Set(factions.map((f) => f.id));
  const records = new Map(
    paths.map(({ props: { paper } }, rank) => [
      paper.id,
      {
        rank,
        date: calendarDate(paper.date),
        reference: referenceKey(paper.reference),
        district: paper.stadtteile,
        faction: (submitters.papers[getOParlEntityId(paper.id)] ?? []).filter(
          (id) => visible.has(id),
        ),
        committee: publicCommitteeIds(paper, meetings, organizations),
        type: paper.paperType,
      },
    ]),
  );
  const committees = new Set([...records.values()].flatMap((r) => r.committee));
  // Filters and URLs carry the short key; the registry still supplies names.
  for (const record of records.values())
    record.committee = record.committee.map(committeeKey);
  return {
    records,
    options: {
      district: [
        ...new Set([...records.values()].flatMap((r) => r.district)),
      ].sort(),
      faction: factions.map((f) => ({ value: f.id, label: f.name })),
      committee: [...committees]
        .map((id) => ({
          value: committeeKey(id),
          label: organizations.get(id)!.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "de")),
      type: [...new Set([...records.values()].map((r) => r.type))]
        .filter(Boolean)
        .sort(),
    },
  };
}
export function loadSearchIndex() {
  return (promise ??= buildSearchIndex());
}
