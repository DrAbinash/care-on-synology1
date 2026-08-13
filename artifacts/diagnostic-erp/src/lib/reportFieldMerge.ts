/**
 * reportFieldMerge.ts — canonical semantic-aware merge for report fields.
 *
 * ONE shared entry point for Quick Select, Quick Findings, protocol, template,
 * macro and companion insertions into technique / findings / impression /
 * recommendation. No external AI calls — deterministic, conservative rules.
 *
 * Provenance: manual text is never destructively rewritten; automated content
 * may be deduplicated against other automated content.
 */

export type ReportFieldKey = "technique" | "findings" | "impression" | "recommendation" | "clinicalHistory";

export type InsertSource =
  | "manual"
  | "quick-select"
  | "quick-findings"
  | "protocol"
  | "template"
  | "macro"
  | "companion"
  | "ai-draft";

export interface MergeOptions {
  field: ReportFieldKey;
  existing: string;
  incoming: string;
  source?: InsertSource;
}

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

/**
 * Technique merge: exact/normalized dedupe + concept-aware merging.
 * If two sentences cover the same concept set, keep the more informative one.
 */
export function mergeTechnique(existing: string, incoming: string): string {
  const inc = incoming.trim();
  if (!inc) return existing;
  const existingSentences = splitToSentences(existing);
  const incomingSentences = splitToSentences(inc);

  const existingNorm = new Set(existingSentences.map(normalizeForDedupe));
  const existingConcepts = techniqueConcepts(existing);

  const keptIncoming: string[] = [];
  for (const s of incomingSentences) {
    const n = normalizeForDedupe(s);
    if (!n) continue;
    if (existingNorm.has(n)) continue; // exact/normalized duplicate

    const sConcepts = techniqueConcepts(s);
    const newConcepts = [...sConcepts].filter((c) => !existingConcepts.has(c));
    if (sConcepts.size > 0 && newConcepts.length === 0) {
      // All concepts already covered — drop the near-duplicate.
      continue;
    }
    keptIncoming.push(s);
    for (const c of sConcepts) existingConcepts.add(c);
    existingNorm.add(n);
  }

  if (keptIncoming.length === 0) return existing;
  const base = existing.trimEnd();
  return base ? `${base}\n${keptIncoming.join(" ")}` : keptIncoming.join(" ");
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
 * Merge free-text findings/impression/recommendation.
 * - Removes exact/normalized duplicate sentences.
 * - For near-duplicates, preserves the more informative statement only when
 *   there is no conflicting clinical detail (laterality/level/severity/measurement).
 * - When uncertain, preserves both.
 */
export function mergeSentences(existing: string, incoming: string): string {
  const inc = incoming.trim();
  if (!inc) return existing;
  const existingSentences = splitToSentences(existing);
  const incomingSentences = splitToSentences(inc);

  const out = [...existingSentences];
  const normSeen = new Set(existingSentences.map(normalizeForDedupe));

  for (const s of incomingSentences) {
    const n = normalizeForDedupe(s);
    if (!n) continue;
    if (normSeen.has(n)) continue; // duplicate

    // Near-duplicate: one is a more detailed version of the other.
    // Require the shorter text to be a prefix/subsequence of the longer so
    // "Disc desiccation at L4-L5." merges into "Disc desiccation with diffuse
    // bulge at L4-L5." but unrelated sentences never collapse.
    let merged = false;
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const on = normalizeForDedupe(o);
      if (hasConflictingClinicalDetail(o, s)) continue;
      const shorter = on.length <= n.length ? on : n;
      const longer = on.length <= n.length ? n : on;
      const shorterWords = shorter.split(" ").filter(Boolean);
      const longerWords = longer.split(" ").filter(Boolean);
      const isSubsequence = shorterWords.every((w) => longerWords.includes(w));
      if (isSubsequence && shorterWords.length >= 2) {
        // Keep the longer (more informative) version.
        if (s.length > o.length) out[i] = s;
        merged = true;
        break;
      }
    }
    if (!merged) {
      out.push(s);
      normSeen.add(n);
    }
  }
  return out.join("\n");
}

/** Canonical entry point used by all insertion tools. */
export function mergeReportFieldContent(opts: MergeOptions): string {
  const { field, existing, incoming } = opts;
  if (!incoming.trim()) return existing;
  if (field === "technique") return mergeTechnique(existing, incoming);
  return mergeSentences(existing, incoming);
}
