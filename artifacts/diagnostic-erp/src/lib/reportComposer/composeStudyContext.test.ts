/**
 * Golden tests: Background AI Report Composer receives canonical
 * ReportingStudyContext.
 *
 * Coverage (A–M from PR brief P0-2):
 *   A. MRI BRAIN PLAIN — context flows into snapshot.
 *   B. MRI BRAIN EPILEPSY PROTOCOL — protocol is not undefined; prompt
 *      receives "Epilepsy Protocol".
 *   C. MRI LS Spine — region / family / spineSegment all survive.
 *   D. MRI LS Spine + Whole Spine Screening — primary region preserved;
 *      regions[] carries screening context; AI does NOT flatten into generic
 *      "Whole Spine".
 *   E. MRI Cervical Spine + Whole Spine Screening — primary region preserved;
 *      spineSegment = cervical; screening context preserved.
 *   F. Full Report Format title — composer receives the PRINTED heading, not
 *      the library/display format name.
 *   G. DICOM description conflict — CARE ReportingStudyContext stays
 *      authoritative; StudyDescription is only descriptive provenance.
 *   H. Unknown context — no crash; undefined optional values stay undefined;
 *      no guessed values.
 *   I. Legacy snapshot — old ComposerInputSnapshot without new context
 *      fields still parses server-side.
 *   J. Frozen context — enqueue with protocol=Plain then live workspace
 *      changes to Contrast: queued job retains Plain; inputHash differs
 *      between the two states (so the worker cannot re-use the stale frozen
 *      snapshot).
 *   K. Region change — enqueue LS Spine + Whole Spine Screening then remove
 *      screening region: inputHash differs (frozen snapshot is locked).
 *   L. PR #654 observations — canonical observations still survive unchanged
 *      alongside the new study context.
 *   M. Client/server hash equivalence — same snapshot produces identical
 *      canonical hash behavior client/server (incl. study context payload).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { useWorkspace } from "@/lib/zai-workspace/store";
import { buildReportingStudyContext, type ReportingStudyContext } from "@/lib/reportingStudyContext";
import { resolvePrintedReportTitle } from "@/lib/zai-workspace/fullReportFormat";
import { DEFAULT_REPORT_FORMATS } from "@/lib/zai-workspace/report-formats-library";
import {
  canonicalStudyContextHashPayload,
  computeSnapshotHashes,
  type ComposerInputSnapshot,
} from "@/lib/reportComposer/types";
import {
  canonicalStudyContextHashPayload as serverCanonicalStudyContextHashPayload,
  computeSnapshotHashes as serverComputeSnapshotHashes,
} from "../../../../api-server/src/lib/reportComposer/snapshot";
import {
  ComposeObservationSchema,
  ComposerInputSnapshotSchema,
  parseComposerSnapshot,
} from "../../../../api-server/src/lib/reportComposer/types";
import { buildUserPrompt } from "../../../../api-server/src/lib/reportComposer/composeEngine";
import type { AiComposeJobKind } from "@workspace/db/schema";

// ─── helpers ──────────────────────────────────────────────────────────────

function ctx(opts: Partial<ReportingStudyContext> & { regions: string[] }): ReportingStudyContext {
  return buildReportingStudyContext({
    modality: opts.modality ?? "MR",
    studyDescription: opts.studyDescription ?? null,
    dicomBodyPart: opts.dicomBodyPart ?? null,
    regions: opts.regions,
    source: opts.source ?? "auto",
    protocolName: opts.protocolName ?? null,
  });
}

function snapshotWith(
  context: Partial<ComposerInputSnapshot> = {},
): ComposerInputSnapshot {
  return {
    modality: "MR",
    region: "LS Spine",
    regions: ["LS Spine"],
    bodyPart: "SPINE_LUMBAR",
    family: "spine",
    spineSegment: "lumbar",
    studyType: "MRI LS Spine",
    protocol: "Plain",
    reportTitle: "MRI LUMBOSACRAL SPINE PLAIN",
    clinicalHistory: "Back pain.",
    technique: "Sagittal T1, T2; axial T2.",
    findings: "Diffuse disc bulge at L4-L5.",
    impression: "Mild disc bulge at L4-L5.",
    recommendation: "Conservative management.",
    observations: [],
    jobKindHint: "FULL_REPORT",
    ...context,
  };
}

// ─── reset workspace between tests ────────────────────────────────────────

function resetWorkspace() {
  useWorkspace.setState({
    findingsText: "",
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    voiceComposerObservations: [],
    voiceComposerTranscriptHistory: [],
    lastPatchSnapshot: null,
    confirmOverwriteOpen: false,
    pendingPathologyPatch: null,
    isFinalized: false,
    isDirty: false,
    impressionNeedsRefresh: false,
    selectedObservationId: null,
    ownershipReviewWarnings: [],
    ledgerHydrationWarning: null,
    appliedFormatReportTitle: null,
    appliedFormatName: null,
    reportingContext: buildReportingStudyContext({ regions: [], source: "unresolved" }),
  });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe("composeStudyContext — golden tests A–M (P0-2)", () => {
  beforeEach(() => resetWorkspace());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("A. MRI BRAIN PLAIN — canonical context flows into snapshot", async () => {
    const c = ctx({
      modality: "MR",
      regions: ["Brain"],
      studyDescription: "MRI Brain Plain",
      protocolName: "Plain",
    });
    expect(c.region).toBe("Brain");
    expect(c.family).toBe("brain");
    expect(c.protocolName).toBe("Plain");

    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      bodyPart: c.bodyPart ?? undefined,
      family: c.family,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI Brain Plain"),
      studyType: c.studyDescription ?? undefined,
    });
    expect(snap.region).toBe("Brain");
    expect(snap.family).toBe("brain");
    expect(snap.protocol).toBe("Plain");
    expect(snap.reportTitle).toBe("MRI Brain Plain");

    const hashes = await computeSnapshotHashes(snap);
    expect(hashes.inputHash).toBeTruthy();
    expect(hashes.reportRevision).toBeTruthy();
  });

  it("B. MRI BRAIN EPILEPSY PROTOCOL — protocol is NOT undefined; prompt receives it", () => {
    const c = ctx({
      modality: "MR",
      regions: ["Brain"],
      studyDescription: "MRI Brain",
      protocolName: "Epilepsy Protocol",
    });
    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      family: c.family,
      bodyPart: c.bodyPart ?? undefined,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI Brain"),
      studyType: c.studyDescription ?? undefined,
    });
    expect(snap.protocol).toBe("Epilepsy Protocol");

    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toMatch(/Protocol: Epilepsy Protocol/);
  });

  it("C. MRI LS Spine — region / family / spineSegment all survive into frozen snapshot", () => {
    const c = ctx({
      modality: "MR",
      regions: ["LS Spine"],
      studyDescription: "MRI LS Spine",
      protocolName: "Plain",
    });
    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      bodyPart: c.bodyPart ?? undefined,
      family: c.family,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI LS Spine"),
      studyType: c.studyDescription ?? undefined,
    });
    expect(snap.region).toBe("LS Spine");
    expect(snap.family).toBe("spine");
    expect(snap.spineSegment).toBe("lumbar");

    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toMatch(/Primary region: LS Spine/);
    expect(prompt).toMatch(/Family: spine/);
    expect(prompt).toMatch(/Spine segment: lumbar/);
  });

  it("D. MRI LS Spine + Whole Spine Screening — primary region preserved; regions[] carries screening; not flattened to generic Whole Spine", () => {
    const c = ctx({
      modality: "MR",
      regions: ["LS Spine", "Whole Spine Screening"],
      studyDescription: "MRI LS Spine",
      protocolName: "Plain",
    });
    // Primary region remains LS Spine, not "Whole Spine".
    expect(c.region).toBe("LS Spine");
    expect(c.regions).toEqual(["LS Spine", "Whole Spine Screening"]);

    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      bodyPart: c.bodyPart ?? undefined,
      family: c.family,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle("MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING", ""),
      studyType: c.studyDescription ?? undefined,
    });
    expect(snap.region).toBe("LS Spine");
    expect(snap.regions).toEqual(["LS Spine", "Whole Spine Screening"]);
    expect(snap.reportTitle).toBe("MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING");

    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toMatch(/Primary region: LS Spine/);
    expect(prompt).toMatch(/Additional regions: Whole Spine Screening/);
    // Must NOT flatten into generic Whole Spine.
    expect(prompt).not.toMatch(/Primary region: Whole Spine\b/);
  });

  it("E. MRI Cervical Spine + Whole Spine Screening — primary region preserved; spineSegment=cervical; screening context preserved", () => {
    const c = ctx({
      modality: "MR",
      regions: ["Cervical Spine", "Whole Spine Screening"],
      studyDescription: "MRI Cervical Spine",
      protocolName: "Plain",
    });
    expect(c.region).toBe("Cervical Spine");
    expect(c.spineSegment).toBe("cervical");

    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      bodyPart: c.bodyPart ?? undefined,
      family: c.family,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle("MRI CERVICAL SPINE WITH WHOLE SPINE SCREENING", ""),
      studyType: c.studyDescription ?? undefined,
    });
    expect(snap.region).toBe("Cervical Spine");
    expect(snap.spineSegment).toBe("cervical");
    expect(snap.regions).toEqual(["Cervical Spine", "Whole Spine Screening"]);

    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toMatch(/Primary region: Cervical Spine/);
    expect(prompt).toMatch(/Spine segment: cervical/);
    expect(prompt).toMatch(/Additional regions: Whole Spine Screening/);
  });

  it("F. Full Report Format title — composer receives the PRINTED heading, not the library/display format name", () => {
    const fazFormat = DEFAULT_REPORT_FORMATS.find(
      (f) => f.name === "MRI Brain — Fazekas Grade 1 + Senile Changes",
    );
    expect(fazFormat).toBeTruthy();
    // Library/display name (would be wrong to send as reportTitle):
    const libraryName = fazFormat!.name;
    // Printed heading (the format.reportTitle field — the canonical printed title):
    const printedHeading = (fazFormat as unknown as { reportTitle?: string }).reportTitle ?? "MRI BRAIN PLAIN";
    expect(libraryName).not.toBe(printedHeading);

    // Simulate that a Full Report Format has been applied — the workspace
    // stores `appliedFormatReportTitle` (printed heading), not
    // `appliedFormatName` (library name). resolvePrintedReportTitle returns
    // the printed heading.
    useWorkspace.setState({
      appliedFormatReportTitle: printedHeading,
      appliedFormatName: libraryName,
    });
    const fallback = "MRI Brain";
    const resolved = resolvePrintedReportTitle(
      useWorkspace.getState().appliedFormatReportTitle,
      fallback,
    );
    expect(resolved).toBe(printedHeading);
    expect(resolved).not.toBe(libraryName);

    const snap = snapshotWith({ reportTitle: resolved });
    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    expect(prompt).toMatch(/Report title: MRI BRAIN PLAIN/);
    expect(prompt).not.toMatch(/Report title: MRI Brain — Fazekas Grade 1/);
  });

  it("G. DICOM description conflict — CARE ReportingStudyContext remains authoritative; StudyDescription is descriptive provenance only", () => {
    // DICOM StudyDescription is generic ("MR SPINE"); CARE resolves it to
    // LS Spine / spine / lumbar / Plain.
    const c = ctx({
      modality: "MR",
      regions: ["LS Spine"],
      studyDescription: "MR SPINE",
      dicomBodyPart: "SPINE",
      protocolName: "Plain",
    });
    expect(c.region).toBe("LS Spine");
    expect(c.family).toBe("spine");
    expect(c.spineSegment).toBe("lumbar");

    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      bodyPart: c.bodyPart ?? undefined,
      family: c.family,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI LUMBOSACRAL SPINE PLAIN"),
      // studyType carries the DICOM description (provenance only):
      studyType: c.studyDescription ?? undefined,
    });
    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    // CARE resolved context wins:
    expect(prompt).toMatch(/Primary region: LS Spine/);
    expect(prompt).toMatch(/Family: spine/);
    expect(prompt).toMatch(/Spine segment: lumbar/);
    expect(prompt).toMatch(/Protocol: Plain/);
    // DICOM description appears only as secondary provenance, never as region:
    expect(prompt).toMatch(/DICOM study description: MR SPINE/);
    expect(prompt).not.toMatch(/Primary region: MR SPINE/);
  });

  it("H. Unknown context — no crash; undefined optional values stay undefined; no guessed values", () => {
    const c = buildReportingStudyContext({
      modality: null,
      regions: [],
      source: "unresolved",
    });
    expect(c.region).toBeNull();
    expect(c.family).toBe("unknown");
    expect(c.spineSegment).toBeNull();
    expect(c.protocolName).toBeNull();
    expect(c.bodyPart).toBeNull();

    const snap = snapshotWith({
      modality: c.modality ?? undefined,
      region: c.region ?? undefined,
      regions: c.regions,
      bodyPart: c.bodyPart ?? undefined,
      family: c.family,
      spineSegment: c.spineSegment ?? undefined,
      protocol: c.protocolName ?? undefined,
      reportTitle: undefined,
      studyType: undefined,
    });
    expect(snap.region).toBeUndefined();
    expect(snap.protocol).toBeUndefined();
    expect(snap.spineSegment).toBeUndefined();
    expect(snap.reportTitle).toBeUndefined();

    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, snap);
    // Prompt MUST NOT contain "undefined" or invented values.
    expect(prompt).not.toMatch(/undefined/);
    expect(prompt).not.toMatch(/Primary region:/);
    expect(prompt).not.toMatch(/Protocol:/);
  });

  it("I. Legacy snapshot — old ComposerInputSnapshot without new context fields still parses server-side", () => {
    // Simulate an old snapshot produced BEFORE this PR — no regions[], no
    // bodyPart, no family, no spineSegment.
    const legacySnapshot = {
      modality: "MR",
      region: "LS Spine",
      studyType: "MRI LS Spine",
      protocol: "Plain",
      reportTitle: "MRI LUMBOSACRAL SPINE",
      findings: "Disc bulge at L4-L5.",
      impression: "Mild disc bulge.",
      recommendation: "",
      observations: [],
    };
    const parsed = parseComposerSnapshot(legacySnapshot);
    expect(parsed.region).toBe("LS Spine");
    expect(parsed.protocol).toBe("Plain");
    // New fields are optional and remain absent on legacy snapshots (no
    // default value). The server-side computeSnapshotHashes treats absent
    // regions as [] via `(s.regions ?? [])` — see canonicalStudyContextHashPayload.
    expect(parsed.regions).toBeUndefined();
    expect(parsed.bodyPart).toBeUndefined();
    expect(parsed.family).toBeUndefined();
    expect(parsed.spineSegment).toBeUndefined();
  });

  it("J. Frozen context — enqueue with protocol=Plain then live workspace changes to Contrast; inputHash differs (frozen snapshot is locked)", async () => {
    const c1 = ctx({
      modality: "MR",
      regions: ["Brain"],
      studyDescription: "MRI Brain",
      protocolName: "Plain",
    });
    const snap1 = snapshotWith({
      modality: c1.modality ?? undefined,
      region: c1.region ?? undefined,
      regions: c1.regions,
      bodyPart: c1.bodyPart ?? undefined,
      family: c1.family,
      spineSegment: c1.spineSegment ?? undefined,
      protocol: c1.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI BRAIN PLAIN"),
      studyType: c1.studyDescription ?? undefined,
    });
    const hash1 = await computeSnapshotHashes(snap1);

    // Radiologist changes protocol to Contrast BEFORE the AI returns.
    const c2 = ctx({
      modality: "MR",
      regions: ["Brain"],
      studyDescription: "MRI Brain",
      protocolName: "Contrast",
    });
    const snap2 = snapshotWith({
      modality: c2.modality ?? undefined,
      region: c2.region ?? undefined,
      regions: c2.regions,
      bodyPart: c2.bodyPart ?? undefined,
      family: c2.family,
      spineSegment: c2.spineSegment ?? undefined,
      protocol: c2.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI BRAIN CONTRAST"),
      studyType: c2.studyDescription ?? undefined,
    });
    const hash2 = await computeSnapshotHashes(snap2);

    // The frozen snapshot for the queued job (snap1) is locked — the worker
    // never re-reads live workspace context. But the live recompute MUST
    // produce a different inputHash so the freshness check can flag mismatch
    // (the existing STALE_READY path uses reportRevision for narrative
    // changes; for study-context changes the inputHash is what guards the
    // frozen snapshot).
    expect(snap1.protocol).toBe("Plain");
    expect(snap2.protocol).toBe("Contrast");
    expect(hash1.inputHash).not.toBe(hash2.inputHash);
  });

  it("K. Region change — enqueue LS Spine + Whole Spine Screening then remove screening region; inputHash differs (frozen snapshot is locked)", async () => {
    const c1 = ctx({
      modality: "MR",
      regions: ["LS Spine", "Whole Spine Screening"],
      studyDescription: "MRI LS Spine",
      protocolName: "Plain",
    });
    const snap1 = snapshotWith({
      modality: c1.modality ?? undefined,
      region: c1.region ?? undefined,
      regions: c1.regions,
      bodyPart: c1.bodyPart ?? undefined,
      family: c1.family,
      spineSegment: c1.spineSegment ?? undefined,
      protocol: c1.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle("MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING", ""),
      studyType: c1.studyDescription ?? undefined,
    });
    const hash1 = await computeSnapshotHashes(snap1);

    // Radiologist removes the screening region BEFORE the AI returns.
    const c2 = ctx({
      modality: "MR",
      regions: ["LS Spine"],
      studyDescription: "MRI LS Spine",
      protocolName: "Plain",
    });
    const snap2 = snapshotWith({
      modality: c2.modality ?? undefined,
      region: c2.region ?? undefined,
      regions: c2.regions,
      bodyPart: c2.bodyPart ?? undefined,
      family: c2.family,
      spineSegment: c2.spineSegment ?? undefined,
      protocol: c2.protocolName ?? undefined,
      reportTitle: resolvePrintedReportTitle(null, "MRI LUMBOSACRAL SPINE PLAIN"),
      studyType: c2.studyDescription ?? undefined,
    });
    const hash2 = await computeSnapshotHashes(snap2);

    expect(snap1.regions).toEqual(["LS Spine", "Whole Spine Screening"]);
    expect(snap2.regions).toEqual(["LS Spine"]);
    expect(hash1.inputHash).not.toBe(hash2.inputHash);
  });

  it("L. PR #654 observations — canonical observations still survive unchanged alongside the new study context", async () => {
    const snap = snapshotWith({
      region: "LS Spine",
      regions: ["LS Spine"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      protocol: "Plain",
      reportTitle: "MRI LUMBOSACRAL SPINE PLAIN",
      observations: [
        {
          concept: "disc_contour",
          source: "quick-findings",
          region: "LS Spine",
          level: "L4-L5",
          severity: "mild",
          findingsText: "Mild diffuse disc bulge at L4-L5.",
          impressionText: "Mild disc bulge at L4-L5.",
        },
      ],
    });
    // Schema validation passes — observations shape unchanged from PR #654.
    const parsed = parseComposerSnapshot(snap);
    expect(parsed.observations).toHaveLength(1);
    expect(parsed.observations[0]!.concept).toBe("disc_contour");
    expect(parsed.observations[0]!.level).toBe("L4-L5");

    const prompt = buildUserPrompt("FULL_REPORT" as AiComposeJobKind, parsed);
    expect(prompt).toMatch(/Primary region: LS Spine/);
    expect(prompt).toMatch(/Protocol: Plain/);
    expect(prompt).toMatch(/LS Spine \| L4-L5 \| disc_contour/);
    expect(prompt).toMatch(/Mild diffuse disc bulge at L4-L5/);
  });

  it("M. Client/server hash equivalence — same snapshot produces identical canonical hash behavior client/server (incl. study context payload)", async () => {
    const snap = snapshotWith({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      protocol: "Plain",
      reportTitle: "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING",
      studyType: "MRI LS Spine",
    });
    // 1. canonicalStudyContextHashPayload — client vs server MUST match.
    expect(canonicalStudyContextHashPayload(snap)).toBe(
      serverCanonicalStudyContextHashPayload(snap),
    );
    // 2. computeSnapshotHashes — client uses async WebCrypto SHA-256 (32 hex),
    //    server uses Node crypto SHA-256 (32 hex). All 5 outputs MUST match.
    const clientHash = await computeSnapshotHashes(snap);
    const serverHash = serverComputeSnapshotHashes(snap);
    expect(clientHash.findingsHash).toBe(serverHash.findingsHash);
    expect(clientHash.impressionHash).toBe(serverHash.impressionHash);
    expect(clientHash.recommendationHash).toBe(serverHash.recommendationHash);
    expect(clientHash.inputHash).toBe(serverHash.inputHash);
    expect(clientHash.reportRevision).toBe(serverHash.reportRevision);
  });
});

// ─── Regression / drift guards ───────────────────────────────────────────

describe("composeStudyContext — regression guards", () => {
  it("study context change does NOT alter reportRevision (only inputHash)", async () => {
    // reportRevision guards the clinically EDITABLE report state (narrative +
    // observations). Study-context changes are STUDY IDENTITY, captured by
    // inputHash (frozen snapshot), NOT by reportRevision. This preserves the
    // existing stale-apply safety model: changing the protocol or region
    // while a job is queued does NOT mark the prior READY draft STALE_READY
    // (that path uses reportRevision); instead the worker's frozen snapshot
    // is what carries the original context, and the freshness check is
    // responsible for re-evaluating narrative drift.
    const base = snapshotWith({
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
    });
    const changed = snapshotWith({
      protocol: "Contrast",
      reportTitle: "MRI BRAIN CONTRAST",
    });
    const h1 = await computeSnapshotHashes(base);
    const h2 = await computeSnapshotHashes(changed);
    expect(h1.reportRevision).toBe(h2.reportRevision); // narrative unchanged
    expect(h1.inputHash).not.toBe(h2.inputHash); // frozen snapshot differs
  });

  it("adding regions[] to a legacy snapshot produces a different inputHash but the same reportRevision", async () => {
    const legacy = snapshotWith({
      region: "LS Spine",
      // no regions[]
    });
    delete (legacy as Partial<ComposerInputSnapshot>).regions;
    const enriched = snapshotWith({
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
    });
    const h1 = await computeSnapshotHashes(legacy);
    const h2 = await computeSnapshotHashes(enriched);
    expect(h1.reportRevision).toBe(h2.reportRevision); // narrative unchanged
    expect(h1.inputHash).not.toBe(h2.inputHash); // study context differs
  });

  it("ComposeObservation schema still validates PR #654 observations (no regression)", () => {
    const r = ComposeObservationSchema.safeParse({
      concept: "disc_contour",
      source: "quick-findings",
      region: "LS Spine",
      level: "L4-L5",
      severity: "mild",
      laterality: "right",
      findingsText: "Disc bulge at L4-L5.",
      impressionText: "Mild disc bulge.",
      anatomicalSection: "disc",
      conflictGroup: "disc bulge",
      baselineReplaces: "No significant disc bulge.",
    });
    expect(r.success).toBe(true);
  });

  it("ComposerInputSnapshotSchema accepts legacy snapshot (no regions/bodyPart/family/spineSegment)", () => {
    const r = ComposerInputSnapshotSchema.safeParse({
      modality: "MR",
      region: "Brain",
      studyType: "MRI Brain",
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      findings: "",
      impression: "",
      recommendation: "",
      observations: [],
    });
    expect(r.success).toBe(true);
  });

  it("ComposerInputSnapshotSchema accepts enriched snapshot with new context fields", () => {
    const r = ComposerInputSnapshotSchema.safeParse({
      modality: "MR",
      region: "LS Spine",
      regions: ["LS Spine", "Whole Spine Screening"],
      bodyPart: "SPINE_LUMBAR",
      family: "spine",
      spineSegment: "lumbar",
      studyType: "MRI LS Spine",
      protocol: "Plain",
      reportTitle: "MRI LUMBOSACRAL SPINE WITH WHOLE SPINE SCREENING",
      findings: "",
      impression: "",
      recommendation: "",
      observations: [],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.regions).toEqual(["LS Spine", "Whole Spine Screening"]);
      expect(r.data.bodyPart).toBe("SPINE_LUMBAR");
      expect(r.data.family).toBe("spine");
      expect(r.data.spineSegment).toBe("lumbar");
    }
  });
});

// ─── PR #656 — final freshness hardening (cross-package) ─────────────────
//
// PR #656 closes the final P0-2 blocker: study-context changes (Plain →
// Contrast, LS Spine + Screening → LS Spine only, bodyPart/family/
// spineSegment change, reportTitle change) MUST flip READY → STALE_READY
// even when narrative text + observations are byte-identical. The server's
// pure `isComposeJobStale` helper accepts the client-computed live
// `inputHash` and compares it against the stored enqueue-time inputHash.
//
// These cross-package tests live here (on the diagnostic-erp side) because
// api-server's tsconfig enforces `rootDir: "src"` and refuses cross-package
// test imports — but diagnostic-erp can import from api-server freely.

import { isComposeJobStale as serverIsComposeJobStale } from "../../../../api-server/src/lib/reportComposer/snapshot";

describe("PR #656 — freshness hardening (cross-package: client hashes → server stale-decision)", () => {
  it("client inputHash change (Plain → Contrast) flips server READY → STALE_READY", async () => {
    // Client enqueues a Plain study.
    const enqueue = snapshotWith({
      modality: "MR",
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      findings: "Findings narrative.",
      impression: "Impression narrative.",
      recommendation: "",
      observations: [],
    });
    const enqueueHashes = await computeSnapshotHashes(enqueue);

    // Live: protocol changed to Contrast, narrative + observations identical.
    const live = snapshotWith({
      modality: "MR",
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      protocol: "Contrast",
      reportTitle: "MRI BRAIN WITH CONTRAST",
      findings: "Findings narrative.",
      impression: "Impression narrative.",
      recommendation: "",
      observations: [],
    });
    const liveHashes = await computeSnapshotHashes(live);

    // Sanity: inputHash differs (study context changed).
    expect(enqueueHashes.inputHash).not.toBe(liveHashes.inputHash);
    // Sanity: reportRevision identical (no narrative / observation change).
    expect(enqueueHashes.reportRevision).toBe(liveHashes.reportRevision);

    // Server-side pure stale-decision: MUST return stale=true because the
    // live inputHash differs from the stored enqueue-time inputHash.
    const { stale } = serverIsComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(true);
  });

  it("client inputHash unchanged + reportRevision unchanged → server stays READY (not stale)", async () => {
    const snap = snapshotWith({
      modality: "MR",
      region: "Brain",
      regions: ["Brain"],
      bodyPart: "BRAIN",
      family: "brain",
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      findings: "Findings narrative.",
      impression: "Impression narrative.",
      recommendation: "",
      observations: [],
    });
    const enqueueHashes = await computeSnapshotHashes(snap);
    const liveHashes = await computeSnapshotHashes(snap);

    const { stale } = serverIsComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        inputHash: liveHashes.inputHash,
      },
    });
    expect(stale).toBe(false);
  });

  it("legacy freshness (no inputHash) cannot detect context-only change (backward compatible)", async () => {
    // Same scenario as the first test, but the client OMITS inputHash
    // (simulating a pre-PR #656 client). The server MUST NOT report stale
    // based on context change alone — it lacks the inputHash to compare.
    const enqueue = snapshotWith({
      protocol: "Plain",
      reportTitle: "MRI BRAIN PLAIN",
      findings: "Findings narrative.",
      impression: "Impression narrative.",
    });
    const enqueueHashes = await computeSnapshotHashes(enqueue);
    const live = snapshotWith({
      protocol: "Contrast",
      reportTitle: "MRI BRAIN WITH CONTRAST",
      findings: "Findings narrative.",
      impression: "Impression narrative.",
    });
    const liveHashes = await computeSnapshotHashes(live);

    const { stale } = serverIsComposeJobStale({
      jobStatus: "READY",
      storedReportRevision: enqueueHashes.reportRevision,
      storedFindingsHash: enqueueHashes.findingsHash,
      storedImpressionHash: enqueueHashes.impressionHash,
      storedInputHash: enqueueHashes.inputHash,
      current: {
        findingsHash: liveHashes.findingsHash,
        impressionHash: liveHashes.impressionHash,
        reportRevision: liveHashes.reportRevision,
        // inputHash intentionally omitted — legacy client.
      },
    });
    // Legacy client cannot detect context change. New clients always
    // provide inputHash so this case does NOT arise in production.
    expect(stale).toBe(false);
  });
});
