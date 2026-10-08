import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Ticket M1.1 — canonical radiology workspace consolidation guard.
//
// RadiologyReportingWorkspace is THE canonical reporting page. After Phase 4
// the monolith snapshot was deleted; contracts live on the modular page +
// hooks + shell. Bookmarks to /radiology/legacy-workspace redirect here.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const app = read("App.tsx");
const workspacePage = read("pages/RadiologyReportingWorkspace.tsx");
const workspaceHooksDir = "hooks/radiology-workspace";
const workspaceShellDir = "components/radiology/workspace";
/** Phase 4: page is composition-only — scan hooks + shell for contracts. */
const workspace = [
  workspacePage,
  ...readdirSync(join(SRC, workspaceHooksDir)).filter((n) => /\.tsx?$/.test(n)).map((n) => read(`${workspaceHooksDir}/${n}`)),
  ...readdirSync(join(SRC, workspaceShellDir)).filter((n) => /\.tsx?$/.test(n)).map((n) => read(`${workspaceShellDir}/${n}`)),
].join("\n");

describe("M1.1 — canonical routing", () => {
  it("the canonical page serves /radiology/report/:studyId and all its aliases", () => {
    expect(app).toMatch(/path="\/radiology\/report\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/reporting-workspace">\s*\{\(\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/reporting-workspace\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/unified-report\/:worklistId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
  });

  it("retired legacy-workspace bookmarks land on the modular workspace", () => {
    const retiredSnapshot = ["RadiologyReportingWorkspace", "legacy"].join(".") + ".tsx";
    expect(existsSync(join(SRC, "pages", retiredSnapshot))).toBe(false);
    expect(app).not.toContain("RadiologyReportingWorkspaceLegacy");
    expect(app).toMatch(/path="\/radiology\/legacy-workspace">\s*\{\(\) => <RadiologyReportingWorkspace/);
    expect(app).toMatch(/path="\/radiology\/legacy-workspace\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
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
  it("canonical Quick Add reuses QuickFindingsPanel inside the one Reporting Tools surface", () => {
    expect(workspace).toContain('from "@/components/radiology/QuickFindingsPanel"');
    expect(workspace).toContain("<ReportingToolsPanel");
    expect(workspace).toContain('data-testid="quick-insert"');
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
    for (const rel of [
      "pages/RadiologyReportingWorkspace.tsx",
      "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx",
      "hooks/radiology-workspace/useDraftPersistence.ts",
      "hooks/radiology-workspace/useStudyFinalize.ts",
      "pages/RadiologyCommandCenter.tsx",
      "pages/RadiologyReportGenerator.tsx",
    ]) {
      const src = read(rel);
      expect(src, `${rel} must not inline the save-draft endpoint`).not.toContain(
        '"/api/radiology/report-generator/save-draft"',
      );
    }
    for (const rel of [
      "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx",
      "hooks/radiology-workspace/useDraftPersistence.ts",
      "hooks/radiology-workspace/useStudyFinalize.ts",
    ]) {
      const src = read(rel);
      expect(src, `${rel} must not inline the finalize status POST`).not.toContain(
        '"/api/internal/radiology/report-status"',
      );
      expect(src).toContain('from "@/lib/radiologyReportLifecycle"');
    }
    // B-10: the Command Center used to satisfy the loop above by importing the
    // shared transport. Delegating was the right answer while it kept its own
    // editor; the right answer now is that it has no reach into report content
    // or status at all, so it must not import the transport either.
    const cc = read("pages/RadiologyCommandCenter.tsx");
    expect(cc).not.toContain('from "@/lib/radiologyReportLifecycle"');
    expect(cc).not.toContain("saveRadiologyDraft");
    expect(cc).not.toContain("finalizeRadiologyReport");
    expect(workspacePage).not.toContain('"/api/internal/radiology/report-status"');
    expect(workspacePage).not.toContain('"/api/radiology/report-generator/save-draft"');
    const lifecycle = read("lib/radiologyReportLifecycle.ts");
    expect(lifecycle).toContain('"/api/radiology/report-generator/save-draft"');
    expect(lifecycle).toContain('"/api/internal/radiology/report-status"');
    expect(lifecycle).toContain('deliveryStatus: "READY_TO_SEND"');
  });

  it("the canonical workspace launches studies through the ONE launch pipeline (M1.2)", () => {
    expect(workspace).toContain('from "@/components/radiology/LegacyBox"');
    expect(workspace).not.toContain("weasis-launch-redirect");
    expect(workspace).not.toContain("window.open(`/radiology/viewer");
    const legacyBox = read("components/radiology/LegacyBox.tsx");
    expect(legacyBox).toContain('from "@/components/radiology/OpenStudyPanel"');
    const panel = read("components/radiology/OpenStudyPanel.tsx");
    expect(panel).toContain('from "@/lib/studyLaunchService"');
    expect(panel).not.toContain("StudyInstanceUIDs=");
  });
});

describe("M1.4 — canonical reporting workflow integration", () => {
  it("the workspace's state RULES live in lib/workspaceReportState (no inline second store)", () => {
    expect(workspace).toContain('from "@/lib/workspaceReportState"');
    for (const helper of ["shouldOfferBackupRestore", "canVerifyReport", "matchWorkspaceShortcut"]) {
      expect(workspace, `canonical workspace must use ${helper} from the lib`).toContain(helper);
    }
    expect(workspace, "canonical workspace must normalize impression via the lib").toContain("normalizeImpressionLines");
  });

  it("validation and selections come from the backend — never recomputed in React", () => {
    expect(workspace).not.toMatch(/sha256\s*\(/i);
    expect(workspace).not.toContain("schema_version");
  });

  it("QuickFindingsPanel keeps its existing onFindingsLoaded plumbing", () => {
    expect(workspace).toContain("onFindingsLoaded=");
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toContain("onFindingsLoaded");
    expect(panel).toContain("data-qs-search");
  });

  it("the D9 verify action uses canVerifyReport from the shared lib", () => {
    expect(workspace).toContain("canVerifyReport");
  });
});

describe("M1.5 — productivity workflow stays canonical", () => {
  it("all workflow actions route through THE command dispatcher", () => {
    expect(workspace).toContain('from "@/lib/workspaceCommands"');
    expect(workspace).toContain("createCommandDispatcher(");
    expect(workspace).toContain("commandDispatcher.dispatch(");
  });

  it("queue data comes from the ONE shared worklist query (no duplicate fetch)", () => {
    const hook = read("hooks/useReportingWorkflow.ts");
    expect(hook).toContain('"radiology-pacs-worklist"');
    expect(read("pages/RadiologyWorklist.tsx")).toContain('"radiology-pacs-worklist"');
    expect(workspace).not.toContain('"/api/radiology/pacs-worklist"');
  });

  it("transition rules live in lib/reportingWorkflow (pure), not inline", () => {
    // Modular leave gate goes through leaveDirtyStudy → canLeaveStudy.
    expect(workspace).toContain('from "@/lib/leaveDirtyStudy"');
    expect(workspace).toContain("leaveDirtyStudy");
    const leave = read("lib/leaveDirtyStudy.ts");
    expect(leave).toContain("canLeaveStudy");
    const lib = read("lib/reportingWorkflow.ts");
    expect(lib).toContain("nextEligibleStudy");
    expect(lib).toContain("canLeaveStudy");
  });

  it("the launch panel exposes its state instead of the page duplicating launch logic", () => {
    expect(read("components/radiology/OpenStudyPanel.tsx")).toContain("onLaunchStateChange");
    // Modular mounts OpenStudyPanel via LegacyBox (no page-local launch state).
    expect(workspace).toContain('from "@/components/radiology/LegacyBox"');
  });
});

describe("M1.6A — study locking stays canonical", () => {
  it("the workspace claims through the ONE lock hook; rules live in libs", () => {
    expect(workspace).toContain('from "@/hooks/useStudyLock"');
    const hook = read("hooks/useStudyLock.ts");
    for (const endpoint of ["/claim", "/heartbeat", "/release", "/force-release"]) {
      expect(hook, `hook must own the ${endpoint} transport`).toContain(`worklist-lock/\${target}${endpoint}`);
    }
  });

  it("no client-supplied lock owner identity anywhere", () => {
    const hook = read("hooks/useStudyLock.ts");
    expect(hook).not.toMatch(/post[^;]*lockUserId/s);
    expect(workspace).not.toMatch(/post[^;]*lockUserName/s);
  });

  it("locked-by-other folds into the ONE editing gate (read-only view)", () => {
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
  const voiceReporting = read("hooks/radiology-workspace/useVoiceReporting.ts");
  const workspaceCommands = read("hooks/radiology-workspace/useWorkspaceCommands.ts");

  it("the workspace mounts the ONE voice pipeline (hook + bar), rules in libs", () => {
    expect(workspace).toContain('from "@/hooks/radiology-workspace/useVoiceReporting"');
    expect(voiceReporting).toContain('from "@/hooks/useVoiceSession"');
    expect(workspace).toContain('from "@/components/radiology/VoiceCommandBar"');
    const hook = read("hooks/useVoiceSession.ts");
    expect(hook).toContain('from "@/lib/voiceSafetyPolicy"');
    expect(hook).toContain('from "@/lib/voiceTranscription"');
  });

  it("voice workflow intents execute ONLY through the M1.5 dispatcher", () => {
    expect(workspaceCommands).toContain("commandDispatcher.dispatch");
    expect(voiceReporting).toContain("commandDispatcherRef.current?.dispatch");
    expect(workspace).toContain("commandDispatcher.dispatch");
    for (const src of [workspace, voiceReporting]) {
      expect(src).not.toContain("webkitSpeechRecognition");
      expect(src).not.toContain("new SpeechRecognition");
    }
  });

  it("voice never invents transport: audit + transcribe ride existing patterns", () => {
    expect(voiceReporting).toContain("/api/radiology/voice-command-audit");
    const provider = read("lib/voiceTranscription.ts");
    expect(provider).toContain("/api/ai/transcribe");
    expect(provider).not.toMatch(/api[_-]key/i);
  });

  it("the embedded viewer exposes existing operations plus jump-back helpers to voice", () => {
    const viewer = read("components/EmbeddedWadoViewer.tsx");
    expect(viewer).toContain("useImperativeHandle");
    expect(viewer).toContain("nextFrame");
    expect(viewer).toContain("prevFrame");
    expect(viewer).toContain("zoomIn");
    expect(viewer).toContain("zoomOut");
    expect(viewer).toContain("resetView");
    expect(viewer).toContain("goToAnchor");
    expect(viewer).toContain("getOhifWindow");
    expect(viewer).toContain("getOhifLaunchUrl");
  });

  it("voice quick-search drives the panel's ONE search state via externalSearch", () => {
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toContain("externalSearch");
    expect(workspace).toContain("externalSearch={qsExternalSearch}");
    expect(voiceReporting).toContain("setQsExternalSearch");
  });

  it("voice settings live in RadiologySettingsCenter (pacs_settings, category voice)", () => {
    const settings = read("pages/RadiologySettingsCenter.tsx");
    expect(settings).toContain('category: "voice"');
    expect(settings).toContain("VoiceSettingsPanel");
    expect(voiceReporting).toContain("parseVoiceSettings");
  });
});

describe("M1.6B1 — assignment management stays canonical", () => {
  it("assignment writes go ONLY through the worklist-assignment endpoints", () => {
    const worklist = read("pages/RadiologyWorklist.tsx");
    expect(worklist).toContain("/worklist-assignment/");
    expect(workspace).not.toContain("/worklist-assignment/");
  });

  it("the By-Radiologist scope parses through the ONE scope parser", () => {
    const chrome = read("components/radiology/ReportingWorkspaceChrome.tsx");
    expect(chrome).toContain('optgroup label="By radiologist"');
    expect(read("lib/studyLockState.ts")).toContain("export function parseQueueScope");
  });
});
