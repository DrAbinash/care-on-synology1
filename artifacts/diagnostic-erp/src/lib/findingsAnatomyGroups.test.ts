import { describe, expect, it } from "vitest";
import {
  compareAnatomySections,
  cycleAnatomySection,
  groupByAnatomy,
  isSpinalLevelNavigation,
  spinalLevelSortKey,
} from "./findingsAnatomyGroups";

describe("findingsAnatomyGroups", () => {
  it("sorts spinal levels L1-2 through L5-S1 in order", () => {
    const sections = ["L5-S1", "L1-2", "Alignment", "L4-5", "L3-4", "L2-3"];
    sections.sort(compareAnatomySections);
    expect(sections.indexOf("L1-2")).toBeLessThan(sections.indexOf("L2-3"));
    expect(sections.indexOf("L4-5")).toBeLessThan(sections.indexOf("L5-S1"));
    expect(spinalLevelSortKey("L4-5")).not.toBeNull();
  });

  it("groups findings by anatomicalSection metadata", () => {
    const findings = [
      { anatomicalSection: "L4-5", sortOrder: 2, label: "Extrusion" },
      { anatomicalSection: "L3-4", sortOrder: 1, label: "Bulge" },
      { anatomicalSection: "L4-5", sortOrder: 1, label: "Normal" },
    ];
    const groups = groupByAnatomy(findings);
    expect(groups.map(([k]) => k)).toContain("L3-4");
    expect(groups.find(([k]) => k === "L4-5")?.[1]).toHaveLength(2);
  });

  it("detects multi-level spinal navigation", () => {
    expect(isSpinalLevelNavigation(["L1-2", "L2-3", "L3-4", "L4-5"])).toBe(true);
    expect(isSpinalLevelNavigation(["Brain", "Ventricles"])).toBe(false);
  });

  it("cycles adjacent anatomy sections", () => {
    const sections = ["L1-2", "L2-3", "L3-4"];
    expect(cycleAnatomySection(sections, "L2-3", 1)).toBe("L3-4");
    expect(cycleAnatomySection(sections, "L1-2", -1)).toBe("L3-4");
  });
});
