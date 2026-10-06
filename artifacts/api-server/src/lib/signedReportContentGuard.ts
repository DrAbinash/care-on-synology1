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
 *  - No required-section rule. A normal study legitimately has findings and no
 *    impression; deciding which sections are mandatory would be inventing
 *    policy the codebase does not already express.
 *  - No opinion on correctness. Contradiction and consistency checking lives in
 *    structuredReport/validator.ts (R7/R15) and stays there.
 *
 * The only question asked is: after removing markup and the parts of the
 * template that producers emit unconditionally, did the radiologist author any
 * characters at all?
 */

export type SignedReportContentLevel = "empty" | "placeholder" | "ok";

export type SignedReportContentClassification = {
  level: SignedReportContentLevel;
  /** The authored text that survived stripping — exactly what was judged. */
  clinicalText: string;
  /** Plain-language reasons, safe to show the signer verbatim. */
  reasons: string[];
  /** Placeholder tokens recognised, for the audit payload. */
  placeholders: string[];
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
    };
  }

  const clinicalText = extractAuthoredText(body);
  const { lines, placeholders } = classifyLines(clinicalText);

  if (lines.length === 0) {
    if (placeholders.length > 0) {
      return {
        level: "placeholder",
        clinicalText: "",
        reasons: [
          `The report body contains only ${placeholders.join(", ")} text — no findings were authored.`,
        ],
        placeholders,
      };
    }
    return {
      level: "empty",
      clinicalText: "",
      reasons: [
        "The report body contains no authored text once its headings and fixed labels are removed.",
      ],
      placeholders: [],
    };
  }

  return { level: "ok", clinicalText: lines.join("\n"), reasons: [], placeholders };
}

/** Same minimum the soft-final override uses (internal-radiology.ts). */
export const CONTENT_OVERRIDE_MIN_REASON = 3;

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
  return {
    error: content.level === "empty"
      ? "This report has no authored content, so it cannot be finalized or signed as a blank document. "
        + content.reasons.join(" ") + whatToDo
      : `This report still contains placeholder text (${content.placeholders.join(", ")}),`
        + " so it cannot be finalized or signed as an unfinished document." + whatToDo,
    code: `report_content_${content.level}`,
    level: content.level,
    reasons: content.reasons,
    placeholders: content.placeholders,
    override: {
      allowed: true,
      flag: "contentOverride",
      reasonField: "contentOverrideReason",
      minReasonChars: CONTENT_OVERRIDE_MIN_REASON,
    },
  };
}

/**
 * Mirrors the soft-final override contract: an explicit boolean plus a reason of
 * at least three characters. Unlike SOFT_FINAL_BLOCKED this is NOT restricted to
 * admin roles — a blank-or-placeholder report is a judgement about the signer's
 * own text, not an administrative bypass. Returns the reason to audit, or null
 * when there is no valid override.
 */
export function readContentOverride(body: Record<string, unknown>): string | null {
  if (body.contentOverride !== true) return null;
  const reason = typeof body.contentOverrideReason === "string" ? body.contentOverrideReason.trim() : "";
  return reason.length >= CONTENT_OVERRIDE_MIN_REASON ? reason : null;
}
