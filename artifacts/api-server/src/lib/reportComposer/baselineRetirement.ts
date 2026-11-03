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
import { isProvisionalNormalTemplate, type ComposerDraftOutput, type ComposerInputSnapshot } from "./types";

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

/**
 * What a contradicted normal is made of: the denial cue that opens it, the words that
 * carry its clinical content, and the level, side and time-qualifier it spoke about.
 */
type ScaffoldDenial = {
  sentence: string;
  key: string;
  concept: string;
  terms: string[];
  level: string;
  side: SideToken;
  qualifier: string | null;
};

/** Which side a sentence spoke about, or `""` when it named none. */
type SideToken = "right" | "left" | "bilateral" | "";

const DENIAL_HEAD_RE = /^\s*(?:no|not|without|absent|negative|free of|clear of)\b/i;
/**
 * A sentence that denies after announcing its level. Every spine template normal is
 * written this way — "L5-S1: No significant disc bulge or protrusion is seen." — so
 * matching the denial cue at position 0 alone sees a level identifier where the negation
 * is and leaves the whole lumbar and cervical scaffold unjudgeable. Stripped for the head
 * test only; the level still belongs to the sentence, and `levelOf` reads it from the
 * full text.
 */
const LEADING_LEVEL_RE = /^\s*[cldfst]\d(?:-[cldfst]\d)?\s*[:,-]?\s+/i;
const DENIAL_WORD_RE = /\b(?:no|not|without|absent|negative|free|clear)\b/i;
const LEVEL_WORD_RE = /\b([cldfst]\d(?:-[cldfst]\d)?)\b/i;
const BILATERAL_RE = /\bbilateral(?:ly)?\b/i;
/**
 * The three words a denial can be about without being about the same event. "No ACUTE
 * infarct is seen." and "Chronic infarct in the left MCA territory." are both statements
 * about an infarct and they do not contradict each other — an old infarct is exactly what
 * that denial is compatible with, which is the reasoning `contentPacks.ts` applies to
 * `restricted diffusion` for the same reason.
 */
const QUALIFIER_RE = /\b(acute|subacute|chronic|old|remote|prior|recent|haemorrhagic|hemorrhagic)\b/i;

/**
 * The words a sentence is ABOUT, as opposed to the words that say what is normal, what
 * was looked at, or that nothing was found. A denial's content words are its claim:
 * "No restricted diffusion is seen on DWI/ADC." is about restricted diffusion on DWI/ADC,
 * and nothing else can retire it.
 */
const NON_CLAIM_WORDS = new Set([
  "seen", "shown", "identified", "demonstrated", "noted", "observed", "present", "evidence",
  "there", "their", "this", "that", "with", "without", "within", "from", "than", "then",
  "both", "each", "some", "such", "other", "more", "most", "also", "only", "into", "onto",
  "over", "under", "upon", "near", "between", "along", "across", "region", "regions",
  "normal", "normals", "unremarkable", "preserved", "maintained", "patent", "patency",
  "intact", "normality", "significant", "significance", "acute", "chronic", "subacute",
  "old", "remote", "clear", "free", "no", "not", "are", "is", "was", "were", "and", "the",
  "for", "has", "have", "had", "which", "while", "when", "with", "consistent",
  // Laterality is judged by `sideOf`, not as content. Left in the claim list,
  // "No RIGHT-sided extra-axial collection." demands the words "right" and "sided" of the
  // sentence that contradicts it, so a dictation of "Bilateral extra-axial collections."
  // — which does contradict it, bilaterally including on the right — could never retire
  // it. With the side words out of the claim set the match is made on the clinical
  // content and the side fence below decides, which is where a side belongs.
  "right", "left", "bilateral", "bilaterally", "unilateral", "sided", "side",
]);

function claimTerms(sentence: string): string[] {
  const words = sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !NON_CLAIM_WORDS.has(w) && !/^\d/.test(w));
  return [...new Set(words)];
}

function sideOf(sentence: string): SideToken {
  const lower = sentence.toLowerCase();
  if (BILATERAL_RE.test(lower)) return "bilateral";
  if (/\bright\b|\bright-/.test(lower)) return "right";
  if (/\bleft\b|\bleft-/.test(lower)) return "left";
  return "";
}

function levelOf(sentence: string): string {
  const m = LEVEL_WORD_RE.exec(sentence);
  return m ? m[1].toUpperCase() : "";
}

function qualifierOf(sentence: string): string | null {
  const m = QUALIFIER_RE.exec(sentence);
  return m ? m[1].toLowerCase() : null;
}

/** The same word CARE's grounding rules already treat as one term, in either direction. */
const TERM_SPELLINGS: Record<string, readonly string[]> = {
  infarct: ["infarction"],
  infarction: ["infarct"],
  hemorrhage: ["haemorrhage"],
  haemorrhage: ["hemorrhage"],
};

function mentionsTerm(sentence: string, term: string): boolean {
  if (new RegExp(`\\b${term}\\b`, "i").test(sentence)) return true;
  return (TERM_SPELLINGS[term] ?? []).some((alt) => new RegExp(`\\b${alt}\\b`, "i").test(sentence));
}

/**
 * The sentences the auto-inserted normal template put on the page, normalized.
 *
 * A template is never the thing that contradicts a template. Without this, every
 * affirmative normal in the scaffold ("Basal ganglia and thalami are normal in signal
 * intensity.") would sit in the corpus the contradiction is judged against, and the
 * shared words between two normals would retire one of them.
 */
function scaffoldKeys(snapshot: ComposerInputSnapshot): Set<string> {
  const out = new Set<string>();
  for (const o of snapshot.observations ?? []) {
    if (!isProvisionalNormalTemplate(o)) continue;
    for (const text of [o.concept, o.findingsText, o.impressionText ?? "", o.recommendationText ?? ""]) {
      const key = normalizeSentence(text);
      if (key) out.add(key);
    }
  }
  return out;
}

/**
 * What the RADIOLOGIST wrote, sentence by sentence, minus the template's own sentences.
 *
 * The draft is deliberately absent. The licence to write "infarction" from DWI/ADC
 * evidence is real (`supportedSynthesis.ts`, the knowledge pack's §58 inference), so a
 * composed report will contain a diagnosis the input never spelled; letting that word
 * retire "No acute infarct is seen." would make the model's inference delete a sentence
 * the clinician supplied. Retirement is driven by what he said, and by what a tile
 * declared, and by nothing else.
 */
function authoredSentences(snapshot: ComposerInputSnapshot): string[] {
  const scaffold = scaffoldKeys(snapshot);
  const out: string[] = [];
  const texts = [
    snapshot.findings ?? "",
    snapshot.impression ?? "",
    (snapshot.observations ?? [])
      .filter((o) => !isProvisionalNormalTemplate(o))
      .map((o) => [o.findingsText, o.impressionText ?? ""].join(" "))
      .join("\n"),
  ];
  for (const text of texts) {
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const one = sentence.replace(/\s+/g, " ").trim();
      if (one.length < 3) continue;
      if (scaffold.has(normalizeSentence(one))) continue;
      out.push(one);
    }
  }
  return out;
}

/** A scaffold normal this denial-cue sentence denies, ready to be judged. */
function scaffoldDenials(snapshot: ComposerInputSnapshot): ScaffoldDenial[] {
  const out: ScaffoldDenial[] = [];
  for (const o of snapshot.observations ?? []) {
    if (!isProvisionalNormalTemplate(o)) continue;
    for (const text of [o.findingsText, o.impressionText ?? ""]) {
      for (const raw of text.split(/(?<=[.!?])\s+/)) {
        const sentence = raw.replace(/\s+/g, " ").trim();
        if (!sentence || !DENIAL_HEAD_RE.test(sentence.replace(LEADING_LEVEL_RE, ""))) continue;
        const terms = claimTerms(sentence);
        if (terms.length === 0) continue;
        const key = normalizeSentence(sentence);
        if (!key) continue;
        out.push({
          sentence,
          key,
          concept: o.concept ?? sentence,
          terms,
          level: levelOf(sentence),
          side: sideOf(sentence),
          qualifier: qualifierOf(sentence),
        });
      }
    }
  }
  return out;
}

/**
 * Does this sentence the radiologist wrote contradict that scaffold denial?
 *
 * Four tests, all of them refusals: anything the judge is not sure about leaves the
 * normal exactly where it is, because a wrong retirement deletes a clinical statement
 * while a missed one only leaves a contradiction the review box has to name.
 *
 *   his sentence must not itself be a denial — two negations of one thing agree;
 *   every content word of the denial must be in his sentence — "No restricted diffusion
 *     is seen on DWI/ADC." is about restricted diffusion on DWI/ADC, so an infarct claim
 *     that never mentions the sequence says nothing about it;
 *   if the denial names a level or a side, his sentence has to name that same level or
 *     side — an L4-L5 protrusion is not a statement about L5-S1, a sentence that names no
 *     level is not a statement about any of them, and an unlocalised normal is answered
 *     by an abnormality anywhere;
 *   a time-qualifier must not disagree — the clinic's own left/right and acute/chronic
 *     corrections (#1198, #1201, #1253's grounding round).
 */
function contradicts(denial: ScaffoldDenial, authored: string): boolean {
  if (DENIAL_WORD_RE.test(authored)) return false;
  if (!denial.terms.every((term) => mentionsTerm(authored, term))) return false;
  // A denial that localises must be answered at that location. Silence is not agreement:
  // "Disc bulge with protrusion contacting the traversing root." with no level says
  // nothing about which level, so it cannot be what deletes the L5-S1 normal — while the
  // unlevelled template normal ("No significant disc bulge.") IS answered by any bulge,
  // wherever it is, and `denial.level` empty keeps that case retiring.
  if (denial.level && levelOf(authored) !== denial.level) return false;
  if (denial.side) {
    const side = sideOf(authored);
    if (!side) return false;
    if (side !== denial.side && !(denial.side === "bilateral" || side === "bilateral")) return false;
  }
  if (denial.qualifier) {
    const qualifier = qualifierOf(authored);
    if (qualifier && qualifier !== denial.qualifier) return false;
  }
  return true;
}

/**
 * The normal-template sentences the report's OWN authored prose contradicts.
 *
 * `declaredRetirements` covers what a tile says it replaces. A radiologist typing an
 * abnormality into Findings declares nothing — there is no row, no concept, no
 * `baselineReplaces` — so before this the composer boundary had no way to know that
 * "Restricted diffusion in the right basal ganglia…", typed by hand, makes
 * "No restricted diffusion is seen on DWI/ADC." a statement about an examination that has
 * the finding in it. `textToReportConflictRetirement.test.ts` (TYPED-PROSE) measured
 * exactly that, and the whole-report case A/B corpus replays it.
 *
 * This is a retirement, so it obeys every limit `retireDeclaredBaselines` already obeys:
 * whole normalized sentence, `FULL_REPORT` only, never a sentence he typed himself (that
 * one is protected below and reported instead), and no clinical resemblance matching.
 */
export function contradictedProvisionalNormals(
  snapshot: ComposerInputSnapshot,
): { sentence: string; key: string; concept: string }[] {
  const authored = authoredSentences(snapshot);
  if (authored.length === 0) return [];
  const declared = declaredRetirements(snapshot);
  const out: { sentence: string; key: string; concept: string }[] = [];
  const seen = new Set<string>();
  for (const denial of scaffoldDenials(snapshot)) {
    if (declared.has(denial.key) || seen.has(denial.key)) continue;
    if (authored.some((sentence) => contradicts(denial, sentence))) {
      seen.add(denial.key);
      out.push({ sentence: denial.sentence, key: denial.key, concept: denial.concept });
    }
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
/**
 * Every normal sentence this report may have to retire, keyed the way the workspace keys
 * a sentence, and mapped to the concept that declares it.
 *
 * Two sources, one shape: what a tile or a voice plan declares (`baselineReplaces`), and
 * what the radiologist's own typed prose contradicts
 * (`contradictedProvisionalNormals`). A declared retirement wins when both name the same
 * sentence, because the tile says which slot it replaced and that is the better evidence.
 */
function retirementKeys(snapshot: ComposerInputSnapshot): Map<string, { concept: string; declared: boolean }> {
  const out = new Map<string, { concept: string; declared: boolean }>();
  for (const o of snapshot.observations ?? []) {
    const key = normalizeSentence(o.baselineReplaces ?? "");
    if (key) out.set(key, { concept: o.concept ?? "", declared: true });
  }
  for (const hit of contradictedProvisionalNormals(snapshot)) {
    if (out.has(hit.key)) continue;
    out.set(hit.key, { concept: hit.concept, declared: false });
  }
  return out;
}

export function unresolvedBaselineContradictions(
  draft: { findings: string; impression: string },
  snapshot: ComposerInputSnapshot,
  kind: string | null | undefined,
): string[] {
  if (kind !== "FULL_REPORT") return [];
  const retirements = retirementKeys(snapshot);
  if (retirements.size === 0) return [];
  const warnings: string[] = [];
  for (const field of ["findings", "impression"] as const) {
    const present = sentenceIndex(draft[field]);
    const handTyped = handAuthoredKeys(snapshot, field);
    for (const [key, hit] of retirements) {
      const sentence = present.get(key);
      if (!sentence) continue;
      if (handTyped.has(key)) {
        warnings.push(hit.declared
          ? `"${sentence}" is wording you typed, and a selected abnormality declares it replaced — check which one this report should keep.`
          : `"${sentence}" is wording you typed, and a finding you entered contradicts it — check which one this report should keep.`);
        continue;
      }
      warnings.push(hit.declared
        ? `"${sentence}" is still in this draft beside the abnormality selected to replace it — check it before accepting.`
        : `"${sentence}" is still in this draft beside the finding you entered — check it before accepting.`);
    }
  }
  return [...new Set(warnings)];
}

/**
 * Remove from the drafted prose every normal sentence the report has superseded — by a
 * tile's own `baselineReplaces` declaration or by an abnormality the radiologist typed —
 * and nothing else.
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
  // Both halves of one judgement. A tile declares what it replaced; prose the
  // radiologist typed himself declares nothing, and `contradictedProvisionalNormals`
  // reads his sentence against the template's denial instead of asking the model to do
  // that bookkeeping. The two sources meet here and share every limit below — whole
  // normalized sentence, never a hand-typed sentence, `FULL_REPORT` only.
  const retirements = new Set(retirementKeys(snapshot).keys());
  if (retirements.size === 0) return draft;
  return {
    ...draft,
    findings: dropRetired(draft.findings, retirements, handAuthoredKeys(snapshot, "findings")),
    impression: dropRetired(draft.impression, retirements, handAuthoredKeys(snapshot, "impression")),
  };
}
