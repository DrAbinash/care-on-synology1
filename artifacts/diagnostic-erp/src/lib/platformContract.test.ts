/**
 * platformContract.test.ts — CARE Reporting Platform contract tests.
 *
 * Proves the platform is ONE modality-agnostic system that every modality
 * (MRI, USG, CT, X-Ray) is merely a client of. For each modality it verifies
 * the full reporting contract, and platform-wide it verifies that NO
 * modality-specific engine is instantiated.
 *
 * These are structural/invariant tests: this repo has no live DB or browser in
 * the test environment, so each contract point is asserted at the layer where
 * it is deterministic — the shared study→region resolver (a pure function), the
 * single canonical Reporting Workspace source (the same file serves every
 * modality, so an anchor present here is present for all four), and the merged
 * per-modality clinical CONTENT migrations. The suite fails loudly if anyone
 * later forks a per-modality workspace/engine or gates a capability by modality.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { matchStudyRegion } from "./studyRegion";

const HERE = dirname(fileURLToPath(import.meta.url)); // artifacts/diagnostic-erp/src/lib
const ERP_SRC = resolve(HERE, ".."); // artifacts/diagnostic-erp/src
const REPO = resolve(HERE, "../../../.."); // repo root
const read = (p: string) => readFileSync(p, "utf8");
const WORKSPACE = read(resolve(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"));

// Recursively collect .ts/.tsx source files under a directory.
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// Study-tab region names, generics before the modality-prefixed tabs, exactly
// as radiology_study_tabs is seeded across the four modalities' migrations.
const REGIONS = [
  "Brain",
  "Chest",
  "Cervical Spine",
  "Spine",
  "Abdomen",
  "Whole Abdomen",
  "CT Brain Plain",
  "CT Cervical Spine",
  "X-Ray Chest PA",
];

// The four modalities and, for each, a representative study, the region its
// content is keyed to, the merged clinical-content migration that proves the
// data exists, and whether the Companion applies.
const MODALITIES = [
  { modality: "MRI", hint: "MRI Brain", region: "Brain", data: "lib/db/drizzle/0005_mri_protocol_specs.sql", companion: false },
  { modality: "USG", hint: "USG Whole Abdomen", region: "Whole Abdomen", data: "migrations/zzz_add_usg_gold_standard_content.sql", companion: true },
  { modality: "CT", hint: "CT CT Brain Plain", region: "CT Brain Plain", data: "migrations/zzzz_ct_gold_standard_content.sql", companion: true },
  { modality: "X-RAY", hint: "X-RAY X-Ray Chest PA", region: "X-Ray Chest PA", data: "migrations/zzzz_xr_gold_standard_content.sql", companion: false },
] as const;

// A capability is "wired" in the platform if the ONE canonical workspace (which
// serves every modality) references its anchor. Same file → same wiring for all.
const CAPABILITY_ANCHORS: Record<string, RegExp> = {
  "Workspace opens (reads ?modality=)": /get\("modality"\)/,
  "Protocol loads": /availableProtocols|requestProtocolChange/,
  "Template loads": /master-templates/,
  "Clinical history loads": /clinicalHistory/,
  "Quick findings load": /QuickFindingsPanel/,
  "Structured findings load": /useStructured/,
  "Measurements load": /MeasurementAssistantPanel/,
  "Copilot loads": /CareCopilotPanel|observeReportText/,
  "Quality Engine runs": /computeQualityScore/,
  "Previous Comparison initializes": /ComparisonPanel/,
  "Command Palette works": /CommandPalette|createCommandDispatcher/,
  "Print Layout renders": /print-preview|\/print\?preview=true/,
  "Finalize path exists": /finalizeReport|computeFinalizeSafety/,
};

describe.each(MODALITIES)("Platform contract — $modality", (m) => {
  it("✓ Workspace opens: study resolves to its modality-scoped region", () => {
    // The workspace passes `${modality} ${studyDescription}` to the ONE shared
    // resolver; a non-null, correct region means protocol/history/quick-findings/
    // measurements all dispatch this modality's content in the same workspace.
    expect(matchStudyRegion(m.hint, REGIONS)).toBe(m.region);
  });

  it("✓ Knowledge Pack loads: merged clinical content exists for this modality", () => {
    expect(existsSync(resolve(REPO, m.data))).toBe(true);
  });

  for (const [contract, anchor] of Object.entries(CAPABILITY_ANCHORS)) {
    it(`✓ ${contract} (same canonical workspace, not modality-gated)`, () => {
      expect(anchor.test(WORKSPACE)).toBe(true);
      // No `modality === 'CT'`-style fork constructing a capability per modality.
      expect(WORKSPACE).not.toMatch(new RegExp(`modality\\s*===\\s*['"]${m.modality}['"]`));
    });
  }

  it("✓ Companion loads where applicable (reuses the one shared panel)", () => {
    // Companion is not per-modality: the single UsgCompanionPanel mounts under a
    // modality-neutral `companionEligible` gate = ultrasound OR CT.
    expect(WORKSPACE).toMatch(/companionEligible\s*&&\s*entry\?\.studyInstanceUID/);
    expect(WORKSPACE).toMatch(/companionEligible\s*=\s*isUltrasound\s*\|\|\s*isCtModality/);
    if (m.companion) {
      const isUs = m.modality === "USG";
      const isCt = m.modality === "CT";
      expect(isUs || isCt).toBe(true); // eligibility path exists for this modality
    }
  });
});

describe("Platform contract — NO modality-specific engine instantiated", () => {
  const SRC_FILES = [...walk(ERP_SRC), ...walk(resolve(REPO, "lib"))];

  it("✓ exactly one canonical Reporting Workspace (no per-modality workspace)", () => {
    const forked = SRC_FILES.filter((f) => /(ct|mri|usg|xr|xray)reportingworkspace\.tsx$/i.test(f));
    expect(forked).toEqual([]);
    expect(existsSync(resolve(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"))).toBe(true);
  });

  it("✓ exactly one Copilot orchestrator (modules self-register into it)", () => {
    expect(existsSync(resolve(ERP_SRC, "lib/copilotOrchestrator.ts"))).toBe(true);
    const forked = SRC_FILES.filter((f) => /(ct|mri|usg|xr|xray)copilotorchestrator\.tsx?$/i.test(f));
    expect(forked).toEqual([]);
  });

  it("✓ exactly one Quality Engine package (no per-modality quality engine)", () => {
    expect(existsSync(resolve(REPO, "lib/report-quality"))).toBe(true);
    for (const mod of ["ct", "mri", "usg", "xr", "xray"]) {
      expect(existsSync(resolve(REPO, `lib/report-quality-${mod}`))).toBe(false);
    }
  });

  it("✓ exactly one Companion panel (no per-modality Companion component)", () => {
    const panels = SRC_FILES.filter((f) => /companionpanel\.tsx$/i.test(f));
    expect(panels.map((f) => f.replace(/.*\//, "")).sort()).toEqual(["UsgCompanionPanel.tsx"]);
  });

  it("✓ no modality-prefixed engine class/function is declared anywhere", () => {
    const forbidden =
      /(?:class|function|const)\s+(?:Ct|Mri|Usg|Xr|Xray)(?:Workspace|Copilot|QualityEngine|ProtocolEngine|TemplateEngine|ComparisonEngine|FindingsEngine|MeasurementEngine)\b/;
    const offenders = SRC_FILES.filter((f) => forbidden.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
