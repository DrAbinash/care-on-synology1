/**
 * mriSpineContradictions.ts — MRI spine contradiction validation (spec §39).
 *
 * Extends the EXISTING validator rather than replacing it: the structured
 * ledger checks (`structuredCanalApContradiction`, `ledgerSeverityContradiction`)
 * stay where they are, and this module adds the rules the V3 sub-masters make
 * reachable — normal-vs-abnormal pairs, sequence-dependent statements, and
 * level-naming consistency under transitional anatomy.
 *
 * Every rule returns a WARNING. Nothing here rewrites, deletes or reorders the
 * radiologist's text: a contradiction is a question raised, not an edit made.
 */

import { splitToSentences } from "./reportFieldMerge";
import {
  SPINE_STATEMENT_RULES,
  type SpineSequencesAvailable,
} from "./mriSpineSequences";
import {
  isNonStandardNumbering,
  lumbarLevelKeyStrings,
  numberingCautionSentence,
  type LumbarNumberingState,
} from "./mriSpineNumbering";

type Pair = {
  id: string;
  label: string;
  /** The normal claim present in the report… */
  normal: RegExp;
  /** …that sits alongside this abnormality. */
  abnormal: RegExp;
};

/**
 * Normal-vs-abnormal pairs. The abnormal side is deliberately narrow (an
 * explicit statement of the abnormality), so an incidental word cannot fire it.
 */
export const LUMBAR_CONTRADICTION_PAIRS: Pair[] = [
  {
    id: "alignment",
    label: "alignment",
    normal: /\b(?:lumbar )?alignment (?:is |remains )?(?:normal|preserved|maintained|within normal limits)\b|\bnormal lumbar lordosis\b|\bpreserved lumbar lordosis\b|\bno (?:spondyl|anto|reto)listhesis\b/i,
    abnormal: /\b(?:anterolisthesis|retrolisthesis|spondylolisthesis|degenerative scoliotic curvature|reversal of lumbar lordosis)\b/i,
  },
  {
    id: "marrow",
    label: "marrow / endplates",
    normal: /\bmarrow signal(?: intensities)? (?:are |is )?normal\b|\bno focal osseous lesion\b|\bvertebral bodies (?:and discs )?appear normal\b/i,
    abnormal: /\bmodic type(?:\s*[i3]+)?\b|\bmarrow edema\b|\b(?:osseous metastases|marrow infiltrating)\b|\bdiscitis|\bosteomyelitis\b|\bspondylodiscitis\b/i,
  },
  {
    id: "fracture",
    label: "fracture",
    normal: /\bno (?:acute )?(?:compression )?fracture\b|\bno fracture\b|\bvertebral body heights (?:are )?(?:normal|maintained|preserved)\b/i,
    abnormal: /\bacute compression fracture\b|\bburst fracture\b|\bfracture of the [lt]\d\b|\bwedge (?:deformity|fracture)\b/i,
  },
  {
    id: "discs",
    label: "discs",
    normal: /\bno (?:significant |posterior )?disc (?:abnormality|bulge|herniation|protrusion|extrusion)\b|\bdisc heights? and signal intensities (?:are )?preserved\b|\bdisc spaces (?:are )?maintained\b/i,
    abnormal: /\bdisc (?:extrusion|sequestration|protrusion|herniation|osteophyte complex)\b|\bsequestered disc fragment\b/i,
  },
  {
    id: "canal",
    label: "central canal",
    normal: /\b(?:central )?canal is patent\b|\bno (?:gross |significant |spinal )?canal stenosis\b|\bno spinal canal stenosis\b/i,
    abnormal: /\b(?:severe|moderate) (?:central |spinal )?canal stenosis\b/i,
  },
  {
    id: "foramina",
    label: "neural foramina",
    normal: /\bneural foramina (?:are |remain )?(?:patent|normal|unremarkable)\b|\bno (?:significant )?foraminal stenosis\b/i,
    abnormal: /\b(?:severe|moderate) (?:left|right|bilateral)? ?neural foraminal stenosis\b|\bcomplete loss of perineural fat\b/i,
  },
  {
    id: "root",
    label: "nerve roots",
    normal: /\bno (?:nerve )?(?:root )?(?:compression|impingement)\b|\bnerve roots? (?:are )?(?:freely floating|unremarkable|normal)\b|\bno nerve root contact\b/i,
    // An affirmative compression statement — "No nerve root compression." must
    // not count as the abnormal side of its own contradiction.
    abnormal: /\b(?:compresses|compressing|impinges|impinging|impingement of|compression of)\b[^.]*\b(?:nerve root|root)\b|\bcrowding of the cauda\b/i,
  },
  {
    id: "conus",
    label: "conus medullaris",
    normal: /\bconus medullaris terminates normally\b|\bconus (?:is |appears )?(?:normal|unremarkable)\b|\bconus medullaris appears normal\b/i,
    abnormal: /\b(?:t2 hyperintense signal within the conus|conus (?:signal abnormality|low[- ]lying)|low[- ]lying conus)\b/i,
  },
  {
    id: "cauda",
    label: "cauda equina",
    normal: /\bcauda equina (?:nerve roots (?:are )?)?(?:normal|unremarkable|freely floating|normally distributed)\b/i,
    abnormal: /\bcauda equina (?:crowding|compression|clumping)\b|\bintradural clumping\b/i,
  },
  {
    id: "paraspinal",
    label: "paraspinal / psoas soft tissues",
    normal: /\b(?:visualized )?paraspinal (?:soft tissues|musculature)[^.]*\b(?:unremarkable|normal)\b|\bpsoas muscles? (?:are )?(?:unremarkable|normal)\b/i,
    abnormal: /\bpsoas (?:muscle )?abscess\b|\bparaspinal (?:collection|abscess)\b/i,
  },
  {
    id: "postop",
    label: "post-operative collections",
    normal: /\bwithout (?:evidence of )?(?:pathological )?epidural collections\b|\bno post[- ]?operative collection\b|\bexpected post[- ]?surgical changes\b/i,
    abnormal: /\bpseudomeningocele\b|\bpost-?operative (?:fluid )?collection\b|\bepidural abscess\b|\bepidural hematoma\b/i,
  },
  {
    id: "facets",
    label: "facet joints",
    normal: /\bfacet joints? (?:are |appear )?(?:normal|unremarkable)\b|\bfacets (?:are )?unremarkable\b/i,
    abnormal: /\bfacet (?:joint )?(?:arthropathy|hypertrophy|effusion)\b|\bsynovial cyst\b/i,
  },
  {
    id: "ligamentum-flavum",
    label: "ligamentum flavum",
    normal: /\bligamentum flavum (?:and posterior elements are )?unremarkable\b|\bno ligamentum flavum hypertrophy\b/i,
    abnormal: /\bligamentum flavum (?:hypertrophy|buckling|thickening)\b/i,
  },
  {
    id: "pars",
    label: "pars interarticularis",
    normal: /\bposterior elements (?:are |intact)\b|\bno pars defect\b|\bpars interarticularis(?:e)?s? (?:are )?intact\b/i,
    abnormal: /\bpars (?:interarticularis )?defect\b|\bspondylolysis\b|\bpars stress reaction\b/i,
  },
];

export type SpineTextContradictionInput = {
  findingsText: string;
  impressionText: string;
  sequences?: SpineSequencesAvailable | null;
  numbering?: LumbarNumberingState | null;
};

/**
 * Level keys the report may name. Only used to flag a mix of transitional and
 * conventional naming — never to reject a radiologist's wording.
 */
function strayLevelTokens(text: string, numbering: LumbarNumberingState): string[] {
  const allowed = new Set(lumbarLevelKeyStrings(numbering).map((k) => k.toUpperCase()));
  const found = text.toUpperCase().match(/\bL[1-6](?:-(?:L\d|S1|T))?\b/g) ?? [];
  const stray = new Set(found.filter((token) => !allowed.has(token)));
  return [...stray];
}

/**
 * Lumbar text contradictions: normal-vs-abnormal pairs, sequence gating and
 * level-naming consistency. Returns human-readable warnings, order-stable.
 */
export function lumbarTextContradictions(
  input: SpineTextContradictionInput,
): string[] {
  const blob = `${input.findingsText ?? ""}\n${input.impressionText ?? ""}`.trim();
  if (!blob) return [];
  const sentences = splitToSentences(blob);
  if (sentences.length === 0) return [];
  const warnings: string[] = [];

  for (const pair of LUMBAR_CONTRADICTION_PAIRS) {
    const normalHit = sentences.find((s) => pair.normal.test(s));
    const abnormalHit = sentences.find((s) => pair.abnormal.test(s));
    if (!normalHit || !abnormalHit) continue;
    warnings.push(
      `Contradiction in ${pair.label}: the report states both “${trim(normalHit)}” and “${trim(abnormalHit)}”. Confirm which is intended.`,
    );
  }

  // Sequence-dependent statements (§35). Same rule the brain module applies.
  if (input.sequences) {
    for (const rule of SPINE_STATEMENT_RULES) {
      const missing = rule.keys.filter((k) => !input.sequences![k]);
      if (missing.length === 0) continue;
      const hit = sentences.find((s) => rule.re.test(s));
      if (!hit) continue;
      warnings.push(
        `Sequence check: the report contains ${rule.label} — “${trim(hit)}” — but this study does not include ${missing.join(" + ")}.`,
      );
    }
  }

  // Level naming under transitional anatomy (§5).
  const numbering = input.numbering;
  if (numbering && isNonStandardNumbering(numbering)) {
    const stray = strayLevelTokens(blob, numbering);
    if (stray.length > 0) {
      warnings.push(
        `Level naming: numbering is set to ${numbering.mode}, which does not use ${stray.join(", ")}. Keep level names consistent across Findings, the level table, measurements and Impression.`,
      );
    }
    const caution = numberingCautionSentence(numbering);
    if (caution && !sentences.some((s) => blob.toLowerCase().includes("numbering"))) {
      warnings.push(
        "Numbering caution: transitional / non-standard numbering is set but the report does not state the numbering basis.",
      );
    }
  }

  return warnings;
}

function trim(sentence: string): string {
  const s = sentence.trim();
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
}

/**
 * Statements that need contrast: used by the post-operative palette, where
 * recurrent disc versus epidural fibrosis cannot be separated without it
 * (spec §18).
 */
export const CONTRAST_DEPENDENT_SPINE_RE = /enhanc\w+|non[- ]?enhancing|post-?contrast|perihardware|halo sign/i;

export function contrastDependencyWarning(
  text: string,
  sequences: SpineSequencesAvailable | null | undefined,
): string | null {
  if (!sequences || sequences.contrast) return null;
  if (!CONTRAST_DEPENDENT_SPINE_RE.test(text)) return null;
  return "Contrast check: enhancement-dependent wording is present but no contrast was administered.";
}
