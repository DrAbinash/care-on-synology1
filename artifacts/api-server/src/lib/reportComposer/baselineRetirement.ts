/**
 * A normal the radiologist replaced must not come back in the report beside the
 * abnormality that replaced it.
 *
 * Measured on the clinic's own Ollama on 2026-11-01 (the deterministic arm of the
 * first-report run): an L4-L5 disc protrusion was selected against the lumbar
 * baseline, and the composed Findings read
 *
 *   No significant disc bulge.
 *   Facet joints preserved.
 *   Right paracentral disc protrusion at L4-L5 …
 *
 * — a normal and its own contradiction in one paragraph, with `validation.ok`
 * true, because nothing between the observation ledger and the drafted text ever
 * consulted the retirement. The deterministic Quick Select path DOES honour it:
 * `withdrawSupersededNormals` suspends the baseline row in the workspace store, and
 * Smart Dictation carries it as `removeConflictingBaselineConcepts` through
 * `applyChangePlan`/`applyPathologyPatch`. Both stop at the client's own state. The
 * Composer's answer is a block of prose produced server-side, and that is the one
 * surface nobody applied the declaration to.
 *
 * So this module applies the SAME declaration, with the SAME limits, on the drafted
 * text:
 *
 *   Only what is named. One retirement retires one sentence, matched on its whole
 *   normalized text — the same whole-sentence equality `applyChangePlan` strips on.
 *   A near-miss ("Normal MRI brain baseline with no midline shift.") retires
 *   nothing, because guessing which half the radiologist meant is how a normal
 *   anatomy sentence disappears.
 *   Only the drafting kind. `FULL_REPORT` composes prose from observations, so it is
 *   the one task where an abnormality and a baseline arrive together. The preserving
 *   kinds (PROFESSIONALIZE, COMBINE, REPHRASE, SHORTEN, EXPAND, SECTION_EDIT,
 *   SELECTION_EDIT, TRANSLATE) were asked to rewrite what the radiologist wrote, not
 *   to delete part of it, and OBSERVATIONS answers in rows. `deterministicCompose`
 *   already returns their text untouched for the same reason.
 *   Never a hand-typed sentence. `fieldProvenanceSummary` carries the source the
 *   workspace recorded for each sentence; a sentence the radiologist typed is his,
 *   and a tile's declaration does not speak for it.
 *
 * Nothing here deletes a finding: the sentences it removes are normal statements the
 * radiologist's own selected abnormality declares superseded, the removal is visible
 * as the `originalText` side of the resulting tracked change, and he accepts or
 * rejects it before anything reaches the report of record.
 */
import type { ComposerDraftOutput, ComposerInputSnapshot } from "./types";

/**
 * Mirrors `normalizeForDedupe` in diagnostic-erp/src/lib/reportFieldMerge.ts, which
 * is how the workspace keys a sentence. Case and punctuation are formatting; they
 * are not two different statements.
 */
function normalizeSentence(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sources whose sentences the radiologist authored by hand. Mirrors the protected
 * list in `applyChangePlan.ts`, minus `quick-findings`/`quick-select`: there, the
 * plan came from voice and the tile's own sentence had to be defended. Here the
 * declaration IS the tile — the baseline it names is what the tile replaced.
 */
const HAND_AUTHORED_SOURCES = new Set(["manual"]);

/** Sentences the draft may be asked about, split the way the workspace splits them. */
function splitLineSentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/);
}

function declaredRetirements(snapshot: ComposerInputSnapshot): Set<string> {
  const out = new Set<string>();
  for (const o of snapshot.observations ?? []) {
    const key = normalizeSentence(o.baselineReplaces ?? "");
    if (key) out.add(key);
  }
  return out;
}

/** Keys of sentences the workspace recorded as hand-typed, per field. */
function handAuthoredKeys(
  snapshot: ComposerInputSnapshot,
  field: "findings" | "impression",
): Set<string> {
  const map = snapshot.fieldProvenanceSummary?.[field];
  const out = new Set<string>();
  for (const [sentence, sources] of Object.entries(map ?? {})) {
    if (sources.some((s) => HAND_AUTHORED_SOURCES.has(s))) out.add(sentence);
  }
  return out;
}

function dropRetired(
  text: string,
  retirements: Set<string>,
  handAuthored: Set<string>,
): string {
  if (!text) return text;
  const keptLines: string[] = [];
  for (const line of text.split("\n")) {
    const sentences = splitLineSentences(line);
    // Identity when nothing in the line is retired, so untouched prose keeps its
    // own spacing, sub-heading and list markers rather than a re-join.
    const retained = sentences.filter((s) => {
      const key = normalizeSentence(s);
      if (!key) return true;
      if (!retirements.has(key)) return true;
      return handAuthored.has(key);
    });
    if (retained.length === sentences.length) {
      keptLines.push(line);
      continue;
    }
    const rejoined = retained.join(" ").replace(/\s+/g, " ").trim();
    if (rejoined) keptLines.push(rejoined);
  }
  return keptLines.join("\n").trim();
}

/**
 * Remove from the drafted prose every normal sentence an applied observation
 * declares superseded, and nothing else.
 *
 * Idempotent by construction: a retired sentence is gone from the text, so a second
 * pass matches nothing, which is what lets both the model's answer and the
 * deterministic fallback run through here without coordinating.
 */
export function retireDeclaredBaselines(
  draft: ComposerDraftOutput,
  snapshot: ComposerInputSnapshot,
  kind: string | null | undefined,
): ComposerDraftOutput {
  if (kind !== "FULL_REPORT") return draft;
  const retirements = declaredRetirements(snapshot);
  if (retirements.size === 0) return draft;
  return {
    ...draft,
    findings: dropRetired(draft.findings, retirements, handAuthoredKeys(snapshot, "findings")),
    impression: dropRetired(draft.impression, retirements, handAuthoredKeys(snapshot, "impression")),
  };
}
