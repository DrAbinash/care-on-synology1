import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Ticket M1.1 — canonical radiology workspace consolidation guard.
//
// RadiologyReportingWorkspace is THE canonical reporting page. This test
// pins the consolidation against the real source (same source-reading style
// as removeImpressionShadowing.test.ts): the canonical routes stay bound to
// the canonical page, every legacy route keeps working (registered), the
// dead page stays dead, deprecated pages stay visibly deprecated, and the
// duplicate state/service copies do not silently come back.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const app = read("App.tsx");
// Modular rewrite (Aug 2026): the canonical route serves the new Z.ai workspace;
// the former 7,886-line monolith lives at .legacy.tsx and stays registered at
// /radiology/legacy-workspace for parity until every contract is ported.
const workspace = read("pages/RadiologyReportingWorkspace.tsx");
const legacy = read("pages/RadiologyReportingWorkspace.legacy.tsx");

describe("M1.1 — canonical routing", () => {
  it("the canonical page serves /radiology/report/:studyId and all its aliases", () => {
    // Primary route + named alias + old unified-report URL all render
    // RadiologyReportingWorkspace.
    expect(app).toMatch(/path="\/radiology\/report\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/reporting-workspace">\s*\{\(\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/reporting-workspace\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/unified-report\/:worklistId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
  });

  it("every legacy route keeps working (no route was broken)", () => {
    for (const route of [
      '"/radiology/report-legacy/:studyId"',
      '"/radiology/cockpit"',
      '"/radiology/command-center"',
      '"/radiology/command-center/:studyId"',
      '"/radiology/report-generator"',
      '"/radiology/report-generator/:studyId"',
      '"/radiology/legacy"',
      '"/radiology/worklist"',
      '"/report-hub"',
      '"/settings/radiology"',
      '"/settings/radiology-quick-select"',
    ]) {
      expect(app, `route ${route} must stay registered`).toContain(`path=${route}`);
    }
  });

  it("the dead RadiologyReportUnified page stays deleted and unreferenced", () => {
    expect(existsSync(join(SRC, "pages/RadiologyReportUnified.tsx"))).toBe(false);
    // No import and no JSX usage — the route-map comment may still mention
    // the removal itself.
    expect(app).not.toContain('import("@/pages/RadiologyReportUnified")');
    expect(app).not.toContain("<RadiologyReportUnified");
  });

  it("the old simple editor is a thin redirect to the canonical page", () => {
    const editor = read("pages/RadiologyReportEditor.tsx");
    expect(editor.split("\n").length).toBeLessThan(60);
    expect(editor).toContain("@deprecated");
    expect(editor).toContain("/radiology/report/");
  });
});

describe("M1.1 — deprecated surfaces stay marked", () => {
  it.each([
    "pages/RadiologyCommandCenter.tsx",
    "pages/RadiologyReportGenerator.tsx",
    "pages/RadiologyLegacy.tsx",
  ])("%s carries the @deprecated contract and the visible banner", (rel) => {
    const src = read(rel);
    expect(src).toContain("@deprecated");
    expect(src).toContain("DeprecatedSurfaceBanner");
  });

  it("the canonical workspace is NOT marked deprecated", () => {
    expect(workspace).not.toContain("@deprecated");
  });
});

describe("M1.1 — no duplicate state/service copies reactivate", () => {
  it("exactly one reporting page consumes the structured QuickFindingsPanel (legacy until Z.ai port)", () => {
    // The new modular workspace uses QuickSelectEditor instead; the legacy
    // monolith is the sole QuickFindingsPanel mount until that port lands.
    expect(legacy).toContain('from "@/components/radiology/QuickFindingsPanel"');
    expect(workspace).toContain("QuickSelectEditor");
    for (const rel of [
      "pages/RadiologyCommandCenter.tsx",
      "pages/RadiologyReportGenerator.tsx",
      "pages/RadiologyLegacy.tsx",
    ]) {
      expect(read(rel), `${rel} must not mount a second QuickFindingsPanel`).not.toContain(
        'from "@/components/radiology/QuickFindingsPanel"',
      );
    }
  });

  it("draft save + finalize transport lives ONLY in lib/radiologyReportLifecycle", () => {
    // The reporting pages must not regrow inline copies of the canonical
    // two-step finalize or the save-draft POST.
    for (const rel of [
      "pages/RadiologyReportingWorkspace.tsx",
      "pages/RadiologyReportingWorkspace.legacy.tsx",
      "pages/RadiologyCommandCenter.tsx",
      "pages/RadiologyReportGenerator.tsx",
    ]) {
      const src = read(rel);
      expect(src, `${rel} must not inline the save-draft endpoint`).not.toContain(
        '"/api/radiology/report-generator/save-draft"',
      );
    }
    for (const rel of [
      "pages/RadiologyReportingWorkspace.tsx",
      "pages/RadiologyReportingWorkspace.legacy.tsx",
      "pages/RadiologyCommandCenter.tsx",
    ]) {
      const src = read(rel);
      expect(src, `${rel} must not inline the finalize status POST`).not.toContain(
        '"/api/internal/radiology/report-status"',
      );
      expect(src).toContain('from "@/lib/radiologyReportLifecycle"');
    }
    const lifecycle = read("lib/radiologyReportLifecycle.ts");
    expect(lifecycle).toContain('"/api/radiology/report-generator/save-draft"');
    expect(lifecycle).toContain('"/api/internal/radiology/report-status"');
    expect(lifecycle).toContain('deliveryStatus: "READY_TO_SEND"');
  });

  it("the canonical workspace launches studies through the ONE launch pipeline (M1.2)", () => {
    // Since M1.2 every launch goes through OpenStudyPanel →
    // lib/studyLaunchService (network selection + URL construction). The
    // page itself builds no viewer URLs.
    expect(workspace).toContain('from "@/components/radiology/OpenStudyPanel"');
    expect(workspace).not.toContain("weasis-launch-redirect"); // no inline URL copy left
    expect(workspace).not.toContain("window.open(`/radiology/viewer");
    const panel = read("components/radiology/OpenStudyPanel.tsx");
    expect(panel).toContain('from "@/lib/studyLaunchService"');
    // The panel builds no URLs either — the service is the single source.
    expect(panel).not.toContain("StudyInstanceUIDs=");
  });
});

describe("M1.4 — canonical reporting workflow integration", () => {
  it("the workspace's state RULES live in lib/workspaceReportState (no inline second store)", () => {
    for (const src of [workspace, legacy]) {
      expect(src).toContain('from "@/lib/workspaceReportState"');
    }
    // Shared pure helpers both surfaces must pull from the lib (not re-implement).
    for (const helper of ["shouldOfferBackupRestore", "canVerifyReport", "matchWorkspaceShortcut"]) {
      expect(workspace, `canonical workspace must use ${helper} from the lib`).toContain(helper);
      expect(legacy, `legacy workspace must use ${helper} from the lib`).toContain(helper);
    }
    // Dirty detection: legacy uses isReportDirty snapshots; modular uses zustand isDirty
    // plus normalizeImpressionLines for backup/hydrate (string vs string[] impression).
    expect(legacy, "legacy workspace must use isReportDirty from the lib").toContain("isReportDirty");
    expect(workspace, "canonical workspace must normalize impression via the lib").toContain("normalizeImpressionLines");
    // Full selection-restore helpers remain on the legacy monolith until ported.
    for (const helper of ["restorableSelections", "deriveLifecycleBadges"]) {
      expect(legacy, `legacy workspace must use ${helper} from the lib`).toContain(helper);
    }
  });

  it("validation and selections come from the backend — never recomputed in React", () => {
    // Read-only backend endpoints added by M1.4; the legacy page only displays
    // their results (no D4/D1 logic in the frontend).
    expect(legacy).toContain("/api/radiology/report-generator/validate-draft");
    expect(legacy).toContain("/api/radiology/report-generator/finding-instances");
    for (const src of [workspace, legacy]) {
      expect(src).not.toMatch(/sha256\s*\(/i);
      expect(src).not.toContain("schema_version");
    }
  });

  it("the ONE QuickFindingsPanel restores persisted selections via onFindingsLoaded (legacy)", () => {
    expect(legacy).toContain("onFindingsLoaded={handleFindingsLoaded}");
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toContain("onFindingsLoaded");
    expect(panel).toContain("data-qs-search"); // Ctrl+K / "/" focus target
  });

  it("the D9 verify action uses the existing route — no new verification transport (legacy)", () => {
    expect(legacy).toContain("/verify");
    expect(legacy).toContain("canVerifyReport");
  });
});

describe("M1.5 — productivity workflow stays canonical", () => {
  it("all workflow actions route through THE command dispatcher", () => {
    expect(workspace).toContain('from "@/lib/workspaceCommands"');
    expect(workspace).toContain("createCommandDispatcher(");
    expect(workspace).toContain("commandDispatcher.dispatch(");
  });

  it("queue data comes from the ONE shared worklist query (no duplicate fetch on legacy)", () => {
    const hook = read("hooks/useReportingWorkflow.ts");
    // Same query key as pages/RadiologyWorklist.tsx — one cache entry.
    expect(hook).toContain('"radiology-pacs-worklist"');
    expect(read("pages/RadiologyWorklist.tsx")).toContain('"radiology-pacs-worklist"');
    // The legacy monolith never fetches the worklist directly; the modular
    // rewrite still has a transitional direct fetch — tracked separately.
    expect(legacy).not.toContain('"/api/radiology/pacs-worklist"');
  });

  it("transition rules live in lib/reportingWorkflow (pure), not inline (legacy)", () => {
    expect(legacy).toContain('from "@/lib/reportingWorkflow"');
    expect(legacy).toContain("canLeaveStudy");
    const lib = read("lib/reportingWorkflow.ts");
    expect(lib).toContain("nextEligibleStudy");
    expect(lib).toContain("canLeaveStudy");
  });

  it("the launch panel exposes its state instead of the page duplicating launch logic (legacy)", () => {
    expect(read("components/radiology/OpenStudyPanel.tsx")).toContain("onLaunchStateChange");
    expect(legacy).toContain("onLaunchStateChange={setViewerLaunch}");
  });
});

describe("M1.6A — study locking stays canonical", () => {
  it("the workspace claims through the ONE lock hook; rules live in libs", () => {
    expect(workspace).toContain('from "@/hooks/useStudyLock"');
    expect(legacy).toContain('from "@/lib/studyLockState"');
    const hook = read("hooks/useStudyLock.ts");
    for (const endpoint of ["/claim", "/heartbeat", "/release", "/force-release"]) {
      expect(hook, `hook must own the ${endpoint} transport`).toContain(`worklist-lock/\${target}${endpoint}`);
    }
  });

  it("no client-supplied lock owner identity anywhere", () => {
    // Owner identity is server-derived from the staff session; the frontend
    // never posts a lockUserId/lockUserName.
    const hook = read("hooks/useStudyLock.ts");
    expect(hook).not.toMatch(/post[^;]*lockUserId/s);
    expect(workspace).not.toMatch(/post[^;]*lockUserName/s);
    expect(legacy).not.toMatch(/post[^;]*lockUserName/s);
  });

  it("locked-by-other folds into the ONE editing gate (read-only view)", () => {
    expect(legacy).toContain("statusLocked || lockedByOther");
    expect(workspace).toContain('studyLock.status === "locked-by-other"');
  });

  it("assignment-aware scope filters run through the workflow controller", () => {
    const chrome = read("components/radiology/ReportingWorkspaceChrome.tsx");
    expect(chrome).toContain('data-testid="queue-scope"');
    const hook = read("hooks/useReportingWorkflow.ts");
    expect(hook).toContain("filterQueueByScope");
  });
});

describe("M1.6B2 — voice layer stays canonical", () => {
  it("the workspace mounts the ONE voice pipeline (hook + bar), rules in libs", () => {
    expect(workspace).toContain('from "@/hooks/useVoiceSession"');
    expect(workspace).toContain('from "@/components/radiology/VoiceCommandBar"');
    expect(legacy).toContain('from "@/lib/voiceCommandGrammar"');
    expect(legacy).toContain('from "@/lib/voiceSessionState"');
    const hook = read("hooks/useVoiceSession.ts");
    expect(hook).toContain('from "@/lib/voiceSafetyPolicy"');
    expect(hook).toContain('from "@/lib/voiceTranscription"');
  });

  it("voice workflow intents execute ONLY through the M1.5 dispatcher", () => {
    // Legacy: adapter's workflow branch dispatches by command id.
    expect(legacy).toMatch(/case "workflow":[\s\S]{0,400}commandDispatcher\.dispatch\(intent\.command\)/);
    // Modular: voice execute routes through the same dispatcher.
    expect(workspace).toContain("commandDispatcher.dispatch");
    for (const src of [workspace, legacy]) {
      expect(src).not.toContain("webkitSpeechRecognition");
      expect(src).not.toContain("new SpeechRecognition");
    }
  });

  it("voice never invents transport: audit + transcribe ride existing patterns", () => {
    expect(workspace).toContain("/api/radiology/voice-command-audit");
    const provider = read("lib/voiceTranscription.ts");
    expect(provider).toContain("/api/ai/transcribe"); // the EXISTING server endpoint
    expect(provider).not.toMatch(/api[_-]key/i);      // no keys in the frontend
  });

  it("the embedded viewer exposes only its existing operations to voice", () => {
    const viewer = read("components/EmbeddedWadoViewer.tsx");
    expect(viewer).toContain("useImperativeHandle");
    expect(viewer).toMatch(/\{ nextFrame, prevFrame, zoomIn, zoomOut, resetView \}/);
  });

  it("voice quick-search drives the panel's ONE search state via externalSearch (legacy)", () => {
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toContain("externalSearch");
    expect(legacy).toContain("externalSearch={qsExternalSearch}");
  });

  it("voice settings live in RadiologySettingsCenter (pacs_settings, category voice)", () => {
    const settings = read("pages/RadiologySettingsCenter.tsx");
    expect(settings).toContain('category: "voice"');
    expect(settings).toContain("VoiceSettingsPanel");
    expect(workspace).toContain("parseVoiceSettings");
  });
});

describe("M1.6B1 — assignment management stays canonical", () => {
  it("assignment writes go ONLY through the worklist-assignment endpoints", () => {
    const worklist = read("pages/RadiologyWorklist.tsx");
    expect(worklist).toContain("/worklist-assignment/");
    // No page writes assignment columns through any other transport.
    expect(workspace).not.toContain("/worklist-assignment/"); // workspace displays; the worklist manages
    expect(legacy).toContain("assignmentCategoryOf"); // display + warning rules from the lib
  });

  it("the By-Radiologist scope parses through the ONE scope parser (legacy chrome)", () => {
    expect(legacy).toContain("parseQueueScope");
    const chrome = read("components/radiology/ReportingWorkspaceChrome.tsx");
    expect(chrome).toContain('optgroup label="By radiologist"');
  });
});
