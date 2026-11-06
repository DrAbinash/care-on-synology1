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
 * plain.
 *
 * A withheld box is counted and named on the strip, never silently dropped: the Phase 1 complaint
 * about the anatomy chip was exactly that tiles vanished with no explanation.
 */
import {
  parseBrainSequences,
  SEQUENCE_STATEMENT_RULES,
} from "@/lib/mriBrainSequences";
import type { QuickSelectCatalogueBox } from "./quickSelectBoxCatalogue";

export type ContrastStatus = "given" | "not-given" | "unknown";

const CONTRAST_GIVEN = /\b(?:with contrast|contrast[- ]enhanced|contrast[- ]administered|post[- ]?contrast|ce[- ]?mri|gadolinium)\b/i;
const CONTRAST_WITHHELD = /\b(?:plain|non[- ]?contrast|unenhanced|without contrast|no contrast|nct)\b/i;

/**
 * Was contrast given for this study?
 *
 * The examination name wins over the technique field: it is what was booked and billed, and the
 * technique the tab pre-fills is frequently untouched. Whichever source speaks first decides, and a
 * study nothing has described stays `unknown`.
 */
export function studyContrastStatus(input: {
  examName?: string | null;
  protocolName?: string | null;
  techniqueText?: string | null;
}): ContrastStatus {
  const named = `${input.examName ?? ""} ${input.protocolName ?? ""}`.trim();
  if (CONTRAST_GIVEN.test(named)) return "given";
  if (CONTRAST_WITHHELD.test(named)) return "not-given";
  const technique = (input.techniqueText ?? "").trim();
  if (technique) {
    // `parseBrainSequences` already resolves "non-contrast" against the bare word "contrast".
    if (parseBrainSequences(technique).performed.contrast) return "given";
    if (CONTRAST_WITHHELD.test(technique)) return "not-given";
  }
  return "unknown";
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
export function boxNeedsContrast(box: QuickSelectCatalogueBox): boolean {
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
function declaredContrast(box: QuickSelectCatalogueBox): boolean | null {
  const raw = (box as { properties?: string | null }).properties;
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
 * Only MR boxes are gated, and only against a study that positively declares no contrast; every
 * other combination returns the boxes untouched, so `withheld` is empty for CT, US, XR and for an
 * MRI whose contrast status is unknown.
 */
export function withholdContrastOnlyBoxes<T extends QuickSelectCatalogueBox>(
  boxes: readonly T[],
  opts: { modality?: string | null; status: ContrastStatus },
): ContrastWithholding<T> {
  if (opts.modality !== "MR" || opts.status !== "not-given") {
    return { offered: [...boxes], withheld: [] };
  }
  const offered: T[] = [];
  const withheld: T[] = [];
  for (const box of boxes) (boxNeedsContrast(box) ? withheld : offered).push(box);
  return { offered, withheld };
}
