/**
 * mriSpineContradictions.ts — MRI spine contradiction validation (spec §39).
 *
 * Extends the EXISTING validator rather than replacing it: the structured
 * ledger checks (`structuredCanalApContradiction`, `ledgerSeverityContradiction`)
 * stay where they are, and this module adds the rules the V3 sub-masters make
 * reachable — normal-vs-abnormal pairs, sequence-dependent statements, and
 * level-naming consistency under transitional anatomy. `dorsalTextContradictions`
 * adds the thoracic list (dorsal spec §33): cord / canal / marrow / epidural /
 * conus pairs, axial-dependent wording, and conus claims outside acquired
 * coverage.
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
import {
  conusCovered,
  dorsalLevelKeyStrings,
  dorsalNumberingNeedsConsistencyCheck,
  type DorsalNumberingState,
} from "./mriDorsalNumbering";

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
    // The listhesis family. Deliberately WITHOUT the lordosis word: a lost
    // lordotic curve is a different finding that does not contradict "no
    // spondylolisthesis", and bundling the two made the lint name a false
    // clash on every normal report that carried both sentences (measured on
    // the shipped MRI LS standard normal, 2026-10-19). The lordosis claim has
    // its own pair below.
    id: "alignment",
    label: "alignment",
    normal: /\b(?:lumbar )?alignment (?:is |remains )?(?:normal|preserved|maintained|within normal limits)\b|\bno (?:spondyl|anto|reto)listhesis\b/i,
    abnormal: /\b(?:anterolisthesis|retrolisthesis|spondylolisthesis|degenerative scoliotic curvature)\b/i,
  },
  {
    // The lordotic-curve family: a preserved-curve claim beside a stated loss,
    // straightening or reversal of the curve. "straighten\w*" is on the
    // ABNORMAL side for the same measured reason it is a cue in
    // generateLocalImpression: the owner's neutral wording
    // "Straightening/loss of normal lumbar lordosis." contains the phrase
    // "normal lumbar lordosis", and without an abnormal-side match the
    // sentence would read as the pair's NORMAL claim and flag itself.
    id: "lordosis",
    label: "lumbar lordosis",
    normal: /\bnormal lumbar lordosis\b|\bpreserved lumbar lordosis\b|\blumbar lordosis is well preserved\b/i,
    abnormal: /\bstraighten\w*\b|\breversal of lumbar lordosis\b|\bloss of (?:normal )?lumbar lordosis\b/i,
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
 * Denial wording within one clause before a match — the same idea the
 * impression classifier's negation window implements. Without it the
 * abnormal side of a pair matched its own denial: "No spondylolisthesis is
 * seen." read as a listhesis and "No significant disc bulge or protrusion is
 * seen." as a protrusion, so the lint flagged a contradiction on the complete
 * normal report (measured, 2026-10-19).
 */
const DENIAL_BEFORE_RE = /\b(?:no|without|absent|absence|negative|free|nor)\b[^.;]{0,60}$/i;

/** The first sentence that matches `re` as a POSITIVE claim — a match whose own
 * clause denies it is not an abnormality statement. */
function firstPositiveHit(sentences: readonly string[], re: RegExp): string | undefined {
  for (const s of sentences) {
    const m = re.exec(s);
    if (!m) continue;
    if (DENIAL_BEFORE_RE.test(s.slice(0, m.index))) continue;
    return s;
  }
  return undefined;
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
    // A sentence that matches the pair's own abnormal side is not the pair's
    // normal claim — "Straightening/loss of normal lumbar lordosis." carries
    // the phrase "normal lumbar lordosis" and must not sit as the normal side
    // of its own contradiction (the same per-sentence principle the overlay
    // engine's classifier uses).
    const normalHit = sentences.find((s) => pair.normal.test(s) && !pair.abnormal.test(s));
    const abnormalHit = firstPositiveHit(sentences, pair.abnormal);
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

// ─── Dorsal / thoracic (dorsal spec §33) ─────────────────────────────────

/**
 * Thoracic rules. The cord replaces the cauda equina as the structure at risk,
 * and acquired coverage replaces LSTV as the level-safety question, so these
 * pairs are not the lumbar list with different letters.
 */
export const DORSAL_CONTRADICTION_PAIRS: Pair[] = [
  {
    id: "cord",
    label: "spinal cord",
    normal: /\b(?:thoracic )?(?:spinal )?cord (?:is |appears |shows )?(?:normal|unremarkable|of normal caliber)\b|\bcord (?:caliber and )?(?:signal )?within normal limits\b|\bnormal caliber and uniform intrinsic signal\b/i,
    abnormal: /\bcord (?:compression|compressed|flattening|flattened|displacement|displaced|swelling|atrophy)\b|\bintrinsic (?:t2|stir|t2\/stir) (?:hyper|intense)\b|\bcord signal (?:abnormality|hyperintensity)\b|\bmyelomalacia\b|\bcompressive myelopathy\b/i,
  },
  {
    id: "canal",
    label: "central canal",
    normal: /\bcanal is patent\b|\bno (?:significant )?(?:central )?canal stenosis\b|\bcentral canal (?:is |appears )?(?:normal|patent) without\b/i,
    abnormal: /\bsevere (?:central )?canal stenosis\b|\bsevere (?:local )?canal narrowing\b|\bcomplete (?:local )?(?:csf|effacement)\b/i,
  },
  {
    id: "vertebrae",
    label: "vertebral bodies",
    normal: /\bvertebral body heights (?:and marrow signal intensities )?(?:are|remain) (?:maintained|normal|preserved)\b|\bno acute compression fracture\b|\bvertebral heights are preserved\b/i,
    abnormal: /\b(?:acute|wedge|burst|pathological|compression) (?:fracture)\b|\bvertebral (?:body )?collapse\b|\bendplate (?:erosion|destruction)\b/i,
  },
  {
    id: "marrow",
    label: "marrow",
    normal: /\bno (?:focal (?:osseous|marrow) lesion|marrow infiltrative process)\b|\bmarrow signal (?:intensities )?(?:are )?(?:normal|maintained|preserved)\b/i,
    abnormal: /\b(?:focal|multifocal|diffuse) (?:marrow|osseous) (?:lesion|replacement|involvement)\b|\bmarrow[- ]replacing\b|\breplacement of the normal fatty marrow\b/i,
  },
  {
    id: "discs",
    label: "discs",
    normal: /\bno (?:central or focal )?disc herniation\b|\bdisc heights (?:and (?:t2 )?signal intensities )?(?:are )?(?:preserved|maintained|normal)\b|\bwithout large disc herniation\b/i,
    abnormal: /\bdisc (?:extrusion|sequestration|migration)\b|\bcalcified (?:thoracic )?disc herniation\b|\bdisc destruction\b/i,
  },
  {
    id: "epidural",
    label: "epidural space",
    normal: /\bepidural space (?:is |appears )?(?:normal|unremarkable)\b|\bno epidural (?:mass|collection|lesion)\b/i,
    abnormal: /\bepidural (?:mass|collection|hematoma|haematoma|abscess|lipomatosis|tumour|tumor|soft tissue)\b/i,
  },
  {
    id: "cord-compression",
    label: "cord compression",
    normal: /\bno (?:thoracic )?(?:spinal )?cord compression\b|\bwithout cord compression\b|\bcord (?:is )?not compressed\b/i,
    abnormal: /\b(?:severe|marked|significant|continuous|ventral|dorsal) (?:thoracic )?(?:spinal )?cord compression\b|\bcord compression\b/i,
  },
  {
    id: "conus",
    label: "conus medullaris",
    normal: /\bconus (?:medullaris )?(?:is )?(?:normal|unremarkable|terminates normally|of normal signal)\b/i,
    abnormal: /\bconus (?:medullaris )?(?:compression|compressed|displacement|displaced|edema|oedema|signal (?:abnormality|change)|lesion)\b|\blow[- ]?lying conus\b/i,
  },
  {
    id: "foramina",
    label: "neural foramina",
    normal: /\bneural foramina (?:and costovertebral joint spaces )?are patent\b|\bno (?:significant )?(?:neural )?foraminal (?:narrowing|stenosis)\b/i,
    abnormal: /\b(?:severe|moderate|significant) (?:neural )?foraminal (?:narrowing|stenosis)\b|\bforaminal (?:narrowing|stenosis)\b/i,
  },
  {
    id: "posterior",
    label: "posterior elements",
    normal: /\bposterior elements (?:\(pedicles[^)]*\) )?(?:are |appear )?(?:intact|normal|unremarkable)\b/i,
    abnormal: /\bposterior element (?:fracture|lesion|involvement)\b|\bpedicle (?:destruction|fracture)\b|\bfacet (?:injury|fracture)\b/i,
  },
];

/** Thoracic level tokens the report may name, given the recorded coverage. */
function strayDorsalLevelTokens(text: string, numbering: DorsalNumberingState): string[] {
  const allowed = new Set(dorsalLevelKeyStrings(numbering).map((k) => k.toUpperCase()));
  const found: string[] = text.toUpperCase().match(/\bT(?:1[0-2]|[1-9])(?:-(?:T\d{1,2}|L1))?\b/g) ?? [];
  const stray = new Set(found.filter((token) => !allowed.has(token) && token.includes("-")));
  return [...stray];
}

export type DorsalTextContradictionInput = {
  findingsText: string;
  impressionText: string;
  sequences?: SpineSequencesAvailable | null;
  numbering?: DorsalNumberingState | null;
};

/**
 * Dorsal text contradictions: normal-vs-abnormal pairs, sequence gating,
 * conus statements outside acquired coverage and level naming. Warnings only —
 * the radiologist's interpretation is never rewritten.
 */
export function dorsalTextContradictions(
  input: DorsalTextContradictionInput,
): string[] {
  const blob = `${input.findingsText ?? ""}\n${input.impressionText ?? ""}`.trim();
  if (!blob) return [];
  const sentences = splitToSentences(blob);
  if (sentences.length === 0) return [];
  const warnings: string[] = [];

  for (const pair of DORSAL_CONTRADICTION_PAIRS) {
    // The same two guards as the lumbar loop: a sentence matching the pair's
    // own abnormal side is not its normal claim, and a match its clause denies
    // is not an abnormality statement.
    const normalHit = sentences.find((s) => pair.normal.test(s) && !pair.abnormal.test(s));
    const abnormalHit = firstPositiveHit(sentences, pair.abnormal);
    if (!normalHit || !abnormalHit) continue;
    warnings.push(
      `Contradiction in ${pair.label}: the report states both “${trim(normalHit)}” and “${trim(abnormalHit)}”. Confirm which is intended.`,
    );
  }

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
    if (!input.sequences.axial) {
      const axialHit = sentences.find((s) => /\bforaminal (?:narrowing|stenosis)\b|\bextraforaminal\b|\bcostovertebral (?:joint )?(?:arthropathy|osteophytes)\b/i.test(s));
      if (axialHit) {
        warnings.push(
          `Axial check: the report contains an axial-dependent foraminal / costovertebral statement — “${trim(axialHit)}” — but this study does not include axial sequences.`,
        );
      }
    }
  }

  // A conus statement when the acquired coverage never reached it (§12).
  const numbering = input.numbering;
  if (numbering && !conusCovered(numbering)) {
    const conusHit = sentences.find((s) => /\bconus (?:medullaris )?\b/i.test(s) && !/not (?:assessed|evaluated|included)|cannot be assessed|was not acquired/i.test(s));
    if (conusHit) {
      warnings.push(
        `Coverage check: the report describes the conus medullaris — “${trim(conusHit)}” — but recorded coverage does not reach the thoracolumbar junction.`,
      );
    }
  }

  if (numbering) {
    const stray = strayDorsalLevelTokens(blob, numbering);
    if (stray.length > 0) {
      warnings.push(
        `Level naming: recorded coverage does not include ${stray.join(", ")}. Keep level names consistent across Findings, the level table, measurements and Impression.`,
      );
    }
    if (dorsalNumberingNeedsConsistencyCheck(numbering) && !/numbering|level assignment/i.test(blob)) {
      warnings.push(
        "Numbering caution: dorsal numbering is not localizer-confirmed but the report does not state the numbering / coverage basis.",
      );
    }
  }

  return warnings;
}
