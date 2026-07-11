import { describe, it, expect } from "vitest";
import { fillTemplate, renderAbnormality, parseProperties, EMPTY_INSTANCE } from "./abnormalityEngine";

describe("fillTemplate", () => {
  it("fills all placeholder properties", () => {
    const t = fillTemplate(
      "{severity} {chronicity} disc bulge at {level} on the {side} side measuring {value} mm.",
      { side: "left", severity: "moderate", chronicity: "chronic", level: "L4-L5", value: "4" },
    );
    expect(t).toBe("Moderate chronic disc bulge at L4-L5 on the left side measuring 4 mm.");
  });

  it("cleans up gracefully when properties are empty", () => {
    const t = fillTemplate(
      "{severity} disc bulge at {level} indenting the thecal sac.",
      { ...EMPTY_INSTANCE },
    );
    expect(t).toBe("Disc bulge indenting the thecal sac.");
    expect(t).not.toMatch(/\s{2,}/);
  });

  it("removes 'at .' fragments when level is empty", () => {
    const t = fillTemplate("Compression noted at {level}.", { ...EMPTY_INSTANCE });
    expect(t).toBe("Compression noted.");
  });

  it("adapts legacy side-word templates without {side}", () => {
    const t = fillTemplate("Left knee joint effusion is noted.", { ...EMPTY_INSTANCE, side: "right" });
    expect(t).toBe("Right knee joint effusion is noted.");
  });

  it("does not double-apply side when {side} slot exists", () => {
    const t = fillTemplate("Effusion on the {side} side; left untouched-word check: leftover.", { ...EMPTY_INSTANCE, side: "right" });
    expect(t).toContain("on the right side");
    expect(t).toContain("leftover"); // whole-word safety
  });

  it("capitalizes the first letter after substitution", () => {
    const t = fillTemplate("{severity} canal stenosis.", { ...EMPTY_INSTANCE, severity: "severe" });
    expect(t).toBe("Severe canal stenosis.");
  });

  it("property change produces a different exact sentence (replace key)", () => {
    const tpl = "{severity} canal stenosis at {level}.";
    const a = fillTemplate(tpl, { ...EMPTY_INSTANCE, severity: "mild", level: "L4-L5" });
    const b = fillTemplate(tpl, { ...EMPTY_INSTANCE, severity: "severe", level: "L4-L5" });
    expect(a).toBe("Mild canal stenosis at L4-L5.");
    expect(b).toBe("Severe canal stenosis at L4-L5.");
    expect(a).not.toBe(b);
  });
});

describe("renderAbnormality", () => {
  it("renders all four sections from one instance", () => {
    const r = renderAbnormality(
      {
        findingText: "{chronicity} infarct in the {side} MCA territory.",
        impressionText: "{chronicity} {side} MCA infarct.",
        techniqueText: "DWI and ADC sequences reviewed.",
        recommendationText: "MRA brain is advised.",
      },
      { ...EMPTY_INSTANCE, side: "left", chronicity: "acute" },
    );
    expect(r.finding).toBe("Acute infarct in the left MCA territory.");
    expect(r.impression).toBe("Acute left MCA infarct.");
    expect(r.technique).toBe("DWI and ADC sequences reviewed.");
    expect(r.recommendation).toBe("MRA brain is advised.");
  });

  it("returns empty strings for empty templates", () => {
    const r = renderAbnormality(
      { findingText: "", impressionText: "x {value} mm.", techniqueText: "", recommendationText: "" },
      { ...EMPTY_INSTANCE, value: "7" },
    );
    expect(r.finding).toBe("");
    expect(r.impression).toBe("X 7 mm.");
    expect(r.technique).toBe("");
  });
});

describe("parseProperties", () => {
  it("parses valid keys and drops junk", () => {
    expect(parseProperties("side, severity, LEVEL, nonsense, measurement"))
      .toEqual(["side", "severity", "level", "measurement"]);
  });
  it("handles null/empty", () => {
    expect(parseProperties("")).toEqual([]);
    expect(parseProperties(null)).toEqual([]);
  });
});
