/**
 * mriBrainVascularTechnique.test.ts — the technique layer that decides what a
 * vascular sentence may claim (mra/mrv spec §4, §5, §7, §9, §11, §12).
 *
 * The whole safety case of this module is that angiographic TECHNIQUE, not the
 * suspected diagnosis, limits the wording: a TOF gap is signal loss rather than a
 * percentage, early draining veins need a time-resolved acquisition, and a
 * filling defect needs contrast or phase contrast. These tests are the reason the
 * gates live in a pure module instead of inside a component.
 */

import { describe, expect, it } from "vitest";

import {
  VASCULAR_GATES,
  VASCULAR_STATEMENT_RULES,
  VASCULAR_TECHNIQUE_KEYS,
  defaultVascularTechnique,
  deriveVascularTechniqueAcquired,
  markVascularTechniqueManual,
  resolveVascularTechnique,
  vascularGate,
  withDerivedVascularTechnique,
} from "@/lib/mriBrainVascularTechnique";
import { parseBrainSequences } from "@/lib/mriBrainSequences";

const NO_SEQ = parseBrainSequences("MRI brain performed without contrast.");

function technique(over: Record<string, boolean> = {}) {
  return defaultVascularTechnique({
    acquired: {
      ...defaultVascularTechnique().acquired,
      ...over,
    },
  });
}

describe("derivation and override (spec §2, §4)", () => {
  it("derives each named angiographic technique", () => {
    const derived = deriveVascularTechniqueAcquired({
      techniqueText: "3D time-of-flight MRA of the circle of Willis, contrast-enhanced MRA of the neck, 2D phase-contrast MRV.",
    });
    expect(derived.mraTof).toBe(true);
    expect(derived.mraCe).toBe(true);
    expect(derived.mrvPhaseContrast).toBe(true);
    expect(derived.mrvTof).toBe(false);
    expect(derived.mraVesselWall).toBe(false);
  });

  it("recognises vessel-wall and time-resolved acquisitions", () => {
    const wall = deriveVascularTechniqueAcquired({ techniqueText: "3D T1 black-blood vessel-wall imaging." });
    expect(wall.mraVesselWall).toBe(true);
    const tricks = deriveVascularTechniqueAcquired({ techniqueText: "Time-resolved MRA (TRICKS) at 4 frames/s." });
    expect(tricks.timeResolved).toBe(true);
  });

  it("treats a non-contrast study as no contrast-enhanced angiography", () => {
    const derived = deriveVascularTechniqueAcquired({
      techniqueText: "Non-contrast MRI brain with 3D TOF MRA and MRV.",
    });
    expect(derived.mraTof).toBe(true);
    expect(derived.mraCe).toBe(false);
    expect(derived.mrvCe).toBe(false);
  });

  it("assumes nothing when the technique field is empty", () => {
    const derived = deriveVascularTechniqueAcquired({ techniqueText: "" });
    expect(VASCULAR_TECHNIQUE_KEYS.every((k) => derived[k] === false)).toBe(true);
  });

  it("never lets a re-derivation overrule what the radiologist stated", () => {
    let state = defaultVascularTechnique();
    state = withDerivedVascularTechnique(state, deriveVascularTechniqueAcquired({
      techniqueText: "Gadolinium-enhanced 3D MRA.",
    }));
    expect(resolveVascularTechnique(state).mraCe).toBe(true);
    // The radiologist corrects the booking: no contrast was in fact given.
    state = markVascularTechniqueManual(state, "mraCe", false);
    const reDerived = withDerivedVascularTechnique(state, deriveVascularTechniqueAcquired({
      techniqueText: "Gadolinium-enhanced 3D MRA.",
    }));
    expect(resolveVascularTechnique(reDerived).mraCe).toBe(false);
    expect(reDerived.manual.mraCe).toBe(false);
  });
});

describe("gates (spec §5, §7, §9, §11, §12)", () => {
  it("refuses a numeric stenosis built on TOF signal loss alone", () => {
    const tofOnly = technique({ mraTof: true });
    const gate = vascularGate("numericStenosis", tofOnly, NO_SEQ);
    expect(gate.allowed).toBe(false);
    expect(gate.notice).toMatch(/not generated from TOF signal loss/);
    expect(vascularGate("numericStenosis", technique({ mraCe: true }), NO_SEQ).allowed).toBe(true);
  });

  it("refuses an acute occlusion asserted from non-visualisation alone", () => {
    const st = technique({ mraCe: true });
    expect(vascularGate("acuteOcclusion", st, NO_SEQ).allowed).toBe(false);
    const withDwi = parseBrainSequences("MRI brain with DWI/ADC and contrast-enhanced MRA.");
    expect(vascularGate("acuteOcclusion", st, withDwi).allowed).toBe(true);
  });

  it("keeps early venous drainage behind a time-resolved acquisition", () => {
    const staticMra = technique({ mraTof: true });
    const gate = vascularGate("earlyVenousDrainage", staticMra, NO_SEQ);
    expect(gate.allowed).toBe(false);
    expect(gate.notice).toMatch(/static MRA cannot establish them/);
    expect(vascularGate("earlyVenousDrainage", technique({ timeResolved: true }), NO_SEQ).allowed).toBe(true);
  });

  it("requires a vessel-wall sequence for an intramural hematoma", () => {
    const plain = technique({ mraTof: true });
    expect(vascularGate("intramuralHematoma", plain, parseBrainSequences("T1W, T2W.")).allowed).toBe(false);
    const wall = technique({ mraVesselWall: true });
    expect(vascularGate("intramuralHematoma", wall, parseBrainSequences("T1W, T2W, vessel wall.")).allowed).toBe(true);
  });

  it("separates a venous flow gap from a filling defect", () => {
    const tofMrv = technique({ mrvTof: true });
    expect(vascularGate("fillingDefect", tofMrv, NO_SEQ).allowed).toBe(false);
    expect(vascularGate("fillingDefect", technique({ mrvCe: true }), NO_SEQ).allowed).toBe(true);
    // The venous assessment itself is still available on TOF.
    expect(vascularGate("venousAssessment", tofMrv, NO_SEQ).allowed).toBe(true);
  });

  it("reuses the parenchymal sequence model for enhancement, diffusion and blooming", () => {
    const seq = parseBrainSequences("T1W, T2W, FLAIR, DWI with ADC, SWI, post-contrast T1W.");
    expect(vascularGate("enhancement", technique(), seq).allowed).toBe(true);
    expect(vascularGate("diffusion", technique(), seq).allowed).toBe(true);
    expect(vascularGate("blooming", technique(), seq).allowed).toBe(true);
    const plain = parseBrainSequences("T1W, T2W, FLAIR without contrast.");
    expect(vascularGate("enhancement", technique(), plain).allowed).toBe(false);
    expect(vascularGate("blooming", technique(), plain).allowed).toBe(false);
  });

  it("has a gate for every gated feature", () => {
    for (const key of Object.keys(VASCULAR_GATES)) {
      expect(vascularGate(key as never, technique(), NO_SEQ)).toBeTruthy();
    }
  });
});

describe("statement rules (spec §19)", () => {
  it("flags wording the recorded technique cannot support", () => {
    for (const rule of VASCULAR_STATEMENT_RULES) {
      const sample = {
        numericStenosis: "Severe 70-80% focal stenosis of the left MCA M1 segment.",
        acuteOcclusion: "Acute arterial occlusion of the right ICA terminus.",
        earlyVenousDrainage: "Early draining veins into the superior sagittal sinus.",
        intramuralHematoma: "Crescentic T1 hyperintense intramural hematoma of the cervical ICA.",
        vesselWallCharacterisation: "Vessel-wall enhancement is noted.",
        fillingDefect: "Focal filling defect in the right transverse sinus.",
        thrombusSignal: "T1 hyperintense clot fills the superior sagittal sinus.",
      }[rule.feature];
      expect(rule.re.test(sample ?? ""), rule.feature).toBe(true);
    }
  });
});
