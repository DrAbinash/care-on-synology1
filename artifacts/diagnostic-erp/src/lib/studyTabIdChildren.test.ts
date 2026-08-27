import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clinicalHistoryChipsForStudyTab,
  pickQuickProtocol,
  protocolsForStudyTab,
} from "./pickQuickProtocol";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

const CHIPS = [
  { id: 1, studyType: "Cervical Spine", studyTabId: 3, displayLabel: "Neck pain", isActive: true, sortOrder: 1 },
  { id: 2, studyType: "Old Cervical", studyTabId: null, displayLabel: "Legacy", isActive: true, sortOrder: 2 },
  { id: 3, studyType: "Brain", studyTabId: 4, displayLabel: "Headache", isActive: true, sortOrder: 1 },
];

const PROTOCOLS = [
  { id: 10, name: "Standard Cervical", studyType: "Cervical Spine", studyTabId: 3, techniqueText: "Cervical tech", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
  { id: 11, name: "Brain Standard", studyType: "Brain", studyTabId: 4, techniqueText: "Brain tech", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
  { id: 12, name: "Orphan Cervical", studyType: "Cervical Spine", studyTabId: null, techniqueText: "Legacy tech", isDefault: false, isGoldStandard: false, sortOrder: 2, isActive: true },
];

describe("Study Tab ID — Clinical History", () => {
  it("filters chips by studyTabId (not name alone)", () => {
    const { matched } = clinicalHistoryChipsForStudyTab(CHIPS, 3, "Renamed Cervical");
    expect(matched.map((c) => c.id)).toEqual([1]);
  });

  it("rename-safe: chips stay with Study Tab ID after name change", () => {
    // Chip still has studyTabId=3 even if denormalized studyType was old
    const renamed = [{ ...CHIPS[0], studyType: "C-Spine MRI" }];
    const { matched } = clinicalHistoryChipsForStudyTab(renamed, 3, "C-Spine MRI");
    expect(matched).toHaveLength(1);
    expect(matched[0].displayLabel).toBe("Neck pain");
  });

  it("preserves unresolved legacy rows (studyTabId null) via name fallback", () => {
    const { matched, unresolvedLegacy } = clinicalHistoryChipsForStudyTab(CHIPS, null, "Old Cervical");
    expect(matched.map((c) => c.id)).toEqual([2]);
    expect(unresolvedLegacy.map((c) => c.id)).toEqual([2]);
  });

  it("Section 2 UI filters via clinicalHistoryChipsForStudyTab + studyTabId save", () => {
    const strip = read("components/radiology/ClinicalHistoryChipStrip.tsx");
    expect(strip).toContain("clinicalHistoryChipsForStudyTab");
    expect(strip).toMatch(/studyTabId[,:]/);
    expect(strip).toContain("selectedStudyTabId ??");
    expect(strip).not.toContain("c.studyType === catalogStudyType");
  });
});

describe("Study Tab ID — Technique / protocols", () => {
  it("lists techniques for Study Tab ID only", () => {
    const cervical = protocolsForStudyTab(PROTOCOLS, 3, "Cervical Spine");
    expect(cervical.map((p) => p.id)).toEqual([10]);
    const brain = protocolsForStudyTab(PROTOCOLS, 4, "Brain");
    expect(brain.map((p) => p.id)).toEqual([11]);
  });

  it("pickQuickProtocol prefers default for Study Tab ID", () => {
    expect(pickQuickProtocol(PROTOCOLS, "Cervical Spine", 3)?.id).toBe(10);
    expect(pickQuickProtocol(PROTOCOLS, "Brain", 4)?.techniqueText).toBe("Brain tech");
  });

  it("Section 3 TechniqueChoiceStrip is wired without competing region selector", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    const strip = read("components/radiology/TechniqueChoiceStrip.tsx");
    expect(workspace).toContain("TechniqueChoiceStrip");
    expect(workspace).toContain("selectedStudyTabId={studySetup.selectedStudyTabId}");
    expect(workspace).not.toContain('data-testid="technique-region-select"');
    expect(workspace).not.toContain('data-testid="technique-protocol-select"');
    expect(strip).toContain('data-testid="technique-choice-select"');
    expect(strip).toContain('data-testid="technique-add"');
    expect(strip).toContain("/api/radiology/quick-select/protocols");
  });

  it("region change fill-empty only — does not merge into existing Technique", () => {
    const setup = read("hooks/useReportingStudySetup.ts");
    expect(setup).toContain("Manual / draft Technique must survive Study Tab change");
    expect(setup).toContain("Fill-empty only: manual / draft Technique survives Study Tab change");
    expect(setup).toContain("Resolve Study Tab ID from the NEW name");
    const start = setup.indexOf("const selectPrimaryRegion = useCallback");
    const end = setup.indexOf("}, [disabled, quickSelectData, applyProtocol, setters]);", start);
    const selectBlock = setup.slice(start, end);
    expect(selectBlock).toContain("setActiveProtocol(protocol)");
    expect(selectBlock).toMatch(/if \(!fields\.technique\.trim\(\)\)/);
    expect(selectBlock).not.toContain("applyProtocol(protocol, false)");
  });
});

describe("migration + API study_tab_id", () => {
  it("migration backfills study_tab_id without deleting unmatched rows", () => {
    const sql = readFileSync(join(ROOT, "migrations/z_add_study_tab_id_history_protocols.sql"), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS study_tab_id");
    expect(sql).toContain("radiology_clinical_history_chips");
    expect(sql).toContain("radiology_protocols");
    expect(sql).not.toMatch(/DELETE FROM radiology_clinical_history_chips/i);
  });

  it("API create/update resolve Study Tab ID and sync rename", () => {
    const route = readFileSync(join(ROOT, "artifacts/api-server/src/routes/radiologyQuickFindings.ts"), "utf8");
    expect(route).toContain("resolveStudyTab");
    expect(route).toContain("syncChildStudyTypeForTabRename");
    expect(route).toContain("studyTabId: tab.id");
  });
});
