import { describe, expect, it } from "vitest";
import { pickQuickProtocol, protocolsForStudyTab } from "./pickQuickProtocol";

const PROTOCOLS = [
  { id: 1, name: "MRI Brain Plain", studyType: "Brain", studyTabId: 4, techniqueText: "Brain technique", isDefault: false, isGoldStandard: false, sortOrder: 2, isActive: true },
  { id: 2, name: "MRI LS Spine", studyType: "LS Spine", studyTabId: 5, techniqueText: "LS spine technique", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
  { id: 3, name: "MRI LS Spine Gold", studyType: "LS Spine", studyTabId: 5, techniqueText: "Gold technique", isDefault: false, isGoldStandard: true, sortOrder: 0, isActive: true },
];

describe("pickQuickProtocol", () => {
  it("prefers isDefault over isGoldStandard", () => {
    const match = pickQuickProtocol(PROTOCOLS, "LS Spine", 5);
    expect(match?.id).toBe(2);
  });

  it("falls back to gold standard when no default", () => {
    const protos = PROTOCOLS.map((p) => ({ ...p, isDefault: false }));
    const match = pickQuickProtocol(protos, "LS Spine", 5);
    expect(match?.id).toBe(3);
  });

  it("returns null for unknown region", () => {
    expect(pickQuickProtocol(PROTOCOLS, "Knee", 99)).toBeNull();
  });

  it("filters by Study Tab ID even if denormalized name differs", () => {
    const renamed = PROTOCOLS.map((p) => p.id === 2 ? { ...p, studyType: "Lumbar Spine MRI" } : p);
    expect(protocolsForStudyTab(renamed, 5, "Lumbar Spine MRI").map((p) => p.id).sort()).toEqual([2, 3]);
  });
});
