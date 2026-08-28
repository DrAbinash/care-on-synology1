import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeTechniqueName,
  pickQuickProtocol,
  protocolsForStudyTab,
  protocolsForStudyTabDetailed,
} from "./pickQuickProtocol";
import {
  recordTechniqueAutoOrigin,
  shouldAutoReplaceTechniqueOnRegionChange,
  techniqueProvenanceIsManual,
  techniqueRegionMismatch,
} from "./techniqueStudyTabOrigin";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

const BRAIN_ROUTINE = {
  id: 1,
  name: "Standard Routine",
  studyType: "Brain",
  studyTabId: 4,
  techniqueText: "Brain MRI routine text.",
  isDefault: true,
  isGoldStandard: false,
  sortOrder: 10,
  isActive: true,
};

const CERVICAL_ROUTINE = {
  id: 2,
  name: "Standard Routine",
  studyType: "Cervical Spine",
  studyTabId: 3,
  techniqueText: "Cervical MRI routine text.",
  isDefault: true,
  isGoldStandard: false,
  sortOrder: 10,
  isActive: true,
};

const LEGACY_CERVICAL = {
  id: 3,
  name: "Legacy Cervical Tech",
  studyType: "Cervical Spine",
  studyTabId: null,
  techniqueText: "Legacy cervical technique.",
  isDefault: false,
  isGoldStandard: false,
  sortOrder: 20,
  isActive: true,
};

const ALL = [BRAIN_ROUTINE, CERVICAL_ROUTINE, LEGACY_CERVICAL];

describe("Section 3 Technique hardening", () => {
  it("1. same Technique name may exist under different Study Tabs", () => {
    expect(protocolsForStudyTab(ALL, 4, "Brain").map((p) => p.id)).toEqual([1]);
    expect(protocolsForStudyTab(ALL, 3, "Cervical Spine").map((p) => p.id)).toEqual([2, 3]);
  });

  it("2. duplicate name inside same Study Tab is rejected at API layer", () => {
    const route = readFileSync(join(ROOT, "artifacts/api-server/src/routes/radiologyQuickFindings.ts"), "utf8");
    const helpers = readFileSync(join(ROOT, "artifacts/api-server/src/lib/protocolName.ts"), "utf8");
    expect(route).toContain("findProtocolByScopedName");
    expect(route).toContain("duplicateProtocolErrorPayload");
    expect(helpers).toContain("DUPLICATE_PROTOCOL_NAME");
    expect(normalizeTechniqueName(" Standard Routine ")).toBe("standard routine");
  });

  it("3. migration backfills study_tab_id on protocols", () => {
    const sql = readFileSync(join(ROOT, "migrations/z_add_study_tab_id_history_protocols.sql"), "utf8");
    expect(sql).toContain("UPDATE radiology_protocols");
    expect(sql).toContain("study_tab_id = t.id");
  });

  it("4. migrated protocol appears in Section 3 dropdown pool", () => {
    const strip = readFileSync(
      join(ROOT, "artifacts/diagnostic-erp/src/components/radiology/TechniqueChoiceStrip.tsx"),
      "utf8",
    );
    expect(strip).toContain("protocolsForStudyTabDetailed");
    const { matched } = protocolsForStudyTabDetailed(ALL, 3, "Cervical Spine");
    expect(matched.some((p) => p.id === 2)).toBe(true);
  });

  it("5. unresolved legacy protocol is preserved in dropdown pool", () => {
    const { matched, unresolvedLegacy } = protocolsForStudyTabDetailed(ALL, 3, "Cervical Spine");
    expect(unresolvedLegacy.map((p) => p.id)).toEqual([3]);
    expect(matched.map((p) => p.id)).toEqual([2, 3]);
  });

  it("6. empty Technique gets new region default (auto-replace)", () => {
    expect(shouldAutoReplaceTechniqueOnRegionChange({
      techniqueText: "",
      provenance: {},
      origin: recordTechniqueAutoOrigin(CERVICAL_ROUTINE, 3, "Cervical Spine", CERVICAL_ROUTINE.techniqueText),
      nextStudyTabId: 4,
    })).toBe(true);
  });

  it("7. untouched auto-Technique changes when Study Tab changes", () => {
    const origin = recordTechniqueAutoOrigin(CERVICAL_ROUTINE, 3, "Cervical Spine", CERVICAL_ROUTINE.techniqueText)!;
    expect(shouldAutoReplaceTechniqueOnRegionChange({
      techniqueText: CERVICAL_ROUTINE.techniqueText,
      provenance: { [CERVICAL_ROUTINE.techniqueText.toLowerCase()]: ["protocol"] },
      origin,
      nextStudyTabId: 4,
    })).toBe(true);
  });

  it("8. manually edited Technique survives region change and shows mismatch", () => {
    const origin = recordTechniqueAutoOrigin(CERVICAL_ROUTINE, 3, "Cervical Spine", CERVICAL_ROUTINE.techniqueText)!;
    const provenance = { manual: ["manual"] as const };
    expect(techniqueProvenanceIsManual(provenance)).toBe(true);
    expect(shouldAutoReplaceTechniqueOnRegionChange({
      techniqueText: `${CERVICAL_ROUTINE.techniqueText} MANUAL`,
      provenance,
      origin,
      nextStudyTabId: 4,
    })).toBe(false);
    expect(techniqueRegionMismatch({
      techniqueText: `${CERVICAL_ROUTINE.techniqueText} MANUAL`,
      provenance,
      origin,
      currentStudyTabId: 4,
      currentStudyTabName: "Brain",
    })).toEqual({ originStudyTabName: "Cervical Spine", currentStudyTabName: "Brain" });
  });

  it("9. Load current-region default clears mismatch (hook exposes loader)", () => {
    const setup = readFileSync(join(ROOT, "artifacts/diagnostic-erp/src/hooks/useReportingStudySetup.ts"), "utf8");
    expect(setup).toContain("loadCurrentRegionDefaultTechnique");
    expect(setup).toContain("applyDefaultTechniqueForRegion");
  });

  it("10. default protocol selection is scoped by Study Tab ID", () => {
    expect(pickQuickProtocol(ALL, "Brain", 4)?.id).toBe(1);
    expect(pickQuickProtocol(ALL, "Cervical Spine", 3)?.id).toBe(2);
  });

  it("11. restore-defaults upserts by scoped name without global name conflict", () => {
    const route = readFileSync(join(ROOT, "artifacts/api-server/src/routes/radiologyQuickFindings.ts"), "utf8");
    expect(route).toContain("findProtocolByScopedName");
    expect(route).not.toContain("target: radiologyProtocolsTable.name");
    const sql = readFileSync(join(ROOT, "migrations/z_protocol_study_tab_name_uq.sql"), "utf8");
    expect(sql).toContain("DROP INDEX IF EXISTS radiology_protocols_name_uq");
    expect(sql).toContain("radiology_protocols_study_tab_name_uq");
  });

  it("12. no Findings/Impression/Recommendation changes in Section 3 files", () => {
    const strip = readFileSync(
      join(ROOT, "artifacts/diagnostic-erp/src/components/radiology/TechniqueChoiceStrip.tsx"),
      "utf8",
    );
    expect(strip).not.toMatch(/field="findings"/);
    expect(strip).not.toMatch(/field="impression"/);
    expect(strip).not.toMatch(/field="recommendation"/);
  });
});
