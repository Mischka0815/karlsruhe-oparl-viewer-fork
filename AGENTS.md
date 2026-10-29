# Agent Guide — GemeinderatsRadar (updated Aug 2026)

## Project Snapshot

- **Name:** GemeinderatsRadar (`karlsruhe-oparl-viewer`)
- **Purpose:** Static Astro site for browsing Karlsruhe council papers from an OParl JSON mirror
- **Stack:** Astro 7.4.x, TypeScript strict, Node 26.x, npm with `package-lock.json`
- **Formatting:** Prettier 3 + `prettier-plugin-astro` (`npm run format`)
- **Hosting:** GitHub Pages via `.github/workflows/deploy.yml`

## Run Book

```
npm ci                    # install (preferred over npm install)
npm run dev               # dev server → http://localhost:4321
npm run build:quiet       # ← use this one: full build, per-page log lines filtered
npm run build:quick:quiet # quiet + no Pagefind (fastest validation)
npm run build:verify      # verify Pagefind output and the 850 MiB size budget
npm run build             # full build incl. Pagefind index → dist/ (~30k log lines)
npm run build:quick       # fast build, skips Pagefind (SKIP_PAGEFIND=1)
npm run preview           # preview built site
npm run format            # Prettier
npm test                  # node --test over tests/ — pure logic, no build needed
```

**Always prefer `build:quiet` over `build`.** The site generates ~30,000 pages
and `astro build` logs one line per page: ~30,000 lines / 1.5 MB (~370k tokens)
per run, of which ~17 lines carry information. `build:quick` does _not_ help —
`SKIP_PAGEFIND=1` only skips indexing, the per-page logging is identical.
`build:quiet` (`scripts/build-quiet.mjs`) drops those lines, keeps the summary,
errors, and exit code, and reports how many lines it suppressed.

Do **not** edit generated artifacts: `dist/`, `.astro/`, `node_modules/`.

## Astro Upgrade Steps

1. `npm outdated --long` — check what's behind
2. Read the Astro release notes for the target version
3. `npx @astrojs/upgrade` — run the official upgrader
4. `npm outdated --long` — verify dependency state
5. Validate both build paths: `npm run build:quick:quiet` then `npm run build:quiet`
6. Commit `package.json` and `package-lock.json` together

> When touching env flags, cast `import.meta.env.*` before string operations
> and prefer explicit checks such as `=== "true"` or `=== "1"`.

## Deployment

- Workflow: `.github/workflows/deploy.yml`
- Triggers: push to `main`; scheduled 03:17 and 15:17 UTC
- Uses explicit Node/npm/build/upload steps + `actions/deploy-pages@v5`
- Deploy runs `npm run build:quiet` and verifies Pagefind plus an 850 MiB size budget
- **Never commit `dist/`**

### Published Size Budget

GitHub Pages caps a published site at **1 GB**, and this one grows with every
council session, so `dist/` size is a standing constraint rather than a
one-time cleanup. Current build: **488 MiB apparent size**, down from roughly
772 MiB before extracted text is stripped.

The largest single lever is already pulled: `integrations/pagefind-lean.mjs`
indexes extracted PDF text but keeps it out of the deployed HTML (281.9 MiB
stripped from 13,576 of 30,151 pages), and the browser re-fetches it from the
mirror on demand. See `src/components/AGENTS.md` for the markup contract that
makes this work — and note that the mirror is a _separate_ Pages site, so it
must stay published.

Remaining known headroom, largest first: `data-astro-cid-*` scoping attributes
(~50 MB, up to 27% of `sitzungen/` HTML — eliminated by moving a component's
`<style>` into a global stylesheet, **not** by `scopedStyleStrategy`, which
measured at only ~3 MB); and the 13.7k `dist/vorlage/*.html` legacy redirect
files (~21 MiB), replaceable by one `404.html` handler.

## Search Engine Indexing

The site is fully crawlable — static HTML, no `noindex`, no auth — so nothing
_blocks_ indexing. What was missing was discoverability, now covered by:

- `@astrojs/sitemap` → `dist/sitemap-index.xml` (~16.4k URLs). The filter in
  `astro.config.mjs` keeps out the `/vorlage/` legacy stubs and the two
  client-only pages; `serialize` strips the `.html` that `build.format: "file"`
  would otherwise advertise, so sitemap URLs match the canonicals byte for byte
- `Layout.astro` emits `description`, `canonical`, Open Graph, and optional
  `noindex` / JSON-LD per page. Descriptions come from `src/shared/seo.ts`;
  paper pages prefer the generated summary over the bibliographic fallback
- Structured data: `WebSite` + `SearchAction` on the home page,
  `LegislativeDocument` on papers, `Event` on meetings

Cost of the head metadata: **+25 MiB** across 30k pages (488 → 513 MiB), which
is why `twitter:*` is reduced to `twitter:card` — X falls back to `og:*`.

### Two things this repo cannot fix on its own

1. **`robots.txt` is ignored.** Crawlers read it only from an origin root, i.e.
   `https://maxliesegang.github.io/robots.txt`, which belongs to the
   `maxliesegang.github.io` user-pages repo. `public/robots.txt` is published at
   `/karlsruhe-oparl-viewer/robots.txt` and takes effect only after a move to a
   custom domain.
2. **Search Console has to be set up by hand.** Verify the URL-prefix property
   `https://maxliesegang.github.io/karlsruhe-oparl-viewer/` (the HTML-file
   method works — drop the file in `public/`), then submit the sitemap.

Every meeting page is now browsable: `/sitzungen` lists the upcoming ones and
`/sitzungen/archiv` the ~2.5k past ones, split into one page per calendar year
(~27 pages, ~3 MiB total).

## Common Pitfalls

- Builds fail unless `syndication-data/docs` exists (`npm run data:setup`); there is no network fallback
- Missing `BASE_URL` prefixes break GitHub Pages subpath routing
- Astro upgrades can expose implicit `import.meta.env` type assumptions — cast before calling string methods

### Output-Volume Traps

`dist/` (~48k files, 488 MiB) and `syndication-data/` (~93k files, 773 MB) are
gitignored, so Grep and Glob correctly ignore them — the searchable source tree
is ~80 files. Bash and Read do **not** consult `.gitignore`, so these still bite:

- `npm run build` — see the Run Book; use `build:quiet`
- **Never read `dist/vorlagen.html`** — it is a single ~11 MB file
- Do not `ls`/`find` inside `syndication-data/docs/file-contents/` (76k files) or
  `syndication-data/docs/papers/` (14k files) without a `head`/`-name` filter
- Inspect data shape from one shard file (~4–9 KB each), not from a directory listing

## Sub-directory Guides

Focused documentation lives closer to the code it describes:

- [`src/AGENTS.md`](src/AGENTS.md) — routing map, URL conventions, legacy redirects, pages overview
- [`src/components/AGENTS.md`](src/components/AGENTS.md) — component catalog, reuse patterns, Pagefind/filter contracts
- [`src/shared/AGENTS.md`](src/shared/AGENTS.md) — data flow, loaders, filter derivation, type extensions
