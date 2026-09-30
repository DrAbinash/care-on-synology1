/**
 * mriBrainVascularDraftState.test.ts — the radiologist's acquisition answers must
 * outlive the session (mra/mrv spec §2, §4).
 *
 * These flags are what every strong vascular sentence is gated on, so the two
 * failures that matter are: losing a correction on reopen (the gate reverts and the
 * already-written findings no longer match the technique), and trusting corrupted
 * column JSON (a garbage key opens a gate that was never earned). The tests assert
 * both, plus that untouched reports are not rewritten at all.
 */

import { describe, expect, it } from "vitest";

import {
  extractCareVascularTechnique,
  isPristineVascularTechnique,
  normalizeVascularTechniqueState,
  vascularTechniquePayload,
} from "@/lib/mriBrainVascularDraftState";
import {
  defaultVascularTechnique,
  deriveVascularTechniqueAcquired,
  markVascularTechniqueManual,
  resolveVascularTechnique,
  withDerivedVascularTechnique,
} from "@/lib/mriBrainVascularTechnique";
import { useWorkspace } from "@/lib/zai-workspace/store";

describe("mriBrainVascularDraftState — parsing untrusted column JSON", () => {
  it("fills a complete state from a partial saved bag", () => {
    const parsed = normalizeVascularTechniqueState({
      acquired: { mraTof: true, mraCe: false },
      manual: { mraCe: false },
      designationNote: "Non-contrast 3D TOF only",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.acquired.mraTof).toBe(true);
    expect(parsed!.manual.mraCe).toBe(false);
    expect(parsed!.designationNote).toBe("Non-contrast 3D TOF only");
    // Every key exists, so later reads never see undefined.
    expect(Object.values(parsed!.acquired).filter((v) => typeof v === "boolean")).toHaveLength(10);
  });

  it("refuses shapes that are not a technique bag", () => {
    expect(normalizeVascularTechniqueState(null)).toBeNull();
    expect(normalizeVascularTechniqueState("mraTof")).toBeNull();
    expect(normalizeVascularTechniqueState([{ mraTof: true }])).toBeNull();
    expect(normalizeVascularTechniqueState({})).toBeNull();
    expect(normalizeVascularTechniqueState({ acquired: "everything" })).toBeNull();
  });

  it("drops unknown keys and non-boolean values instead of trusting them", () => {
    const parsed = normalizeVascularTechniqueState({
      acquired: { mraTof: "yes", mraCe: 1, timeResolved: true, notAKey: true },
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.acquired.timeResolved).toBe(true);
    expect(parsed!.acquired.mraCe).toBe(false);
    expect(parsed!.acquired).not.toHaveProperty("notAKey");
    // A value that cannot be read as a boolean is not an acquisition answer.
    expect(parsed!.acquired.mraTof).toBe(false);
  });

  it("bounds a runaway designation note", () => {
    const parsed = normalizeVascularTechniqueState({ designationNote: "x".repeat(5000) });
    expect(parsed!.designationNote!.length).toBeLessThanOrEqual(400);
  });

  it("reads the envelope key and a bare column alike", () => {
    const state = { ...defaultVascularTechnique(), manual: { mraVesselWall: false } };
    expect(extractCareVascularTechnique({ careVascularTechnique: state })).not.toBeNull();
    expect(extractCareVascularTechnique({ vascularTechnique: state })).not.toBeNull();
    expect(extractCareVascularTechnique({ careCanalApProvenance: {} })).toBeNull();
    expect(extractCareVascularTechnique(null)).toBeNull();
  });
});

describe("mriBrainVascularDraftState — what gets written", () => {
  it("writes nothing while the radiologist has said nothing", () => {
    const folded = withDerivedVascularTechnique(
      defaultVascularTechnique(),
      deriveVascularTechniqueAcquired({ techniqueText: "3D TOF of the circle of Willis" }),
    );
    expect(isPristineVascularTechnique(folded)).toBe(true);
    expect(folded.acquired.mraTof).toBe(true);
    expect(vascularTechniquePayload(folded)).toBeUndefined();
    expect(vascularTechniquePayload(null)).toBeUndefined();
  });

  it("writes as soon as an acquisition answer is stated", () => {
    const derived = deriveVascularTechniqueAcquired({
      techniqueText: "3D TOF and gadolinium-enhanced MRA",
    });
    expect(derived.mraCe).toBe(true);
    const stated = markVascularTechniqueManual(
      withDerivedVascularTechnique(defaultVascularTechnique(), derived),
      "mraCe",
      false,
    );
    const payload = vascularTechniquePayload(stated);
    expect(payload).toBeDefined();
    expect(payload!.manual.mraCe).toBe(false);
    expect(resolveVascularTechnique(payload).mraCe).toBe(false);
  });
});

describe("mriBrainVascularDraftState — save then reopen", () => {
  it("keeps a manual 'no contrast' refusal across the round trip", () => {
    const techniqueText = "3D TOF and gadolinium-enhanced MRA of the circle of Willis";
    const derived = deriveVascularTechniqueAcquired({ techniqueText });
    const session = markVascularTechniqueManual(
      withDerivedVascularTechnique(defaultVascularTechnique(), derived),
      "mraCe",
      false,
    );

    const saved = vascularTechniquePayload(session);
    const column = { careVascularTechnique: saved };
    const reopened = extractCareVascularTechnique(column)!;

    expect(reopened.manual.mraCe).toBe(false);
    // The gate reads the merge, so the reopened report is still as conservative as
    // the one the radiologist signed off.
    expect(resolveVascularTechnique(reopened).mraCe).toBe(false);
    // A re-derivation on the reopened study must not resurrect the contrast answer.
    const refolded = withDerivedVascularTechnique(reopened, derived);
    expect(resolveVascularTechnique(refolded).mraCe).toBe(false);
    expect(resolveVascularTechnique(refolded).mraTof).toBe(true);
  });

  it("round-trips the designation note", () => {
    const session = defaultVascularTechnique();
    session.manual.otherManual = true;
    session.designationNote = "arterial spin labelling";
    const reopened = extractCareVascularTechnique({
      careVascularTechnique: vascularTechniquePayload(session),
    });
    expect(reopened!.designationNote).toBe("arterial spin labelling");
    expect(reopened!.manual.otherManual).toBe(true);
  });

  it("does not resurrect a gate from a corrupted column", () => {
    const reopened = extractCareVascularTechnique({
      careVascularTechnique: { acquired: { timeResolved: "true" } },
    });
    expect(reopened).not.toBeNull();
    expect(resolveVascularTechnique(reopened).timeResolved).toBe(false);
  });
});

describe("mriBrainVascularDraftState — the store slice", () => {
  it("marks the draft dirty only for a stated answer, not for a fold", () => {
    useWorkspace.setState({
      vascularTechnique: defaultVascularTechnique(),
      isDirty: false,
    });
    useWorkspace.getState().setVascularTechnique(
      withDerivedVascularTechnique(
        defaultVascularTechnique(),
        deriveVascularTechniqueAcquired({ techniqueText: "2D TOF" }),
      ),
    );
    expect(useWorkspace.getState().isDirty).toBe(false);

    useWorkspace.getState().setVascularTechniqueManual("sourceImages", false);
    expect(useWorkspace.getState().isDirty).toBe(true);
    expect(useWorkspace.getState().vascularTechnique.manual.sourceImages).toBe(false);

    useWorkspace.getState().setVascularTechniqueDesignation("  pc-vens  ");
    expect(useWorkspace.getState().vascularTechnique.designationNote).toBe("pc-vens");
    useWorkspace.getState().setVascularTechniqueDesignation("   ");
    expect(useWorkspace.getState().vascularTechnique.designationNote).toBeNull();

    useWorkspace.setState({ vascularTechnique: defaultVascularTechnique(), isDirty: false });
  });

  it("holds technique state only — never a second copy of the vascular observations (§3, §25)", () => {
    // §25 forbids parallel vascular state that can contradict the ledger. The store may
    // know what was ACQUIRED; what was FOUND lives only in appliedPathologyPatches, and
    // the panels write it through applyMacroBundle like every other brain input.
    const keys = Object.keys(useWorkspace.getState());
    const vascular = keys.filter((k) => /vascular|aneurysm|stenosis|thromb|moyamoya|nidus|sinus|mra|mrv/i.test(k));
    expect(vascular.sort()).toEqual(["setVascularTechnique", "setVascularTechniqueDesignation", "setVascularTechniqueManual", "vascularTechnique"].sort());
    expect(new Set(vascular).size).toBe(vascular.length);
  });
});
