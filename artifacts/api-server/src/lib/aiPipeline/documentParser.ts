/**
 * Deterministic document parsing after OCR — never invents findings.
 * Preserves page boundaries and common radiology report sections when present.
 */

export interface ExtractedSections {
  patientDetails?: string;
  clinicalHistory?: string;
  technique?: string;
  findings?: string;
  impression?: string;
  advice?: string;
  other?: string;
}

export interface ParsedDocument {
  rawText: string;
  normalizedText: string;
  sections: ExtractedSections;
  measurements: Array<{ label: string; value: string; unit?: string; laterality?: string }>;
  lateralityMentions: string[];
  pipelineVersion: string;
  parsedAt: string;
}

const SECTION_PATTERNS: Array<{ key: keyof ExtractedSections; re: RegExp }> = [
  { key: "patientDetails", re: /^(?:patient\s*(?:details|information|name)|demographics)\s*[:\-]?/i },
  { key: "clinicalHistory", re: /^(?:clinical\s*history|history|indication|clinical\s*information)\s*[:\-]?/i },
  { key: "technique", re: /^(?:technique|protocol|method)\s*[:\-]?/i },
  { key: "findings", re: /^(?:findings|observation[s]?)\s*[:\-]?/i },
  { key: "impression", re: /^(?:impression|conclusion|opinion|diagnosis)\s*[:\-]?/i },
  { key: "advice", re: /^(?:advice|recommendation[s]?|suggest(?:ion|ed)?)\s*[:\-]?/i },
];

const MEASUREMENT_RE =
  /\b([A-Za-z][A-Za-z0-9\/\-\s]{0,40}?)\s*[:=\-]?\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|ml|hu|%|bpm)?\b/gi;

const LATERALITY_RE = /\b(left|right|bilateral|unilateral|L\/R|R\/L)\b/gi;

/** Normalize whitespace without destroying medical line structure. */
export function normalizeOcrText(raw: string): string {
  return (raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function parseDocumentFromOcr(rawText: string, pipelineVersion = "care-ai-ocr-v1"): ParsedDocument {
  const normalizedText = normalizeOcrText(rawText);
  const lines = normalizedText.split("\n");
  const sections: ExtractedSections = {};
  let current: keyof ExtractedSections | null = null;
  const buckets: Partial<Record<keyof ExtractedSections, string[]>> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let matched = false;
    for (const { key, re } of SECTION_PATTERNS) {
      if (re.test(trimmed)) {
        current = key;
        matched = true;
        const rest = trimmed.replace(re, "").trim();
        if (!buckets[key]) buckets[key] = [];
        if (rest) buckets[key]!.push(rest);
        break;
      }
    }
    if (!matched) {
      const key = current ?? "other";
      if (!buckets[key]) buckets[key] = [];
      buckets[key]!.push(trimmed);
    }
  }

  for (const key of Object.keys(buckets) as (keyof ExtractedSections)[]) {
    sections[key] = buckets[key]!.join("\n");
  }

  const measurements: ParsedDocument["measurements"] = [];
  let m: RegExpExecArray | null;
  const measRe = new RegExp(MEASUREMENT_RE.source, "gi");
  while ((m = measRe.exec(normalizedText)) !== null) {
    const label = m[1]!.trim();
    if (label.length < 2) continue;
    measurements.push({
      label,
      value: m[2]!,
      unit: m[3] || undefined,
    });
    if (measurements.length >= 80) break;
  }

  const lateralityMentions = Array.from(
    new Set((normalizedText.match(LATERALITY_RE) || []).map((s) => s.toLowerCase())),
  );

  return {
    rawText,
    normalizedText,
    sections,
    measurements,
    lateralityMentions,
    pipelineVersion,
    parsedAt: new Date().toISOString(),
  };
}