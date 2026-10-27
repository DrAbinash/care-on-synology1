/**
 * The shared clinical vocabulary's own contract.
 *
 * `ABNORMAL_TERMS` is read by Q103/Q113/Q114, by Q117's named-diagnosis gate, by
 * the Findings↔Impression contract and by the study-normal arm of the Impression
 * dependency. Every one of those rules is tested against reports; none of them is
 * tested against the TABLE, so a word the table only half-knows shows up as five
 * quiet rules rather than one broken entry. This file tests the table directly.
 *
 * Two properties are pinned. First, that a finding written in either spelling is
 * read the same way — the defect class the C1 brief names (Q114 seeing
 * "hemorrhage" and not "haemorrhage") is one instance of, and the class is what
 * the vocabulary exists to close. Second, that the labels distinguish what a
 * radiologist SAW from what a radiologist MEASURED, which is the distinction the
 * `wall thickening` entry had backwards.
 *
 * Every case is synthetic prose or a sentence lifted from a shipped report format.
 * None of it is a patient.
 */
import { describe, expect, it } from "vitest";
import { ABNORMAL_TERMS, clinicalOccurrences } from "./clinicalTerms";

/**
 * The labels a phrase matches, ignoring the negation reading. Compiled
 * case-insensitively because that is how the product compiles every entry
 * (`COMPILED` uses the "gi" flags), so a table tested case-sensitively measures
 * the test and not the rule.
 */
function labelsOf(phrase: string): string[] {
  return ABNORMAL_TERMS.filter((t) => new RegExp(t.pattern, "i").test(phrase)).map((t) => t.label);
}

/** The labels the negation reading leaves standing, in the order the table lists them. */
function assertedLabels(text: string): string[] {
  return clinicalOccurrences(text)
    .filter((o) => o.state !== "denied")
    .map((o) => o.label);
}

describe("both spellings of one finding read the same way", () => {
  /**
   * Pairs the vocabulary DOES read. Both halves must produce the same label list —
   * not merely both produce something, because a pair that matched different labels
   * would pair up wrongly in the Findings↔Impression comparison, which keys on the
   * label. Measured: 14 pairs, 0 divergent.
   */
  const READ: readonly (readonly [string, string])[] = [
    ["haemorrhage", "hemorrhage"],
    ["haematoma", "hematoma"],
    ["haematomas", "hematomas"],
    ["subarachnoid haemorrhage", "subarachnoid hemorrhage"],
    ["oedema", "edema"],
    ["ischaemia", "ischemia"],
    ["ischaemic", "ischemic"],
    ["tumour", "tumor"],
    ["tumours", "tumors"],
    ["empyaema", "empyema"],
    ["disc bulge", "disk bulge"],
    ["disc extrusion", "disk extrusion"],
    ["extradural haematoma", "epidural hematoma"],
    ["infarct", "infarction"],
  ];

  for (const [british, american] of READ) {
    it(`"${british}" and "${american}" are the same finding`, () => {
      const b = labelsOf(british);
      const a = labelsOf(american);
      expect(b, `"${british}" matched nothing — the table has a hole, not a spelling`).not.toEqual([]);
      expect(a, `"${american}" matched nothing — the table has a hole, not a spelling`).not.toEqual([]);
      expect(a).toEqual(b);
    });
  }

  /**
   * Pairs the vocabulary reads in NEITHER spelling. This is a register, not a
   * blessing: each row says why the silence is either intended or owed, so that a
   * row can be deleted when the term is added and cannot be quietly forgotten when
   * it is not. The assertion is that the silence is symmetric — one spelling
   * matching while the other does not is the defect this file exists to catch, and
   * it would be invisible in the READ table above because that table only lists
   * pairs somebody already noticed.
   *
   * The three owed rows were found by this table and are NOT fixed here. Adding a
   * term is a widening, and a widening is only justified by a measured detection it
   * buys: none of the three appears in any shipped format, in the golden corpus, or
   * in the held-out cases, so there is nothing to measure against. They are named
   * so that the next report written with one of them is a known gap rather than a
   * surprise.
   */
  const SILENT: readonly (readonly [string, string, string])[] = [
    ["haemothorax", "hemothorax", "OWED — blood in the pleural space is an abnormality; a haemothorax-only report under a normal Impression arms neither Q103 nor Q114. The held-out case that looks like it covers this actually fires on 'atelectasis'."],
    ["haemopericardium", "hemopericardium", "OWED — same shape one compartment over, and the same emergency."],
    ["haemarthrosis", "hemarthrosis", "OWED — blood in a joint; the clinic reports trauma films."],
    ["oedematous", "edematous", "OWED — the adjective form of a label the table does have ('the bowel wall is oedematous' asserts nothing today)."],
    ["oesophagitis", "esophagitis", "OWED — `inflammation` lists thirteen -itides and not this one, while `ANATOMICAL_SITE_TERMS.bowel` already knows the organ in both spellings."],
    ["haemangioma", "hemangioma", "INTENDED — a benign-only entity, which this table's header excludes on purpose; a whole-spine haemangioma is read through 'lesion'."],
    ["anaemia", "anemia", "INTENDED — a laboratory value, not an imaging finding."],
    ["haematuria", "hematuria", "INTENDED — a clinical finding, not an imaging one."],
    ["paediatric", "pediatric", "INTENDED — a patient descriptor, not a finding."],
  ];

  for (const [british, american, why] of SILENT) {
    it(`"${british}" / "${american}" — neither spelling is read: ${why}`, () => {
      expect(labelsOf(british)).toEqual(labelsOf(american));
      expect(labelsOf(british)).toEqual([]);
    });
  }
});

describe("the wall-thickening label reads what was seen, not what was measured", () => {
  /**
   * Each of these is a sentence a shipped report format or a golden-corpus report
   * actually contains, and in each the finding is stated with the participle or the
   * gerund.
   */
  const SEEN: readonly string[] = [
    "The gallbladder wall is thickened.",
    "Markedly thickened gallbladder wall.",
    "Mild wall thickening of the terminal ileum.",
    "Adjacent prevertebral soft tissue thickening/collection noted.",
    "Enlarged right axillary lymph node with cortical thickening and loss of fatty hilum.",
    "Dilated blind-ending tubular structure in the right iliac fossa measuring 11 mm, with wall thickening and mucosal hyperaemia.",
  ];

  /**
   * And each of these is correct prose that must not be read as a finding: the
   * dimension noun in a normal declaration, the dimension noun as a measurement,
   * the acquisition adjective, and the four ways the finding is denied.
   *
   * The last two rows are the reason the noun is dropped outright rather than
   * graded. A lookahead that kept "thickness" when a severity word followed it was
   * implemented, and it read both of these normal declarations as wall thickening —
   * the negation reader looks for a denial BEFORE the term, and after the term it
   * recognises "not seen / excluded / ruled out" only, so an adjective allowed
   * after the noun is equally allowed after "not".
   */
  const NOT_SEEN: readonly string[] = [
    "Gallbladder is normal in size and wall thickness.",
    "Both kidneys are normal in size and cortical thickness.",
    "Gallbladder wall thickness is normal.",
    "Normal size and wall thickness (< 3 mm). No calculi or polyps.",
    "Bladder is well-distended with normal wall thickness.",
    "Right acute convexity subdural haematoma with a maximum thickness of 12 mm.",
    "Axial 5 mm thick slices were obtained.",
    "Thick-slab MIP images of the biliary tree were reviewed.",
    "No bowel wall thickening.",
    "The gallbladder contains multiple stones without wall thickening or pericholecystic fluid.",
    "The wall is not thickened.",
    "Wall thickening is excluded.",
    "Gallbladder wall thickness: no significant abnormality.",
    "Gallbladder wall thickness measures 3 mm, which is not abnormal.",
  ];

  for (const sentence of SEEN) {
    it(`reads a stated thickening: ${sentence}`, () => {
      expect(assertedLabels(sentence)).toContain("wall thickening");
    });
  }

  for (const sentence of NOT_SEEN) {
    it(`does not read a measurement or a denial: ${sentence}`, () => {
      expect(assertedLabels(sentence)).not.toContain("wall thickening");
    });
  }

  it("costs one construction, named so that the price is visible", () => {
    // The noun IS the finding here, and the table no longer reads it. That is the
    // deliberate half of the trade: this clause shape appears in none of the 58
    // shipped formats, none of the 20 golden-corpus reports and none of the held-out
    // cases, while the two shapes above it in NOT_SEEN are ordinary reporting. If a
    // report ever needs it, the fix is to teach the negation reader that "not
    // abnormal" after a term is a denial — which would also fix the two rows that
    // forced this one out — and not to put the noun back.
    expect(assertedLabels("Gallbladder wall thickness is increased to 5 mm.")).not.toContain("wall thickening");
  });
});
