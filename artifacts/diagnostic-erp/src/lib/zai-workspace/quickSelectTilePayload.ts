/**
 * What one Quick Select box promises, kept out of the React tree so it can be
 * read and tested without a browser.
 *
 * A findings box can carry three sentences: the one in Findings, the one in
 * Impression, and the advice in Recommendation. They have to land together — a
 * disc herniation that updates the Impression but leaves the normal report's
 * advice is a report that contradicts itself — and until now the promise was
 * written inline in a click handler and in a save handler, where neither could
 * be tested and the save handler silently dropped the sentences it had no input
 * for.
 */
import type { AppliedPathologyPatch, PendingPathologyPatch } from "./store";
import type { PathologyIncoming } from "../pathologyPatch";
import { normalizeForDedupe, splitToSentences } from "../reportFieldMerge";
import { stripUnfilledMeasurements } from "../unfilledMeasurements";
import { parseQuestions } from "../structuredFindings";
import type { QuickSelectParameterValues } from "./quickSelectParameterContract";

const opt = (v: string | null | undefined) => (v ?? "").trim() || undefined;

/**
 * A clinical box as PostgreSQL holds it and the API returns it.
 *
 * Every field the builder reads is optional except the identity and the four
 * sentences, because a box with no clinical metadata at all is a real and
 * permanent state, not an error: three of the boxes a clinic already had
 * (Hydrocephalus, Cerebral atrophy, Midline shift) are adopted by the factory
 * seed with their own wording, stamped customized, and no concept, conflict
 * group, baseline or category. Those boxes must keep working exactly as they do
 * today, and nothing here may invent ownership for them.
 */
export type ClinicalQuickFindingBox = {
  id: number;
  label: string;
  studyType: string;
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  concept?: string | null;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  properties?: string;
  /**
   * The box's own structured questions, as `radiology_quick_findings.questions_json`.
   *
   * Read here for one reason: a box that asks the radiologist for a side in its own
   * form must not also be keyed by the study-wide side chip. See
   * `quickSelectBoxAsksForSide`.
   */
  questionsJson?: string | null;
  /**
   * The report section the box was AUTHORED for — the column that decides where
   * a click sends its sentence. `NOT NULL` on `radiology_quick_findings` and
   * always on the wire; optional here only so a hand-built fixture may omit it.
   */
  field?: string | null;
};

/**
 * True when this box's own section is Clinical History rather than the report body.
 *
 * `radiology_quick_findings` has no history column, so the factory seed files a
 * history box's sentence in `finding_text` alongside every other box. Reading
 * that column as a finding is how "Known case of glioma post-resection" ends up
 * in Findings as though it were an observation of the scan. The comparison is
 * trimmed and case-folded because a clinic row can be spelled any way its editor
 * typed it, and the cost of missing one is a clinical sentence in the wrong
 * section — not the other way round.
 */
export function isClinicalHistoryBox(box: { field?: string | null }): boolean {
  return (box.field ?? "").trim().toLowerCase() === "clinicalhistory";
}

/**
 * The ledger row one database box owns for one click.
 *
 * Left and Right of one box are two claims at two slots — the engine already
 * resolves them to different `slotKey`s, because `buildSlotKey` carries
 * laterality — and the report the radiologist is writing says both. With one id
 * for both clicks the second click overwrote the first row in the ledger while
 * the first sentence stayed on the page (`dropIds` and the row filter both key on
 * the id): clicking the box off then removed one statement and left the other
 * printed, saved, and no longer removable through the ledger. A box that asks
 * for no side keeps the bare `qf-<id>` it has always had, so every existing
 * deselect caller and every saved draft still resolves.
 *
 * `selectedQuickFindingIds` is the other half of this contract — it has to parse
 * what this writes, or the box stops reading as selected the moment a side is
 * recorded. Both halves are pinned together in quickSelectTilePayload.test.ts.
 */
export function quickFindingRowId(boxId: number, side?: string): string {
  const chosen = (side ?? "").trim().toLowerCase();
  return chosen ? `qf-${boxId}:${chosen}` : `qf-${boxId}`;
}

/** True for any row this box wrote, at any side — what the chip state needs. */
export function quickFindingRowBelongsTo(id: string, boxId: number): boolean {
  return id === `qf-${boxId}` || id.startsWith(`qf-${boxId}:`);
}

/** The four sentences one box writes, as one string for the token tests. */
function boxSentences(box: {
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
}): string {
  return `${box.findingText} ${box.impressionText} ${box.techniqueText} ${box.recommendationText}`;
}

/**
 * True when this box's own wording asks which side, so its row is one per side.
 *
 * Left and Right of a box that reads its side from the chip are two claims at two slots, and the
 * ledger keeps them apart. A box that never asked must NOT be filed that way: measured on CT
 * Brain (study 271), "Intracranial Hemorrhage" — which asks only for a location and a
 * volume — was written as `qf-334:left` because the study-wide side chip happened to
 * be on left at the click. When the chip moved to right the tile read "selected at
 * the other side", its review showed "no row in the report ledger for the right
 * side", and clicking it again applied a second hemorrhage instead of withdrawing the
 * first. A one-claim box has one row, whichever chip is lit.
 */
export function quickSelectBoxAsksForSide(box: {
  findingText: string;
  impressionText: string;
  techniqueText: string;
  recommendationText: string;
  questionsJson?: string | null;
}): boolean {
  if (!/\{side\}/i.test(boxSentences(box))) return false;
  // The chip is one control shared by every box on the wall. A box that asks for the
  // side in its OWN form gets that answer from the dialog, not from the chip, so the
  // chip's value is some other box's answer and must not fork this box's identity.
  // Measured on MRI Brain Plain with the converted midline-shift box: answered "left"
  // in the form while the mastoid box had left the chip on "right", the tile read
  // "selected at the other side", its review card never opened, and clicking it again
  // applied rather than withdrew — the one finding the radiologist could see on the
  // page had no click that could take it off.
  return !declaresSideQuestion(box);
}

/** True when this box asks for the side itself, as one of its structured questions. */
function declaresSideQuestion(box: { questionsJson?: string | null }): boolean {
  return parseQuestions(box.questionsJson ?? null)
    .some((q) => (q.key ?? "").trim().toLowerCase() === "side");
}

/**
 * The overlay payload one database box click sends.
 *
 * This is the only builder, and it exists because the promise used to be written
 * twice — once here and once inline in `handleQuickToggle`, where it carried
 * less: no concept, no severity, no declared laterality, and one row id for both
 * sides. One engine with two unequal callers meant a box clicked from the
 * database was not clinically equal to the same box clicked from the strip, and
 * the database is where every box lives.
 *
 * `supportsLaterality` is declared from all four sentences on purpose. The store
 * resolves the side only when the observation declares laterality
 * (`store.ts:2316`), while the refusal guard scans every section it is about to
 * write (`unresolvedQuickSelectParameters`). Inference alone reads `findingsText`
 * and the `properties` column, so a box carrying `{side}` only in its
 * recommendation would be asked for a side it was never allowed to use — and
 * would refuse forever. Declaring from the same set the guard scans is what keeps
 * those two in step.
 */
export function quickFindingPatch(
  box: ClinicalQuickFindingBox,
  ctx: { region: string; studyType?: string },
  params: QuickSelectParameterValues = {},
): PendingPathologyPatch {
  // A history box's sentence is the indication for the scan, not a finding on it.
  // `radiology_quick_findings` has no history column, so the seed files it in
  // `finding_text` with everything else, and reading that column as a finding
  // reported "Right upper quadrant pain." as an observation of the liver. The
  // section that exists for it has its own write, so `incoming` stays empty and
  // the sentence travels as a contribution.
  const history = isClinicalHistoryBox(box);
  // Thirteen of the 496 active boxes were authored with a literal blank where a
  // number belongs — "largest measuring ___ mm", "Follow-up scan recommended in
  // ___ weeks" — and carry no questions, so nothing in the app ever asked the
  // radiologist for that number. What they printed instead was the blank, on the
  // signed report. The observation stays and the unfinished measurement goes.
  const raw: PathologyIncoming = {
    findings: history ? "" : box.findingText,
    impression: box.impressionText,
    technique: box.techniqueText,
    recommendation: box.recommendationText,
  };
  const templates: PathologyIncoming = {
    findings: stripUnfilledMeasurements(raw.findings).text,
    impression: stripUnfilledMeasurements(raw.impression).text,
    technique: stripUnfilledMeasurements(raw.technique).text,
    recommendation: stripUnfilledMeasurements(raw.recommendation).text,
  };
  const written = boxSentences(box);
  /**
   * Which parameters the caller asked the radiologist for.
   *
   * A box whose `{side}` reaches this builder as an ANSWERED question no longer
   * carries the token — the structured-details dialog substitutes "left" into the
   * sentence before the click is built, so the token test alone cannot see that the
   * box asked. Without the declaration the row is recorded as side-less while its
   * own sentence names a side, and the laterality rules that keep a left-sided claim
   * off the right side's normal have nothing to read.
   */
  const asked = (params.askedFor ?? []).map((k) => k.trim().toLowerCase());
  const sided = /\{side\}/i.test(written) || asked.includes("side");
  // The same question for the level, asked the same way laterality is asked: this
  // box either has a `{level}` to fill (or declares `level` in `properties`) or it
  // never asked, and an answer to a question this box did not ask is not a fact
  // about this box.
  //
  // The strip keeps one level chip for the whole study, so whichever spine box was
  // clicked last leaves its level lit — and the builder used to stamp that value
  // onto EVERY later click. "Disc protrusion L5-S1" (its level is in its own
  // sentence, it asks for nothing) clicked after a "Disc bulge (pick level)" at
  // L4-L5 was therefore recorded at L4-L5: the two resolved to one slot
  // (`LS Spine|disc_contour|L4-L5|*`), the second box took over the first box's
  // ledger row, and the L4-L5 bulge left the report — Findings, Impression and the
  // chip that could have brought it back (measured on the release candidate,
  // study 253: `tmp/evidence/probe-multi-253.json`). A level that names the wrong
  // vertebra is not a layout problem; the report no longer describes the disc the
  // radiologist selected.
  const levelled = /\{level\}/i.test(written)
    || /(^|,)\s*level\s*(,|$)/.test((box.properties ?? "").toLowerCase())
    || asked.includes("level");
  return {
    incoming: templates,
    templates,
    ...(history
      ? { clinicalHistory: stripUnfilledMeasurements((box.findingText ?? "").trim()).text || undefined }
      : {}),
    ownership: {
      anatomicalSection: opt(box.anatomicalSection),
      conflictGroup: opt(box.conflictGroup),
      // An empty string here is not "no baseline" to the engine, it is a sentence
      // to look for. Never hand it one the box did not declare.
      baselineReplaces: opt(box.baselineReplaces),
      concept: opt(box.concept) ?? null,
    },
    source: "quick-findings",
    // One row per side ONLY for a box that asks which side — see
    // `quickSelectBoxAsksForSide`. The strip resolves the same way, so the control
    // that withdraws a finding is always under the chip the radiologist can see.
    id: quickFindingRowId(box.id, quickSelectBoxAsksForSide(box) ? params.side : ""),
    region: ctx.region,
    studyType: ctx.studyType ?? box.studyType,
    concept: opt(box.concept) ?? null,
    label: box.label,
    catalogId: box.id,
    properties: box.properties,
    // The text the write produced, not the catalogue column it came from: this field
    // is what the ledger row stores, and a reopened study re-applies ledger rows.
    // Handing it the raw "largest measuring ___ mm" would bring the blank back after
    // the radiologist had saved and closed.
    findingsText: templates.findings,
    supportsLaterality: sided,
    ...(sided && params.side ? { side: params.side } : {}),
    ...(opt(params.severity) ? { severity: opt(params.severity) } : {}),
    // Phase 3, item B: the level a parameterized spine tile asks for travels the
    // same way side/severity do — the strip collects it from the chip, the
    // boundary validates it, and an unresolved `{level}` refuses the whole
    // click before any write (quickSelectParameterContract). A box that asks for
    // nothing is not refused and is not stamped: its own sentence carries its
    // level, and `extractLevel` reads it from there.
    ...(levelled && opt(params.level) ? { level: opt(params.level) } : {}),
  };
}

/**
 * The first decision one click makes: what it contributes to Clinical History,
 * and whether it also writes the report body.
 *
 * Extracted because the click handler is a React hook and this package has no
 * renderer, so a routing rule that lived only inside it could only ever be
 * pinned by reading the file — a mutant that turned the branch into
 * `if (false && …)` survived exactly that. Deciding here instead means the whole
 * shipped catalogue can be driven through the rule, and the handler is left with
 * one call to make.
 *
 * A box that is history AND carries body prose returns both, because dropping
 * either half would lose a sentence the radiologist clicked for.
 */
export function quickFindingClickRoute(patch: PendingPathologyPatch): {
  clinicalHistory: string | null;
  writesBody: boolean;
} {
  return {
    clinicalHistory: opt(patch.clinicalHistory) ?? null,
    writesBody: Object.values(patch.incoming).some((v) => (v ?? "").trim().length > 0),
  };
}

/** The four sections of the report body a box can write. */
const BODY_SECTIONS = ["findings", "impression", "technique", "recommendation"] as const;
type BodySection = (typeof BODY_SECTIONS)[number];

/** The sentences one section's contribution actually says, comparable across sections. */
const sentencesOf = (text: string | undefined): string[] =>
  splitToSentences(text ?? "").map(normalizeForDedupe).filter(Boolean);

/**
 * A sentence this click would write that the report already carries in ANOTHER
 * section, contributed by a row from the deleted tile strip.
 *
 * Saved drafts and signed reports hold Quick Select rows whose id is `qs-…` and
 * whose `source` is `quick-select` — written by the strip this branch removed.
 * Those rows stay exactly as they are: their text is not moved, and nothing
 * rewrites them, because a legacy tile id was minted at module load and cannot be
 * matched to a database box without guessing at the radiologist's document. But
 * the section each box belongs to changed when `quickFindingPatch` became the only
 * builder: an advice box that used to write Impression now writes Recommendation,
 * so a draft that already carries the advice in Impression gets a SECOND copy when
 * the radiologist clicks the box again — the chip cannot light for a `qs-` row, so
 * nothing told them it was already there.
 *
 * Refusing the duplicate is the smallest thing that cannot lose clinical text: it
 * writes nothing, and the message names where the wording already sits. Only the
 * strip's own rows are consulted — a live row can be clicked off, and a wording
 * repeat the engine already handles within one section is not this defect.
 */
export function quickFindingCrossSectionClash(
  rows: ReadonlyArray<Pick<AppliedPathologyPatch, "id" | "source" | "lastRendered">>,
  patch: PendingPathologyPatch,
): { section: BodySection; sentence: string } | null {
  const wanted = BODY_SECTIONS
    .flatMap((section) => sentencesOf(patch.incoming[section]).map((sentence) => ({ section, sentence })));
  if (!wanted.length) return null;
  for (const row of rows) {
    if (row.source !== "quick-select") continue;
    for (const section of BODY_SECTIONS) {
      const held = new Set(sentencesOf(row.lastRendered[section]));
      if (!held.size) continue;
      const clash = wanted.find((w) => w.section !== section && held.has(w.sentence));
      if (clash) return { section, sentence: clash.sentence };
    }
  }
  return null;
}

/**
 * What one click on a box did, as the clicker learns it.
 *
 * The first three are `applyPathologyOverlay`'s own verdict, passed straight
 * through: `"applied"` wrote, `"pending"` wrote and opened the same-slot confirm
 * dialog, `"refused"` wrote nothing — a signed report, or a `{side}`/`{severity}`
 * nobody chose. `"removed"` is the deselect branch, which goes through
 * `removeObservation` instead and has no overlay verdict to report.
 *
 * A clicker has to be able to tell `"refused"` from the rest, because everything
 * it would otherwise do next is a claim that the write landed: counting a use,
 * highlighting the finding as feedback, firing a draft save the server is
 * certain to refuse.
 */
export type QuickToggleOutcome = "applied" | "pending" | "refused" | "removed";
