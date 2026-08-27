import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("Section 2 — Clinical History chips", () => {
  it("workspace wires Study Tab–scoped ClinicalHistoryChipStrip + single Hx field", () => {
    const workspace = read("pages/RadiologyReportingWorkspace.tsx");
    const strip = read("components/radiology/ClinicalHistoryChipStrip.tsx");
    expect(workspace).toContain("ClinicalHistoryChipStrip");
    expect(workspace).toContain("selectedStudyTabId={selectedClinicalHistoryTab?.id ?? null}");
    expect(workspace).toContain("selectedStudyTabName={studySetup.matchedStudyRegion}");
    expect(workspace).toContain('field="clinicalHistory"');
    expect(workspace).toMatch(/FindingsEditor[\s\S]*clinicalHistory[\s\S]*hideQuickSelect/);
    expect(strip).toContain('data-testid="clinical-history-chips"');
    expect(strip).toContain('data-testid="history-add-chip"');
    expect(strip).toContain('data-testid="history-edit-chips"');
    expect(strip).toContain("/api/radiology/quick-select/clinical-history");
    expect(strip).toContain("selectedStudyTabId");
    expect(strip).toContain("c.studyType === catalogStudyType");
    expect(strip).toContain("toggleHistoryChipContribution");
  });

  it("history choices persist via server clinical-history API (not localStorage catalog)", () => {
    const strip = read("components/radiology/ClinicalHistoryChipStrip.tsx");
    expect(strip).toContain('api.post("/api/radiology/quick-select/clinical-history"');
    expect(strip).toContain("api.patch(`/api/radiology/quick-select/clinical-history/${draft.id}`");
    expect(strip).not.toContain("localStorage.setItem");
    expect(strip).toContain("Study Tab");
  });

  it("format apply merges Clinical History when patient Hx already present", () => {
    const store = read("lib/zai-workspace/store.ts");
    expect(store).toContain("appendClinicalPhrase");
    expect(store).toContain("Patient/worklist/manual Hx wins");
  });
});
