import test from "node:test";
import assert from "node:assert/strict";
import {
  excerptBodyStart,
  compactDistricts,
  contextNames,
  startsMidSentence,
  followUpBase,
  excerptLeadStart,
  summaryFromContent,
  leadOffice,
} from "../src/shared/search-presentation.ts";
test("remove a repeated title and adjacent interface labels from a real excerpt pattern", () => {
  const title =
    "Mitgliedschaft im Klimakommune Deutschland e.V. zur Fortsetzung der Auditierung im Klimaschutz";
  const text =
    "Deutschland e.V. zur Fortsetzung der Auditierung im Klimaschutz. Entschieden. Zusammenfassung. KI-generiert. Die Vorlage schlägt vor, dass";
  assert.equal(
    text.slice(excerptBodyStart(text, title)),
    "Die Vorlage schlägt vor, dass",
  );
});
test("preserve body and PDF prose and do not trim a coincidental final title word", () => {
  const body =
    "Die Förderung des Klimaschutzes in den Stadtteilen wird fortgeführt.";
  assert.equal(excerptBodyStart(body, "Förderung des Klimaschutzes"), 0);
  assert.equal(
    excerptBodyStart(
      "Klimaschutz ist eine kommunale Aufgabe.",
      "Maßnahmen zum Klimaschutz",
    ),
    0,
  );
});
test("a full short title and skip-link text can be removed without rewriting following prose", () => {
  const text =
    "Zum Inhalt springen Klimaschutz. Beraten. Verlauf. Eine öffentliche Beratung fand statt.";
  assert.equal(
    text.slice(excerptBodyStart(text, "Klimaschutz")),
    "Eine öffentliche Beratung fand statt.",
  );
});
test("compact district names without substituting or implying impact", () => {
  assert.equal(compactDistricts("Durlach, Mühlburg"), "Durlach, Mühlburg");
  assert.equal(compactDistricts("Durlach, Mühlburg, Oststadt"), "3 Stadtteile");
  assert.equal(compactDistricts(""), "");
});

test("linked metadata separators and partial skip-link excerpts are cleaned", () => {
  assert.equal(
    compactDistricts("Durlach. Mühlburg. Oststadt."),
    "3 Stadtteile",
  );
  assert.deepEqual(contextNames("KAL. Die PARTEI."), ["KAL", "Die PARTEI"]);
  const text =
    "springen Sofortmaßnahmen zum Klimaschutz. Entschieden. Verlauf. Vorlage veröffentlicht";
  assert.equal(
    text.slice(excerptBodyStart(text, "Sofortmaßnahmen zum Klimaschutz")),
    "Vorlage veröffentlicht",
  );
  assert.equal(
    excerptBodyStart("Beratener Vorschlag zum Klimaschutz.", "Anderer Titel"),
    0,
  );
});

test("excerpts that open mid-sentence are detected for a leading ellipsis", () => {
  assert.equal(startsMidSentence("dem Radweg (Stichworte"), true);
  assert.equal(startsMidSentence(" , dazu kommen"), true);
  assert.equal(startsMidSentence("Geh- und Radweg benutzen."), false);
  assert.equal(startsMidSentence("2 Für das empfohlene Szenario"), false);
});

test("numbered reference suffixes identify the paper they follow", () => {
  assert.equal(followUpBase("2022/0883/1"), "2022/0883");
  assert.equal(followUpBase("2024/0883/12"), "2024/0883");
  assert.equal(followUpBase("2022/0883"), "");
  assert.equal(followUpBase(""), "");
});

test("a clipped excerpt starts shortly before its first highlight, on a word boundary", () => {
  const text =
    "Im Rahmen der Haushaltsberatungen wurde über verschiedene Maßnahmen gesprochen, darunter der Modernisierungszuschuss für Gebäude";
  const mark = text.indexOf("Modernisierungszuschuss");
  const start = excerptLeadStart(text, mark, 30);
  assert.ok(mark - start <= 30);
  assert.match(
    text.slice(start),
    /^gesprochen, darunter der Modernisierungszuschuss/,
  );
  assert.equal(excerptLeadStart(text, 10, 30), 0);
});

test("the AI summary is read from indexed page text without its labels or key points", () => {
  const content =
    "Zum Inhalt springen Platz der Kinderrechte. Entschieden. Zusammenfassung. KI-generiert. Die Fraktion beantragt einen Platz. Kernpunkte. 1 Prüfung eines Ortes. Verlauf. Vorlage veröffentlicht";
  const anchors = [
    { id: "main-content", location: 3 },
    { id: "paper-summary", location: 7 },
    { id: "paper-timeline", location: 22 },
  ];
  assert.equal(
    summaryFromContent(content, anchors),
    "Die Fraktion beantragt einen Platz.",
  );
  assert.equal(summaryFromContent(content, anchors.slice(0, 1)), "");
  // A misaligned anchor must not show arbitrary page text as a summary.
  assert.equal(
    summaryFromContent(content, [{ id: "paper-summary", location: 6 }]),
    "",
  );
});

test("the lead office names only administration papers and skips placeholders", () => {
  assert.equal(
    leadOffice("Stadtplanungsamt", "Beschlussvorlage"),
    "Stadtplanungsamt",
  );
  assert.equal(
    leadOffice("_Fachbereich Datenübernahme", "Informationsvorlage"),
    "",
  );
  assert.equal(leadOffice("Offen, Tiefbauamt", "Offenlage"), "Tiefbauamt");
  // For motions and budget motions the office only handles the paper.
  assert.equal(leadOffice("Ortsverwaltung Grötzingen", "Antrag"), "");
  assert.equal(leadOffice("Stadtkämmerei", "Haushalt THH 4100"), "");
  assert.equal(leadOffice("Stadtkämmerei", ""), "");
});
