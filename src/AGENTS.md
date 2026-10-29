# Agent Guide — `src/`

Source root. See sub-directory guides for focused documentation:

- [`src/pages/`](pages/) — route entrypoints
- [`src/components/`](components/) — UI components
- [`src/shared/`](shared/) — data, filters, types, utilities
- [`src/layouts/Layout.astro`](layouts/Layout.astro) — global page shell

## Pages & Routing

Route entrypoints in `src/pages/`. Each file maps to a URL path.

| File                                  | URL                            | Notes                                        |
| ------------------------------------- | ------------------------------ | -------------------------------------------- |
| `pages/index.astro`                   | `/`                            | Search page (Pagefind)                       |
| `pages/suche.astro`                   | `/suche`                       | Legacy redirect to home                      |
| `pages/vorlagen.astro`                | `/vorlagen`                    | Legacy redirect to home                      |
| `pages/vorlagen[year].astro`          | `/vorlagen{year}`              | Legacy redirect → home with paper-date range |
| `pages/vorlagen/[reference].astro`    | `/vorlagen/[reference]`        | Paper detail page                            |
| `pages/stadtteile.astro`              | `/stadtteile`                  | District overview                            |
| `pages/stadtteil/[name].astro`        | `/stadtteil/[name]`            | Papers for one district                      |
| `pages/fraktionen.astro`              | `/fraktionen`                  | Submitter faction overview                   |
| `pages/fraktion/[name].astro`         | `/fraktion/[name]`             | Papers by submitter faction                  |
| `pages/vorlage/[reference].astro`     | `/vorlage/[reference]`         | Legacy redirect → `/vorlagen/[reference]`    |
| `pages/gespeicherte-suchen.astro`     | `/gespeicherte-suchen`         | Saved searches                               |
| `pages/feeds.astro`                   | `/feeds`                       | Feeds by committee and district              |
| `pages/sitzungen.astro`               | `/sitzungen`                   | Upcoming meetings (default meeting view)     |
| `pages/sitzungen/archiv.astro`        | `/sitzungen/archiv`            | Archive overview — years + latest sittings   |
| `pages/sitzungen/archiv/[jahr].astro` | `/sitzungen/archiv/[jahr]`     | Past meetings of one calendar year           |
| `pages/sitzungen/[id].astro`          | `/sitzungen/[id]`              | Meeting details and public agenda            |
| `pages/sitzungen/kalender/[id].ts`    | `/sitzungen/kalender/[id].ics` | Single-meeting calendar download             |
| `pages/sitzungen/kalender.ics.ts`     | `/sitzungen/kalender.ics`      | Subscribable feed: upcoming + last 30 days   |

> **Note:** Do not place non-`.astro` files directly inside `src/pages/` — Astro will try to render them as routes.

## URL Contracts

- **All internal hrefs** must be prefixed with `import.meta.env.BASE_URL` (required for GitHub Pages subpath)
- **`routeReference`** — a paper's URL slug is `paper.reference.replaceAll("/", "-")`. This mapping is stable; changing it breaks existing URLs. It is computed in `src/shared/data.ts` and mapped in `src/shared/paper-detail-paths.ts`

## Legacy Redirects

Use `LegacyRedirectPage` (`src/components/LegacyRedirectPage.astro`) for any route that only exists to forward old URLs. It sets `noindex` automatically.

Current legacy routes: `pages/vorlagen[year].astro` and `pages/vorlage/[reference].astro`.

## Adding New Pages

- Reuse `Layout` (shell), `PageContainer` (width), and `PaperListPage` (list skeleton) from `src/components/`
- Keep labels and copy in German
- If the page hosts an interactive list, wrap it with `data-pagefind-ignore`
- Meeting pages are excluded from Pagefind so search and saved-search freshness remain paper-only

## Meeting Views

`/sitzungen` (upcoming) and `/sitzungen/archiv` (past) are two views of the same
data, linked by `MeetingViewTabs`. Upcoming stays the entry point — the archive
is one click away and never the default. Year pages are derived from
`getPastMeetings()`; each holds at most ~190 meetings, so no pagination is
needed. Past meeting detail pages breadcrumb back through their archive year.

A sitting detail page also carries a generated preview (`MeetingDigest.astro`),
but only as an empty shell — the text is fetched from the mirror in the browser,
because previews are written one to seven days before a sitting and would
otherwise be stale between deploys. See `src/components/AGENTS.md`.
