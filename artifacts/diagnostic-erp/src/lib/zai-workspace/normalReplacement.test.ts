/**
 * A second complete normal REPLACES the first one; it never joins it.
 *
 * Filed from the owner's decision on 2026-11-01: "Do not append a second complete normal
 * report to the existing MRI Brain scaffold… Never silently overwrite clinical text."
 *
 * The journey that reaches this code is measured, not imagined. `MRI BRAIN + CX SCR` billed
 * as `MRI Brain` opens on the brain's normal. The radiologist confirms the wider scope on the
 * screen, and the examination then resolves the clinic's combined row — a SECOND complete
 * normal for the same patient. `generateProfessionalReport` merges by design ("the scaffold
 * is merged in, never dropped on top"), which is right when the same normal is regenerated
 * and wrong here: on the rig one press kept the brain normal's twelve sentences AND added the
 * combined row's four under them, stated that the brain was normal twice in two different
 * words in the Impression, and printed five Technique lines for one scan.
 *
 * So the press stops and asks. What the answer may remove is computed from the superseded
 * format's OWN prose — which is why a dictated line, a typed line and every Quick Select
 * observation survive whichever way it goes, without this file having to recognise them.
 */
import { describe, expect, it } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  decideNormalReplacement,
  isWidenedScope,
  normalDocumentedRegions,
  normalReplacementMessage,
  retireSupersededScaffold,
} from "@/lib/zai-workspace/normalReplacement";
import { CLINICAL_RESET_FIELDS } from "@/lib/zai-workspace/clinicalStateReset";
import { buildReportingStudyContext, type ReportingStudyContext, type ReportingSource } from "@/lib/reportingStudyContext";
import type { ReportFormat } from "@/lib/zai-workspace/types";

/** The clinic's two rows, in the shape the Formats screen stores them. */
const owns = (key: string, rows: Array<{ region?: string; concept: string; text: string }>) => ({
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: `${key}.v1`,
  observations: rows.map((r, i) => ({
    id: `${key}-${i}`,
    field: "findings" as const,
    concept: r.concept,
    conflictGroup: r.concept,
    anatomicalSection: r.region ?? "Brain",
    region: r.region ?? "Brain",
    renderedText: r.text,
  })),
});

const BRAIN_LINE = "Brain parenchyma shows normal signal intensity.";
const BRAIN_TECHNIQUE = "MRI Brain: T1W, T2W and FLAIR axial and sagittal sequences.";

const PLAIN_BRAIN: ReportFormat = {
  id: "f-brain-plain", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
  isCompleteNormal: true,
  findings: BRAIN_LINE,
  impression: "Normal MRI brain.",
  technique: BRAIN_TECHNIQUE,
  baselineManifest: owns("brain-plain", [{ concept: "brain-signal-intensity", text: BRAIN_LINE }]),
} as unknown as ReportFormat;

const COMBINED: ReportFormat = {
  id: "f-brain-cspine", name: "MRI Brain – Screening Cervical Spine Normal",
  modality: "MR", bodyPart: "Brain", isCompleteNormal: true,
  // Restates the brain in its own words and adds the cervical section — the row the
  // clinic already authors (`ai_normal_report_templates` id 3).
  findings: "Brain: Normal signal intensity on all sequences.\nCervical Spine: Normal alignment. The canal is capacious.",
  impression: "Normal MRI brain. Normal cervical spine screening.",
  technique: "MRI Brain and Cervical Spine: T1W, T2W and FLAIR axial and sagittal sequences.",
  baselineManifest: owns("brain-cspine", [
    { concept: "brain-signal-intensity", text: "Brain: Normal signal intensity on all sequences." },
    { region: "Cervical Spine", concept: "cervical-alignment", text: "Cervical Spine: Normal alignment. The canal is capacious." },
  ]),
} as unknown as ReportFormat;

const FORMATS = [PLAIN_BRAIN, COMBINED];

const ctxFor = (regions: string[], source: ReportingSource): ReportingStudyContext =>
  buildReportingStudyContext({ modality: "MR", studyDescription: "MRI BRAIN + CX SCR", regions, source });

/** Exactly what the workspace's two buttons hand the store. */
const asGeneratorCtx = (c: ReportingStudyContext) => ({
  modality: c.modality, region: c.region, regions: c.regions,
  source: c.source, protocolName: c.protocolName, studyDescription: c.studyDescription,
});

const BOOKED = ctxFor(["Brain"], "billed");
const CONFIRMED = ctxFor(["Brain", "Cervical Spine"], "override");

function cleanCanvas() {
  useWorkspace.setState({
    findingsText: "", impressionText: "", recommendationText: "", techniqueText: "", clinicalHistoryText: "",
    fieldProvenance: {}, appliedPathologyPatches: [], patchUndoStack: [], patchRedoStack: [],
    confirmOverwriteOpen: false, mergePreviewOpen: false, pendingPathologyPatch: null,
    pendingFormatIds: [], pendingFormatOverwrite: null, pendingNormalReplacement: null,
    isFinalized: false, isFinalizing: false, isDirty: false, impressionOrderFrozen: false,
    regionTransitions: [], reportingContext: BOOKED,
    reportFormats: FORMATS, reportFormatPickerOpen: false,
    appliedFormatName: null, appliedFormatReportTitle: null, startingCanvasBaseline: null,
    normalLinesRemovedByRadiologist: [], impressionNeedsRefresh: false,
  });
}

/** Open the study the way the workspace does: Start Report on the booked, brain-only scope. */
function openOnBrainScaffold() {
  const first = useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BOOKED));
  expect(first.status, "the brain normal must apply before the scope is confirmed").toBe("generated");
}

/** The radiologist's answer to the scope question: the study is now reported as both. */
function confirmWiderScope() {
  useWorkspace.setState({ reportingContext: CONFIRMED });
  return useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED));
}

const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);

describe("the sentence arithmetic a replacement is judged on", () => {
  it("drops only the lines the superseded normal wrote", () => {
    const kept = retireSupersededScaffold({
      text: `${BRAIN_LINE}\nClinic: patient reports morning headaches.`,
      previous: BRAIN_LINE,
      next: COMBINED.findings ?? "",
    });
    expect(kept).toBe("Clinic: patient reports morning headaches.");
  });

  it("keeps a sentence both normals say, exactly once", () => {
    const shared = "No mass effect.";
    expect(retireSupersededScaffold({ text: shared, previous: shared, next: shared })).toBe(shared);
  });

  it("cannot remove a line the previous format never owned", () => {
    // The safety of the whole mechanism rests here: the removal list is the superseded
    // format's own prose, so dictated and typed text is out of its reach by construction.
    const dictated = "C5-C6: Disc herniation with cord compression.";
    expect(retireSupersededScaffold({ text: dictated, previous: BRAIN_LINE, next: COMBINED.findings ?? "" })).toBe(dictated);
  });

  it("counts an untouched canvas as untouched", () => {
    const plan = decideNormalReplacement({
      fromName: PLAIN_BRAIN.name ?? "", toName: COMBINED.name ?? "",
      findingsText: BRAIN_LINE, impressionText: "Normal MRI brain.", techniqueText: BRAIN_TECHNIQUE,
      previous: { findings: BRAIN_LINE, impression: "Normal MRI brain.", technique: BRAIN_TECHNIQUE },
      next: { findings: COMBINED.findings ?? "", impression: COMBINED.impression ?? "", technique: COMBINED.technique ?? "" },
      unexplainedFindingLines: [], manualImpression: false, manualTechnique: false,
    });
    expect(plan.kind).toBe("untouched");
    expect(plan.keptOwnWords).toBe(0);
    expect(plan.replacedSentences).toBeGreaterThan(0);
    expect(normalReplacementMessage(plan).title).toContain("instead of");
  });

  it("counts a canvas the radiologist wrote into as edited, and says what survives", () => {
    const typed = "Clinic: patient reports morning headaches.";
    const plan = decideNormalReplacement({
      fromName: PLAIN_BRAIN.name ?? "", toName: COMBINED.name ?? "",
      findingsText: `${BRAIN_LINE}\n${typed}`, impressionText: "Normal MRI brain.", techniqueText: "",
      previous: { findings: BRAIN_LINE, impression: "Normal MRI brain.", technique: "" },
      next: { findings: COMBINED.findings ?? "", impression: COMBINED.impression ?? "", technique: COMBINED.technique ?? "" },
      unexplainedFindingLines: [typed], manualImpression: false, manualTechnique: false,
    });
    expect(plan.kind).toBe("edited");
    expect(plan.keptOwnWords).toBe(1);
    // The offer to replace is only honest if it names what is NOT at risk.
    expect(normalReplacementMessage(plan).description).toContain("1 own sentence");
  });
});

describe("only a SECOND examination is a replacement", () => {
  it("reads the regions a normal speaks for out of its own rows", () => {
    expect(normalDocumentedRegions(PLAIN_BRAIN)).toEqual(["Brain"]);
    expect(normalDocumentedRegions(COMBINED)).toEqual(["Brain", "Cervical Spine"]);
  });

  it("fires when the confirmed scope covers the first normal and names another examination", () => {
    expect(isWidenedScope(["Brain"], ["Brain", "Cervical Spine"])).toBe(true);
  });

  it("never fires on the same examination, whichever row answers it", () => {
    // The clinic editing or renaming its brain normal is not a second examination, and
    // neither is building a linked study's section beside this one. Both press Generate
    // over a differently-named format; the merge engine has always owned those, and
    // `linkedTechniqueMerge.test.ts` and `withheldNormalClaims.test.ts` pin what it writes.
    expect(isWidenedScope(["Brain"], ["Brain"])).toBe(false);
    expect(isWidenedScope(["Dorsal Spine"], ["Brain"])).toBe(false);
    expect(isWidenedScope(["Brain", "Cervical Spine"], ["Brain"])).toBe(false);
    // Nothing to compare against: no prompt, no retirement.
    expect(isWidenedScope([], ["Brain", "Cervical Spine"])).toBe(false);
  });

  it("counts `LS Spine` and `ls-spine` as the one tab they are", () => {
    expect(isWidenedScope(["LS Spine"], ["ls-spine", "Brain"])).toBe(true);
  });
});

describe("a confirmed wider examination asks before it takes the first normal away", () => {
  const before = useWorkspace.getState();

  it("the press writes nothing and puts the question on the screen", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const held = {
        findings: useWorkspace.getState().findingsText,
        impression: useWorkspace.getState().impressionText,
        technique: useWorkspace.getState().techniqueText,
        format: useWorkspace.getState().appliedFormatName,
      };

      const outcome = confirmWiderScope();
      expect(outcome.status).toBe("refused");
      if (outcome.status === "refused") {
        expect(outcome.code).toBe("normal-replacement");
        expect(outcome.reason).toContain("MRI Brain – Screening Cervical Spine Normal");
      }
      const after = useWorkspace.getState();
      expect(after.findingsText).toBe(held.findings);
      expect(after.impressionText).toBe(held.impression);
      expect(after.techniqueText).toBe(held.technique);
      expect(after.appliedFormatName).toBe(held.format);
      expect(after.pendingNormalReplacement?.plan.kind).toBe("untouched");
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("an unpressed pass never asks and never replaces — it refuses", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const outcome = useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED), {
        automatic: true, requireOwnedApprovedNormal: true,
      });
      expect(outcome.status).toBe("refused");
      if (outcome.status === "refused") expect(outcome.code).toBe("normal-replacement");
      // MODE A has no authority to move a Conclusion somebody may be reading, and no
      // radiologist is standing at the screen to answer a question it raised.
      expect(useWorkspace.getState().pendingNormalReplacement).toBeNull();
      expect(useWorkspace.getState().appliedFormatName).toBe(PLAIN_BRAIN.name);
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("answering Keep leaves the report exactly as it was", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const held = useWorkspace.getState().findingsText;
      confirmWiderScope();
      useWorkspace.getState().dismissNormalReplacement();
      const after = useWorkspace.getState();
      expect(after.pendingNormalReplacement).toBeNull();
      expect(after.findingsText).toBe(held);
      expect(after.appliedFormatName).toBe(PLAIN_BRAIN.name);
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("answering Replace produces ONE combined report, not two normals", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      confirmWiderScope();
      useWorkspace.getState().confirmNormalReplacement();

      const s = useWorkspace.getState();
      expect(s.pendingNormalReplacement).toBeNull();
      expect(s.appliedFormatName).toBe(COMBINED.name);
      // The owner's five requirements for the finished report.
      expect(s.findingsText).toContain("Brain:");
      expect(s.findingsText).toContain("Cervical Spine:");
      // One acquisition statement for one scan: the brain-only Technique retires and the
      // combined examination's takes its place, so a paragraph is not said twice.
      expect(s.techniqueText).toContain("Cervical Spine");
      expect(s.techniqueText).not.toContain(BRAIN_TECHNIQUE);
      // One Impression, and the brain is not declared normal twice in two words.
      expect(s.impressionText.match(/normal mri brain/gi)?.length).toBe(1);
      // No duplicated normal sentence anywhere on the page.
      for (const field of [s.findingsText, s.impressionText, s.techniqueText]) {
        const seen = lines(field).map((l) => l.toLowerCase());
        expect(new Set(seen).size, field).toBe(seen.length);
      }
      // The brain-only sentence the combined normal does not restate is gone, and its
      // ledger row is retired rather than deleted, so deselecting a cervical abnormality
      // cannot bring the old normal back underneath the new one.
      expect(s.findingsText).not.toContain(BRAIN_LINE);
      expect(s.appliedPathologyPatches.filter((p) => p.id.startsWith("baseline:brain-plain.v1:"))
        .every((p) => p.stale)).toBe(true);
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("a hand-written line survives the replacement", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const typed = "Clinic: patient reports morning headaches since March.";
      useWorkspace.getState().setField("findings", `${useWorkspace.getState().findingsText}\n${typed}`, "manual");
      confirmWiderScope();
      const plan = useWorkspace.getState().pendingNormalReplacement?.plan;
      expect(plan?.kind).toBe("edited");
      expect(plan?.keptOwnWords).toBeGreaterThan(0);

      useWorkspace.getState().confirmNormalReplacement();
      const s = useWorkspace.getState();
      expect(s.findingsText).toContain(typed);
      expect(s.findingsText).toContain("Cervical Spine:");
      expect(s.appliedFormatName).toBe(COMBINED.name);
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("regenerating the SAME normal never asks — there is nothing to replace", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const again = useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BOOKED));
      expect(again.status).toBe("generated");
      expect(useWorkspace.getState().pendingNormalReplacement).toBeNull();
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("a second press while the question is open is refused, not stacked underneath it", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      confirmWiderScope();
      const second = confirmWiderScope();
      expect(second.status).toBe("refused");
      if (second.status === "refused") expect(second.code).toBe("confirmation-open");
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("switching studies closes the question with the canvas it belonged to", () => {
    // The armed request carries one study's context; replaying it after a switch would
    // regenerate a different patient's report.
    expect(CLINICAL_RESET_FIELDS).toContain("pendingNormalReplacement");
  });
});
