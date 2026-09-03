/**
 * Pre-deploy safety contracts for Background AI Report Composer.
 * Maps 1:1 to the FINAL COMPOSER PRE-DEPLOY CLOSURE checklist.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectClinicalSignificance } from "./clinicalSignificance";
import { buildTrackedChanges, materializeAcceptedText } from "./trackedChanges";
import { RADIOLOGY_JOB_HANDLERS, AI_REPORT_COMPOSE_JOB } from "../radiologyJobHandlers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, "../..");
const ERP_SRC = join(__dirname, "../../../../diagnostic-erp/src");

function readApi(name: string): string {
  return readFileSync(join(API_SRC, name), "utf8");
}

function readErp(rel: string): string {
  return readFileSync(join(ERP_SRC, rel), "utf8");
}

describe("pre-deploy safety contracts — clinical significance (1–4)", () => {
  it("1. RIGHT → LEFT is clinically significant", () => {
    const r = detectClinicalSignificance("right foraminal stenosis", "left foraminal stenosis");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Laterality/i.test(x))).toBe(true);
  });

  it("2. L4-L5 → L5-S1 is clinically significant", () => {
    const r = detectClinicalSignificance("L4-L5 disc bulge", "L5-S1 disc bulge");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Spinal level/i.test(x))).toBe(true);
  });

  it("3. 8 mm → 10 mm is clinically significant", () => {
    const r = detectClinicalSignificance("lesion measures 8 mm", "lesion measures 10 mm");
    expect(r.significant).toBe(true);
    expect(r.reasons.some((x) => /Measurement/i.test(x))).toBe(true);
  });

  it('4. "no compression" → "compression" / present↔absent is clinically significant', () => {
    const negToPos = detectClinicalSignificance("no compression", "compression present");
    expect(negToPos.significant).toBe(true);
    expect(negToPos.reasons.some((x) => /Stenosis|compression|Polarity/i.test(x))).toBe(true);

    const absentToPresent = detectClinicalSignificance("compression absent", "compression present");
    expect(absentToPresent.significant).toBe(true);
    expect(absentToPresent.reasons.some((x) => /Polarity/i.test(x))).toBe(true);
  });
});

describe("pre-deploy safety contracts — review gate (5–6, 12)", () => {
  it("5. clinically significant tracked changes start PENDING (never auto-accepted)", () => {
    const changes = buildTrackedChanges({
      jobId: 1,
      model: "test",
      originalFindings: "right foraminal stenosis at L4-L5, 8 mm",
      originalImpression: "",
      originalRecommendation: "",
      draft: {
        findings: "left foraminal stenosis at L5-S1, 10 mm with compression",
        impression: "Left stenosis",
        recommendation: "",
        unresolvedQuestions: [],
        warnings: [],
      },
    });
    const sig = changes.filter((c) => c.clinicalSignificance);
    expect(sig.length).toBeGreaterThan(0);
    expect(sig.every((c) => c.reviewState === "PENDING")).toBe(true);
  });

  it("6. pending AI changes are NOT included in canonical report text", () => {
    const text = materializeAcceptedText({
      currentFindings: "Original findings",
      currentImpression: "Original impression",
      currentRecommendation: "",
      changes: [
        {
          id: "1",
          source: "AI_COMPOSER",
          changeType: "REPLACE",
          field: "FINDINGS",
          originalText: "Original findings",
          proposedText: "AI proposed findings",
          reviewState: "PENDING",
          clinicalSignificance: true,
          clinicalSignificanceReasons: ["Laterality"],
          createdAt: new Date().toISOString(),
        },
      ],
    });
    expect(text.findings).toBe("Original findings");
    expect(text.impression).toBe("Original impression");
  });

  it("12. STALE_READY apply guard exists in jobService", () => {
    const jobService = readFileSync(join(__dirname, "jobService.ts"), "utf8");
    expect(jobService).toContain('if (job.status === "STALE_READY") return { ok: false, error: "stale_ready" }');
  });
});

describe("pre-deploy safety contracts — export / print plain text (7)", () => {
  it("7. previewHtml uses workspace plain fields only (not AI proposed/tracked markup)", () => {
    const workspace = readErp("pages/RadiologyReportingWorkspace.tsx");
    const exportPanel = readErp("components/radiology/ReportExportPanel.tsx");
    const previewBlock = workspace.slice(
      workspace.indexOf("const previewHtml = useMemo"),
      workspace.indexOf("const handleExportWord"),
    );
    expect(previewBlock).toContain("rawFindings: findingsText");
    expect(previewBlock).toContain("impression: impressionText.split");
    expect(previewBlock).toContain("recommendation: recommendationText");
    expect(previewBlock).not.toMatch(/proposedFindings|trackedChanges|showAiChanges/);
    expect(exportPanel).not.toMatch(/proposedFindings|trackedChanges|showAiChanges|ai-change/);
  });
});

describe("pre-deploy safety contracts — finalize + apply guards (10–11)", () => {
  it("10. finalized report blocks server-side compose enqueue (source contract)", () => {
    const jobService = readFileSync(join(__dirname, "jobService.ts"), "utf8");
    expect(jobService).toContain('if (persisted.finalized)');
    expect(jobService).toContain('"Report is finalized — composition not allowed"');
  });

  it("10b. client apply blocks when finalized", () => {
    const hook = readErp("hooks/useReportComposer.ts");
    expect(hook).toContain("if (opts.isFinalized)");
    expect(hook).toContain('"Apply disabled"');
  });

  it("11. finalize with pending AI changes shows explicit gate (no silent inclusion)", () => {
    const workspace = readErp("pages/RadiologyReportingWorkspace.tsx");
    expect(workspace).toContain("Guard 10: pending AI proposals must never silently finalize");
    expect(workspace).toContain('data-testid="ai-finalize-gate"');
    expect(workspace).toContain("AI suggestions remain unreviewed");
    expect(workspace).toContain('reviewState === "PENDING"');
  });
});

describe("pre-deploy safety contracts — ollama failure leaves report unchanged (13)", () => {
  it("13. malformed JSON parse returns null draft (report mutation path blocked)", async () => {
    const { parseComposerDraftJson } = await import("./types");
    expect(parseComposerDraftJson("not valid json {{{")).toBeNull();
  });

  it("13b. composeEngine documents malformed_json failure path", () => {
    const engine = readFileSync(join(__dirname, "composeEngine.ts"), "utf8");
    expect(engine).toContain('safeError: "malformed_json"');
    expect(engine).toContain("if (!draft)");
  });
});

describe("pre-deploy safety contracts — handler registration", () => {
  it("registers ai_report_compose on RADIOLOGY_JOB_HANDLERS", () => {
    expect(AI_REPORT_COMPOSE_JOB).toBe("ai_report_compose");
    expect(RADIOLOGY_JOB_HANDLERS[AI_REPORT_COMPOSE_JOB]).toBeTypeOf("function");
  });

  it("worker + index bootstrap compose consumer independently of ENABLE_SCHEDULERS", () => {
    const worker = readApi("worker.ts");
    const index = readApi("index.ts");
    const cron = readApi("cron.ts");
    expect(worker).toContain('import { startCronScheduler } from "./cron"');
    expect(cron).toContain("export function startAiReportComposeJobConsumer");
    expect(cron).toContain("ai report compose consumer registered (independent of ENABLE_SCHEDULERS)");
    expect(index).toContain("startAiReportComposeJobConsumer");
    expect(index).toContain("AI report compose consumer failed to register");
  });

  it("fireOtherRadiologyJobTick excludes compose (dedicated consumer)", () => {
    const cron = readApi("cron.ts");
    expect(cron).toContain("k !== AI_REPORT_COMPOSE_JOB");
    expect(cron).toContain("async function fireAiReportComposeTick");
  });
});

describe("pre-deploy safety contracts — client/server canonical observation drift (12)", () => {
  // The client (diagnostic-erp/src/lib/reportComposer/types.ts) and the
  // server (api-server/src/lib/reportComposer/snapshot.ts) MUST define
  // canonical observation identity + hash payload with identical semantics.
  // Any drift would let a snapshot validate on one side but be marked STALE
  // on the other — a silent freshness bug that wastes AI runs and confuses
  // radiologists. This contract is enforced both by source-text inspection
  // here and by a runtime equivalence test in
  // `artifacts/diagnostic-erp/src/lib/reportComposer/composeObservations.test.ts > hash-canonical F`.

  it("12a. ComposeObservation schema declares `region` on both sides", async () => {
    const apiTypes = readFileSync(join(__dirname, "types.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");
    expect(apiTypes).toMatch(/region:\s*z\.string\(\)\.nullable\(\)\.optional\(\)/);
    expect(erpTypes).toMatch(/region\?:\s*string \| null/);
  });

  it("12b. canonicalObservationKey + canonicalObservationHashPayload are mirrored verbatim", async () => {
    const apiSnapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");

    // Both sides MUST export canonicalObservationKey with the same identity
    // axes (region | concept | level | laterality).
    expect(apiSnapshot).toContain("export function canonicalObservationKey");
    expect(erpTypes).toContain("export function canonicalObservationKey");
    expect(apiSnapshot).toMatch(/region.*concept.*level.*laterality/s);
    expect(erpTypes).toMatch(/region.*concept.*level.*laterality/s);

    // Both sides MUST export canonicalObservationHashPayload with the same
    // payload axes (region, concept, level, laterality, severity,
    // anatomicalSection, findingsText, impressionText, recommendationText).
    expect(apiSnapshot).toContain("export function canonicalObservationHashPayload");
    expect(erpTypes).toContain("export function canonicalObservationHashPayload");
    expect(apiSnapshot).toMatch(/norm\(o\.region\).*norm\(o\.concept\).*norm\(o\.level\).*norm\(o\.laterality\).*norm\(o\.severity\).*norm\(o\.anatomicalSection\).*norm\(o\.findingsText\).*norm\(o\.impressionText\).*norm\(o\.recommendationText\)/s);
    expect(erpTypes).toMatch(/norm\(o\.region\).*norm\(o\.concept\).*norm\(o\.level\).*norm\(o\.laterality\).*norm\(o\.severity\).*norm\(o\.anatomicalSection\).*norm\(o\.findingsText\).*norm\(o\.impressionText\).*norm\(o\.recommendationText\)/s);
  });

  it("12c. computeSnapshotHashes consumes canonicalObservationHashPayload on both sides", async () => {
    const apiSnapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");
    expect(apiSnapshot).toMatch(/dedupeObservations\(snapshot\.observations \?\? \[\]\)\s*\.map\(\(o\) => canonicalObservationHashPayload\(o\)\)/);
    expect(erpTypes).toMatch(/dedupeObservations\(snapshot\.observations \?\? \[\]\)\s*\.map\(\(o\) => canonicalObservationHashPayload\(o\)\)/);
  });

  it("12d. baselineReplaces is NEVER used as findingsText in the adapter", async () => {
    const adapter = readFileSync(join(ERP_SRC, "lib/reportComposer/composeObservations.ts"), "utf8");
    // Strict lookup order: lastRendered.findings OR templates.findings.
    expect(adapter).toMatch(/lastRenderedFindings \|\| templateFindings/);
    // baselineReplaces MUST NOT appear as a fallback for findingsText.
    // Specifically, the unsafe expression `?? observation?.baselineReplaces`
    // (or any equivalent baseline fallback in the findings lookup) MUST NOT
    // be present. The adapter MAY still carry baselineReplaces on the
    // ComposeObservation object as provenance (the schema allows it) — that
    // is fine as long as it is never read as the active findings text.
    expect(adapter).not.toMatch(/\?\?\s*observation\?\.baselineReplaces/);
    expect(adapter).not.toMatch(/findingsText\s*=\s*[^;]*baselineReplaces/);
  });
});

describe("pre-deploy safety contracts — canonical study-context plumbing (P0-2)", () => {
  // PR P0-2 wires the canonical ReportingStudyContext into the AI Report
  // Composer snapshot. These contracts guard against future drift on the
  // new context fields and the canonicalStudyContextHashPayload helper.

  it("13a. ComposerInputSnapshotSchema declares regions/bodyPart/family/spineSegment on both sides", async () => {
    const apiTypes = readFileSync(join(__dirname, "types.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");
    expect(apiTypes).toMatch(/regions:\s*z\.array\(z\.string\(\)\)\.optional\(\)/);
    expect(apiTypes).toMatch(/bodyPart:\s*z\.string\(\)\.optional\(\)/);
    expect(apiTypes).toMatch(/family:\s*z\.string\(\)\.optional\(\)/);
    expect(apiTypes).toMatch(/spineSegment:\s*z\.string\(\)\.optional\(\)/);
    expect(erpTypes).toMatch(/regions\?:\s*string\[\]/);
    expect(erpTypes).toMatch(/bodyPart\?:\s*string/);
    expect(erpTypes).toMatch(/family\?:\s*string/);
    expect(erpTypes).toMatch(/spineSegment\?:\s*string/);
  });

  it("13b. canonicalStudyContextHashPayload is mirrored verbatim client/server", async () => {
    const apiSnapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");
    expect(apiSnapshot).toContain("export function canonicalStudyContextHashPayload");
    expect(erpTypes).toContain("export function canonicalStudyContextHashPayload");
    // Both sides MUST include the same axes: modality, region, regions,
    // bodyPart, family, spineSegment, protocol, reportTitle.
    const axes = ["modality", "region", "regions", "bodyPart", "family", "spineSegment", "protocol", "reportTitle"];
    for (const axis of axes) {
      const re = new RegExp(`norm\\(s\\.?2?\\)?\\.${axis}|norm\\(s\\.${axis}\\)|s\\.${axis}`);
      expect(apiSnapshot).toMatch(re);
      expect(erpTypes).toMatch(re);
    }
  });

  it("13c. computeSnapshotHashes includes studyCtxCanon in inputHash on both sides", async () => {
    const apiSnapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");
    expect(apiSnapshot).toMatch(/const studyCtxCanon = canonicalStudyContextHashPayload\(snapshot\);/);
    expect(erpTypes).toMatch(/const studyCtxCanon = canonicalStudyContextHashPayload\(snapshot\);/);
    expect(apiSnapshot).toMatch(/studyCtxCanon,/);
    expect(erpTypes).toMatch(/studyCtxCanon,/);
    // And studyCtxCanon MUST NOT appear inside the reportRevision computation
    // (reportRevision guards the clinically EDITABLE report state only —
    // study-context changes are STUDY IDENTITY captured by inputHash).
    expect(apiSnapshot).toMatch(/reportRevision = hashText\(`\$\{findingsHash\}:\$\{impressionHash\}:\$\{recommendationHash\}:\$\{obsCanon\}`\)/);
    expect(erpTypes).toMatch(/reportRevision = await hashText\(`\$\{findingsHash\}:\$\{impressionHash\}:\$\{recommendationHash\}:\$\{obsCanon\}`\)/);
  });

  it("13c2. selected-image mode + selectedImagesCanon participate in inputHash on both sides", async () => {
    const apiSnapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
    const erpTypes = readFileSync(join(ERP_SRC, "lib/reportComposer/types.ts"), "utf8");
    expect(apiSnapshot).toContain("canonicalSelectedKeyImagesHashPayload");
    expect(erpTypes).toContain("canonicalSelectedKeyImagesHashPayload");
    expect(apiSnapshot).toMatch(/selectedImagesCanon/);
    expect(erpTypes).toMatch(/selectedImagesCanon/);
    expect(apiSnapshot).toMatch(/snapshot\.aiMode \?\? "TEXT_ONLY"/);
    expect(erpTypes).toMatch(/snapshot\.aiMode \?\? "TEXT_ONLY"/);
  });

  it("13c3. composeEngine never fetches Orthanc middle slices for SELECTED_IMAGES", async () => {
    const engine = readFileSync(join(__dirname, "composeEngine.ts"), "utf8");
    expect(engine).toMatch(/resolveSelectedKeyImagesForCompose/);
    expect(engine).toMatch(/vision_model_required/);
    expect(engine).toMatch(/vision_capability_unverified/);
    expect(engine).toMatch(/assertVisionCapableModel/);
    expect(engine).toMatch(/Never fetches Orthanc middle slices/);
    expect(engine).not.toMatch(/fetchMiddleSlice|middleSliceJpegs|getMiddleSlice/i);
    // Never silently inflate administrator runtime numCtx / timeout.
    expect(engine).not.toMatch(/Math\.max\(\s*runtime\.numCtx/);
    expect(engine).not.toMatch(/Math\.max\(\s*runtime\.timeoutMs/);
    expect(engine).toMatch(/composer_num_ctx_insufficient/);
  });

  it("13c3b. SELECTED_IMAGES ownership resolves authoritative draft (never draftId: null alone)", () => {
    const jobService = readFileSync(join(__dirname, "jobService.ts"), "utf8");
    const resolve = readFileSync(join(__dirname, "resolveSelectedKeyImages.ts"), "utf8");
    expect(jobService).toMatch(/resolveAuthoritativeComposeDraft/);
    expect(jobService).toMatch(/ownership/);
    expect(resolve).toMatch(/verifyKeyImageRowOwnership/);
    expect(resolve).toMatch(/selected_images_ownership_unverified/);
  });

  it("13c4. ReportComposerAssistant exposes mode selector; workspace does not call legacy ai-reporting/draft for composer", async () => {
    const assistant = readFileSync(join(ERP_SRC, "components/radiology/ReportComposerAssistant.tsx"), "utf8");
    const workspace = readFileSync(join(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"), "utf8");
    expect(assistant).toMatch(/Draft from Observations/);
    expect(assistant).toMatch(/Draft with Selected Images/);
    expect(workspace).toMatch(/composerAiMode/);
    expect(workspace).toMatch(/aiSelectedKeyImageIds/);
    // Composer enqueue path is report-composer, not legacy draft
    expect(workspace).toMatch(/useReportComposer/);
  });

  it("13d. RadiologyReportingWorkspace passes canonical protocol + reportTitle to useReportComposer (no `protocol: undefined`)", async () => {
    const workspace = readFileSync(join(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"), "utf8");
    // PR P0-2 explicit defect: `protocol: undefined` MUST be gone.
    expect(workspace).not.toMatch(/protocol:\s*undefined/);
    // Protocol MUST be wired to the resolved ReportingStudyContext.protocolName.
    expect(workspace).toMatch(/protocol:\s*composerCtx\.protocolName/);
    // reportTitle MUST use resolvePrintedReportTitle(appliedFormatReportTitle, ...),
    // NOT raw workflow.currentRow?.studyDescription.
    expect(workspace).toMatch(/resolvePrintedReportTitle\(\s*appliedFormatReportTitle/);
    // regions / bodyPart / family / spineSegment MUST be wired from composerCtx.
    expect(workspace).toMatch(/regions:\s*composerCtx\.regions/);
    expect(workspace).toMatch(/bodyPart:\s*composerCtx\.bodyPart/);
    expect(workspace).toMatch(/family:\s*composerCtx\.family/);
    expect(workspace).toMatch(/spineSegment:\s*composerCtx\.spineSegment/);
  });

  it("13e. radiologist draft context prompt renders study identity with region/protocol/reportTitle", async () => {
    const draftCtx = readFileSync(join(__dirname, "buildRadiologistDraftContext.ts"), "utf8");
    const engine = readFileSync(join(__dirname, "composeEngine.ts"), "utf8");
    expect(engine).toMatch(/buildRadiologistDraftContext/);
    expect(engine).toMatch(/renderRadiologistDraftContextPrompt/);
    expect(draftCtx).toMatch(/STUDY IDENTITY/);
    expect(draftCtx).toMatch(/Primary region:/);
    expect(draftCtx).toMatch(/Additional regions:/);
    expect(draftCtx).toMatch(/Family:/);
    expect(draftCtx).toMatch(/Spine segment:/);
    expect(draftCtx).toMatch(/Protocol:/);
    expect(draftCtx).toMatch(/Report title:/);
    // DICOM StudyDescription is rendered as secondary provenance, never as
    // the primary region.
    expect(draftCtx).toMatch(/DICOM study description:/);
  });
});

describe("pre-deploy safety contracts — PR #656 freshness hardening (study-context axis)", () => {
  // PR #656 closes the final P0-2 blocker: study-context changes (Plain →
  // Contrast, LS Spine + Screening → LS Spine only, bodyPart/family/
  // spineSegment change, reportTitle change) MUST flip READY → STALE_READY
  // even when narrative text + observations are byte-identical. Without this
  // axis a READY draft generated for "MRI Brain Plain" would remain blindly
  // applicable after the radiologist switched the protocol to "MRI Brain
  // Contrast" — that is unsafe and exactly what PR #656 fixes.

  it("14a. evaluateJobFreshness accepts an optional `inputHash` parameter", async () => {
    const jobService = readFileSync(join(__dirname, "jobService.ts"), "utf8");
    // The current parameter shape MUST include inputHash as optional.
    expect(jobService).toMatch(/inputHash\?:\s*string/);
    // And the stale-decision MUST delegate to isComposeJobStale which compares
    // inputHash against the stored job.inputHash.
    expect(jobService).toMatch(/isComposeJobStale\(/);
    expect(jobService).toMatch(/storedInputHash:\s*job\.inputHash/);
  });

  it("14b. isComposeJobStale pure helper is exported from snapshot.ts (unit-testable without DB)", async () => {
    const snapshot = readFileSync(join(__dirname, "snapshot.ts"), "utf8");
    expect(snapshot).toContain("export function isComposeJobStale");
    // The helper MUST validate BOTH axes:
    //   1. reportRevision (clinically editable report state).
    //   2. inputHash (canonical study context — PR #656 addition).
    expect(snapshot).toMatch(/opts\.current\.reportRevision !== opts\.storedReportRevision/);
    expect(snapshot).toMatch(/opts\.current\.inputHash !== undefined && opts\.current\.inputHash !== opts\.storedInputHash/);
    // The inputHash axis MUST be optional (legacy clients omit it).
    expect(snapshot).toMatch(/opts\.current\.inputHash !== undefined/);
  });

  it("14c. server /freshness route extracts inputHash from request body (backward compatible)", async () => {
    const route = readFileSync(join(__dirname, "..", "..", "routes", "reportComposer.ts"), "utf8");
    // The route MUST read `inputHash` from the request body.
    expect(route).toMatch(/b\.inputHash/);
    // And MUST default to undefined when absent or empty (legacy clients).
    expect(route).toMatch(/typeof inputHashRaw === "string" && inputHashRaw\.length > 0 \? inputHashRaw : undefined/);
    // And MUST spread inputHash conditionally into evaluateJobFreshness's current.
    expect(route).toMatch(/\.\.\.\(inputHash !== undefined \? \{ inputHash \} : \{\}\)/);
  });

  it("14d. client freshness API accepts optional inputHash", async () => {
    const erpApi = readFileSync(join(ERP_SRC, "lib/reportComposer/api.ts"), "utf8");
    expect(erpApi).toMatch(/inputHash\?:\s*string/);
  });

  it("14e. useReportComposer.refreshJob sends live inputHash computed from canonical snapshot", async () => {
    const hook = readFileSync(join(ERP_SRC, "hooks/useReportComposer.ts"), "utf8");
    // The refreshJob MUST build a full live snapshot (context + observations
    // + narrative) and compute its hashes via computeSnapshotHashes.
    expect(hook).toMatch(/liveSnapshot: ComposerInputSnapshot/);
    expect(hook).toMatch(/modality:\s*opts\.modality/);
    expect(hook).toMatch(/regions:\s*opts\.regions/);
    expect(hook).toMatch(/bodyPart:\s*opts\.bodyPart/);
    expect(hook).toMatch(/family:\s*opts\.family/);
    expect(hook).toMatch(/spineSegment:\s*opts\.spineSegment/);
    expect(hook).toMatch(/protocol:\s*opts\.protocol/);
    expect(hook).toMatch(/reportTitle:\s*opts\.reportTitle/);
    // And MUST send inputHash to the freshness endpoint.
    expect(hook).toMatch(/inputHash:\s*hashes\.inputHash/);
  });
});
