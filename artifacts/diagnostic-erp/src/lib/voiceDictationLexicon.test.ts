import { describe, it, expect } from "vitest";
import { parseVoiceTranscript, normalizeDictationText } from "./voiceCommandGrammar";
import { applyRadiologyVoiceLexicon } from "./voiceDictationLexicon";

describe("voice dictation enhancements", () => {
  it("parses technique and clinical history dictation", () => {
    const tech = parseVoiceTranscript("technique multiplanar T2 of the brain");
    expect(tech.intent).toEqual({
      type: "dictate",
      target: "technique",
      mode: "append",
      text: "multiplanar t2 of the brain",
    });
    const hist = parseVoiceTranscript("clinical history headache for three days");
    expect(hist.intent?.type).toBe("dictate");
    if (hist.intent?.type === "dictate") {
      expect(hist.intent.target).toBe("clinicalHistory");
      expect(hist.intent.text).toContain("headache");
    }
  });

  it("applies radiology lexicon in normalizeDictationText", () => {
    const out = normalizeDictationText("t 2 w flair and dwi show hyperintensity measuring 5 millimeters", {
      autoPunctuation: false,
    });
    expect(out).toContain("T2W");
    expect(out).toContain("FLAIR");
    expect(out).toContain("DWI");
    expect(out).toContain("mm");
  });

  it("lexicon expands MRI sequence aliases", () => {
    expect(applyRadiologyVoiceLexicon("t1 and stir")).toMatch(/T1/);
    expect(applyRadiologyVoiceLexicon("t1 and stir")).toMatch(/STIR/);
  });

  it("lexicon turns spoken slash into / for s/o", () => {
    expect(applyRadiologyVoiceLexicon("s slash o hypertension")).toBe("s/o hypertension");
  });
});
