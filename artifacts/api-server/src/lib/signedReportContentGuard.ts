/**
 * Does the report body a caller is about to sign actually say anything?
 *
 * `patient_reports.body` is, in the schema's own words, "the authoritative,
 * append-only signed artifact" — and for radiology rows it is the ONLY content
 * column (see lib/db/src/schema/patientReports.ts:14, ":57"). It is what
 * reportPresentation.ts renders as trusted HTML into the print page, the PDF,
 * the WhatsApp link and the PACS archive. Signing a row whose body is empty
 * therefore issues a blank signed clinical document, and nothing on the server
 * checked for that: POST /api/patient-reports accepts `body` as optional and
 * defaults it to "", POST /:id/sign validated nine separate conditions and none
 * of them looked at the text.
 *
 * The reachable path needs no API crafting. Report Hub → New Report → pick a
 * patient and a test → Create → Sign. ReportHub.tsx submits no `body` at all
 * (:490) and its SignDialog sends only `{ signatureId }` (:970).
 *
 * This module is deliberately PURE — no db, no request, no config — so the
 * classification can be tested against the real body shapes the five producers
 * emit without a database.
 *
 * What it does NOT do, on purpose:
 *  - No minimum word count and no "thin report" rule. How much text a study
 *    needs is clinical judgement, not something to hard-code here.
 *  - No required-section rule for a section the document never rendered. A
 *    normal study legitimately has findings and no impression, so an ABSENT
 *    Impression stays signable. What is refused is a section the producer drew
 *    the heading for and left empty, and (F2 ruling 3, 2026-11-06) a structured
 *    document whose Findings carry nothing — see signedReportSectionsOf().
 *  - No opinion on correctness. Contradiction and consistency checking lives in
 *    structuredReport/validator.ts (R7/R15) and stays there.
 *
 * The only question asked is: after removing markup and the parts of the
 * template that producers emit unconditionally, did the radiologist author any
 * characters at all?
 */

export type SignedReportContentLevel = "empty" | "placeholder" | "incomplete" | "ok";

/** Which clinical section was rendered and left with nothing in it. */
export type SignedReportSection = "findings" | "impression";

export type SignedReportContentClassification = {
  level: SignedReportContentLevel;
  /** The authored text that survived stripping — exactly what was judged. */
  clinicalText: string;
  /** Plain-language reasons, safe to show the signer verbatim. */
  reasons: string[];
  /** Placeholder tokens recognised, for the audit payload. */
  placeholders: string[];
  /**
   * Sections the document itself declares with nothing authored under them.
   * Empty unless `level` is "incomplete", so every existing consumer of this
   * shape (audit payload, refusal body) keeps working unchanged.
   */
  emptySections: SignedReportSection[];
};

/**
 * Label prefixes a producer writes unconditionally, around content the
 * radiologist did not author. Each entry names the producer that emits it so
 * the list can be checked against the code rather than trusted.
 *
 * `dropsValue: true` means the rest of the line goes too — the value is a
 * demographic the builder fills from the study, not authored text.
 */
const SCAFFOLD_LABELS: ReadonlyArray<{ label: string; dropsValue: boolean; source: string }> = [
  // RadiologyCommandCenter.tsx:842-855 writes all of these whether or not the
  // corresponding field has anything in it.
  { label: "patient name", dropsValue: true, source: "RadiologyCommandCenter htmlBody" },
  { label: "patient", dropsValue: true, source: "RadiologyCommandCenter htmlBody" },
  // reportPresentation.ts:318-322 — the letter-pad demographic block.
  { label: "age/sex", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "age / sex", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "uhid", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "patient id", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "accession", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "accession no", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "accession number", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "ref. by", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "ref by", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "ref. doctor", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "referring doctor", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "date", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "study date", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "test", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "test name", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  { label: "modality", dropsValue: true, source: "reportPresentation stackedPatientBlockHtml" },
  // Section labels: the label is scaffolding, what follows it is authored.
  { label: "clinical history", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "history", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "technique", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "findings", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "impression", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "recommendation", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "recommendations", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "conclusion", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
  { label: "opinion", dropsValue: false, source: "RadiologyCommandCenter / buildLivePrintBodyHtml" },
];

/**
 * Lines that mean "nothing here". A line consisting only of one of these — after
 * label stripping — is not authored content.
 *
 * The bare em dash is not a guess: buildLivePrintBodyHtml emits "—" as the
 * sentinel for a structured finding with no text that is also not marked normal
 * (radiologyReportPrintLiveMerge.ts, `item.text?.trim() || (item.normal ? "Normal." : "—")`).
 * A body made only of those is the builder's own representation of an empty
 * report, so it must not read as content.
 *
 * "None", "Nil" and "Nothing" are deliberately NOT in this set: a radiologist
 * who writes "Findings: None" has authored a negative finding, and refusing to
 * sign it would be the guard making a clinical judgement it has no basis for.
 */
const EMPTY_LINE_TOKENS = new Set([
  "-", "--", "---", "—", "–", "––", ".", "..", "...", "…", ":", ";", "/", "|", "*",
  "n/a", "na",
]);

const PLACEHOLDER_LINE_PATTERNS: ReadonlyArray<{ re: RegExp; token: string }> = [
  { re: /^(?:todo|tbd|fixme|xxx|placeholder|to\s+be\s+(?:filled|added|completed|typed))$/i, token: "unfilled marker" },
  { re: /^\[[^\]]*\]$/, token: "bracketed placeholder" },
  { re: /^\{\{[^}]*\}\}$/, token: "unrendered template token" },
  { re: /^_{2,}$/, token: "blank line" },
  { re: /^lorem\s+ipsum\b/i, token: "lorem ipsum" },
  { re: /^x{3,}$/i, token: "unfilled marker" },
];

const BLOCK_BOUNDARY = /<\/?(?:p|div|li|ol|ul|tr|td|table|section|article|header|footer|br|hr|h[1-6])\b[^>]*>/gi;

const NAMED_ENTITIES: ReadonlyArray<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/(?:&#0*39|&apos);/gi, "'"],
];

function decodeEntities(text: string): string {
  let out = text;
  for (const [re, replacement] of NAMED_ENTITIES) {
    out = out.replace(re, replacement);
  }
  // Numeric forms last: a named-entity replacement can produce "&amp;#38;"-style
  // sequences whose decoded form must not be re-interpreted as markup, and by
  // this point all tags have already been stripped.
  out = out.replace(/&#0*(\d+);/g, (_m, d: string) => safeCodePoint(Number(d)));
  out = out.replace(/&#x0*([0-9a-f]+);/gi, (_m, d: string) => safeCodePoint(parseInt(d, 16)));
  return out;
}

/** An out-of-range numeric entity must not throw inside a sign. */
function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  return String.fromCodePoint(code);
}

/** Drop an element AND its contents, matched by an opening-tag predicate. */
function dropElementContents(html: string, openRe: RegExp): string {
  let out = html;
  for (;;) {
    openRe.lastIndex = 0;
    const open = openRe.exec(out);
    if (!open) return out;
    const tagName = open[1].toLowerCase();
    const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
    closeRe.lastIndex = open.index;
    const close = closeRe.exec(out);
    const end = close ? close.index + close[0].length : out.length;
    out = out.slice(0, open.index) + "\n" + out.slice(end);
  }
}

/** Strip markup and the template's unconditional labels; keep authored text. */
export function extractAuthoredText(body: string): string {
  let text = body;

  // 1. Non-content elements, contents and all.
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // 2. Headings are template labels, never authored findings. Both shapes the
  //    producers use: buildLivePrintBodyHtml's `<div class="section-heading">`
  //    and the hand-rolled `<h2>…</h2>`/`<h4>…</h4>` of the other two.
  text = dropElementContents(text, /<(h[1-6])\b[^>]*>/gi);
  text = dropElementContents(text, /<(div)\b[^>]*\bclass="[^"]*\bsection-heading\b[^"]*"[^>]*>/gi);
  text = dropElementContents(text, /<(th)\b[^>]*>/gi);

  // 3. Block boundaries become line breaks so labels can be matched per line.
  text = text.replace(BLOCK_BOUNDARY, "\n");

  // 4. Whatever markup is left is decoration.
  text = text.replace(/<[^>]*>/g, " ");

  // 5. Decode before label matching: an escaped "Patient&nbsp;Name:" must still
  //    be recognised as scaffolding.
  text = decodeEntities(text);

  // 6. Per-line: drop scaffold labels, and the value too where the label is a
  //    demographic the builder fills in rather than text anyone authored.
  //    The colon is MANDATORY. Every producer writes `Label:` (CommandCenter's
  //    `<strong>Patient Name:</strong>`, reportPresentation's `Age/Sex: ${…}`),
  //    and the bare-word heading forms were already dropped in step 2. Making it
  //    optional would let a short label like "test" or "date" eat the first word
  //    of an authored sentence — "Test shows a mass" is findings, not a label.
  const kept: string[] = [];
  for (const rawLine of text.split("\n")) {
    let line = rawLine.replace(/\u00a0/g, " ").trim();
    if (!line) continue;

    for (const { label, dropsValue } of SCAFFOLD_LABELS) {
      const re = new RegExp(`^${escapeForRegExp(label)}\\s*:\\s*`, "i");
      if (!re.test(line)) continue;
      line = dropsValue ? "" : line.replace(re, "").trim();
      break;
    }
    if (!line) continue;
    // The plain-text form of a section word with no colon after it.
    if (/^(?:findings|impression|recommendations?|technique|clinical history|conclusion|opinion)\.?$/i.test(line)) {
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n");
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyLines(clinicalText: string): { lines: string[]; placeholders: string[] } {
  const lines = clinicalText.split("\n").map((l) => l.trim()).filter(Boolean);
  const placeholders: string[] = [];
  const authored: string[] = [];

  for (const line of lines) {
    const normalised = line.replace(/\s+/g, " ").toLowerCase().replace(/[.\u2014\u2013-]+$/g, "").trim();
    if (EMPTY_LINE_TOKENS.has(normalised) || EMPTY_LINE_TOKENS.has(line.toLowerCase())) continue;
    const hit = PLACEHOLDER_LINE_PATTERNS.find(({ re }) => re.test(normalised) || re.test(line.trim()));
    if (hit) {
      if (!placeholders.includes(hit.token)) placeholders.push(hit.token);
      continue;
    }
    authored.push(line);
  }

  return { lines: authored, placeholders };
}

/**
 * Section labels and what they mean.
 *
 * The keys are the SAME normalised spellings the reporting client parses with
 * (`artifacts/diagnostic-erp/src/lib/storedReportBody.ts:30-49`), and
 * `signedReportSectionRule.test.ts` fails if the two tables drift — a
 * label only one of them knows is a section that reads as content on screen and
 * as nothing at the door. "Findings / Observation" is not in that table because
 * that parser reads bodies this side produced, while `radiologyReportPreviewHtml.ts:371`
 * and `radiology-report-generator.ts:1230` both write that exact heading.
 */
export const SECTION_LABELS: Readonly<Record<string, SignedReportSection | "other">> = {
  "FINDINGS": "findings",
  "FINDING": "findings",
  "RADIOLOGICAL FINDINGS": "findings",
  "OBSERVATIONS": "findings",
  "OBSERVATION": "findings",
  "FINDINGS / OBSERVATION": "findings",
  "FINDINGS / OBSERVATIONS": "findings",
  "IMPRESSION": "impression",
  "IMPRESSIONS": "impression",
  "CONCLUSION": "impression",
  "CONCLUSIONS": "impression",
  "OPINION": "impression",
  "CLINICAL HISTORY": "other",
  "HISTORY": "other",
  "CLINICAL INFORMATION": "other",
  "CLINICAL INFO": "other",
  "TECHNIQUE": "other",
  "STUDY TECHNIQUE": "other",
  "PROTOCOL": "other",
  "RECOMMENDATION": "other",
  "RECOMMENDATIONS": "other",
  "ADVICE": "other",
  "SUGGESTIONS": "other",
  "KEY IMAGES": "other",
  "MEASUREMENTS": "other",
};

/**
 * The canal AP measurement table's own heading, spelled to beat the generic
 * rule below. A spine report's Findings has a region literally called "Canal
 * Diameter" (`radiologySmartEngine.ts:124`, documented at
 * `radiologyReportPrintLiveMerge.ts:168`), so an unknown heading cannot be
 * assumed to be a findings region without first ruling out the measurement
 * table — which prints with `—` cells and no prose, and would otherwise read as
 * authored findings on an otherwise blank report.
 */
const MEASUREMENT_HEADING = /(?:\bCANAL AP DIAMETER\b|\bAP CANAL DIAMETER\b|\bCANAL AP\b)/;

/**
 * Lines a producer writes when a section has no content. These are its own
 * words, not the radiologist's, so they must not be read as the authored text
 * they are describing. Each names the file that emits it.
 */
const EMPTY_SECTION_SENTENCES: ReadonlyArray<{ re: RegExp; source: string }> = [
  // radiologyReportPreviewHtml.ts:289 — Findings left blank.
  { re: /^no findings entered\.?$/i, source: "buildPreviewHtml" },
  // radiologyReportPreviewHtml.ts:331, radiology-report-generator.ts:1158.
  { re: /^draft impression [—-] not verified\.?$/i, source: "buildPreviewHtml / buildReportHtml" },
];

function normaliseLabel(raw: string): string {
  return raw.replace(/[\u00A0\s]+/g, " ").replace(/[:.\u2013\u2014-]+$/g, "").trim().toUpperCase();
}

/** What a heading line names, or null when it is a findings region. */
function labelOfHeading(line: string): SignedReportSection | "other" | null {
  const normalised = normaliseLabel(line);
  if (!normalised) return null;
  if (MEASUREMENT_HEADING.test(normalised)) return "other";
  return SECTION_LABELS[normalised] ?? null;
}

/** An inline `Label: content` line, as CommandCenter and the print builder write. */
const INLINE_LABEL_RE = /^([A-Za-z][A-Za-z /()&-]{2,34}?):\s+(.*)$/;

/**
 * Sentinels for lines that came out of a heading element. They are control
 * characters no clinical text contains, and they are inserted before the markup
 * is flattened so nothing downstream can confuse a heading with a sentence.
 *
 *  - HEADING_LINE: a section or region heading (`<h1-6>`, `<div class="section-heading">`).
 *  - CELL_HEAD_LINE: a table column header (`<th>`).
 *
 * Both are delimiters and NEVER content. That distinction is what makes this
 * rule safe: without it a Findings sentence that happens to name the canal
 * ("Canal AP diameter is 8.5 mm at L4-L5") reads as a measurement heading, the
 * section closes, and a finished lumbar spine report is refused as empty — and a
 * document title (`<h3>Radiology Report: MRI Brain</h3>`) reads as findings
 * prose, so an unfinished report is signed.
 */
const HEADING_LINE = "\u0001";
const CELL_HEAD_LINE = "\u0002";

/** Tag → sentinel-marked line, for the three heading shapes the producers use. */
function markHeadingLines(html: string): string {
  // A heading is flattened to one labelled line here, before the generic block
  // pass, so a `<br/>` inside one cannot split it and leak its tail into the
  // document as findings prose.
  const oneLine = (inner: string) => inner
    .replace(/<br\b[^>]*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let out = html;
  out = out.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_m, _tag: string, inner: string) => {
    const label = oneLine(inner);
    return label ? `\n${HEADING_LINE}${label}\n` : "\n";
  });
  out = out.replace(/<div\b[^>]*\bclass="[^"]*\bsection-heading\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, (_m, inner: string) => {
    const label = oneLine(inner);
    return label ? `\n${HEADING_LINE}${label}\n` : "\n";
  });
  out = out.replace(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi, (_m, inner: string) => {
    const label = oneLine(inner);
    return label ? `\n${CELL_HEAD_LINE}${label}\n` : "\n";
  });
  return out;
}

function isSentenceOfProducer(line: string): boolean {
  const trimmed = line.trim();
  return EMPTY_SECTION_SENTENCES.some(({ re }) => re.test(trimmed));
}

/**
 * Split a signed body into the sections it declares, keeping only authored
 * text in each.
 *
 * Same stripping pipeline as `extractAuthoredText` — non-content elements,
 * block boundaries, residual markup, entities, demographic labels — with one
 * difference: headings are kept as delimiters instead of dropped, because which
 * section a line sits under is the whole question here.
 */
export function signedReportSectionsOf(body: unknown): {
  declared: Set<SignedReportSection>;
  empty: SignedReportSection[];
  documentHasSections: boolean;
} {
  const declared = new Set<SignedReportSection>();
  const content: Record<SignedReportSection, string[]> = { findings: [], impression: [] };
  if (typeof body !== "string" || body.trim() === "") {
    return { declared, empty: [], documentHasSections: false };
  }

  // Structural evidence BEFORE flattening, and it is the only thing that can
  // open this rule at all. A short prose line with no terminal punctuation is
  // indistinguishable from a region heading once the tags are gone ("See
  // ultrasound report"), and refusing that would be the guard inventing a
  // section the radiologist never had. Every shipped producer emits one of
  // these three; a free-text body emits none and is judged only by the
  // blank/placeholder rules above.
  const documentHasSections = /class="[^"]*\bsection-heading\b/i.test(body)
    || /<h[1-6]\b/i.test(body)
    || Object.keys(SECTION_LABELS).some((label) => new RegExp(`(^|>)\\s*${escapeForRegExp(label)}\\s*:`, "i").test(body));

  let text = markHeadingLines(body);
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<\/?(?:table|thead|tbody|tr|td|ul|ol|li)\b[^>]*>/gi, "\n");
  text = text.replace(BLOCK_BOUNDARY, "\n");
  text = text.replace(/<[^>]*>/g, " ");
  text = decodeEntities(text);

  let current: SignedReportSection | "other" | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\u00a0/g, " ").trim();
    if (!line) continue;

    // A heading switches the section and contributes nothing itself. This is
    // the whole difference between this rule and `extractAuthoredText`, which
    // drops headings outright because it only asks "is there any text".
    if (line.startsWith(HEADING_LINE) || line.startsWith(CELL_HEAD_LINE)) {
      const fromCellHead = line.startsWith(CELL_HEAD_LINE);
      const heading = labelOfHeading(line.slice(1));
      if (heading === null) {
        // An unnamed structural heading is a Findings REGION: the live builder
        // prints Alignment, Canal Diameter and LIVER as `section-heading` divs
        // with the region's prose under them, and a rule keyed on the word
        // "Findings" alone would refuse every spine study in the clinic. A
        // `<th>` that names nothing is a measurement column header, which
        // belongs to no section and therefore does not open one either.
        if (!fromCellHead) current = "findings";
        continue;
      }
      if (heading !== "other") declared.add(heading);
      current = heading;
      continue;
    }

    // The text form of a known heading, with no markup around it: `IMPRESSION:`
    // at the start of a line is how the D1 body writes its sections. Only an
    // exact label from SECTION_LABELS qualifies — prose that merely mentions a
    // section word is content, not a heading.
    const bareLabel = SECTION_LABELS[normaliseLabel(line)];
    if (bareLabel !== undefined) {
      if (bareLabel !== "other") declared.add(bareLabel);
      current = bareLabel;
      continue;
    }

    // `Findings: text` on one line — and `Technique: text`, whose content
    // belongs to no section this rule judges, so it is dropped, not counted.
    const inline = INLINE_LABEL_RE.exec(line);
    const inlineLabel = inline ? labelOfHeading(inline[1]) : undefined;
    if (inline && inlineLabel !== null && inlineLabel !== undefined) {
      if (inlineLabel !== "other") declared.add(inlineLabel);
      current = inlineLabel;
      const rest = inline[2].trim();
      if (rest && inlineLabel !== "other" && !isSentenceOfProducer(rest)) content[inlineLabel].push(rest);
      continue;
    }

    // Demographic scaffolding never counts as section content.
    let contentLine = line;
    let scaffolded = false;
    for (const { label, dropsValue } of SCAFFOLD_LABELS) {
      const re = new RegExp(`^${escapeForRegExp(label)}\\s*:\\s*`, "i");
      if (!re.test(contentLine)) continue;
      contentLine = dropsValue ? "" : contentLine.replace(re, "").trim();
      scaffolded = true;
      break;
    }
    if (scaffolded && !contentLine) continue;
    if (isSentenceOfProducer(contentLine)) continue;
    if (classifyLines(contentLine).lines.length === 0) continue;

    // An unlabelled line inside a known section is its content; an unlabelled
    // line at the top of a structured document is a findings REGION heading's
    // prose (spine prints Alignment, Disc Level Analysis, Canal Diameter), so
    // the first such line opens Findings rather than leaving it empty.
    const section: SignedReportSection | null = current === "other"
      ? null
      : current ?? "findings";
    if (!section) continue;
    if (current === null) declared.add("findings");
    current = section;
    content[section].push(contentLine);
  }

  const empty: SignedReportSection[] = [];
  if (documentHasSections && content.findings.length === 0) empty.push("findings");
  if (declared.has("impression") && content.impression.length === 0) empty.push("impression");
  return { declared, empty, documentHasSections };
}

/**
 * Unresolved template placeholders — a `{name}` that survived every substitution.
 *
 * By the time a report reaches signature the workspace has already run
 * `fillStructuredTemplate` (which answers every `questions_json` key or drops the
 * `[optional clause]`) and `fillTemplate` (which resolves the five tokens it knows
 * and deletes an unfilled one). A brace that is still standing is therefore a
 * parameter no control ever answered — the `{size}` / `{location}` / `{volume}` /
 * `{swelling}` / `{grade}` / `{vessel}` leak the Quick Select audit measured, now
 * caught at the last door before a signature.
 *
 * The grammar is the disambiguation the brief asked for: only a letter-initial
 * identifier inside one pair of braces counts, and `{{…}}` is left to its own
 * existing line pattern. So ordinary clinical text a radiologist typed — `{ }`,
 * `{1, 2}`, `{'a': 1}`, `{ see note }`, `(L4)` — is never mistaken for a token.
 * It runs on the authored text (headings and fixed labels already stripped), so
 * template chrome cannot be read as a leak either.
 */
const UNRESOLVED_TEMPLATE_TOKEN = /(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g;

export function findUnresolvedTemplateTokens(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(UNRESOLVED_TEMPLATE_TOKEN)) found.add(match[1]);
  return Array.from(found);
}

/**
 * Judge a report body at signature time.
 *
 * `body` is typed `unknown` because it comes off a database `text` column read
 * back through Drizzle; a null/undefined must classify as empty rather than
 * throw inside the sign route.
 */
export function classifySignedReportBody(body: unknown): SignedReportContentClassification {
  if (typeof body !== "string" || body.trim() === "") {
    return {
      level: "empty",
      clinicalText: "",
      reasons: ["The report body is empty."],
      placeholders: [],
      emptySections: ["findings", "impression"],
    };
  }

  const clinicalText = extractAuthoredText(body);
  const { lines, placeholders } = classifyLines(clinicalText);
  const sections = signedReportSectionsOf(body);

  // Unresolved placeholders block a signature regardless of how much other
  // content the report has — one `{size}` stranded in an otherwise-complete
  // Findings is exactly as unsignable as a body of nothing but braces. Reported
  // at the `placeholder` level so the existing refusal, the
  // `report_content_placeholder` code, the audit's `placeholders` array and the
  // attributed override all apply without any new plumbing.
  const leaked = findUnresolvedTemplateTokens(clinicalText);
  if (leaked.length > 0) {
    const listed = leaked.map((t) => `{${t}}`).join(", ");
    return {
      level: "placeholder",
      clinicalText: lines.join("\n"),
      reasons: [
        `The report still contains unresolved template placeholder${leaked.length === 1 ? "" : "s"} — ${listed} — with no value filled in. Resolve ${leaked.length === 1 ? "it" : "them"} before signing.`,
      ],
      placeholders: [...new Set([...placeholders, ...leaked.map((t) => `{${t}}`)])],
      emptySections: sections.empty,
    };
  }

  if (lines.length === 0) {
    if (placeholders.length > 0) {
      return {
        level: "placeholder",
        clinicalText: "",
        reasons: [
          `The report body contains only ${placeholders.join(", ")} text — no findings were authored.`,
        ],
        placeholders,
        emptySections: sections.empty,
      };
    }
    return {
      level: "empty",
      clinicalText: "",
      reasons: [
        "The report body contains no authored text once its headings and fixed labels are removed.",
      ],
      placeholders: [],
      emptySections: sections.empty.length > 0 ? sections.empty : ["findings", "impression"],
    };
  }

  // Nothing is blank, but the document may still be unfinished in the one place
  // a radiologist reads first. Ruling 3 (owner, 2026-11-06): "Empty Findings →
  // BLOCK signing, with a documented override for exceptional cases." An
  // Impression is only judged when the document rendered the heading and left it
  // empty; a report with no Impression section at all stays signable, because a
  // normal study legitimately has findings and no impression, and refusing that
  // would be the guard inventing a policy the codebase does not express.
  if (sections.empty.length > 0) {
    const named = sections.empty.map((s) => (s === "findings" ? "Findings" : "Impression"));
    return {
      level: "incomplete",
      clinicalText: lines.join("\n"),
      reasons: [
        `The ${named.join(" and ")} section${named.length === 1 ? " is" : "s are"} empty, so the report `
        + `${named.length === 1 ? "says nothing about " + (named[0] === "Findings" ? "what the examination showed" : "the conclusion drawn from it") : "says nothing about what the examination showed or what it means"}.`,
      ],
      placeholders: [],
      emptySections: sections.empty,
    };
  }

  return { level: "ok", clinicalText: lines.join("\n"), reasons: [], placeholders, emptySections: [] };
}

/**
 * The floor for an override reason, set by the owner on 2026-11-06 for F2.
 *
 * Deliberately NOT the soft-final/PCPNDT minimum any more (internal-radiology.ts
 * still uses three characters there). Three characters made a signature
 * overrideable with "x", which is a click with the shape of a reason rather than
 * a reason: the audit row then records nothing a reader can act on, and the
 * person reviewing the register months later cannot tell "dictation to follow"
 * from a radiologist who did not read the warning. A blank-or-placeholder
 * document still signed anyway is the one audit row in this system that has to
 * explain itself in prose, so it has to be forced to.
 */
export const CONTENT_OVERRIDE_MIN_REASON = 15;

/**
 * The 409 body both enforcement points answer with.
 *
 * Lives here rather than in the route so the wording is testable without a
 * database: the message is built by concatenation, and a missing space between
 * two of the parts is invisible in a code read but is what the signer actually
 * sees.
 *
 * A refusal is never a dead end — `override.allowed` is always true, because the
 * signer is the person attesting that the document says what they mean and must
 * retain the authority to sign it anyway. The override is attributed and
 * audited; see readContentOverride().
 *
 * The human sentence goes in `error` and the machine token in `code`, not the
 * other way round: sanitizeApiErrorMessage (fetchApi.ts) returns `error` verbatim
 * unless it is one of a few generic strings, so a machine token in `error` is
 * what the signer's toast would read and the override instructions would never
 * be seen. Same split this file already uses for RadiologyIdentityError.
 */
export function signedContentRefusal(content: SignedReportContentClassification) {
  const whatToDo =
    ` Pass contentOverride: true with a contentOverrideReason of at least ${CONTENT_OVERRIDE_MIN_REASON} characters`
    + " to proceed with the report as it stands; the override is attributed and audited.";
  const sentence = content.level === "empty"
    ? "This report has no authored content, so it cannot be finalized or signed as a blank document. "
      + content.reasons.join(" ")
    : content.level === "incomplete"
      ? `This report is unfinished — ${(content.emptySections ?? [])
        .map((s) => (s === "findings" ? "Findings" : "Impression"))
        .join(" and ")} ${content.emptySections?.length === 1 ? "is" : "are"} empty —`
        + " so it cannot be signed as a partial document."
      : `This report still contains placeholder text (${content.placeholders.join(", ")}),`
        + " so it cannot be finalized or signed as an unfinished document.";
  return {
    error: sentence + whatToDo,
    code: `report_content_${content.level}`,
    level: content.level,
    reasons: content.reasons,
    placeholders: content.placeholders,
    sections: content.emptySections,
    override: {
      allowed: true,
      flag: "contentOverride",
      reasonField: "contentOverrideReason",
      minReasonChars: CONTENT_OVERRIDE_MIN_REASON,
    },
  };
}

/**
 * An explicit boolean plus a reason of at least CONTENT_OVERRIDE_MIN_REASON
 * characters — the reason is judged after trimming, so padding is not length.
 * Unlike SOFT_FINAL_BLOCKED this is NOT restricted to admin roles: a
 * blank-or-placeholder report is a judgement about the signer's own text, not an
 * administrative bypass. Returns the reason to audit, or null when there is no
 * valid override.
 */
export function readContentOverride(body: Record<string, unknown>): string | null {
  if (body.contentOverride !== true) return null;
  const reason = typeof body.contentOverrideReason === "string" ? body.contentOverrideReason.trim() : "";
  return reason.length >= CONTENT_OVERRIDE_MIN_REASON ? reason : null;
}
