/**
 * P0-2 from the 20-case rendered audit (2026-10-26) — Technique is one shared
 * field, and the linked study's format won it wholesale.
 *
 * The audit's D-cases: studies billed "MRI DORSAL SPINE + MRI BRAIN" printed a
 * brain-only Technique — the dorsal examination the patient actually had was
 * not described anywhere on the page. The Technique field is one shared text
 * box across the linked studies, and the format doors answered "replace or
 * merge?" without counting the linked study:
 *
 *  - `confirmOverwriteAndApply`'s single-format branch REPLACED the field
 *    unconditionally (`setField("technique", …, { replaceProvenance: true })`)
 *    — no `mayReplaceMachineTechniqueWithApproved` guard at all, so applying
 *    the linked brain format over a machine-authored dorsal Technique erased
 *    the dorsal acquisition statement.
 *  - `generateProfessionalReport` and `applyMergedResult` DO run the guard,
 *    but count only the reporting context's regions — the linked study's
 *    region travels in `linkedStudy`, never in `ctx.regions`, so a
 *    dorsal+brain linked report read regionCount 1 and the approved brain
 *    statement replaced the machine dorsal text.
 *
 * The fix: the region the technique decision counts is the context's regions
 * UNION the linked study's region (`techniqueDecisionRegionCount`), and the
 * single-format branch runs the same replace-or-merge shape the other two
 * doors already run. A single-region report keeps today's behaviour exactly
 * (machine technique from its own region is replaced by the approved
 * statement — one account of one examination); a linked report merges, so
 * every examination the page describes is described in Technique too.
 *
 * Environment honesty: store boundary only (no browser in this container),
 * same controlled-synthetic harness as quickSelectRetirementPreview.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspace } from "./zai-workspace/store";
import { emptyClinicalState } from "./zai-workspace/clinicalStateReset";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { buildReportingStudyContext } from "./reportingStudyContext";
import { findingsSectionFromStudy } from "./multiStudyReport";
import { emptyViewerMeasurementsState } from "./structuredViewerMeasurements";
import { defaultLumbarNumbering } from "./mriSpineNumbering";
import { defaultSpineSequences } from "./mriSpineSequences";
import { defaultScreeningState } from "./mriSpineScreening";
import { defaultVascularTechnique } from "./mriBrainVascularTechnique";

const DORSAL_TECH = "MRI dorsal spine on 3T";
const BRAIN_TECH = "MRI brain on 3T";

const formatByName = (name: string) => {
  const f = DEFAULT_REPORT_FORMATS.find((x) => x.name === name);
  if (!f) throw new Error(`no shipped format named ${name}`);
  return f;
};

const S = () => useWorkspace.getState();

function openStudy(region: string, description: string) {
  useWorkspace.setState({
    ...emptyClinicalState(),
    reportFormats: DEFAULT_REPORT_FORMATS,
    reportingContext: buildReportingStudyContext({
      modality: "MR", studyDescription: description, regions: [region], source: "auto",
    }),
    studies: [{ id: "syn-linked-1", patient: { name: "SYNTHETIC PATIENT", sex: "M" }, modality: "MR" }],
    activeStudyId: "syn-linked-1",
    completedStudyIds: new Set<string>(),
    structuredViewerMeasurements: emptyViewerMeasurementsState(),
    lumbarNumbering: defaultLumbarNumbering(),
    sequencesAvailable: defaultSpineSequences(),
    screening: defaultScreeningState(),
    vascularTechnique: defaultVascularTechnique(),
    canalApProvenance: {},
  } as never);
}

/** The audit's shape: a primary dorsal study with a brain study linked onto it. */
function linkBrainStudy() {
  S().setLinkedStudies(
    findingsSectionFromStudy({
      studyId: "syn-linked-1", modality: "MR", studyDescription: "MRI DORSAL SPINE", region: "Dorsal Spine",
    }),
    findingsSectionFromStudy({
      studyId: "syn-linked-2", modality: "MR", studyDescription: "MRI BRAIN", region: "Brain",
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  openStudy("Dorsal Spine", "MRI Dorsal Spine Plain");
});

describe("a linked study's format must not erase the primary's Technique", () => {
  it("single-format door: applying the linked brain format keeps the dorsal Technique beside the brain's", () => {
    S().applyFormatById(formatByName("MRI Dorsal Spine — Normal").id);
    expect(S().techniqueText).toContain(DORSAL_TECH);
    linkBrainStudy();
    S().applyFormatById(formatByName("MRI Brain — Normal").id);
    if (S().confirmOverwriteOpen) S().confirmOverwriteAndApply();
    const tech = S().techniqueText;
    expect(tech, `both examinations must be described; got: ${tech}`).toContain(DORSAL_TECH);
    expect(tech).toContain(BRAIN_TECH);
  });

  it("single-format door WITHOUT a link still replaces machine technique (one account of one examination)", () => {
    S().applyFormatById(formatByName("MRI Dorsal Spine — Normal").id);
    expect(S().techniqueText).toContain(DORSAL_TECH);
    // A region switch the radiologist made deliberately: no linked study, the
    // report is now a brain report, and the machine dorsal statement is
    // yesterday's seed — the approved brain statement replaces it.
    S().applyFormatById(formatByName("MRI Brain — Normal").id);
    if (S().confirmOverwriteOpen) S().confirmOverwriteAndApply();
    expect(S().techniqueText).toContain(BRAIN_TECH);
    expect(S().techniqueText).not.toContain(DORSAL_TECH);
  });

  it("generate door: Generate on the linked brain region keeps the dorsal Technique", () => {
    S().applyFormatById(formatByName("MRI Dorsal Spine — Normal").id);
    expect(S().techniqueText).toContain(DORSAL_TECH);
    linkBrainStudy();
    const brainCtx = buildReportingStudyContext({
      modality: "MR", studyDescription: "MRI Brain Plain", regions: ["Brain"], source: "auto",
    });
    const outcome = S().generateProfessionalReport(brainCtx);
    expect(outcome.status).not.toBe("refused");
    expect(S().techniqueText).toContain(DORSAL_TECH);
    expect(S().techniqueText).toContain(BRAIN_TECH);
  });

  it("merge door: a two-format merge on a linked report keeps both Techniques", () => {
    S().applyFormatById(formatByName("MRI Dorsal Spine — Normal").id);
    expect(S().techniqueText).toContain(DORSAL_TECH);
    linkBrainStudy();
    S().setState?.(undefined);
    useWorkspace.setState({ selectedFormatIds: [
      formatByName("MRI Dorsal Spine — Normal").id,
      formatByName("MRI Brain — Normal").id,
    ] } as never);
    S().applySelectedFormats();
    if (S().confirmOverwriteOpen) S().confirmOverwriteAndApply();
    if (S().mergePreviewOpen) S().applyMergedResult();
    expect(S().techniqueText).toContain(DORSAL_TECH);
    expect(S().techniqueText).toContain(BRAIN_TECH);
  });
});
