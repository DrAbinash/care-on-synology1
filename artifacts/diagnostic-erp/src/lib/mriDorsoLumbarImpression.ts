/**
 * mriDorsoLumbarImpression.ts — the Dorso-Lumbar Impression priority (spec §26).
 *
 * The dedicated Dorso-Lumbar examination states its own clinical order, and it
 * is not the lumbar/dorsal §37 order: an acute fracture, infection or
 * destructive lesion leads, then anything touching the cord → conus → cauda
 * transition, then the junction itself. This file therefore supplies a rank
 * TABLE, not a second Impression engine: the store keeps calling
 * `orderImpressionLines` (so `impressionOrderFrozen` and the manual-prose rules
 * stay in one place) and only hands it `rankDorsoLumbarImpressionLine` when the
 * study resolves to the `dorsolumbar-dedicated` composition.
 *
 * Two differences from the global table are deliberate:
 *
 *   - The MOST SEVERE matching category wins rather than the first phrase. A
 *     Dorso-Lumbar sentence legitimately names levels from both halves of the
 *     spine, so "Severe central canal stenosis at T10-T11 with cord compression"
 *     must read as neural compromise (§26 rank 2), not as canal disease.
 *   - Categories 3, 4 and 5 need a significance qualifier as well as a level.
 *     "Disc height preserved at T12-L1" mentions the bridge without being
 *     significant junctional pathology, and must not lead the Impression.
 *
 * Ranking reorders lines that the ledger already produced. Nothing here writes,
 * renumbers or rewords a sentence.
 */

import { UNCLASSIFIED_RANK, type RankedImpressionLine } from "./impressionPriority";

export type DorsoLumbarImpressionRule = {
  id: string;
  label: string;
  /** Lower sorts first. Mirrors the numbered §26 order. */
  rank: number;
  re: RegExp;
  /** When set, this category only applies if the line also says this. */
  also?: RegExp;
  /** When set, a line matching this is NOT this category (see MILD_LEAD below). */
  unless?: RegExp;
};

/** Spec §26, quoted so the table and the specification cannot drift silently. */
export const DORSOLUMBAR_IMPRESSION_SPEC_ORDER = [
  "1. acute fracture / infection / destructive lesion",
  "2. cord/conus/cauda compression or intrinsic signal",
  "3. significant thoracolumbar junction pathology",
  "4. major thoracic canal/disc disease",
  "5. major lumbar canal/recess/foraminal disease",
  "6. tumor/intradural disease",
  "7. deformity/postoperative issue",
  "8. important screening finding",
  "9. radiologist-selected recommendation",
] as const;

/** Minor degeneration alone is Findings-only material, same as the §37 rule. */
export const DORSOLUMBAR_MINOR_DEGENERATIVE_RANK = 90;

const FRACTURE_OR_INFECTION = /\b(?:acute|subacute)[^.]{0,60}\bfractur\w*|\b(?:burst|pathologic(?:al)?|insufficiency|wedge|compression|avulsion) fracture\b|\bfractur\w*\b[^.]{0,60}\b(?:retropulsion|marrow edema|oedema|edema)\b|\bretropulsion\b|\bspondylodiscitis\b|\bdiscitis\b|\bosteomyelitis\b|\b(?:epidural|paravertebral|psoas|prevertebral) (?:abscess|haematoma|hematoma|collection)\b|\babscess\b|\bphlegmon\b|\binfection\b|\bdestructive (?:lesion|change|process)\b|\bmarrow[- ]replacing\b/i;

const NEURAL_COMPROMISE = /\b(?:cord|conus|conus medullaris|cauda[- ]equina)\b[^.]{0,70}\b(?:compress\w*|flattening|tethering|kinking|swelling|expansion|crowding|clumping|hyper\w*|signal change|abnormal signal|edema|oedema|myelomalacia)\b|\b(?:compression|flattening|hyperintensity|signal change|crowding)\b[^.]{0,70}\b(?:cord|conus|cauda[- ]equina|nerve roots)\b|\b(?:cord|conus)\b[^.]{0,40}\bintrinsic (?:t2|stir)\b|\bintrinsic (?:t2|stir) (?:cord|conus)? ?(?:hyper\w*|signal)\b|\bmyelomalacia\b|\bcompressive myelopathy\b|\bmyelopathy\b|\bsyrinx\b|\bcauda[- ]equina syndrome\b/i;

const JUNCTION_NAMING = /\bthoracolumbar\b|\bjunctional\b|\b(?:T1[0-2]|D1[0-2])[-/ ](?:L1|D1)\b|\bL1[-/ ](?:T1[0-2]|D1[0-2])\b|\b(?:T11-T12|D11-D12)\b|\bL1-L2\b/i;

const SIGNIFICANT_PATHOLOGY = /\b(?:fracture|retropulsion|gibbus|kyphosis|listhesis|instability|disruption|stenosis|compromise|compress\w*|cord|conus|spondylodiscitis|discitis|abscess|destructive|marrow edema|oedema|edema|extrusion|migration)\b/i;

const THORACIC_NAMING = /\b(?:[TD][1-9]|T1[0-2]|D1[0-2])(?:[-/ ](?:[TD][1-9]|T1[0-2]|D1[0-2]|L1))?\b/i;

const LUMBAR_NAMING = /\bL\d+(?:[-/ ](?:L\d+|S\d+|T))?\b|\bLS\b/i;

const CANAL_OR_DISC_DISEASE = /\b(?:canal (?:stenosis|narrowing|compromise)|central canal|thecal sac (?:indentation|compression)|spinal stenosis)\b|\bdisc\b[^.]{0,40}\b(?:protrusion|extrusion|migration|sequestration|bulge|herniation)\b|\b(?:protrusion|extrusion|sequestered disc|disc herniation|canal stenosis)\b|\blateral recess\b|\bforaminal (?:stenosis|narrowing)\b|\b(?:nerve root|root)\b[^.]{0,30}\b(?:compress\w*|imping\w*)\b|\bfacet (?:joint )?(?:hypertrophy|arthropathy)\b/i;

const TUMOR_OR_INTRADURAL = /\b(?:metastat\w*|myeloma|lymphoma|tumou?r|neoplasm|hemangioma|haemangioma|schwannoma|meningioma|neurofibroma|ependymoma|astrocytoma|hemangioblastoma)\b|\bintradural\b|\bintramedullary\b|\bextramedullary\b|\bmeningeal\b|\bpathologic fracture\b[^.]{0,40}\b(?:tumour|tumor|marrow)\b/i;

const DEFORMITY_OR_POSTOP = /\b(?:scolio\w*|kyphosis|kyphotic|lordosis|gibbus)\b|\b(?:post-?operative|post-?surgical|status post|hardware|instrumentation|fused|fusion|laminectomy|laminotomy)\b|\bpseudomeningocele\b|\b(?:adjacent segment|recur\w*|recessio\w*) (?:disc|stenosis|degeneration)\b|\bepidural fibrosis\b|\b(?:fracture)\b[^.]{0,40}\b(?:healed|old|chronic|prior)\b|\b(?:healed|old|chronic|prior)\b[^.]{0,40}\bfractur\w*\b/i;

const SCREENING_FINDING = /\bscreening\b|\bincidental\w*\b/i;

const RECOMMENDATION = /\brecommend\w*\b|\bfurther (?:imaging|evaluation|investigation|correlation)\b|\bclinical correlation\b|\bfollow[- ]?up\b|\b(?:CT|MR|ultrasound|nuclear|bone scan) correlation\b/i;

const MINOR_DEGENERATIVE = /\b(?:mild|moderate)[a-z ]*(?:disc bulge|facet|spondylosis|degenerat\w*|foraminal narrowing|osteophyte)\b|\bdisc desiccation\b|\bosteophytes?\b|\bmodic type(?:\s*(?:i{1,3}|iv|1|2|3|4))?\b|\bendplate changes?\b|\bunremarkable\b|\bno (?:significant|acute)\b/i;

/**
 * Categories 3, 4 and 5 are the spec's MAJOR findings. A line that opens with a
 * mild qualifier is not one of them, whatever anatomical words follow, so it
 * falls through to the minor-degeneration rank instead of leading the Impression.
 * Only a leading qualifier demotes: "Moderate central canal stenosis … with cauda
 * equina crowding" keeps its severity, and the neural clause outranks it anyway.
 */
const MILD_LEAD = /^\s*(?:mild|minimal|trace|very\s+mild)\b/i;

/**
 * The nine §26 categories, in the spec's own order, plus the two ranks a real
 * report needs so a line is never silently ranked with the urgent findings:
 * unclassified (§26 does not name it) and minor degeneration (Findings-only).
 */
export const DORSOLUMBAR_IMPRESSION_PRIORITY: DorsoLumbarImpressionRule[] = [
  { id: "dl-acute-fracture-infection", label: "acute fracture / infection / destructive lesion", rank: 1, re: FRACTURE_OR_INFECTION },
  { id: "dl-neural-compromise", label: "cord / conus / cauda compression or intrinsic signal", rank: 2, re: NEURAL_COMPROMISE },
  { id: "dl-junction", label: "significant thoracolumbar junction pathology", rank: 3, re: JUNCTION_NAMING, also: SIGNIFICANT_PATHOLOGY, unless: MILD_LEAD },
  { id: "dl-thoracic-canal-disc", label: "major thoracic canal / disc disease", rank: 4, re: THORACIC_NAMING, also: CANAL_OR_DISC_DISEASE, unless: MILD_LEAD },
  { id: "dl-lumbar-canal-recess", label: "major lumbar canal / recess / foraminal disease", rank: 5, re: LUMBAR_NAMING, also: CANAL_OR_DISC_DISEASE, unless: MILD_LEAD },
  { id: "dl-tumor-intradural", label: "tumor / intradural disease", rank: 6, re: TUMOR_OR_INTRADURAL },
  { id: "dl-deformity-postop", label: "deformity / post-operative issue", rank: 7, re: DEFORMITY_OR_POSTOP },
  { id: "dl-screening-finding", label: "important screening finding", rank: 8, re: SCREENING_FINDING },
  { id: "dl-recommendation", label: "radiologist-selected recommendation", rank: 9, re: RECOMMENDATION },
  { id: "dl-minor-degenerative", label: "minor degenerative change", rank: DORSOLUMBAR_MINOR_DEGENERATIVE_RANK, re: MINOR_DEGENERATIVE },
];

/** Does a line carry this category? `also` is the significance qualifier. */
export function matchesDorsoLumbarImpressionRule(
  rule: DorsoLumbarImpressionRule,
  text: string,
): boolean {
  if (!rule.re.test(text)) return false;
  if (rule.also && !rule.also.test(text)) return false;
  if (rule.unless && rule.unless.test(text)) return false;
  return true;
}

/**
 * Classify one Impression line into the §26 categories. The most severe
 * matching category wins; ties keep the table order.
 */
export function rankDorsoLumbarImpressionLine(
  line: string,
  index = 0,
): RankedImpressionLine {
  const text = (line ?? "").trim();
  let best: DorsoLumbarImpressionRule | null = null;
  for (const rule of DORSOLUMBAR_IMPRESSION_PRIORITY) {
    if (!matchesDorsoLumbarImpressionRule(rule, text)) continue;
    if (!best || rule.rank < best.rank) best = rule;
  }
  if (!best) {
    return { line: text, rank: UNCLASSIFIED_RANK, label: "other finding", ruleId: null, index };
  }
  return { line: text, rank: best.rank, label: best.label, ruleId: best.id, index };
}

/** Which §26 category a set of Impression lines falls into, for previews/tests. */
export function dorsoLumbarImpressionCategories(
  lines: readonly string[],
): Array<RankedImpressionLine> {
  return lines.map((line, index) => rankDorsoLumbarImpressionLine(line, index));
}
