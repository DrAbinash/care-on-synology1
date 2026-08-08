import { describe, expect, it } from "vitest";
import { pickQuickProtocol } from "./pickQuickProtocol";

const PROTOCOLS = [
  { id: 1, name: "MRI Brain Plain", studyType: "Brain", techniqueText: "Brain technique", isDefault: false, isGoldStandard: false, sortOrder: 2, isActive: true },
  { id: 2, name: "MRI LS Spine", studyType: "LS Spine", techniqueText: "LS spine technique", isDefault: true, isGoldStandard: false, sortOrder: 1, isActive: true },
  { id: 3, name: "MRI LS Spine Gold", studyType: "LS Spine", techniqueText: "Gold technique", isDefault: false, isGoldStandard: true, sortOrder: 0, isActive: true },
];

describe("pickQuickProtocol", () => {
  it("prefers isDefault over isGoldStandard", () => {
    const match = pickQuickProtocol(PROTOCOLS, "LS Spine");
    expect(match?.id).toBe(2);
  });

  it("falls back to gold standard when no default", () => {
    const protos = PROTOCOLS.map((p) => ({ ...p, isDefault: false }));
    const match = pickQuickProtocol(protos, "LS Spine");
    expect(match?.id).toBe(3);
  });

  it("returns null for unknown region", () => {
    expect(pickQuickProtocol(PROTOCOLS, "Knee")).toBeNull();
  });
});
