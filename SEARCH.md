# Unified discovery

Home, district, and faction pages use `SearchPanel` and the same normalized
`SearchState`. Scoped pages pin their district/faction from the path: the URL
does not repeat the scope, the filter count ignores it, its field is hidden in
the panel, and a non-removable `Nur …` chip names it. Saved links include that
scope explicitly and reopen at home. Back/Forward restores query, all filters,
and explicit sort. Typing pushes one history entry per typing session and
refines it in place; filter, sort, reset and chip changes each push one. Reset preserves text and page scope, clearing filters and
returning to automatic sorting. Automatic means relevance with text and recently
changed without it. Explicit relevance without text also uses recently changed.
No sort preference is stored globally.

`/suche` and `/vorlagen` preserve query parameters on their way home. Legacy
`/vorlagenYYYY` links go directly home with inclusive `from` and `to`. A legacy
`year=YYYY` is normalized to the same boundaries. This intentionally changes the
old mixed year semantics (genuine modification year, otherwise paper year): all
date restrictions now mean **paper.date**. Canonical paper routes and duplicate
reference selection continue to come from `getPaperDetailStaticPaths`.

## Index contract

Pagefind 1.5.2 was checked against the installed Node API declarations and its
versioned official documentation:

- https://pagefind.app/docs/js-api-filtering/ — null queries; AND across fields;
  `{any: [...]}` within a field.
- https://pagefind.app/docs/js-api-sorting/ — declared sort keys.
- https://pagefind.app/docs/api/ — lazy result fragments and metadata.

There is no documented date range operator. Each canonical paper gets indexed
calendar-date and categorical filter values. The client selects the eligible
calendar days from `pagefind.filters()` and passes them as an OR group. This
keeps filtering/counting/sorting over the complete corpus before loading any
result fragments. No companion metadata inventory or all-fragment download is
needed. Only 20 result fragments are fetched per requested batch. Filter values
and the numeric `changed` sort add no searchable text. Relevance/date blending
and the index-before-strip pipeline remain unchanged.

`changed` is the numeric rank of canonical records in the existing
`comparePapersForList` order, including its bulk-import month grouping. Cards
label bulk-import fallback dates as Vorlagendatum, never as a genuine update.
The normal newest-paper sort remains `date:desc`.

Committee membership requires a resolvable consultation meeting and agenda item
whose `public` flag is not false, matching `resolveMeetingAgenda`. It unions
consultation and meeting organization IDs, resolves names through the registry,
and never substitutes `underDirectionOf`. Districts preserve primary plus
mentioned enrichment. Factions use visible enriched submitter IDs and include
joint submissions. Reference lookup first checks an exact case-normalized
slash-to-hyphen key, preserving the existing route identity and duplicate policy.

Date boundaries compare the validated calendar-date portion of `paper.date`,
without converting it to the visitor's timezone. Invalid/missing dates are still
browsable but excluded by any active date restriction. Invalid ranges show an
accessible error. Unknown categorical choices are removed during normalization;
unknown parameters and obsolete sorts are ignored.

Saved records retain the existing localStorage key, query and checkpoint fields,
adding a full `state`. Old text-only entries migrate on read without moving the
checkpoint. Deduplication includes every filter and explicit sort; filter-only
searches are supported. Checkpoints advance only after the initial results batch
loads successfully (including successful empty results). Freshness uses a
separate indexed UTC day union of creation and genuine modification dates to
limit fragment fetching to potentially new/updated matches, then compares exact
timestamps. Bulk-import modification timestamps never count as updates. The
paper-date restriction and visible sort are applied independently.

Committee filters and URLs use a short key built from the last two segments of
the OParl organization ID (`gr-32130`, unique across the registry); older full
IDs in a URL normalize to the same key.

The compact next-meeting link is a single text line in the page intro. It uses the registry's Gemeinderat identity
`…/organizations/gr/32130`, not meeting-title matching, and formats Europe/Berlin.
The page carries the next three sessions; an inline script shows the first
that has not ended, so a stale build never advertises a past session.

## Validation on the local snapshot

`npm test` passes 51 tests. Both `build:quick:quiet` and `build:quiet` pass,
followed by `build:verify` and `test:search-index`. The production-index check
covers 13,765 canonical papers, bulk-aware ordering, a combined Klimaschutz /
Durlach / GRÜNE / paper-date query with 117 matches across multiple batches,
slash/hyphen reference lookup, a non-leading public committee, filter-only
freshness, and the PDF-only word `Modernisierungszuschuss` in `2026/0447`.

Published output is **498.0 MiB**, including **190.2 MiB** of Pagefind, within
the 850 MiB budget. The seven discovery filter indexes total **276,376 bytes**;
no additional metadata JSON is shipped. Their source markup adds approximately
**9.76 MiB** across detail pages. Removing the old rendered archive and scoped
lists offsets this cost; the final total is below the previously documented
513 MiB total (that historical figure is not a same-snapshot benchmark).

Chrome desktop and a 320 px responsive viewport were inspected. Legacy year
normalization, filter-only saving/reopening with the same count, refresh,
Back/Forward, and unavailable-index feedback were checked in the browser.
The mobile overflow found during inspection was corrected and rechecked.
Other browser engines and physical mobile devices were not tested.

## Compact result presentation

Cards read identity → what → who/where: a reference (stronger) and muted date
line above the title (the title stays first in the DOM and leads the link name),
then one text line (excerpt or summary, darker than metadata but softer than
body text), then a footer with districts as plain text and the originator as the
card's only pill. There are no paper-type badges. Without a faction,
Beschluss-/Informationsvorlagen and Offenlagen name their lead office
(`underDirectionOf`, labelled `Federführend` for assistive technology and in
the tooltip), which for these types is effectively the originator. Motions,
enquiries and budget motions never show it, since there the office only
handles the paper, and placeholder values (`_Fachbereich Datenübernahme`,
`Offen`) are skipped.
District lists show one or two names, otherwise only a count (`8 Stadtteile`),
because the alphabetical list has no ranking; the accessible label and tooltip
retain the full list and explain that it includes mentions. A numbered suffix
reference (`2022/0883/1`) adds a muted `Folgevorlage` with the base number in
its tooltip. The suffix does not reliably name the kind of paper (in the local
snapshot, 291 of 437 are Änderungs-/Ergänzungsanträge, but plain Anträge and
Beschlussvorlagen also occur), so no paper type is claimed. Long
titles are visually limited to three lines (four on phones), with their full
text retained for assistive technology and on the detail page.

Search excerpts are limited to two lines. `search-presentation.ts` identifies
a repeated title suffix and leading interface labels; the controller removes
that prefix while retaining Pagefind's escaped text and highlight markup. An
excerpt is shown only when a highlighted body match remains, and gets a leading
`…` when it opens lowercase or on punctuation. Because the two-line clamp
hid highlights on phones, the excerpt starts at most ~60 characters before its
first highlight. Otherwise (browsing, title-only or reference matches) the card
shows the start of the AI summary, if one exists, in the same muted line,
behind a small visible `KI` badge (read as "KI-Zusammenfassung") and a tooltip. It is read from the
fragment's indexed `content` after the `paper-summary` heading anchor, not from
a meta field: Pagefind also indexes meta values, so a `paper-summary` meta would
double the summary's ranking weight. Index contents, weights, result
eligibility, and ranking are unaffected.

The toolbar is one row: a filter disclosure button (`aria-expanded`, with an
active-filter count), the removable filter chips, and a labelled sort select.
Chips move to their own line on phones. The filter panel below spans the full
result width: Stadtteil, Fraktion, Gremium and Vorlagenart in two columns, then
the full-width date range. District, faction, committee and date carry short
hints linked via `aria-describedby` instead of a separate help disclosure.
The date range is one chip (`Vorlagendatum: 01.01.2024–31.12.2024`, or `ab`/`bis`)
and counts as one filter; chips and saved-search labels share the names in
`filterLabels`. Removing a chip moves focus to the next chip, else the previous
one, else the toggle. Date inputs wait for a four-digit year and a short pause
(or blur) before searching, and an invalid range marks both inputs
`aria-invalid` with an inline message.
Zurücksetzen appears only when a non-scope filter or explicit sort is set, and
moves focus to the filter toggle. On phones the submit button becomes an
icon-only button (results already update while typing). The sort select always shows the
effective order and offers Relevanz only when there is search text; the state
still distinguishes automatic and explicit choices, and an explicit choice
persists until reset.
Saved-search navigation lives in the site header; a quiet save action sits
beside the result count only when there is a search to save. Once the current
search is saved, the action becomes a `Gespeichert` link to the saved list and
receives focus; the count stays visible.

While new results load, the previous ones stay in place, dimmed via
`aria-busy`, instead of blanking the list. The visible status is not a live
region; a separate hidden one announces the count once typing settles, and
errors immediately. Errors offer an `Erneut versuchen` button (a failed bundle
load is retried, not served from cache), and a progress line (`20 von 117
angezeigt`) sits above `Weitere Treffer laden`. Form controls use 16px on phones
so iOS does not zoom on focus; the date inputs stack below 400px.

"Vorlagen" is the first main-navigation item and points home; the separate
`Suche` utility link is gone.
