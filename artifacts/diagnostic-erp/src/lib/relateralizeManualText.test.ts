/**
 * Z.AI audit 2026-11-13, item 24 — "Never overwrite manually authored clinical
 * text during synchronization".
 *
 * The side chip is a synchronizer: `useWorkspaceClinicalUi.tsx:2580` calls
 * `relateralizePatches(quickSide)` from an effect, so choosing Left rewrites
 * every Quick Select sentence on the page that was rendered at Right. That is
 * the right behaviour for wording the box still owns, and it is the one writer
 * in the workspace that reaches clinical text without ever asking who wrote it.
 * Every other writer asks: `applyPathologyPatch` collects the radiologist's
 * sentences into `manualKept` through `isProtectedManualSentence`
 * (`pathologyPatch.ts:224`), the automatic Impression refresh answers
 * `"held-protected"` (`store.ts:4539`), `observationLedger` skips protected
 * contributions at `:190, :804, :1049, :1433`, and `removeObservation` refuses a
 * row whose sentence he has taken over outright — `"preserved-manual"` — rather
 * than half-applying. `relateralizePatches` consulted none of them: it did
 * `fieldText.replace(previousRenderedText, newRenderedText)` on the whole field
 * and then stamped `lastRendered` and `observation.laterality` on the ledger row
 * whatever the replace had done.
 *
 * Measured on `ba207aa62` before this change, from the shipped catalogue through
 * the one click builder (`clickedTilePatch`) and the real typing path
 * (`setField`, which is what the Findings editor calls):
 *
 *   Click "Orbital cellulitis" at Right, type a lead-in in front of the box's
 *   sentence — Findings becomes "Comparison with the prior study: Preseptal and
 *   postseptal inflammatory change in the right orbit, consistent with orbital
 *   cellulitis. Resolved." — and the store labels that very sentence
 *   ["manual","quick-findings"] on the sentence key. Flip the chip to Left and
 *   the sentence in the middle of the radiologist's own typed sentence became
 *   "…the left orbit…". `isProtectedManualSentence` returns true for it, and
 *   nothing asked.
 *
 *   In the same flip, a row whose wording he had rewritten so that it no longer
 *   contains the box's sentence at all ("Mild preseptal inflammatory change in
 *   the right orbit, …") was left alone on the page — and still had
 *   `lastRendered` set to "…the left orbit…" and `laterality: "left"` stamped on
 *   its ledger row: the ledger recording a sentence that never existed, which is
 *   the failure `quickSelectLaterality.contract.test.ts:84` already names for the
 *   empty-side case ("a ledger that disagrees with the report").
 *
 * The fix is the rule the rest of the workspace already uses, applied per row:
 * if the wording a row owns sits inside a sentence the radiologist authored, the
 * row does not move at all — no section of it is rewritten and its ledger entry
 * keeps the side the page actually states. Refusing the whole row rather than
 * half of it is `removeObservation`'s precedent, and it is what keeps Findings
 * and Impression saying the same side. The radiologist is told, in the same
 * "edited clinical text was kept" shape the deselection path already uses.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { manualOwnedSentenceAt } from "./pathologyPatch";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_QUICK_SELECT_TILES as TILES } from "./zai-workspace/quick-select-tiles.data";
import { clickedTilePatch, tileRowId } from "./zai-workspace/quickSelectTileFixture";
import {
  quickFindingPatch,
  type ClinicalQuickFindingBox,
} from "./zai-workspace/quickSelectTilePayload";
import { useWorkspace } from "./zai-workspace/store";
import type { Side } from "./sideSwap";

const ORBIT = TILES.find((t) => t.label === "Orbital cellulitis")!;
const ORBIT_RIGHT = "Preseptal and postseptal inflammatory change in the right orbit, consistent with orbital cellulitis.";
const ORBIT_LEFT = "Preseptal and postseptal inflammatory change in the left orbit, consistent with orbital cellulitis.";

function resetBrain(): void {
  useWorkspace.setState({
    findingsText: "", impressionText: "", techniqueText: "", recommendationText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, patchUndoStack: [],
    patchRedoStack: [], confirmOverwriteOpen: false, pendingPathologyPatch: null,
    isFinalized: false, isDirty: false,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
    }),
  });
}

/** One real click on the shipped box, at the side the chip is showing. */
function click(side: Side): string {
  const verdict = useWorkspace.getState().applyPathologyOverlay(clickedTilePatch(ORBIT, undefined, { side }));
  if (verdict === "pending") useWorkspace.getState().confirmOverwriteAndApply();
  expect(verdict === "applied" || verdict === "pending", `the click was ${verdict}`).toBe(true);
  return tileRowId(ORBIT, side);
}

/** What the radiologist's typing does to the row, read back from the ledger. */
function row(id: string) {
  return useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === id);
}

describe("the side chip leaves a sentence the radiologist authored alone", () => {
  beforeEach(() => resetBrain());

  it("holds the row when its wording sits inside the radiologist's own sentence", () => {
    const id = click("right");
    // Typed through the editor's own action, which is what stamps provenance.
    const typed = `Comparison with the prior study: ${ORBIT_RIGHT} Resolved.`;
    useWorkspace.getState().setField("findings", typed);
    expect(
      useWorkspace.getState().fieldProvenance.findings![
        "comparison with the prior study preseptal and postseptal inflammatory change in the right orbit consistent with orbital cellulitis"
      ],
      "precondition: typing the lead-in makes the sentence the radiologist's own",
    ).toEqual(["manual", "quick-findings"]);

    const held = useWorkspace.getState().relateralizePatches("left");

    expect(
      useWorkspace.getState().findingsText,
      "a chip click rewrote the middle of the sentence he typed",
    ).toBe(typed);
    expect(held, "the row that was held is named").toContain(id);
  });

  it("holds the whole row, so Impression does not move away from Findings", () => {
    const id = click("right");
    useWorkspace.getState().setField("findings", `Comparison with the prior study: ${ORBIT_RIGHT} Resolved.`);
    expect(useWorkspace.getState().impressionText).toBe("Right orbital cellulitis.");

    useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(s.impressionText, "half-applying split the two sections by side").toBe("Right orbital cellulitis.");
    expect(row(id)?.lastRendered.impression, "the ledger claims a wording the page never got").toBe("Right orbital cellulitis.");
    expect(row(id)?.observation?.laterality).toBe("right");
  });

  it("holds every section of the row, not only the one that was typed over", () => {
    const id = click("right");
    // His Conclusion, with the box's Impression sentence inside a sentence of his
    // own making; Findings left as the box wrote it.
    useWorkspace.getState().setField("impression", `In my view: ${useWorkspace.getState().impressionText} Correlate clinically.`);
    const held = useWorkspace.getState().relateralizePatches("left");
    const s = useWorkspace.getState();
    expect(held).toContain(id);
    expect(s.impressionText).toBe("In my view: Right orbital cellulitis. Correlate clinically.");
    expect(s.findingsText, "the row was held, so its Findings wording is still the box's own").toBe(ORBIT_RIGHT);
  });

  it("leaves the untouched box to move exactly as it always did", () => {
    // The guard is not a refusal to relateralise. This is the case the side chip
    // exists for, and it must keep working section for section.
    const id = click("right");
    useWorkspace.setState({ impressionText: "Right orbital cellulitis.", techniqueText: "", recommendationText: "" });

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held).toEqual([]);
    expect(s.findingsText).toBe(ORBIT_LEFT);
    expect(s.impressionText).toBe("Left orbital cellulitis.");
    expect(row(id)?.lastRendered.findings).toBe(ORBIT_LEFT);
    expect(row(id)?.observation?.laterality).toBe("left");
  });

  it("does not hold a manual sentence that is a sentence of its own", () => {
    const id = click("right");
    // His prose beside the box's, not around it: two sentences, two owners.
    useWorkspace.getState().setField("findings", `The right lateral rectus is enlarged. ${ORBIT_RIGHT}`);

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held, "his own sentence is not the row's site").toEqual([]);
    expect(s.findingsText).toBe(`The right lateral rectus is enlarged. ${ORBIT_LEFT}`);
  });

  it("does not hold a manual sentence appended after the box's own", () => {
    const id = click("right");
    useWorkspace.getState().setField("findings", `${ORBIT_RIGHT} The right lateral wall is intact.`);

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held).toEqual([]);
    expect(s.findingsText).toBe(`${ORBIT_LEFT} The right lateral wall is intact.`);
  });

  it("holds one row without freezing its neighbour", () => {
    const heldId = click("right");
    useWorkspace.getState().setField("findings", `Comparison with the prior study: ${ORBIT_RIGHT} Resolved.`);
    // A second box, clicked after his edit and left as the box wrote it.
    const CHRONIC = TILES.find((t) => t.label === "Chronic infarct")!;
    const moved = tileRowId(CHRONIC, "right");
    const verdict = useWorkspace.getState().applyPathologyOverlay(clickedTilePatch(CHRONIC, undefined, { side: "right" }));
    if (verdict === "pending") useWorkspace.getState().confirmOverwriteAndApply();
    expect(useWorkspace.getState().findingsText).toContain("Area of encephalomalacia with gliosis in the right hemisphere");

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held).toEqual([heldId]);
    expect(s.findingsText).toContain("Area of encephalomalacia with gliosis in the left hemisphere");
    expect(s.findingsText).toContain(ORBIT_RIGHT);
    expect(row(moved)?.observation?.laterality).toBe("left");
    expect(row(heldId)?.observation?.laterality).toBe("right");
  });

  it("writes nothing at all when every row is held", () => {
    const id = click("right");
    useWorkspace.getState().setField("findings", `Comparison with the prior study: ${ORBIT_RIGHT} Resolved.`);
    useWorkspace.setState({ isDirty: false });

    const before = useWorkspace.getState();
    const held = useWorkspace.getState().relateralizePatches("left");
    const s = useWorkspace.getState();

    expect(held).toEqual([id]);
    expect(s.findingsText).toBe(before.findingsText);
    expect(s.impressionText).toBe(before.impressionText);
    expect(s.appliedPathologyPatches).toBe(before.appliedPathologyPatches);
    expect(s.isDirty, "a flip that changed nothing must not make a clean draft dirty").toBe(false);
  });

  it("keeps a rewrote-outright row out of the hold, as it has always been", () => {
    // His wording no longer contains the box's sentence anywhere, so there is no
    // site to protect and nothing was rewritten. The row still re-renders and the
    // signing advisory (statedLateralityConflict) is left to name the disagreement.
    const id = click("right");
    useWorkspace.getState().setField("findings", "Mild preseptal inflammatory change in the right orbit, consistent with orbital cellulitis.");

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held).toEqual([]);
    expect(s.findingsText).toBe("Mild preseptal inflammatory change in the right orbit, consistent with orbital cellulitis.");
    expect(s.impressionText).toBe("Left orbital cellulitis.");
    expect(row(id)?.lastRendered.findings).toBe(ORBIT_LEFT);
  });
});

describe("the same rule over the two sections no shipped box writes sided", () => {
  /**
   * A box authored with `{side}` in all four sentences. Not one of the 175
   * shipped tiles is written that way — their Technique and Recommendation prose
   * is side-blind — but the columns allow it and the code expects it:
   * `quickFindingPatch` declares `supportsLaterality` from all four sentences
   * precisely because "a box carrying `{side}` only in its recommendation would
   * be asked for a side it was never allowed to use — and would refuse forever".
   * `relateralizePatches` re-renders all four. A guard written for Findings and
   * Impression alone would leave the other two legs exactly as unguarded as they
   * were, so both are driven here, through the one builder a click uses.
   */
  const FOUR = {
    findings: "Preseptal and postseptal inflammatory change in the {side} orbit, consistent with orbital cellulitis.",
    impression: "{side} orbital cellulitis.",
    technique: "Targeted coronal STIR images of the {side} orbit were acquired.",
    recommendation: "Clinical review of the {side} orbit in two weeks.",
  };
  const filled = (f: keyof typeof FOUR, side: Side) => {
    const t = FOUR[f].replace(/\{side\}/g, side);
    // `fillTemplate` capitalizes the rendered sentence (abnormalityEngine.ts:88),
    // which is why an Impression authored as "{side} orbital cellulitis." reaches
    // the page as "Right orbital cellulitis." The guard compares that rendered
    // wording against itself, so the tests have to render it the same way.
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  function fourBox(): ClinicalQuickFindingBox {
    return {
      id: 900141,
      label: "Orbital cellulitis, four sections",
      studyType: "Brain",
      field: "findings",
      findingText: FOUR.findings,
      impressionText: FOUR.impression,
      techniqueText: FOUR.technique,
      recommendationText: FOUR.recommendation,
      concept: "orbital",
      anatomicalSection: "orbit",
      conflictGroup: "orbital",
      properties: "side",
    };
  }

  function clickFour(side: Side): string {
    const patch = quickFindingPatch(fourBox(), { region: "Brain" }, { side });
    const verdict = useWorkspace.getState().applyPathologyOverlay(patch);
    if (verdict === "pending") useWorkspace.getState().confirmOverwriteAndApply();
    expect(verdict === "applied" || verdict === "pending", `the click was ${verdict}`).toBe(true);
    return patch.id;
  }

  beforeEach(() => resetBrain());

  it("moves every section a box contributes", () => {
    clickFour("right");
    expect(useWorkspace.getState().techniqueText).toContain(filled("technique", "right"));
    expect(useWorkspace.getState().recommendationText).toContain(filled("recommendation", "right"));

    expect(useWorkspace.getState().relateralizePatches("left")).toEqual([]);

    const s = useWorkspace.getState();
    expect(s.findingsText).toContain(filled("findings", "left"));
    expect(s.impressionText).toContain(filled("impression", "left"));
    expect(s.techniqueText, "the Technique leg went unguarded, and unwalked").toContain(filled("technique", "left"));
    expect(s.recommendationText, "the Recommendation leg likewise").toContain(filled("recommendation", "left"));
    expect(s.techniqueText).not.toContain("right orbit");
    expect(s.recommendationText).not.toContain("right orbit");
  });

  it("holds the whole row when his sentence wraps the box's Technique line", () => {
    const id = clickFour("right");
    useWorkspace.getState().setField(
      "technique",
      `Under general anaesthesia: ${filled("technique", "right")} Additional sequences were obtained.`,
    );

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held).toEqual([id]);
    expect(s.techniqueText).toBe(`Under general anaesthesia: ${filled("technique", "right")} Additional sequences were obtained.`);
    expect(s.findingsText).toContain(filled("findings", "right"));
    expect(s.impressionText).toBe(filled("impression", "right"));
    expect(s.recommendationText).toContain(filled("recommendation", "right"));
  });

  it("holds the whole row when his sentence wraps the box's Recommendation line", () => {
    const id = clickFour("right");
    const site = `Given the prior study: ${filled("recommendation", "right")} Prefer non-contrast sequences.`;
    useWorkspace.getState().setField("recommendation", site);

    const held = useWorkspace.getState().relateralizePatches("left");

    const s = useWorkspace.getState();
    expect(held).toEqual([id]);
    expect(s.recommendationText).toBe(site);
    expect(s.findingsText).toContain(filled("findings", "right"));
  });
});

describe("the site rule itself", () => {
  const OWNED = "preseptal and postseptal inflammatory change in the right orbit consistent with orbital cellulitis";

  it("names the sentence the owned wording sits inside", () => {
    const site = `Comparison with the prior study: ${ORBIT_RIGHT} Resolved.`;
    const sentence = `Comparison with the prior study: ${ORBIT_RIGHT}`;
    expect(manualOwnedSentenceAt(site, ORBIT_RIGHT, { [OWNED]: ["manual"] as never })).toBe("");
    expect(manualOwnedSentenceAt(site, ORBIT_RIGHT, {
      "comparison with the prior study preseptal and postseptal inflammatory change in the right orbit consistent with orbital cellulitis": ["manual", "quick-findings"] as never,
    })).toBe(sentence);
  });

  it("says nothing when the wording sits in a sentence the box still owns", () => {
    expect(manualOwnedSentenceAt(`${ORBIT_RIGHT} Resolved.`, ORBIT_RIGHT, { [OWNED]: ["quick-select"] as never })).toBe("");
  });

  it("counts dictated wording as the radiologist's, the same predicate the overlay uses", () => {
    const site = `On the current study, ${ORBIT_RIGHT}`;
    expect(manualOwnedSentenceAt(site, ORBIT_RIGHT, {
      "on the current study preseptal and postseptal inflammatory change in the right orbit consistent with orbital cellulitis": ["radiologist-voice", "quick-select"] as never,
    })).toBe(site);
  });

  it("says nothing when the box's wording is not on the page", () => {
    expect(manualOwnedSentenceAt("A different report entirely.", ORBIT_RIGHT, { [OWNED]: ["manual"] as never })).toBe("");
    expect(manualOwnedSentenceAt("", ORBIT_RIGHT, { [OWNED]: ["manual"] as never })).toBe("");
    expect(manualOwnedSentenceAt(ORBIT_RIGHT, "", { [OWNED]: ["manual"] as never })).toBe("");
  });

  it("says nothing when the wording spans two of his sentences it cannot be located in", () => {
    // `previous` with its own sentence inside it is not a substring of any one
    // sentence; the box wrote both, so the box still owns both.
    const two = `${ORBIT_RIGHT} The lateral rectus is normal.`;
    expect(manualOwnedSentenceAt(`${two} Resolved.`, two, { [OWNED]: ["manual"] as never })).toBe("");
  });
});

describe("the side effect tells the radiologist what it did not do", () => {
  it("reads the held rows and surfaces them", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "radiology-workspace", "useWorkspaceClinicalUi.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const at = src.indexOf("if (!quickSide) return;");
    expect(at, "the empty-side guard is the effect's own; the relateralise leg follows it").toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("}, [quickSide]);", at));
    expect(block).toContain("relateralizePatches(quickSide)");
    // Pinning the order, not a spelling: the held rows have to be read from the
    // call's own result, and the radiologist has to be told in the same leg that
    // moved the chip — not from a second effect that would fire on its own clock.
    expect(block).toMatch(/const held[A-Za-z]* = useWorkspace\.getState\(\)\.relateralizePatches\(quickSide\)/);
    expect(block).toMatch(/if \(held[A-Za-z]*\.length\) \{/);
    expect(block).toContain("toast({");
    expect(block.indexOf("toast({")).toBeLessThan(block.indexOf("lastQuickRenderedRef"));
  });

  it("returns the held row ids from the action", () => {
    const store = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "zai-workspace", "store.ts"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const decl = store.slice(store.indexOf("  relateralizePatches: (side: Side) =>"), store.indexOf("\n", store.indexOf("  relateralizePatches: (side: Side) =>")));
    expect(decl).toContain("string[]");
    expect(decl).not.toContain("=> void");
  });
});
