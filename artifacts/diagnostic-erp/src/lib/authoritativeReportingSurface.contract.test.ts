/**
 * B-10 — ONE authoritative radiology authoring/signing surface.
 *
 * `RadiologyReportingWorkspace` (`/radiology/report/:studyId`) is that surface.
 * `RadiologyCommandCenter` is an owner-only operational console that, until this
 * ticket, also carried a complete second copy of the reporting workflow: its own
 * Findings/Impression/Recommendation/Technique fields (`:214-243`), its own AI
 * generators writing straight into those fields (`:896-930`), its own draft-save
 * and finalize+sign mutations (`:790-893`), and its own HTML assembly that
 * `finalizeRadiologyReport` stored VERBATIM as the signed report body (`:842`).
 *
 * That copy reached the same rows the workspace owns — `radiology_report_drafts`,
 * `patient_reports`, the signature, and the worklist's `REPORT_FINAL` status —
 * through the same shared transport, but without any of the protections that live
 * at the authoritative boundary: not the Observation Ledger, not the #877
 * placeholder guard, not the #878/#879 non-destructive merges, not the #880
 * acceptance target, not the #882 proposal fingerprint, not the #859/#862
 * signed-refusal, not the store's `isFinalized` boundary
 * (`finalizedMutationBoundary.hardening.test.ts` does not even scan this page,
 * because it is not the workspace store). Its `reportStatus` was a label; nothing
 * stopped a `REPORT_FINAL` study from being edited and re-signed from here.
 *
 * So the invariant is not "fewer buttons". It is: the alternate surface cannot
 * create, modify, accept AI into, or sign authoritative report content — and the
 * proof is not the absence of a click handler alone. Each guard below is paired
 * with a positive control that measures the canonical implementation, so a
 * deleted control or a renamed token cannot make the file pass vacuously.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportingWorkspacePath } from "./reportingWorkspaceRoute";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const COMMAND_CENTER = "pages/RadiologyCommandCenter.tsx";
/** The canonical authoring implementation, for positive control. */
const CANVAS = "components/radiology/workspace/ReportCanvas.tsx";
const CLINICAL_UI = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const FINALIZE_HOOK = "hooks/radiology-workspace/useStudyFinalize.ts";
const LIFECYCLE = "lib/radiologyReportLifecycle.ts";

/**
 * Everything the console may still send: queue + row read, viewer settings,
 * prior-report read, metrics, lock release, archive retry, and the lock-release
 * request that the analytics endpoint records. Anything else is a write into
 * report content or report status, and belongs to the workspace.
 */
const OPERATIONAL_CALLS = [
  "DELETE /api/radiology/studies/:id/lock",
  "GET /api/internal/radiology/worklist/:id",
  "GET /api/patient-reports/patient/:id",
  "GET /api/radiology-workflow/command-center",
  "GET /api/radiology/pacs-settings",
  "GET /api/radiology/pacs-worklist",
  "POST /api/radiology/knowledge/analytics/usage",
  "POST /api/radiology/studies/:id/archive-retry",
  "POST /api/radiology/studies/:id/lock",
].sort();

function apiCallsIn(src: string): string[] {
  const re = /api\.(get|post|put|patch|delete)\s*(?:<[^()]*>)?\s*\(\s*[`"']([^`"'\s]+)/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const path = m[2].replace(/\$\{[^}]*\}/g, ":id");
    // DELETE acquires the study lock and DELETE releases it — the same route is
    // reached with two methods, so the method is part of the identity.
    out.add(`${method} ${path}`);
  }
  return [...out].sort();
}

describe("B10-01/02/03 — the console cannot author authoritative narrative", () => {
  const cc = read(COMMAND_CENTER);

  it.each([
    ["a findings field", "rawFindings"],
    ["an impression field", "setImpression("],
    ["a technique field", "setTechnique("],
    ["a recommendation field", "setRecommendation("],
    ["a structured-findings map", "setFindingsMap"],
    ["a structured-reporting toggle", "setUseStructured"],
    ["a multi-line narrative control", "<Textarea"],
  ])("leaves %s out of the console", (_what, token) => {
    expect(cc).not.toContain(token);
  });

  it("positive control: those same fields are how the workspace canvas edits narrative", () => {
    const canvas = read(CANVAS);
    const ui = read(CLINICAL_UI);
    expect(canvas).toContain("<Textarea");
    expect(canvas).toContain("setFindingsMap");
    expect(canvas).toContain("setUseStructured");
    expect(ui).toContain("setFindingsMap");
    expect(ui).toContain("rawFindings");
  });

  it("does not import the report transport at all", () => {
    expect(cc).not.toContain("@/lib/radiologyReportLifecycle");
    expect(cc).not.toContain("saveRadiologyDraft");
    expect(cc).not.toContain("finalizeRadiologyReport");
    expect(read(LIFECYCLE)).toContain("saveRadiologyDraft");
  });

  it("assembles no report body of its own", () => {
    expect(cc).not.toContain("htmlBody");
    expect(read(FINALIZE_HOOK)).toContain("htmlBody");
  });
});

describe("B10-04 — the console cannot save, finalize or sign", () => {
  const cc = read(COMMAND_CENTER);

  it.each(["Save Draft", "Finalize Report", "saveDraftMutation", "finalizeMutation", "handleFinalize", "reportStatus"])(
    "has no %s control",
    (token) => {
      expect(cc).not.toContain(token);
    },
  );

  it("registers no draft-rescue saver, so it cannot write a draft on logout either", () => {
    expect(cc).not.toContain("registerDraftRescueSaver");
    expect(cc).not.toContain("writeRescueDraft");
  });

  it("positive control: the workspace still owns both verbs", () => {
    expect(read(FINALIZE_HOOK)).toContain("finalizeRadiologyReport(");
    expect(read(LIFECYCLE)).toContain('"/api/internal/radiology/report-status"');
    expect(read(LIFECYCLE)).toContain('"/api/radiology/report-generator/save-draft"');
    expect(read(LIFECYCLE)).toContain('"/api/patient-reports"');
  });
});

describe("B10-05 — hiding the UI is not the protection: the console sends nothing authoritative", () => {
  it("every request the console makes is on the operational allowlist, exactly", () => {
    const calls = apiCallsIn(read(COMMAND_CENTER));
    const unexpected = calls.filter((c) => !OPERATIONAL_CALLS.includes(c));
    expect(unexpected).toEqual([]);
    expect(calls).toEqual(OPERATIONAL_CALLS);
  });

  it("positive control: the extractor sees a report write when one is present", () => {
    expect(apiCallsIn(`api.post("/api/radiology/report-generator/save-draft", {})`)).toEqual([
      "POST /api/radiology/report-generator/save-draft",
    ]);
    expect(apiCallsIn("api.post<Row>(`/api/radiology/studies/${row.id}/archive-retry`, {})")).toEqual([
      "POST /api/radiology/studies/:id/archive-retry",
    ]);
    expect(apiCallsIn('api.delete(`/api/radiology/studies/${id}/lock`)')).toEqual([
      "DELETE /api/radiology/studies/:id/lock",
    ]);
  });

  it("the server still refuses an out-of-context draft write on its own", () => {
    // The canonical endpoint is shared, so the console's removal is not what
    // protects it: assertDraftWritable is what rejects a write whose study,
    // patient or worklist identity does not line up, whatever client sent it.
    const route = readFileSync(
      join(SRC, "../../api-server/src/routes/radiology-report-generator.ts"),
      "utf8",
    );
    expect(route).toContain("assertDraftWritable(");
    const identity = readFileSync(join(SRC, "../../api-server/src/lib/radiologyIdentity.ts"), "utf8");
    expect(identity).toContain("DRAFT_WORKLIST_MISMATCH");
    expect(identity).toContain("DRAFT_PATIENT_MISMATCH");
    expect(identity).toContain("REPORT_LOCKED");
  });
});

describe("B10-06/07 — the canonical authoring and signing paths are untouched", () => {
  it("the workspace hooks still drive the one transport", () => {
    const ui = read(CLINICAL_UI);
    const persistence = read("hooks/radiology-workspace/useDraftPersistence.ts");
    expect(persistence).toContain('from "@/lib/radiologyReportLifecycle"');
    expect(persistence).toContain("saveRadiologyDraft");
    expect(read(FINALIZE_HOOK)).toContain('from "@/lib/radiologyReportLifecycle"');
    expect(ui).toContain("saveRadiologyDraft");
    expect(ui).toContain("finalizeRadiologyReport");
  });

  it("the workspace is not marked deprecated and the console still is", () => {
    expect(read("pages/RadiologyReportingWorkspace.tsx")).not.toContain("@deprecated");
    expect(read(COMMAND_CENTER)).toContain("@deprecated");
    expect(read(COMMAND_CENTER)).toContain("DeprecatedSurfaceBanner");
  });
});

describe("B10-08 — operational functionality survives", () => {
  const cc = read(COMMAND_CENTER);

  it.each([
    ["the worklist queue", '"radiology-pacs-worklist"'],
    ["the per-study row read", "/api/internal/radiology/worklist/"],
    ["operational metrics", '"/api/radiology-workflow/command-center"'],
    ["study lock release", "/lock"],
    ["lock takeover dialog", "Concurrent Reporting Alert"],
    ["PACS archive retry", "archive-retry"],
    ["WEASIS launch", 'launchViewer(study?.studyInstanceUID, "WEASIS"'],
    ["OHIF launch", 'launchViewer(study?.studyInstanceUID, "OHIF"'],
    ["the embedded viewer", "<EmbeddedWadoViewer"],
    ["patient and study context", "Patient & Study Info"],
    ["the prior-report list", "patient-prior-reports"],
    ["the AI draft status", "aiDraftStatus"],
    ["the delivery status", "deliveryStatus"],
    ["the worklist switcher", "setActiveStudyId("],
  ])("keeps %s", (_what, token) => {
    expect(cc).toContain(token);
  });
});

describe("B10-09 — the console hands off to the workspace with the right study", () => {
  it("builds the canonical route from the worklist row id", () => {
    expect(reportingWorkspacePath(412)).toBe("/radiology/report/412");
    expect(reportingWorkspacePath("412")).toBe("/radiology/report/412");
  });

  it("carries the focus and ai hints the workspace reads", () => {
    expect(reportingWorkspacePath(412, { focus: true })).toBe("/radiology/report/412?focus=1");
    expect(reportingWorkspacePath(412, { ai: true })).toBe("/radiology/report/412?ai=1");
    expect(reportingWorkspacePath(412, { focus: true, ai: true })).toBe(
      "/radiology/report/412?focus=1&ai=1",
    );
    expect(reportingWorkspacePath(412, {})).toBe("/radiology/report/412");
  });

  it("is the route the router maps to the canonical workspace", () => {
    const app = read("App.tsx");
    expect(app).toContain('<Route path="/radiology/report/:studyId">');
    expect(app).toContain("<RadiologyReportingWorkspace studyId={Number(params.studyId)}");
  });

  it("the console navigates through it for the selected study", () => {
    const cc = read(COMMAND_CENTER);
    expect(cc).toContain('from "@/lib/reportingWorkspaceRoute"');
    expect(cc).toContain("reportingWorkspacePath(activeStudyId");
  });

  it("the handoff control itself, not just some link on the page, carries the study", () => {
    // Measured, not assumed: the first version of this assertion looked for the
    // call anywhere in the file, and three separate mutations — the panel
    // switching to a local editor, dropping to the context-free route, and
    // passing the billed-study PK instead of the worklist row — all survived it,
    // because the header link still used the right expression. So the primary
    // handoff card is sliced out on its own test id and asserted there.
    const cc = read(COMMAND_CENTER);
    const start = cc.indexOf('data-testid="command-center-report-handoff"');
    expect(start).toBeGreaterThan(-1);
    const block = cc.slice(start, cc.indexOf("</Button>", start));
    expect(block).toContain("navigate(reportingWorkspacePath(activeStudyId))");
    expect(block).not.toContain('"/radiology/reporting-workspace"');
    expect(block).not.toContain("setLocalEdit");
    expect(block).not.toContain("studyId ??");
  });

  it("and the worklist uses the same single builder rather than a second copy", () => {
    const worklist = read("pages/RadiologyWorklist.tsx");
    expect(worklist).toContain('from "@/lib/reportingWorkspaceRoute"');
    expect(worklist).not.toContain("function reportingWorkspacePath");
  });
});

describe("B10-10 — AI from the console cannot bypass the acceptance boundary", () => {
  const cc = read(COMMAND_CENTER);

  it.each([
    ["the shared AI query client", "queryAiReporting"],
    ["the report generator", "generateSmartReport"],
    ["the impression generator", "generateImpressionText"],
    ["AI output state", "setAiOutput"],
    ["AI contribution accounting", "aiCharsInserted"],
    ["the local AI tab", "LocalAiPanel"],
    ["an AI insert callback", "onInsert"],
  ])("has no %s", (_what, token) => {
    expect(cc).not.toContain(token);
  });

  it("positive control: the trusted boundary is still the workspace's own", () => {
    expect(read("lib/zai-workspace/aiProposalContext.ts")).toContain("digest");
    expect(read("hooks/radiology-workspace/useTriggerAiImpression.ts")).toContain("aiProposalContext");
    expect(read("lib/zai-workspace/copilotAcceptanceContract.ts")).toContain("insertTarget");
  });
});

describe("B10-11 — D1 study-identity behaviour is unchanged by this ticket", () => {
  it("the console binds no StudyInstanceUID of its own", () => {
    const cc = read(COMMAND_CENTER);
    expect(cc).not.toContain("findOrthancStudies");
    expect(cc).not.toContain("resolve-study-uid");
    expect(cc).not.toContain("studyUidProvenance");
    // It reads the identifier off the row and launches on it; it never writes one.
    expect(cc).toContain("launchViewer(study?.studyInstanceUID");
  });

  it("positive control: the fail-closed resolver is still where D1 put it", () => {
    const api = readFileSync(join(SRC, "../../api-server/src/routes/radiology.ts"), "utf8");
    expect(api).toContain("decideStudyUidBinding(");
    expect(api).toContain('decision.status !== "resolved"');
    expect(api).toContain("canBindUidToRow(");
    expect(api).not.toContain("let hit = orthanc.rows[0]");
  });
});

describe("B10-12 — read-only viewing of report content and delivery survive", () => {
  it("hands off instead of showing its own copy of the narrative", () => {
    const cc = read(COMMAND_CENTER);
    // A second read-only rendering of report text would be a second view of
    // clinical truth that can lag the draft the workspace holds, so the console
    // shows operational state and moves the radiologist to the one surface.
    expect(cc).toContain('data-testid="command-center-report-handoff"');
    expect(cc).toContain("Open in Reporting Workspace");
    expect(cc).not.toMatch(/onChange=\{[^}]*set(RawFindings|Impression|Technique|Recommendation)/);
    expect(cc).not.toMatch(/value=\{rawFindings\}/);
  });

  it("print/export still consumes the already-authoritative report", () => {
    expect(read("components/radiology/ReportExportPanel.tsx")).toContain("print?preview=true");
    expect(read("pages/ReportDelivery.tsx")).toContain("/deliver");
  });

  it("the study row the console shows status from is still the workspace's own entry read", () => {
    expect(read(COMMAND_CENTER)).toContain('queryKey: ["workspace-entry", activeStudyId]');
    expect(read(COMMAND_CENTER)).toContain("/api/internal/radiology/worklist/");
  });
});
