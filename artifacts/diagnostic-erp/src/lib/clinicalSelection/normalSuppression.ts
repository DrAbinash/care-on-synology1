/**
 * Stage C-1 · set-based normal suppression.
 *
 * A baseline normal is false when at least one **currently selected** observation falsifies it. It is
 * not a fact about which box was clicked first, and it is not a fact about which sentence a previous
 * render happened to delete.
 *
 * The shipped engine recorded, per patch, only the baseline sentences that patch happened to replace
 * (`observationLedger.ts:53`, filled at `store.ts:2472`), and restoring on deselection used exactly
 * that private list (`observationLedger.ts:181,184`). When two abnormalities declare the same normal,
 * the second one to be clicked records nothing, so deselecting either one produces a different report —
 * and one of those reports asserts a normal the surviving abnormality contradicts.
 *
 * This module is deliberately pure: no React, no database, no AI, no clock, no randomness. It takes the
 * active set and answers set questions. The observation ledger stays the single authoritative
 * application state — see `docs/clinical/V4_STAGE_C_INTEGRATION_MAP.md` §1.
 */

import { normalizeForDedupe, splitToSentences } from "../reportFieldMerge";
import { extractLevel, normalizeLevel, sentenceMatchesConcept } from "../observationSlot";

/** The minimum an observation has to say to be consulted. Mirrors `CanonicalObservation`. */
export type SuppressingObservation = {
  /** The baseline sentence this observation declares false, as the catalogue or tile states it. */
  baselineReplaces?: string | null;
  /** Resolved clinical concept, when one exists. */
  concept?: string | null;
  /**
   * The level this observation speaks about — "C5-C6", a regional bucket like "cervical", or
   * "" when nothing resolved. Restoration needs it; see `falsifies`.
   */
  level?: string | null;
  /** Text the observation actually put in the report — used for concept-level falsification. */
  renderedText?: string | null;
  /** The side a side-parameterised observation speaks for — "left" / "right". */
  laterality?: string | null;
  /** `role === "baseline"` marks a row that ASSERTS a normal rather than opposing one. */
  role?: string | null;
};

/** A selected observation, as the ledger holds it, addressed by its observation id. */
export type SuppressorHolder = {
  id: string;
  stale?: boolean;
  observation?: {
    role?: string | null;
    baselineReplaces?: string | null;
    concept?: string | null;
    level?: string | null;
    laterality?: string | null;
  } | null;
  /**
   * The prose this row wrote into the report — its own claim, see `falsifies`.
   *
   * This is the only place that prose exists. `CanonicalObservation` has no findings or impression
   * field, so a claim read off the observation is always empty and the polarity test in `falsifies`
   * never runs: the measurement that found it is in the header of `falsifies`. The patch and the
   * serialized ledger both carry `lastRendered`, so reading it here costs no new state.
   */
  lastRendered?: {
    findings?: string | null;
    impression?: string | null;
  } | null;
};

function claimOf(holder: SuppressorHolder): SuppressingObservation {
  const obs = holder.observation ?? {};
  // Both body fields, because a row may state its sentence in either one. A normal tile writes its
  // negatives in Findings and its conclusion in Impression; whichever holds the baseline sentence,
  // that row asserts it and cannot also be the reason it is withheld.
  const own = [nonEmpty(holder.lastRendered?.findings), nonEmpty(holder.lastRendered?.impression)]
    .filter(Boolean)
    .join(" ");
  return {
    baselineReplaces: obs.baselineReplaces ?? null,
    concept: obs.concept ?? null,
    ...(nonEmpty(obs.level) ? { level: obs.level } : {}),
    ...(nonEmpty(obs.laterality) ? { laterality: obs.laterality } : {}),
    ...(own ? { renderedText: own } : {}),
  };
}

/**
 * The selected observations that carry a clinical claim against a baseline.
 *
 * Two exclusions, both deliberate:
 *  - **`stale` patches are not suppressors.** A stale row is a baseline whose text was emptied when
 *    something else took its place (`store.ts:2419`); it holds no clinical claim, so counting it as
 *    falsifying a normal would keep a normal retired after the abnormality that retired it is gone.
 *  - **A baseline-role observation is not a suppressor.** Explicitly selecting a normal tile asserts
 *    that normality; it cannot simultaneously be what falsifies another normal.
 *
 * Independently-selected abnormalities are all kept, including two that share one baseline — which is
 * the case this whole module exists for. Manually authored text is not a suppressor either, because it
 * declares no baseline: the radiologist's sentence stays exactly where they wrote it.
 */
export function suppressorHolders(patches: readonly SuppressorHolder[]): SuppressorHolder[] {
  return patches.filter((p) => {
    const obs = p.observation;
    if (p.stale || !obs || obs.role === "baseline") return false;
    const claim = claimOf(p);
    return Boolean(nonEmpty(claim.baselineReplaces) || nonEmpty(claim.concept));
  });
}

export function activeSuppressors(
  patches: readonly SuppressorHolder[],
): SuppressingObservation[] {
  return suppressorHolders(patches).map(claimOf);
}

/**
 * The baseline sentences an observation declares false — whether or not it was the one that
 * deleted them from the page.
 *
 * `replacedBaseline` lives on the patch that happened to remove the sentence first. That is the
 * whole bug: deselect Burst fracture C5 while Lytic lesion C2 still falsifies the same normal, the
 * record is consumed by the filter and goes out the door with the removed row — so when the lesion
 * is finally deselected, the vertebral-body normal has no holder left and is never stated again.
 *
 * The declaration is not lost, because it is not a memory: both tiles say the same
 * `baselineReplaces` sentence, and the canonical baseline says it too. Asking the *removed*
 * observation which baseline sentences it falsifies therefore recovers every sentence it has
 * authority over, including ones a earlier click had already removed. Nothing here can resurrect
 * text a radiologist deleted by hand — a claim exists only where an observation declares it, and
 * only against a sentence that is in the recorded canonical baseline.
 *
 * Deliberately narrower than `falsifies`: only the observation's own declared sentence widens the
 * restoration scope, never a concept-level match. Concept falsification decides whether a normal
 * may come back (`suppressedKeys`); it does not grant permission to write new text into the field.
 */
export function claimsDeclaredBy(
  observation: SuppressingObservation | null | undefined,
  canonical: readonly CanonicalSlot[],
): string[] {
  if (!observation || observation.role === "baseline") return [];
  const declared = nonEmpty(observation.baselineReplaces);
  if (!declared) return [];
  // A row that IS a normal must not be able to authorise restoring it. Two spellings of that, both
  // needed: `role === "baseline"` above, and the row's own words here. A Whole Spine report moved to
  // Cervical Spine retires its dorsal and lumbar rows one at a time through this removal path, and
  // each of those rows carries a `baselineReplaces` naming the very sentence it rendered — restoring
  // it would put back, line by line, exactly what the transition just withdrew, and print "Dorsal
  // spine: alignment is within normal limits" under a recorded decision that this examination does
  // not image the dorsal spine. Substring rather than equality, because a row may render its sentence
  // with a lead-in or trailing advice of its own.
  const own = nonEmpty(observation.renderedText);
  if (own && key(own).includes(key(declared))) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slot of canonical) {
    if (key(slot.sentence) !== key(declared)) continue;
    // A baseline that states the same sentence twice is one claim, not two. Restoring it twice would
    // print the same normal two lines apart, which is the failure `mergeBaselineClaims` exists to stop.
    if (seen.has(key(slot.sentence))) continue;
    seen.add(key(slot.sentence));
    out.push(slot.sentence);
  }
  return out;
}

/** Union without duplicating a sentence already held, keyed the way the ledger keys everything. */
export function mergeBaselineClaims(
  held: readonly string[],
  inherited: readonly string[],
): string[] {
  const seen = new Set(held.map(key));
  const next = [...held];
  for (const sentence of inherited) {
    if (seen.has(key(sentence))) continue;
    seen.add(key(sentence));
    next.push(sentence);
  }
  return next;
}

/** A baseline sentence with the position it holds in the canonical (anatomical) order. */
export type CanonicalSlot = {
  sentence: string;
  /** Catalogue placement order; lower prints earlier. Absent means unordered. */
  ordinal?: number | null;
  /**
   * The whole baseline LINE this sentence was written on, when it came from
   * text rather than a catalogue snapshot. A line can carry several sentences
   * ("No focal hypo- or hyperdensity. No haemorrhage or infarct.") and the
   * layout engine reads lines, so restoration needs to know which sentence was
   * whose neighbour — see `insertAtCanonicalPosition`.
   */
  line?: string;
};

const key = (s: string): string => normalizeForDedupe(s);

function nonEmpty(text: string | null | undefined): string {
  return (text ?? "").trim();
}

/**
 * True when `sentence` — a baseline normal — is falsified by `observation` on its own terms.
 *
 * Two routes, and only the two the catalogue already declares:
 *  1. the observation names this exact baseline (`baselineReplaces`), which is how shipped tiles
 *     express retirement today;
 *  2. the observation carries a resolved concept and the baseline sentence is about that concept —
 *     the same oracle `applyPathologyPatch` uses through `sentenceOwnedBySlot`, reused here rather
 *     than re-derived, so the two paths cannot disagree about what a tile falsifies.
 *
 * Route 2 is level-scoped, and that scoping is what makes a deselection able to put a normal back.
 * Three shipped tiles at C4-C5, C5-C6 and C6-C7 all carry the concept `disc_contour`, and each one
 * retired only its own level's "C4-C5: No significant disc bulge or protrusion is seen." on the page.
 * Without a level test, the surviving C5-C6 and C6-C7 observations falsify the C4-C5 sentence too, so
 * deselecting the C4-C5 box restored nothing — and its record left with the row, permanently. Measured
 * at `e0991715`+branch: a three-level cervical composition, all three boxes clicked off, printed a
 * normal report with two of its three level normals missing for good.
 *
 * The guard only fires where BOTH sides actually name a level. A study-wide baseline ("No
 * spondylolisthesis is seen.") is falsified by any observation about that concept at any level, and an
 * observation whose level never resolved keeps the behaviour it has always had — guessing a level
 * boundary here would leave a contradicted normal on the page, which is the worse failure.
 */
export function falsifies(observation: SuppressingObservation, sentence: string): boolean {
  // Polarity, first: a row that states this sentence in its own words cannot be the
  // reason it is withheld. Several shipped tiles declare their own normal as the
  // baseline they replace — "Normal LS spine" carries `baselineReplaces:
  // "No spondylolisthesis."` inside prose that contains exactly that sentence — so
  // without this test the same tile is both the assertion of a normal and the
  // falsifier of it, and a deselection restores nothing. The measurement that found
  // it: deselecting "Grade 1 spondylolisthesis L4-L5" left the report stating neither
  // the listhesis nor its absence, while the very same deselection succeeded when the
  // normal row happened to be suspended. `claimsDeclaredBy` applies this rule
  // to the restoration scope; the suppression decision needs it too, or the two
  // disagree about what one row means.
  //
  // Deliberately narrower than "ignore normals": an abnormality whose own rendered
  // text does not contain the baseline still falsifies it (the control in
  // normalSuppression.test.ts), because leaving a contradicted normal on the page is
  // the worse failure and this module exists to stop exactly that.
  const self = nonEmpty(observation.renderedText);
  if (self && key(self).includes(key(sentence))) return false;
  const declared = nonEmpty(observation.baselineReplaces);
  if (declared && key(declared) === key(sentence)) return true;
  const concept = nonEmpty(observation.concept);
  if (!concept || !sentenceMatchesConcept(sentence, concept)) return false;
  return !namesOtherLevel(observation, sentence) && !namesOtherSide(observation, sentence);
}

const BUCKET_REGION_LETTER: Record<string, string> = {
  cervical: "C",
  dorsal: "DT",
  lumbar: "LS",
};

/** True when the observation's level and the sentence's level are two different places. */
function namesOtherLevel(observation: SuppressingObservation, sentence: string): boolean {
  const mine = normalizeLevel(nonEmpty(observation.level));
  if (!mine) return false;
  const theirs = extractLevel(sentence);
  if (!theirs) return false;
  const bucket = BUCKET_REGION_LETTER[mine];
  if (bucket) return !bucket.includes(theirs[0].toUpperCase());
  return mine !== theirs;
}

/**
 * True when a side-parameterised observation faces a baseline that names only the
 * OTHER side — the D-27 independence ruling, carried into the restore path.
 *
 * The initial retire is already side-scoped: the slot engine's laterality
 * handling never lets a left hip effusion take the right hip's normal off the
 * page. The restore path used this same oracle with no side knowledge, so
 * after the LEFT effusion was deselected the SURVIVING right effusion kept
 * suppressing the LEFT normal forever — its own falsifier long gone, the
 * sentence still gone with it. That is the one-sided defect the laterality
 * deselect boundary (D-27) ruled impossible for the findings field, here in
 * the restore path. A sentence that names no side speaks study-wide and keeps
 * today's semantics; "bilateral" belongs to both sides, exactly as the
 * shipped foraminal normal ("patent bilaterally") requires.
 */
function namesOtherSide(observation: SuppressingObservation, sentence: string): boolean {
  const side = nonEmpty(observation.laterality).trim().toLowerCase();
  if (side !== "left" && side !== "right") return false;
  const lower = sentence.toLowerCase();
  const bilateral = /bilateral/.test(lower);
  const mentionsLeft = bilateral || /\bleft\b/.test(lower);
  const mentionsRight = bilateral || /\bright\b/.test(lower);
  if (!mentionsLeft && !mentionsRight) return false;
  return side === "left" ? !mentionsLeft : !mentionsRight;
}

/**
 * Which baseline sentences the **complete active set** still falsifies.
 *
 * Order-invariant by construction: the result depends only on set membership, never on the sequence
 * the members were added.
 */
export function suppressedKeys(active: readonly SuppressingObservation[], candidates: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const sentence of candidates) {
    if (active.some((observation) => falsifies(observation, sentence))) out.add(key(sentence));
  }
  return out;
}

/**
 * The sentences a deselection may legitimately put back.
 *
 * `replaced` is what the removed patch recorded; `surviving` is every observation still selected after
 * the removal. A sentence returns only when no surviving observation falsifies it — so a normal shared
 * by two abnormalities stays retired while either one is held, and comes back exactly once, when the
 * last one goes.
 */
export function filterRestorableBaselines(
  replaced: readonly string[],
  surviving: readonly SuppressingObservation[],
): string[] {
  const stillSuppressed = suppressedKeys(surviving, replaced);
  return replaced.filter((sentence) => !stillSuppressed.has(key(sentence)));
}

/**
 * Re-insert a restored normal at its canonical anatomical position instead of appending it.
 *
 * Appending is what put "vertebral bodies demonstrate normal height and marrow signal" *below* a C2
 * lytic lesion, where it reads as a finding. `canonical` is the baseline's own order — for a v4
 * publication it is the snapshot's `(ordinal NULLS LAST, identity)` sequence, already deterministic in
 * `cataloguePublicationSnapshot.ts:311-321`; for a shipped format it is the format's baseline text.
 *
 * The sentence is placed before the first present sentence that follows it canonically, so a restored
 * normal rejoins its neighbours and never lands under pathology it contradicts. Sentences the field
 * holds that are not in the canonical order (radiologist-written text, lesions) are never moved.
 */
export function insertAtCanonicalPosition(
  fieldText: string,
  sentence: string,
  canonical: readonly CanonicalSlot[],
): string {
  const lines = fieldText.split(/\r?\n/);
  if (lines.length === 0) return sentence;
  // Restoration is idempotent. A normal the field already holds is not re-inserted merely because a
  // second patch also recorded it — which is exactly how two tiles claiming one baseline would
  // otherwise print the same sentence twice.
  if (lines.some((line) => key(line) === key(sentence))) return fieldText;

  const presentAt = new Map<string, number>();
  lines.forEach((line, index) => {
    const k = key(line);
    if (k && !presentAt.has(k)) presentAt.set(k, index);
  });

  const myRank = canonical.findIndex((slot) => key(slot.sentence) === key(sentence));
  if (myRank < 0) return appendIfAbsent(fieldText, lines, sentence);

  /**
   * Back into the line it came from, when exactly one baseline line held it.
   *
   * The click that retires one sentence of a two-sentence line rewrites the WHOLE
   * line without it, so the page is left holding the line's remainder and the
   * restored sentence has nowhere to go except beside it. Deselecting CT "Acute
   * Infarct" therefore returned "No haemorrhage or infarct." on a line of its own
   * rather than inside "No focal hypo- or hyperdensity. No haemorrhage or
   * infarct." — the right words in the wrong shape — and, measured on the release
   * candidate, the next click then replaced that stranded line, printing an acute
   * right-MCA infarct under "Bone Windows:".
   *
   * Only one candidate line is accepted. Where two anatomical sections share a
   * sentence verbatim (both kidneys write "PCS not dilated."), choosing the first
   * would rejoin a sentence into the wrong organ's line, so the position search
   * below decides the outcome instead.
   */
  const myLine = canonical[myRank]?.line;
  if (myLine) {
    const holders = new Set(
      canonical.filter((c) => key(c.sentence) === key(sentence)).map((c) => c.line ?? ""),
    );
    if (holders.size === 1) {
      const siblings = canonical.filter((c) => c.line === myLine);
      const siblingKeys = new Set(siblings.map((c) => key(c.sentence)));
      const at = lines.findIndex((l) => {
        const units = splitToSentences(l).map((u) => key(u)).filter(Boolean);
        return units.length > 0 && units.every((u) => siblingKeys.has(u));
      });
      if (at >= 0) {
        const present = new Set(splitToSentences(lines[at] ?? "").map((u) => key(u)));
        lines[at] = siblings
          .map((c) => (key(c.sentence) === key(sentence)
            ? sentence
            : present.has(key(c.sentence)) ? c.sentence : null))
          .filter((x): x is string => Boolean(x))
          .join(" ");
        return lines.join("\n");
      }
    }
  }

  for (const slot of canonical.slice(myRank + 1)) {
    const found = presentAt.get(key(slot.sentence));
    if (found === undefined) continue;
    /**
     * Above the blank the retirement left behind, not below it.
     *
     * Deleting a baseline line takes the line and leaves the blank separator that
     * followed it, so the empty slot sits between the heading and where the normal
     * has to return. Inserting at that empty slot puts the sentence under its own
     * heading but detached from it, and leaves nothing between it and the next
     * section. Measured on the release candidate after the CT Brain ownership
     * migration: deselecting "Midline Shift" and "Intracranial Hemorrhage" printed
     * "Midline:\n\nNo shift.\nBone Windows:". The blank belongs after the sentence,
     * where the approved normal has it.
     */
    let at = found;
    while (at > 0 && !(lines[at - 1] ?? "").trim()) at--;
    return [...lines.slice(0, at), sentence, ...lines.slice(at)].join("\n");
  }
  return appendIfAbsent(fieldText, lines, sentence);
}

function appendIfAbsent(fieldText: string, lines: string[], sentence: string): string {
  if (lines.some((line) => key(line) === key(sentence))) return fieldText;
  return fieldText.trim() ? `${fieldText.trimEnd()}\n${sentence}` : sentence;
}

/** Canonical slot list from a baseline text, preserving the order the baseline itself is written in. */
export function canonicalOrderFromBaseline(
  sentences: readonly string[],
  ordinals?: readonly (number | null)[]): CanonicalSlot[] {
  return sentences.map((sentence, index) => ({
    sentence,
    ordinal: ordinals?.[index] ?? index,
  }));
}

/**
 * The canonical anatomical order of a recorded baseline — a format's Findings or
 * Impression text.
 *
 * Built LINE by line, not by splitting the whole field at once, so each sentence
 * carries the line it was written on. A Findings document says "Parenchyma:" and
 * then one line of prose, and that line can hold two sentences; restoration that
 * only knows a flat sentence order cannot tell where the second one sat, and
 * puts it back beside the wrong neighbours.
 */
export function canonicalOrderFromText(text: string | null | undefined): CanonicalSlot[] {
  if (!text || !text.trim()) return [];
  const slots: CanonicalSlot[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    for (const unit of splitToSentences(t)) {
      const sentence = unit.trim();
      if (!sentence) continue;
      slots.push({ sentence, ordinal: slots.length, line: t });
    }
  }
  return slots;
}
