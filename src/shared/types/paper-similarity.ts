/** Optional mirror artifact: any number of record basenames, strongest first. */
export interface PaperSimilarityIndex {
  /** Upstream scoring revisions do not change how the viewer reads the list. */
  version: number;
  papers: Record<string, string[] | undefined>;
}
