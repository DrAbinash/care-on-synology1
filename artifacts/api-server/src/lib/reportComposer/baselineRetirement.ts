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

/** The list/numbering marker a Findings line may start with, kept verbatim. */
const LINE_MARKER_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

function dropRetired(
  text: string,
  retirements: Set<string>,
  handAuthored: Set<string>,
): string {
  if (!text) return text;
  const keptLines: string[] = [];
  for (const line of text.split("\n")) {
    const marker = LINE_MARKER_RE.exec(line)?.[0] ?? "";
    const sentences = splitLineSentences(marker ? line.slice(marker.length) : line);
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
    // A bullet item whose only sentence was the retired normal is gone; a bullet
    // item that still says something keeps its marker, so retiring one sentence out
    // of a bulleted list cannot silently reformat the surviving item.
    if (rejoined) keptLines.push(`${marker}${rejoined}`.trimEnd());
  }
  return keptLines.join("\n").trim();
}

/** Every sentence a draft field contains, keyed the way the workspace keys them. */
function sentenceIndex(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of (text ?? "").split("\n")) {
    for (const sentence of splitLineSentences(line.replace(LINE_MARKER_RE.exec(line)?.[0] ?? "", ""))) {
      const key = normalizeSentence(sentence);
      if (key && !out.has(key)) out.set(key, sentence.trim());
    }
  }
  return out;
}

/**
 * Which declared retirements are STILL contradicted in a drafted report, as the
 * warnings a radiologist has to review.
 *
 * `retireDeclaredBaselines` matches a declaration on its whole normalized sentence
 * and refuses to guess — that is what keeps an unrelated normal from disappearing
 * over a shared word. Refusing to guess has a cost: a sentence it will not touch
 * stays in the report beside the abnormality that replaced it, and a self-
 * contradicting report that says nothing about saying so is the failure this module
 * exists to prevent. So anything that reaches validation still carrying a declared
 * normal is named, on the surface the workspace already renders for a READY job
 * (`validation.warnings` → the "Validation warnings" box,
 * `ReportComposerAssistant.tsx:533`), in the two words the difference needs:
 *
 *   the radiologist typed it himself, so a tile's declaration does not speak for it
 *   and only he can say which of the two statements the report should keep;
 *   he did not type it, so the retirement that should have taken it did not run —
 *   said plainly because a validator cannot know which upstream produced the text,
 *   and promising the contradiction is silent would be a promise this file could
 *   break without any test noticing (G4-14b).
 *
 * What is deliberately NOT reported: a declaration that matches no sentence at all.
 * That is either the normal already being gone — nothing to review — or the model
 * having reworded it, and telling the two apart needs the clinical resemblance
 * matching this file refuses to do. Raising an alarm for every tile whose baseline
 * text is not verbatim present would spend the radiologist's attention on normal
 * reports, which is the failure mode the contradiction validators are already
 * known for; `G4-15` pins that it stays silent.
 */
export function unresolvedBaselineContradictions(
  draft: { findings: string; impression: string },
  snapshot: ComposerInputSnapshot,
  kind: string | null | undefined,
): string[] {
  if (kind !== "FULL_REPORT") return [];
  const retirements = declaredRetirements(snapshot);
  if (retirements.size === 0) return [];
  const warnings: string[] = [];
  for (const field of ["findings", "impression"] as const) {
    const present = sentenceIndex(draft[field]);
    const handTyped = handAuthoredKeys(snapshot, field);
    for (const key of retirements) {
      const sentence = present.get(key);
      if (!sentence) continue;
      warnings.push(
        handTyped.has(key)
          ? `"${sentence}" is wording you typed, and a selected abnormality declares it replaced — check which one this report should keep.`
          : `"${sentence}" is still in this draft beside the abnormality selected to replace it — check it before accepting.`,
      );
    }
  }
  return [...new Set(warnings)];
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
