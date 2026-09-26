/**
 * resolveQuickFindingFromSpeech — Phase 1 pure helper for V-04 (voice → ledger).
 *
 * Reverse of the workspace quick-select term matcher:
 *   quick-select: spoken term ⊆ finding.label
 *   prose dictate: finding.label|alias ⊆ transcript
 *
 * Contract (A1 — wiring lands in Phase 2 `useVoiceReporting`):
 *   - Explicit intents (`select/remove finding`) keep the forward matcher.
 *   - Raw prose that catalog-matches MUST go through pending-preview confirm
 *     (this helper only reports matches; it never toggles chips).
 *   - Negation cues ("no fatty liver") mark spans negated — callers must NOT toggle.
 *   - Multi-finding utterances are segmented (longest-match, non-overlapping).
 *   - Zero positive matches → narrative fallback.
 */

export type SpeechCatalogFinding = {
  id: number;
  label: string;
  /** Comma-separated tags used as aliases (QuickFinding.tags). */
  tags?: string | null;
  /** Extra aliases beyond tags. */
  aliases?: string[];
};

export type ResolvedSpeechFinding = {
  finding: SpeechCatalogFinding;
  matchedVia: string;
  /** Inclusive start / exclusive end in the normalized transcript. */
  start: number;
  end: number;
  negated: boolean;
};

export type ResolveQuickFindingFromSpeechResult =
  | {
      status: "zero-match";
      /** Prose path should mergeField / replaceField — no chip toggle. */
      narrativeFallback: true;
      /** Negated catalog hits (informational; must not toggle). */
      negated: ResolvedSpeechFinding[];
    }
  | {
      status: "matches";
      /** Positive (non-negated) catalog hits for pending-preview confirm. */
      findings: ResolvedSpeechFinding[];
      negated: ResolvedSpeechFinding[];
    }
  | {
      status: "ambiguous";
      matchedVia: string;
      candidates: SpeechCatalogFinding[];
    };

export type MatchQuickFindingByTermResult =
  | { status: "zero-match" }
  | { status: "match"; finding: SpeechCatalogFinding }
  | { status: "ambiguous"; candidates: SpeechCatalogFinding[] };

const NEGATION_RE =
  /\b(?:no|not|without|denies|denied|negative\s+for|absent|free\s+of|ruled\s+out)\b/i;

function normalizeSpeech(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Split QuickFinding.tags + optional aliases into normalized phrase list. */
export function catalogAliasesForFinding(f: SpeechCatalogFinding): string[] {
  const raw: string[] = [f.label];
  if (f.tags) {
    for (const part of f.tags.split(",")) {
      const t = part.trim();
      if (t) raw.push(t);
    }
  }
  if (f.aliases) {
    for (const a of f.aliases) {
      const t = a.trim();
      if (t) raw.push(t);
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const n = normalizeSpeech(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  // Longest first so "fatty liver" wins over "liver".
  out.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return out;
}

type RawHit = {
  finding: SpeechCatalogFinding;
  matchedVia: string;
  start: number;
  end: number;
};

function findPhraseHits(haystack: string, phrase: string): Array<{ start: number; end: number }> {
  if (!phrase) return [];
  const hits: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(phrase, from);
    if (idx < 0) break;
    const end = idx + phrase.length;
    const beforeOk = idx === 0 || haystack[idx - 1] === " ";
    const afterOk = end === haystack.length || haystack[end] === " ";
    if (beforeOk && afterOk) hits.push({ start: idx, end });
    from = idx + 1;
  }
  return hits;
}

function isNegatedAt(transcript: string, start: number): boolean {
  // Look at a short window before the match for a negation cue.
  const windowStart = Math.max(0, start - 48);
  const before = transcript.slice(windowStart, start).trim();
  if (!before) return false;
  // Last negation in the window must not be cancelled by a conjunction that
  // starts a new clause after it (e.g. "no mass but fatty liver").
  const negMatch = before.match(NEGATION_RE);
  if (!negMatch || negMatch.index == null) return false;
  const afterNeg = before.slice(negMatch.index + negMatch[0].length);
  // Clause breakers after the negation → match is in a new positive clause.
  if (/\b(?:but|however|although|except|though)\b/i.test(afterNeg)) return false;
  return true;
}

function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Forward matcher used by explicit `select/remove finding <term>` intents.
 * Same rules as today's workspace: exact label → label includes term.
 */
export function matchQuickFindingBySpokenTerm(
  term: string,
  catalog: SpeechCatalogFinding[],
  opts?: { pool?: SpeechCatalogFinding[] },
): MatchQuickFindingByTermResult {
  const norm = normalizeSpeech(term);
  if (!norm) return { status: "zero-match" };
  const pool = opts?.pool ?? catalog;
  let matches = pool.filter((f) => normalizeSpeech(f.label) === norm);
  if (matches.length === 0) {
    matches = pool.filter((f) => normalizeSpeech(f.label).includes(norm));
  }
  if (matches.length === 0) {
    // Alias / tags forward match (term ⊆ alias).
    matches = pool.filter((f) => catalogAliasesForFinding(f).some((a) => a === norm || a.includes(norm)));
  }
  if (matches.length === 0) return { status: "zero-match" };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "match", finding: matches[0] };
}

/**
 * Reverse matcher for raw prose dictate: label/alias ⊆ transcript.
 * Segments multi-finding utterances; applies negation guard.
 */
export function resolveQuickFindingFromSpeech(
  transcript: string,
  catalog: SpeechCatalogFinding[],
): ResolveQuickFindingFromSpeechResult {
  const normTx = normalizeSpeech(transcript);
  if (!normTx || catalog.length === 0) {
    return { status: "zero-match", narrativeFallback: true, negated: [] };
  }

  const rawHits: RawHit[] = [];
  for (const finding of catalog) {
    for (const phrase of catalogAliasesForFinding(finding)) {
      for (const span of findPhraseHits(normTx, phrase)) {
        rawHits.push({
          finding,
          matchedVia: phrase,
          start: span.start,
          end: span.end,
        });
      }
    }
  }

  if (rawHits.length === 0) {
    return { status: "zero-match", narrativeFallback: true, negated: [] };
  }

  // Prefer longer phrases; stable by start.
  rawHits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);

  const accepted: ResolvedSpeechFinding[] = [];
  for (const hit of rawHits) {
    const overlap = accepted.find((a) => spansOverlap(a, hit));
    if (overlap) {
      // Same span length + different findings → ambiguity (e.g. shared alias).
      const sameSpan =
        overlap.start === hit.start
        && overlap.end === hit.end
        && overlap.finding.id !== hit.finding.id;
      if (sameSpan) {
        return {
          status: "ambiguous",
          matchedVia: hit.matchedVia,
          candidates: [overlap.finding, hit.finding],
        };
      }
      continue; // shorter / nested under a longer match — drop
    }
    accepted.push({
      finding: hit.finding,
      matchedVia: hit.matchedVia,
      start: hit.start,
      end: hit.end,
      negated: isNegatedAt(normTx, hit.start),
    });
  }

  // De-dupe by finding id (keep first = longest).
  const byId = new Map<number, ResolvedSpeechFinding>();
  for (const a of accepted) {
    if (!byId.has(a.finding.id)) byId.set(a.finding.id, a);
  }
  const unique = [...byId.values()].sort((a, b) => a.start - b.start);
  const positive = unique.filter((u) => !u.negated);
  const negated = unique.filter((u) => u.negated);

  if (positive.length === 0) {
    return { status: "zero-match", narrativeFallback: true, negated };
  }
  return { status: "matches", findings: positive, negated };
}
