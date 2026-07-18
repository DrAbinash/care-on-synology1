/**
 * Phase P4 interop — pure unit tests (no DB, no network).
 *
 * Covers the SR content model (G12), FHIR mapping (G17), viewer deep-links
 * (G18), AI timeline shaping (G19), AI version comparison (G20), and human
 * feedback dataset shaping (G21). All modules are pure, so these tests run
 * without DATABASE_URL.
 */
import { describe, it, expect } from "vitest";
import { buildSrContentTree } from "./srContentModel";
import { toFhirBundle, toImagingStudy, toObservation, toDiagnosticReport } from "./fhirMapping";
import { buildOhifDeepLink, buildWeasisDeepLink, buildFindingViewerLinks } from "./viewerDeepLinks";
import { buildAiTimeline } from "./aiTimelineShaping";
import { compareAiVersions } from "./aiComparison";
import { buildFeedbackDataset, toJsonl } from "./feedbackDataset";
import type { InteropReport } from "./interopTypes";

const REPORT: InteropReport = {
  studyInstanceUid: "1.2.3.4",
  accessionNumber: "ACC-1",
  patientId: "42",
  modality: "CT",
  findings: [
    { key: "nodule", text: "8mm nodule", laterality: "right", evidence: [{ seriesInstanceUid: "1.2.3.4.5", sopInstanceUid: "1.2.3.4.5.6", frameNumber: 2 }] },
    { key: "clear", text: "no effusion", laterality: "none", evidence: [] },
  ],
  measurements: [{ id: "nodule_size", value: 8, unit: "mm" }],
  impression: ["Solitary pulmonary nodule.", "Recommend follow-up."],
};

describe("G12 SR content model (TID 1500)", () => {
  const tree = buildSrContentTree(REPORT);

  it("is a TID1500 imaging measurement report with three containers", () => {
    expect(tree.templateId).toBe("TID1500");
    expect(tree.studyInstanceUid).toBe("1.2.3.4");
    expect(tree.content.map((c) => c.conceptName?.meaning)).toEqual(["Findings", "Measurement Group", "Impression"]);
  });

  it("prefixes laterality on findings and carries image evidence refs", () => {
    const findings = tree.content[0];
    expect(findings.content?.[0].textValue).toBe("right: 8mm nodule");
    const evidence = findings.content?.[0].content ?? [];
    expect(evidence[0].valueType).toBe("IMAGE");
    expect(evidence[0].imageRef?.sopInstanceUid).toBe("1.2.3.4.5.6");
  });

  it("emits NUM measurements and a joined impression", () => {
    expect(tree.content[1].content?.[0].measuredValue).toEqual({ value: 8, unit: "mm" });
    expect(tree.content[2].textValue).toContain("Solitary pulmonary nodule.");
  });

  it("builds a per-series evidence UID map", () => {
    expect(tree.evidence).toEqual([{ studyInstanceUid: "1.2.3.4", seriesInstanceUid: "1.2.3.4.5", sopInstanceUids: ["1.2.3.4.5.6"] }]);
  });
});

describe("G17 FHIR R4 mapping", () => {
  it("maps a full bundle: ServiceRequest, ImagingStudy, Observations, DiagnosticReport", () => {
    const bundle = toFhirBundle(REPORT);
    expect(bundle.map((b) => b.resourceType)).toEqual(["ServiceRequest", "ImagingStudy", "Observation", "DiagnosticReport"]);
  });
  it("ImagingStudy carries the study UID as a urn:oid identifier", () => {
    const img = toImagingStudy(REPORT);
    expect((img.identifier as Array<{ value: string }>)[0].value).toBe("urn:oid:1.2.3.4");
  });
  it("Observation carries the measurement value+unit and subject", () => {
    const obs = toObservation(REPORT, REPORT.measurements[0]);
    expect(obs.valueQuantity).toEqual({ value: 8, unit: "mm" });
    expect(obs.subject).toEqual({ reference: "Patient/42" });
  });
  it("DiagnosticReport conclusion joins the impression lines", () => {
    const dr = toDiagnosticReport(REPORT);
    expect(dr.conclusion).toBe("Solitary pulmonary nodule.\nRecommend follow-up.");
  });
});

describe("G18 viewer deep-links", () => {
  it("builds an OHIF deep-link with study/series/instance", () => {
    const url = buildOhifDeepLink("https://viewer.example/ohif", { studyInstanceUid: "1.2.3.4", seriesInstanceUid: "1.2.3.4.5", sopInstanceUid: "1.2.3.4.5.6" });
    expect(url).toContain("StudyInstanceUIDs=1.2.3.4");
    expect(url).toContain("SeriesInstanceUID=1.2.3.4.5");
    expect(url).toContain("initialSopInstanceUid=1.2.3.4.5.6");
  });
  it("returns null without a study UID", () => {
    expect(buildOhifDeepLink("https://x/ohif", { studyInstanceUid: "" })).toBeNull();
    expect(buildWeasisDeepLink("https://x/wado", { studyInstanceUid: "" })).toBeNull();
  });
  it("Weasis deep-link narrows by series/object when a WADO URL is present", () => {
    const url = buildWeasisDeepLink("https://x/wado", { studyInstanceUid: "1.2.3.4", seriesInstanceUid: "S", sopInstanceUid: "O" });
    expect(url).toContain('weasis://$dicom:get -w "https://x/wado"');
    expect(url).toContain("studyUID=1.2.3.4&seriesUID=S&objectUID=O");
  });
  it("flags findings without a series/instance anchor", () => {
    const links = buildFindingViewerLinks("https://x/ohif", "https://x/wado", [
      { key: "a", studyInstanceUid: "1.2.3.4", seriesInstanceUid: "S", sopInstanceUid: "O" },
      { key: "b", studyInstanceUid: "1.2.3.4" },
    ]);
    expect(links[0].hasAnchor).toBe(true);
    expect(links[1].hasAnchor).toBe(false);
    expect(links[1].ohif).toContain("StudyInstanceUIDs=1.2.3.4");
  });
});

describe("G19 AI timeline shaping", () => {
  it("orders versions, feedback, and report events chronologically", () => {
    const tl = buildAiTimeline({
      studyInstanceUid: "1.2.3.4",
      drafts: [
        { version: 2, createdAtMs: 300, findingCount: 3 },
        { version: 1, createdAtMs: 100, findingCount: 2 },
      ],
      feedback: [{ createdAtMs: 200, action: "accept", findingKey: "nodule" }],
      reportEvents: [{ createdAtMs: 400, reportId: 9, event: "finalized" }],
    });
    expect(tl.entries.map((e) => e.kind)).toEqual(["ai_version", "feedback", "ai_version", "report"]);
    expect(tl.versionCount).toBe(2);
    expect(tl.latestVersion).toBe(2);
    expect(tl.feedbackCount).toBe(1);
  });
  it("breaks ties deterministically (ai_version before feedback at same ms)", () => {
    const tl = buildAiTimeline({
      studyInstanceUid: "x",
      drafts: [{ version: 1, createdAtMs: 100, findingCount: 0 }],
      feedback: [{ createdAtMs: 100, action: "edit" }],
    });
    expect(tl.entries[0].kind).toBe("ai_version");
    expect(tl.entries[1].kind).toBe("feedback");
  });
});

describe("G20 AI version comparison", () => {
  const v1 = {
    version: 1,
    modelDigest: "sha-a",
    promptVersion: "p1",
    draft: {
      findings: [
        { key: "nodule", text: "8mm nodule", laterality: "right" },
        { key: "gone", text: "trace effusion" },
      ],
      measurements: [{ id: "nodule_size", value: 8, unit: "mm" }],
      impression: ["Nodule."],
    },
  };
  const v2 = {
    version: 2,
    modelDigest: "sha-b",
    promptVersion: "p1",
    draft: {
      findings: [
        { key: "nodule", text: "10mm nodule", laterality: "right" },
        { key: "new", text: "new finding" },
      ],
      measurements: [{ id: "nodule_size", value: 10, unit: "mm" }],
      impression: ["Enlarging nodule."],
    },
  };

  it("classifies added / removed / changed findings by stable key", () => {
    const diff = compareAiVersions(v1, v2);
    expect(diff.findings.added.map((f) => f.key)).toEqual(["new"]);
    expect(diff.findings.removed.map((f) => f.key)).toEqual(["gone"]);
    expect(diff.findings.changed.map((c) => c.key)).toEqual(["nodule"]);
    expect(diff.findings.changed[0].textChanged).toBe(true);
    expect(diff.findings.changed[0].lateralityChanged).toBe(false);
  });
  it("computes measurement deltas and impression + model change", () => {
    const diff = compareAiVersions(v1, v2);
    expect(diff.measurements.changed[0]).toMatchObject({ id: "nodule_size", beforeValue: 8, afterValue: 10, delta: 2 });
    expect(diff.impression.changed).toBe(true);
    expect(diff.provenance.modelChanged).toBe(true);
    expect(diff.provenance.promptChanged).toBe(false);
    expect(diff.identical).toBe(false);
  });
  it("reports identical when nothing material differs", () => {
    const diff = compareAiVersions(v1, { ...v1, version: 3 });
    expect(diff.identical).toBe(true);
    expect(diff.findings.unchanged.sort()).toEqual(["gone", "nodule"]);
  });
});

describe("G21 human feedback dataset (no retraining — shaping only)", () => {
  it("de-identifies rows, drops invalid actions, and aggregates stats", () => {
    const ds = buildFeedbackDataset([
      { action: "accept", findingKey: "a", studyInstanceUid: "1.2.3", promptVersion: "p1", modelVersion: "m1" },
      { action: "edit", findingKey: "b", editedText: "corrected", promptVersion: "p1" },
      { action: "reject", findingKey: "c" },
      { action: "bogus", findingKey: "d" },
    ]);
    expect(ds.records.length).toBe(3);
    // No patient identifiers survive.
    expect(JSON.stringify(ds.records)).not.toContain("1.2.3");
    expect(ds.stats.total).toBe(3);
    expect(ds.stats.byAction).toEqual({ accept: 1, edit: 1, reject: 1 });
    expect(ds.stats.acceptRate).toBeCloseTo(0.333, 2);
    expect(ds.records.find((r) => r.action === "edit")?.wasEdited).toBe(true);
  });
  it("serializes records to JSONL", () => {
    const ds = buildFeedbackDataset([{ action: "accept", findingKey: "a" }]);
    const jsonl = toJsonl(ds.records);
    expect(jsonl.split("\n").length).toBe(1);
    expect(JSON.parse(jsonl)).toMatchObject({ action: "accept", findingKey: "a" });
  });
});
