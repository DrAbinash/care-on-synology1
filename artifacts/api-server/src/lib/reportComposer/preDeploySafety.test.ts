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
