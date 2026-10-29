import type { Paper, Meeting, Organization } from "./types";
/** Same public rule as resolveMeetingAgenda: an existing agenda item not explicitly private. */
export function publicCommitteeIds(
  paper: Paper,
  meetings: Map<string, Meeting>,
  organizations: Map<string, Organization>,
): string[] {
  return [
    ...new Set(
      (paper.consultation ?? []).flatMap((c) => {
        const meeting = meetings.get(c.meeting);
        const item = meeting?.agendaItem?.find(
          (item) => item.id === c.agendaItem,
        );
        if (!item || item.public === false) return [];
        return [
          ...(c.organization ?? []),
          ...(meeting?.organization ?? []),
        ].filter((id) => organizations.has(id));
      }),
    ),
  ];
}
