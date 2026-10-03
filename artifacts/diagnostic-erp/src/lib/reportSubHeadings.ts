/**
 * Report sub-headings, owned by the radiologist rather than by the code.
 *
 * Two things had to be true for this to be worth shipping:
 *
 *  1. The headings a report prints with come from the FORMAT's declared
 *     sections, which the Templates screen already edits. Before this, a format
 *     carried a section list AND a separate run-on `defaultFindings` paragraph,
 *     and only the paragraph reached the page — so renaming or adding a section
 *     in the UI changed nothing the radiologist saw.
 *  2. The report being written is editable too: a heading list can be applied
 *     to findings text that already exists, without discarding a single word
 *     the radiologist typed. `retitleFindingsDocument` does that by moving each
 *     body under its new heading, matched case- and space-insensitively.
 *
 * Nothing here talks to the server. Persistence is the format row, which the
 * Templates screen already PATCHes.
 */
import {
  findingsDocumentHasStructure,
  parseFindingsDocument,
  tableToFindingsText,
  type FindingsBlock,
} from "./findingsDocument";

export type ReportSection = { label: string; normal?: string };

/** Read a format's declared sections from its `sectionsJson`.
 *
 *  v1 stores `{ findingsItems: [{ label, normal }] }`; v2 stores
 *  `{ sections: [{ title/label, fields: [...] }] }`. Both shapes are in the
 *  database, so both have to work or a format's headings silently vanish. */
export function sectionsFromTemplateJson(sectionsJson: string | null | undefined): ReportSection[] {
  if (!sectionsJson) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(sectionsJson); } catch { return []; }
  if (!parsed || typeof parsed !== "object") return [];
  const doc = parsed as {
    findingsItems?: Array<{ label?: unknown; normal?: unknown }>;
    sections?: Array<{
      title?: unknown; label?: unknown; heading?: unknown;
      normalText?: unknown; defaultText?: unknown;
    }>;
  };

  if (Array.isArray(doc.findingsItems)) {
    return doc.findingsItems
      .map((i) => ({
        label: typeof i?.label === "string" ? i.label.trim() : "",
        normal: typeof i?.normal === "string" ? i.normal.trim() : undefined,
      }))
      .filter((i) => i.label);
  }
  if (Array.isArray(doc.sections)) {
    // v2 names a section `label` and keeps its normal wording in `normalText`
    // (falling back to `defaultText`), which is what a format built in the
    // Templates screen actually writes.
    return doc.sections
      .map((s) => ({
        label: typeof s?.label === "string" ? s.label.trim()
          : typeof s?.title === "string" ? s.title.trim()
            : typeof s?.heading === "string" ? s.heading.trim() : "",
        normal: typeof s?.normalText === "string" ? s.normalText.trim()
          : typeof s?.defaultText === "string" ? s.defaultText.trim()
            : undefined,
      }))
      .filter((s) => s.label);
  }
  return [];
}

const key = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, " ");

/** Findings text built from the format's own sections, using each section's
 *  normal wording where the format supplies one. A format with no sections and
 *  no normals yields nothing, and the caller keeps its legacy paragraph. */
export function findingsTextFromSections(sections: ReportSection[]): string {
  const usable = sections.filter((s) => s.label && s.normal?.trim());
  if (usable.length === 0) return "";
  return usable.map((s) => `${s.label.trim()}:\n${s.normal!.trim()}`).join("\n\n");
}

/**
 * Re-shape existing findings text under a new heading list.
 *
 * Content always wins over layout: every body the radiologist wrote survives,
 * an unmatched heading keeps its position with an empty body, and any text that
 * was never under a heading (or under one that was deleted) is preserved rather
 * than dropped — free text first, then a trailing section for headings that
 * disappeared, so a rename never loses the words underneath it.
 *
 * `defaults` fills a heading that arrived with no body of its own, keyed by
 * label and matched the same case- and space-insensitive way as headings. It
 * exists so a format's own normal wording can populate a newly named section —
 * text the format author wrote, never something invented here.
 */
export function retitleFindingsDocument(
  text: string,
  headings: string[],
  defaults?: Record<string, string>,
): string {
  const wanted = headings.map((h) => h.trim()).filter(Boolean);
  if (wanted.length === 0) return text.trim();

  const defaultsByKey = new Map<string, string>();
  for (const [label, body] of Object.entries(defaults ?? {})) {
    const trimmed = body?.trim();
    if (trimmed) defaultsByKey.set(key(label), trimmed);
  }

  const blocks = parseFindingsDocument(text);
  const bodies = new Map<string, string[]>();
  const tables: Array<{ headingKey: string | null; header: string[]; rows: string[][] }> = [];
  const orphans: string[] = [];

  let current: string | null = null;
  for (const b of blocks) {
    if (b.kind === "heading") { current = key(b.text); bodies.set(current, bodies.get(current) ?? []); continue; }
    if (b.kind === "table") {
      const t = b as Extract<FindingsBlock, { kind: "table" }>;
      tables.push({ headingKey: current, header: t.header, rows: t.rows });
      continue;
    }
    if (current === null) { orphans.push(b.text); continue; }
    bodies.get(current)!.push(b.text);
  }

  const out: string[] = [];
  if (orphans.length > 0) out.push(orphans.join("\n\n"));
  for (const heading of wanted) {
    const k = key(heading);
    const body = (bodies.get(k) ?? []).join("\n").trim() || (defaultsByKey.get(k) ?? "");
    const tableBlocks = tables.filter((t) => t.headingKey === k)
      .map((t) => tableToFindingsText(t.header, t.rows));
    // Heading and body sit on adjacent lines, which is how the presets and
    // findingsTextFromSections write them; a blank line here would read as a
    // new paragraph break inside the section.
    const block = [body, ...tableBlocks].filter(Boolean).join("\n");
    out.push(block ? `${heading}:\n${block}` : `${heading}:`);
  }
  // Bodies whose heading was removed from the list are kept under a visible
  // label rather than silently deleted — the same rule covers a stranded table,
  // so retitling can never lose the layout a radiologist already filled in.
  const wantedKeys = new Set(wanted.map(key));
  const stranded = [...bodies.entries()]
    .filter(([k, v]) => !wantedKeys.has(k) && v.length > 0)
    .map(([k, v]) => v.join("\n\n"));
  const strandedTables = tables.filter((t) => !(t.headingKey && wantedKeys.has(t.headingKey)));
  for (const t of strandedTables) stranded.push(tableToFindingsText(t.header, t.rows));
  if (stranded.length > 0) out.push(`Retained notes:\n${stranded.join("\n\n")}`);

  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The findings body a format should produce.
 *
 *  Order matters. A format whose authored text is already a sub-headed document
 *  keeps it — that text is curated wording the radiologist chose. Otherwise the
 *  report is built from the format's OWN section list, which is what makes
 *  adding a section in the Templates screen add a sub-heading to the printed
 *  report without touching code. Otherwise, legacy single-paragraph text.
 */
export function findingsBodyForTemplate(template: {
  sectionsJson?: string | null;
  defaultFindings?: string | null;
} | null | undefined): string {
  const authored = template?.defaultFindings?.trim() ?? "";
  if (authored && findingsDocumentHasStructure(authored)) return authored;
  const fromSections = findingsTextFromSections(sectionsFromTemplateJson(template?.sectionsJson));
  return fromSections || authored;
}

/** The headings a format will print with, for the Templates screen.
 *  Derived from the same body the workspace applies, so a preview can never
 *  promise sub-headings that the report then fails to print. */
export function headingsForTemplate(template: {
  sectionsJson?: string | null;
  defaultFindings?: string | null;
} | null | undefined): string[] {
  const body = findingsBodyForTemplate(template);
  return findingsDocumentHasStructure(body) ? headingsInFindings(body) : [];
}
/** The headings a findings document currently carries, in order. */
export function headingsInFindings(text: string): string[] {
  return parseFindingsDocument(text)
    .filter((b) => b.kind === "heading")
    .map((b) => (b as Extract<FindingsBlock, { kind: "heading" }>).text);
}
