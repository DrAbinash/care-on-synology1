// registry.test.ts — Step 14 (validation) + Step 15 (performance) for the
// Universal Measurement Registry.
//
// The resolution fixtures below are the Step-1 audit's duplication map turned
// into executable guarantees: every divergent legacy spelling found in the
// platform must resolve to its one canonical id, forever.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_MEASUREMENT_REGISTRY as REG,
  MEASUREMENT_CATALOG,
  createMeasurementRegistry,
  resolveMeasurement,
  compareMeasurementValues,
  classifyMeasurementValue,
  convertUnitValue,
  getMeasurement,
} from "./index";

describe("registry integrity (Step 14)", () => {
  it("has zero validation issues (no duplicate ids, no duplicate aliases, no conflicting units, no broken ranges)", () => {
    expect(REG.validationIssues()).toEqual([]);
  });

  it("every definition is resolvable by its own id, canonicalKey and displayName", () => {
    for (const def of MEASUREMENT_CATALOG) {
      expect(REG.resolve(def.id)?.definition.id).toBe(def.id);
      expect(REG.resolve(def.canonicalKey)?.definition.id).toBe(def.id);
      expect(REG.resolve(def.displayName)?.definition.id).toBe(def.id);
    }
  });

  it("covers all four platform modalities", () => {
    for (const m of ["US", "CT", "MR", "XR"] as const) {
      expect(REG.byModality(m).length).toBeGreaterThan(0);
    }
  });

  it("no orphan replacedBy references and no deprecated entries without replacement path", () => {
    for (const def of MEASUREMENT_CATALOG) {
      if (def.replacedBy) expect(getMeasurement(def.replacedBy)).toBeDefined();
    }
  });

  it("flags duplicate aliases across different measurements", () => {
    const bad = createMeasurementRegistry([
      { ...MEASUREMENT_CATALOG[0]!, id: "A_TEST", canonicalKey: "meas.a_test", aliases: ["Shared Label"] },
      { ...MEASUREMENT_CATALOG[0]!, id: "B_TEST", canonicalKey: "meas.b_test", aliases: ["Shared Label"] },
    ]);
    expect(bad.validationIssues().some((i) => i.kind === "duplicate-alias")).toBe(true);
  });
});

describe("legacy label resolution — the audit's duplication map as fixtures (Step 4 migration)", () => {
  const CASES: Array<[string, string]> = [
    // CBD — defined in 10 places pre-registry (cluster #1)
    ["CBD", "CBD"],
    ["CBD Diameter", "CBD"],
    ["CBD diameter", "CBD"],
    ["cbd_diameter", "CBD"],
    ["Common Bile Duct", "CBD"],
    ["Common bile duct", "CBD"],
    ["Common Bile Duct Diameter", "CBD"],
    ["meas.cbd", "CBD"],
    ["usg-cbd", "CBD"],
    // Midline shift — 3 spellings + metric key (cluster #3)
    ["Midline Shift", "MIDLINE_SHIFT"],
    ["Midline shift", "MIDLINE_SHIFT"],
    ["midline_shift", "MIDLINE_SHIFT"],
    ["midlineShift", "MIDLINE_SHIFT"],
    ["meas.midline_shift", "MIDLINE_SHIFT"],
    // BPD — two DB stores + parenthetical panel labels (cluster #2)
    ["BPD", "BPD"],
    ["BPD (Biparietal Diameter)", "BPD"],
    ["BPD (Biparietal Dia.)", "BPD"],
    // Liver — 6 label variants (cluster: liver span)
    ["Liver Span", "LIVER_LENGTH"],
    ["Liver span", "LIVER_LENGTH"],
    ["liver_span", "LIVER_LENGTH"],
    ["liverSize", "LIVER_LENGTH"],
    ["Liver Longitudinal Span", "LIVER_LENGTH"],
    ["Liver Span (MCL)", "LIVER_LENGTH"],
    ["Liver", "LIVER_LENGTH"],
    ["meas.liver_span", "LIVER_LENGTH"],
    // Kidneys — Title-Case, em-dash, column, snake (cluster #4)
    ["Right kidney length", "RENAL_LENGTH_RIGHT"],
    ["Right Kidney — Length", "RENAL_LENGTH_RIGHT"],
    ["rightKidneyLengthMm", "RENAL_LENGTH_RIGHT"],
    ["right_kidney_length", "RENAL_LENGTH_RIGHT"],
    ["Left Kidney", "RENAL_LENGTH_LEFT"],
    ["Kidney size", "RENAL_LENGTH"],
    // Stones (cluster #7)
    ["Stone size", "STONE_SIZE"],
    ["Stone Size (if present)", "STONE_SIZE"],
    ["Renal Stone Size", "STONE_SIZE"],
    ["meas.calculus_size", "STONE_SIZE"],
    ["Stone density", "STONE_HU"],
    ["Stone HU", "STONE_HU"],
    // AFI/Liquor (cluster #6)
    ["AFI", "AFI"],
    ["AFI (Amniotic Fluid Index)", "AFI"],
    ["Liquor / AFI", "AFI"],
    ["liquorAfi", "AFI"],
    ["AFV", "AFI"],
    // Prostate cc-vs-g (cluster #5)
    ["Prostate volume", "PROSTATE_VOLUME"],
    ["prostateVolume", "PROSTATE_VOLUME"],
    // Endometrium (cluster #8)
    ["Endometrium", "ENDOMETRIAL_THICKNESS"],
    ["Endometrial Thickness", "ENDOMETRIAL_THICKNESS"],
    ["meas.et", "ENDOMETRIAL_THICKNESS"],
    // Cervical length (cluster #9)
    ["Cervical Length", "CERVICAL_LENGTH"],
    ["cervicalLength", "CERVICAL_LENGTH"],
    ["ob-cervix", "CERVICAL_LENGTH"],
    // FHR (cluster #10)
    ["Fetal Heart Rate", "FHR"],
    ["fetalHeartRate", "FHR"],
    // Doppler (cluster #11)
    ["PSV (Peak Systolic Velocity)", "PSV"],
    ["sdRatio", "SD_RATIO"],
    ["S/D Ratio", "SD_RATIO"],
    // 3rd ventricle — panel vs route-template labels
    ["Third Ventricle Width", "THIRD_VENTRICLE_WIDTH"],
    ["Cerebral Ventricle Width (3rd)", "THIRD_VENTRICLE_WIDTH"],
    // XR content pack labels
    ["Cardiothoracic ratio", "CTR"],
    ["Cobb angle", "COBB_ANGLE"],
    ["Vertebral height loss", "VERTEBRAL_HEIGHT_LOSS"],
    // CT content pack labels
    ["Hemorrhage volume", "HEMORRHAGE_VOLUME"],
    ["Nodule size", "NODULE_SIZE"],
    // Spine
    ["AP Canal Diameter", "CANAL_AP"],
    ["Spinal canal diameter", "CANAL_AP"],
    ["mri-cerv-ap-canal", "CANAL_AP"],
    // Protocol snake_case tokens (migration zz_add_usg_platform_content_pack)
    ["gbWall", "GB_WALL"],
    ["GB Wall", "GB_WALL"],
    ["pvr", "PVR"],
  ];

  for (const [input, expected] of CASES) {
    it(`"${input}" → ${expected}`, () => {
      expect(resolveMeasurement(input)?.definition.id).toBe(expected);
    });
  }

  it("resolves usg_measurements column names via resolveByColumn", () => {
    expect(REG.resolveByColumn("cbdMm")?.id).toBe("CBD");
    expect(REG.resolveByColumn("liquorAfi")?.id).toBe("AFI");
    expect(REG.resolveByColumn("rightKidney")?.id).toBe("RENAL_LENGTH_RIGHT");
    expect(REG.resolveByColumn("umbilicalArteryPi")?.id).toBe("UA_PI");
  });

  it("does not fuzzy-match unknown labels", () => {
    expect(resolveMeasurement("Completely Unknown Thing")).toBeUndefined();
    expect(resolveMeasurement("")).toBeUndefined();
  });
});

describe("units + comparison inherit from the registry (Step 5)", () => {
  it("converts across the shared unit vocabulary", () => {
    expect(convertUnitValue(15, "mm", "cm")).toBeCloseTo(1.5);
    expect(convertUnitValue(1.5, "cm", "mm")).toBeCloseTo(15);
    expect(convertUnitValue(30, "cc", "ml")).toBe(30);
    expect(convertUnitValue(1.2, "kg", "g")).toBeCloseTo(1200);
    expect(convertUnitValue(5, "mm", "HU")).toBeNull();
  });

  it("compares by canonical id with unit normalization (mm prior vs cm current)", () => {
    const liver = getMeasurement("LIVER_LENGTH")!;
    const cmp = compareMeasurementValues(liver, { value: 148, unit: "mm" }, { value: 16.2, unit: "cm" });
    expect(cmp.priorValue).toBeCloseTo(14.8);
    expect(cmp.currentValue).toBeCloseTo(16.2);
    expect(cmp.direction).toBe("increased");
    expect(cmp.formattedCurrent).toBe("16.2 cm");
  });

  it("treats sub-precision drift as unchanged", () => {
    const cbd = getMeasurement("CBD")!;
    const cmp = compareMeasurementValues(cbd, { value: 5.21 }, { value: 5.23 });
    expect(cmp.direction).toBe("unchanged");
  });

  it("classifies values against normal and critical ranges", () => {
    const mls = getMeasurement("MIDLINE_SHIFT")!;
    expect(classifyMeasurementValue(mls, 1).status).toBe("normal");
    expect(classifyMeasurementValue(mls, 3).status).toBe("abnormal");
    expect(classifyMeasurementValue(mls, 7).status).toBe("critical");
    expect(classifyMeasurementValue(mls, 0.4, "cm").status).toBe("abnormal");
  });
});

// Test-only ambient declaration: this package's tsconfig deliberately has no
// node/dom lib types (pure-TS package), but vitest runs the file under node.
declare const console: { log: (...args: unknown[]) => void };

describe("registry lookup performance (Step 15)", () => {
  it("resolves 120k mixed lookups fast (reports timing)", () => {
    const inputs = ["CBD", "Common Bile Duct Diameter", "meas.midline_shift", "liquorAfi", "Stone Size (if present)", "not-a-measurement"];
    const N = 120_000; // divisible by inputs.length → exact hit count
    const start = Date.now();
    let hits = 0;
    for (let i = 0; i < N; i++) {
      if (resolveMeasurement(inputs[i % inputs.length]!)) hits++;
    }
    const elapsed = Date.now() - start;
    console.log(`[measurements perf] ${N} resolves in ${elapsed}ms (${((elapsed / N) * 1e6).toFixed(0)}ns/lookup, ${hits} hits)`);
    expect(hits).toBe((N / inputs.length) * 5);
    expect(elapsed).toBeLessThan(2000);
  });
});
