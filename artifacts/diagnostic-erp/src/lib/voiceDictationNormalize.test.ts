import { describe, it, expect } from "vitest";
import {
  normalizeRadiologyDictation,
  normalizeRadiologyDictationIdempotent,
  normalizeSpokenSpinalLevels,
  normalizeSpokenMeasurements,
  applySpokenPunctuationCommands,
  NEGATION_GUARD_PHRASES,
} from "./voiceDictationNormalize";

describe("spoken spinal levels", () => {
  it("normalizes L four L five / C five C six / D eleven D twelve / L five S one", () => {
    expect(normalizeSpokenSpinalLevels("disc at L four L five")).toContain("L4-L5");
    expect(normalizeSpokenSpinalLevels("C five C six")).toBe("C5-C6");
    expect(normalizeSpokenSpinalLevels("D eleven D twelve")).toBe("D11-D12");
    expect(normalizeSpokenSpinalLevels("T eleven T twelve")).toBe("T11-T12");
    expect(normalizeSpokenSpinalLevels("L five S one")).toBe("L5-S1");
  });

  it("normalizes L four five only when adjacent levels", () => {
    expect(normalizeSpokenSpinalLevels("at L four five")).toContain("L4-L5");
    expect(normalizeSpokenSpinalLevels("C six seven")).toContain("C6-C7");
    // Do not invent far-apart levels
    expect(normalizeSpokenSpinalLevels("L one five")).toBe("L one five");
  });

  it("never invents a level absent from the transcript", () => {
    expect(normalizeSpokenSpinalLevels("mild disc bulge")).toBe("mild disc bulge");
  });
});

describe("spoken measurements", () => {
  it("converts decimal word measurements", () => {
    expect(normalizeSpokenMeasurements("six point six millimeters")).toBe("6.6 mm");
    expect(normalizeSpokenMeasurements("twelve point seven millimeters")).toBe("12.7 mm");
    expect(normalizeSpokenMeasurements("four point eight centimeters")).toBe("4.8 cm");
    expect(normalizeSpokenMeasurements("eight millimeters")).toBe("8 mm");
  });

  it("formats × dimensions", () => {
    expect(normalizeSpokenMeasurements("twenty six point nine by twenty four point zero millimeters"))
      .toMatch(/26\.9 × 24\.0 mm/);
    expect(normalizeSpokenMeasurements("26.9 by 24.0 millimeters")).toBe("26.9 × 24.0 mm");
  });

  it("never hallucinates a different measurement value", () => {
    expect(normalizeSpokenMeasurements("6.6 mm")).toBe("6.6 mm");
  });
});

describe("punctuation commands are context-aware", () => {
  it("maps full stop / comma / new line", () => {
    expect(applySpokenPunctuationCommands("Hello full stop")).toContain("Hello.");
    expect(applySpokenPunctuationCommands("a comma b")).toMatch(/a, b/);
    expect(applySpokenPunctuationCommands("line one new line line two")).toContain("\n");
  });

  it("does not turn anatomical colon into punctuation", () => {
    expect(applySpokenPunctuationCommands("The colon appears mildly thickened.")).toMatch(/colon appears/i);
    expect(applySpokenPunctuationCommands("The colon appears mildly thickened.")).not.toMatch(/The\s*:/);
  });

  it("still allows bare colon as a command", () => {
    expect(applySpokenPunctuationCommands("Impression colon mild stenosis")).toMatch(/Impression:\s*mild/);
  });
});

describe("radiology clinical dictation examples", () => {
  const n = (s: string) => normalizeRadiologyDictation(s).normalizedTranscript;

  it("Spine", () => {
    expect(n("Mild diffuse disc bulge at L four L five causing bilateral neural foraminal narrowing."))
      .toMatch(/L4-L5/);
    expect(n("Grade 1 anterolisthesis of L4 over L5.")).toMatch(/anterolisthesis/i);
    expect(n("AP spinal canal diameter at L4-L5 measures six point seven millimeters."))
      .toMatch(/6\.7 mm/);
    expect(n("No significant spinal canal stenosis.")).toMatch(/^No significant spinal canal stenosis/i);
  });

  it("Brain", () => {
    expect(n("Fazekas grade 2 small vessel ischemic changes.")).toMatch(/Fazekas Grade 2/);
    expect(n("Acute diffusion restricting infarct in the right parietal region.")).toMatch(/diffusion/);
    expect(n("No diffusion restriction is seen.")).toMatch(/^No diffusion restriction is seen/i);
  });

  it("Abdomen / USG", () => {
    expect(n("Right renal calculus measuring six point six millimeters with mild hydronephrosis."))
      .toMatch(/6\.6 mm/);
    expect(n("Collection measures 26.9 by 24.0 millimeters.")).toMatch(/26\.9 × 24\.0 mm/);
    expect(n("Common bile duct measures eight millimeters. No choledocholithiasis."))
      .toMatch(/8 mm/);
  });

  it("Additional normalization", () => {
    expect(n("C five C six")).toBe("C5-C6");
    expect(n("D eleven D twelve")).toBe("D11-D12");
    expect(n("L five S one")).toBe("L5-S1");
    expect(n("T one hyperintense and T two hyperintense lesion.")).toMatch(/T1 hyperintense and T2 hyperintense/);
  });
});

describe("negation absolute safety", () => {
  for (const phrase of NEGATION_GUARD_PHRASES) {
    it(`preserves “${phrase}”`, () => {
      const out = normalizeRadiologyDictation(phrase).normalizedTranscript.toLowerCase();
      // Core negation tokens must remain
      expect(out).toMatch(/\b(no|not|without|absent|negative)\b/);
      expect(out).toContain(phrase.toLowerCase().replace(/\s+/g, " ").split(" ").slice(0, 2).join(" "));
    });
  }

  it("does not invert clinical negation sentences", () => {
    for (const s of [
      "No diffusion restriction is seen.",
      "No significant spinal canal stenosis.",
      "No focal lesion is identified.",
      "No hydronephrosis.",
      "Without cord compression.",
      "No evidence of choledocholithiasis.",
    ]) {
      const out = normalizeRadiologyDictation(s).normalizedTranscript;
      expect(out.toLowerCase()).toMatch(/^(no|without)\b/);
    }
  });
});

describe("idempotence and raw/normalized separation", () => {
  it("normalize(normalize(t)) === normalize(t)", () => {
    const samples = [
      "Mild disc bulge at L four L five measuring six point six millimeters full stop",
      "The colon appears mildly thickened.",
      "T one and flair hyperintensity",
      "No evidence of choledocholithiasis.",
    ];
    for (const s of samples) {
      const once = normalizeRadiologyDictation(s).normalizedTranscript;
      expect(normalizeRadiologyDictationIdempotent(s)).toBe(once);
    }
  });

  it("preserves rawTranscript separately", () => {
    const raw = "L four L five six point six millimeters";
    const r = normalizeRadiologyDictation(raw);
    expect(r.rawTranscript).toBe(raw);
    expect(r.normalizedTranscript).not.toBe(raw);
    expect(r.normalizedTranscript).toMatch(/L4-L5/);
    expect(r.normalizedTranscript).toMatch(/6\.6 mm/);
  });
});
