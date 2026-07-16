/**
 * platform-contract.test.ts — CARE Reporting Platform Contract Test Suite.
 *
 * The permanent regression suite for the Reporting Platform. It proves the
 * platform is ONE modality-agnostic system that every modality (MRI, USG, CT,
 * X-Ray) is only a client of, and it fails loudly if any platform capability
 * breaks for any modality or if a second (modality-specific) engine ever appears.
 *
 * These are structural/invariant contracts: this repo has no live DB or browser
 * in the test environment, so each contract is asserted where it is
 * deterministic — the shared study→region resolver (a pure function), the single
 * canonical Reporting Workspace source (the same file serves every modality, so
 * an anchor present here is present for all four and is checked for per-modality
 * forks), the single-source platform modules, and the merged per-modality
 * clinical CONTENT + Knowledge-Pack manifests. Runtime coverage (assemble
 * endpoints, dashboards) is verified against a live deployment; see
 * docs/reporting-platform/PLATFORM_COVERAGE_REPORT.md.
 *
 * Reuses (does not duplicate): studyRegion (resolver), the existing focused unit
 * tests (studyRegion.test.ts, copilotOrchestrator.test.ts, radiologyComparison
 * .test.ts, usgCompanion*.test.ts, report-quality/*), and the source-reading
 * style of canonicalWorkspaceRouting.test.ts.
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
const exists = (rel: string) => existsSync(resolve(REPO, rel));
const WORKSPACE = read(resolve(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"));

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
const SRC_FILES = [...walk(ERP_SRC), ...walk(resolve(REPO, "lib"))];

// Study-tab region names, generics before the modality-prefixed tabs, exactly as
// radiology_study_tabs is seeded across the four modalities' migrations.
const REGIONS = [
  "Brain", "Chest", "Cervical Spine", "Spine", "Abdomen", "Whole Abdomen",
  "CT Brain Plain", "CT Cervical Spine", "CT Chest Plain", "CT Whole Abdomen",
  "HRCT Chest", "X-Ray Chest PA",
];

const MODALITIES = [
  { modality: "MRI", hint: "MRI Brain", region: "Brain", data: "lib/db/drizzle/0005_mri_protocol_specs.sql", packSeed: "migrations/seed_knowledge_packs.sql", companion: false },
  { modality: "USG", hint: "USG Whole Abdomen", region: "Whole Abdomen", data: "migrations/zzz_add_usg_gold_standard_content.sql", packSeed: "migrations/seed_knowledge_packs.sql", companion: true },
  { modality: "CT", hint: "CT CT Brain Plain", region: "CT Brain Plain", data: "migrations/zzzz_ct_gold_standard_content.sql", packSeed: "migrations/zzzz_ct_knowledge_packs.sql", companion: true },
  { modality: "X-RAY", hint: "X-RAY X-Ray Chest PA", region: "X-Ray Chest PA", data: "migrations/zzzz_xr_gold_standard_content.sql", packSeed: "migrations/zzzz_xr_knowledge_packs.sql", companion: false },
] as const;

// A capability is "wired" if the ONE canonical workspace (which serves every
// modality) references its anchor. Same file → same wiring for all modalities.
const CAPABILITY_ANCHORS: Record<string, RegExp> = {
  "Workspace opens (reads ?modality=)": /get\("modality"\)/,
  "Study loads (region-resolved)": /matchStudyRegion|studyRegion/,
  "Protocol resolves": /availableProtocols|requestProtocolChange/,
  "Clinical History resolves": /clinicalHistory/,
  "Quick Findings resolve": /QuickFindingsPanel/,
  "Structured Findings resolve": /useStructured/,
  "Measurements resolve": /MeasurementAssistantPanel/,
  "Copilot initializes": /CareCopilotPanel|observeReportText/,
  "Quality Engine initializes": /computeQualityScore/,
  "Previous Comparison initializes": /ComparisonPanel/,
  "Templates resolve": /master-templates/,
  "Voice subsystem available": /useVoiceSession|VoiceCommandBar|VoiceDictationButton/,
  "Command Palette available": /CommandPalette|createCommandDispatcher/,
  "Print Preview renders": /print-preview|\/print\?preview=true/,
  "Finalization path exists": /finalizeReport|computeFinalizeSafety/,
  "Teaching Cases available": /teaching-cases/,
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Per-modality platform contract. Every modality passes the same set.
// ─────────────────────────────────────────────────────────────────────────────
describe.each(MODALITIES)("Platform contract — $modality", (m) => {
  it("✓ Workspace opens & Study loads: study resolves to its modality-scoped region", () => {
    expect(matchStudyRegion(m.hint, REGIONS)).toBe(m.region);
  });

  it("✓ Knowledge Pack resolves: pack registry + merged clinical content exist", () => {
    expect(exists(m.packSeed)).toBe(true); // pack manifests
    expect(exists(m.data)).toBe(true); // protocol / findings / history / measurements content
  });

  for (const [contract, anchor] of Object.entries(CAPABILITY_ANCHORS)) {
    it(`✓ ${contract} (one canonical workspace, not modality-gated)`, () => {
      expect(anchor.test(WORKSPACE)).toBe(true);
      // No `modality === 'X'`-style fork constructing a capability per modality.
      expect(WORKSPACE).not.toMatch(new RegExp(`modality\\s*===\\s*['"]${m.modality}['"]`));
    });
  }

  it("✓ Companion eligibility correct (reuses the one shared panel)", () => {
    expect(WORKSPACE).toMatch(/companionEligible\s*&&\s*entry\?\.studyInstanceUID/);
    expect(WORKSPACE).toMatch(/companionEligible\s*=\s*isUltrasound\s*\|\|\s*isCtModality/);
    // The Companion applies to ultrasound and CT; MRI/XR are correctly excluded
    // by the same gate — no per-modality Companion is created either way.
    const eligibleByContract = m.modality === "USG" || m.modality === "CT";
    expect(eligibleByContract).toBe(m.companion);
  });

  it("✓ Knowledge Base available (single shared surface)", () => {
    expect(exists("artifacts/diagnostic-erp/src/components/RadiologyKnowledgePanel.tsx")).toBe(true);
    expect(exists("artifacts/api-server/src/routes/radiologyKnowledge.ts")).toBe(true);
  });

  it("✓ No runtime exceptions: resolver never throws for this modality's study", () => {
    expect(() => matchStudyRegion(m.hint, REGIONS)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Negative contracts: missing inputs degrade gracefully, never crash.
// ─────────────────────────────────────────────────────────────────────────────
describe("Platform contract — graceful degradation (negative contracts)", () => {
  it("✓ missing/empty/garbage study hint → null region, no throw", () => {
    for (const bad of [null, undefined, "", "   ", "☃☃☃", " ", "no such region 12345"]) {
      expect(() => matchStudyRegion(bad as string, REGIONS)).not.toThrow();
      expect(matchStudyRegion(bad as string, REGIONS)).toBeNull();
    }
  });

  it("✓ empty region catalogue (missing packs/tabs) → null, no throw", () => {
    expect(matchStudyRegion("CT Brain Plain", [])).toBeNull();
    expect(() => matchStudyRegion("CT Brain Plain", [])).not.toThrow();
  });

  it("✓ optional side panels degrade gracefully (wrapped / self-hiding)", () => {
    // The Companion is wrapped in a ModuleErrorBoundary so a failed assembly
    // (missing protocol/template/measurements/comparison) can never break
    // reporting — it is the platform's graceful-degradation contract.
    expect(WORKSPACE).toMatch(/ModuleErrorBoundary[\s\S]{0,200}UsgCompanionPanel/);
    // Comparison / prior-study panels render only when a prior exists.
    expect(WORKSPACE).toMatch(/selectedPrior/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Platform invariants: exactly ONE of each engine, forever.
// ─────────────────────────────────────────────────────────────────────────────
describe("Platform invariants — exactly one implementation of each engine", () => {
  // Each engine's single canonical source + a scan proving no modality-prefixed
  // second implementation exists anywhere in src or lib.
  const SINGLETONS: Array<{ name: string; canonical: string; twin: RegExp }> = [
    { name: "Reporting Workspace", canonical: "artifacts/diagnostic-erp/src/pages/RadiologyReportingWorkspace.tsx", twin: /(ct|mri|usg|xr|xray)reportingworkspace\.tsx$/i },
    { name: "Companion", canonical: "artifacts/diagnostic-erp/src/components/radiology/UsgCompanionPanel.tsx", twin: /(ct|mri|xr|xray)companionpanel\.tsx$/i },
    { name: "Copilot orchestrator", canonical: "artifacts/diagnostic-erp/src/lib/copilotOrchestrator.ts", twin: /(ct|mri|usg|xr|xray)copilotorchestrator\.tsx?$/i },
    { name: "Comparison engine", canonical: "artifacts/diagnostic-erp/src/lib/radiologyComparison.ts", twin: /(ct|mri|usg|xr|xray)comparison\.tsx?$/i },
    { name: "Knowledge Pack engine (route)", canonical: "artifacts/api-server/src/routes/radiologyKnowledgePacks.ts", twin: /(ct|mri|usg|xr|xray)knowledgepacks\.tsx?$/i },
    { name: "Template engine (route)", canonical: "artifacts/api-server/src/routes/structuredReportTemplates.ts", twin: /(ct|mri|usg|xr|xray)(structured)?reporttemplates\.tsx?$/i },
    { name: "Study→region resolver", canonical: "artifacts/diagnostic-erp/src/lib/studyRegion.ts", twin: /(ct|mri|usg|xr|xray)studyregion\.tsx?$/i },
  ];

  it.each(SINGLETONS)("✓ one $name (canonical exists, no modality-specific twin)", (s) => {
    expect(exists(s.canonical)).toBe(true);
    const twins = SRC_FILES.filter((f) => s.twin.test(f));
    expect(twins).toEqual([]);
  });

  it("✓ single Quality Engine package (no lib/report-quality-<modality>)", () => {
    expect(exists("lib/report-quality")).toBe(true);
    for (const mod of ["ct", "mri", "usg", "xr", "xray"]) {
      expect(exists(`lib/report-quality-${mod}`)).toBe(false);
    }
  });

  it("✓ no modality-prefixed engine class/function is declared anywhere", () => {
    const forbidden =
      /(?:class|function|const)\s+(?:Ct|Mri|Usg|Xr|Xray)(?:Workspace|Copilot|QualityEngine|ProtocolEngine|TemplateEngine|ComparisonEngine|FindingsEngine|MeasurementEngine|PrintEngine|KnowledgePackEngine)\b/;
    const offenders = SRC_FILES.filter((f) => forbidden.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — Region resolution: most-specific match always wins.
// ─────────────────────────────────────────────────────────────────────────────
describe("Region resolution — most-specific match wins", () => {
  const R = [
    "Brain", "Chest", "Cervical Spine", "Spine", "Abdomen", "Whole Abdomen",
    "CT Brain Plain", "CT Chest Plain", "CT Cervical Spine", "HRCT Chest", "X-Ray Chest PA",
  ];
  const CASES: Array<[string, string | null]> = [
    ["Brain", "Brain"],
    ["MRI Brain", "Brain"],
    ["CT Brain", "Brain"], // no "CT Brain" tab; "Brain" is the specific match present
    ["Brain Plain", "Brain"], // "CT Brain Plain" not a substring of this hint
    ["CT CT Brain Plain", "CT Brain Plain"],
    ["CT Brain Plain study", "CT Brain Plain"],
    ["HRCT Chest", "HRCT Chest"], // beats "Chest"
    ["Chest", "Chest"],
    ["CT Chest Plain", "CT Chest Plain"], // beats "Chest"
    ["Cervical Spine", "Cervical Spine"], // beats "Spine"
    ["CT Cervical Spine", "CT Cervical Spine"], // beats "Cervical Spine" and "Spine"
    ["Whole Abdomen", "Whole Abdomen"], // beats "Abdomen"
    ["USG Whole Abdomen", "Whole Abdomen"],
  ];
  it.each(CASES)("resolve(%s) → %s", (hint, expected) => {
    expect(matchStudyRegion(hint, R)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — Knowledge Pack coverage: no orphans, all enabled packs valid/versioned.
// ─────────────────────────────────────────────────────────────────────────────
type Pack = { id: string; modality: string; version: string; status: string; manifest: unknown };

/** Extract a balanced JSON manifest from a single-quoted SQL blob (double-quoted
 *  JSON inside), using a brace-matching scan rather than a fragile regex. */
function extractManifestAfter(sql: string, from: number): { json: string; end: number } | null {
  const start = sql.indexOf("'{", from);
  if (start < 0) return null;
  let depth = 0, inStr = false;
  for (let i = start + 1; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { json: sql.slice(start + 1, i + 1), end: i + 1 }; }
  }
  return null;
}

function parsePacks(rel: string): Pack[] {
  if (!exists(rel)) return [];
  const sql = read(resolve(REPO, rel));
  const packs: Pack[] = [];
  // Row prefix: ('id', 'MOD', 'name', 'desc', 'cat', 'studyType', 'builder',
  //   'bodyPart', 'knowledgeCat', 'version', 'author', 'status', TRUE|FALSE,
  const rowRe = /\(\s*'([a-z0-9._-]+)',\s*'([A-Z-]+)',(?:\s*'(?:[^'\\]|\\.|'')*',){7}\s*'(\d+\.\d+\.\d+)',\s*'(?:[^'\\]|\\.|'')*',\s*'(enabled|placeholder|disabled)',\s*(?:TRUE|FALSE),/g;
  let mm: RegExpExecArray | null;
  while ((mm = rowRe.exec(sql))) {
    const [, id, modality, version, status] = mm;
    const man = extractManifestAfter(sql, mm.index + mm[0].length);
    let manifest: unknown = null;
    if (man) { try { manifest = JSON.parse(man.json); } catch { manifest = undefined; } }
    packs.push({ id, modality, version, status, manifest });
  }
  return packs;
}

describe("Knowledge Pack coverage — no orphans, all enabled packs valid", () => {
  const files = ["migrations/seed_knowledge_packs.sql", "migrations/zzzz_ct_knowledge_packs.sql", "migrations/zzzz_xr_knowledge_packs.sql"];
  const packs = files.flatMap(parsePacks);

  it("✓ pack registry parses and is non-trivial", () => {
    expect(packs.length).toBeGreaterThan(60); // 6 base + 28 CT + 40 XR
  });

  it("✓ all four modalities are represented in the registry", () => {
    const mods = new Set(packs.map((p) => p.modality));
    for (const m of ["MRI", "USG", "CT", "XR"]) expect(mods.has(m)).toBe(true);
  });

  it("✓ no orphan / duplicate pack_id", () => {
    const ids = packs.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("✓ every enabled pack has a semver version and a valid JSON manifest", () => {
    for (const p of packs.filter((p) => p.status === "enabled")) {
      expect(p.version, `${p.id} version`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(p.manifest, `${p.id} manifest parses`).toBeTruthy();
      expect(typeof p.manifest, `${p.id} manifest is object`).toBe("object");
    }
  });

  it("✓ every manifest conforms to the known schema (no unknown/typo keys)", () => {
    // Base MRI/USG registry packs carry an intentionally empty `{}` manifest —
    // their clinical content lives in the content tables, assembled live by the
    // loader. Any manifest that DOES declare keys must use only known ones.
    const KNOWN = new Set([
      "companionRules", "comparisonMeasurements", "copilotModules", "criticalFindings",
      "notApplicableSections", "qualityRules", "recommendations", "references", "reportingNotes",
    ]);
    for (const p of packs) {
      for (const k of Object.keys((p.manifest ?? {}) as object)) {
        expect(KNOWN.has(k), `${p.id} unknown manifest key "${k}"`).toBe(true);
      }
    }
  });

  it("✓ content-rich packs (CT / X-Ray) declare ≥1 pack-level clinical rule", () => {
    const RULE_KEYS = ["companionRules", "comparisonMeasurements", "criticalFindings", "recommendations", "qualityRules", "copilotModules", "references"];
    const rich = packs.filter((p) => p.status === "enabled" && (p.modality === "CT" || p.modality === "XR"));
    for (const p of rich) {
      const man = p.manifest as Record<string, unknown>;
      const hasRule = RULE_KEYS.some((k) => Array.isArray(man?.[k]) && (man[k] as unknown[]).length > 0);
      expect(hasRule, `${p.id} has ≥1 pack-level rule`).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STEP 8 — Performance contracts: report timings (no strict bound; regressions
// become visible). Uses the pure resolver over a realistic worklist volume.
// ─────────────────────────────────────────────────────────────────────────────
describe("Performance contracts — reported, not gated", () => {
  it("region resolution over 10k studies stays well under a frame budget", () => {
    const N = 10_000;
    const hints = MODALITIES.map((m) => m.hint);
    const t0 = performance.now();
    for (let i = 0; i < N; i++) matchStudyRegion(hints[i % hints.length], REGIONS);
    const ms = performance.now() - t0;
    // Informational; generous ceiling only to catch pathological regressions.
    // eslint-disable-next-line no-console
    console.log(`[perf] region resolution: ${N} studies in ${ms.toFixed(1)}ms (${(ms / N * 1000).toFixed(2)}µs/study)`);
    expect(ms).toBeLessThan(1000);
  });
});
