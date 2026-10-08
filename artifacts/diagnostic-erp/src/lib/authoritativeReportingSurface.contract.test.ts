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
import { existsSync, readFileSync } from "node:fs";
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

/* ═══════════════════════════════════════════════════════════════════════════
 * B-10 completion pass — the two surfaces that were left standing.
 *
 * The section above retired the Radiology Command Center. The decisive question
 * was still answered YES after it, because two more surfaces could author,
 * accept AI into, or finalize authoritative radiology content:
 *
 *   pages/UsgCompanionWorkspace.tsx (/radiology/usg/:studyId) — saved and
 *   finalized through the canonical transport and composed its own signed
 *   htmlBody, with AI/accept handlers that appended prose into the impression
 *   it signed. None of #877/#880/#882/#859/#862 was in its call graph.
 *   pages/RadiologyLegacy.tsx (/radiology/legacy) — a free-text report editor
 *   with a Preliminary/Final stage selector, a client-typed "Reported by" name,
 *   voice dictation, two AI endpoints appended into the body, its own print
 *   renderer, and POST /api/radiology/:id/report writing
 *   radiology_studies.prelim_report / final_report. Those columns are read
 *   BEFORE the signed patient report by lib/priorStudies.ts
 *   (s.finalReport ?? s.prelimReport ?? report?.body) and by pacsArchive.ts, so
 *   a legacy save could contradict a signed report in the place the next
 *   radiologist reads.
 *
 * What follows is the retirement of the first and the closure of the second,
 * with the write closed at the route (see also lib/legacyReportAuthority.ts and
 * legacyReportAuthority.test.ts + .request.test.ts, which are the runtime half).
 * Absence assertions are each paired with a positive control that measures the
 * canonical implementation, so deleting a control cannot make this pass.
 * ═══════════════════════════════════════════════════════════════════════════ */

const USG_PAGE = "pages/UsgCompanionWorkspace.tsx";
const LEGACY = "pages/RadiologyLegacy.tsx";
const TOOLS_RAIL = "components/radiology/workspace/ReportingToolsRail.tsx";
const API_RADIOLOGY = "../../api-server/src/routes/radiology.ts";
const API_AUTHORITY = "../../api-server/src/lib/legacyReportAuthority.ts";

/** Everything the legacy hub may still send — operational, never narrative. */
const LEGACY_OPERATIONAL_CALLS = [
  "GET /api/radiology/:id/issues",
  "GET /api/radiology/options",
  "GET /api/radiology/studies/:id",
  "GET /api/radiology/studies/:id/pacs-url",
  "GET /api/radiology/technicians",
  "GET /api/radiology/worklist?:id",
  "PATCH /api/radiology/:id",
  "POST /api/radiology/:id/claim",
  "POST /api/radiology/:id/issues",
  "POST /api/radiology/:id/unclaim",
].sort();

describe("B10-13/14 — the standalone USG shell is gone, and its URL reaches the workspace", () => {
  const app = read("App.tsx");

  it("the page does not exist and nothing renders or imports it", () => {
    expect(existsSync(join(SRC, USG_PAGE))).toBe(false);
    expect(app).not.toContain("UsgCompanionWorkspace");
  });

  it("the route it owned redirects to the canonical workspace, key included", () => {
    expect(app).toMatch(
      /path="\/radiology\/usg\/:studyId">\s*\{\(params\) => <RedirectToReportWorkspace studyId=\{params\.studyId\} \/>\}/,
    );
    // POSITIVE CONTROL: the canonical route is still the one bound to the
    // canonical page, so this assertion cannot be satisfied by deleting both.
    expect(app).toMatch(
      /path="\/radiology\/report\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/,
    );
  });

  it("no surface except the canonical hooks can save or finalize a USG report", () => {
    // The shell's two transports were saveRadiologyDraft + finalizeRadiologyReport.
    // The register of importers is pinned in usgWorkspaceContract.test.ts; here the
    // load-bearing half: the module itself still owns both endpoints and the
    // workspace still calls it.
    const lifecycle = read(LIFECYCLE);
    expect(lifecycle).toContain("export function saveRadiologyDraft<");
    expect(lifecycle).toContain("export async function finalizeRadiologyReport(");
    expect(read(FINALIZE_HOOK)).toContain("finalizeRadiologyReport(");
    expect(read("hooks/radiology-workspace/useDraftPersistence.ts")).toMatch(/saveRadiologyDraft[<(]/);
  });
});

describe("B10-15 — the legitimate USG functionality survived", () => {
  it("the in-workspace companion panel is still imported and mounted", () => {
    expect(read(CLINICAL_UI)).toContain("UsgCompanionPanel");
    for (const rel of [CANVAS, TOOLS_RAIL]) {
      expect(read(rel), `${rel} lost the companion panel`).toContain("<UsgCompanionPanel");
    }
  });

  it("the workspace still knows an ultrasound is a ultrasound", () => {
    // isUltrasoundModality drove the shell's gating and the panel's; if the
    // retirement had removed the modality awareness, USG reporting would have
    // regressed rather than converged.
    expect(read(CLINICAL_UI)).toContain("isUltrasoundModality");
  });
});

describe("B10-16 — RadiologyLegacy holds no report authoring, no AI, no signing", () => {
  const legacy = read(LEGACY);

  it.each([
    ["the legacy report write", "/report`, {"],
    ["the AI findings generator", "radiology-findings"],
    ["the AI impression generator", "radiology-impression"],
    ["voice dictation", "SpeechRecognition"],
    ["a stage selector", "preliminary\" | \"final"],
    ["a client-typed author name", "reportedBy"],
    ["its own print renderer", "window.document.write"],
    ["the saved-prompt panel", "radiology/prompts"],
    ["a tele-radiology share link", "share-link"],
    ["a draft-save transport", "saveRadiologyDraft"],
    ["a finalize transport", "finalizeRadiologyReport"],
  ])("has %s", (_what, token) => {
    expect(legacy, `${_what} is back in RadiologyLegacy.tsx`).not.toContain(token);
  });

  it("positive control: an authoring surface DOES look like this — ReportCanvas", () => {
    // Without this, every assertion above would also pass on an empty file.
    const canvas = read(CANVAS);
    expect(canvas).toContain("<Textarea");
    expect(canvas).toContain("setFindingsMap");
    expect(canvas).toContain("setUseStructured");
    expect(read(FINALIZE_HOOK)).toContain("finalizeRadiologyReport(");
  });

  it("the page is still marked deprecated and still shows the banner", () => {
    // canonicalWorkspaceRouting.test.ts pins this; restated here because the
    // page is being kept, not deleted — its film/CD issuance is real.
    expect(legacy).toContain("@deprecated");
    expect(legacy).toContain("DeprecatedSurfaceBanner");
  });
});

describe("B10-17 — the legacy Reports dialog is read-only and hands off with the right key", () => {
  const legacy = read(LEGACY);

  it("the handoff control itself carries the resolved worklist id, not some other link", () => {
    // Sliced on the marker, exactly as the console's handoff is: a whole-file
    // `toContain` was satisfied by an unrelated link and survived three
    // mutations when B-10 first shipped this.
    const start = legacy.indexOf('data-testid="legacy-report-handoff"');
    expect(start).toBeGreaterThan(-1);
    const block = legacy.slice(start, legacy.indexOf("</Button>", start));
    expect(block).toContain("navigate(reportingWorkspacePath(worklistId))");
    expect(block).not.toContain('"/radiology/report/');
    expect(block).not.toContain("studyId ??");
    expect(block).not.toContain("setBody");
  });

  it("builds that route through the single shared builder", () => {
    expect(legacy).toContain('from "@/lib/reportingWorkspaceRoute"');
    expect(legacy).not.toMatch(/function reportingWorkspacePath|`\/radiology\/report\/\$\{/);
    expect(read("lib/reportingWorkspaceRoute.ts")).toContain("export function reportingWorkspacePath(");
  });

  it("keys the handoff on the worklist row, because the workspace route takes that id", () => {
    expect(legacy).toContain("study?.worklistId ?? null");
    // And says so when there is none, rather than emitting a URL that would 404.
    expect(legacy).toContain("no worklist row");
  });

  it("reads the historical text without offering to write it", () => {
    expect(legacy).toContain("prelimReport");
    expect(legacy).toContain("finalReport");
    expect(legacy).toContain('data-testid="legacy-reports-readonly-notice"');
    expect(legacy).not.toMatch(/<Textarea[^>]*value=\{(body|reportText|prelim|final)/);
  });
});

describe("B10-18 — the write is closed at the route, not by hiding a button", () => {
  const api = readFileSync(join(SRC, API_RADIOLOGY), "utf8");
  const authority = readFileSync(join(SRC, API_AUTHORITY), "utf8");

  it("POST /:id/report asks the pure rule before it builds UPDATE", () => {
    const handler = api.slice(
      api.indexOf('radiologyRouter.post("/:id/report"'),
      api.indexOf('radiologyRouter.post("/:id/claim"'),
    );
    expect(handler).toContain("decideLegacyReportWrite({");
    expect(handler).toContain("if (!authority.allowed)");
    // Ordering is the safety property: gathering facts and refusing must precede
    // the UPDATE, otherwise the guard is a post-hoc message.
    expect(handler.indexOf("decideLegacyReportWrite({")).toBeLessThan(handler.indexOf("db.update(radiologyStudiesTable)"));
    expect(handler).toContain("res.status(authority.httpStatus)");
  });

  it("the refusal codes live in the module, and the route only relays them", () => {
    expect(authority).toContain('export type LegacyReportAuthorityCode');
    expect(authority).toContain('"LEGACY_REPORT_SURFACE_CLOSED"');
    expect(authority).toContain('"LEGACY_REPORT_CREATION_CLOSED"');
    // The route must not invent its own copy of either verdict.
    const handler = api.slice(
      api.indexOf('radiologyRouter.post("/:id/report"'),
      api.indexOf('radiologyRouter.post("/:id/claim"'),
    );
    expect(handler).not.toMatch(/LEGACY_REPORT_SURFACE_CLOSED|LEGACY_REPORT_CREATION_CLOSED/);
  });

  it("the facts come from the two identity columns that actually decide reach", () => {
    const handler = api.slice(
      api.indexOf('radiologyRouter.post("/:id/report"'),
      api.indexOf('radiologyRouter.post("/:id/claim"'),
    );
    expect(handler).toContain("eq(radiologyWorklistTable.studyId, id)");
    expect(handler).toContain("inArray(patientReportsTable.studyId, reportKeys)");
  });

  it("the historical read paths that made this column load-bearing are untouched", () => {
    // B-10 closed a WRITE. These readers still resolve the legacy text, which is
    // what keeps old studies displayable and archivable.
    expect(readFileSync(join(SRC, "../../api-server/src/lib/priorStudies.ts"), "utf8"))
      .toContain("s.finalReport ?? s.prelimReport ?? report?.body ?? null");
    expect(readFileSync(join(SRC, "../../api-server/src/lib/pacsArchive.ts"), "utf8"))
      .toContain("study.finalReport || study.prelimReport");
    expect(readFileSync(join(SRC, "../../api-server/src/routes/patient-reports.ts"), "utf8"))
      .toContain("study.finalReport ?? study.prelimReport ?? \"\"");
  });

  it("the inventory consequence is stated, not silently accepted", () => {
    // radiology.ts is the ONLY caller of hookConsumeOnStudyFinalized. Closing
    // legacy finals therefore removes the only auto-consumption a radiology
    // study ever had; the canonical path consumes on verify, and no ERP screen
    // calls verify. Pinned so a future change cannot quietly re-open this.
    const consumption = readFileSync(join(SRC, "../../api-server/src/lib/inventoryConsumption.ts"), "utf8");
    expect(consumption).toContain("export function hookConsumeOnStudyFinalized");
    const callers = api.match(/hookConsumeOnStudyFinalized\(/g) ?? [];
    expect(callers.length).toBe(1);
  });

  it("positive control: the request-level proof exists and is database-gated", () => {
    const req = readFileSync(
      join(SRC, "../../api-server/src/routes/legacyReportAuthority.request.test.ts"),
      "utf8",
    );
    expect(req).toContain("describe.skipIf(!dbAvailable)");
    expect(req).toContain('LEGACY_REPORT_SURFACE_CLOSED');
    expect(req).toContain("POSITIVE CONTROL — correcting an existing legacy final report still writes");
  });
});

describe("B10-19 — RadiologyLegacy keeps its operational job and its historical reads", () => {
  it("its outbound calls are exactly the measured operational allowlist", () => {
    expect(apiCallsIn(read(LEGACY))).toEqual(LEGACY_OPERATIONAL_CALLS);
  });

  it("film/CD/print issuance — the reason the page is still routed — is intact", () => {
    const legacy = read(LEGACY);
    expect(legacy).toContain("function FilmIssueModal");
    expect(legacy).toContain("/issues");
    expect(legacy).toContain("<Disc");
  });

  it("claim, release, status advance, technician assignment and PACS launch are intact", () => {
    const legacy = read(LEGACY);
    for (const token of [
      "/claim", "/unclaim", "setStudyStatus", "assignTech", "openPacsViewer",
      "/api/radiology/studies/", "/pacs-url",
    ]) {
      expect(legacy, `${token} disappeared with the editor`).toContain(token);
    }
  });

  it("the study-detail MWL/technician modal is unchanged (identity plumbing, not narrative)", () => {
    const legacy = read(LEGACY);
    expect(legacy).toContain("function StudyDetailModal");
    expect(legacy).toContain("DICOM Worklist Fields");
  });
});

describe("B10-21/22 — the protections retired with the shell are still the workspace's alone", () => {
  const apiRoute = readFileSync(join(SRC, API_RADIOLOGY), "utf8");

  it("no new surface grew a copy of the AI acceptance boundary", () => {
    // The shell reached AI through /api/usg-ai/studies/:id/suggest + /accept and
    // appended the answer into the text it signed. Those endpoints still exist;
    // what must not exist is a reporting surface that consumes them unguarded.
    expect(read("lib/zai-workspace/store.ts")).toContain('from "@/lib/zai-workspace/aiProposalContext"');
    expect(read("lib/zai-workspace/copilotAcceptanceContract.ts")).toContain("insertTarget");
    expect(read(LEGACY)).not.toContain("usg-ai");
    expect(read(COMMAND_CENTER)).not.toContain("usg-ai");
  });

  it("the legacy DDL-side status vocabulary was not widened by the guard", () => {
    // The guard must not become a second lifecycle. reported_final is still set by
    // the allowed branch, and the guard never touches status itself.
    expect(apiRoute).toContain('updates.status = "reported_final"');
    const authority = readFileSync(join(SRC, API_AUTHORITY), "utf8");
    expect(authority).not.toContain("updates.status");
  });

  it("D1's fail-closed resolver is still in place after this pass", () => {
    const api = readFileSync(join(SRC, API_RADIOLOGY), "utf8");
    expect(api).toContain("decideStudyUidBinding(");
    expect(api).toContain("canBindUidToRow(");
    expect(api).not.toContain("let hit = orthanc.rows[0]");
  });
});
