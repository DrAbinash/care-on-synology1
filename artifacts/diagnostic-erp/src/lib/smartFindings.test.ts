import { describe, it, expect } from "vitest";
import { rebuildSmartSections, mergeSectionTexts, conflictingSelections, type FindingsMap } from "./smartFindings";

// The Smart Findings engine: selecting a finding flips its template section from
// baseline normal to the finding text (replace, not append), keeps anatomical
// order, merges multiple findings on one section, and resolves conflicts.

const LS_BASELINE = [
  { label: "Alignment & Curvature", normal: "Normal lumbar lordosis maintained. No scoliosis." },
  { label: "L3-L4", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
  { label: "L4-L5", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
  { label: "L5-S1", normal: "Normal disc height and signal. No disc herniation. Neural foramina patent." },
  { label: "Vertebral Bodies", normal: "Normal height, signal and morphology throughout." },
  { label: "Cord / Cauda Equina", normal: "Cord terminates at L1-L2. Normal signal." },
];

/** Seed a findingsMap the way the workspace does from a template (all normal). */
function seed(baseline: Array<{ label: string; normal: string }>): FindingsMap {
  const map: FindingsMap = {};
  for (const b of baseline) map[b.label] = { normal: true, text: b.normal };
  return map;
}

describe("mergeSectionTexts", () => {
  it("joins and de-duplicates", () => {
    expect(mergeSectionTexts(["A.", "B.", "A.", " "])).toBe("A.\nB.");
  });
});

describe("rebuildSmartSections — LS Spine", () => {
  it("replaces only the targeted section, leaving the rest normal and in order", () => {
    const { map, managed } = rebuildSmartSections(
      seed(LS_BASELINE),
      LS_BASELINE,
      [{ section: "L4-L5", text: "Diffuse posterior disc bulge at L4-L5 indenting the thecal sac.", order: 30 }],
      [],
    );
    expect(managed).toEqual(["L4-L5"]);
    expect(map["L4-L5"]).toEqual({ normal: false, text: "Diffuse posterior disc bulge at L4-L5 indenting the thecal sac." });
    // Every other section stays normal (conflict resolution: no contradictory text).
    expect(map["L3-L4"].normal).toBe(true);
    expect(map["L5-S1"].normal).toBe(true);
    // Anatomical order preserved (template order).
    expect(Object.keys(map)).toEqual(LS_BASELINE.map((b) => b.label));
  });

  it("handles multiple disc bulges, each in its own section", () => {
    const { map } = rebuildSmartSections(
      seed(LS_BASELINE),
      LS_BASELINE,
      [
        { section: "L5-S1", text: "Disc bulge at L5-S1.", order: 31 },
        { section: "L4-L5", text: "Disc bulge at L4-L5.", order: 30 },
      ],
      [],
    );
    expect(map["L4-L5"]).toEqual({ normal: false, text: "Disc bulge at L4-L5." });
    expect(map["L5-S1"]).toEqual({ normal: false, text: "Disc bulge at L5-S1." });
    // Order is still template order regardless of click order.
    expect(Object.keys(map).indexOf("L4-L5")).toBeLessThan(Object.keys(map).indexOf("L5-S1"));
  });

  it("restores a section to normal when its finding is removed", () => {
    const withBulge = rebuildSmartSections(seed(LS_BASELINE), LS_BASELINE,
      [{ section: "L4-L5", text: "Disc bulge at L4-L5.", order: 30 }], []);
    expect(withBulge.map["L4-L5"].normal).toBe(false);
    const removed = rebuildSmartSections(withBulge.map, LS_BASELINE, [], withBulge.managed);
    expect(removed.map["L4-L5"]).toEqual({ normal: true, text: LS_BASELINE[2].normal });
    expect(removed.managed).toEqual([]);
  });

  it("creates an appended section for a finding with no template section", () => {
    const { map } = rebuildSmartSections(
      seed(LS_BASELINE),
      LS_BASELINE,
      [{ section: "Spinal Canal", text: "Severe canal stenosis at L4-L5.", order: 50 }],
      [],
    );
    expect(map["Spinal Canal"]).toEqual({ normal: false, text: "Severe canal stenosis at L4-L5." });
    // Created section appears AFTER all template sections (anatomical order kept).
    expect(Object.keys(map).at(-1)).toBe("Spinal Canal");
    // Removing it drops the created section entirely.
    const removed = rebuildSmartSections(map, LS_BASELINE, [], ["Spinal Canal"]);
    expect("Spinal Canal" in removed.map).toBe(false);
  });
});

describe("rebuildSmartSections — merge into one section (Cervical C-levels)", () => {
  const CX = [
    { label: "Alignment & Curvature", normal: "Normal cervical lordosis." },
    { label: "C2-C3 to C6-C7", normal: "Normal disc heights. No herniation. No cord compression." },
    { label: "Spinal Cord", normal: "Normal calibre and signal." },
  ];
  it("merges two C-level bulges into the single shared section", () => {
    const { map } = rebuildSmartSections(
      seed(CX),
      CX,
      [
        { section: "C2-C3 to C6-C7", text: "Disc bulge at C5-C6.", order: 21 },
        { section: "C2-C3 to C6-C7", text: "Disc bulge at C6-C7.", order: 22 },
      ],
      [],
    );
    expect(map["C2-C3 to C6-C7"]).toEqual({ normal: false, text: "Disc bulge at C5-C6.\nDisc bulge at C6-C7." });
    expect(map["Spinal Cord"].normal).toBe(true);
  });
});

describe("rebuildSmartSections — preserves manual edits elsewhere", () => {
  it("does not touch a section that has no active finding, even if edited", () => {
    const current = seed(LS_BASELINE);
    current["Vertebral Bodies"] = { normal: false, text: "Manually typed marrow note." };
    const { map } = rebuildSmartSections(current, LS_BASELINE,
      [{ section: "L4-L5", text: "Disc bulge.", order: 30 }], []);
    expect(map["Vertebral Bodies"]).toEqual({ normal: false, text: "Manually typed marrow note." });
  });
});

describe("conflictingSelections", () => {
  it("returns same-group, same-study selections to deselect (Fazekas 1 vs 2)", () => {
    const selected = [
      { id: 1, studyType: "Brain", conflictGroup: "fazekas" },
      { id: 2, studyType: "Brain", conflictGroup: "" },
    ];
    expect(conflictingSelections({ id: 3, studyType: "Brain", conflictGroup: "fazekas" }, selected)).toEqual([1]);
  });
  it("no conflict when group is empty", () => {
    expect(conflictingSelections({ id: 3, studyType: "Brain", conflictGroup: "" }, [
      { id: 1, studyType: "Brain", conflictGroup: "fazekas" },
    ])).toEqual([]);
  });
});
