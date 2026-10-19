/**
 * The withheld-normal half of the shared contradiction rule, on the journeys the
 * ruling names (owner directive 2026-10-19, "Quick Select reliability"):
 *
 *   D. A normal tile must not reintroduce a statement that contradicts an active
 *      abnormal observation.
 *   E. Deselecting restores appropriate normal wording.
 *   F. Manual edits remain protected.
 *   G. Undo and redo remain functional.
 *   C. Clicking compatible abnormalities in different orders produces clinically
 *      equivalent reports.
 *
 * The click-order census (quickSelectClickOrderCensus.test.ts) owns the pair-by-pair
 * page equality; this file owns the LEDGER journey: what a withheld normal leaves on
 * the ledger, what deselecting the abnormal puts back, what a manual edit survives,
 * and what undo/redo do. Oracles are the real store and the real shipped tiles.
 */
import { describe, expect, it } from "vitest";
import { useWorkspace } from "./zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES as TILES, type QuickSelectTile } from "./zai-workspace/quick-select-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { quickSelectTilePatch } from "./zai-workspace/quickSelectTileFixture";

const BRAIN_NORMAL = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;

type Tile = {
  label: string;
  sentence: string;
  impressionSentence?: string;
  anatomicalSection?: string;
  conflictGroup?: string;
  baselineReplaces?: string;
  scopeBodyPart?: string;
  scopeModality?: string;
  field?: string;
};

const TILES_BRAIN = (TILES as unknown as Tile[]).filter(
  (t) => t.scopeModality === "MR" && t.field === "findings" && /brain/i.test(t.scopeBodyPart ?? "BRAIN") && t.sentence,
);

function byLabel(label: string): Tile {
  const found = TILES_BRAIN.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped MRI Brain findings tile labelled ${label}`);
  return found;
}

function reset() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, lastPatchSnapshot: null, confirmOverwriteOpen: false,
    pendingPathologyPatch: null, appliedFormatReportTitle: null,
    reportingContext: buildReportingStudyContext({ modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto" }),
    reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [], voiceComposerObservations: [],
    patchUndoStack: [], patchRedoStack: [],
  });
}

function click(tile: Tile, i: number, side?: "left" | "right") {
  const sideText = side ? tile.sentence.replace(/\{side\}/gi, side) : tile.sentence;
  const unresolved = /\{side\}|\{severity\}|\{name\}/.test(sideText);
  if (unresolved && !side) throw new Error(`${tile.label} needs a side parameter`);
  const outcome = useWorkspace.getState().applyPathologyOverlay({
    incoming: { findings: sideText, impression: tile.impressionSentence },
    templates: { findings: sideText, impression: tile.impressionSentence },
    ownership: {
      anatomicalSection: tile.anatomicalSection,
      conflictGroup: tile.conflictGroup,
      baselineReplaces: tile.baselineReplaces,
    },
    source: "quick-select",
    id: `p${i}`,
    region: tile.scopeBodyPart,
    label: tile.label,
    findingsText: sideText,
    ...(side ? { side } : {}),
  });
  if (outcome !== "applied") throw new Error(`${tile.label} click was ${outcome}`);
}

const findings = () => useWorkspace.getState().findingsText;
const ledgerRows = () => useWorkspace.getState().appliedPathologyPatches;
const rowByConcept = (concept: string) =>
  ledgerRows().find((p) => p.observation?.concept === concept);
const printed = () => normalizeForDedupe(findings());
const has = (sentence: string) => printed().includes(normalizeForDedupe(sentence));

const NBP = byLabel("Normal brain parenchyma");
const EDEMA = byLabel("Cerebral edema");
const HC = byLabel("Hydrocephalus");
const NV = byLabel("Normal ventricles");
const SAH = byLabel("Subarachnoid hemorrhage");

const NBP_S1 = "Brain parenchyma shows normal signal intensity.";
const NBP_S2 = "No evidence of acute infarct, hemorrhage, or mass lesion.";
const NV_S1 = "Ventricular system and cisternal spaces are normal in size and configuration.";

describe("a normal tile clicked onto an abnormal page (withheld-normal regressions)", () => {
  it("withholds the contradicted sentence and records the retirement on the owning abnormal row", () => {
    reset();
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    click(EDEMA, 0);
    click(NBP, 1);
    // D — the contradicted normal never reaches the page; the uncontradicted half
    // of the same tile still prints; the abnormal stays.
    expect(has(NBP_S1)).toBe(false);
    expect(has(NBP_S2)).toBe(true);
    expect(has("Brain parenchyma shows diffuse edema with effacement of the cortical sulci and basal cisterns.")).toBe(true);
    // Both rows are live on the ledger; the normal's claim is recorded on the
    // abnormal's replacedBaseline — the record a deselect restores from.
    expect(rowByConcept("brain_parenchyma")).toBeTruthy();
    const edemaRow = rowByConcept("edema");
    expect(edemaRow?.replacedBaseline?.findings.map(normalizeForDedupe)).toContain(normalizeForDedupe(NBP_S1));
  });

  it("restores the normal when the abnormal is deselected, in both click orders (E)", () => {
    // A deselection is complete when the workspace's own recomposition has run —
    // in the live workspace that is the 700 ms Mode A pass over the remaining
    // ledger, so the test models the journey as the radiologist lives it: click,
    // click, deselect, recompose. Both click orders must end with the normal
    // sentence back on the page and the same clinical sentences overall (C).
    const sentencesOf = (t: string) => splitToSentences(t).map(normalizeForDedupe).filter(Boolean).sort();
    const journeys: [Tile, Tile][] = [[NBP, EDEMA], [EDEMA, NBP]];
    const finals: string[][] = [];
    for (const [first, second] of journeys) {
      reset();
      useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
      click(first, 0);
      click(second, 1);
      expect(has(NBP_S1), `${first.label}+${second.label}: the contradicted normal must be off the page while the edema is live`).toBe(false);
      useWorkspace.getState().removeObservation(rowByConcept("edema")!.id);
      useWorkspace.getState().generateProfessionalReport(
        useWorkspace.getState().reportingContext,
      );
      expect(
        has(NBP_S1),
        `${first.label}+${second.label}: after deselecting the edema and recomposing, the normal sentence is back`,
      ).toBe(true);
      finals.push(sentencesOf(findings()));
    }
    expect(finals[1]).toEqual(finals[0]);
  });

  it("keeps the ventricles pair symmetrical: the normal never evicts the hydrocephalus (D, both orders)", () => {
    // Abnormal first, normal second — the order that used to DELETE the finding.
    reset();
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    click(HC, 0);
    click(NV, 1);
    expect(has("The ventricular system is dilated, consistent with hydrocephalus.")).toBe(true);
    expect(has(NV_S1)).toBe(false);
    // The impression carries the hydrocephalus, and the normal ventricles' own
    // impression claim ("Ventricles and cisternal spaces are normal. No
    // hydrocephalus.") is withheld with it — no contradictory Conclusion.
    const impression = useWorkspace.getState().impressionText;
    expect(impression).toMatch(/Hydrocephalus\./);
    expect(impression).not.toMatch(/Ventricles and cisternal spaces are normal\./);
    // Normal first, abnormal second — unchanged shipped behaviour.
    reset();
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    click(NV, 0);
    click(HC, 1);
    expect(has("The ventricular system is dilated, consistent with hydrocephalus.")).toBe(true);
    expect(has(NV_S1)).toBe(false);
  });

  it("protects a manual edit and undo/redo across a withheld click (F, G)", () => {
    reset();
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    click(EDEMA, 0);
    // A manual sentence the radiologist typed.
    useWorkspace.getState().setField("findings", "Severe white matter oedema is noted by the reporting radiologist.", { source: "manual" });
    const beforeNormalClick = findings();
    expect(beforeNormalClick).toContain("Severe white matter oedema is noted by the reporting radiologist.");
    click(NBP, 1);
    const afterNormalClick = findings();
    // F — the manual sentence survives the withheld normal click untouched.
    expect(afterNormalClick).toContain("Severe white matter oedema is noted by the reporting radiologist.");
    // The withheld sentence still never printed.
    expect(has(NBP_S1)).toBe(false);
    // G — one undo returns the page to before the normal click (whole-report frame).
    useWorkspace.getState().undoLastPatch();
    expect(findings()).toBe(beforeNormalClick);
    useWorkspace.getState().redoLastPatch();
    expect(findings()).toBe(afterNormalClick);
  });

  it("keeps an uncontradicted normal tile exactly as it was (no over-reach)", () => {
    // The withholding only fires on a contradiction: with no abnormal on the page,
    // the normal tile prints its full claim, and its re-click is still a no-op.
    reset();
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    click(NBP, 0);
    expect(has(NBP_S1)).toBe(true);
    expect(has(NBP_S2)).toBe(true);
    const before = findings();
    const rowsBefore = ledgerRows().length;
    click(NBP, 1);
    expect(findings()).toBe(before);
    expect(ledgerRows().length).toBe(rowsBefore);
  });

  it("does not let an abnormal tile's normal clause be suppressed — the T1/T2 contract (regression fence)", () => {
    // Hydrocephalus carries "No midline shift." inside its own finding. Clicked
    // after a haemorrhage that asserts a midline shift, the clause must stay on
    // the page and be named — printed and warned, never silently deleted. This is
    // the fence that keeps the withholding scoped to DEDICATED normal claims.
    reset();
    useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
    // The shipped click route for a sided tile, as the strip performs it.
    const bgh = TILES.find((t) => t.label === "Basal ganglia hemorrhage") as unknown as QuickSelectTile;
    useWorkspace.getState().applyPathologyOverlay(
      quickSelectTilePatch(bgh, "findings", { side: "right" }),
    );
    click(HC, 1);
    expect(findings()).toMatch(/No midline shift\./);
    expect(useWorkspace.getState().ownershipReviewWarnings.some((w) => w.token === "midline")).toBe(true);
  });

  it("retires the SAH pair's denial in both orders and keeps the unowned sentence (C, D, I)", () => {
    // The Subarachnoid hemorrhage judge owns the infarct/haemorrhage/mass DENIAL
    // but not the parenchymal signal-intensity sentence, so the normal tile keeps
    // its unowned sentence in both orders and loses the denial in both orders —
    // the census pins the page equality; this pins the per-sentence behaviour and
    // the impression.
    for (const order of [[NBP, SAH], [SAH, NBP]] as [Tile, Tile][]) {
      reset();
      useWorkspace.getState().applyFormatById(BRAIN_NORMAL.id);
      click(order[0], 0);
      click(order[1], 1);
      expect(has("Acute subarachnoid hemorrhage — blood in the basal cisterns and sulci.")).toBe(true);
      expect(has(NBP_S2), `${order[0].label} then ${order[1].label}: contradicted denial printed`).toBe(false);
      // I — the impression carries the haemorrhage and no contradictory normal claim.
      const impression = useWorkspace.getState().impressionText;
      expect(impression).toMatch(/Acute subarachnoid hemorrhage\./);
      expect(impression).not.toMatch(/Normal MRI Brain/i);
    }
  });
});
