/**
 * mriBrainContradictions.ts — MRI Brain contradiction + sequence-awareness
 * validation on top of the EXISTING contradiction warning surface
 * (impressionContradictionWarnings → ImpressionWarningStrip / Copilot).
 *
 * Warnings only. The validator never rewrites clinical interpretation.
 */

import {
  BRAIN_SEQUENCE_LABELS,
  SEQUENCE_STATEMENT_RULES,
  type BrainSequenceContext,
} from "@/lib/mriBrainSequences";

export type BrainContradictionRule = {
  id: string;
  normalRe: RegExp;
  abnormalRe: RegExp;
  label: string;
};

/**
 * Sentence-level normal-vs-abnormal pairs specific to brain reporting.
 * A sentence is only "abnormal" when it is not itself a denial
 * ("No midline shift…" must not fire "midline shift is present").
 */
export const BRAIN_CONTRADICTION_RULES: readonly BrainContradictionRule[] = [
  {
    id: "diffusion",
    normalRe: /no restricted diffusion|no evidence of restricted diffusion/i,
    abnormalRe: /restricted diffusion/i,
    label: "‘No restricted diffusion’ coexists with a restricted-diffusion finding.",
  },
  {
    id: "susceptibility",
    normalRe: /no (abnormal )?susceptibility|no micro-?bleed/i,
    abnormalRe: /susceptibility blooming|micro-?bleeds|blooming on gre\/swi/i,
    label: "‘No susceptibility blooming’ coexists with SWI/GRE blooming.",
  },
  {
    id: "mass_effect",
    normalRe: /no mass effect/i,
    abnormalRe: /mass effect is (present|seen)|local mass effect|mass effect with/i,
    label: "‘No mass effect’ coexists with a mass-effect finding.",
  },
  {
    id: "midline",
    normalRe: /no midline shift/i,
    abnormalRe: /midline shift( of \d+(\.\d+)? ?mm| is present| towards| toward)/i,
    label: "‘No midline shift’ coexists with a measured midline shift.",
  },
  {
    id: "ventricles",
    normalRe: /no hydrocephalus|ventricular system (is )?(normal|appropriate)/i,
    abnormalRe: /hydrocephalus is present|obstructive hydrocephalus|ventriculomegaly/i,
    label: "Normal ventricles coexist with hydrocephalus / ventriculomegaly.",
  },
  {
    id: "extra_axial",
    normalRe: /no extra-?axial collection/i,
    abnormalRe: /(subdural|epidural) (haematoma|hematoma)|extra-?axial collection (is )?(seen|present)|crescentic (collection|haematoma|hematoma)|biconvex collection/i,
    label: "‘No extra-axial collection’ coexists with a subdural/epidural collection.",
  },
  {
    id: "focal_lesion",
    normalRe: /no focal (parenchymal )?(signal abnormality|mass|lesion)/i,
    abnormalRe: /lesion is (seen|present)|ring-?enhancing (focal )?lesion|enhancing mass/i,
    label: "‘No focal lesion’ coexists with a described mass/lesion.",
  },
  {
    id: "flow_void",
    normalRe: /flow voids (are )?preserved|normal flow void/i,
    abnormalRe: /loss of (the )?(normal )?flow void|non-?visualisation of flow void/i,
    label: "‘Normal flow voids’ coexist with loss of a flow void.",
  },
  {
    id: "posterior_fossa",
    normalRe: /posterior fossa (structures )?(are )?unremarkable/i,
    abnormalRe: /cerebellopontine angle (mass|lesion)|cpa (mass|lesion)/i,
    label: "‘Normal posterior fossa’ coexists with a CPA lesion.",
  },
  {
    id: "hippocampi",
    normalRe: /hippocampi are symmetric|normal hippocampal (signal|volume)|unremarkable hippocamp/i,
    abnormalRe: /hippocampal (volume loss|atrophy|t2\/flair hyperintensity|sclerosis)|(volume loss|atrophy|sclerosis) of the (right|left|ipsilateral) hippocampus|hyperintensity of the (right|left) hippocampus|mesial temporal sclerosis/i,
    label: "Normal hippocampi coexist with hippocampal atrophy / signal change.",
  },
];

/** Split into sentences for scoped contradiction testing. */
function sentences(text: string): string[] {
  return text
    .split(/[.\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasAbnormalSentence(text: string, re: RegExp): boolean {
  return sentences(text).some((s) => {
    if (!re.test(s)) return false;
    // The sentence asserting the normal ("No X") is not an abnormal claim.
    const negativeForm = /\bno\b|\bnot\b|\bwithout\b|\babsence\b/i;
    return !negativeForm.test(s);
  });
}

export function brainTextContradictions(opts: {
  findingsText: string;
  impressionText?: string;
  seq: BrainSequenceContext;
}): string[] {
  const combined = [opts.findingsText, opts.impressionText ?? ""].join("\n");
  const warnings: string[] = [];

  for (const rule of BRAIN_CONTRADICTION_RULES) {
    if (rule.normalRe.test(combined) && hasAbnormalSentence(combined, rule.abnormalRe)) {
      warnings.push(`MRI Brain: ${rule.label}`);
    }
  }

  // Sequence-dependent statements vs documented technique.
  if (opts.seq.hasTechniqueSignal) {
    for (const rule of SEQUENCE_STATEMENT_RULES) {
      const required = [rule.key, ...(rule.also ?? [])];
      if (required.every((k) => opts.seq.performed[k])) continue;
      if (!rule.re.test(combined)) continue;
      // Don't double-report a statement already explained above.
      const missing = required
        .filter((k) => !opts.seq.performed[k])
        .map((k) => BRAIN_SEQUENCE_LABELS[k])
        .join("/");
      warnings.push(
        `MRI Brain: report contains ${rule.label}, but ${missing} is not documented in the technique. Verify the statement or record the sequence.`,
      );
    }
  }

  return [...new Set(warnings)];
}
