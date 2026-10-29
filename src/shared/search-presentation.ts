import { PLACEHOLDER_OFFICES } from "./paper-presentation.ts";

/** Trim a repeated title and leading interface labels, without rewriting document prose. */
export function excerptBodyStart(text: string, title: string): number {
  const leading =
    /^(?:\s*(?:(?:Zum Inhalt springen|Inhalt springen|springen)\s+|(?:Entschieden|Beraten|Zusammenfassung|KI-generiert|Verlauf|Kernpunkte)(?:\s*[.·:]\s*|$)))+/i;
  let start = text.match(leading)?.[0].length ?? 0;
  const words = (value: string) => [...value.matchAll(/[\p{L}\p{N}]+/gu)];
  const titleWords = words(title).map((word) =>
    word[0].toLocaleLowerCase("de"),
  );
  const excerptWords = words(text.slice(start));
  for (
    let length = Math.min(titleWords.length, excerptWords.length);
    length > 0;
    length--
  ) {
    // A fragment can begin midway through a long title. Only remove a substantial
    // matching suffix, or the entire title, to avoid eating ordinary body prose.
    if (length < 3 && length !== titleWords.length) continue;
    const suffix = titleWords.slice(-length);
    if (
      !suffix.every(
        (word, i) => word === excerptWords[i][0].toLocaleLowerCase("de"),
      )
    )
      continue;
    const last = excerptWords[length - 1];
    start += last.index! + last[0].length;
    start += text.slice(start).match(/^[\s.,:;–—-]*/)?.[0].length ?? 0;
    start += text.slice(start).match(leading)?.[0].length ?? 0;
    break;
  }
  return start;
}
/** Pagefind inserts sentence separators between adjacent linked metadata values. */
export function contextNames(value: string): string[] {
  return value
    .replace(/\.\s*$/, "")
    .split(/\.\s+|,\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
}
/** The list is alphabetical, not ranked, so naming only its first entries would
 * suggest a focus that the data does not have. Long lists are reduced to a count. */
export function compactDistricts(value: string): string {
  const names = contextNames(value);
  return names.length > 2 ? `${names.length} Stadtteile` : names.join(", ");
}
/** A fragment that opens lowercase or on punctuation starts mid-sentence. */
export function startsMidSentence(text: string): boolean {
  return /^[\p{Ll},;:)\]–-]/u.test(text.trimStart());
}
/** A numbered suffix (`2022/0883/1`) marks a later paper on the same matter.
 * The suffix alone does not say which kind, so callers name no paper type. */
export function followUpBase(reference: string): string {
  return reference.trim().match(/^(\d{4}\/\d{4})\/\d+$/)?.[1] ?? "";
}
/** Where a clipped excerpt should start so its first highlight stays in view:
 * at most `lead` characters before `markOffset`, on a word boundary. */
export function excerptLeadStart(
  text: string,
  markOffset: number,
  lead = 60,
): number {
  if (markOffset <= lead) return 0;
  const space = text.indexOf(" ", markOffset - lead);
  return space === -1 || space >= markOffset ? markOffset : space + 1;
}
interface ContentAnchor {
  id?: string;
  location?: number;
}
/** The AI summary as indexed page text: the words after the `paper-summary`
 * heading anchor, without its labels, up to the key points or next anchor.
 * Reading it from the fragment avoids a meta field, which Pagefind would index
 * again and so double the summary's ranking weight. */
export function summaryFromContent(
  content: string,
  anchors: ContentAnchor[],
): string {
  const heading = anchors.find((anchor) => anchor.id === "paper-summary");
  if (heading?.location === undefined) return "";
  const next = anchors
    .map((anchor) => anchor.location ?? -1)
    .filter((location) => location > heading.location!)
    .sort((a, b) => a - b)[0];
  const words = content.split(/\s+/).slice(heading.location, next);
  const text = words.join(" ");
  const body = text.match(/^Zusammenfassung\.\s+KI-generiert\.\s+/);
  if (!body) return "";
  return text
    .slice(body[0].length)
    .split(/\s+Kernpunkte\.\s/)[0]
    .trim();
}
/** Paper types the administration writes itself. For these, the lead office
 * (`underDirectionOf`) is effectively the originator; for motions, enquiries
 * and budget motions it is only the office that handles them. */
const ADMINISTRATION_PAPER_TYPES = new Set([
  "Beschlussvorlage",
  "Informationsvorlage",
  "Offenlage",
]);
/** The lead office to name on a card without a submitting faction. */
export function leadOffice(organizations: string, paperType: string): string {
  if (!ADMINISTRATION_PAPER_TYPES.has(paperType.trim())) return "";
  return organizations
    .split(/,\s*/)
    .map((name) => name.trim())
    .filter((name) => name && !PLACEHOLDER_OFFICES.has(name))
    .join(", ");
}
