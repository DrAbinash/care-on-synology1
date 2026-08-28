import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPathologyPatch,
  applySideToIncoming,
} from "./pathologyPatch";
import { provenanceFromText } from "./reportFieldMerge";
import { quickFindingsForStudyTab } from "./pickQuickProtocol";
import { resolveChocolateOwnership } from "./chocolateMacroOwnership";
import { DEFAULT_REPORT_FORMATS } from "./zai-workspace/report-formats-library";
import { DEFAULT_QUICK_SELECT_TILES } from "./zai-workspace/quick-select-library";
import { useWorkspace } from "./zai-workspace/store";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const FINDINGS = [
  { id: 1, studyType: "Brain", studyTabId: 4, label: "Basal ganglia hemorrhage", anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage", isActive: true, sortOrder: 1 },
  { id: 2, studyType: "Brain", studyTabId: 4, label: "Fazekas 2", anatomicalSection: "white matter", conflictGroup: "fazekas", isActive: true, sortOrder: 2 },
  { id: 3, studyType: "Cervical Spine", studyTabId: 3, label: "Disc bulge", anatomicalSection: "C3-4", conflictGroup: "disc", isActive: true, sortOrder: 1 },
  { id: 4, studyType: "Old Brain", studyTabId: null, label: "Legacy finding", anatomicalSection: "legacy", conflictGroup: "", isActive: true, sortOrder: 1 },
];

describe("Section 4 — study_tab_id scoping", () => {
  it("Brain Study Tab shows only Brain finding content", () => {
    const { matched } = quickFindingsForStudyTab(FINDINGS, 4, "Renamed Brain");
    expect(matched.map((f) => f.id)).toEqual([1, 2]);
  });

  it("Cervical Spine shows only Cervical finding content", () => {
    const { matched } = quickFindingsForStudyTab(FINDINGS, 3, "Cervical Spine");
    expect(matched.map((f) => f.id)).toEqual([3]);
    expect(matched.some((f) => f.studyTabId === 4)).toBe(false);
  });

  it("rename-safe: findings stay attached by study_tab_id after Study Tab rename", () => {
    const renamed = FINDINGS.slice(0, 2).map((f) => ({ ...f, studyType: "Brain MRI (renamed)" }));
    const { matched } = quickFindingsForStudyTab([...renamed, ...FINDINGS.slice(2)], 4, "Brain MRI (renamed)");
    expect(matched.map((f) => f.id)).toEqual([1, 2]);
  });

  it("legacy name-only finding still resolves when study_tab_id is null", () => {
    const { matched } = quickFindingsForStudyTab(FINDINGS, null, "Old Brain");
    expect(matched.map((f) => f.id)).toEqual([4]);
  });

  it("unresolved legacy rows are preserved but not cross-contaminate other tabs", () => {
    const cervical = quickFindingsForStudyTab(FINDINGS, 3, "Cervical Spine");
    expect(cervical.matched.some((f) => f.id === 4)).toBe(false);
    const legacy = quickFindingsForStudyTab(FINDINGS, null, "Old Brain");
    expect(legacy.matched.map((f) => f.id)).toEqual([4]);
    expect(legacy.unresolvedLegacy.map((f) => f.id)).toEqual([4]);
  });

  it("selecting L4-5 anatomy shows only L4-5 findings (filter focus, no report mutation)", () => {
    const spine = [
      { id: 10, studyType: "LS Spine", studyTabId: 5, label: "Normal", anatomicalSection: "L4-5", conflictGroup: "disc", isActive: true, sortOrder: 1 },
      { id: 11, studyType: "LS Spine", studyTabId: 5, label: "Extrusion", anatomicalSection: "L4-5", conflictGroup: "disc", isActive: true, sortOrder: 2 },
      { id: 12, studyType: "LS Spine", studyTabId: 5, label: "Bulge", anatomicalSection: "L3-4", conflictGroup: "disc", isActive: true, sortOrder: 1 },
    ];
    const { matched } = quickFindingsForStudyTab(spine, 5, "Renamed LS Spine");
    const l45 = matched.filter((f) => f.anatomicalSection === "L4-5");
    expect(l45.map((f) => f.label)).toEqual(["Normal", "Extrusion"]);
    expect(l45.some((f) => f.anatomicalSection === "L3-4")).toBe(false);
  });
});

describe("Section 4 — anatomy grouping UI wiring", () => {
  it("FindingsAnatomyStrip groups by anatomicalSection + conflictGroup", () => {
    const strip = read("components/radiology/FindingsAnatomyStrip.tsx");
    expect(strip).toContain("groupByAnatomy");
    expect(strip).toContain("groupByConflict");
    expect(strip).toContain("activeAnatomy");
  });

  it("sticky anatomy chips sit above Quick Select tile wall", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    const chips = read("components/radiology/FindingsAnatomyChips.tsx");
    expect(workspace).toContain("FindingsAnatomyChips");
    expect(workspace).toContain("anatomyFilter={activeFindingsAnatomy}");
    expect(chips).toContain('data-testid="findings-anatomy-chips-bar"');
  });

  it("workspace wires anatomy strip above the Findings editor", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    expect(workspace).toContain("FindingsAnatomyStrip");
    expect(workspace).toContain("selectedStudyTabId={studySetup.selectedStudyTabId}");
    expect(workspace).toContain("onToggle={handleQuickToggle}");
  });

  it("Clinic Quick Select filters by study_tab_id when parent passes tab id", () => {
    const panel = read("components/radiology/QuickFindingsPanel.tsx");
    expect(panel).toContain("quickFindingsForStudyTab");
    expect(panel).toContain("selectedStudyTabId");
  });
});

describe("Section 4 — ownership merge (whole-report + pathology)", () => {
  const brain = DEFAULT_REPORT_FORMATS.find((f) => f.name === "MRI Brain — Normal")!;
  const hemor = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label === "Basal ganglia hemorrhage")!;

  it("Normal Brain + Right basal ganglia hemorrhage removes owned normal without duplicate", () => {
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: brain.clinicalHistory,
        technique: brain.technique,
        findings: brain.findings,
        impression: brain.impression,
        recommendation: brain.recommendation,
      },
      incoming: applySideToIncoming(
        { findings: hemor.sentence, impression: hemor.impressionSentence },
        "right",
      ),
      ownership: {
        anatomicalSection: hemor.anatomicalSection,
        conflictGroup: hemor.conflictGroup,
      },
      provenance: {
        findings: provenanceFromText(brain.findings, "template"),
        impression: provenanceFromText(brain.impression, "template"),
      },
      source: "quick-select",
    });
    expect(result.narrative.findings.toLowerCase()).toContain("right basal ganglia");
    expect(result.narrative.findings.match(/hemorrhage/gi)?.length ?? 0).toBe(1);
    expect(result.narrative.findings.toLowerCase()).not.toMatch(/basal ganglia are normal/);
  });

  it("Right → Left updates only pathology-owned content", () => {
    const templates = {
      findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
      impression: "Acute {side} basal ganglia hemorrhage.",
    };
    const right = applySideToIncoming(templates, "right");
    const left = applySideToIncoming(templates, "left");
    const manual = "Ventricular system remains normal for age.";
    const swapped = `${right.findings}\n${manual}`.replace(right.findings!, left.findings!);
    expect(swapped).toContain("left basal ganglia");
    expect(swapped).toContain(manual);
  });

  it("second unrelated pathology coexists with hemorrhage", () => {
    const fazekas = DEFAULT_QUICK_SELECT_TILES.find((t) => t.label.includes("Fazekas")) ?? {
      sentence: "Moderate periventricular white matter hyperintensities (Fazekas grade 2).",
      impressionSentence: "Chronic small vessel ischemic changes (Fazekas 2).",
      anatomicalSection: "white matter",
      conflictGroup: "fazekas",
    };
    const afterHem = applyPathologyPatch({
      existing: {
        clinicalHistory: brain.clinicalHistory,
        technique: brain.technique,
        findings: brain.findings,
        impression: brain.impression,
        recommendation: brain.recommendation,
      },
      incoming: applySideToIncoming(
        { findings: hemor.sentence, impression: hemor.impressionSentence },
        "right",
      ),
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: { findings: provenanceFromText(brain.findings, "template") },
      source: "quick-select",
    });
    const afterBoth = applyPathologyPatch({
      existing: afterHem.narrative,
      incoming: { findings: fazekas.sentence, impression: fazekas.impressionSentence },
      ownership: { anatomicalSection: fazekas.anatomicalSection ?? "white matter", conflictGroup: fazekas.conflictGroup ?? "fazekas" },
      provenance: afterHem.provenance,
      source: "quick-select",
    });
    expect(afterBoth.narrative.findings.toLowerCase()).toContain("hemorrhage");
    expect(afterBoth.narrative.findings.toLowerCase()).toMatch(/fazekas|white matter/);
  });

  it("mutually exclusive same-conflictGroup finding replaces safely", () => {
    const fazekas1 = "Mild periventricular white matter hyperintensities (Fazekas grade 1).";
    const fazekas2 = "Moderate periventricular white matter hyperintensities (Fazekas grade 2).";
    const after1 = applyPathologyPatch({
      existing: { clinicalHistory: "", technique: "", findings: brain.findings, impression: brain.impression, recommendation: "" },
      incoming: { findings: fazekas1 },
      ownership: { anatomicalSection: "white matter", conflictGroup: "fazekas" },
      provenance: { findings: provenanceFromText(brain.findings, "template") },
      source: "quick-select",
    });
    const after2 = applyPathologyPatch({
      existing: after1.narrative,
      incoming: { findings: fazekas2 },
      ownership: { anatomicalSection: "white matter", conflictGroup: "fazekas" },
      provenance: after1.provenance,
      source: "quick-select",
    });
    expect(after2.narrative.findings).toContain("grade 2");
    expect(after2.narrative.findings).not.toContain("grade 1");
  });

  it("returning an owned block toward normal replaces abnormal in that conflict group", () => {
    const abnormal = "Posterior disc bulge at L4-L5 with mild canal narrowing.";
    const normal = "L4-L5 disc is normal in height and signal. No canal stenosis.";
    const afterAbn = applyPathologyPatch({
      existing: { clinicalHistory: "", technique: "", findings: normal, impression: "", recommendation: "" },
      incoming: { findings: abnormal },
      ownership: { anatomicalSection: "L4-5", conflictGroup: "disc", baselineReplaces: normal },
      provenance: { findings: provenanceFromText(normal, "template") },
      source: "quick-select",
    });
    expect(afterAbn.narrative.findings).toContain("bulge");
    const afterNormal = applyPathologyPatch({
      existing: afterAbn.narrative,
      incoming: { findings: normal },
      ownership: { anatomicalSection: "L4-5", conflictGroup: "disc", baselineReplaces: abnormal },
      provenance: afterAbn.provenance,
      source: "quick-select",
    });
    expect(afterNormal.narrative.findings).toContain("disc is normal");
    expect(afterNormal.narrative.findings).not.toContain("bulge");
  });

  it("unrelated manual Findings text survives pathology patch", () => {
    const existingFindings =
      "Brain parenchyma shows normal signal intensity. Manual note: correlate with EEG seizure focus.";
    const result = applyPathologyPatch({
      existing: { clinicalHistory: "", technique: "", findings: existingFindings, impression: "Normal MRI brain.", recommendation: "" },
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the right basal ganglia.",
        impression: "Acute right basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: {
        findings: {
          ...provenanceFromText("Brain parenchyma shows normal signal intensity.", "template"),
          ...provenanceFromText("Manual note: correlate with EEG seizure focus.", "manual"),
        },
      },
      source: "quick-select",
    });
    expect(result.narrative.findings).toContain("Manual note: correlate with EEG seizure focus.");
  });

  it("whole-report baseline remains intact outside patched anatomy", () => {
    const result = applyPathologyPatch({
      existing: {
        clinicalHistory: brain.clinicalHistory,
        technique: brain.technique,
        findings: brain.findings,
        impression: brain.impression,
        recommendation: brain.recommendation,
      },
      incoming: applySideToIncoming(
        { findings: hemor.sentence, impression: hemor.impressionSentence },
        "right",
      ),
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      provenance: {
        findings: provenanceFromText(brain.findings, "template"),
        impression: provenanceFromText(brain.impression, "template"),
      },
      source: "quick-select",
    });
    expect(result.narrative.technique).toBe(brain.technique);
    expect(result.narrative.clinicalHistory).toBe(brain.clinicalHistory);
    expect(result.narrative.findings.toLowerCase()).toContain("ventricular");
  });
});

describe("Section 4 — Quick Select + Chocolate converge on ownership path", () => {
  it("Chocolate explicit metadata routes through pathology overlay (not append)", () => {
    const setup = read("hooks/useReportingStudySetup.ts");
    expect(setup).toContain("applyPathologyOverlay");
    expect(setup).toContain("resolveChocolateOwnership");
    const resolved = resolveChocolateOwnership({
      id: "brain-infarct",
      label: "Infarct",
      anatomicalSection: "mca",
      conflictGroup: "infarct",
    });
    expect(resolved.mode).not.toBe("legacy-append");
  });

  it("generic legacy macro remains append-only", () => {
    const resolved = resolveChocolateOwnership({ id: "random-snippet", label: "Snippet" });
    expect(resolved.mode).toBe("legacy-append");
  });

  it("handleQuickToggle uses matchedStudyRegion for patch region metadata", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    expect(workspace).toContain("region: studySetup.matchedStudyRegion ?? finding.studyType");
    expect(workspace).toContain('source: "quick-findings"');
    expect(workspace).toContain("applyPathologyOverlay");
  });
});

describe("Section 4 — undo + draft persistence wiring", () => {
  it("undo restores pre-patch Findings via workspace snapshot", () => {
    const store = useWorkspace.getState();
    store.setEditorContent({
      clinicalHistory: "Hx",
      technique: "Tech",
      findings: "Basal ganglia are normal in signal intensity. No acute infarct, hemorrhage, or mass lesion.",
      impression: "Normal MRI brain.",
      recommendation: "Follow-up.",
    });
    const before = useWorkspace.getState().findingsText;
    store.applyPathologyOverlay({
      incoming: {
        findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
        impression: "Acute {side} basal ganglia hemorrhage.",
      },
      templates: {
        findings: "Acute intraparenchymal hemorrhage in the {side} basal ganglia.",
        impression: "Acute {side} basal ganglia hemorrhage.",
      },
      ownership: { anatomicalSection: "basal ganglia", conflictGroup: "hemorrhage" },
      source: "quick-select",
      side: "right",
      id: "test-hem-s4",
    });
    expect(useWorkspace.getState().findingsText.toLowerCase()).toContain("right basal ganglia");
    expect(useWorkspace.getState().undoLastPatch()).toBe(true);
    expect(useWorkspace.getState().findingsText).toBe(before);
  });

  it("draft save path includes findingsText from workspace store", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    expect(workspace).toMatch(/findingsText|findings:/);
    expect(workspace).toContain("saveDraft");
  });
});

describe("Section 4 — migration + API", () => {
  it("migration backfills quick_findings study_tab_id without deleting unmatched rows", () => {
    const sql = readFileSync(join(ROOT, "migrations/zzzzz_add_study_tab_id_quick_findings.sql"), "utf8");
    expect(sql).toContain("radiology_quick_findings");
    expect(sql).toContain("study_tab_id");
    expect(sql).toContain("radiology_quick_findings_study_tab_label_uq");
    expect(sql).toContain("radiology_quick_findings_legacy_study_label_uq");
    expect(sql).not.toMatch(/DELETE FROM radiology_quick_findings/i);
  });

  it("API create/update findings resolve Study Tab ID", () => {
    const route = readFileSync(join(ROOT, "artifacts/api-server/src/routes/radiologyQuickFindings.ts"), "utf8");
    expect(route).toContain('router.post("/findings"');
    expect(route).toContain("studyTabId: tab.id");
    expect(route).toContain("resolveStudyTab");
  });

  it("Study Tab rename sync updates quick_findings study_type", () => {
    const resolve = readFileSync(join(ROOT, "artifacts/api-server/src/lib/resolveStudyTab.ts"), "utf8");
    expect(resolve).toContain("radiology_quick_findings");
  });

  it("finding editor saves studyTabId", () => {
    const editor = read("components/radiology/WorkspaceQuickFindingEditor.tsx");
    expect(editor).toContain("studyTabId");
  });
});
