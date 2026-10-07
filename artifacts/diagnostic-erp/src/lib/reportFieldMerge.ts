/**
 * reportFieldMerge.ts — the shared text merge for report fields.
 *
 * ONE shared entry point for Quick Select, Quick Findings, protocol, template,
 * macro and companion insertions into technique / findings / impression /
 * recommendation. No external AI calls — deterministic, conservative rules.
 *
 * "Conservative" is the whole contract, and since B-02 the findings/impression/
 * recommendation path means exactly that: an incoming sentence collapses onto an
 * existing one only when the two are the same text under normalization. The merge
 * layer is a composition tool, not a clinical reasoner — it never decides that a
 * sentence implies another sentence, which one of two conflicting statements is
 * better, or that a restatement may be dropped. Where a clinical statement really
 * does supersede another, that is proved by structured ownership
 * (`pathologyPatch.ts` / the Observation Ledger), not here. Since B-02A the
 * Technique path follows the same rule: see `mergeTechniqueWithProvenance`.
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
  | "quick-normal"
  | "template-a"
  | "template-b"
  | "structured-template"
  | "structured-template-candidate"
  | "macro"
  | "abnormal-pattern"
  | "companion"
  | "ai-draft"
  | "radiologist-voice"
  | "system";

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
  "quick-normal",
  "template-a",
  "template-b",
  "structured-template",
  "structured-template-candidate",
  "macro",
  "abnormal-pattern",
  "companion",
  "ai-draft",
  "radiologist-voice",
  "system",
];

const SOURCE_LABELS: Record<InsertSource, string> = {
  manual: "Manual",
  "quick-select": "Quick Select",
  "quick-findings": "Quick Findings",
  protocol: "Protocol",
  template: "Template",
  "quick-normal": "Quick Normal",
  "template-a": "Format A",
  "template-b": "Format B",
  "structured-template": "Structured",
  "structured-template-candidate": "Structured (impression)",
  macro: "Macro",
  "abnormal-pattern": "Abnormal pattern",
  companion: "Companion",
  "ai-draft": "AI Draft",
  "radiologist-voice": "Voice (radiologist)",
  system: "System",
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
export type ProvenanceVisualKind =
  | "manual"
  | "quick-select"
  | "quick-findings"
  | "merged"
  | "template-a"
  | "template-b"
  | "structured-template"
  | "structured-candidate"
  | "other";

export function provenanceVisualKind(sources: InsertSource[]): ProvenanceVisualKind {
  const sorted = sortSources(sources).filter((s) => s !== "manual");
  if (sorted.length === 0) return "manual";
  if (sorted.length > 1) return "merged";
  if (sorted[0] === "quick-select") return "quick-select";
  if (sorted[0] === "quick-findings") return "quick-findings";
  if (sorted[0] === "template-a") return "template-a";
  if (sorted[0] === "template-b") return "template-b";
  if (sorted[0] === "structured-template") return "structured-template";
  if (sorted[0] === "structured-template-candidate") return "structured-candidate";
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
  previousText: string,
  nextText: string,
  previousProvenance: FieldProvenanceMap,
): FieldProvenanceMap {
  const out: FieldProvenanceMap = {};
  for (const s of splitToSentences(nextText)) {
    const key = normalizeForDedupe(s);
    if (!key) continue;
    const exact = previousProvenance[key];
    if (exact && exact.length > 0) {
      out[key] = sortSources(exact);
      continue;
    }
    const fuzzy = findFuzzyProvenanceMatch(s, previousText, previousProvenance);
    out[key] = fuzzy ?? ["manual"];
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

// ─── Sentence similarity (provenance attribution only, never text) ──────────

/*
 * B-02A removed `TECHNIQUE_CONCEPTS` / `techniqueConcepts` /
 * `findTechniqueParaphraseIndex` from this file. They powered two rules that
 * deleted acquisition facts from the Technique field:
 *
 *   - a Jaccard score ≥ 0.55 folded an incoming sentence onto an existing one and
 *     let the LONGER of the two stand, so
 *     "MRI of the brain was performed on a 1.5T scanner." + "Multiplanar
 *     multisequence MRI of the brain was performed." printed one line, without
 *     the field strength — in either arrival order;
 *   - if every concept the eleven hard-coded patterns could see was already
 *     present, the incoming sentence was dropped whole. STIR, the plane
 *     descriptors, slice thickness, MRA/MRV, spectroscopy, fat saturation,
 *     screening wording and technical limitations were invisible to that list, so
 *     a real fact could be discarded as "already covered". Cross-pairwise over
 *     every shipped Technique text, the old rule lost at least one acquisition
 *     fact in 1338 of 5700 ordered pairs.
 *
 * Similar wording is not proof of an equivalent acquisition. Both rules are gone
 * rather than retuned: raising the threshold or extending the concept list only
 * changes which facts get deleted. What `jaccard` / `tokenSet` still do here is
 * answer a different question — when a radiologist lightly rewords an owned
 * sentence, which producer should the new wording be attributed to — and they
 * only ever influence `findFuzzyProvenanceMatch`, never the text.
 */

function tokenSet(text: string): Set<string> {
  return new Set(normalizeForDedupe(text).split(" ").filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Lightweight similarity for lightly edited owned sentences (descriptor tweaks). */
export const FUZZY_PROVENANCE_THRESHOLD = 0.72;

export function fuzzySentenceSimilarity(a: string, b: string): number {
  return jaccard(tokenSet(a), tokenSet(b));
}

/** True when `next` is a light edit of `prev` (added descriptor words, same core). */
export function isLightSentenceEdit(prev: string, next: string): boolean {
  if (fuzzySentenceSimilarity(prev, next) >= FUZZY_PROVENANCE_THRESHOLD) return true;
  const shorter = normalizeForDedupe(prev).split(" ").filter((w) => w.length > 1);
  const longer = normalizeForDedupe(next).split(" ").filter((w) => w.length > 1);
  if (shorter.length < 3) return false;
  return shorter.every((w) => longer.includes(w));
}

/**
 * When a radiologist lightly edits an owned sentence, inherit prior provenance
 * from the closest previous sentence instead of treating it as purely manual.
 */
export function findFuzzyProvenanceMatch(
  sentence: string,
  previousText: string,
  previousProvenance: FieldProvenanceMap,
  minScore = FUZZY_PROVENANCE_THRESHOLD,
): InsertSource[] | null {
  let best: InsertSource[] | null = null;
  let bestScore = 0;
  for (const prev of splitToSentences(previousText)) {
    const pk = normalizeForDedupe(prev);
    const prov = previousProvenance[pk];
    if (!prov || prov.every((s) => s === "manual")) continue;
    const score = fuzzySentenceSimilarity(sentence, prev);
    const light = isLightSentenceEdit(prev, sentence);
    if ((score >= minScore || light) && (light || score > bestScore)) {
      bestScore = Math.max(bestScore, score);
      best = sortSources([...prov, "manual"]);
    }
  }
  return best;
}

/**
 * Technique merge: an incoming sentence joins the existing one when the two are
 * the same text under normalization, and is kept as its own statement otherwise.
 * When a duplicate is dropped, its source is unioned onto the kept sentence.
 *
 * Line layout is preserved as before (existing block, then the new sentences
 * space-joined), because the print template reads Technique as a block; the
 * decision about *what survives* no longer consults similarity, concept coverage
 * or sentence length (B-02A).
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
  // Keyed on the sentence object, not an index: the removed concept-aware version
  // recorded incoming sentences under `segments.length + …` and then read them
  // back through `segments[…]`, so a block that repeated one of its own sentences
  // looked an empty slot up and threw `Cannot read properties of undefined`.
  const seen = new Map<string, AnnotatedSentence>();
  for (const seg of segments) seen.set(normalizeForDedupe(seg.text), seg);

  const incomingSentences = splitToSentences(inc);
  const keptIncoming: AnnotatedSentence[] = [];

  for (const s of incomingSentences) {
    const n = normalizeForDedupe(s);
    if (!n) continue;

    const dup = seen.get(n);
    if (dup) {
      // Provably the same sentence: one copy, sources unioned.
      dup.sources.add(source);
      continue;
    }

    // Not provably the same wording, so it is a separate statement about the
    // acquisition — appended verbatim, with its own source, and no existing
    // sentence touched.
    const kept: AnnotatedSentence = { text: s, sources: new Set([source]) };
    seen.set(n, kept);
    keptIncoming.push(kept);
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

/*
 * B-02 removed `CLINICAL_GUARDS` / `hasConflictingClinicalDetail` here. They
 * existed to stop the word-subset fold from merging sentences whose laterality,
 * level, severity or measurement disagreed — a set of exceptions bolted onto an
 * equivalence test that was itself unsound, which is why "Mild canal stenosis."
 * + "Moderate canal stenosis." survived while "No acute infarct." + "No acute
 * infarct or haemorrhage." silently broadened. With the fold gone there is
 * nothing left to guard: no merge happens unless the normalized sentences are
 * identical, and identical sentences cannot disagree about a modifier.
 */

/**
 * Merge free-text findings/impression/recommendation with provenance.
 *
 * One equivalence rule, and it is a textual one: two sentences are the same
 * statement when their normalized forms are IDENTICAL (case, punctuation and
 * whitespace stripped — `normalizeForDedupe`). Then, and only then, does an
 * incoming sentence collapse onto an existing one, unioning its source.
 * Everything else is appended as its own statement.
 *
 * B-02 — what used to happen instead, and why it is gone. This function also
 * folded any sentence whose word set was a **subset** of another's, and when it
 * did it could REPLACE the existing sentence with the longer one. Word overlap
 * is not identity, and the two operations together let a text-composition layer
 * answer clinical questions nobody asked it. Executed at `f65aeb1b`, with the
 * existing sentence owned by `manual`:
 *
 *   "No acute infarct."        + "No acute infarct or haemorrhage."
 *     → "No acute infarct or haemorrhage."        (the report now also denies haemorrhage)
 *   "Acute infarct."           + "No acute infarct."
 *     → "No acute infarct."                       (polarity flipped by a merge)
 *   "No restricted diffusion to suggest acute infarct." + "Acute infarct."
 *     → the affirmative finding disappears, and the negative line is relabelled
 *       ["manual", "quick-select"] — provenance laundering on top of the rewrite
 *
 * The subset test could not see "no", could not see a severity, and could not
 * see that a sentence describing one thing does not imply a sentence describing
 * two. `CLINICAL_GUARDS` (laterality / level / severity / measurement) was a
 * patch over that: it blocked some merges whose modifiers disagreed, which is
 * why "Mild canal stenosis." + "Moderate canal stenosis." already survived, while
 * "No acute infarct." + "No acute infarct or haemorrhage." — no disagreeing
 * modifier at all — silently broadened. Guards on top of an unsound equivalence
 * test only make the rule inconsistently unsound, so the test goes, not the
 * guards' most alarming cases.
 *
 * Replacing a clinical statement is not this function's job. When a statement
 * genuinely supersedes another, that is proved by structured ownership —
 * `planSameSlotReplacement`, `replacedBaseline`, `lastRendered` reconciliation in
 * `pathologyPatch.ts` / the Observation Ledger — which identifies the claim by
 * (region, concept, level, laterality) rather than by shared vocabulary, and it
 * keeps working untouched. What remains here is a composition rule, and a
 * composition rule is allowed to do only what it can see.
 *
 * Consequence, and it is deliberate: a report can now read "No acute infarct."
 * followed by "Acute infarct." That is a contradiction the radiologist can see
 * and the QC/contradiction layer can flag. A silently chosen sentence can be
 * neither. Nothing here decides which one wins, whether the newer text is more
 * informative, or that a rounded restatement of a measurement may be dropped —
 * `mergeSentencesWithProvenance` no longer rewrites text it was handed at all.
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
      // Provably the same sentence: one copy, sources unioned.
      out[dupIdx]!.sources.add(source);
      continue;
    }

    // Not provably the same sentence, so it is a separate clinical statement —
    // appended verbatim, with its own source, and no existing sentence touched.
    out.push({ text: s, sources: new Set([source]) });
    normSeen.set(n, out.length - 1);
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
