# Agent Guide — `src/shared/`

Data fetching, caching, filtering logic, utilities, and TypeScript types.

## Key Files

| File                            | Role                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `constants.ts`                  | `BULK_MODIFIED_DATE`, `SYNDICATION_BASE_URL`             |
| `file-text-loader.ts`           | Fetches extracted PDF text when a disclosure is opened   |
| `data-source.ts`                | Reads the local data checkout (single files and shards)  |
| `data.ts`                       | All build-time loaders, caches, and entity resolvers     |
| `search-index.ts`               | Canonical paper filter values and options                |
| `paper-grouping.ts`             | Paper list ordering and date-group headings              |
| `paper-status.ts`               | Consultation ordering, process status + its consultation |
| `meeting-filters.ts`            | Canonical organization-based meeting filter model        |
| `meeting-filter-definitions.ts` | Meeting filter IDs, URL parameters, and option sets      |
| `meeting-filter-controller.ts`  | Client-side meeting filtering and URL synchronization    |
| `meeting-presentation.ts`       | Display name, month groups, row date/time for meetings   |
| `paper-presentation.ts`         | Hides import artifacts: bulk stamp, placeholder offices  |
| `paper-similarity.ts`           | Topical recommendations in mirror order                  |
| `paper-detail-paths.ts`         | Maps paper references to URL slugs                       |
| `meeting-paths.ts`              | Maps OParl meeting IDs to meeting detail routes          |
| `meeting-calendar.ts`           | Serializes one meeting as an RFC 5545 calendar event     |
| `meeting-digest.ts`             | Generated sitting previews: leads, record id, mirror URL |
| `meeting-digest-loader.ts`      | Fetches a sitting preview from the mirror in the browser |
| `syndication-feeds.ts`          | Feed catalog indexing, labels, and shared feed URL       |
| `utils.ts`                      | URL, date, and slug helpers                              |
| `pagefind-client.ts`            | Pagefind module loading, search types, freshness stats   |
| `pagefind-config.ts`            | Search panel selectors, sort presets, build-time flag    |
| `search-panel-controller.ts`    | Search box behaviour and result card rendering           |
| `saved-searches.ts`             | Saved search logic                                       |
| `types/`                        | All TypeScript type contracts                            |

## Data Flow

Optional paper change history is handled by `paper-history.ts` (public GitHub
requests and diffs), `paper-history-loader.ts` (paper revisions and historical
attachments), and `paper-document-history-loader.ts` (independent extracted-text
history). These are browser-only on-demand requests, not build-time data inputs.
Pagination pins its revision after the first page; snapshots are reused within
each view, and failed loads remain retryable. Text diff work and rendered
comparison size are bounded for large documents. See the component guide for
coverage and provenance constraints.

```
syndication-data/docs (data-source.ts, DATA_LOCAL_DIR)
  └─ data.ts (loaders, caches, resolvers)
       ├─ search-index.ts        ← builds canonical paper filter values/options
       ├─ meeting-filters.ts     ← builds canonical meeting filter values/options
       └─ paper-detail-paths.ts  ← maps reference → URL slug
```

- All data comes from a checkout of the syndication repository
  (`npm run data:setup`, and a sparse checkout in the deploy workflow). There is
  no network data path — per-record directories have no index file, so they
  cannot be discovered remotely
- The mirror publishes big entities as one JSON document per record
  (`papers/`, `meetings/`, `file-contents/`, `summaries/papers/`) and small ones
  as a single file (`organizations.json`, `paper-stadtteile.json`).
  `loadDirectory()` reads every JSON document in a directory and returns `[]`
  when it does not exist; `loadArray()` tries the single file first and falls
  back to `loadDirectory()`, erroring when neither layout yields records
- Files are read concurrently (`FILE_READ_CONCURRENCY = 64`, exported by
  `data-source.ts` so every bulk read shares one budget)
- District data: `paper-stadtteile.json` is versioned, keyed by paper record
  basename, and separates `primary` from `mentioned` matches. The viewer
  combines both for browsing and uses the published district registry so routes
  remain stable even when a district currently has no matches.
- The bulk import flattened `modified` onto `BULK_MODIFIED_DATE = "2025-03-03"`
  for ~87% of papers (12,228 of 14,004), so anything ordered or bucketed by
  `modified` must fall back to the paper's own `date`. `getPaperYear()` does
  this for the year filter; `paper-grouping.ts` does it for the list, which
  sorts by `comparePapersForList()` and groups genuine modifications by day
  ("Aktualisiert am …") and bulk-imported records by Vorlagendatum month
  ("Vorlage vom …"). Both keys must stay consistent or headings and the year
  filter disagree. The comparator orders groups by the last day they cover so
  each group stays contiguous — the client filter shows one heading per key
- Paper summaries (`summaries/papers/<numeric paper id>.json`) are LLM-generated
  by the scraper and backfilled over time, so most papers have none and every
  consumer must treat them as optional. `loadPaperSummaries()` keys the result
  by each summary's own `id`, which also guards against numeric file names
  repeating across paper namespaces (`vo/1` vs `ag/1`)
- Stable routing key: `paper.routeReference = paper.reference.replaceAll("/", "-")`
  — this mapping must remain stable or all detail page URLs break
- Optional `paper-similar.json` maps paper record basenames to ranked lists of
  recommended record basenames, strongest first. The viewer imposes no count
  limit or scoring-version lock; upstream controls both. `resolveRelatedPapers()`
  resolves these against active papers once per build through cached indexes;
  `selectSimilarPapers()` drops self-links, explicit parent/child relations,
  missing/deleted targets and duplicate destinations. No scores or reciprocal
  links are inferred. Older checkouts without the artifact render no suggestions.
- Feed metadata comes from `feed-index.json`; `loadSyndicationFeedCatalog()`
  indexes committee and district feeds for contextual links and `/feeds`
- Generated sitting previews (`digests/meetings/<meeting id>-<lead>.json`) are
  the one entity the build deliberately does **not** read into the page. The
  scraper writes them seven days and one day before a sitting — both of which
  fall between two deploys — so a built-in preview would be stale exactly while
  it is worth reading. The build reads the directory only for which lead times
  exist (`loadMeetingDigestLeads()`), and `meeting-digest-loader.ts` fetches the
  text itself. See `src/components/AGENTS.md` for the markup contract
- Extracted PDF text is the one value read from the mirror **twice**: at build
  time via `dataSource.loadText()` so Pagefind can index it, and again in the
  browser via `buildFileTextUrl()` after `integrations/pagefind-lean.mjs` strips
  it from the built HTML. Both must resolve the same document, so the file id
  (`getOParlEntityId()`) and the `file-contents/<id>.txt` layout are a shared
  contract — see `src/components/AGENTS.md`. Together with the sitting previews
  above, this is what the viewer needs the mirror to keep publishing at runtime;
  the loader degrades to an error message beside the still-working PDF download
  link

## Adding New Data Fields

1. Add/update the type in `types/`
2. Update the loader/resolver in `data.ts`
3. Surface the field in the relevant component or page

## Unified paper discovery

See [SEARCH.md](../../SEARCH.md) for the state, URL, Pagefind, date, public
consultation, saved-search migration, and freshness contracts. The former
paper filters/controller are replaced by `search-state.ts`, `search-index.ts`,
`public-consultations.ts`, and `search-panel-controller.ts`. Pagefind evaluates
all filters before pagination; no full archive is rendered into list pages.

Meeting filters retain their separate organization-based model.
