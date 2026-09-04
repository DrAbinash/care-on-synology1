/**
 * normalBootstrap.test.ts — acceptance cases for the usg-reports-style
 * "COMPLETE NORMAL REPORT FIRST" auto-bootstrap on the CARE workspace.
 *
 * Covers the resolver matrix (spec §10 A / G / J / K), the pathology-format
 * firewall, baseline identity persistence (spec §8), and the NEW+EMPTY /
 * AI-draft-priority guards (spec §10 I / L). The normal→abnormal→normal
 * slot behaviors (cases B–F, H) live in observationOwnership.phase12.test.ts.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { useWorkspace } from "./store";
import { editorHasMeaningfulReportText } from "./fullReportFormat";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  bootstrapModality,
  buildCareReportFormatIdentity,
  extractCareReportFormatIdentity,
  isNormalBootstrapCandidate,
  resolveNormalBootstrapFormat,
} from "./normalBootstrap";

const FORMATS = DEFAULT_REPORT_FORMATS;

function ctx(input: {
  modality: string;
  region: string;
  studyDescription?: string;
  protocolName?: string;
}): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: input.modality,
    studyDescription: input.studyDescription ?? input.region,
    regions: [input.region],
    source: "auto",
    protocolName: input.protocolName ?? null,
  });
}

function resolve(input: Parameters<typeof resolveNormalBootstrapFormat>[0]) {
  return resolveNormalBootstrapFormat(input);
}

// ─── Acceptance A — normal Brain: complete report present ───────────────────

describe("normalBootstrap resolver — acceptance matrix", () => {
  it("A. MRI Brain Plain → MRI Brain — Normal (complete report present)", () => {
    const decision = resolve({ ctx: ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN PLAIN" }), formats: FORMATS });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.name).toBe("MRI Brain — Normal");
      // Complete: technique, findings, impression, recommendation all present.
      expect(decision.format.technique.trim()).not.toBe("");
      expect(decision.format.findings.trim()).not.toBe("");
      expect(decision.format.impression.trim()).not.toBe("");
      expect(decision.format.recommendation.trim()).not.toBe("");
      // Normal baseline: ventricles-normal sentence IS the slot baseline the
      // Hydrocephalus tile declares (case D depends on this text living in the
      // bootstrapped findings).
      expect(decision.format.findings).toContain("Ventricular system and cisternal spaces are normal");
    }
  });

  it("MRI Brain Contrast → Normal (Contrast) variant", () => {
    const decision = resolve({ ctx: ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN WITH CONTRAST" }), formats: FORMATS });
    expect(decision?.status).toBe("apply");
    expect(decision && decision.status === "apply" ? decision.format.name : "").toBe("MRI Brain — Normal (Contrast)");
  });

  it("MRI Brain Epilepsy Protocol → Epilepsy Protocol (Normal)", () => {
    const decision = resolve({ ctx: ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN EPILEPSY PROTOCOL" }), formats: FORMATS });
    expect(decision?.status).toBe("apply");
    expect(decision && decision.status === "apply" ? decision.format.name : "").toBe("MRI Brain — Epilepsy Protocol (Normal)");
  });

  it("plain marker beats contrast format even when both exist", () => {
    const decision = resolve({ ctx: ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN PLAIN" }), formats: FORMATS });
    expect(decision && decision.status === "apply" ? decision.format.name : "").not.toContain("Contrast");
  });

  it("contrast-marked study NEVER takes a plain format (spec: do not guess)", () => {
    // Library reduced to plain-only normals.
    const plainOnly = FORMATS.filter((f) => !/contrast/i.test(f.name));
    const decision = resolve({ ctx: ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN POST CONTRAST" }), formats: plainOnly });
    expect(decision?.status).toBe("no-match");
  });

  it("spine identities resolve to their own region's normal (no cross-region bleed)", () => {
    const cervical = resolve({ ctx: ctx({ modality: "MR", region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }), formats: FORMATS });
    expect(cervical && cervical.status === "apply" ? cervical.format.name : "").toBe("MRI Cervical Spine — Normal");

    const dorsal = resolve({ ctx: ctx({ modality: "MR", region: "Dorsal Spine", studyDescription: "MRI DORSAL SPINE" }), formats: FORMATS });
    expect(dorsal && dorsal.status === "apply" ? dorsal.format.name : "").toBe("MRI Dorsal Spine — Normal");

    const ls = resolve({ ctx: ctx({ modality: "MR", region: "LS Spine", studyDescription: "MRI LS SPINE" }), formats: FORMATS });
    expect(ls && ls.status === "apply" ? ls.format.name : "").toBe("MRI LS Spine — Normal");
  });

  it("G. LS + Whole Spine Screening → the NORMAL variant, mandatory screening phrase intact", () => {
    const decision = resolve({
      ctx: ctx({ modality: "MR", region: "LS Spine", studyDescription: "MRI LS SPINE WITH WHOLE SPINE SCREENING" }),
      formats: FORMATS,
    });
    expect(decision?.status).toBe("apply");
    if (decision?.status === "apply") {
      expect(decision.format.name).toBe("MRI LS Spine + Whole Spine Screening — Normal");
      // Mandatory screening discipline phrase must survive the bootstrap.
      expect(decision.format.technique.toLowerCase()).toContain("limited planar and limited sequence");
      expect(decision.format.findings).toContain("CERVICAL SPINE SCREENING");
      expect(decision.format.findings).toContain("DORSAL SPINE SCREENING");
    }
  });

  it("cervical/dorsal screening identity → screening normal variants", () => {
    const dorsal = resolve({ ctx: ctx({ modality: "MR", region: "Dorsal Spine", studyDescription: "MRI DORSAL SPINE SCREENING" }), formats: FORMATS });
    expect(dorsal && dorsal.status === "apply" ? dorsal.format.name : "").toBe("MRI Dorsal Spine — Screening");
  });

  it("CT Brain → CT Brain — Normal; DX (X-ray) maps to XR formats", () => {
    const ct = resolve({ ctx: ctx({ modality: "CT", region: "Brain", studyDescription: "CT BRAIN PLAIN" }), formats: FORMATS });
    expect(ct && ct.status === "apply" ? ct.format.name : "").toBe("CT Brain — Normal");

    const xr = resolve({ ctx: ctx({ modality: "DX", region: "LS Spine", studyDescription: "X-RAY LS SPINE AP/LAT" }), formats: FORMATS });
    expect(xr && xr.status === "apply" ? xr.format.name : "").toBe("XR LS Spine — Normal");
  });

  it("K. ambiguous / out-of-scope identities never guess", () => {
    // Unresolved region → null (retry-able, not a decision).
    expect(resolve({ ctx: { modality: "MR", region: "", regions: [], protocolName: null, studyDescription: "MRI" }, formats: FORMATS })).toBeNull();
    // US / MG out of bootstrap scope (mammography not used at this clinic).
    const us = resolve({ ctx: ctx({ modality: "US", region: "Abdomen", studyDescription: "USG WHOLE ABDOMEN" }), formats: FORMATS });
    expect(us?.status).toBe("no-match");
    const mg = resolve({ ctx: ctx({ modality: "MG", region: "Breast", studyDescription: "BILATERAL MAMMOGRAPHY" }), formats: FORMATS });
    expect(mg?.status).toBe("no-match");
    // Whole Spine screening region resolves to the NORMAL whole-spine
    // screening format (the "— Cervical + Dorsal" sibling is pathological and
    // is rejected by the candidate firewall).
    const whole = resolve({ ctx: ctx({ modality: "MR", region: "Whole Spine", studyDescription: "MRI WHOLE SPINE SCREENING" }), formats: FORMATS });
    expect(whole?.status).toBe("apply");
    expect(whole && whole.status === "apply" ? whole.format.name : "").toBe("MRI Whole Spine — Screening");
    // Unknown region → no formats for the region.
    const knee = resolve({ ctx: ctx({ modality: "MR", region: "Knee", studyDescription: "MRI KNEE" }), formats: FORMATS });
    expect(knee?.status).toBe("no-match");
  });

  it("J. pathology / abnormal complete-case formats NEVER auto-apply", () => {
    // Every apply decision across a broad identity sweep must land on a
    // complete-normal format (verified by the candidate firewall itself).
    const sweep = [
      ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN PLAIN" }),
      ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN POST CONTRAST" }),
      ctx({ modality: "MR", region: "Brain", studyDescription: "MRI BRAIN EPILEPSY PROTOCOL" }),
      ctx({ modality: "MR", region: "Cervical Spine", studyDescription: "MRI CERVICAL SPINE" }),
      ctx({ modality: "MR", region: "Dorsal Spine", studyDescription: "MRI DORSAL SPINE" }),
      ctx({ modality: "MR", region: "LS Spine", studyDescription: "MRI LS SPINE" }),
      ctx({ modality: "MR", region: "LS Spine", studyDescription: "MRI LS SPINE WITH WHOLE SPINE SCREENING" }),
      ctx({ modality: "CT", region: "Brain", studyDescription: "CT BRAIN" }),
      ctx({ modality: "CT", region: "Chest", studyDescription: "CT CHEST" }),
      ctx({ modality: "DX", region: "LS Spine", studyDescription: "X-RAY LS SPINE" }),
    ];
    for (const c of sweep) {
      const decision = resolve({ ctx: c, formats: FORMATS });
      if (decision?.status !== "apply") continue; // no-match is fine (fail safe)
      expect(isNormalBootstrapCandidate(decision.format)).toBe(true);
      expect(decision.format.name).not.toMatch(/fazekas|infarct|hemorrhage|hydrocephalus|degenerative|spondylolisthesis|fracture|herniation|myelopathy|spondylodiscitis|glioma|demyelination|ncc|sdh|senile|carcinoma/i);
    }
  });

  it("J (direct). the pathological complete-case formats are not candidates", () => {
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI LS Spine + Whole Spine Screening")!)).toBe(false);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Whole Spine Screening — Cervical + Dorsal")!)).toBe(false);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Brain — Fazekas 2")!)).toBe(false);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Brain — Hydrocephalus")!)).toBe(false);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI LS Spine — Multilevel Degenerative")!)).toBe(false);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "CT Brain — Acute infarct (MCA)")!)).toBe(false);
    // Genuine complete-normal reports ARE candidates.
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Brain — Normal")!)).toBe(true);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI LS Spine + Whole Spine Screening — Normal")!)).toBe(true);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Whole Spine — Screening")!)).toBe(true);
  });

  it("denied pathology terms do not disqualify a normal format (no false negatives)", () => {
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Dorsal Spine — Normal")!)).toBe(true);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "CT Chest — Normal")!)).toBe(true);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "XR LS Spine — Normal")!)).toBe(true);
    expect(isNormalBootstrapCandidate(FORMATS.find((f) => f.name === "MRI Cervical Spine — Screening")!)).toBe(true);
  });
});

// ─── Modality mapping ────────────────────────────────────────────────────────

describe("bootstrapModality", () => {
  it("maps MR/MRI, CT, XR/DX/CR onto format modalities", () => {
    expect(bootstrapModality("MR")).toBe("MR");
    expect(bootstrapModality("MRI")).toBe("MR");
    expect(bootstrapModality("CT")).toBe("CT");
    expect(bootstrapModality("XR")).toBe("XR");
    expect(bootstrapModality("DX")).toBe("XR");
    expect(bootstrapModality("CR")).toBe("XR");
    expect(bootstrapModality("US")).toBeNull();
    expect(bootstrapModality("MG")).toBeNull();
    expect(bootstrapModality(null)).toBeNull();
  });
});

// ─── Baseline format identity (spec §8 save/reopen) ─────────────────────────

describe("careReportFormatIdentity", () => {
  it("round-trips direct and envelope-wrapped (compose-compatible) shapes", () => {
    const identity = buildCareReportFormatIdentity({ name: "MRI Brain — Normal", reportTitle: "MRI BRAIN PLAIN" });
    expect(identity.kind).toBe("care.report_format_identity.v1");
    expect(identity.name).toBe("MRI Brain — Normal");
    expect(identity.reportTitle).toBe("MRI BRAIN PLAIN");
    expect(typeof identity.appliedAt).toBe("string");

    expect(extractCareReportFormatIdentity(identity)).toEqual(identity);
    expect(extractCareReportFormatIdentity({ kind: "care.structured_json_envelope", careReportFormatIdentity: identity }))
      .toEqual(identity);
    expect(extractCareReportFormatIdentity({ someOther: 1 })).toBeNull();
    expect(extractCareReportFormatIdentity(null)).toBeNull();
    expect(extractCareReportFormatIdentity({ kind: "care.report_format_identity.v1" })).toBeNull();
  });
});

// ─── NEW+EMPTY guards + AI priority (spec §10 I / L) via the real store ─────

describe("bootstrap guards against the workspace store", () => {
  beforeEach(() => {
    useWorkspace.setState({
      findingsText: "",
      impressionText: "",
      recommendationText: "",
      techniqueText: "",
      clinicalHistoryText: "",
      fieldProvenance: {},
      appliedPathologyPatches: [],
      impressionNeedsRefresh: false,
      lastPatchSnapshot: null,
      confirmOverwriteOpen: false,
      pendingPathologyPatch: null,
      appliedFormatReportTitle: null,
      appliedFormatName: null,
      reportingContext: ctx({ modality: "MR", region: "Brain" }),
      reportFormats: DEFAULT_REPORT_FORMATS,
      selectedFormatIds: [],
      isFinalized: false,
    });
  });

  it("I. a genuinely new EMPTY report qualifies for bootstrap", () => {
    const s = useWorkspace.getState();
    expect(editorHasMeaningfulReportText({
      technique: s.techniqueText,
      findings: s.findingsText,
      impression: s.impressionText,
      recommendation: s.recommendationText,
    })).toBe(false);
  });

  it("I. any meaningful content (existing abnormal report) blocks re-bootstrap", () => {
    // An existing abnormal report: findings carry an abnormal observation.
    useWorkspace.setState({ findingsText: "Restricted diffusion in the left MCA territory, consistent with acute infarct." });
    const s = useWorkspace.getState();
    expect(editorHasMeaningfulReportText({
      technique: s.techniqueText,
      findings: s.findingsText,
      impression: s.impressionText,
      recommendation: s.recommendationText,
    })).toBe(true);
  });

  it("I. AI-draft content also blocks the bootstrap (content is content)", () => {
    useWorkspace.setState({ techniqueText: "AI-drafted technique text", fieldProvenance: { technique: {} } });
    const s = useWorkspace.getState();
    expect(editorHasMeaningfulReportText({
      technique: s.techniqueText,
      findings: s.findingsText,
      impression: s.impressionText,
      recommendation: s.recommendationText,
    })).toBe(true);
  });

  it("L. baseline applied first → AI-draft setFieldIfEmpty cannot overwrite it", () => {
    // Simulate the bootstrap applying the normal format through the ordinary
    // format-apply path (what applyFormatById does for a blank report).
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    useWorkspace.getState().setField("technique", format.technique, { source: "template", replaceProvenance: true });
    useWorkspace.getState().setField("findings", format.findings, { source: "template", replaceProvenance: true });
    useWorkspace.getState().setField("impression", format.impression, { source: "template", replaceProvenance: true });
    useWorkspace.setState({ appliedFormatName: format.name, appliedFormatReportTitle: format.reportTitle || null });

    // The AI-draft fill-empty path (workspace open, async response arrives).
    const s = useWorkspace.getState();
    s.setFieldIfEmpty("findings", "AI-generated findings text", "ai-draft");
    s.setFieldIfEmpty("impression", "AI-generated impression text", "ai-draft");
    s.setFieldIfEmpty("technique", "AI-generated technique text", "ai-draft");

    // The verified Full Report Format baseline wins; AI may only polish via
    // the explicit Draft Report action afterwards.
    expect(useWorkspace.getState().findingsText).toBe(format.findings);
    expect(useWorkspace.getState().impressionText).toBe(format.impression);
    expect(useWorkspace.getState().techniqueText).toBe(format.technique);
    expect(useWorkspace.getState().appliedFormatName).toBe("MRI Brain — Normal");
  });

  it("B+D-ready: the bootstrapped Brain normal carries the exact ventricles baseline the Hydrocephalus tile replaces", () => {
    const format = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
    useWorkspace.getState().setField("findings", format.findings, { source: "template", replaceProvenance: true });

    // Hydrocephalus quick-select overlay (same ownership metadata as the tile).
    const result = useWorkspace.getState().applyPathologyOverlay({
      incoming: {
        findings: "The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",
        impression: "Hydrocephalus.",
      },
      templates: {
        findings: "The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",
        impression: "Hydrocephalus.",
      },
      ownership: {
        concept: "ventricles",
        conflictGroup: "hydrocephalus",
        baselineReplaces: "Ventricular system and cisternal spaces are normal in size and configuration. No midline shift.",
      },
      source: "quick-select",
      id: "qf-hydro-test",
      region: "Brain",
      label: "Hydrocephalus",
      findingsText: "The ventricular system is dilated, consistent with hydrocephalus. No midline shift.",
    });

    expect(result).toBe("applied");
    const findings = useWorkspace.getState().findingsText;
    // Abnormal inserted; contradictory normal ventricles statement yielded;
    // unrelated normal sentences (parenchyma, diffusion, flow voids) remain.
    expect(findings).toContain("hydrocephalus");
    expect(findings).not.toContain("Ventricular system and cisternal spaces are normal");
    expect(findings).toContain("No restricted diffusion");
    expect(findings).toContain("Flow voids");
    // The ledger recorded the replaced baseline so deselect can restore it.
    const patch = useWorkspace.getState().appliedPathologyPatches.find((p) => p.id === "qf-hydro-test");
    expect(patch?.replacedBaseline.findings.join(" ")).toContain("Ventricular system and cisternal spaces are normal");
  });
});
