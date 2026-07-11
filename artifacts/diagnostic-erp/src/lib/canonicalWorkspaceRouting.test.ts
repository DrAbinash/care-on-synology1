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
    "pages/RadiologistCockpit.tsx",
    "pages/RadiologyCommandCenter.tsx",
    "pages/RadiologyReportGenerator.tsx",
    "pages/RadiologyLegacy.tsx",
  ])("%s carries the @deprecated contract and the visible banner", (rel) => {
    const src = read(rel);
    expect(src).toContain("@deprecated");
    expect(src).toContain("DeprecatedSurfaceBanner");
  });

  it("the canonical workspace is NOT marked deprecated", () => {
    expect(read("pages/RadiologyReportingWorkspace.tsx")).not.toContain("@deprecated");
  });
});

describe("M1.1 — no duplicate state/service copies reactivate", () => {
  it("exactly one reporting page consumes the structured QuickFindingsPanel", () => {
    // The admin CRUD page for the same API may import the panel's types;
    // the PANEL as a quick-select provider belongs to the canonical page only.
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    expect(workspace).toContain('from "@/components/radiology/QuickFindingsPanel"');
    for (const rel of [
      "pages/RadiologistCockpit.tsx",
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
      "pages/RadiologistCockpit.tsx",
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
      "pages/RadiologistCockpit.tsx",
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
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
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
  const workspace = read("pages/RadiologyReportingWorkspace.tsx");

  it("the workspace's state RULES live in lib/workspaceReportState (no inline second store)", () => {
    expect(workspace).toContain('from "@/lib/workspaceReportState"');
    for (const helper of [
      "isReportDirty", "shouldOfferBackupRestore", "restorableSelections",
      "deriveLifecycleBadges", "canVerifyReport", "matchWorkspaceShortcut",
    ]) {
      expect(workspace, `workspace must use ${helper} from the lib`).toContain(helper);
    }
  });

  it("validation and selections come from the backend — never recomputed in React", () => {
    // Read-only backend endpoints added by M1.4; the page only displays
    // their results (no D4/D1 logic in the frontend).
    expect(workspace).toContain("/api/radiology/report-generator/validate-draft");
    expect(workspace).toContain("/api/radiology/report-generator/finding-instances");
    // No client-side hashing/validating of structured documents.
    expect(workspace).not.toMatch(/sha256\s*\(/i);
    expect(workspace).not.toContain("schema_version");
  });

  it("the ONE QuickFindingsPanel restores persisted selections via onFindingsLoaded", () => {
    expect(workspace).toContain("onFindingsLoaded={handleFindingsLoaded}");
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toContain("onFindingsLoaded");
    expect(panel).toContain("data-qs-search"); // Ctrl+K / "/" focus target
  });

  it("the D9 verify action uses the existing route — no new verification transport", () => {
    expect(workspace).toContain("/verify");
    expect(workspace).toContain("canVerifyReport");
  });
});

describe("M1.5 — productivity workflow stays canonical", () => {
  const workspace = read("pages/RadiologyReportingWorkspace.tsx");

  it("all workflow actions route through THE command dispatcher", () => {
    expect(workspace).toContain('from "@/lib/workspaceCommands"');
    expect(workspace).toContain("createCommandDispatcher(");
    expect(workspace).toContain("commandDispatcher.dispatch(");
  });

  it("queue data comes from the ONE shared worklist query (no duplicate fetch)", () => {
    const hook = read("hooks/useReportingWorkflow.ts");
    // Same query key as pages/RadiologyWorklist.tsx — one cache entry.
    expect(hook).toContain('"radiology-pacs-worklist"');
    expect(read("pages/RadiologyWorklist.tsx")).toContain('"radiology-pacs-worklist"');
    // The workspace itself never fetches the worklist directly.
    expect(workspace).not.toContain('"/api/radiology/pacs-worklist"');
  });

  it("transition rules live in lib/reportingWorkflow (pure), not inline", () => {
    expect(workspace).toContain('from "@/lib/reportingWorkflow"');
    expect(workspace).toContain("canLeaveStudy");
    const lib = read("lib/reportingWorkflow.ts");
    expect(lib).toContain("nextEligibleStudy");
    expect(lib).toContain("canLeaveStudy");
  });

  it("the launch panel exposes its state instead of the page duplicating launch logic", () => {
    expect(read("components/radiology/OpenStudyPanel.tsx")).toContain("onLaunchStateChange");
    expect(workspace).toContain("onLaunchStateChange={setViewerLaunch}");
  });
});
