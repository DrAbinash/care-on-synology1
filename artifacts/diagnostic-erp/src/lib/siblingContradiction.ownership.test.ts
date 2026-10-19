/**
 * Two Quick Select boxes that disagree about one anatomy.
 *
 * The shipped sibling detector was written to warn about leftover text and to
 * never delete it. But `detectUnownedSiblingConflictsForLedger` handed it every
 * patch's rendered findings flattened together as the "owned" set, so a sentence
 * belonging to ANY observation was skipped — including one belonging to a
 * different observation than the one asserting the finding. Tile-against-tile
 * disagreement was therefore invisible by construction, and the direct-call
 * contract in observationPersistence.hardening.test.ts (which passes only the
 * asserting patch's own text) was never what the ledger path did.
 *
 * Measured over all 528 pairs of the 33 shipped MRI Brain findings tiles, with
 * sides supplied so no click is refused: the ownership change alone produces 280
 * warnings of which 276 are one location word — "intracranial", asserted by
 * "Flow voids in major intracranial vessels are preserved." and denied by
 * "No intracranial hemorrhage is seen.", two sentences that agree perfectly.
 * SIBLING_STOP already holds anatomical words that are not findings ("white",
 * "matter", "space", "system", "lesion", "signal"), so "intracranial" joins the
 * list on the list's own rule. With it, the residual over those 528 pairs is 4
 * warnings; T9 walks all 1056 ordered compositions and finds five distinct, every
 * one a normal box standing beside an abnormal box that negates it.
 *
 * Oracles are the real store, the real shipped tiles and the real detector. No
 * fixtures. Nothing here deletes a sentence the radiologist clicked as part of a
 * finding; since 2026-10-19 a DEDICATED normal tile whose sentence a live abnormal
 * owns is withheld rather than printed (the owner's order-independence ruling —
 * see quickSelectClickOrderCensus.test.ts), which T7 now pins from the other side.
 */
import { describe, expect, it } from "vitest";
import {
  detectUnownedSiblingConflictsForLedger,
  UNOWNED_SIBLING_HINT,
} from "./observationLedger";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";
import { useWorkspace } from "./zai-workspace/store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";

const ctx = buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI Brain", regions: ["Brain"], source: "auto",
});

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS,
    selectedFormatIds: [], isFinalized: false, isDirty: false,
    ownershipReviewWarnings: [],
  });
  useWorkspace.getState().generateProfessionalReport(ctx);
}

/** One click, as the strip performs it, with the side the radiologist chose. */
function click(label: string, side: "left" | "right" = "left") {
  const tile = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!tile) throw new Error(`${label} is not in the catalogue`);
  const params = (tile.properties ?? "").includes("side") ? { side } : {};
  const outcome = useWorkspace.getState().applyPathologyOverlay(
    quickSelectTilePatch(tile, "findings", params as never),
  );
  if (outcome !== "applied") throw new Error(`${label} was refused: ${outcome}`);
}

function build(clicks: Array<[string, ("left" | "right")?]>) {
  reset();
  for (const [label, side] of clicks) click(label, side);
  const s = useWorkspace.getState();
  return { findings: s.findingsText, warnings: s.ownershipReviewWarnings, patches: s.appliedPathologyPatches };
}

const warned = (r: ReturnType<typeof build>) => r.warnings.map((w) => `${w.token}: ${w.sentence}`);

describe("two boxes that disagree about one anatomy", () => {
  it("T1 haemorrhage then hydrocephalus: the denial the second box printed is named", () => {
    // The haemorrhage box renders "Mass effect with midline shift of ___ mm."; the
    // hydrocephalus box renders "...No midline shift." Clicked in this order both
    // reach the page, and the report contradicts itself in one Findings block.
    const r = build([["Basal ganglia hemorrhage", "right"], ["Hydrocephalus"]]);
    expect(r.findings).toMatch(/Mass effect with midline shift/);
    expect(r.findings).toMatch(/No midline shift\./);
    expect(warned(r).some((w) => /^midline: No midline shift\.$/.test(w))).toBe(true);
    expect(r.warnings[0]?.hint).toBe(UNOWNED_SIBLING_HINT);
  });

  it("T2 warns without deleting — the sentence the radiologist may still want is still there", () => {
    const r = build([["Basal ganglia hemorrhage", "right"], ["Hydrocephalus"]]);
    expect(r.findings.split(/\n+/).filter((l) => /no midline shift/i.test(l))).toHaveLength(1);
  });

  it("T3 the same two boxes in the other order retire the denial and stay silent", () => {
    // Order-independence is the point of the warning, not of the retirement: when
    // the hydrocephalus box lands first, the haemorrhage box retires its denial
    // and there is nothing left to disagree with.
    const r = build([["Hydrocephalus"], ["Basal ganglia hemorrhage", "right"]]);
    expect(r.findings).toMatch(/Mass effect with midline shift/);
    expect(r.findings).not.toMatch(/No midline shift\./);
    expect(warned(r).some((w) => w.startsWith("midline:"))).toBe(false);
  });

  it("T4 a location word is not a finding: the flow-void normal and the haemorrhage normal agree", () => {
    // 276 of the 280 warnings the ownership change alone produced were this one
    // pair of sentences. Both are correct and both belong to the scaffold.
    const r = build([["Cerebral edema"]]);
    expect(r.findings).toMatch(/Flow voids in major intracranial vessels are preserved/);
    expect(r.warnings).toHaveLength(0);
  });

  it("T5 ledger-level: a denial owned by another observation is a sibling, one's own is not", () => {
    const asserting = { lastRendered: { findings: "Mass effect with midline shift of 6 mm." }, protected: false };
    const denying = { lastRendered: { findings: "The ventricular system is dilated. No midline shift." }, protected: false };
    const findings = `${asserting.lastRendered.findings}\n${denying.lastRendered.findings}`;
    const hits = detectUnownedSiblingConflictsForLedger({ findings, patches: [asserting, denying] });
    expect(hits.map((h) => h.sentence)).toContain("No midline shift.");
    // A patch never contradicts itself: its own rendered sentences are out of scope.
    const selfOnly = detectUnownedSiblingConflictsForLedger({
      findings: asserting.lastRendered.findings!,
      patches: [asserting],
    });
    expect(selfOnly).toHaveLength(0);
  });

  it("T6 the shipped Fazekas true positive survives the ownership change", () => {
    const r = build([["Fazekas 1"], ["Fazekas 3"]]);
    expect(warned(r).some((w) => /^confluent: No confluent lesions\.$/.test(w))).toBe(true);
  });

  it("T7 a normal-CT box clicked after an asserted haemorrhage is retired, not printed", () => {
    // 2026-10-19 — this test pinned the OLD policy: a dedicated normal tile clicked
    // beside an abnormal that contradicts it stays on the page and is named on the
    // review banner. The owner's ruling ("a normal tile must not reintroduce a
    // statement that contradicts an active abnormal observation") supersedes it for
    // dedicated normal tiles: the abnormal's judge — the same
    // `prepareNormalSupersession` rule the other click order already uses — now
    // withholds the sentence, so the contradiction never reaches the page and there
    // is nothing left to warn about. The sentence is retired, not deleted: the
    // ownership record on the abnormal row is what a deselect restores from.
    // Abnormal tiles that carry a normal clause INSIDE their own finding keep the
    // printed-and-named contract — that is T1/T2, and it is unchanged.
    const r = build([["Subarachnoid hemorrhage"], ["Normal CT brain"]]);
    expect(r.findings).not.toMatch(/No evidence of acute hemorrhage or mass lesion\./);
    expect(r.findings).toMatch(/Acute subarachnoid hemorrhage/);
    expect(r.warnings, `nothing on the page contradicts any more:\n${warned(r).join("\n")}`).toHaveLength(0);
  });

  it("T8 the seven vetted whole-report cases stay silent; only the Fazekas replacement warns", () => {
    // brainWholeReportCases.test.ts ships these as clinically correct artefacts.
    // A detector that alarms on them is the defect, not the report.
    const scripts: Array<[string, Array<[string, ("left" | "right")?]>]> = [
      ["A", [["Basal ganglia hemorrhage", "left"], ["Cerebral edema"]]],
      ["B", [["Acute infarct (DWI)", "right"]]],
      ["C", [["Fazekas 3"], ["Cerebral atrophy"]]],
      ["D", [["Subdural hematoma", "left"]]],
      ["E", [["Mass lesion", "right"], ["Cerebral edema"], ["Midline shift", "left"]]],
      ["F", [["Microbleeds"], ["Fazekas 2"]]],
      ["G", [["Chronic infarct", "right"]]],
    ];
    for (const [name, clicks] of scripts) {
      const r = build(clicks);
      expect(r.warnings, `case ${name} warned: ${warned(r).join(" | ")}`).toHaveLength(0);
    }
    const h = build([["Fazekas 1"], ["Fazekas 3"]]);
    expect(h.warnings.length).toBeGreaterThan(0);
  });

  it("T9 no pair of the 33 shipped brain boxes produces a location-word warning", () => {
    // The whole-catalogue control, run as a test so a future box that renders a
    // new anatomical adjective into a normal sentence fails here rather than in
    // front of a radiologist. Both click orders, because retirement is
    // order-dependent: the midline contradiction only reaches the page when the
    // haemorrhage box is clicked first. 1056 compositions, sides supplied.
    //
    // Each composition rebuilds the report through the real store, so this is the
    // expensive test in the file: 4.9s alone, 12.9s with all 458 ERP files running
    // in parallel. The default 5s timeout made it fail under that load while
    // passing in isolation, so it carries an explicit one — the repo's existing
    // convention for a long-running case.
    const tiles = DEFAULT_QUICK_SELECT_TILES.filter(
      (t) => t.field === "findings" && (t.scopeBodyPart ?? "") === "Brain",
    );
    expect(tiles.length).toBe(33);
    const noise: string[] = [];
    for (let i = 0; i < tiles.length; i++) {
      for (let j = 0; j < tiles.length; j++) {
        if (i === j) continue;
        const r = build([[tiles[i]!.label], [tiles[j]!.label]]);
        for (const w of r.warnings) noise.push(`${tiles[i]!.label} + ${tiles[j]!.label} -> ${w.token}: ${w.sentence}`);
      }
    }
    const distinct = [...new Set(noise.map((n) => n.split(" -> ")[1]))].sort();
    // Every one of these is a normal clause travelling INSIDE an abnormal tile's own
    // finding — the T1/T2 class, where the radiologist clicked the finding and the
    // clause is printed and named, never silently deleted. The three dedicated-normal
    // classes this list used to carry ("Normal brain parenchyma" beside the
    // haemorrhage boxes, beside the infarct boxes, and "Normal CT brain" beside the
    // haemorrhage boxes) were retired on 2026-10-19 by the withheld-normal half of
    // the shared contradiction rule: a dedicated normal tile clicked after an
    // abnormal no longer reintroduces the sentence that abnormal owns, so the
    // contradiction — and its warning — never reaches the page.
    expect(distinct, `unexpected warnings:\n${noise.join("\n")}`).toEqual([
      "confluent: No confluent lesions.",
      "midline: No midline shift.",
    ]);
  }, 60_000);
});
