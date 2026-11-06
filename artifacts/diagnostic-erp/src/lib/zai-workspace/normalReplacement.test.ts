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
const owns = (key: string, rows: Array<{
  region?: string;
  concept: string;
  text: string;
  field?: "findings" | "impression";
}>) => ({
  kind: "care.full_report_baseline.v1",
  version: 1,
  revision: `${key}.v1`,
  observations: rows.map((r, i) => ({
    id: `${key}-${i}`,
    field: r.field ?? "findings" as const,
    concept: r.concept,
    conflictGroup: r.concept,
    anatomicalSection: r.region ?? "Brain",
    region: r.region ?? "Brain",
    renderedText: r.text,
  })),
});

const BRAIN_LINE = "Brain parenchyma shows normal signal intensity.";
const BRAIN_TECHNIQUE = "MRI Brain: T1W, T2W and FLAIR axial and sagittal sequences.";
/** The cervical Study Tab's own acquisition sentence, verbatim from the clinic's Study Tabs. */
const CSPINE_TAB_TECHNIQUE
  = "Multiplanar multisequence MRI of the cervical spine was performed including T1, T2, and STIR sequences.";

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

/**
 * The brain normal as the shipped library actually stores it: baseline rows authored under the
 * Quick Select anatomy vocabulary ("brain parenchyma", "extra-axial spaces"), which shares no
 * spelling with the reporting tab "Brain" the study is filed under.
 */
const SHIPPED_BRAIN = {
  id: "f-brain-shipped", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
  findings: [
    "Brain parenchyma shows normal signal intensity with preserved grey-white differentiation.",
    "No acute infarct is seen.",
    "No extra-axial collection is identified.",
    "Flow voids in major intracranial vessels are preserved.",
    "Posterior fossa structures are unremarkable.",
  ].join("\n"),
  impression: "Normal MRI of the brain. No acute intracranial abnormality.",
  technique: "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences.",
  baselineManifest: {
    kind: "care.full_report_baseline.v1", version: 1, revision: "shipped.brain.v1",
    observations: [
      "brain parenchyma", "parenchyma", "diffusion", "ventricles", "extra-axial spaces",
      "intracranial vessels", "posterior fossa",
    ].map((region, i) => ({
      id: `shipped-${i}`, field: "findings", concept: `c${i}`, conflictGroup: `c${i}`,
      anatomicalSection: region, region, renderedText: "…",
    })),
  },
} as unknown as ReportFormat;

const SHIPPED_SCOPE = ["Brain", "Cervical Spine"];

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

/**
 * Two normals that happen to share a sentence — the shipping case, since the clinic's brain
 * normal and its combined row both close the brain section with "No acute infarct is seen."
 */
const SHARED = "No acute infarct is seen.";
const NARROW_BRAIN: ReportFormat = {
  id: "f-narrow", name: "MRI Brain — Standard Normal", modality: "MR", bodyPart: "Brain",
  isCompleteNormal: true,
  findings: ["Brain parenchyma shows normal signal intensity.", SHARED, "Ventricles are normal in size."].join("\n"),
  impression: "Normal MRI of the brain.",
  technique: "MRI brain on 3T.",
  baselineManifest: owns("narrow", [
    { concept: "signal", text: "Brain parenchyma shows normal signal intensity." },
    { concept: "infarct", text: SHARED },
    { concept: "ventricles", text: "Ventricles are normal in size." },
    // The shipped shape: the clinic's brain row states its Conclusion as the system-owned normal
    // concept, so the row materializes as `system-normal-study` rather than as a baseline row.
    { field: "impression", concept: "normal_study", text: "Normal MRI of the brain." },
  ]),
} as unknown as ReportFormat;

const WIDE_COMBINED: ReportFormat = {
  id: "f-wide", name: "MRI Brain – Screening Cervical Spine Normal", modality: "MR", bodyPart: "Brain",
  isCompleteNormal: true,
  findings: ["Brain: Normal signal intensity.", SHARED, "Cervical Spine: Normal alignment."].join("\n"),
  impression: "Normal MRI of the brain and cervical spine screening.",
  technique: "MRI brain and cervical spine screening.",
  baselineManifest: owns("wide", [
    { concept: "signal", text: "Brain: Normal signal intensity." },
    { concept: "infarct", text: SHARED },
    { region: "Cervical Spine", concept: "alignment", text: "Cervical Spine: Normal alignment." },
  ]),
} as unknown as ReportFormat;

describe("the replaced normal's own order is the report's order", () => {
  const before = useWorkspace.getState();

  it("keeps the new normal's sentences in the new normal's order, not in the old one's slots", () => {
    try {
      cleanCanvas();
      useWorkspace.setState({
        reportFormats: [NARROW_BRAIN, WIDE_COMBINED],
        appliedFormatName: NARROW_BRAIN.name,
        findingsText: NARROW_BRAIN.findings ?? "",
        impressionText: NARROW_BRAIN.impression ?? "",
        techniqueText: NARROW_BRAIN.technique ?? "",
        reportingContext: CONFIRMED,
      });
      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED));
      useWorkspace.getState().confirmNormalReplacement();
      // Measured on the rig after Replace (study 1114, `tmp/evidence/j62-combined-1114.json`):
      // the shared sentence stayed where the brain normal had put it, so the combined report
      // printed "No acute infarct is seen." ABOVE its own "Brain:" line. One complete normal
      // replacing another has to leave the replacement's own order behind it.
      expect(lines(useWorkspace.getState().findingsText)).toEqual(lines(WIDE_COMBINED.findings ?? ""));
      expect(useWorkspace.getState().findingsText).not.toContain("Brain parenchyma shows normal signal intensity.");
      expect(useWorkspace.getState().findingsText).not.toContain("Ventricles are normal in size.");
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("still keeps a sentence the radiologist wrote, whichever normal also says it", () => {
    try {
      cleanCanvas();
      useWorkspace.setState({
        reportFormats: [NARROW_BRAIN, WIDE_COMBINED],
        appliedFormatName: NARROW_BRAIN.name,
        findingsText: `${NARROW_BRAIN.findings}\nClinic: headaches since March.`,
        impressionText: NARROW_BRAIN.impression ?? "",
        techniqueText: NARROW_BRAIN.technique ?? "",
        reportingContext: CONFIRMED,
      });
      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED));
      useWorkspace.getState().confirmNormalReplacement();
      const s = useWorkspace.getState();
      expect(s.findingsText).toContain("Clinic: headaches since March.");
      expect(lines(s.findingsText).filter((l) => l === SHARED)).toHaveLength(1);
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("re-bases the system-owned normal row to the replacement's conclusion", () => {
    try {
      cleanCanvas();
      useWorkspace.setState({
        reportFormats: [NARROW_BRAIN, WIDE_COMBINED],
        appliedFormatName: NARROW_BRAIN.name,
        findingsText: NARROW_BRAIN.findings ?? "",
        impressionText: NARROW_BRAIN.impression ?? "",
        techniqueText: NARROW_BRAIN.technique ?? "",
        reportingContext: CONFIRMED,
      });
      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(BOOKED));
      const seeded = useWorkspace.getState().appliedPathologyPatches
        .find((p) => p.id === "system-normal-study");
      expect(seeded, "the shipped brain row's Conclusion materializes as the system normal row")
        .toBeDefined();
      expect(seeded?.templates.impression).toContain("Normal MRI of the brain.");

      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED));
      useWorkspace.getState().confirmNormalReplacement();
      // What the reader sees: the replacement leaves no warning on the report. Pinned on this
      // fixture too, because the row it re-bases is a LIVE row, and a live row whose rendered
      // Impression has left the page is exactly what the dependency's ledger half reads.
      const after = useWorkspace.getState();
      expect(after.impressionNeedsRefresh,
        after.impressionDependencyReasons?.join(",")).toBe(false);
      // Reopen: the automatic pass must not find it again.
      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED), {
        automatic: true, requireOwnedApprovedNormal: true,
      });
      expect(useWorkspace.getState().impressionNeedsRefresh,
        useWorkspace.getState().impressionDependencyReasons?.join(",")).toBe(false);
      // The row itself, which is the half that is not visible on the page and is the reason this
      // correction exists: it is what the Impression editor attributes the Conclusion to, and
      // what restores a normal after an abnormality comes off. Measured on the rig after Replace,
      // it still held the retired brain normal's Conclusion — chips naming a sentence the report
      // no longer said, ready to write the superseded normal back under the one that replaced it.
      const row = useWorkspace.getState().appliedPathologyPatches
        .find((p) => p.id === "system-normal-study");
      expect(row?.templates.impression).toBe(WIDE_COMBINED.impression);
      expect(row?.lastRendered.impression).toBe(WIDE_COMBINED.impression);
    } finally {
      useWorkspace.setState(before);
    }
  });
});

describe("only a SECOND examination is a replacement", () => {
  it("reads the regions a normal speaks for out of its own prose", () => {
    const scope = ["Brain", "Cervical Spine"];
    expect(normalDocumentedRegions(PLAIN_BRAIN, scope)).toEqual(["Brain"]);
    expect(normalDocumentedRegions(COMBINED, scope)).toEqual(["Brain", "Cervical Spine"]);
  });

  it("still sees the second examination on a row whose ledger speaks Quick Select", () => {
    // Reading the regions off the ledger rows matched nothing against a reporting tab, so
    // `isWidenedScope` answered false for every real library row and the confirmed Brain +
    // Cervical Spine examination reopened as twelve brain sentences with four combined
    // sentences appended under them — the brain called normal twice in one Impression.
    expect(normalDocumentedRegions(SHIPPED_BRAIN, SHIPPED_SCOPE)).toEqual(["Brain"]);
    expect(isWidenedScope(
      normalDocumentedRegions(SHIPPED_BRAIN, SHIPPED_SCOPE), SHIPPED_SCOPE,
    )).toBe(true);
    // …and the same row is still NOT a widening when the examination never widened.
    expect(isWidenedScope(
      normalDocumentedRegions(SHIPPED_BRAIN, ["Brain"]), ["Brain"],
    )).toBe(false);
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

  it("refuses to merge a second normal over a shipped row on the unpressed pass", () => {
    // The reopen the rig measured: the shipped brain row's ledger names Quick Select anatomy,
    // not reporting tabs, so the widening test read "same examination", skipped the question,
    // and the automatic pass appended the combined normal underneath the brain one.
    try {
      cleanCanvas();
      useWorkspace.setState({
        reportFormats: [SHIPPED_BRAIN, COMBINED],
        findingsText: SHIPPED_BRAIN.findings ?? "",
        impressionText: SHIPPED_BRAIN.impression ?? "",
        techniqueText: SHIPPED_BRAIN.technique ?? "",
        appliedFormatName: SHIPPED_BRAIN.name,
        reportingContext: CONFIRMED,
      });
      const outcome = useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED), {
        automatic: true, requireOwnedApprovedNormal: true,
      });
      expect(outcome.status, "the pass that rebuilds the report on its own must stop here")
        .toBe("refused");
      const s = useWorkspace.getState();
      expect(s.findingsText).toBe(SHIPPED_BRAIN.findings ?? "");
      expect(s.impressionText).toBe(SHIPPED_BRAIN.impression ?? "");
      // One examination is never described twice, and nothing was armed for a press nobody made.
      expect(s.findingsText).not.toContain("Cervical Spine");
      expect(s.pendingNormalReplacement).toBeNull();
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
      // Owner decision 1 (2026-11-01): ONE concise paragraph. Measured before, one press left
      // six Technique lines on the page — the superseded brain statement split by the merge, the
      // cervical Study Tab sentence, and the combined row's own account of both.
      expect(lines(s.techniqueText), s.techniqueText).toEqual([COMBINED.technique!.trim()]);
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

  it("answering Replace leaves ONE acquisition statement, not the combined row beside the old ones", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      // Start Report's per-region loop writes the newly confirmed examination's own Study Tab
      // sentence. The retirement cannot remove it — the superseded brain format never wrote it —
      // so the replacement itself has to, or the combined report says the acquisition three times.
      // This is the exact page state measured on the rig after Replace: six Technique lines.
      useWorkspace.getState().setField(
        "technique",
        `${useWorkspace.getState().techniqueText}\n${CSPINE_TAB_TECHNIQUE}`,
        { source: "protocol" },
      );
      confirmWiderScope();
      useWorkspace.getState().confirmNormalReplacement();

      const s = useWorkspace.getState();
      expect(lines(s.techniqueText)).toEqual([COMBINED.technique!.trim()]);
      expect(s.techniqueText).not.toContain(CSPINE_TAB_TECHNIQUE);
      expect(s.techniqueText).not.toContain(BRAIN_TECHNIQUE);
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

  it("a Technique the radiologist wrote survives the combined replacement", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const typed = "Examination performed with the patient prone, no sedation.";
      useWorkspace.getState().setField(
        "technique", `${useWorkspace.getState().techniqueText}\n${typed}`, { source: "manual" },
      );
      confirmWiderScope();
      useWorkspace.getState().confirmNormalReplacement();
      const s = useWorkspace.getState();
      // Replacing machine text is the whole point of the rule; replacing his is never permitted.
      expect(s.techniqueText).toContain(typed);
      expect(s.techniqueText).toContain(COMBINED.technique!.trim());
      // …and the combined statement joined once, not once per press.
      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED), {
        approvedNormalReplacement: true,
      });
      expect(lines(useWorkspace.getState().techniqueText)).toEqual(lines(s.techniqueText));
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("a coherent replacement leaves no warning behind", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      confirmWiderScope();
      useWorkspace.getState().confirmNormalReplacement();
      // The radiologist chose the normal that speaks for both examinations, and this pass wrote
      // its Findings AND its Impression. Nothing is left to read. Measured before, the retired
      // brain row kept its rendered text, and the dependency's ledger half asks only whether a
      // stale row once said something — so the amber "Impression needs refresh" sat on the
      // finished report and could not be cleared by reading it.
      expect(useWorkspace.getState().impressionNeedsRefresh,
        useWorkspace.getState().impressionDependencyReasons?.join(",")).toBe(false);
      // …and it does not come back on reopen, which is where it becomes a reflex the
      // radiologist learns to ignore.
      useWorkspace.getState().generateProfessionalReport(asGeneratorCtx(CONFIRMED), {
        automatic: true, requireOwnedApprovedNormal: true,
      });
      expect(useWorkspace.getState().impressionNeedsRefresh,
        useWorkspace.getState().impressionDependencyReasons?.join(",")).toBe(false);
    } finally {
      useWorkspace.setState(before);
    }
  });

  it("still warns when a replacement keeps his own Conclusion under new Findings", () => {
    try {
      cleanCanvas();
      openOnBrainScaffold();
      const hisConclusion = "Posterior fossa infarct, subacute.";
      useWorkspace.getState().setField("impression", hisConclusion, "manual");
      confirmWiderScope();
      useWorkspace.getState().confirmNormalReplacement();
      const s = useWorkspace.getState();
      // His words are not this action's to delete, so they stay — and the Findings underneath
      // them now describe an examination his sentence never covered. That pairing has to be
      // re-read. It is named rather than inferred, because the contradiction predicate cannot
      // see it: his line asserts nothing the (now normal) Findings deny. Measured before this
      // correction, the warning in this case was `stale-patch` — a retired row's shadow, which
      // is also what made the coherent case un-clearable.
      expect(s.impressionText).toContain(hisConclusion);
      expect(s.impressionNeedsRefresh, s.impressionDependencyReasons?.join(",")).toBe(true);
      expect(s.impressionDependencyReasons).toContain("findings-changed");
      expect(s.impressionBasis?.recordedBy).toBe("unreconciled");
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
