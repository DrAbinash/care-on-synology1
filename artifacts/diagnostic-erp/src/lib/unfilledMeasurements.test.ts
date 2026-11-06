/**
 * The unfilled-measurement strip, against the exact 13 shipped box texts that carry
 * a blank (`radiology_quick_findings`, measured on the isolated rig at the release
 * candidate) plus the parameter case that leaves a bare label.
 *
 * Each expectation states the sentence the report must print: the observation stays
 * whole, the number that was never asked for goes, and the grammar is left as a
 * radiologist wrote it.
 */
import { describe, expect, it } from "vitest";
import { hasUnfilledMeasurement, stripUnfilledMeasurements } from "./unfilledMeasurements";

const cases: Array<{ label: string; source: string; printed: string }> = [
  {
    label: "AVM",
    source: "{side} arteriovenous malformation (AVM) with nidus measuring approximately ___ cm.",
    printed: "Right arteriovenous malformation (AVM) with nidus.",
  },
  {
    label: "SDH (two blanks, one dangling noun)",
    source: "Acute subdural hematoma over the right convexity, maximum thickness ___ mm. "
      + "Mass effect with midline shift of ___ mm to the left.",
    printed: "Acute subdural hematoma over the right convexity. "
      + "Mass effect with midline shift to the left.",
  },
  {
    label: "Subdural hematoma",
    source: "Crescentic extra-axial collection over the {side} cerebral convexity, "
      + "maximum thickness ___ mm, consistent with subdural hematoma.",
    printed: "Crescentic extra-axial collection over the right cerebral convexity, "
      + "consistent with subdural hematoma.",
  },
  {
    label: "Gallstones",
    source: "Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, "
      + "largest measuring ___ mm, suggestive of cholelithiasis. Gallbladder wall thickness normal.",
    printed: "Multiple echogenic foci with acoustic shadowing in the gallbladder lumen, "
      + "suggestive of cholelithiasis. Gallbladder wall thickness normal.",
  },
  {
    label: "Pulmonary nodule (triple dimension)",
    source: "Spiculated pulmonary nodule measuring ___ × ___ × ___ cm in the {side} upper lobe. "
      + "Surrounding ground-glass opacities.",
    printed: "Spiculated pulmonary nodule in the right upper lobe. Surrounding ground-glass opacities.",
  },
  {
    label: "Follow-up scan (the Recommendation blank)",
    source: "Follow-up scan recommended in ___ weeks.",
    printed: "Follow-up scan recommended.",
  },
  {
    label: "Acute hemorrhage (shift kept, number dropped)",
    source: "Acute intraparenchymal hemorrhage in the {side} basal ganglia with intraventricular "
      + "extension. Mass effect with midline shift of ___ mm to the contralateral side.",
    printed: "Acute intraparenchymal hemorrhage in the right basal ganglia with intraventricular "
      + "extension. Mass effect with midline shift to the contralateral side.",
  },
  {
    label: "Acute ICH",
    source: "Acute intraparenchymal hemorrhage in the right basal ganglia measuring ___ × ___ cm. "
      + "Intraventricular extension.",
    printed: "Acute intraparenchymal hemorrhage in the right basal ganglia. Intraventricular extension.",
  },
  {
    label: "Glioma recurrence",
    source: "Heterogeneously enhancing area in the right frontal operculum at the post-resection "
      + "cavity, measuring approximately ___ × ___ × ___ cm, with surrounding edema.",
    printed: "Heterogeneously enhancing area in the right frontal operculum at the post-resection "
      + "cavity with surrounding edema.",
  },
  {
    label: "Spiculated mass (Breast)",
    source: "Spiculated mass in the {side} upper outer quadrant measuring ___ × ___ cm with "
      + "associated skin retraction. Highly suspicious for malignancy.",
    printed: "Spiculated mass in the right upper outer quadrant with associated skin retraction. "
      + "Highly suspicious for malignancy.",
  },
  {
    label: "Aneurysm",
    source: "Saccular aneurysm at the {side} posterior communicating artery, measuring "
      + "approximately ___ mm.",
    printed: "Saccular aneurysm at the right posterior communicating artery.",
  },
];

/** Every shipped blank, after the tile's own {side} has been substituted. */
function fill(source: string): string {
  return source.replace(/\{side\}/g, "right");
}

describe("an unfilled measurement never reaches the report", () => {
  for (const c of cases) {
    it(`${c.label} prints without its blank`, () => {
      const out = stripUnfilledMeasurements(fill(c.source));
      expect(out.text).toBe(c.printed);
      expect(hasUnfilledMeasurement(out.text), "and no blank survives").toBe(false);
      expect(out.removed.length, "the excised fragments are reported").toBeGreaterThan(0);
    });
  }
});

describe("complete prose is never rewritten", () => {
  const untouched = [
    "Gallbladder wall thickness normal.",
    "Main pancreatic duct not dilated.",
    "Liver measures 14 cm in the longest span.",
    "Multiple echogenic foci with acoustic shadowing in the gallbladder lumen.",
    "Area of encephalomalacia with gliosis in the right hemisphere.",
  ];
  for (const text of untouched) {
    it(`leaves "${text.slice(0, 40)}…" exactly as authored`, () => {
      expect(stripUnfilledMeasurements(text).text).toBe(text);
      expect(stripUnfilledMeasurements(text).removed).toEqual([]);
    });
  }

  it("returns an empty string for text that is nothing but a blank", () => {
    expect(stripUnfilledMeasurements("___ mm").text).toBe("");
  });

  /**
   * The anchoring rule, as a test. A global measure-noun cleanup — the first version
   * of this module — rewrote the untouched second sentence below to "normal in and
   * configuration." because the word "size" appeared somewhere in a string that also
   * held a blank. Only text touching the hole may go.
   */
  it("excises the hole and nothing that merely shares the string with it", () => {
    const out = stripUnfilledMeasurements(
      "Subdural collection over the left convexity, maximum thickness ___ mm, showing mixed T1 and "
      + "T2 signal consistent with subacute subdural hematoma. Ventricular system is otherwise "
      + "normal in size and configuration. Basal cisterns are patent.",
    );
    expect(out.text).toBe(
      "Subdural collection over the left convexity, showing mixed T1 and T2 signal consistent "
      + "with subacute subdural hematoma. Ventricular system is otherwise normal in size and "
      + "configuration. Basal cisterns are patent.",
    );
  });

  /**
   * A label with a colon is only dropped when the blank was its entire answer. Here
   * the colon introduces a list that survives, so the label must stay attached to it.
   */
  it("keeps a label that still has content after it", () => {
    const out = stripUnfilledMeasurements(
      "Mediastinal lymphadenopathy: subcarinal node measuring ___ × ___ cm, paratracheal nodes enlarged.",
    );
    expect(out.text).toBe("Mediastinal lymphadenopathy: subcarinal node, paratracheal nodes enlarged.");
  });

  /**
   * ASPECTS is the score the owner named: "ASPECTS: ___/10" must not print as the
   * orphaned "ASPECTS: /10", which reads as a score of ten.
   */
  it("takes an empty score with its denominator and its label", () => {
    const out = stripUnfilledMeasurements(
      "Acute left MCA territory infarct. No hemorrhagic transformation. ASPECTS: ___/10.",
    );
    expect(out.text).toBe("Acute left MCA territory infarct. No hemorrhagic transformation.");
  });

  it("drops a bracket whose only content was an unfilled measurement", () => {
    const out = stripUnfilledMeasurements(
      "Single live intrauterine gestation. Cardiac activity positive (FHR ___ bpm). BPD: ___ mm. "
      + "HC: ___ mm. AC: ___ mm. EFW: ___ g. Placenta is posterior, fundal, grade II. "
      + "Normal amniotic fluid volume (AFI: ___ cm). No fetal anomaly detected.",
    );
    expect(out.text).toBe(
      "Single live intrauterine gestation. Cardiac activity positive. Placenta is posterior, "
      + "fundal, grade II. Normal amniotic fluid. No fetal anomaly detected.",
    );
  });

  it("takes a stranded date blank with the word it dated", () => {
    expect(stripUnfilledMeasurements("Comparison made with prior study dated ____.").text)
      .toBe("Comparison made with prior study.");
  });
});
