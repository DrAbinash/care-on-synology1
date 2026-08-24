/**
 * Validate composer output: no invented pathology; recommendation optional.
 */
import type { ComposerDraftOutput, ComposerInputSnapshot, ComposeObservation } from "./types";

export type ComposeValidationResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
  unsupportedMentions: string[];
};

const ABNORMALITY_HINTS = [
  "hemorrhage",
  "haemorrhage",
  "infarct",
  "infarction",
  "fracture",
  "malignancy",
  "metastasis",
  "abscess",
  "dissection",
  "embolism",
  "thrombosis",
  "stenosis",
  "herniation",
  "cord compression",
  "disc bulge",
  "disc herniation",
  "protrusion",
  "extrusion",
  "desiccation",
  "facet hypertrophy",
  "ligamentum flavum",
  "fazekas",
  "gliosis",
  "ventriculomegaly",
  "modic",
];

function groundedCorpus(snapshot: ComposerInputSnapshot): string {
  const parts = [
    snapshot.findings,
    snapshot.impression,
    snapshot.recommendation,
    snapshot.clinicalHistory,
    ...(snapshot.observations ?? []).map((o: ComposeObservation) =>
      [o.concept, o.findingsText, o.impressionText ?? ""].join(" "),
    ),
  ];
  return parts.join("\n").toLowerCase();
}

/**
 * Flag abnormality terms that appear in AI output but nowhere in radiologist-supplied input.
 */
export function validateComposerOutput(
  snapshot: ComposerInputSnapshot,
  draft: ComposerDraftOutput,
): ComposeValidationResult {
  const warnings: string[] = [...(draft.warnings ?? [])];
  const errors: string[] = [];
  const unsupportedMentions: string[] = [];
  const corpus = groundedCorpus(snapshot);
  const output = [draft.findings, draft.impression, draft.recommendation].join("\n").toLowerCase();

  if (!draft.findings.trim() && !draft.impression.trim()) {
    errors.push("empty_output");
  }

  for (const hint of ABNORMALITY_HINTS) {
    if (output.includes(hint) && !corpus.includes(hint)) {
      unsupportedMentions.push(hint);
    }
  }

  if (unsupportedMentions.length > 0) {
    errors.push("unsupported_abnormality");
    warnings.push(
      `AI mentioned terms not grounded in supplied observations: ${unsupportedMentions.join(", ")}`,
    );
  }

  // Recommendation should stay empty unless input supports it (history/findings mention follow-up cues)
  if (draft.recommendation.trim()) {
    const support =
      /follow[\s-]?up|recommend|suggest|correlate|further|clinical correlation/i.test(corpus) ||
      unsupportedMentions.length === 0;
    if (!support) {
      warnings.push("recommendation_not_clearly_supported");
    }
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    unsupportedMentions,
  };
}
