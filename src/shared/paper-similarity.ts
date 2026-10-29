import type { Paper } from "./types/paper.ts";

/** Keep every upstream recommendation in rank order, excluding duplicate destinations and explicit relations. */
export function selectSimilarPapers(
  paper: Paper,
  recommendations: readonly string[] = [],
  papersByRecordId: ReadonlyMap<string, Paper>,
): Paper[] {
  const excludedIds = new Set([
    paper.id,
    ...(paper.superordinatedPaper ?? []),
    ...(paper.subordinatedPaper ?? []),
  ]);
  const seenRoutes = new Set([paper.routeReference]);
  const selected: Paper[] = [];

  for (const recordId of recommendations) {
    const candidate = papersByRecordId.get(recordId);
    if (
      !candidate ||
      candidate.deleted ||
      excludedIds.has(candidate.id) ||
      seenRoutes.has(candidate.routeReference)
    ) {
      continue;
    }
    seenRoutes.add(candidate.routeReference);
    selected.push(candidate);
  }

  return selected;
}
