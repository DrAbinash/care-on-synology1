/**
 * dorsoLumbarStandardNormal.test.ts — the Dorso-Lumbar examination now opens ONE
 * complete normal, and owns every sentence of it.
 *
 * What the audit measured on this head (main + PR-A), through the shipped code:
 *   `resolveNormalBootstrapFormat({ ctx: <MRI Dorso-Lumbar Spine>, formats })`
 *   answered `no-match | no complete-normal format for this region in the library`
 *   while the same study's Quick Select strip offered 52 findings boxes. Brain,
 *   Cervical, Dorsal, LS Spine, Knee, Shoulder and Pelvis all answered `apply`.
 *   Dorso-Lumbar is the only booked MRI spine region `canonicalContentRegion` does
 *   not fold onto another (`lib/reportingStudyContext.ts:91`), so no other
 *   examination's normal could stand in for it — which is also why using the LS
 *   normal for it would have been the scope error PR-A's coverage rule forbids.
 *
 * Oracles, in the order the claims are made:
 *   - the resolver itself, over `DEFAULT_REPORT_FORMATS`;
 *   - the real store — `generateProfessionalReport` opens the study, and the
 *     sentences are read back with the product's own `splitToSentences`;
 *   - `validateBaselineManifest`, the same gate the sign path's materialize runs;
 *   - the shipped contract `DL_NORMAL_BY_CONCEPT`, whose whole value set must be
 *     sentences this normal actually renders — a concept pointing at a sentence
 *     the baseline never printed is a click that retires nothing.
 *
 * The duplication column is the owner's instruction, not a style preference: a
 * dorso-lumbar report is one examination crossing the junction, so pasting the
 * dorsal normal above the lumbar one would print two alignment lines, two marrow
 * lines and two canal lines in one report (the library says this itself,
 * `mriDorsoLumbarLibrary.ts:11-16`).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import {
  resolveNormalBootstrapFormat,
  isNormalBootstrapCandidate,
} from "./normalBootstrap";
import { useWorkspace } from "./store";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import { splitToSentences } from "@/lib/reportFieldMerge";
import { validateBaselineManifest } from "./fullReportBaseline";
import { DEFAULT_QUICK_SELECT_TILES } from "./quick-select-tiles.data";
import {
  DL_NORMAL_BY_CONCEPT,
  dorsoLumbarTileById,
  withDorsoLumbarBaselineContract,
} from "@/lib/mriDorsoLumbarSubMasters";
import { defaultDorsoLumbarState } from "@/lib/mriDorsoLumbarCoverage";
import { unfilledPlaceholders } from "@workspace/report-quality";
import {
  MRI_DORSO_LUMBAR_STANDARD_NORMAL_NAME,
  MRI_DORSO_LUMBAR_STANDARD_NORMAL_MANIFEST,
} from "./baselines/mriDorsoLumbarStandardNormal";

const DL_CTX = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI DORSO-LUMBAR SPINE",
  regions: ["Dorso-Lumbar Spine"], source: "billed",
});

const findingsRows = MRI_DORSO_LUMBAR_STANDARD_NORMAL_MANIFEST.observations
  .filter((o) => o.field === "findings");
const rendered = findingsRows.map((o) => o.renderedText);

function openDorsoLumbar() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "",
    clinicalHistoryText: "", fieldProvenance: {}, appliedPathologyPatches: [],
    impressionNeedsRefresh: false, impressionOrderFrozen: false,
    lastPatchSnapshot: null, patchUndoStack: [],
    confirmOverwriteOpen: false, pendingPathologyPatch: null, pendingFormatIds: [],
    mergePreviewOpen: false,
    appliedFormatReportTitle: null, appliedFormatName: null, startingCanvasBaseline: null,
    canalApProvenance: {}, dorsalCanalForced: false,
    reportingContext: DL_CTX(), reportFormats: DEFAULT_REPORT_FORMATS, selectedFormatIds: [],
    isFinalized: false, isDirty: false,
  } as never);
  return useWorkspace.getState().generateProfessionalReport(DL_CTX());
}

const reportFindings = () => useWorkspace.getState().findingsText;
const reportImpression = () => useWorkspace.getState().impressionText;
const countOf = (sentence: string) =>
  splitToSentences(reportFindings()).filter((s) => s.trim() === sentence.trim()).length;

describe("the Dorso-Lumbar study now resolves a complete normal", () => {
  it("the resolver applies the Dorso-Lumbar Standard Normal instead of answering no-match", () => {
    const decision = resolveNormalBootstrapFormat({ ctx: DL_CTX(), formats: DEFAULT_REPORT_FORMATS });
    expect(decision.status, JSON.stringify(decision)).toBe("apply");
    if (decision.status === "apply") {
      expect(decision.format.name).toBe(MRI_DORSO_LUMBAR_STANDARD_NORMAL_NAME);
      expect(decision.format.bodyPart).toBe("Dorso-Lumbar Spine");
    }
  });

  it("the row is a complete normal by the product's own test, and its manifest materializes", () => {
    const format = DEFAULT_REPORT_FORMATS.find(
      (f) => f.name === MRI_DORSO_LUMBAR_STANDARD_NORMAL_NAME,
    );
    expect(format, "the owned normal is not in the shipped format library").toBeTruthy();
    expect(isNormalBootstrapCandidate(format!)).toBe(true);
    const validation = validateBaselineManifest(format!, "Dorso-Lumbar Spine");
    expect(validation).toEqual({ ok: true, missing: [], duplicateSlots: [] });
  });

  it("every normal sentence is owned, so a later abnormality has a row to retire", () => {
    const result = openDorsoLumbar();
    expect(result.status).toBe("generated");
    // The ledger rows are the fact; `baselineConcepts` counts only what THIS call
    // added, and a scaffold that replaced a previous normal on the way in is already
    // known by the time it is counted. So the claim is read off the patches
    // themselves — one owned row per rendered sentence, none missing.
    const revision = MRI_DORSO_LUMBAR_STANDARD_NORMAL_MANIFEST.revision;
    const ownedIds = new Set(
      useWorkspace.getState().appliedPathologyPatches
        .filter((p) => p.id.startsWith(`baseline:${revision}:`))
        .map((p) => p.id.slice(`baseline:${revision}:`.length)),
    );
    const missing = findingsRows.filter((o) => !ownedIds.has(o.id)).map((o) => o.id);
    expect(missing, "normal sentences on the page with no owning ledger row").toEqual([]);
    expect(ownedIds.size).toBeGreaterThanOrEqual(findingsRows.length);
    console.log(`  owned Dorso-Lumbar normal rows: ${ownedIds.size}, concepts added by this press: ${result.baselineConcepts}`);
  });
});

describe("one examination, not two reports pasted together", () => {
  it("each of the seven statements appears exactly once on the page", () => {
    openDorsoLumbar();
    // Non-vacuity: the normal is the junction-spanning set, not a placeholder list.
    expect(findingsRows.length).toBeGreaterThanOrEqual(7);
    for (const sentence of rendered) {
      expect(countOf(sentence), `not rendered once: ${sentence}`).toBe(1);
    }
  });

  it("no two rows state the same anatomy twice", () => {
    const offenders: string[] = [];
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        if (rendered[i] === rendered[j]) offenders.push(`rows ${i} and ${j} are identical`);
      }
    }
    expect(offenders).toEqual([]);
    // The specific duplication the owner ruled out: one alignment line and one
    // marrow line, which is what a dorsal-plus-lumbar concatenation would print as
    // two of each.
    const mentions = (word: RegExp) => rendered.filter((t) => word.test(t)).length;
    expect(mentions(/alignment/i)).toBe(1);
    expect(mentions(/vertebral body heights/i)).toBe(1);
    expect(mentions(/canal/i)).toBe(1);
  });

  it("the impression names the examination and asserts nothing the findings do not", () => {
    openDorsoLumbar();
    expect(reportImpression()).toContain("dorso-lumbar spine");
    // No cauda-equina claim: the library has no normal cauda sentence, so the
    // baseline invents none (the same rule mriDorsoLumbarSubMasters.test.ts:341 pins).
    expect(reportImpression()).not.toMatch(/cauda/i);
  });

  it("nothing in the normal ships an unfilled slot", () => {
    // A bracket or blank in a starting normal is the F2 sign-door / Q106 class.
    const offenders: string[] = [];
    for (const text of [...rendered, MRI_DORSO_LUMBAR_STANDARD_NORMAL_MANIFEST.observations
      .find((o) => o.field === "impression")!.renderedText]) {
      const left = unfilledPlaceholders(text);
      if (left.length > 0) offenders.push(`${text.slice(0, 40)} :: ${left.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the shipped Dorso-Lumbar contract and this baseline agree", () => {
  it("every concept the contract maps lands on a sentence this normal renders", () => {
    // DL_NORMAL_BY_CONCEPT is what gives a Dorso-Lumbar tile the normal sentence it
    // supersedes. A value missing from the baseline is a click that adds its lesion
    // beside the normal it falsifies — the P0 shape, one region later.
    const offenders: string[] = [];
    for (const [concept, sentence] of Object.entries(DL_NORMAL_BY_CONCEPT)) {
      if (!rendered.includes(sentence)) offenders.push(`${concept} :: ${sentence}`);
    }
    expect(offenders).toEqual([]);
    expect(Object.keys(DL_NORMAL_BY_CONCEPT).length).toBeGreaterThan(20);
  });

  it("the baseline renders nothing the contract does not recognise as normal", () => {
    const allowed = new Set(Object.values(DL_NORMAL_BY_CONCEPT));
    const offenders = rendered.filter((t) => !allowed.has(t));
    expect(offenders).toEqual([]);
  });
});

describe("the region's own palette retires the sentences this baseline prints", () => {
  it("a Dorso-Lumbar canal lesion claims one of the seven, and adds its own prose", () => {
    // `withDorsoLumbarBaselineContract` is the shipped mechanism that stamps an
    // abnormal atom with the normal it contradicts. Against this baseline the stamp
    // is now real: before it, the claim pointed at a sentence nothing had rendered.
    const ctx = {
      level: "T9-T10",
      state: defaultDorsoLumbarState({ superior: "T8-T9", inferior: "L5-S1" }),
      domain: "thoracic" as const,
    };
    const atoms = dorsoLumbarTileById("dln-canal-severe")!.tile.atoms(ctx as never);
    const [contracted] = withDorsoLumbarBaselineContract(atoms);
    expect(contracted.baselineReplaces).toBeTruthy();
    expect(rendered).toContain(contracted.baselineReplaces!);
    expect(contracted.findings).not.toContain(contracted.baselineReplaces!);
  });

  it("the strip on a Dorso-Lumbar study still offers the widened segment boxes", () => {
    // Measured, not asserted as sufficient: those boxes name their own segment
    // baselines, so a strip click on this region adds its lesion without retiring a
    // Dorso-Lumbar normal sentence. Naming it here keeps the gap on the record
    // instead of letting the resolver test above read as if it closed it.
    const widened = DEFAULT_QUICK_SELECT_TILES.filter(
      (t) => t.field === "findings" && t.scopeModality === "MR"
        && (t.scopeBodyPart === "Dorsal Spine" || t.scopeBodyPart === "LS Spine"),
    );
    const claimingDorsoLumbar = widened.filter((t) => rendered.includes(t.baselineReplaces ?? ""));
    expect(widened.length).toBeGreaterThanOrEqual(50);
    console.log(
      `  widened segment boxes: ${widened.length}, of them claiming a Dorso-Lumbar normal sentence: ${claimingDorsoLumbar.length}`,
    );
  });
});
