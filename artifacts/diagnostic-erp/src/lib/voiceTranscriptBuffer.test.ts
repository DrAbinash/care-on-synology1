import { describe, it, expect } from "vitest";
import {
  emptyVoiceTranscriptBuffer,
  appendFinalTranscript,
  setInterimTranscript,
  voiceTranscriptDisplay,
  clearInterimTranscript,
} from "./voiceTranscriptBuffer";

describe("voiceTranscriptBuffer — interim vs final", () => {
  it("appends final segments exactly once", () => {
    let buf = emptyVoiceTranscriptBuffer();
    buf = appendFinalTranscript(buf, "mild");
    buf = appendFinalTranscript(buf, "disc bulge");
    expect(buf.committed).toBe("mild disc bulge");
    expect(voiceTranscriptDisplay(buf)).toBe("mild disc bulge");
  });

  it("does not duplicate classic progressive finals", () => {
    let buf = emptyVoiceTranscriptBuffer();
    buf = appendFinalTranscript(buf, "mild");
    buf = appendFinalTranscript(buf, "mild disc");
    buf = appendFinalTranscript(buf, "mild disc bulge");
    expect(buf.committed).toBe("mild disc bulge");
  });

  it("skips exact trailing duplicate finals", () => {
    let buf = appendFinalTranscript(emptyVoiceTranscriptBuffer(), "canal stenosis");
    buf = appendFinalTranscript(buf, "canal stenosis");
    expect(buf.committed).toBe("canal stenosis");
  });

  it("interim is display-only and cleared on final", () => {
    let buf = emptyVoiceTranscriptBuffer();
    buf = setInterimTranscript(buf, "mild disc");
    expect(voiceTranscriptDisplay(buf)).toBe("mild disc");
    buf = appendFinalTranscript(buf, "mild disc bulge");
    expect(buf.interim).toBe("");
    expect(buf.committed).toBe("mild disc bulge");
  });

  it("committed + interim display without committing interim", () => {
    let buf = appendFinalTranscript(emptyVoiceTranscriptBuffer(), "No significant");
    buf = setInterimTranscript(buf, "spinal canal stenosis");
    expect(voiceTranscriptDisplay(buf)).toBe("No significant spinal canal stenosis");
    expect(buf.committed).toBe("No significant");
    buf = clearInterimTranscript(buf);
    expect(voiceTranscriptDisplay(buf)).toBe("No significant");
  });

  it("survives recognizer restart semantics (preserve committed)", () => {
    let buf = appendFinalTranscript(emptyVoiceTranscriptBuffer(), "Grade 1 anterolisthesis of L4");
    // Restart: interim resumes; committed stays
    buf = setInterimTranscript(buf, "over L5");
    expect(voiceTranscriptDisplay(buf)).toContain("Grade 1 anterolisthesis of L4");
    buf = appendFinalTranscript(buf, "over L5");
    expect(buf.committed).toBe("Grade 1 anterolisthesis of L4 over L5");
  });
});
