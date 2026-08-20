import { describe, it, expect } from "vitest";
import { applySide, swapSides, hasSideWords } from "./sideSwap";
import { validateReport } from "./reportValidator";

describe("applySide", () => {
  it("replaces whole words with the chosen side", () => {
    expect(applySide("Left knee joint effusion is noted.", "right"))
      .toBe("Right knee joint effusion is noted.");
  });

  it("handles bilateral", () => {
    expect(applySide("The left maxillary sinus shows mucosal thickening.", "bilateral"))
      .toBe("The bilateral maxillary sinus shows mucosal thickening.");
  });

  it("preserves capitalization styles", () => {
    expect(applySide("LEFT sided weakness. Left knee. left hip.", "right"))
      .toBe("RIGHT sided weakness. Right knee. right hip.");
  });

  it("never touches words merely containing side letters", () => {
    const text = "The brighter signal is copyrighted nonsense leftover.";
    expect(applySide(text, "left")).toBe(text);
  });
});

describe("swapSides", () => {
  it("swaps left and right, leaves bilateral", () => {
    expect(swapSides("Left ACL tear with right meniscal and bilateral effusion."))
      .toBe("Right ACL tear with left meniscal and bilateral effusion.");
  });

  it("round-trips", () => {
    const t = "Left kidney calculus. Right kidney normal.";
    expect(swapSides(swapSides(t))).toBe(t);
  });
});

describe("hasSideWords", () => {
  it("detects side words and ignores lookalikes", () => {
    expect(hasSideWords("left hip")).toBe(true);
    expect(hasSideWords("brighter leftover copyright")).toBe(false);
  });
});

describe("validateReport", () => {
  it("passes a clean report with no warnings", () => {
    expect(validateReport({
      findings: "Diffuse disc bulge is noted at L4-L5 level indenting the anterior thecal sac.",
      impression: ["L4-L5 disc bulge."],
    })).toEqual([]);
  });

  it("flags duplicate sentences in findings", () => {
    const s = "Diffuse disc bulge is noted at L4-L5 level.";
    const w = validateReport({ findings: `${s} ${s}`, impression: ["L4-L5 disc bulge."] });
    expect(w.some((x) => x.includes("Duplicate sentence"))).toBe(true);
  });

  it("flags duplicate impression lines", () => {
    const w = validateReport({ findings: "Disc bulge is noted at L4-L5 level today.", impression: ["Disc bulge.", "Disc bulge."] });
    expect(w.some((x) => x.includes("Duplicate impression"))).toBe(true);
  });

  it("flags normal-study contradiction", () => {
    const w = validateReport({
      findings: "No significant abnormality. A large tumor is noted in the right frontal lobe.",
      impression: ["Normal study."],
    });
    expect(w.some((x) => x.includes("contradiction"))).toBe(true);
  });

  it("flags laterality mismatch between findings and impression", () => {
    const w = validateReport({
      findings: "Right knee joint effusion is noted with meniscal degeneration.",
      impression: ["Left knee joint effusion."],
    });
    expect(w.some((x) => x.includes("Laterality"))).toBe(true);
  });

  it("does not flag laterality when both sides genuinely appear", () => {
    const w = validateReport({
      findings: "Right knee effusion. Left knee is unremarkable in comparison view.",
      impression: ["Right knee effusion.", "Left knee normal."],
    });
    expect(w.some((x) => x.includes("Laterality"))).toBe(false);
  });

  it("flags pathology findings with empty impression", () => {
    const w = validateReport({ findings: "An acute infarct is noted in the left MCA territory.", impression: [""] });
    expect(w.some((x) => x.includes("Impression section is empty"))).toBe(true);
  });

  it("flags unfilled {value} placeholders", () => {
    const w = validateReport({ findings: "CBD measures {value} mm today overall.", impression: ["Dilated CBD."] });
    expect(w.some((x) => x.includes("{value}"))).toBe(true);
  });

  it("flags basal ganglia normal + hemorrhage contradiction", () => {
    const w = validateReport({
      findings: "Basal ganglia are normal. Acute hemorrhage in the right basal ganglia is present today overall.",
      impression: ["Right basal ganglia hemorrhage."],
    });
    expect(w.some((x) => x.includes("basal ganglia"))).toBe(true);
  });

  it("flags no restricted diffusion + acute infarct contradiction", () => {
    const w = validateReport({
      findings: "No restricted diffusion on DWI/ADC. Acute left MCA territory infarct is present today.",
      impression: ["Acute left MCA territory infarct."],
    });
    expect(w.some((x) => x.includes("restricted diffusion"))).toBe(true);
  });
});
