import type { FormatOption } from "./types";

export type OptionBundle = {
  id: string;
  label: string;
  description: string;
  mutexGroup?: string;
  options: FormatOption[];
};

function opt(
  id: string,
  label: string,
  rest: Partial<FormatOption> = {},
): FormatOption {
  return { id, label, value: id, ...rest };
}

/** Reusable option sets for the format builder — not Quick Findings chips. */
export const OPTION_BUNDLES: OptionBundle[] = [
  {
    id: "disc-morphology",
    label: "Disc morphology",
    description: "Normal / desiccation / bulge / protrusion / extrusion / herniation",
    mutexGroup: "disc-morphology",
    options: [
      opt("normal", "Normal", {
        severity: "normal",
        canonicalKey: "disc.normal",
        outputSentence: "",
        impressionWeight: 0,
        mutexGroup: "disc-morphology",
      }),
      opt("desiccation", "Disc desiccation", {
        severity: "mild",
        canonicalKey: "disc.desiccation",
        outputSentence: "Disc desiccation is seen at {level}.",
        impressionSentence: "{level} disc desiccation.",
        impressionWeight: 0.25,
        mutexGroup: "disc-morphology",
      }),
      opt("bulge", "Diffuse disc bulge", {
        severity: "mild",
        canonicalKey: "disc.bulge",
        outputSentence: "{severity} diffuse disc bulge is seen at {level}[ causing {effect}].",
        impressionSentence: "{level} degenerative disc disease with diffuse disc bulge.",
        impressionWeight: 0.7,
        mutexGroup: "disc-morphology",
      }),
      opt("protrusion", "Focal protrusion", {
        severity: "moderate",
        canonicalKey: "disc.protrusion",
        outputSentence: "{severity} focal disc protrusion is seen at {level}[ causing {effect}].",
        impressionSentence: "{level} disc protrusion.",
        impressionWeight: 0.8,
        mutexGroup: "disc-morphology",
      }),
      opt("extrusion", "Extrusion", {
        severity: "severe",
        canonicalKey: "disc.extrusion",
        outputSentence: "{severity} disc extrusion is seen at {level}[ causing {effect}].",
        impressionSentence: "{level} disc extrusion.",
        impressionWeight: 0.9,
        mutexGroup: "disc-morphology",
      }),
      opt("herniation", "Herniation", {
        severity: "severe",
        canonicalKey: "disc.herniation",
        outputSentence: "{severity} disc herniation is seen at {level}[ causing {effect}].",
        impressionSentence: "{level} disc herniation.",
        impressionWeight: 0.9,
        mutexGroup: "disc-morphology",
      }),
    ],
  },
  {
    id: "laterality",
    label: "Laterality",
    description: "Right / Left / Bilateral",
    mutexGroup: "laterality",
    options: [
      opt("right", "Right", { canonicalKey: "laterality.right", mutexGroup: "laterality" }),
      opt("left", "Left", { canonicalKey: "laterality.left", mutexGroup: "laterality" }),
      opt("bilateral", "Bilateral", { canonicalKey: "laterality.bilateral", mutexGroup: "laterality" }),
    ],
  },
  {
    id: "severity",
    label: "Severity",
    description: "Mild / moderate / severe",
    mutexGroup: "severity",
    options: [
      opt("mild", "Mild", { severity: "mild", canonicalKey: "severity.mild", mutexGroup: "severity" }),
      opt("moderate", "Moderate", { severity: "moderate", canonicalKey: "severity.moderate", mutexGroup: "severity" }),
      opt("severe", "Severe", { severity: "severe", canonicalKey: "severity.severe", mutexGroup: "severity" }),
    ],
  },
  {
    id: "normal-abnormal",
    label: "Normal / Abnormal",
    description: "Mutually exclusive normal vs pathology",
    mutexGroup: "normal-abnormal",
    options: [
      opt("normal", "Normal", { severity: "normal", canonicalKey: "status.normal", mutexGroup: "normal-abnormal", impressionWeight: 0 }),
      opt("abnormal", "Abnormal", { severity: "mild", canonicalKey: "status.abnormal", mutexGroup: "normal-abnormal", impressionWeight: 0.4 }),
    ],
  },
  {
    id: "grade-i-iv",
    label: "Grade I–IV",
    description: "Pfirrmann / listhesis style grades",
    mutexGroup: "grade",
    options: [
      opt("i", "Grade I", { severity: "mild", canonicalKey: "grade.i", mutexGroup: "grade" }),
      opt("ii", "Grade II", { severity: "moderate", canonicalKey: "grade.ii", mutexGroup: "grade" }),
      opt("iii", "Grade III", { severity: "severe", canonicalKey: "grade.iii", mutexGroup: "grade" }),
      opt("iv", "Grade IV", { severity: "critical", canonicalKey: "grade.iv", mutexGroup: "grade" }),
    ],
  },
  {
    id: "canal-stenosis",
    label: "Canal stenosis",
    description: "None / mild / moderate / severe stenosis",
    mutexGroup: "canal-stenosis",
    options: [
      opt("none", "No significant stenosis", { severity: "normal", canonicalKey: "canal.normal", impressionWeight: 0, mutexGroup: "canal-stenosis" }),
      opt("mild", "Mild canal stenosis", {
        severity: "mild",
        canonicalKey: "canal.stenosis.mild",
        outputSentence: "Mild spinal canal stenosis is seen at {level}.",
        impressionSentence: "Mild canal stenosis at {level}.",
        impressionWeight: 0.55,
        mutexGroup: "canal-stenosis",
      }),
      opt("moderate", "Moderate canal stenosis", {
        severity: "moderate",
        canonicalKey: "canal.stenosis.moderate",
        outputSentence: "Moderate spinal canal stenosis is seen at {level}.",
        impressionSentence: "Moderate canal stenosis at {level}.",
        impressionWeight: 0.75,
        mutexGroup: "canal-stenosis",
      }),
      opt("severe", "Severe canal stenosis", {
        severity: "severe",
        canonicalKey: "canal.stenosis.severe",
        outputSentence: "Severe spinal canal stenosis is seen at {level}.",
        impressionSentence: "Severe canal stenosis at {level}.",
        impressionWeight: 0.95,
        mutexGroup: "canal-stenosis",
      }),
    ],
  },
];

export function optionBundleById(id: string): OptionBundle | undefined {
  return OPTION_BUNDLES.find((b) => b.id === id);
}
