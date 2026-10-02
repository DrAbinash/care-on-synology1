/**
 * Reading a STORED patient_reports body back into clinical sections.
 *
 * `patient_reports.body` for a radiology report is trusted, already-rendered
 * HTML — not plain findings text. Five writers produce it and they do not agree
 * on shape: the reporting workspace emits `.section-heading` divs, its own rows
 * from before that change and the USG companion emit `<h2>`/`<h3>`, the command
 * centre emits `<h3>`/`<h4>` plus inline `<strong>Label:</strong>` paragraphs,
 * the reporting studio emits bare `<h3>`, and the D5 structured writer stores
 * plain text with `FINDINGS:` / `IMPRESSION:` line labels.
 *
 * Any consumer that treats that column as narrative text — comparing it against
 * a prior study, copying it into an editor, showing it inline — injects markup
 * into the clinical record. This module is the one place that knows the shapes.
 */
import { parseReportHtmlToBlocks, type InlineSegment } from "./radiologyReportWordExport";

export type StoredReportSections = {
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  /** The whole body in document order, as readable plain text. */
  fullText: string;
};

type SectionKey = "clinicalHistory" | "technique" | "findings" | "impression" | "recommendation";

const LABEL_TO_SECTION: Record<string, SectionKey> = {
  "CLINICAL HISTORY": "clinicalHistory",
  "HISTORY": "clinicalHistory",
  "CLINICAL INFORMATION": "clinicalHistory",
  "CLINICAL INFO": "clinicalHistory",
  "TECHNIQUE": "technique",
  "STUDY TECHNIQUE": "technique",
  "PROTOCOL": "technique",
  "FINDINGS": "findings",
  "FINDING": "findings",
  "RADIOLOGICAL FINDINGS": "findings",
  "OBSERVATIONS": "findings",
  "IMPRESSION": "impression",
  "IMPRESSIONS": "impression",
  "CONCLUSION": "impression",
  "CONCLUSIONS": "impression",
  "RECOMMENDATION": "recommendation",
  "RECOMMENDATIONS": "recommendation",
  "ADVICE": "recommendation",
  "SUGGESTIONS": "recommendation",
};

const SECTION_ORDER: SectionKey[] = [
  "clinicalHistory", "technique", "findings", "impression", "recommendation",
];

/** Uppercase, single-spaced, trailing punctuation removed — so "Findings:",
 *  "FINDINGS" and "Findings." are the same label. */
function normalizeLabel(raw: string): string {
  return raw.replace(/[\u00A0\s]+/g, " ").replace(/[:.\u2013\u2014-]+$/g, "").trim().toUpperCase();
}

function sectionOfLabel(raw: string): SectionKey | null {
  return LABEL_TO_SECTION[normalizeLabel(raw)] ?? null;
}

/** A leading `Label:` inline label, as `<b>Findings:</b>` / `<strong>Technique:</strong>`. */
const INLINE_LABEL_RE = /^([A-Za-z][A-Za-z /]{2,30}):\s*/;

function segmentsToLines(segments: InlineSegment[]): string[] {
  const lines: string[] = [""];
  for (const seg of segments) {
    if (seg.isBreak) { lines.push(""); continue; }
    lines[lines.length - 1] += seg.text;
  }
  return lines.map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean);
}

export type ParseStoredBodyOpts = {
  /** The row's own `title` column, so a leading document-title heading is not
   *  mistaken for a findings sub-heading. */
  title?: string | null;
};

export function parseStoredReportBody(
  body: string | null | undefined,
  opts: ParseStoredBodyOpts = {},
): StoredReportSections {
  const buckets: Record<SectionKey, string[]> = {
    clinicalHistory: [], technique: [], findings: [], impression: [], recommendation: [],
  };
  const allLines: string[] = [];
  let current: SectionKey | null = null;

  const addLines = (lines: string[]) => {
    for (const line of lines) {
      allLines.push(line);
      if (current) buckets[current].push(line);
    }
  };
  const addHeading = (label: string) => {
    allLines.push(`${normalizeLabel(label)}:`);
  };

  const raw = String(body ?? "");
  const normalizedTitle = opts.title ? normalizeLabel(opts.title) : "";
  let seenBlock = false;

  if (!/<[a-z/!?]/i.test(raw)) {
    // D5 structured writer: plain text with `LABEL:` lines and no markup at all.
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = INLINE_LABEL_RE.exec(trimmed);
      const labelled = m ? sectionOfLabel(m[1]) : null;
      if (labelled) {
        current = labelled;
        addHeading(m![1]);
        const rest = trimmed.slice(m![0].length).trim();
        if (rest) addLines([rest]);
        continue;
      }
      addLines([trimmed]);
    }
    return finish(buckets, allLines);
  }

  for (const block of parseReportHtmlToBlocks(raw)) {
    if (block.type === "divider") continue;

    if (block.type === "heading1" || block.type === "heading2") {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const known = sectionOfLabel(text);
      if (known) { seenBlock = true; current = known; addHeading(text); continue; }
      // The document title is not a section. Every writer that emits one puts it
      // first (command centre `<h3>Radiology Report: T</h3>`, USG companion
      // `<h2>studyDescription</h2>`), so position identifies it even when the
      // caller could not supply the row's own `title` column to match against.
      if (!seenBlock) { seenBlock = true; continue; }
      if (normalizedTitle && normalizeLabel(text).endsWith(normalizedTitle)) { seenBlock = true; continue; }
      // An unrecognised heading inside the narrative is a findings sub-heading
      // (USG organ cards, structured per-region formats). Once the report has
      // reached Impression or Recommendation it belongs to that section.
      seenBlock = true;
      if (current !== "impression" && current !== "recommendation") current = "findings";
      addLines([text]);
      continue;
    }

    if (block.type === "list") {
      seenBlock = true;
      for (const item of block.items) addLines(segmentsToLines(item));
      continue;
    }

    seenBlock = true;
    // paragraph — a leading inline label only switches section when it is a
    // known one, so "Patient Name:" stays ordinary text.
    const first = block.segments[0];
    const inline = first ? INLINE_LABEL_RE.exec(first.text) : null;
    const labelled = inline ? sectionOfLabel(inline[1]) : null;
    if (inline && labelled) {
      current = labelled;
      addHeading(inline[1]);
      const remainder = first!.text.slice(inline[0].length);
      addLines(segmentsToLines(
        remainder ? [{ ...first!, text: remainder }, ...block.segments.slice(1)] : block.segments.slice(1),
      ));
      continue;
    }
    addLines(segmentsToLines(block.segments));
  }

  return finish(buckets, allLines);
}

function finish(
  buckets: Record<SectionKey, string[]>,
  allLines: string[],
): StoredReportSections {
  const out = {
    clinicalHistory: "", technique: "", findings: "", impression: "", recommendation: "",
    fullText: allLines.join("\n").trim(),
  } as StoredReportSections;
  for (const key of SECTION_ORDER) out[key] = buckets[key].join("\n").trim();
  return out;
}
