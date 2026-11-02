# Konzept: Ausbau von GemeinderatsRadar zum Ratsanalyse-Werkzeug

Stand: 2. November 2026 · Referenz: https://dis.delphi.tools/

## 1. Ziel

GemeinderatsRadar soll vom **Dokumenten-Viewer** zu einem **Ratsanalyse-Werkzeug**
wachsen, das ungefähr den Funktionsumfang von dis.delphi.tools erreicht:
Personen, Abstimmungen, Reden, Statistik und eine Karte, alles verknüpft mit den
vorhandenen Vorlagen und Sitzungen.

Leitplanken, die aus diesem Repo kommen und bleiben sollen:

- **Statisch zuerst.** Die Seite bleibt eine Astro-Site auf GitHub Pages. Neue
  Daten kommen als vorberechnete JSON-Artefakte aus dem Daten-Mirror
  (`karlsruhe-oparl-syndication`), nicht aus einer eigenen Datenbank.
- **Größenbudget.** Pages erlaubt 1 GB, `build:verify` setzt 850 MiB, der Build
  liegt bei ~513 MiB. Jede neue Seitenfamilie braucht eine Größenabschätzung.
- **Neutralität und Kennzeichnung.** Alles, was ein Sprachmodell schätzt (Themen,
  Haltung, Tonlage), wird als Schätzung markiert, wie heute schon die
  Zusammenfassungen und `StadtteilHint`.

## 2. Funktionsvergleich

| Bereich                 | dis.delphi.tools                                                                                                            | GemeinderatsRadar heute                                            | Lücke    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| Volltextsuche Dokumente | Server-API, Facetten                                                                                                        | Pagefind, 5 Filter, gespeicherte Suchen                            | klein    |
| Suche über Entitäten    | Tabs: Dokumente, Sitzungen, Personen, Gremien, Reden, Abstimmungen                                                          | nur Vorlagen                                                       | mittel   |
| Sitzungskalender        | Monat / Woche / Liste, Tastaturnavigation                                                                                   | Liste kommend + Archiv nach Jahren, ICS                            | mittel   |
| Sitzungsdetail          | TOPs mit Ergebnis, Abstimmungsbalken, Reden je TOP, Navigation vorige/nächste Sitzung                                       | öffentliche Tagesordnung, Vorschau (Digest), ICS                   | groß     |
| Gremien                 | 38 Gremien, Mitglieder, Sitzverteilung, Kennzahlen                                                                          | nur als Filterwert                                                 | groß     |
| Personen                | Profile mit Fraktion, Rolle, Porträt                                                                                        | fehlt                                                              | groß     |
| Abstimmungen            | 713 namentliche Abstimmungen mit Einzelstimmen                                                                              | fehlt                                                              | groß     |
| Statistik               | Fraktionsdisziplin, Stimmverteilung, Übereinstimmungsmatrix, Abweichler                                                     | fehlt                                                              | groß     |
| Reden                   | Livestream-Transkripte, Redezeit vs. Sitzanteil, „gesagt vs. gestimmt“, Tonlage, wer über wen, typische Wörter, Lesbarkeit  | fehlt                                                              | sehr groß |
| Karte                   | Orte aus Dokumenten (Straße, Platz, Schule …) auf einer Karte, Zeitfilter                                                   | Stadtteil-Seiten ohne Karte                                        | mittel   |
| Themenkategorien        | z. B. „Bildung & Kultur“, „Finanzen & Haushalt“                                                                             | fehlt (Stadtteile ja)                                              | mittel   |
| Startseite              | Dashboard: letzte Sitzung, nächste Sitzung, diese Woche, neue Dokumente, Zahlen                                             | Suchseite                                                          | mittel   |
| Schnittstellen          | JSON-API, ICS je Gremium, MCP-Server                                                                                        | ICS, Feeds je Gremium/Stadtteil                                    | mittel   |

Was GemeinderatsRadar schon besser oder anders macht und behalten sollte:
Änderungshistorie von Vorlagen (`PaperHistory`), thematisch ähnliche Vorlagen,
Beratungsverlauf (`PaperTimeline`), gespeicherte Suchen mit „neu seit“, Feeds,
SEO und Sitemap.

## 3. Datenlage

Das ist der eigentliche Engpass. Die UI ist in jedem Fall machbar, die Frage ist,
woher die Daten kommen.

| Daten                     | Quelle                                                                                         | Im Mirror?  | Aufwand                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| Personen                  | OParl `bodies/0001/people` (geprüft: liefert Name, Anrede, Mitgliedschaften)                   | nein        | gering: Scraper um zwei Listen erweitern                   |
| Mitgliedschaften, Rollen  | OParl `bodies/0001/memberships`                                                                | nein        | gering                                                     |
| Wahlperioden              | OParl `legislativeTerm` (2024–2029 usw.)                                                       | nein        | gering                                                     |
| Protokolle je Sitzung     | OParl `meeting.verbatimProtocol` / `resultsProtocol`, Dateien unter `file-contents/`           | teilweise   | vorhanden, aber nicht ausgewertet                          |
| Beschlussergebnis je TOP  | OParl `agendaItem.result` bzw. Protokoll-Text                                                  | zu prüfen   | mittel                                                     |
| Namentliche Abstimmungen  | Abstimmungsanlagen / Protokolle des Gemeinderats (die Referenzseite nennt 713 Abstimmungen)    | nein        | hoch: PDF-Parsing, Namenszuordnung                         |
| Reden                     | Livestreams des Gemeinderats → Spracherkennung → Sprecherzuordnung                             | nein        | sehr hoch: Audio-Pipeline, Rechenzeit, Rechtsfrage         |
| Themenkategorien          | LLM-Klassifikation, analog zu `summaries/papers/`                                              | nein        | mittel                                                     |
| Orte                      | Ortsnamen aus Volltext + Geokodierung (OSM/Nominatim, Straßenverzeichnis der Stadt)            | nein        | mittel                                                     |
| Porträts                  | Stadt Karlsruhe / Fotografen                                                                   | nein        | rechtlich klären, sonst Initialen                          |

Folgerung: Personen, Gremien und Mitgliedschaften sind ein schneller Gewinn, weil
OParl sie bereits anbietet. Abstimmungen und Reden sind eigene Datenprojekte im
Mirror-Repo und sollten erst nach einem Machbarkeitstest eingeplant werden.

## 4. Architektur

```
Stadt Karlsruhe (OParl, Livestreams, Protokolle)
  └─ karlsruhe-oparl-syndication (Scraper, Anreicherung, LLM-Schritte)
       ├─ people/, memberships.json, legislative-terms.json      ← neu, Phase 1
       ├─ votes/<meeting id>.json                                ← neu, Phase 3
       ├─ speeches/<meeting id>.json                             ← neu, Phase 5
       ├─ paper-topics.json, paper-places.json                   ← neu, Phase 4
       └─ stats/*.json  (vorberechnete Aggregate)                ← neu, Phase 3/5
            └─ karlsruhe-oparl-viewer (Astro, statisch)
                 ├─ data.ts: neue Loader, gleiche Muster wie heute
                 ├─ neue Seiten (Personen, Gremien, Statistik, Karte, Reden)
                 └─ Pagefind: zusätzliche Entitätstypen über data-pagefind-filter
```

Entscheidungen:

1. **Aggregate im Mirror rechnen, nicht im Viewer.** Übereinstimmungsmatrix,
   Fraktionsdisziplin und Redezeiten sind kleine JSON-Dateien. Der Viewer rendert
   sie nur. So bleibt der Build schnell und die Logik testbar an einer Stelle.
2. **Eine Seite je Person und Gremium, nicht je Abstimmung oder Rede.** Hunderte
   Personen und ~40 Gremien kosten wenige MiB. Abstimmungen und Reden werden auf
   Sitzungsseiten eingebettet, nicht als eigene Seiten gebaut. Das hält das
   Budget (heute ~30k Seiten).
3. **Laufzeitdaten wie beim Digest.** Große oder schnell veraltende Daten
   (Redetexte, Live-Status) lädt der Browser bei Bedarf vom Mirror nach, nach
   dem Muster von `meeting-digest-loader.ts` und `file-text-loader.ts`.
4. **Keine eigene API im ersten Schritt.** Eine JSON-API oder ein MCP-Server
   brauchen einen Server. Das Mirror-Repo veröffentlicht bereits JSON über
   GitHub Pages, das ist faktisch eine statische API. Ein MCP-Server kommt erst
   in Phase 6 als separater, kleiner Dienst in Frage.

## 5. Ausbaustufen

Jede Phase ist für sich nutzbar und kann einzeln ausgeliefert werden.

### Phase 1 – Personen und Gremien (Daten aus OParl)

- Mirror: `people`, `memberships`, `legislativeTerm` mitspiegeln.
- Viewer:
  - Typen `types/person.ts`, `types/membership.ts`; Loader in `data.ts`.
  - `/gremien` (Übersicht nach Gemeinderat, Ausschüsse, Ortschaftsräte,
    Weitere, mit Mitglieder-, Sitzungs- und Vorlagenzahl).
  - `/gremien/[slug]`: Zusammensetzung nach Fraktion (Balken), Mitgliederliste,
    nächste und letzte Sitzungen, Feed- und ICS-Link (bestehende Komponenten
    `MeetingList`, `FeedSubscriptionLink`, `CalendarSubscription`).
  - `/personen/[slug]`: Fraktion, Rollen über Zeit, Gremien, eingereichte
    Vorlagen (Verknüpfung über `paper-submitters.json`, sofern Personen dort
    auftauchen).
  - `/fraktion/[name]` um die Mitglieder ergänzen.
- Größe: grob 300–600 Seiten, < 10 MiB.

#### Befund aus dem Datentest (2. November 2026)

Abgerufen über `bodies/0001/people` und `bodies/0001/memberships`. Die
Schnittstelle liefert standardmäßig 10 Einträge pro Seite, akzeptiert aber
`?limit=100`. Ein vollständiger Abruf dauert so unter einer Minute.

| Kennzahl                                  | Wert                                                |
| ----------------------------------------- | --------------------------------------------------- |
| Personen (öffentlich)                     | 714, davon 541 mit Mitgliedschaft                    |
| Mitgliedschaften                          | 4.050, Startdaten 1965 bis 2026                     |
| Rohgröße                                  | je ca. 2 MB JSON                                    |
| Gremien mit Mitgliedschaften              | 26, alle bereits in `organizations.json`            |
| Gemeinderat, aktuell ordentlich + Vorsitz | 50                                                  |
| Felder Person                             | Name, Anrede, Titel, `affix` (z. B. „Stadträtin“)   |
| Felder Mitgliedschaft                     | Rolle, Start, Ende, `votingRight`                   |

Drei Punkte ändern die Planung:

1. **Keine Fraktionszugehörigkeit in OParl.** Alle Mitgliedschaften verweisen
   auf Gremien (`organizations/gr/…`), keine auf Fraktionen. Auch
   `onBehalfOf` ist nie gesetzt. `paper-submitters.json` kennt Fraktionen nur
   je Vorlage, nicht je Person. Die Sitzverteilung braucht deshalb eine eigene
   Zuordnung Person → Fraktion. Vorschlag: eine gepflegte Datei
   `faction-members.json` im Mirror mit Gültigkeitszeitraum und Quellenlink
   (Gemeinderatsseite der Stadt). Bei ~50 Stadträt*innen und seltenen
   Wechseln ist das per Hand machbar. Automatisch ableiten aus eingereichten
   Anträgen ist zu unzuverlässig (gemeinsame Anträge, Fraktionswechsel).
2. **Nicht öffentliche Personen.** 939 Mitgliedschaften (69 davon aktiv)
   verweisen auf Personen, die die Schnittstelle mit `401 Unauthorized`
   verweigert. Diese Personen dürfen nicht erscheinen. Mitgliederzahlen
   müssen sie entweder auslassen oder als „weitere, nicht öffentlich
   geführte Mitglieder“ zählen, ohne Namen.
3. **Mitarbeitende und Kontaktdaten.** Unter den Mitgliedschaften stehen auch
   Rollen wie „Fraktionsgeschäftsstelle“, „Verwaltung“ und „Schriftführer“.
   Das sind Beschäftigte, keine Mandatsträger. Personenseiten nur für
   Mandatsrollen bauen (Ordentliches, Stellvertretendes, Beratendes Mitglied,
   Vorsitz, Sachkundige Einwohner). Die Felder `email`, `phone`,
   `locationObject` (Postleitzahl, Ort) werden im Mirror nicht übernommen.

#### Fraktionszuordnung Gemeinderat (erstellt 2. November 2026)

Erster Stand liegt in [`src/data/faction-members.json`](../src/data/faction-members.json).
Quelle ist der Reiter „Zusammensetzung“ des Gemeinderats im Sitzungskalender
der Stadt
(`sitzungskalender.karlsruhe.de/db/ratsinformation/organisation-gr-32130`).

- 55 Einträge: 48 Stadträt*innen, der Oberbürgermeister (Vorsitz) und 6
  ausgeschiedene Mitglieder der Wahlperiode 2024–2029.
- Alle 55 Personen-IDs im Sitzungskalender (`people-<id>`) sind identisch mit
  den OParl-IDs (`people/<id>`). Name und Gemeinderats-Mitgliedschaft stimmen in
  allen Fällen überein. Der Abgleich lässt sich also automatisieren.
- Aktuelle Sitze: GRÜNE 12, CDU 10, SPD 6, AfD 5, FDP/FW 4, Die Linke 3, KAL 3,
  Volt 3, Die PARTEI 1, FÜR 1.
- `factions.*.submitterIds` verbindet die Fraktionen mit den Schlüsseln aus
  `paper-submitters.json`. FDP/FW ist eine gemeinsame Fraktion und verweist auf
  `fdp` und `fw`.
- Der Oberbürgermeister bekommt keine Fraktion; „SPD“ steht im RIS als Partei.
  Ein ausgeschiedenes Mitglied (Marco Gottmann, bis 10. September 2024) hat im
  RIS keine Angabe und bleibt ohne Fraktion.
- OParl führt eine weitere aktive Gemeinderats-Mitgliedschaft (Person 61523,
  Beginn 2000-01-01) für eine nicht öffentliche Person. Sie steht nicht in der
  Liste der Stadt und wird nicht übernommen.

Grenzen: `councilSince`/`councilUntil` sind Daten der Ratsmitgliedschaft, nicht
des Fraktionseintritts. Fraktionswechsel innerhalb der Wahlperiode sind nicht
abgebildet. Die Datei gehört langfristig in den Mirror; bis dahin liegt sie im
Viewer. Da der Sitzungskalender die Zuordnung als HTML ausliefert, kann der
Scraper sie dort automatisch abrufen statt sie per Hand zu pflegen.

Damit sieht der Mirror-Teil von Phase 1 so aus:

- `people.json`: nur öffentliche Personen, ohne Kontaktfelder.
- `memberships.json`: nur Mitgliedschaften mit auflösbarer Person.
- `faction-members.json`: gepflegt, aktuelle Wahlperiode zuerst.

### Phase 2 – Startseite als Dashboard und Kalenderansichten

- Startseite: Suchfeld oben behalten, darunter „Letzte Sitzung“, „Nächste
  Sitzung“, „Diese Woche“ und „Neue Dokumente“ (aus `changed`-Reihenfolge und
  `meeting-presentation.ts`). Alles statisch zum Build-Zeitpunkt; „diese Woche“
  clientseitig relativ zu heute markieren, weil zwischen zwei Builds bis zu
  12 Stunden liegen.
- `/sitzungen`: Umschalter Liste / Woche / Monat neben `MeetingViewTabs`; die
  Monatsansicht ist ein Raster aus den schon geladenen Sitzungen, kein neuer
  Datenbedarf. ICS-Abo je Gremium.
- Sitzungsdetail: Navigation „vorige / nächste Sitzung dieses Gremiums“, TOP-
  Ergebnisse (angenommen, abgelehnt, einstimmig), soweit OParl oder das Protokoll
  sie liefern.

### Phase 3 – Abstimmungen und Statistik

Erst nach einem **Machbarkeitstest**: zehn Gemeinderatsprotokolle aus
`file-contents/` nehmen und prüfen, ob die namentlichen Abstimmungen
maschinenlesbar sind (Tabelle, Namensliste, Ja/Nein/Enthaltung).

- Mirror: `votes/<meeting id>.json` mit TOP, Gegenstand, Ergebnis, Summen und,
  wenn vorhanden, Einzelstimmen mit Personen-ID. Die Referenzseite ordnet über
  Nachnamen zu und lässt 13.204 Stimmen unzugeordnet; mit den OParl-Personen
  aus Phase 1 (Vorname, Fraktion, Mitgliedszeitraum) sollte das besser gehen.
- Mirror: `stats/votes.json` mit Fraktionsdisziplin, Stimmverteilung,
  Übereinstimmungsmatrix, Abweichungen je Person.
- Viewer:
  - Sitzungsdetail: Abstimmungsbalken je TOP (Ja/Nein/Enthaltung), Filter
    „nur strittige“.
  - Vorlagendetail: Abstimmungsergebnis neben der `PaperTimeline`.
  - Personenseite: Abstimmungsverhalten, Abweichungen von der Fraktion.
  - `/statistik`: die vier Auswertungen, jeweils mit Basis und Methodik.
  - Pagefind: Abstimmungen als Ergebnistyp in der Suche.
- Darstellung: Diagramme als statisches SVG oder CSS, keine Chart-Bibliothek
  nötig; Übereinstimmungsmatrix als HTML-Tabelle mit Farbskala.

### Phase 4 – Themen und Karte

- Mirror: `paper-topics.json` (feste Liste von ~12 Themen, LLM-klassifiziert,
  wie die Zusammenfassungen) und `paper-places.json` (Ortsnamen mit Typ und
  Koordinate, Abgleich gegen ein Karlsruher Straßen- und Gebäudeverzeichnis).
- Viewer:
  - Thema als sechster Filter in `search-index.ts` / `SearchPanel`.
  - `/karte`: MapLibre GL mit OSM-Kacheln, Punkte je Ort, Filter nach Ortstyp
    und Zeitraum, Klick öffnet die Vorlagen. Daten als eine GeoJSON-Datei.
    Fallback-Liste für Browser ohne WebGL2 (die Referenzseite zeigt dann nur
    eine Fehlermeldung).
  - Stadtteilseiten bekommen eine Kartenansicht.

### Phase 5 – Reden (optional, größter Aufwand)

- Voraussetzung: klären, ob die Livestreams der Stadt dauerhaft abrufbar sind
  und transkribiert und veröffentlicht werden dürfen.
- Mirror-Pipeline: Audio → Spracherkennung (z. B. Whisper) → Sprecher-
  zuordnung über Tagesordnung und Rednerliste → Zuordnung zu TOPs →
  `speeches/<meeting id>.json`. Optional LLM-Schritte für Haltung und Tonlage.
- Viewer: Reden je TOP im Sitzungsdetail (Text bei Bedarf nachladen), `/reden`
  mit Redezeit vs. Sitzanteil, „gesagt vs. gestimmt“ (braucht Phase 3),
  Pagefind-Suche über Redetexte.
- Kennzeichnung: Alle Modellschätzungen klar als solche ausweisen, mit Hinweis
  auf Fehlerquote; nichts davon in Überschriften oder SEO-Beschreibungen.

### Phase 6 – Schnittstellen

- Statische JSON-Endpunkte im Viewer (`/api/*.json` als Astro-Endpunkte), z. B.
  Gremien, Personen, Sitzungen, Statistik.
- MCP-Server als eigener kleiner Dienst, der Pagefind-Index oder Mirror-JSON
  liest. Nur, wenn jemand den Betrieb übernimmt; GitHub Pages kann das nicht.

## 6. Risiken und offene Fragen

- **Lizenz der Stadtdaten.** Die Referenzseite nennt „Open Data (CC BY-ND)“.
  „No Derivatives“ kann abgeleitete Auswertungen (Statistik, Transkripte,
  Klassifikation) einschränken. Vor Phase 3 und 5 klären.
- **Porträts.** Fotos haben eigene Rechte. Ohne Freigabe Initialen-Avatare
  verwenden.
- **Personenbezug.** Abstimmungsverhalten und Reden einzelner Ratsmitglieder
  sind öffentliche Mandatsausübung, aber Fehlzuordnungen schaden konkret. Jede
  Zuordnung braucht eine Quelle und eine Korrekturmöglichkeit (Link „Fehler
  melden“ auf ein GitHub-Issue).
- **Neutralität.** Keine wertenden Zusätze an Fraktionen oder Personen. Die
  Referenzseite tut das; GemeinderatsRadar sollte es bewusst nicht tun.
- **Größenbudget.** Phase 1–4 zusammen schätzungsweise +30–60 MiB. Reden als
  Volltext nur über Laufzeit-Nachladen, sonst wird das Budget knapp.
- **Mirror-Abhängigkeit.** Fast alle Phasen brauchen Änderungen im Repo
  `maxliesegang/karlsruhe-oparl-syndication`. Klären, ob das upstream
  passieren kann oder ob ein eigener Fork des Mirrors nötig ist.
- **Upstream dieses Repos.** Das Repo ist ein Fork von
  `maxliesegang/karlsruhe-oparl-viewer`. Entscheiden, ob die Arbeit upstream
  beigetragen oder im Fork weitergeführt wird.

## 7. Nächste Schritte

1. Entscheiden, ob upstream beigetragen oder im Fork gearbeitet wird.
2. Phase 1: Datentest und Fraktionszuordnung für den Gemeinderat sind erledigt
   (siehe Phase 1). Als Nächstes Typen und Loader im Viewer
   (`types/person.ts`, `types/membership.ts`, `data.ts`) und die Seite
   `/gremien/gemeinderat` als erster Prototyp.
3. Parallel den Machbarkeitstest für Abstimmungen (Phase 3) mit zehn
   Protokollen machen.
4. Lizenzfrage (CC BY-ND) bei der Stadt Karlsruhe klären.
