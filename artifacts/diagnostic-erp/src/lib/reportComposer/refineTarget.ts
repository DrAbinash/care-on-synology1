/**
 * What a "Refine Report" instruction applies to — decided from the text, not from
 * guesswork about the words.
 *
 * The path this replaces classified the instruction with a chain of regexes
 * (`/translat/ → TRANSLATE`, `/shorten/ → SHORTEN`, `/expand/ → EXPAND`,
 * otherwise REPHRASE) and then handed the model `findingsText.slice(0, 800)`. Two
 * failures followed directly from that: an instruction like "add the canal
 * measurement table" or "organise the findings by level" arrived labelled as a
 * request to rephrase, and anything past character 800 was never in the prompt, so
 * a model that returned only what it had been shown would have looked like a
 * correct refinement while silently deleting the rest of the report.
 *
 * The instruction is now sent verbatim and the model is told what it may not do to
 * clinical content (see the CARE persona's micro-edit task). Which text is the
 * target is still decided here, because the workspace knows it and the model
 * cannot infer it: a selection refines the selection, and nothing selected refines
 * the whole draft.
 */

export type RefineTarget = {
  jobKind: "SELECTION_EDIT" | "SECTION_EDIT";
  selectionText: string;
  /**
   * Which section Accept will overwrite. `RECOMMENDATION` is the third editable
   * prose section (`recommendationText` is in the workspace state, is sent in the
   * snapshot, and is a member of the server's `selectionField` enum); a selection
   * taken from it used to be reported as FINDINGS, so refining the tail of the
   * Recommendation replaced the Findings instead.
   */
  selectionField: "FINDINGS" | "IMPRESSION" | "RECOMMENDATION";
  instruction: string;
};

export function resolveRefineTarget(input: {
  instruction: string;
  selection?: string;
  findings: string;
  impression: string;
  recommendation?: string;
}): RefineTarget | null {
  const instruction = (input.instruction ?? "").trim();
  if (!instruction) return null;

  const selected = (input.selection ?? "").trim();
  if (selected) {
    // Containment, not a guess: the selection came from one of the editable
    // sections, and the only honest way to know which is to ask the current text.
    // Text present in more than one section stays with Findings, which is where
    // the radiologist's selection has always been applied. A selection found in
    // none of them also falls back to Findings — that is what it did before.
    const inFindings = input.findings.includes(selected);
    const inImpression = input.impression.includes(selected);
    const inRecommendation = (input.recommendation ?? "").includes(selected);
    return {
      jobKind: "SELECTION_EDIT",
      selectionText: selected,
      selectionField:
        !inFindings && inImpression
          ? "IMPRESSION"
          : !inFindings && !inImpression && inRecommendation
            ? "RECOMMENDATION"
            : "FINDINGS",
      instruction,
    };
  }

  const sections = [`FINDINGS:\n${input.findings}`, `IMPRESSION:\n${input.impression}`];
  if ((input.recommendation ?? "").trim()) sections.push(`RECOMMENDATION:\n${input.recommendation}`);
  return {
    jobKind: "SECTION_EDIT",
    selectionText: sections.join("\n\n"),
    selectionField: "FINDINGS",
    instruction,
  };
}
