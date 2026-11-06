import type { ComposerInputSnapshot } from "./types";

/**
 * A diagnosis CARE may reach from the observations the radiologist supplied, and the
 * evidence that must be in his own words before the word is allowed on the page.
 *
 * WHY THIS EXISTS. CARE's grounding rules ask whether every abnormality term in a
 * draft appears in the input. That is right for an invented finding and wrong for a
 * synthesis: the radiologist dictates "Restricted diffusion in the right basal
 * ganglia, hyperintense on DWI with corresponding low signal on ADC", and the report
 * that serves him says "Acute infarct in the right basal ganglia". The word
 * "infarct" is nowhere in the input. On 2026-11-02 a live qwen3 draft was refused
 * exactly there (`unsupported_abnormality`, every proposed field NULL) for a report
 * that was clinically correct, and a second refusal (`impression_ungrounded`) was
 * waiting behind it. The knowledge pack already authorises the inference —
 * `mri-brain-v1.md` §58: "the IMPRESSION may synthesize those findings into that
 * diagnosis… This is different from inventing an unsupplied imaging characteristic"
 * — and the MRI brain persona has always agreed ("Do NOT call infarction from
 * nonspecific signal alteration unless the supplied imaging pattern supports it").
 * What was missing was a rule the *validator* could see.
 *
 * SO THIS TABLE IS DELIBERATELY TINY. One entry, for one measured refusal. A rule is
 * added when a real job on the clinic's own model fails for a synthesis §58-style
 * text authorises, and each entry names the section that authorises it. It is not a
 * diagnostic engine: there is no differential, no weighting, no second rule set, and
 * nothing here can put a finding on the page that the radiologist did not describe —
 * it only declines to call a described pattern ungrounded.
 *
 * WHAT A RULE MAY NOT DO:
 *  - license a term on the strength of text the MODEL wrote. Evidence is read from the
 *    snapshot's own corpus, never from the draft it is judging.
 *  - license a term whose evidence was DENIED. `No diffusion restriction.` contains
 *    the evidence words inside a negation, so every evidence phrase must be affirmed
 *    (`isAffirmed`), not merely present. That is case C of the acceptance brief.
 *  - license the characterisation as well as the diagnosis. §58 lists what must not be
 *    inferred with it — territory, arterial occlusion, embolic mechanism, hemorrhagic
 *    transformation, edema, mass effect. Those stay ungrounded: no rule here names
 *    "occlusion", "thrombus", "hemorrhage" or "herniation", so the existing refusals
 *    for them are untouched.
 *  - fire outside the examination whose knowledge section authorises it. `scope` is
 *    matched by the same predicate the persona router uses to load the MRI brain
 *    module, so a licence never exists in a run where the model was not shown the
 *    rules it comes from.
 */
export type SynthesisRule = {
  /** Stable identifier, printed in the warning so a refusal is traceable. */
  readonly id: string;
  /** The examination this rule may ever fire for. */
  readonly scope: "mri-brain";
  /**
   * Evidence that must ALL be affirmed in the supplied text. Each entry is one
   * requirement and lists the wordings that satisfy it — an AND of ORs, never an OR
   * of requirements, because §58's example supplies both the DWI and the ADC half.
   */
  readonly requires: readonly (readonly string[])[];
  /** Abnormality terms these observations support. Matched as substrings, the way
   * `ABNORMALITY_HINTS` itself is matched, so "infarct" covers "infarction". */
  readonly licenses: readonly string[];
  /** Where the rule comes from, as the clinician can open it. */
  readonly kbSource: string;
  /** The sentence a radiologist reads to see why the word is there. */
  readonly notice: string;
};

export const SYNTHESIS_RULES: readonly SynthesisRule[] = [
  {
    id: "mri-brain-acute-infarct",
    scope: "mri-brain",
    requires: [
      ["restricted diffusion", "diffusion restriction"],
      // The ADC correlate. It may be satisfied by the technique line as well as by
      // prose: `groundedCorpus` is text the model was shown, and a study whose
      // protocol does not include ADC cannot support the inference either way.
      ["adc"],
    ],
    licenses: ["infarct", "infarction"],
    kbSource: "ai-knowledge/care-radiologist/mri-brain-v1.md §58",
    notice:
      "stated as an acute infarct from the supplied restricted diffusion with an ADC correlate "
      + "(mri-brain-v1 §58). Territory, occlusion, mechanism and haemorrhagic transformation are "
      + "NOT inferred.",
  },
];

/**
 * Does this snapshot's examination get the MRI brain knowledge module?
 *
 * Kept to `persona/router.ts`'s own condition — `family === "brain"` with an MR
 * modality — rather than a keyword scan of the title. `supportedSynthesis.test.ts`
 * pins the two against each other over a study matrix: a licence must never exist
 * where the model was not shown the rules that grant it.
 */
export function isMriBrainStudy(snapshot: ComposerInputSnapshot): boolean {
  const modality = (snapshot.modality ?? "").toUpperCase();
  return (snapshot.family ?? "").toLowerCase() === "brain" && (modality === "MR" || modality === "MRI");
}

function ruleApplies(rule: SynthesisRule, snapshot: ComposerInputSnapshot): boolean {
  return rule.scope === "mri-brain" && isMriBrainStudy(snapshot);
}

export type LicensedSynthesis = {
  readonly rule: SynthesisRule;
  /** The requirements satisfied, for the warning line. */
  readonly evidence: readonly string[];
};

/**
 * Which syntheses this snapshot's own text supports.
 *
 * `isAffirmed(phrase)` answers "does the supplied corpus state this phrase, not deny
 * it?" — supplied by the caller, because polarity belongs to the validator's sentence
 * machinery and this module must not grow a second copy of it.
 *
 * The licensed SET is a flat list of terms: callers ask "is `hemorrhage` licensed?"
 * and never decide for themselves which rules fired.
 */
export function licensedSyntheses(
  snapshot: ComposerInputSnapshot,
  isAffirmed: (phrase: string) => boolean,
): LicensedSynthesis[] {
  const out: LicensedSynthesis[] = [];
  for (const rule of SYNTHESIS_RULES) {
    if (!ruleApplies(rule, snapshot)) continue;
    const evidence: string[] = [];
    let satisfied = true;
    for (const requirement of rule.requires) {
      const met = requirement.find((phrase) => isAffirmed(phrase));
      if (!met) {
        satisfied = false;
        break;
      }
      evidence.push(met);
    }
    if (satisfied) out.push({ rule, evidence });
  }
  return out;
}

/** The terms the supplied observations support, lower-cased. */
export function licensedTerms(
  snapshot: ComposerInputSnapshot,
  isAffirmed: (phrase: string) => boolean,
): Set<string> {
  const terms = new Set<string>();
  for (const synthesis of licensedSyntheses(snapshot, isAffirmed)) {
    for (const term of synthesis.rule.licenses) terms.add(term);
  }
  return terms;
}

/**
 * One sentence per licensed synthesis, naming the evidence and the knowledge section.
 *
 * Only for a licence the DRAFT used: a rule that fired on the input but whose word
 * appears nowhere in the answer explains an inference nobody made, and a review panel
 * full of irrelevant caveats is a panel that gets skipped.
 */
export function usedSynthesisNotices(
  snapshot: ComposerInputSnapshot,
  isAffirmed: (phrase: string) => boolean,
  outputText: string,
): string[] {
  const out: string[] = [];
  for (const synthesis of licensedSyntheses(snapshot, isAffirmed)) {
    if (!synthesis.rule.licenses.some((term) => outputText.includes(term))) continue;
    out.push(
      `CARE stated ${synthesis.rule.licenses.join("/")} because the supplied text affirms `
        + `${synthesis.evidence.join(" + ")} — ${synthesis.rule.notice} [rule ${synthesis.rule.id}, `
        + `${synthesis.rule.kbSource}]`,
    );
  }
  return out;
}
