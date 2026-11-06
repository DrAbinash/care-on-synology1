/**
 * Shared clinical fixtures for the Text-to-Report acceptance battery (owner's cases A–E).
 *
 * Lives in `testSupport` because two suites read it and they must not drift: the
 * deterministic validator battery (`reportComposer/textToReportClinicalCases.test.ts`,
 * no model, CI-safe) and the live job battery
 * (`reportComposer/textToReportClinicalJobs.request.test.ts`, which enqueues through the
 * real route and runs the real worker against the clinic's own Ollama).
 *
 * The corpora are built the way the reporting workspace builds them: the live normal
 * template's own sentences (verbatim, `role: "baseline"`, `source: "normal-template"`)
 * followed by the radiologist's dictation as committed ledger rows. The sentences are
 * copied from `diagnostic-erp/src/lib/zai-workspace/baselines/mriBrainStandardNormal.ts`
 * and the LS spine block in `fullReportBaseline.ts`; the packages cannot import each
 * other under Vitest, so `textToReportTemplateMirror.test.ts` in the ERP package pins
 * every string here against the live template.
 *
 * All clinical content is synthetic — the owner's brief cases, no real patient, no real
 * name, and nothing from the approved 16-day-old MRI study.
 */
import type { ComposerDraftOutput, ComposeObservation } from "../lib/reportComposer/types";

export const MRI_BRAIN_NORMALS: ReadonlyArray<readonly [string, string]> = [
  ["brain_parenchyma", "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation."],
  ["infarct", "No acute infarct is seen."],
  ["hemorrhage", "No intracranial hemorrhage is seen."],
  ["diffusion", "No restricted diffusion is seen on DWI/ADC."],
  ["ventricles", "Ventricular system and cisternal spaces are normal in size and configuration."],
  ["extra_axial", "No extra-axial collection is identified."],
  ["midline", "No midline shift is seen."],
  ["basal_ganglia", "Basal ganglia and thalami are normal in signal intensity."],
  ["vascular_flow_voids", "Flow voids in major intracranial vessels are preserved."],
  ["brainstem", "Brainstem shows normal morphology and signal intensity."],
  ["cerebellum", "Cerebellar hemispheres show normal morphology and signal intensity."],
  ["posterior_fossa", "Posterior fossa structures are unremarkable."],
  ["sellar", "The sellar and parasellar region is grossly unremarkable."],
  ["sinus", "The visualised paranasal sinuses are unremarkable."],
  ["mastoid", "The visualised mastoid air cells are unremarkable."],
  ["orbital", "The orbits are unremarkable."],
];

export const MRI_BRAIN_NORMAL_IMPRESSION =
  "Normal MRI of the brain. No acute intracranial abnormality.";

export const LS_LEVELS = ["L1-L2", "L2-L3", "L3-L4", "L4-L5", "L5-S1"] as const;

export const LS_GENERAL_NORMALS: ReadonlyArray<readonly [string, string]> = [
  ["alignment", "Normal lumbar lordosis is maintained."],
  ["compression_fracture", "Lumbar vertebral bodies demonstrate normal height and marrow signal."],
  ["spondylolisthesis", "No spondylolisthesis is seen."],
  ["conus", "Conus medullaris terminates at L1 and appears normal."],
  ["cauda_equina", "Cauda equina nerve roots are normally distributed."],
  ["facet_joint", "Lumbar facet joints are unremarkable."],
  ["ligamentum_flavum", "Ligamentum flavum is not hypertrophied."],
  ["paraspinal", "Paraspinal soft tissues are unremarkable."],
  ["sacroiliac_joint", "Visualized sacroiliac joints are unremarkable."],
];

export function lsLevelNormals(level: string): Array<readonly [string, string]> {
  return [
    ["disc_signal", `${level}: Intervertebral disc signal is preserved.`],
    ["disc_height", `${level}: Intervertebral disc height is maintained.`],
    ["disc_contour", `${level}: No significant disc bulge or protrusion is seen.`],
    ["canal_stenosis", `${level}: No spinal canal or thecal sac compression is seen.`],
    ["foraminal_stenosis", `${level}: Neural foramina are patent bilaterally.`],
    ["root_contact", `${level}: No exiting or traversing nerve root compression is seen.`],
  ];
}

export const LS_NORMAL_IMPRESSION =
  "Normal MRI of the lumbosacral spine. No significant disc, canal, foraminal or neural compressive abnormality.";

export function draft(d: Partial<ComposerDraftOutput>): ComposerDraftOutput {
  return {
    findings: d.findings ?? "",
    impression: d.impression ?? "",
    recommendation: d.recommendation ?? "",
    unresolvedQuestions: [],
    warnings: [],
  };
}

/** A dictated abnormality as a committed ledger row: authored by the radiologist. */
function dictated(ordinal: number, concept: string, text: string): ComposeObservation {
  return {
    id: `voice-${ordinal}`,
    concept,
    source: "voice",
    role: "finding",
    findingsText: text,
  };
}

function scaffold(
  rows: ReadonlyArray<readonly [string, string]>,
  revision: string,
): ComposeObservation[] {
  return rows.map(([concept, findingsText]) => ({
    id: `baseline:${revision}:${concept}`,
    concept,
    source: "normal-template" as const,
    role: "baseline" as const,
    findingsText,
  }));
}

export type TextToReportStudy = {
  modality: string;
  region: string;
  bodyPart: string;
  family: string;
  spineSegment?: string;
  studyType: string;
  reportTitle: string;
  protocol: string;
  clinicalHistory: string;
  technique: string;
  findings: string;
  impression: string;
  recommendation: string;
  observations: ComposeObservation[];
  aiMode: "TEXT_ONLY";
  jobKindHint: "FULL_REPORT";
};

export function brainStudy(
  dictation: Array<[string, string]>,
  opts?: { withScaffold?: boolean },
): TextToReportStudy {
  const rows = dictation.map(([concept, text], i) => dictated(i, concept, text));
  const scaffoldRows = opts?.withScaffold === false ? [] : scaffold(MRI_BRAIN_NORMALS, "mri-brain-standard-normal-r1");
  return {
    modality: "MRI",
    region: "Brain",
    bodyPart: "BRAIN",
    family: "brain",
    studyType: "MRI BRAIN",
    reportTitle: "MRI BRAIN",
    protocol: "MRI brain, non-contrast",
    clinicalHistory: "82-year-old male. Acute onset left-sided weakness.",
    technique:
      "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences were obtained.",
    findings: [...scaffoldRows.map((o) => o.findingsText), ...rows.map((o) => o.findingsText)].join("\n"),
    impression: MRI_BRAIN_NORMAL_IMPRESSION,
    recommendation: "",
    observations: [...scaffoldRows, ...rows],
    aiMode: "TEXT_ONLY",
    jobKindHint: "FULL_REPORT",
  };
}

export function lsStudy(dictation: Array<[string, string]>): TextToReportStudy {
  const rows = dictation.map(([concept, text], i) => dictated(i, concept, text));
  const scaffoldRows = [
    ...scaffold(LS_GENERAL_NORMALS, "mri-ls-standard-normal-r1"),
    ...scaffold(LS_LEVELS.flatMap((l) => lsLevelNormals(l)), "mri-ls-standard-normal-r1"),
  ];
  return {
    modality: "MRI",
    region: "Lumbosacral Spine",
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    studyType: "MRI LUMBOSACRAL SPINE",
    reportTitle: "MRI LUMBOSACRAL SPINE",
    protocol: "MRI lumbar spine, non-contrast",
    clinicalHistory: "Low back pain with right S1 radiculopathy.",
    technique: "Multiplanar multisequence non-contrast MRI of the lumbosacral spine.",
    findings: [...scaffoldRows.map((o) => o.findingsText), ...rows.map((o) => o.findingsText)].join("\n"),
    impression: LS_NORMAL_IMPRESSION,
    recommendation: "",
    observations: [...scaffoldRows, ...rows],
    aiMode: "TEXT_ONLY",
    jobKindHint: "FULL_REPORT",
  };
}

/**
 * What the brief asks the finished report to look like: the dictation integrated, the
 * conflicting scaffold gone, the remaining anatomy covered, the diagnosis stated where
 * the supplied evidence supports it. Written from the brief, not from the validator.
 */
export const CASE_A_IDEAL = draft({
  findings: [
    "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC, consistent with an acute infarct.",
    "Scattered T2 and FLAIR hyperintense foci are seen in the bilateral periventricular and subcortical white matter, more confluent in the parietal regions.",
    "The ventricles, sulci and basal cisterns are prominent, consistent with generalized cerebral volume loss.",
    "No intracranial hemorrhage is seen.",
    "No midline shift is seen.",
    "The thalami are normal in signal intensity.",
    "Flow voids in major intracranial vessels are preserved.",
    "No extra-axial collection is identified.",
    "Brainstem shows normal morphology and signal intensity.",
    "Cerebellar hemispheres show normal morphology and signal intensity.",
    "Posterior fossa structures are unremarkable.",
    "The sellar and parasellar region is grossly unremarkable.",
    "The orbits are unremarkable.",
    "The visualised paranasal sinuses are unremarkable.",
    "The visualised mastoid air cells are unremarkable.",
  ].join("\n"),
  impression: [
    "1. Acute infarct in the right basal ganglia.",
    "2. Bilateral periventricular and subcortical white matter hyperintensities — chronic small vessel ischemic white matter change.",
    "3. Generalized cerebral volume loss.",
  ].join("\n"),
  recommendation: "Vascular risk factor evaluation and clinical correlation.",
});

export const CASE_B_IDEAL = draft({
  findings: [
    "Restricted diffusion in the left thalamus, hyperintense on DWI with corresponding low signal on ADC, consistent with an acute infarct.",
    "The right thalamus is normal in signal intensity.",
    "Basal ganglia are normal in signal intensity bilaterally.",
    "No intracranial hemorrhage is seen.",
    "No midline shift is seen.",
    "Ventricular system and cisternal spaces are normal in size and configuration.",
    "No extra-axial collection is identified.",
    "Flow voids in major intracranial vessels are preserved.",
    "Brainstem shows normal morphology and signal intensity.",
    "Cerebellar hemispheres show normal morphology and signal intensity.",
    "Posterior fossa structures are unremarkable.",
    "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
  ].join("\n"),
  impression: "Acute infarct in the left thalamus.",
});

export const CASE_C_IDEAL = draft({
  findings: MRI_BRAIN_NORMALS.map(([, s]) => s).join("\n"),
  impression: "No acute intracranial abnormality. No diffusion restriction to suggest acute infarct.",
});

export const CASE_D_IDEAL = draft({
  findings: [
    "A small T2 hyperintense focus is seen in the right frontal subcortical white matter.",
    "Rest of the brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
    "No intracranial hemorrhage is seen.",
    "Ventricular system and cisternal spaces are normal in size and configuration.",
    "No midline shift is seen.",
    "Basal ganglia and thalami are normal in signal intensity.",
    "Brainstem shows normal morphology and signal intensity.",
    "Cerebellar hemispheres show normal morphology and signal intensity.",
  ].join("\n"),
  impression:
    "Small right frontal subcortical T2 hyperintensity, likely nonspecific. Clinical correlation suggested.",
});

export const CASE_E_IDEAL = draft({
  findings: [
    "Loss of lumbar lordosis is seen.",
    "L5-S1: Intervertebral disc shows desiccation with diffuse posterior disc bulge. Disc height is maintained.",
    "L1-L2: Intervertebral disc signal is preserved. Intervertebral disc height is maintained. No significant disc bulge or protrusion is seen. No spinal canal or thecal sac compression is seen. Neural foramina are patent bilaterally. No exiting or traversing nerve root compression is seen.",
    "L2-L3: Intervertebral disc signal is preserved. Intervertebral disc height is maintained. No significant disc bulge or protrusion is seen. No spinal canal or thecal sac compression is seen. Neural foramina are patent bilaterally. No exiting or traversing nerve root compression is seen.",
    "L3-L4: Intervertebral disc signal is preserved. Intervertebral disc height is maintained. No significant disc bulge or protrusion is seen. No spinal canal or thecal sac compression is seen. Neural foramina are patent bilaterally. No exiting or traversing nerve root compression is seen.",
    "L4-L5: Intervertebral disc signal is preserved. Intervertebral disc height is maintained. No significant disc bulge or protrusion is seen. No spinal canal or thecal sac compression is seen. Neural foramina are patent bilaterally. No exiting or traversing nerve root compression is seen.",
    "Lumbar vertebral bodies demonstrate normal height and marrow signal. No spondylolisthesis is seen.",
    "Conus medullaris terminates at L1 and appears normal.",
    "Cauda equina nerve roots are normally distributed.",
    "Lumbar facet joints are unremarkable. Ligamentum flavum is not hypertrophied.",
    "Paraspinal soft tissues are unremarkable. Visualized sacroiliac joints are unremarkable.",
  ].join("\n"),
  impression:
    "Loss of lumbar lordosis. Disc desiccation with diffuse posterior disc bulge at L5-S1. No canal or neural compression documented at other levels.",
});

/**
 * Clinical outcomes the finished report must show, from the brief.
 *
 * The three lists are read by the LIVE half only, and every entry is written so a
 * correct model answer cannot fail on spelling:
 *  - `contains` accepts `|` between clinically equivalent spellings ("volume loss|atrophy"
 *    — qwen3:14b answered case A's "generalized cerebral volume loss" as "global cerebral
 *    atrophy", which is the same statement).
 *  - `anatomy` entries are STEMS, because the adnominal form is what a report actually
 *    prints: "Ventricular system …" is coverage of the ventricles and contains no
 *    substring "ventricles"; "Cerebellar hemispheres" likewise. Both were measured on
 *    2026-11-03 against the clinic's own model, where the naive stems failed and the
 *    report they were read from was clinically right.
 *  - `absent` is evaluated sentence by sentence and a denial exempts the sentence it is
 *    in — the correct answer to case C is "No restricted diffusion is seen.", and to
 *    case E "No spondylolisthesis is seen."; what must never appear is the same words
 *    ASSERTED. See `assertedSomewhere` in the live test.
 */
export type ClinicalCase = {
  id: "A" | "B" | "C" | "D" | "E";
  name: string;
  study: TextToReportStudy;
  ideal: ComposerDraftOutput;
  expect: {
    /** Lower-cased substrings that must appear; `|` separates accepted synonyms. */
    contains: string[];
    /** Patterns that must not be ASSERTED anywhere (a denial of one is allowed). */
    absent: RegExp[];
    /** Anatomy stems the report must cover — the completeness requirement. */
    anatomy: string[];
  };
};

export const CLINICAL_CASES: ClinicalCase[] = [
  {
    id: "A",
    name: "MRI brain, acute right basal ganglia infarct with chronic small-vessel change",
    study: brainStudy([
      ["diffusion", "Restricted diffusion in the right basal ganglia, hyperintense on DWI with corresponding low signal on ADC."],
      ["white_matter", "Scattered T2 and FLAIR hyperintense foci in the bilateral periventricular and subcortical white matter, more confluent in the parietal regions."],
      ["ventricles", "The ventricles, sulci and basal cisterns are prominent."],
    ]),
    ideal: CASE_A_IDEAL,
    expect: {
      contains: ["right basal ganglia", "infarct", "white matter", "volume loss|atrophy"],
      absent: [/left basal ganglia/, /hemorrhage is present/, /\d+(?:\.\d+)?\s*mm/],
      anatomy: [
        "parenchyma", "white matter", "basal ganglia", "thalam", "brainstem", "cerebell",
        "ventricul", "sulc", "cistern", "hemorrhage", "midline", "sellar", "flow void",
        "orbit", "sinus", "mastoid",
      ],
    },
  },
  {
    id: "B",
    name: "MRI brain, left thalamic infarct — laterality",
    study: brainStudy([
      ["diffusion", "Restricted diffusion in the left thalamus, hyperintense on DWI with corresponding low signal on ADC."],
    ]),
    ideal: CASE_B_IDEAL,
    expect: {
      contains: ["left thalamus", "infarct|infarction"],
      absent: [/right thalamus.*(infarct|restriction)/i, /\d+(?:\.\d+)?\s*mm/],
      anatomy: ["parenchyma", "basal ganglia", "brainstem", "cerebell", "ventricul", "midline"],
    },
  },
  {
    id: "C",
    name: "MRI brain, no diffusion restriction — nothing invented",
    study: brainStudy([["diffusion", "No diffusion restriction."]]),
    ideal: CASE_C_IDEAL,
    expect: {
      contains: ["no"],
      absent: [/acute infarct(?! is seen)/i, /infarction/i, /enhancement/i, /\d+(?:\.\d+)?\s*mm/],
      anatomy: ["parenchyma", "ventricul", "midline"],
    },
  },
  {
    id: "D",
    name: "MRI brain, incomplete observations — no invented sequences or measurements",
    study: brainStudy([
      ["white_matter", "A small T2 hyperintense focus in the right frontal subcortical white matter."],
    ]),
    ideal: CASE_D_IDEAL,
    expect: {
      contains: ["right frontal", "t2"],
      absent: [/adc hypointens/i, /enhancement/i, /restricted diffusion/i, /\d+(?:\.\d+)?\s*mm/],
      anatomy: ["parenchyma", "ventricul", "midline"],
    },
  },
  {
    id: "E",
    name: "MRI LS spine, L5-S1 disc desiccation with diffuse bulge",
    study: lsStudy([
      ["alignment", "Loss of lumbar lordosis."],
      ["disc_signal", "L5-S1: Intervertebral disc shows desiccation."],
      ["disc_contour", "L5-S1: Diffuse posterior disc bulge."],
    ]),
    ideal: CASE_E_IDEAL,
    expect: {
      contains: ["l5-s1", "lordosis", "bulge"],
      absent: [/\d+(?:\.\d+)?\s*mm/, /spondylolisthesis is seen/, /cord compression/i],
      anatomy: ["conus", "cauda", "foram", "canal", "facet"],
    },
  },
];
