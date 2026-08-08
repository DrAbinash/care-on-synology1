import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// USG Companion Workspace contract (P0/P1) — same source-reading style as
// canonicalWorkspaceRouting.test.ts. Proves the dedicated USG shell is a TENANT
// of the canonical platform: it reuses the one lifecycle + PCPNDT gate, invents
// no parallel transport, stays behind its feature flag, and is NOT forked from
// the worklist (Start Report always opens Reporting Workspace).

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const page = read("pages/UsgCompanionWorkspace.tsx");
const app = read("App.tsx");
const worklist = read("pages/RadiologyWorklist.tsx");
const staffSession = read("lib/staffSession.ts");

describe("USG shell — canonical lifecycle reuse", () => {
  it("save + finalize go through lib/radiologyReportLifecycle, never inlined", () => {
    expect(page).toContain('from "@/lib/radiologyReportLifecycle"');
    expect(page).toContain("saveRadiologyDraft");
    expect(page).toContain("finalizeRadiologyReport");
    // No inline copies of the canonical transports.
    expect(page).not.toContain('"/api/radiology/report-generator/save-draft"');
    expect(page).not.toContain('"/api/internal/radiology/report-status"');
    expect(page).not.toContain('"/api/patient-reports"');
  });

  it("draft identity + study lock reuse the canonical hooks", () => {
    expect(page).toContain('from "@/hooks/useRadiologyDraftId"');
    expect(page).toContain('from "@/hooks/useStudyLock"');
  });

  it("does not re-implement the PCPNDT gate (stays server-side via finalize)", () => {
    expect(page).not.toContain("checkPcpndtFormFCompliance");
    expect(page).not.toContain("/form-f");
  });

  it("does not mount a second Quick Findings engine", () => {
    expect(page).not.toContain('from "@/components/radiology/QuickFindingsPanel"');
  });

  it("persists structured findings inside the canonical findings_sections", () => {
    expect(page).toContain("buildUsgDraftPayload");
    // The payload builder uses the canonical field names only.
    const composer = read("lib/usgReportComposer.ts");
    expect(composer).toContain("findingsSections");
    expect(composer).toContain("findings: [],"); // structured findings ride inside findings_sections
  });
});

describe("USG shell — flag gating & routing", () => {
  it("is registered at /radiology/usg/:studyId without disturbing the canonical route", () => {
    expect(app).toContain('path="/radiology/usg/:studyId"');
    // Canonical route still bound to the canonical page (the routing guard also checks this).
    expect(app).toMatch(/path="\/radiology\/report\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/);
  });

  it("is gated by ff_radiology_usg_workspace (defined off by default)", () => {
    expect(staffSession).toContain("ff_radiology_usg_workspace: false");
    expect(page).toContain('isFeatureEnabled("ff_radiology_usg_workspace")');
    // Flag off → redirect to canonical (no regression).
    expect(page).toContain("/radiology/report/");
  });

  it("the worklist opens every modality on the canonical report path (no USG shell fork)", () => {
    // P0: one open-report path. USG Companion stays at /radiology/usg/:studyId
    // behind the flag for deep links, but Start Report from the worklist always
    // goes to Reporting Workspace — Companion widgets live there when needed.
    expect(worklist).toContain("function reportingWorkspacePath");
    expect(worklist).toContain("`/radiology/report/${entry.id}`");
    expect(worklist).not.toContain('isFeatureEnabled("ff_radiology_usg_workspace")');
    expect(worklist).not.toContain("`/radiology/usg/${entry.id}`");
  });
});

describe("USG shell — platform-contract naming", () => {
  it("declares no banned Usg-engine identifier (uses UsgCompanionWorkspace)", () => {
    expect(page).toContain("export default function UsgCompanionWorkspace");
    // The platform-contract forbids `function UsgWorkspace` / `const UsgWorkspace` etc.
    expect(page).not.toMatch(/(?:function|const|class)\s+Usg(?:Workspace|Copilot|QualityEngine|TemplateEngine|ComparisonEngine|FindingsEngine|MeasurementEngine)\b/);
  });
});
