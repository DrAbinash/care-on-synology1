/**
 * A contrast-dependent box is not offered on a study reported without contrast.
 *
 * Measured on the shipped MRI catalogue at f96d92f1: an "MRI Brain Plain" study and an "MRI Brain
 * With Contrast" study are given the SAME box wall, because the only scoping the strip applies is
 * modality and region (`lookupTilesForContext`). Box #448 "Glioma recurrence" — "Heterogeneously
 * **enhancing** area in the right frontal operculum at the post-resection cavity" — sits on that
 * wall for both, so one click on a plain study puts an enhancement claim into Findings and into the
 * signed report for a sequence that was never given. The same applies to #470, the enhancing
 * intradural extramedullary cervical lesion.
 *
 * Both halves of the decision already exist in this repo, and this module reuses them rather than
 * inventing a third vocabulary:
 *  * whether contrast was given — `mriBrainSequences.ts`, whose own docblock names techniqueText as
 *    "the single source of truth the workspace already has". The study's own name and protocol are
 *    read too, because the shipped Brain technique line ("…including T1, T2, FLAIR, DWI, and GRE
 *    sequences.") says nothing about contrast either way, and an "MRI Brain With Contrast" row must
 *    not have its enhancement boxes withheld from it.
 *  * whether a box's prose asserts enhancement — the `contrast` arm of `SEQUENCE_STATEMENT_RULES`,
 *    the same rule that already refuses to emit a contrast-dependent statement without contrast.
 *
 * Withholding is only done when the study *positively* declares no contrast ("Plain",
 * "Non-contrast", "without contrast"). Unknown stays as it is today, so this can never be the
 * reason a radiologist's box disappears, and it changes nothing outside MR — an ultrasound box
 * saying "posterior acoustic enhancement" is not about gadolinium and no US study declares itself
 * plain. A study whose sources positively DISAGREE is withheld too, and said so as a disagreement:
 * on that study the unsafe reading is the permissive one, since the sentence that goes into the
 * report is the one asserting an enhancement a plain study cannot show, and the notice names which
 * two fields disagree so the record can be corrected rather than worked around.
 *
 * A withheld box is counted and named on the strip, never silently dropped: the Phase 1 complaint
 * about the anatomy chip was exactly that tiles vanished with no explanation. And a box hidden from
 * one wall but still insertable through another door is the same unsafe sentence in the same signed
 * report, so the two halves of that promise — withhold, then say so — are also enforced at the write
 * boundary every one of those doors passes through (`store.ts`, `applyPathologyOverlay`). This
 * module is the only copy of the rule; the boundary asks it the question rather than keeping its own.
 */
import { toast } from "@/hooks/use-toast";
import {
  parseBrainSequences,
  SEQUENCE_STATEMENT_RULES,
} from "@/lib/mriBrainSequences";
import {
  contrastConflictSentence,
  contrastStateOfField,
  contrastStateOfReadings,
  type ContrastFieldState,
  type ContrastReading,
} from "@workspace/report-quality";

/**
 * `conflict` is a fourth answer, and it is not the same as `unknown`.
 *
 * `unknown` means nothing has described the study, which is why withholding has
 * always left it alone — a tile must never vanish because metadata is missing.
 * `conflict` means the study describes itself BOTH ways, which is the one case
 * where offering the enhancement box and withholding it are both guesses.
 */
export type ContrastStatus = "given" | "not-given" | "unknown" | "conflict";

const STATUS_BY_STATE: Record<ContrastFieldState | "conflict", ContrastStatus> = {
  plain: "not-given",
  contrast: "given",
  both: "given",
  unknown: "unknown",
  conflict: "conflict",
};

/**
 * Was contrast given for this study?
 *
 * Every source is read on its own and the readings are combined by the SHARED
 * vocabulary (`@workspace/report-quality`), which is what Q112 uses to check the
 * signed report. Until now the gate kept its own two regexes and tested its
 * affirmation first, while the shared reader tested its denial first — so
 * "MRI BRAIN (PLAIN)" beside a post-contrast protocol was `given` here and `plain`
 * there, and the wall offered box #448 for a study the server would have flagged
 * for describing enhancement. Two answers to one question is the defect; the
 * answer to a disagreement is now `conflict`, named below rather than chosen.
 *
 * The one thing this adds to the shared reader: an MRI Technique line is also put
 * through `parseBrainSequences`, whose own docblock names it the single source of
 * truth the workspace already has, and which arms on a sequence list — "Plain and
 * post-contrast sequences." names an acquisition, so the field describes BOTH phases
 * and counts as contrast, exactly as it did before this module delegated. It can
 * only ever raise a field's reading, never lower one, so it cannot manufacture a
 * conflict out of one field read two ways.
 */
export function contrastReadingsForStudy(input: {
  examName?: string | null;
  protocolName?: string | null;
  techniqueText?: string | null;
}): ContrastReading[] {
  const technique = (input.techniqueText ?? "").trim();
  let techniqueState = contrastStateOfField(technique);
  if (technique && (techniqueState === "unknown" || techniqueState === "plain")) {
    if (parseBrainSequences(technique).performed.contrast) {
      techniqueState = techniqueState === "plain" ? "both" : "contrast";
    }
  }
  return [
    { label: "the examination name", text: input.examName ?? null, state: contrastStateOfField(input.examName) },
    { label: "the protocol", text: input.protocolName ?? null, state: contrastStateOfField(input.protocolName) },
    { label: "the Technique line", text: technique, state: techniqueState },
  ];
}

export function studyContrastStatus(input: {
  examName?: string | null;
  protocolName?: string | null;
  techniqueText?: string | null;
}): ContrastStatus {
  return STATUS_BY_STATE[contrastStateOfReadings(contrastReadingsForStudy(input).map((r) => r.state))];
}

/**
 * Why this study is a conflict, in the operator's own words, or null when it is not.
 *
 * "the examination name says no contrast while the protocol says contrast was
 * given" — the message has to name BOTH sides, because the fix is a data
 * correction the radiologist can only make in the right field.
 */
export function studyContrastConflict(input: {
  examName?: string | null;
  protocolName?: string | null;
  techniqueText?: string | null;
}): string | null {
  return contrastConflictSentence(contrastReadingsForStudy(input));
}

const CONTRAST_RULE = SEQUENCE_STATEMENT_RULES.find((r) => r.key === "contrast");

/**
 * Advice about contrast is not an observation made with contrast.
 *
 * Box #4 "Tumor" says in Findings "A well/ill-defined space-occupying lesion is noted with
 * surrounding edema and mass effect", and in Impression "… suggest contrast-enhanced study /
 * histopathological correlation". That is the correct advice to give on a plain MRI, and withholding
 * the mass box from a plain study would take away the only way to record a mass. So a clause is
 * advice when the recommending verb and the contrast token sit in the same clause, and an assertion
 * otherwise: "Heterogeneously enhancing area … suggestive of edema" keeps "suggest" far from any
 * contrast token and stays an assertion.
 */
const CONTRAST_ADVICE = /\b(?:suggest(?:s|ed|ing)?|recommend(?:s|ed)?|advise|advised|consider|prefer|require|for further|optionally)\b[^.;]{0,48}\b(?:contrast|gadolin\w*|enhanc\w+)\b/i;

/**
 * The part of a box this gate reads: its two assertion sections and the author's declaration.
 *
 * Declared as a type because the same question is now asked of two shapes — a catalogue box on the
 * strip's wall, and the sentences one pending write is about to put into the report. Widening the
 * signature instead of writing a second predicate is what keeps those two from ever disagreeing: a
 * box hidden on the wall but accepted at the boundary, or the reverse, is one regex away from
 * happening, and the audit's complaint about this rule was precisely that it only lived on the wall.
 */
export type ContrastJudgedProse = {
  findingText?: string | null;
  impressionText?: string | null;
  properties?: string | null;
};

/**
 * True when the box ASSERTS enhancement.
 *
 * The author's declaration decides when there is one, and the prose scan is the fallback for boxes
 * authored before anyone thought to declare: `properties.requiresContrast` is what the macro
 * conversion stamps on its two enhancement sentences, and it is settable in the editor, so the
 * catalogue's author — not a regular expression — has the last word in both directions. Measured on
 * the live catalogue the prose scan flags 4 of 104 MR findings boxes and not one of them is a
 * sentence saying enhancement is ABSENT, so the fallback is not over-reaching today; the declaration
 * is what keeps it from doing so the day someone authors "Non-enhancing lesion".
 *
 * Only the two assertion sections are scanned: Technique describes what was done and Recommendation
 * describes what to do next, and neither can put a contrast-dependent observation into the report.
 */
export function boxNeedsContrast(box: ContrastJudgedProse): boolean {
  const declared = declaredContrast(box);
  if (declared !== null) return declared;
  if (!CONTRAST_RULE) return false;
  const asserted = [box.findingText ?? "", box.impressionText ?? ""];
  return asserted.some((sentence) =>
    CONTRAST_RULE.re.test(sentence) && !CONTRAST_ADVICE.test(sentence));
}

/**
 * The author's own flag, read out of the `properties` column: `true`, `false`, or `null` for nothing
 * declared.
 *
 * `properties` is free text on this table — the shipped catalogue stores the bare word "side" in it —
 * so anything that is not a JSON object spelling the flag out reads as no declaration and the prose
 * decides.
 */
function declaredContrast(box: ContrastJudgedProse): boolean | null {
  const raw = box.properties;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const flag = (parsed as { requiresContrast?: unknown }).requiresContrast;
    return typeof flag === "boolean" ? flag : null;
  } catch {
    return null;
  }
}

export type ContrastWithholding<T> = { offered: T[]; withheld: T[] };

/**
 * Split one strip's boxes by what the study allows.
 *
 * Only MR boxes are gated, and only against a study that positively declares no contrast or whose
 * declarations disagree; every other combination returns the boxes untouched, so `withheld` is
 * empty for CT, US, XR and for an MRI whose contrast status is unknown.
 *
 * Generic over `ContrastJudgedProse` rather than over the catalogue box type because that is all
 * this decision reads: the strip hands it whole boxes and the write boundary hands it the two
 * sentences and the declaration one pending click carries. Same call, same answer, one implementation.
 */
export function withholdContrastOnlyBoxes<T extends ContrastJudgedProse>(
  boxes: readonly T[],
  opts: { modality?: string | null; status: ContrastStatus },
): ContrastWithholding<T> {
  if (opts.modality !== "MR" || (opts.status !== "not-given" && opts.status !== "conflict")) {
    return { offered: [...boxes], withheld: [] };
  }
  const offered: T[] = [];
  const withheld: T[] = [];
  for (const box of boxes) (boxNeedsContrast(box) ? withheld : offered).push(box);
  return { offered, withheld };
}

/**
 * Would THIS write be withheld from THIS study?
 *
 * The one-click form of `withholdContrastOnlyBoxes`, and routed through it rather than re-stated
 * here: the wall a radiologist reads and the boundary that writes cannot then disagree, which is
 * what "enforce the restriction across all insertion paths" asks for. The Clinic Quick Select panel,
 * the voice path, the structured-details dialog and the section strips all reach that boundary
 * through one handler without ever consulting a strip, and the sentence they carry is the same #448
 * sentence.
 */
export function contrastWithholdsWrite(
  write: ContrastJudgedProse,
  opts: { modality?: string | null; status: ContrastStatus },
): boolean {
  return withholdContrastOnlyBoxes([write], opts).withheld.length > 0;
}

/**
 * The clause the strip prints under its withheld count.
 *
 * Lives here rather than in the JSX because the two halves of the sentence are
 * different claims: "this study is reported without contrast" is a fact about the
 * record, and on a conflicted study the record asserts both, so the only honest
 * clause is the disagreement itself. One function, so the wall cannot say one
 * thing while the refusal toast says another.
 */
export function contrastWithheldReason(status: ContrastStatus, conflict: string | null): string {
  return status === "conflict" && conflict
    ? `this study's own record disagrees: ${conflict}`
    : "this study is reported without contrast";
}

/**
 * Says out loud why a box did not land, in the same voice as the side/severity and placeholder
 * refusals in `quickSelectParameterContract`.
 *
 * This one has to do more than report the refusal: the radiologist is looking at a box the catalogue
 * offers and a report that will not take it, so the message names the reason the study gives (it
 * declares no contrast), states that nothing was written, and gives the two ways out that are
 * actually theirs to take — correct the examination or Technique if contrast really was given, or
 * choose a box that does not assert enhancement. Never a silent drop: that is the Phase 1 complaint
 * this module already answers for the wall.
 *
 * On a conflicted study the second sentence changes, because the reason is not "this study had no
 * contrast" — that is not known — and a message that asserted it would be this module making the
 * same silent pick the gate exists to refuse. It names the two fields that disagree instead, which
 * is the only thing the operator can act on.
 */
export function announceContrastWithheldRefusal(label: string, conflict?: string | null): void {
  toast({
    title: `Nothing was applied — “${label}” describes a contrast finding`,
    description: conflict
      ? `This study's own record disagrees about contrast: ${conflict}. While it does, a sentence that `
        + "asserts enhancement cannot be checked against the examination, and nothing was written to the "
        + "report. Put the examination name, the protocol and the Technique line in agreement — the one "
        + "that matches what the patient actually had — and click the box again; no other part of the "
        + "report was changed."
      : "This study is reported without contrast, so this box's sentence cannot be supported by it, and "
        + "nothing was written to the report. If contrast WAS given, correct the examination name or the "
        + "Technique field and click the box again; otherwise choose a box that does not assert enhancement. "
        + "No part of the report was changed.",
    variant: "destructive",
    duration: 8000,
  });
}
