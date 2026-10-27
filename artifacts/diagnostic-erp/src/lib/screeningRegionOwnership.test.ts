/**
 * screeningRegionOwnership.test.ts — after the one-click normal, the abnormality the
 * radiologist records must take its region's normal out of the report.
 *
 * Whole-spine screening is the one examination where a single report carries three
 * regions' normals at once, so a recorded abnormality has to retire exactly one
 * sentence and leave the other fourteen alone. Both click orders are covered, because
 * they run through different code: press "Generate Professional Report" then click the
 * screening abnormality (the clinic's order), or click first and generate after.
 *
 * Two independent conditions had to hold for retirement to happen at all, and each is
 * mutated below to prove the gate can fail:
 *  - a screening row must carry the anatomical region it DESCRIBES ("Dorsal Spine"),
 *    because slot exclusivity is keyed region → concept → level → laterality
 *    (`observationSlot.ts:355`). A row stamped with the examination region ("Whole
 *    Spine") never pairs with the scaffold normal, so nothing was contradicted;
 *  - `applyMacroBundle` must not adopt a `role: "baseline"` sibling's id. Doing so
 *    hides the target from `applyPathologyOverlay`, whose lookup filters out its own
 *    id, and the insert path then drops the ledger row without retiring its prose.
 * The earlier verdict in this file — that re-stamping the region was not the fix — was
 * wrong: it was reached from one still-failing test whose real blocker was the second
 * condition. Fixing the first alone leaves the defect; the probes that settle it are in
 * the mutation log for this PR.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import { materializeFormatBaseline } from "@/lib/zai-workspace/fullReportBaseline";
import { MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME } from "@/lib/zai-workspace/baselines/mriWholeSpineScreeningNormal";
import { SCREENING_LIMITATION_TEXT } from "@/lib/zai-workspace/baselines/screeningLimitation";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { resolveScreeningRoles } from "@/lib/mriSpineScreeningRoles";
import { SCREENING_SCHEMAS } from "@/lib/mriSpineScreeningSchemas";
import {
  SCREENING_BUNDLE_PREFIX,
  SCREENING_LIMITATION_BUNDLE_ID,
  defaultScreeningState,
  screeningLedgerRegion,
  screeningPresetSelections,
  type ScreeningState,
} from "@/lib/mriSpineScreening";
import type { SpineScreeningRegion } from "@/lib/mriSpineScreeningSchema";

const STUDY_REGION = "Whole Spine";
const DORSAL_VERTEBRAL_NORMAL = "Dorsal spine: Vertebral bodies show normal height and marrow signal on screening images.";
const DORSAL_PRESET_VERTEBRAL = "Dorsal vertebral bodies show normal height and marrow signal on screening images.";
const DORSAL_ALIGNMENT_NORMAL = "Dorsal spine: Alignment is within normal limits on screening sequences.";
const CERVICAL_VERTEBRAL_NORMAL = "Cervical spine: Vertebral bodies show normal height and marrow signal on screening images.";
const LS_VERTEBRAL_NORMAL = "Lumbar spine: Vertebral bodies show normal height and marrow signal on screening images.";
const COMPRESSION_PHRASE = "Compression deformity";

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
const limitationCount = (t: string) => (t.match(/SCREENING STUDIES ARE LIMITED/gi) ?? []).length;

const wholeSpineFormat = DEFAULT_REPORT_FORMATS.find((f) => f.name === MRI_WHOLE_SPINE_SCREENING_NORMAL_NAME);

/** Open the billed whole-spine study the way the worklist does: empty report, matched roles. */
function openWholeSpineStudy() {
  const ctx = buildReportingStudyContext({
    modality: "MR",
    studyDescription: "MRI WHOLE SPINE SCREENING",
    regions: [STUDY_REGION],
    source: "auto",
  });
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    screening: defaultScreeningState(), impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [], confirmOverwriteOpen: false,
    pendingPathologyPatch: null, pendingFormatIds: [], mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false, isFinalized: false, isDirty: false,
    reportingContext: ctx, reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
  });
  useWorkspace.getState().replaceScreeningRoles(resolveScreeningRoles({ name: "MRI WHOLE SPINE SCREENING" }).roles);
  return ctx;
}

/** The clinic's order: open the study, press Generate, and the approved normal is on the page. */
function oneClickNormalWholeSpine() {
  const generated = useWorkspace.getState().generateProfessionalReport(openWholeSpineStudy());
  if (generated.status !== "generated") throw new Error(`one-click normal refused: ${JSON.stringify(generated)}`);
}

/** Exactly what the panel does on a click: set the region, then sync the ledger. */
function setRegion(region: SpineScreeningRegion, patch: Partial<ScreeningState[SpineScreeningRegion]>) {
  const ws = useWorkspace.getState();
  ws.setScreeningRegion(region, patch);
  const state = {
    ...useWorkspace.getState().screening,
    [region]: { ...useWorkspace.getState().screening[region], ...patch },
  };
  ws.syncScreeningLedger({ state, changed: region, ledgerRegion: STUDY_REGION });
  useWorkspace.setState({ screening: state });
}

const findings = () => useWorkspace.getState().findingsText;

describe("recording an abnormality over the one-click whole-spine normal", () => {
  beforeEach(() => oneClickNormalWholeSpine());

  it("starts from the full approved normal (denominator)", () => {
    // Every "was retired" assertion below is only meaningful against this.
    const text = findings();
    expect(text).toContain(DORSAL_VERTEBRAL_NORMAL);
    expect(text).toContain(CERVICAL_VERTEBRAL_NORMAL);
    expect(text).toContain(LS_VERTEBRAL_NORMAL);
    expect(limitationCount(text)).toBe(1);
    expect(lines(text).length).toBeGreaterThanOrEqual(15);
  });

  it("takes the contradicted normal out of Findings and puts the abnormality in", () => {
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
    });
    const after = findings();
    const ls = lines(after);
    expect(after).toContain(COMPRESSION_PHRASE);
    expect(after).not.toContain(DORSAL_VERTEBRAL_NORMAL);
    // It took the normal's PLACE. A report that moved the abnormality to the end of
    // Findings would read as a statement about no region in particular.
    const at = ls.findIndex((l) => l.includes(COMPRESSION_PHRASE));
    expect(at).toBeGreaterThan(0);
    expect(ls[at - 1]).toContain(DORSAL_ALIGNMENT_NORMAL);
    expect(ls[at + 1]).toMatch(/^Dorsal spine: No significant disc/i);
  });

  it("leaves every other region's normal exactly as it was", () => {
    // Widening retirement is the dangerous half of this fix: a dorsal click may not
    // delete statements about the cervical or lumbar spine.
    const before = lines(findings());
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
    });
    const after = lines(findings());
    expect(after).toContain(CERVICAL_VERTEBRAL_NORMAL);
    expect(after).toContain(LS_VERTEBRAL_NORMAL);
    expect(after).toContain(DORSAL_ALIGNMENT_NORMAL);
    expect(after.length).toBeGreaterThanOrEqual(before.length - 1);
  });

  it("keeps the report-level limitation exactly once", () => {
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
    });
    setRegion("cervical", {
      role: "primary-dedicated",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.cervical),
    });
    expect(limitationCount(findings())).toBe(1);
    expect(findings()).toContain(SCREENING_LIMITATION_TEXT);
  });

  it("keeps each screening row in its own bundle and naming a region", () => {
    // #940's guarantee, re-asserted after the one-click normal has run: withdrawal
    // works by bundle id, so a row that lost its bundle can never be taken out.
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
    });
    const rows = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && p.observation?.bundleId?.startsWith(SCREENING_BUNDLE_PREFIX));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((p) => Boolean(p.observation?.bundleId))).toBe(true);
    expect(rows.every((p) => Boolean(p.observation?.region))).toBe(true);
    expect(rows.some((p) => p.observation?.bundleId === SCREENING_LIMITATION_BUNDLE_ID)).toBe(true);
  });

  it("withdraws the region's sentences when the radiologist turns it off", () => {
    // The other half of the guarantee: what the panel deletes must actually leave
    // Findings. Recorded here because the browser run found sentences surviving a
    // withdrawal, and a ledger row that reports "removed" while its sentence prints
    // is the defect the radiologist sees on paper.
    // The ★ preset states the same normal in the clinic's own wording, which takes
    // the scaffold sentence's slot — so what is on the page here is the preset's
    // line, not the manifest's. Both spellings must be gone after the withdrawal.
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: screeningPresetSelections(SCREENING_SCHEMAS.dorsal),
    });
    expect(findings()).toContain(DORSAL_PRESET_VERTEBRAL);
    setRegion("dorsal", { role: "absent", performed: false, selections: {} });
    const after = findings();
    // Withdrawing the screening module must not leave the sentence it wrote behind,
    // and must not leave two normals for the same anatomy: the examination's own
    // approved normal comes back, exactly once, from `replacedBaseline`.
    expect(after).not.toContain(DORSAL_PRESET_VERTEBRAL);
    expect(after).toContain(DORSAL_VERTEBRAL_NORMAL);
    expect(lines(after).filter((l) => /^Dorsal.*vertebral bodies show normal height/i.test(l))).toHaveLength(1);
    expect(after).not.toMatch(/^Dorsal alignment is within normal limits/im);
    expect(limitationCount(after)).toBeLessThanOrEqual(1);
  });

  it("stamps each region's rows with a region the examination's own normal uses", () => {
    // Drift guard. The plan and the baseline manifest live in different files, and the
    // slot gate compares `region` first — so any divergence between the two silently
    // disables retirement again, which is how this defect survived a green CI.
    const baseline = materializeFormatBaseline(wholeSpineFormat!, STUDY_REGION);
    const baselineRegions = new Set(baseline.map((b) => (b.observation.region ?? "").trim()).filter(Boolean));
    expect([...baselineRegions].sort()).toEqual(["Cervical Spine", "Dorsal Spine", "LS Spine", "Whole Spine"]);

    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
    });
    const rows = useWorkspace.getState().appliedPathologyPatches
      .filter((p) => !p.stale && p.observation?.bundleId?.startsWith(SCREENING_BUNDLE_PREFIX));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const bundleId = String(row.observation?.bundleId);
      const region = (row.observation?.region ?? "").trim();
      if (bundleId === SCREENING_LIMITATION_BUNDLE_ID) {
        // The limitation is about the examination, and its baseline counterpart
        // carries no per-entry region — it must stay on the study region.
        expect(region).toBe(STUDY_REGION);
        continue;
      }
      expect(baselineRegions, `row of ${bundleId} is stamped "${region}"`).toContain(region);
      expect(region).toBe(screeningLedgerRegion(bundleId.slice(SCREENING_BUNDLE_PREFIX.length + 1) as SpineScreeningRegion));
    }
  });
});

describe("recording an abnormality before the one-click normal is generated", () => {
  // The other click order runs through different code: the abnormality is already in
  // the ledger when the baseline materialises around it. Measured at the previous
  // commit this order printed the dorsal vertebral normal beside the compression
  // deformity as well, so one fix had to cover both rather than a second one.
  it("generates around the recorded abnormality without re-adding its normal", () => {
    const ctx = openWholeSpineStudy();
    setRegion("dorsal", {
      role: "accompanying-screening",
      performed: true,
      selections: { bodies_marrow: [{ optionId: "compression_deformity" }] },
    });
    expect(findings()).toContain(COMPRESSION_PHRASE);

    const generated = useWorkspace.getState().generateProfessionalReport(ctx);
    expect(generated.status).toBe("generated");

    const after = findings();
    expect(after).toContain(COMPRESSION_PHRASE);
    expect(lines(after).filter((l) => l.includes(COMPRESSION_PHRASE))).toHaveLength(1);
    expect(after).not.toContain(DORSAL_VERTEBRAL_NORMAL);
    // Everything the click said nothing about is still stated.
    expect(after).toContain(CERVICAL_VERTEBRAL_NORMAL);
    expect(after).toContain(LS_VERTEBRAL_NORMAL);
    expect(after).toContain(DORSAL_ALIGNMENT_NORMAL);
    expect(limitationCount(after)).toBe(1);
  });
});
