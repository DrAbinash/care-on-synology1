import { describe, expect, it } from "vitest";
import {
  groupStudyTabsByFamily,
  stripStudyTabModalityPrefix,
  studyTabFamily,
} from "@/lib/studyRegion";

describe("studyTabFamily", () => {
  it("classifies common modality-prefixed tabs", () => {
    expect(studyTabFamily("MRI Brain")).toBe("Brain");
    expect(studyTabFamily("LS Spine")).toBe("Spine");
    expect(studyTabFamily("CT Cervical Spine")).toBe("Spine");
    expect(studyTabFamily("USG KUB")).toBe("Abdomen & Pelvis");
    expect(studyTabFamily("USG Obstetric")).toBe("Abdomen & Pelvis");
    expect(studyTabFamily("Knee")).toBe("Extremities & Joints");
    expect(studyTabFamily("MRI Pituitary")).toBe("Brain");
  });

  it("combined names use the first primary segment (Brain + Cervical Spine → Brain)", () => {
    expect(studyTabFamily("MRI Brain + Cervical Spine")).toBe("Brain");
    expect(studyTabFamily("Brain + Cervical Spine")).toBe("Brain");
  });

  it("unknown names land in Other", () => {
    expect(studyTabFamily("xyzzy-plugh-protocol")).toBe("Other");
  });

  it("strips modality prefixes before matching", () => {
    expect(stripStudyTabModalityPrefix("MRI Brain")).toBe("Brain");
    expect(stripStudyTabModalityPrefix("HRCT Chest")).toBe("Chest");
    expect(stripStudyTabModalityPrefix("USG Obstetric")).toBe("Obstetric");
    expect(stripStudyTabModalityPrefix("X-RAY Knee")).toBe("Knee");
    expect(stripStudyTabModalityPrefix("DOPPLER Renal")).toBe("Renal");
  });

  it("groups tabs by family in display order and omits empty families", () => {
    const groups = groupStudyTabsByFamily([
      { id: 1, name: "MRI Brain" },
      { id: 2, name: "LS Spine" },
      { id: 3, name: "Knee" },
      { id: 4, name: "USG KUB" },
      { id: 5, name: "MRI Pituitary" },
    ]);
    expect(groups.map((g) => g.family)).toEqual([
      "Brain",
      "Spine",
      "Abdomen & Pelvis",
      "Extremities & Joints",
    ]);
    expect(groups[0].tabs.map((t) => t.name)).toEqual(["MRI Brain", "MRI Pituitary"]);
    expect(groups[1].tabs.map((t) => t.name)).toEqual(["LS Spine"]);
  });
});
