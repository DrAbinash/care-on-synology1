/**
 * posteriorElementsContext.test.ts — the MRI Dorsal half of `posterior_elements`.
 *
 * The registry contract (one canonical concept, the unioned XR + MR alias list,
 * `impressionworthyAbnormal: true`, and the fact that a `baseline` observation on
 * an impression-worthy concept never suppresses the system normal) is shipped
 * behaviour and is asserted in `conceptCanon/impressionworthyRole.test.ts`. This
 * file only proves what the Dorsal catalog does with it, which needs the dorsal
 * tiles and therefore cannot live in the registry test.
 *
 * Both directions are measured, not assumed: a dorsal posterior-element finding
 * must hold "Normal study." away, and the dorsal normal posterior-elements line —
 * same concept, `role: "baseline"` — must not.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildDorsalTileBundle } from "@/lib/mriDorsalSubMasters";
import { defaultDorsalNumbering } from "@/lib/mriDorsalNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";

function resetLedger() {
  useWorkspace.setState({
    appliedPathologyPatches: [],
    patchUndoStack: [],
    lastPatchSnapshot: null,
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    fieldProvenance: {},
    impressionOrderFrozen: false,
  });
}

function allSequences() {
  const all = defaultSpineSequences();
  for (const key of Object.keys(all) as Array<keyof typeof all>) all[key] = true;
  return all;
}

const dorsalCtx = {
  level: "T8-T9",
  numbering: {
    ...defaultDorsalNumbering(),
    coverage: "thoracolumbar",
    mode: "localizer-confirmed",
    wholeSpineLocalizer: true,
  },
  sequences: allSequences(),
  region: "Dorsal Spine",
  vertebra: "T8",
  side: "left" as const,
};

describe("posterior_elements — MRI Dorsal reporting context", () => {
  beforeEach(() => resetLedger());

  it("a posterior-element finding suppresses the system normal impression", () => {
    for (const tileId of ["tr-posterior-element-fracture", "tm-pedicle", "cg-posterior-defect"]) {
      resetLedger();
      useWorkspace.getState().applyMacroBundle(buildDorsalTileBundle(tileId, dorsalCtx));
      useWorkspace.getState().seedSystemNormalImpression();
      const st = useWorkspace.getState();
      expect(st.impressionText, `${tileId} must not sit behind a normal impression`).not.toContain("Normal study.");
      expect(st.findingsText, `${tileId} should still have written its sentence`).toContain("T8");
    }
  });

  it("the dorsal normal posterior-elements line is a baseline and stays behind the normal", () => {
    useWorkspace.getState().applyMacroBundle(buildDorsalTileBundle("dr-posterior-normal", dorsalCtx));
    useWorkspace.getState().seedSystemNormalImpression();
    const st = useWorkspace.getState();
    expect(st.impressionText).toContain("Normal study.");
    const posterior = st.appliedPathologyPatches.find((p) => p.observation?.concept === "posterior_elements");
    expect(posterior?.observation?.role).toBe("baseline");
  });
});
