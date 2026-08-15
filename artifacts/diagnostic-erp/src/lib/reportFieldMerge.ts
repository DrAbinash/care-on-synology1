/**
 * reportFieldMerge.ts — canonical semantic-aware merge for report fields.
 *
 * ONE shared entry point for Quick Select, Quick Findings, protocol, template,
 * macro and companion insertions into technique / findings / impression /
 * recommendation. No external AI calls — deterministic, conservative rules.
 *
 * Clinical report text stays plain strings. Provenance is a parallel map keyed
 * by normalizeForDedupe(sentence) — never duplicated into stored/preview text.
 */

export type ReportFieldKey = "technique" | "findings" | "impression" | "recommendation" | "clinicalHistory";

export type InsertSource =
  | "manual"
  | "quick-select"
  | "quick-findings"
  | "protocol"
  | "template"
  | "template-a"
  | "template-b"
  | "macro"
  | "companion"
  | "ai-draft";

/** normalizeForDedupe(sentence) → contributing sources (deduped, stable order). */
export type FieldProvenanceMap = Record<string, InsertSource[]>;

export interface MergeOptions {
  field: ReportFieldKey;
  existing: string;
  incoming: string;
  source?: InsertSource;
  existingProvenance?: FieldProvenanceMap;
}

export interface MergeWithProvenanceResult {
  text: string;
  provenance: FieldProvenanceMap;
}

interface AnnotatedSentence {
  text: string;
  sources: Set<InsertSource>;
}

const SOURCE_ORDER: InsertSource[] = [
  "manual",
  "quick-select",
  "quick-findings",
  "protocol",
  "template",
  "template-a",
  "template-b",
  "macro",
  "companion",
  "ai-draft",
];

const SOURCE_LABELS: Record<InsertSource, string> = {
  manual: "Manual",
  "quick-select": "Quick Select",
  "quick-findings": "Quick Findings",
  protocol: "Protocol",
  template: "Template",
  "template-a": "Format A",
  "template-b": "Format B",
  macro: "Macro",
  companion: "Companion",
  "ai-draft": "AI Draft",
};

/** Normalize for duplicate detection: lowercase, strip punctuation, collapse whitespace. */
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a block into sentence-ish lines for line-level dedupe. */
export function splitToSentences(block: string): string[] {
  return block
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sourceLabel(source: InsertSource): string {
  return SOURCE_LABELS[source] ?? source;
}

export function sortSources(sources: Iterable<InsertSource>): InsertSource[] {
  const set = new Set(sources);
  return SOURCE_ORDER.filter((s) => set.has(s));
}

export function formatProvenanceHover(sources: InsertSource[]): string {
  const sorted = sortSources(sources);
  if (sorted.length === 0 || (sorted.length === 1 && sorted[0] === "manual")) {
    return "Source: Manual";
  }
  if (sorted.length === 1) {
    return `Source: ${sourceLabel(sorted[0]!)}`;
  }
  return `Merged: ${sorted.map(sourceLabel).join(" + ")}`;
}

/** Visual bucket for editor tinting (QS blue / QF green / merged / manual / other). */
export type ProvenanceVisualKind = "manual" | "quick-select" | "quick-findings" | "merged" | "template-a" | "template-b" | "other";

export function provenanceVisualKind(sources: InsertSource[]): ProvenanceVisualKind {
  const sorted = sortSources(sources).filter((s) => s !== "manual");
  if (sorted.length === 0) return "manual";
  if (sorted.length > 1) return "merged";
  if (sorted[0] === "quick-select") return "quick-select";
  if (sorted[0] === "quick-findings") return "quick-findings";
  if (sorted[0] === "template-a") return "template-a";
  if (sorted[0] === "template-b") return "template-b";
  return "other";
}

export function provenanceFromText(text: string, source: InsertSource): FieldProvenanceMap {
  const out: FieldProvenanceMap = {};
  for (const s of splitToSentences(text)) {
    const key = normalizeForDedupe(s);
    if (!key) continue;
    out[key] = sortSources([...(out[key] ?? []), source]);
  }
  return out;
}

export function provenanceMapToSegments(
  text: string,
  provenance: FieldProvenanceMap,
): Array<{ text: string; sources: InsertSource[]; key: string }> {
  return splitToSentences(text).map((s) => {
    const key = normalizeForDedupe(s);
    const sources = sortSources(provenance[key] ?? ["manual"]);
    return { text: s, sources, key };
  });
}

/**
 * After manual typing/editing: keep provenance only for sentences whose
 * normalized key still matches. Changed or new sentences → manual.
 * Never rewrites clinical text.
 */
export function reconcileProvenanceAfterManualEdit(
  _previousText: string,
  nextText: string,
  previousProvenance: FieldProvenanceMap,
): FieldProvenanceMap {
  const out: FieldProvenanceMap = {};
  for (const s of splitToSentences(nextText)) {
    const key = normalizeForDedupe(s);
    if (!key) continue;
    const prev = previousProvenance[key];
    out[key] = prev && prev.length > 0 ? sortSources(prev) : ["manual"];
  }
  return out;
}

function annotateExisting(text: string, provenance: FieldProvenanceMap): AnnotatedSentence[] {
  return splitToSentences(text).map((s) => {
    const key = normalizeForDedupe(s);
    const sources = new Set<InsertSource>(provenance[key] ?? ["manual"]);
    return { text: s, sources };
  });
}

function segmentsToResult(segments: AnnotatedSentence[], joinWith: "\n" | " "): MergeWithProvenanceResult {
  const provenance: FieldProvenanceMap = {};
  for (const seg of segments) {
    const key = normalizeForDedupe(seg.text);
    if (!key) continue;
    const existing = provenance[key] ?? [];
    provenance[key] = sortSources([...existing, ...seg.sources]);
  }
  const text = segments.map((s) => s.text).join(joinWith);
  return { text, provenance };
}

// ─── Technique concept extraction (deterministic, no AI) ────────────────────

const TECHNIQUE_CONCEPTS: Array<{ key: string; pattern: RegExp }> = [
  { key: "scanner-3t", pattern: /\b(3\s*t|3\s*tesla|3t)\b/i },
  { key: "scanner-1.5t", pattern: /\b(1\.5\s*t|1\.5\s*tesla)\b/i },
  { key: "contrast", pattern: /\b(contrast|gadolinium|post[- ]contrast)\b/i },
  { key: "multiplanar", pattern: /\b(multiplanar|multi[- ]planar)\b/i },
  { key: "multisequence", pattern: /\b(multisequence|multi[- ]sequence)\b/i },
  { key: "t1", pattern: /\bt1w?\b/i },
  { key: "t2", pattern: /\bt2w?\b/i },
  { key: "flair", pattern: /\bflair\b/i },
  { key: "dwi", pattern: /\b(dwi|diffusion)\b/i },
  { key: "swi", pattern: /\bswi\b/i },
  { key: "adc", pattern: /\badc\b/i },
];

function techniqueConcepts(text: string): Set<string> {
  const out = new Set<string>();
  const norm = normalizeForDedupe(text);
  for (const c of TECHNIQUE_CONCEPTS) {
    if (c.pattern.test(text) || c.pattern.test(norm)) out.add(c.key);
  }
  return out;
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeForDedupe(text).split(" ").filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Two MRI technique paragraphs that paraphrase the same scan → keep one. */
function findTechniqueParaphraseIndex(segments: AnnotatedSentence[], incoming: string): number {
  const incTokens = tokenSet(incoming);
  if (incTokens.size < 4) return -1;
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < segments.length; i++) {
    const score = jaccard(incTokens, tokenSet(segments[i]!.text));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.55 ? best : -1;
}

/**
 * Technique merge: exact/normalized dedupe + concept-aware merging.
 * When a duplicate is dropped, its source is unioned onto the kept sentence.
 */
export function mergeTechniqueWithProvenance(
  existing: string,
  incoming: string,
  existingProvenance: FieldProvenanceMap,
  source: InsertSource,
): MergeWithProvenanceResult {
  const inc = incoming.trim();
  if (!inc) {
    return { text: existing, provenance: { ...existingProvenance } };
  }

  const segments = annotateExisting(existing, existingProvenance);
  const existingNorm = new Map<string, number>();
  const existingConcepts = new Set<string>();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    existingNorm.set(normalizeForDedupe(seg.text), i);
    for (const c of techniqueConcepts(seg.text)) existingConcepts.add(c);
  }

  const incomingSentences = splitToSentences(inc);
  const keptIncoming: AnnotatedSentence[] = [];

  for (const s of incomingSentences) {
    const n = normalizeForDedupe(s);
    if (!n) continue;

    const dupIdx = existingNorm.get(n);
    if (dupIdx !== undefined) {
      segments[dupIdx]!.sources.add(source);
      continue;
    }

    const paraphraseIdx = findTechniqueParaphraseIndex(segments, s);
    if (paraphraseIdx >= 0) {
      const kept = segments[paraphraseIdx]!;
      if (s.length > kept.text.length) kept.text = s;
      kept.sources.add(source);
      continue;
    }

    const sConcepts = techniqueConcepts(s);
    const newConcepts = [...sConcepts].filter((c) => !existingConcepts.has(c));
    if (sConcepts.size > 0 && newConcepts.length === 0) {
      // Concept-covered near-duplicate — attribute onto covering segments.
      for (const seg of segments) {
        const shared = [...techniqueConcepts(seg.text)].some((c) => sConcepts.has(c));
        if (shared) seg.sources.add(source);
      }
      continue;
    }

    keptIncoming.push({ text: s, sources: new Set([source]) });
    for (const c of sConcepts) existingConcepts.add(c);
    existingNorm.set(n, segments.length + keptIncoming.length - 1);
  }

  const all = [...segments, ...keptIncoming];
  if (keptIncoming.length === 0 && segments.length === 0) {
    return { text: "", provenance: {} };
  }
  if (keptIncoming.length === 0) {
    return segmentsToResult(segments, "\n");
  }
  // Preserve prior layout: existing block + space-joined new sentences (same as mergeTechnique).
  const base = segments.map((s) => s.text).join("\n").trimEnd();
  const added = keptIncoming.map((s) => s.text).join(" ");
  const text = base ? `${base}\n${added}` : added;
  const provenance: FieldProvenanceMap = {};
  for (const seg of all) {
    const key = normalizeForDedupe(seg.text);
    if (!key) continue;
    provenance[key] = sortSources([...(provenance[key] ?? []), ...seg.sources]);
  }
  return { text, provenance };
}

export function mergeTechnique(existing: string, incoming: string): string {
  return mergeTechniqueWithProvenance(existing, incoming, {}, "manual").text;
}

// ─── Findings / impression / recommendation ─────────────────────────────────

/** Clinical tokens that make two findings materially different — never merge across these. */
const CLINICAL_GUARDS = [
  /\b(left|right|bilateral)\b/i,
  /\b(l[1-5]|c[1-7]|t[1-12]|s[1-5])\b/i,
  /\b(mild|moderate|severe|grade\s*[1-4])\b/i,
  /\b\d+(\.\d+)?\s*(mm|cm)\b/i,
];

function hasConflictingClinicalDetail(a: string, b: string): boolean {
  for (const re of CLINICAL_GUARDS) {
    const ma = a.match(re);
    const mb = b.match(re);
    if (ma && mb && ma[0].toLowerCase() !== mb[0].toLowerCase()) return true;
  }
  return false;
}

/**
 * Merge free-text findings/impression/recommendation with provenance.
 * Deduped/near-merged sentences union their sources.
 */
export function mergeSentencesWithProvenance(
  existing: string,
  incoming: string,
  existingProvenance: FieldProvenanceMap,
  source: InsertSource,
): MergeWithProvenanceResult {
  const inc = incoming.trim();
  if (!inc) {
    return { text: existing, provenance: { ...existingProvenance } };
  }

  const out = annotateExisting(existing, existingProvenance);
  const normSeen = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    normSeen.set(normalizeForDedupe(out[i]!.text), i);
  }

  for (const s of splitToSentences(inc)) {
    const n = normalizeForDedupe(s);
    if (!n) continue;

    const dupIdx = normSeen.get(n);
    if (dupIdx !== undefined) {
      out[dupIdx]!.sources.add(source);
      continue;
    }

    let merged = false;
    for (let i = 0; i < out.length; i++) {
      const o = out[i]!;
      const on = normalizeForDedupe(o.text);
      if (hasConflictingClinicalDetail(o.text, s)) continue;
      const shorter = on.length <= n.length ? on : n;
      const longer = on.length <= n.length ? n : on;
      const shorterWords = shorter.split(" ").filter(Boolean);
      const longerWords = longer.split(" ").filter(Boolean);
      const isSubsequence = shorterWords.every((w) => longerWords.includes(w));
      if (isSubsequence && shorterWords.length >= 2) {
        if (s.length > o.text.length) {
          // Keep longer text; union sources (clinical text already chosen by merge rules).
          o.text = s;
          normSeen.delete(on);
          normSeen.set(n, i);
        }
        o.sources.add(source);
        merged = true;
        break;
      }
    }
    if (!merged) {
      out.push({ text: s, sources: new Set([source]) });
      normSeen.set(n, out.length - 1);
    }
  }

  return segmentsToResult(out, "\n");
}

export function mergeSentences(existing: string, incoming: string): string {
  return mergeSentencesWithProvenance(existing, incoming, {}, "manual").text;
}

/** Provenance-aware canonical entry point. */
export function mergeReportFieldContentWithProvenance(opts: MergeOptions): MergeWithProvenanceResult {
  const { field, existing, incoming, source = "manual", existingProvenance = {} } = opts;
  if (!incoming.trim()) {
    return { text: existing, provenance: { ...existingProvenance } };
  }
  if (field === "technique") {
    return mergeTechniqueWithProvenance(existing, incoming, existingProvenance, source);
  }
  return mergeSentencesWithProvenance(existing, incoming, existingProvenance, source);
}

/** Canonical entry point used by all insertion tools (text only). */
export function mergeReportFieldContent(opts: MergeOptions): string {
  return mergeReportFieldContentWithProvenance(opts).text;
}
