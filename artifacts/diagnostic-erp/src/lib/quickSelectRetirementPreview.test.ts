/**
 * Phase 3, item C — "clearly indicate which normal statement is replaced by the
 * selected abnormality."
 *
 * The preview action is the read-only half of `applyPathologyOverlay`: same
 * observation builder, same refusal guards, same falsifies oracle, same
 * same-slot plan, same system-normal yield. These tests pin the PROMISE the
 * strip's hover makes against what the CLICK actually does, on the real store,
 * with the same controlled-synthetic harness the merged integration journey
 * (#1096) uses — a preview that names a different sentence than the one the
 * click retires is a dialog that lies on the way to a clinically-correct
 * result, which is the exact failure mode this file exists to prevent.
 *
 * Environment honesty: store boundary only (no browser in this container).
 * The strip's hover wiring is pinned separately by source contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { DEFAULT_QUICK_SELECT_TILES, type QuickSelectTile } from "./zai-workspace/quick-select-library";
import { quickSelectTilePatch, tileRowId } from "./zai-workspace/quickSelectTileFixture";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";
import { normalizeForDedupe, splitToSentences } from "./reportFieldMerge";
import { describeRetirementPreviewLine } from "./quickSelectRetirementPreview";

const STUDY = "syn-preview-1";

const tile = (label: string): QuickSelectTile => {
  const found = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === label);
  if (!found) throw new Error(`no shipped tile labelled ${label}`);
  return found;
};

const S = () => useWorkspace.getState();
const findingsOf = () => S().findingsText;
const impressionOf = () => S().impressionText;

function required(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  const hits = splitToSentences(text).filter((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)).length;
  expect(hits, `REQUIRED "${sentence}" in ${where}`).toBe(1);
}
function forbidden(sentence: string, where: "findings" | "impression" = "findings") {
  const text = where === "findings" ? findingsOf() : impressionOf();
  expect(
    splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence)),
    `FORBIDDEN "${sentence}" in ${where}`,
  ).toBe(false);
}

const lsCtx = () => buildReportingStudyContext({
  modality: "MR", studyDescription: "MRI LS Spine Plain", regions: ["LS Spine"], source: "auto",
});

function openSyntheticStudy() {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: lsCtx(),
    studies: [{
      id: STUDY,
      patient: { name: "SYNTHETIC PATIENT", sex: "M" },
      modality: "MR",
    }],
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

function click(t: QuickSelectTile) {
  const outcome = S().applyPathologyOverlay(quickSelectTilePatch(t, "findings"));
  if (outcome !== "applied") throw new Error(`${t.label} click was ${outcome}`);
  return tileRowId(t);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openSyntheticStudy();
});

describe("previewPathologyOverlay — the hover names the sentence the click retires", () => {
  it("promises the facet normal retirement, and the click keeps the promise", () => {
    const decision = S().composeInstantReport(lsCtx(), false);
    expect(decision.action).toBe("compose");
    required("Lumbar facet joints are unremarkable.");
    required("Normal MRI of the lumbosacral spine.", "impression");

    const preview = S().previewPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"));
    expect(preview.refusal).toBeUndefined();
    // The exact normal sentence the facet tile falsifies — named, not gestured at.
    expect(preview.retiredFindings).toContain("Lumbar facet joints are unremarkable.");
    // The system normal conclusion yields with the first abnormality (#662 §2) —
    // BOTH of its sentences, wholesale, exactly as the click removes them.
    expect(preview.retiredImpression).toContain("Normal MRI of the lumbosacral spine.");
    expect(preview.retiredImpression).toContain("No significant disc, canal, foraminal or neural compressive abnormality.");
    // Unrelated normals are NOT claimed — over-generalisation would make the
    // preview scare the radiologist off a correct click.
    expect(preview.retiredFindings).not.toContain("Ligamentum flavum is not hypertrophied.");
    expect(preview.nothingRetires).toBe(false);

    // The click: every claimed retirement happens, every unclaimed normal stays.
    click(tile("Facet arthropathy L4-L5"));
    forbidden("Lumbar facet joints are unremarkable.");
    forbidden("Normal MRI of the lumbosacral spine.", "impression");
    required("Ligamentum flavum is not hypertrophied.");
    required("Facet arthropathy at L4-L5.");
  });

  it("promises nothing when the contradicted normal is already retired (shared baseline)", () => {
    S().composeInstantReport(lsCtx(), false);
    click(tile("Facet arthropathy L4-L5"));
    // A second abnormality sharing the same baseline (LF hypertrophy also
    // falsifies the facet normal) claims nothing new: the difference against
    // the live suppressors is empty.
    const preview = S().previewPathologyOverlay(quickSelectTilePatch(tile("Ligamentum flavum hypertrophy"), "findings"));
    expect(preview.retiredFindings).not.toContain("Lumbar facet joints are unremarkable.");
  });

  it("names the in-slot sibling wording a severity upgrade replaces", () => {
    S().composeInstantReport(lsCtx(), false);
    click(tile("Mild canal stenosis L4-L5"));
    required("Mild canal stenosis at L4-L5 without cord compression.");

    const preview = S().previewPathologyOverlay(quickSelectTilePatch(tile("Severe canal stenosis L4-L5"), "findings"));
    expect(preview.vacatedFindings).toContain("Mild canal stenosis at L4-L5 without cord compression.");
    expect(preview.nothingRetires).toBe(false);

    click(tile("Severe canal stenosis L4-L5"));
    forbidden("Mild canal stenosis at L4-L5 without cord compression.");
    required("Severe canal stenosis at L4-L5 with thecal sac compression.");
  });

  it("writes nothing: the preview leaves every field, the ledger and the dirty flag untouched", () => {
    S().composeInstantReport(lsCtx(), false);
    const before = {
      findings: findingsOf(), impression: impressionOf(),
      patches: S().appliedPathologyPatches.length,
      provenance: JSON.stringify(S().fieldProvenance),
      isDirty: S().isDirty,
      undo: S().patchUndoStack.length,
    };
    S().previewPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"));
    expect(findingsOf()).toBe(before.findings);
    expect(impressionOf()).toBe(before.impression);
    expect(S().appliedPathologyPatches.length).toBe(before.patches);
    expect(JSON.stringify(S().fieldProvenance)).toBe(before.provenance);
    expect(S().isDirty).toBe(before.isDirty);
    expect(S().patchUndoStack.length).toBe(before.undo);
  });

  it("never promises a retirement the click does not keep (mirror property, LS battery)", () => {
    // The honesty property the whole module exists for: every sentence the
    // preview claims — findings, impression, vacated — is GONE after the same
    // click, from a fresh composed normal, for every tile in the battery. A
    // preview that over-claims scares a radiologist off a correct click; one
    // that under-claims hides a contradiction the page was about to lose.
    for (const label of [
      "Facet arthropathy L4-L5",
      "Ligamentum flavum hypertrophy",
      "Mild canal stenosis L4-L5",
      "Disc herniation L4-L5",
      "Normal LS spine",
      "Compression fracture L1",
    ]) {
      openSyntheticStudy();
      expect(S().composeInstantReport(lsCtx(), false).action).toBe("compose");
      const preview = S().previewPathologyOverlay(quickSelectTilePatch(tile(label), "findings"));
      expect(preview.refusal, `${label} preview refused`).toBeUndefined();
      const outcome = S().applyPathologyOverlay(quickSelectTilePatch(tile(label), "findings"));
      expect(outcome, `${label} click`).toBe("applied");
      const has = (text: string, sentence: string) =>
        splitToSentences(text).some((s) => normalizeForDedupe(s) === normalizeForDedupe(sentence));
      for (const s of preview.retiredFindings) {
        expect(has(findingsOf(), s), `${label} claimed "${s}" would retire from findings`).toBe(false);
      }
      for (const s of preview.retiredImpression) {
        expect(has(impressionOf(), s), `${label} claimed "${s}" would retire from impression`).toBe(false);
      }
      for (const s of preview.vacatedFindings) {
        expect(has(findingsOf(), s), `${label} claimed "${s}" would vacate from findings`).toBe(false);
      }
    }
  });

  it("refuses on a signed report and on unresolved tile parameters — named, not silent", () => {
    S().composeInstantReport(lsCtx(), false);
    // Unresolved {side} on the brain infarct tile: the click would refuse, so
    // the preview must refuse with the same word rather than promise prose.
    const brainCtx = buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
    });
    useWorkspace.setState({ reportingContext: brainCtx } as never);
    const unresolved = S().previewPathologyOverlay(quickSelectTilePatch(tile("Acute infarct (DWI)"), "findings"));
    expect(unresolved.refusal).toContain("side");

    // Signed: the read-only guard mirrors the apply path's refusal.
    useWorkspace.setState({ reportingContext: lsCtx() } as never);
    S().startFinalize();
    S().completeFinalize();
    const signed = S().previewPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"));
    expect(signed.refusal).toBe("signed");
  });

  it("describeRetirementPreviewLine reads the sentences back verbatim", () => {
    S().composeInstantReport(lsCtx(), false);
    const preview = S().previewPathologyOverlay(quickSelectTilePatch(tile("Facet arthropathy L4-L5"), "findings"));
    const line = describeRetirementPreviewLine(preview);
    expect(line).toContain("Replaces:");
    expect(line).toContain("\"Lumbar facet joints are unremarkable.\"");
    expect(line).toContain("\"Normal MRI of the lumbosacral spine.\"");
  });
});

/** The strip's hover carries the preview — pinned because no browser runs here. */
describe("the strip wiring (source contract)", () => {
  it("the tile title renders the retirement hint through the preview action", () => {
    const source = readSource("../components/radiology/zai-workspace/quick-select-strip.tsx");
    expect(source).toMatch(/previewPathologyOverlay/);
    expect(source).toMatch(/describeRetirementPreviewLine/);
    expect(source).toMatch(/retirementHint/);
  });

  it("the post-click toast names the retired sentence (feedback module)", () => {
    const source = readSource("abnormalSelectionFeedback.ts");
    expect(source).toMatch(/replaced the normal/);
    expect(source).toMatch(/replacedBaseline\?\.findings/);
  });
});

function readSource(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fileURLToPath } = require("node:url") as typeof import("node:url");
  return readFileSync(fileURLToPath(new URL(`./${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}
