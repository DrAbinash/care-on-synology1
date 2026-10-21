/**
 * Phase 3, item D — the Impression update preview: "explicitly ask the
 * radiologist to accept the derived impression update or keep their manual
 * edit, with a preview."
 *
 * The stale banner used to carry ONE button: "Refresh from Finding", a
 * one-click overwrite of a Conclusion a doctor wrote by hand, with no preview
 * and no way to say "I have read it and it stands". The flow is now:
 *
 *   Preview update  →  read-only derivation shown  →  Accept update | Keep my edit
 *
 * `previewImpressionFromLedger` is the read-only half of
 * `refreshImpressionFromLedger` (same patches, same leftover scan, same
 * `refreshImpressionFromObservations`) and `markImpressionReviewed` is the
 * existing "it stands" record. These tests pin the three properties that make
 * the dialog honest at the real store boundary, with the same controlled-
 * synthetic harness the merged journey uses:
 *
 *   1. the preview is EXACTLY what Accept writes — byte for byte;
 *   2. the preview writes nothing — not text, not provenance, not dirty;
 *   3. Keep my edit disarms the banner until Findings change again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { useWorkspace } from "./store";
import { emptyClinicalState } from "./clinicalStateReset";
import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "./quick-select-library";
import { quickSelectTilePatch } from "./quickSelectTileFixture";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { emptyViewerMeasurementsState } from "@/lib/structuredViewerMeasurements";
import { defaultLumbarNumbering } from "@/lib/mriSpineNumbering";
import { defaultSpineSequences } from "@/lib/mriSpineSequences";
import { defaultScreeningState } from "@/lib/mriSpineScreening";
import { defaultVascularTechnique } from "@/lib/mriBrainVascularTechnique";
import { impressionProvenanceIsRadiologistManual } from "@/lib/impressionProvenance";

const STUDY = "syn-preview-impression-1";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();
const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function openSyntheticStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: lsCtx(),
    studies: [{ id: STUDY, patient: { name: "SYNTHETIC PATIENT", sex: "M" }, modality: "MR" }],
    activeStudyId: STUDY,
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openSyntheticStudy();
});

/**
 * The exact state the stale banner serves: a complete normal composed, the
 * radiologist replaced the Conclusion with their own words, then an
 * abnormality landed in Findings. The banner's showStale is
 * `impressionNeedsRefresh && impressionManuallyEdited`.
 */
function manualStaleFlow() {
  expect(S().composeInstantReport(lsCtx(), false).action).toBe("compose");
  // An abnormality first (no manual text in its way, so it applies cleanly and
  // the Conclusion follows it), THEN the radiologist rewrites the Conclusion by
  // hand, THEN the Findings change in a way the Conclusion did not follow —
  // exactly the sequence that leaves a manual Conclusion stale. No dialog is
  // involved: every step is the workspace's own free-form typing door.
  expect(S().applyPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"))).toBe("applied");
  const manualImpression = "Chronic facet degenerative change, typed by the radiologist.";
  S().setField("impression", manualImpression, { source: "manual" });
  expect(impressionProvenanceIsRadiologistManual(S().fieldProvenance.impression)).toBe(true);
  S().setField("findings", `${S().findingsText}
Small incidental Tarlov cyst at S2, typed by the radiologist.`, { source: "manual" });
  return { manualImpression };
}

describe("previewImpressionFromLedger — the read-only half of Refresh", () => {
  it("previews EXACTLY what Accept writes — byte for byte", () => {
    const { manualImpression } = manualStaleFlow();
    // The banner's condition holds: manual Conclusion, stale against Findings.
    expect(S().impressionNeedsRefresh).toBe(true);
    expect(impressionProvenanceIsRadiologistManual(S().fieldProvenance.impression)).toBe(true);

    const preview = S().previewImpressionFromLedger();
    expect(preview.refused).toBeNull();
    expect(preview.next.trim()).not.toBe("");
    // The preview is a real derivation, not the manual text echoed back.
    expect(preview.next).not.toBe(manualImpression);

    // Accept runs the pressed Refresh — and the page gets exactly the preview.
    S().refreshImpressionFromLedger();
    expect(S().impressionText).toBe(preview.next);
    // The stale flag cleared with the write.
    expect(S().impressionNeedsRefresh).toBe(false);
  });

  it("writes nothing: text, provenance, ledger, dirty flag all untouched", () => {
    const { manualImpression } = manualStaleFlow();
    const before = {
      findings: S().findingsText,
      impression: S().impressionText,
      provenance: JSON.stringify(S().fieldProvenance),
      rows: S().appliedPathologyPatches.length,
      isDirty: S().isDirty,
      needsRefresh: S().impressionNeedsRefresh,
    };
    const preview = S().previewImpressionFromLedger();
    expect(preview.next).not.toBe("");
    expect(S().findingsText).toBe(before.findings);
    expect(S().impressionText).toBe(before.impression);
    expect(S().impressionText).toBe(manualImpression);
    expect(JSON.stringify(S().fieldProvenance)).toBe(before.provenance);
    expect(S().appliedPathologyPatches.length).toBe(before.rows);
    expect(S().isDirty).toBe(before.isDirty);
    expect(S().impressionNeedsRefresh).toBe(before.needsRefresh);
  });

  it("Keep my edit disarms the banner, and a new Findings change re-arms it", () => {
    manualStaleFlow();
    expect(S().impressionNeedsRefresh).toBe(true);
    // The banner's Keep button is the existing "reviewed" record — no text write.
    const impressionAtKeep = S().impressionText;
    S().markImpressionReviewed();
    expect(S().impressionText).toBe(impressionAtKeep);
    expect(S().impressionNeedsRefresh).toBe(false);

    // Another abnormality changes Findings — the decision was recorded against
    // the clinical content, so exactly a new clinical change re-arms it.
    expect(S().applyPathologyOverlay(quickSelectTilePatch(tile("Ligamentum flavum hypertrophy"), "findings")))
      .toBe("applied");
    expect(S().impressionNeedsRefresh).toBe(true);
  });

  it("refuses on a signed report and promises nothing", () => {
    manualStaleFlow();
    S().startFinalize();
    S().completeFinalize();
    const signed = S().previewImpressionFromLedger();
    expect(signed.refused).toBe("signed");
    expect(signed.next).toBe("");
  });
});

/** No browser in this container — the three-door wiring is pinned by source. */
describe("the stale banner wiring (source contract)", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

  it("the banner offers Preview / Accept / Keep, through the store's own actions", () => {
    const banner = read("../../components/radiology/reporting-canvas/ContradictionBanner.tsx");
    expect(banner).toMatch(/preview-impression-update/);
    expect(banner).toMatch(/refresh-impression-from-findings/);
    expect(banner).toMatch(/keep-manual-impression/);
    expect(banner).toMatch(/impression-refresh-preview/);

    const canvas = read("../../components/radiology/workspace/ReportCanvas.tsx");
    expect(canvas).toMatch(/previewImpressionFromLedger/);
    expect(canvas).toMatch(/markImpressionReviewed/);
  });
});
