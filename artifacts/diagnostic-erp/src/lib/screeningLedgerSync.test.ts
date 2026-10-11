/**
 * screeningLedgerSync.test.ts — rebuilding a screening region must WRITE what it
 * rebuilds, not just delete what it replaced.
 *
 * `syncScreeningLedger` removes the bundles the plan no longer holds and then
 * re-applies the changed region. The re-apply is guarded by "is this bundle still
 * live?", and until that question was asked against the live store it was answered
 * from a snapshot taken before the removals — which still listed the bundle that
 * had just been removed. So every guard passed, the re-apply was skipped, and the
 * region's sentences were simply gone. Measured in the reporting workspace: the
 * one-click normal wrote five dorsal sentences, then one tile click on "Compression
 * deformity" collapsed the Findings box to 56 characters — the limitation sentence
 * alone. The tile showed a check mark, the ledger held the row, the report said
 * nothing about it, and no dialog appeared anywhere on the screen.
 *
 * The existing screening suite could not see this because every case there applies
 * a plan to a region that has never been applied before, so the removal pass has
 * nothing to remove and the skipped re-apply is invisible.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import {
  SCREENING_BUNDLE_PREFIX,
  SCREENING_LIMITATION_BUNDLE_ID,
  defaultScreeningState,
  screeningPresetSelections,
  type ScreeningState,
} from "@/lib/mriSpineScreening";
import type { SpineScreeningRegion } from "@/lib/mriSpineScreeningSchema";

const LIMITATION = "SCREENING STUDIES ARE LIMITED PLANAR & LIMITED SEQUENCE.";
const ALIGNMENT_NORMAL = "Dorsal alignment is within normal limits on screening sequences.";
const HAND_WRITTEN = "Alignment is maintained; a mild left thoracic curvature is present clinically.";
const limitationCount = (t: string) => (t.match(/SCREENING STUDIES ARE LIMITED/gi) ?? []).length;
const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

function openBlankStudy() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    screening: defaultScreeningState(), impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false, isFinalized: false, isDirty: false,
  });
}

/** Exactly what the panel does on a click: set the region, then sync the ledger. */
function setRegion(
  region: SpineScreeningRegion,
  patch: Partial<ScreeningState[SpineScreeningRegion]>,
  ledgerRegion = "Whole Spine",
) {
  const ws = useWorkspace.getState();
  ws.setScreeningRegion(region, patch);
  const state = { ...useWorkspace.getState().screening, [region]: { ...useWorkspace.getState().screening[region], ...patch } };
  ws.syncScreeningLedger({ state, changed: region, ledgerRegion });
  useWorkspace.setState({ screening: state });
  return state;
}

describe("rebuilding a screening region", () => {
  beforeEach(() => openBlankStudy());

  it("has a real normal scaffold to rebuild over", () => {
    // Denominator: without this the rebuild assertions below are vacuously true.
    const state = setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    expect(Object.keys(state.dorsal.selections).length).toBeGreaterThanOrEqual(4);
    expect(lines(useWorkspace.getState().findingsText).length).toBeGreaterThanOrEqual(4);
  });

  it("writes the abnormality it was clicked for instead of only deleting the normal", () => {
    const preset = setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    const before = useWorkspace.getState().findingsText;
    expect(before).toContain("Dorsal vertebral bodies show normal height and marrow signal");

    const selections = { ...preset.dorsal.selections, bodies_marrow: [{ optionId: "compression_deformity" }] };
    setRegion("dorsal", { selections });
    const after = useWorkspace.getState().findingsText;

    // The finding the radiologist clicked is on the page…
    expect(after).toMatch(/Compression deformity/i);
    // …the normal it replaces is not…
    expect(after).not.toContain("Dorsal vertebral bodies show normal height and marrow signal");
    // …and every other screening sentence the region already had is untouched.
    expect(after).toContain("Dorsal alignment is within normal limits on screening sequences.");
    expect(after).toContain("No significant disc herniation is identified on screening sequences.");
    expect(limitationCount(after)).toBe(1);
    // The report must not be shorter than the single limitation sentence it kept.
    expect(after.length).toBeGreaterThan(before.length - 120);
    // The rows carry the study tab the panel was mounted for, not a default: the
    // plan's region is what routes a multi-study report's sub-sections.
    const rows = useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale && p.observation?.bundleId?.startsWith(SCREENING_BUNDLE_PREFIX));
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((p) => p.observation?.region === "Whole Spine")).toBe(true);
  });

  it("keeps the limitation exactly once across two rebuilds of the same region", () => {
    const preset = setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    const afterScoliosis = setRegion("dorsal", {
      selections: { ...preset.dorsal.selections, alignment: [{ optionId: "scoliosis" }] },
    });
    setRegion("dorsal", {
      selections: { ...afterScoliosis.dorsal.selections, discs: [{ optionId: "focal_protrusion" }] },
    });
    const text = useWorkspace.getState().findingsText;
    expect(limitationCount(text)).toBe(1);
    expect(text).toMatch(/Scoliosis/i);
    expect(text).toMatch(/Focal protrusion/i);
    expect(text).toContain(LIMITATION);
  });

  it("leaves another region's sentences alone when one region is rebuilt", () => {
    setRegion("cervical", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.cervical),
    });
    const cervicalAfter = useWorkspace.getState().findingsText;
    expect(lines(cervicalAfter).length).toBeGreaterThanOrEqual(4);

    const preset = setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    setRegion("dorsal", { selections: { ...preset.dorsal.selections, bodies_marrow: [{ optionId: "compression_deformity" }] } });

    const after = useWorkspace.getState().findingsText;
    // Cervical keeps writing about cervical; nothing a dorsal click deletes.
    for (const line of lines(cervicalAfter).filter((l) => !l.includes(LIMITATION))) {
      expect(after, `dorsal rebuild deleted: ${line}`).toContain(line);
    }
  });

  it("keeps prose the radiologist typed over a screening sentence, and still writes the tile they clicked", () => {
    const preset = setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    useWorkspace.getState().setField(
      "findings",
      useWorkspace.getState().findingsText.replace(ALIGNMENT_NORMAL, HAND_WRITTEN),
      "manual",
    );
    expect(useWorkspace.getState().findingsText).toContain(HAND_WRITTEN);

    setRegion("dorsal", { selections: { ...preset.dorsal.selections, discs: [{ optionId: "focal_protrusion" }] } });
    const after = useWorkspace.getState().findingsText;
    // The sentence they rewrote is still on the page…
    expect(after).toContain(HAND_WRITTEN);
    // …and the tile they clicked reached the report instead of being swallowed
    // because the region looked "already applied".
    expect(after).toMatch(/Focal protrusion/i);
    expect(limitationCount(after)).toBe(1);
  });

  it("withdraws the region's sentences and the limitation when it is switched off", () => {
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    expect(useWorkspace.getState().findingsText).toContain(LIMITATION);
    setRegion("dorsal", { role: "absent", performed: false, selections: {} });
    const text = useWorkspace.getState().findingsText;
    expect(text).not.toContain(LIMITATION);
    expect(text).not.toMatch(/on screening sequences/i);
    const liveBundles = new Set(
      useWorkspace.getState().appliedPathologyPatches.filter((p) => !p.stale).map((p) => p.observation?.bundleId),
    );
    expect(liveBundles.has(SCREENING_LIMITATION_BUNDLE_ID)).toBe(false);
  });

  it("keeps every screening row in its bundle after the professional report is generated", () => {
    // `generateProfessionalReport` re-submits every radiologist row through
    // `reapplyInputFromPatch`. A row that comes back without its bundle identity is
    // invisible to every bundle operation, because a bundle deselect walks the ledger
    // by `bundleId` — so the module the radiologist switches off after that press can
    // never be withdrawn again.
    useWorkspace.setState({ reportFormats: DEFAULT_REPORT_FORMATS });
    setRegion("ls", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.ls),
    }, "LS Spine");
    const before = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => (p.observation?.bundleId ?? "").startsWith(SCREENING_BUNDLE_PREFIX));
    expect(before.length).toBeGreaterThan(4);

    const outcome = useWorkspace.getState().generateProfessionalReport({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine"],
      protocolName: null,
      studyDescription: "MRI LS Spine",
    });
    expect(outcome.status).toBe("generated");

    const after = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => (p.observation?.bundleId ?? "").startsWith(SCREENING_BUNDLE_PREFIX) && !p.stale);
    expect(after.map((p) => p.observation?.bundleId)).toEqual(before.map((p) => p.observation?.bundleId));
  });
});
