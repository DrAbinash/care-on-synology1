/**
 * A pneumothorax box must retire every pleural normal the chest baseline states.
 *
 * `CT Chest — Normal` (the shipped Starting-Canvas format, the one the clinic
 * selects for a plain chest CT) states the pleura twice:
 *
 *   "No pleural effusion or pneumothorax."
 *   "Bilateral pleural spaces are clear."
 *
 * The Quick Select box #398 "Pneumothorax" [Chest/CT] carries concept
 * `pneumothorax`, `properties:"side"`, and no `baseline_replaces`, so retirement
 * ran entirely on concept ownership. That owned the first sentence through the
 * pack token and missed the second, because the word "pneumothorax" does not
 * appear in it. Measured on the shipped data with the production oracle, all
 * nine normals of the format passed through `falsifies`:
 *
 *   retired   ["No pleural effusion or pneumothorax."]
 *   survivors […, "Bilateral pleural spaces are clear.", …]
 *
 * so the report printed "Pneumothorax on the left." and, four lines later, that
 * both pleural spaces are clear — the contradiction the owner sees as the reason
 * not to trust the report over paper.
 *
 * The fix is scoped to the pleural space being declared clear, because the same
 * format also carries "No focal consolidation, mass lesion, or nodule." and a
 * chest box about the pleura must not delete a normal that is still true: air in
 * the pleural space does not make an effusion or a thickening appear.
 */
import { describe, expect, it } from "vitest";
import {
  falsifies, filterRestorableBaselines, suppressedKeys,
  type SuppressingObservation,
} from "./normalSuppression";
import { sentenceMatchesConcept } from "../observationSlot";
import { DEFAULT_REPORT_FORMATS } from "../zai-workspace/report-formats-library";
import { splitToSentences } from "../reportFieldMerge";

/** Exactly what the shipped tile declares, read from the format the clinic uses. */
const chestNormal = DEFAULT_REPORT_FORMATS.find((f) => f.name === "CT Chest — Normal");
const chestFindings = String((chestNormal as unknown as { findings?: string } | undefined)?.findings ?? "");

const pneumothoraxLeft: SuppressingObservation = {
  baselineReplaces: null,
  concept: "pneumothorax",
  laterality: "left",
  renderedText: "Pneumothorax on the left.",
};
const pneumothoraxRight: SuppressingObservation = {
  ...pneumothoraxLeft,
  laterality: "right",
  renderedText: "Pneumothorax on the right.",
};

const retiredBy = (obs: SuppressingObservation, sentences: string[]) =>
  sentences.filter((s) => falsifies(obs, s));

describe("the shipped chest baseline is what this test claims", () => {
  it("exists and states the pleura in two different sentences", () => {
    expect(chestNormal, "CT Chest — Normal must stay a shipped format").toBeTruthy();
    const sentences = splitToSentences(chestFindings).map((s) => s.trim()).filter(Boolean);
    expect(sentences).toContain("No pleural effusion or pneumothorax.");
    expect(sentences).toContain("Bilateral pleural spaces are clear.");
  });
});

describe("a pneumothorax retires every pleural normal", () => {
  const sentences = splitToSentences(chestFindings).map((s) => s.trim()).filter(Boolean);

  it("retires both pleural sentences, not just the one that names it", () => {
    const retired = retiredBy(pneumothoraxLeft, sentences);
    expect(retired).toContain("No pleural effusion or pneumothorax.");
    expect(retired).toContain("Bilateral pleural spaces are clear.");
  });

  it("leaves every non-pleural normal standing, unaltered", () => {
    const retired = new Set(retiredBy(pneumothoraxLeft, sentences));
    const survivors = sentences.filter((s) => !retired.has(s));
    expect(survivors).toEqual([
      "Lung fields are clear.",
      "No focal consolidation, mass lesion, or nodule.",
      "Trachea and main bronchi are patent.",
      "Mediastinum is normal.",
      "No lymphadenopathy.",
      "Heart and great vessels are unremarkable.",
      "Pulmonary vasculature is normal.",
      "Bony thorax shows no lytic or sclerotic lesion.",
    ]);
  });

  it("a left pneumothorax still retires a bilateral normal", () => {
    // D-27 keeps a LEFT observation from taking the RIGHT normal off the page, but
    // "bilateral" belongs to both sides — that sentence says this space is clear.
    expect(falsifies(pneumothoraxLeft, "Bilateral pleural spaces are clear.")).toBe(true);
    expect(falsifies(pneumothoraxRight, "Bilateral pleural spaces are clear.")).toBe(true);
  });

  it("putting it back works as well as taking it away", () => {
    // Retirement is what the radiologist sees when they click; restoration is what
    // they see when they deselect. Both must know about the second sentence, or
    // deseleting the box leaves a report with a missing pleural normal forever.
    const declared = ["No pleural effusion or pneumothorax.", "Bilateral pleural spaces are clear."];
    expect(filterRestorableBaselines(declared, [])).toEqual(declared);
    expect(filterRestorableBaselines(declared, [pneumothoraxLeft])).toEqual([]);
    expect(suppressedKeys([pneumothoraxLeft], declared).size).toBe(2);
  });
});

describe("the rule does not reach past the pleural space", () => {
  it("keeps a normal that denies effusion or thickening without calling the space clear", () => {
    for (const stillTrue of [
      "No pleural effusion.",
      "No pleural thickening is seen.",
      "No pleural based mass lesion is seen.",
      "Costophrenic angles are sharp.",
    ]) {
      expect(falsifies(pneumothoraxLeft, stillTrue), `must NOT retire: ${stillTrue}`).toBe(false);
    }
  });

  it("owns a pleural-space normal in the other spellings the clinic types", () => {
    expect(sentenceMatchesConcept("The pleural spaces are normal.", "pneumothorax")).toBe(true);
    expect(sentenceMatchesConcept("Pleural space is free.", "pneumothorax")).toBe(true);
    expect(sentenceMatchesConcept("Pleural spaces are unremarkable.", "pneumothorax")).toBe(true);
  });

  it("does not decide a sentence is a normal from the word alone", () => {
    // The marker has to say the SPACE is clear. "No pleural space fluid collection"
    // denies fluid, which a pneumothorax does not contradict — the same reasoning
    // that keeps "No pleural effusion." on the page above.
    expect(sentenceMatchesConcept("No pleural space fluid collection is seen.", "pneumothorax")).toBe(false);
    expect(sentenceMatchesConcept("A chest tube is seen in the right pleural space.", "pneumothorax")).toBe(false);
  });

  it("does not hand the pleural space to some other concept", () => {
    // A pleural effusion box owns "effusion", not this sentence; if it started
    // matching, an effusion would delete a normal a pneumothorax needs.
    expect(sentenceMatchesConcept("Bilateral pleural spaces are clear.", "ventricles")).toBe(false);
    expect(sentenceMatchesConcept("Bilateral pleural spaces are clear.", null)).toBe(false);
  });
});
