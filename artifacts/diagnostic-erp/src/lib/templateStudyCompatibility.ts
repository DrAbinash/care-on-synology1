/**
 * Can this structured template be signed against this study?
 *
 * `templateRegionMismatch` already answers the narrow version of this — it
 * compares the PRIMARY selected region with the template's body part — and its
 * verdict is painted on screen as an amber banner with a "Load correct template"
 * button. It never stopped anything: Finalize & Sign went through with the
 * banner showing, so a report could be signed under a template for anatomy the
 * study does not cover, and the printed normal statements would describe a scan
 * nobody took.
 *
 * The banner's rule is too blunt to block with. It fires on four arrangements
 * that are legitimate reporting, and refusing to sign those would be a worse
 * defect than the one being closed:
 *
 *   - Whole-spine screening. The shipped "MRI Cervical Spine with Whole Spine
 *     Screening" row is body part Cervical and speaks for the dorsal and
 *     lumbosacral spine too, so it mismatches an LS booking by design.
 *   - Screening sequences, which declare that scope in `study_type`.
 *   - Combined studies and multiregion examinations. The Region chips are
 *     multi-select; a Cervical + LS booking reported on the LS row mismatches
 *     only because the detector reads `studyRegions[0]`.
 *
 * So this is the banner's verdict narrowed to the case that has no legitimate
 * reading: a template that belongs to none of the regions actually selected and
 * declares no wider screening scope. Everything else keeps today's behaviour —
 * warn, and let the radiologist sign.
 */
import { declaresWholeSpineScreening } from "@workspace/report-quality";
import { studyRegionToBodyPart } from "./pickStructuredTemplate";

export type TemplateStudyCompatibilityInput = {
  /** The shipped detector's verdict on the primary region. */
  templateMismatch: boolean;
  /** Every region selected for this study, not just the first. */
  studyRegions: readonly (string | null | undefined)[];
  templateBodyPart: string | null | undefined;
  templateName: string | null | undefined;
  templateStudyType: string | null | undefined;
};

export type TemplateStudyIncompatibility = {
  templateName: string;
  /** The regions this study actually covers, for the refusal message. */
  studyRegions: string[];
};

/**
 * The template this report cannot be signed under, or null when signing is
 * allowed to proceed.
 */
export function incompatibleTemplateForStudy(
  input: TemplateStudyCompatibilityInput,
): TemplateStudyIncompatibility | null {
  // The banner is not showing, so nothing downstream of it has a case to answer.
  if (!input.templateMismatch) return null;

  const templateName = (input.templateName ?? "").trim();
  const regions = input.studyRegions
    .map((r) => (r ?? "").trim())
    .filter((r): r is string => r.length > 0);
  if (regions.length === 0) return null;

  // A row that declares it screens the whole spine documents more than the
  // region it is named after. Same declaration, same reader as the format
  // resolver and `pickStructuredTemplateForRegion` use — one spelling of the
  // test, so the ceiling and the signature cannot disagree about it.
  if (declaresWholeSpineScreening(`${templateName} ${input.templateStudyType ?? ""}`)) return null;

  // A combined or multiregion examination: the template belongs to one of the
  // regions that was actually selected, just not the first one.
  const bodyPart = (input.templateBodyPart ?? "").trim();
  if (bodyPart && regions.some((r) => studyRegionToBodyPart(r) === bodyPart)) return null;

  return { templateName: templateName || "the selected template", studyRegions: regions };
}
