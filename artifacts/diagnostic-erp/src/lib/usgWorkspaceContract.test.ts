import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// USG Companion contract — rewritten by B-10.
//
// This file used to prove that the dedicated USG shell
// (pages/UsgCompanionWorkspace.tsx) was a well-behaved TENANT of the canonical
// platform: one lifecycle, one PCPNDT gate, no forked transport. That framing
// was right about the transport and wrong about the boundary. The shell saved
// and finalized through lib/radiologyReportLifecycle, so it wrote the same rows
// as the workspace, but it held none of the protections that live AT those
// transports: grep for `zai-workspace`, `isFinalized`, `signedContentLocked`,
// `aiProposalContext`, `insertTarget` or the Observation Ledger in the file and
// every count is 0. It composed its own `htmlBody` from organ sections, asked
// `window.confirm("Finalize and sign this ultrasound report?")`, and let
// UsgAiPanel/UsgPriorComparison/UsgPregnancyTimeline `onAccept` append model
// prose into the very impression that became the signed document — the AI
// acceptance path (#880 target, #882 fingerprint) simply was not in the call
// graph. Which is precisely the shape B-10 forbids: a second place authoritative
// USG content can be authored, accepted into and signed.
//
// So the shell is retired, and this file now proves the retirement:
//   1. the page is gone, so it cannot be re-wired by accident;
//   2. its URL redirects to the canonical workspace, so deep links still land on
//      one surface with the same study;
//   3. the LEGITIMATE half — UsgCompanionPanel inside the workspace — survives,
//      measured as a positive control so a blanket deletion cannot pass;
//   4. `ff_radiology_usg_workspace` still defaults OFF and now gates nothing in
//      the ERP (the api-server rollout plan still lists it — reported, not
//      silently repudiated);
//   5. the orphaned `components/radiology/usg/*` widgets declare no banned
//      parallel engine, which is the only contract left that they can honour.

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const app = read("App.tsx");
const worklist = read("pages/RadiologyWorklist.tsx");
const staffSession = read("lib/staffSession.ts");
const CANVAS = "components/radiology/workspace/ReportCanvas.tsx";
const TOOLS_RAIL = "components/radiology/workspace/ReportingToolsRail.tsx";
const CLINICAL_UI = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";

describe("USG shell — retired as an authoring surface (B-10)", () => {
  it("the page file no longer exists", () => {
    expect(existsSync(join(SRC, "pages", "UsgCompanionWorkspace.tsx"))).toBe(false);
    expect(app).not.toContain('import("@/pages/UsgCompanionWorkspace")');
    expect(app).not.toContain("<UsgCompanionWorkspace");
  });

  it("/radiology/usg/:studyId redirects to the canonical workspace", () => {
    expect(app).toMatch(
      /path="\/radiology\/usg\/:studyId">\s*\{\(params\) => <RedirectToReportWorkspace studyId=\{params\.studyId\} \/>\}/,
    );
    // POSITIVE CONTROL: the canonical route must still be bound to the canonical
    // page. Without this, an edit that deleted BOTH routes would pass.
    expect(app).toMatch(
      /path="\/radiology\/report\/:studyId">\s*\{\(params\) => <RadiologyReportingWorkspace/,
    );
  });

  it("the redirect preserves identity: the same :studyId reaches /radiology/report/:studyId", () => {
    // The shell's parameter was already a radiology_worklist.id — it fetched
    // /api/internal/radiology/worklist/${studyId} — so the keys are the same and
    // RedirectToReportWorkspace needs no translation.
    const redirect = app.slice(
      app.indexOf("function RedirectToReportWorkspace"),
      app.indexOf("function OwnerOnlyPreserved"),
    );
    expect(redirect).toContain("navigate(studyId ? `/radiology/report/${studyId}` : \"/radiology/worklist\"");
    expect(redirect).toContain("{ replace: true }");
  });

  it("ff_radiology_usg_workspace still defaults OFF and has no ERP reader left", () => {
    expect(staffSession).toContain("ff_radiology_usg_workspace: false");
    const readers = readdirRec("pages").filter((f) => read(f).includes('isFeatureEnabled("ff_radiology_usg_workspace")'));
    expect(readers, `flag must gate no page: ${readers.join(", ")}`).toEqual([]);
  });
});

describe("USG companion — the legitimate half survives (positive controls)", () => {
  it("UsgCompanionPanel is still mounted inside the canonical workspace", () => {
    // B-10 removed a second shell, not ultrasound support. Each of these three
    // files must still reference the panel, or the retirement has regressed the
    // feature it was supposed to preserve.
    expect(read(CLINICAL_UI)).toContain('import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel"');
    for (const rel of [CANVAS, TOOLS_RAIL]) {
      const src = read(rel);
      expect(src, `${rel} must still import the panel`).toContain(
        'import UsgCompanionPanel from "@/components/radiology/UsgCompanionPanel"',
      );
      expect(src, `${rel} must still mount the panel`).toContain("<UsgCompanionPanel");
    }
    expect(existsSync(join(SRC, "components", "radiology", "UsgCompanionPanel.tsx"))).toBe(true);
  });

  it("the OB dashboard strip is still in the workspace too", () => {
    expect(read(CANVAS)).toContain("<ObDashboardStrip");
    expect(read(TOOLS_RAIL)).toContain("<ObDashboardStrip");
  });
});

describe("USG — one open-report path (unchanged since B-10 #884)", () => {
  it("the worklist opens every modality through the single shared builder", () => {
    const route = read("lib/reportingWorkspaceRoute.ts");
    expect(route).toContain("export function reportingWorkspacePath(");
    expect(route).toContain("`/radiology/report/${studyId}`");
    expect(worklist).toContain('from "@/lib/reportingWorkspaceRoute"');
    expect(worklist).toContain("reportingWorkspacePath(entry.id");
    expect(worklist).not.toContain("function reportingWorkspacePath");
    expect(worklist).not.toContain("`/radiology/usg/${entry.id}`");
  });

  it("nothing outside the workspace hooks and the canonical transport saves or finalizes", () => {
    // File names, not line numbers: the invariant is that no NEW surface grew a
    // path to a WRITE. It was previously measured by who imported the module at
    // all, which stopped meaning "can write" the moment the module also exported
    // something to read — #1058's signed-report witness is read by the canvas,
    // the overlays and the export hook, and none of them can save or finalize
    // anything. So the roster now counts the two exports that actually reach the
    // server, and a component importing one of them still lands here.
    // RadiologyReportGenerator.tsx is in this list and is dealt with by the next
    // test — it is unreachable, not authoritative.
    const WRITERS = ["finalizeRadiologyReport", "saveRadiologyDraft"];
    const importers = readdirRec("pages")
      .concat(readdirRec("hooks"), readdirRec("components"))
      .filter((f) => read(f).includes('from "@/lib/radiologyReportLifecycle"'));
    const writers = importers
      .filter((f) => WRITERS.some((w) => read(f).includes(w)))
      .sort();
    expect(writers).toEqual([
      "hooks/radiology-workspace/useDraftPersistence.ts",
      "hooks/radiology-workspace/useStudyFinalize.ts",
      "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx",
      "pages/RadiologyReportGenerator.tsx",
    ]);
    // Both names must still exist, or the filter above would pass by deleting
    // the writes rather than by moving them.
    const lifecycle = read("lib/radiologyReportLifecycle.ts");
    for (const w of WRITERS) expect(lifecycle).toContain(`function ${w}`);
  });

  it("RadiologyReportGenerator.tsx is unreachable: its routes redirect and nothing renders it", () => {
    // The register above would otherwise claim a second author. It is a dead
    // page: both route names bind to the redirect helper, and the lazy
    // declaration is never used in JSX. Reported in the PR as orphan cleanup
    // (out of B-10 scope) rather than deleted here.
    expect(app).toMatch(
      /path="\/radiology\/report-generator">\s*\{\(\) => <RedirectToReportWorkspace \/>\}/,
    );
    expect(app).not.toContain("<RadiologyReportGen ");
    expect(app).not.toContain("<RadiologyReportGen/>");
    expect(app).not.toContain("<RadiologyReportGen\n");
  });
});

describe("USG widgets — orphaned, but still no parallel engine", () => {
  it("components/radiology/usg/* declares none of the banned engine identifiers", () => {
    // The shell was their only consumer, so the directory is now orphaned
    // (B-10 leaves orphan cleanup alone). Its one remaining duty is to not
    // contain a competing engine waiting to be mounted.
    const dir = join(SRC, "components", "radiology", "usg");
    const files = readdirSync(dir).filter((n) => /\.tsx$/.test(n) && !/\.test\./.test(n));
    expect(files.length, "the widget directory must still exist to be measured").toBeGreaterThan(0);
    for (const n of files) {
      const src = readFileSync(join(dir, n), "utf8");
      expect(src, `${n} must not declare a parallel USG engine`).not.toMatch(
        /(?:function|const|class)\s+Usg(?:Workspace|Copilot|QualityEngine|TemplateEngine|ComparisonEngine|FindingsEngine|MeasurementEngine)\b/,
      );
      expect(src, `${n} must not call the canonical transports itself`).not.toContain("finalizeRadiologyReport(");
      expect(src, `${n} must not call the canonical transports itself`).not.toContain("saveRadiologyDraft(");
    }
  });
});

/** Relative paths (from src) of every .ts/.tsx under `rel`, test files excluded. */
function readdirRec(rel: string): string[] {
  const out: string[] = [];
  const walk = (dirRel: string) => {
    for (const name of readdirSync(join(SRC, dirRel))) {
      if (name === "node_modules") continue;
      const childRel = `${dirRel}/${name}`;
      const abs = join(SRC, childRel);
      if (statSync(abs).isDirectory()) {
        walk(childRel);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(childRel);
      }
    }
  };
  walk(rel);
  return out;
}
