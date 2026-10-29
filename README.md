# GemeinderatsRadar

GemeinderatsRadar is an Astro static site that makes Karlsruhe council papers easier to browse and search.  
It builds from an OParl-based JSON mirror and publishes to GitHub Pages.

## Live Site

[https://maxliesegang.github.io/karlsruhe-oparl-viewer/](https://maxliesegang.github.io/karlsruhe-oparl-viewer/)

## What It Does

- Full-text search on the landing page via Pagefind (German UI copy).
- Browse papers on one page (`/vorlagen`) with a year filter (`?year=YYYY`).
- Browse papers by district (`/stadtteile`, `/stadtteil/[name]`).
- Filter list pages by year, type, organization, role, result, and mentioned district.
- Open paper detail pages with key metadata, consultations, and auxiliary files.
- Follow paper status, decisions, and related-paper chains.
- Browse upcoming meetings and public agendas.
- Subscribe to updates by committee or district through feeds.
- Download an individual meeting as an `.ics` calendar event.
- See new and updated results for saved searches since they were last opened.

## Stack

- Astro 7.1 (`astro build`, static output)
- TypeScript (strict via `astro/tsconfigs/strict`)
- Pagefind with a custom lean indexing integration
- Prettier 3 + `prettier-plugin-astro`
- npm (`package-lock.json` is authoritative)

## Requirements

- Node.js 24.x recommended
- npm
- A local checkout of the council data (created by `npm run data:setup`)

## Local Development

```bash
npm ci
npm run data:setup # shallow-clone the current shard-based data store once
npm run dev
```

Dev server: [http://localhost:4321](http://localhost:4321)

Build and preview:

```bash
npm run build:quiet
npm run build:verify
npm run preview
```

Fast validation build (skips Pagefind indexing):

```bash
npm run build:quick:quiet
```

### Quiet Builds

The site generates ~30,000 pages and `astro build` logs one line per page, so a
normal build emits ~30,000 lines (~1.5 MB) of scrollback. The quiet variants
filter those per-page lines and keep the summary, warnings, errors, and exit
code:

```bash
npm run build:quiet       # full build, ~20 lines of output
npm run build:quick:quiet # skips Pagefind — fastest validation
```

Both wrap `astro build` via `scripts/build-quiet.mjs`. Extra flags are forwarded
(`npm run build:quiet -- --verbose`). Production uses the full quiet build and
then runs `npm run build:verify`, which requires the Pagefind bundle and enforces
an 850 MiB published-size budget.

The upstream repository stores papers and meetings as individual JSON files in
`docs/papers/` and `docs/meetings/`; the former aggregate files no longer exist.
`npm run data:setup` clones that repository into the ignored
`syndication-data/` directory. To refresh it later, run
`git -C syndication-data pull --ff-only`.

Format:

```bash
npm run format
```

## Routes

- `/` -> search page
- `/vorlagen` -> papers list with filters (including `year` query param)
- `/vorlagen{year}` -> legacy redirect to `/vorlagen?year={year}`
- `/vorlagen/[reference]` -> paper details
- `/sitzungen` -> upcoming meetings and public agenda status
- `/sitzungen/[id]` -> meeting details and public agenda
- `/sitzungen/kalender/[id].ics` -> single-meeting calendar download
- `/feeds` -> update feeds by committee and district
- `/stadtteile` -> district overview
- `/stadtteil/[name]` -> papers for one district
- `/vorlage/[reference]` -> legacy redirect to `/vorlagen/[reference]`

## Data Flow

Local and production builds read the shard directories from
`syndication-data/docs`. The deployment workflow checks out the data repository
there before building. Key implementation points:

- The data root is the checkout at `syndication-data/docs`, overridable with `DATA_LOCAL_DIR`.
- Fetching/caching lives in `src/shared/data.ts` (module-scoped caches).
- `routeReference` is derived from `paper.reference` by replacing `/` with `-`.
- Year bucketing uses `getPaperYear()` with bulk-import handling (`BULK_MODIFIED_DATE = "2025-03-03"`).
- File content text is loaded concurrently from `file-contents/`.
- District counts are derived and cached via `getPaperCountsByDistrict()`.

There is no network data path: `src/shared/data-source.ts` reads the checkout
only. Shard directories have no index file, so records are discovered by
enumerating the directory.

## Architecture Notes

- `src/layouts/Layout.astro` provides page shell and global styles.
- `src/components/SiteNavigation.astro` owns nav markup/styles/mobile behavior.
- `src/components/PaperListPage.astro` + `src/components/PageContainer.astro` are shared list-page wrappers.
- `src/components/SearchPanel.astro` is the one search-and-browse UI (home, district and faction pages).
- `src/components/FilterSelect.astro` renders each filter dropdown.
- `src/shared/search-panel-controller.ts` runs Pagefind queries, renders result cards in batches, and syncs URL state.
- `src/shared/search-state.ts` defines the normalized search state (text, filters, sort) shared by URLs and saved searches.
- `src/shared/search-index.ts` builds per-paper filter values and options for the Pagefind index. See [SEARCH.md](SEARCH.md).

## Deployment

GitHub Pages deployment is configured in `.github/workflows/deploy.yml`:

- On push to `main`
- On schedule at `03:17` and `15:17` UTC
- Scheduled runs skip checkout/build/deploy when the viewer and data revisions
  were already deployed successfully
- Resolves and checks out one exact council-data revision
- Uses Node 24, `npm ci`, `npm run build:quiet`, output verification, and
  `actions/deploy-pages@v5`
- Cancels superseded builds while allowing an active deployment to finish

Do not commit generated output (`dist/`).

## Contributing

1. Create a feature branch.
2. Keep links base-aware with `import.meta.env.BASE_URL`.
3. Run `npm run format`.
4. Run `npm run build:quiet` if you touched page/data logic.
5. Run `npm run build:verify` after a full build when output or indexing changed.

## License

[MIT](LICENSE)
