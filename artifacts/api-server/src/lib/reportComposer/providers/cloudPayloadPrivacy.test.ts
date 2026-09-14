import { describe, it, expect } from "vitest";
import {
  assertNoRawDicomPayload,
  scrubPhiObject,
  flagPossibleBurnedInPhi,
} from "./cloudPayloadPrivacy";
import { scrubDeepSeekSecrets, isDeepSeekConfigured } from "./deepseekConfig";

describe("cloudPayloadPrivacy", () => {
  it("scrubs patient identifier keys", () => {
    const scrubbed = scrubPhiObject({
      patientName: "Jane Doe",
      uhid: "U123",
      findings: "Disc bulge at L4-5",
      accessionNumber: "A1",
    });
    expect(scrubbed.patientName).toBeNull();
    expect(scrubbed.uhid).toBeNull();
    expect(scrubbed.accessionNumber).toBeNull();
    expect(scrubbed.findings).toBe("Disc bulge at L4-5");
  });

  it("forbids raw DICOM uploads", () => {
    expect(assertNoRawDicomPayload({ mimeTypes: ["application/dicom"] }).ok).toBe(false);
    expect(assertNoRawDicomPayload({ filenames: ["slice.dcm"] }).ok).toBe(false);
    expect(assertNoRawDicomPayload({ mimeTypes: ["image/jpeg"], filenames: ["k.png"] }).ok).toBe(true);
  });

  it("flags burned-in identifier text", () => {
    expect(flagPossibleBurnedInPhi(["Patient Name: X"])).toContain("possible_burned_in_identifier_text");
  });
});

describe("deepseekConfig secret scrub", () => {
  it("never reports configured when env unset", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    expect(isDeepSeekConfigured()).toBe(false);
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
  });

  it("redacts API key from strings", () => {
    const prev = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "sk-secret-trial-key";
    expect(scrubDeepSeekSecrets("err sk-secret-trial-key boom")).toBe("err [REDACTED_DEEPSEEK_KEY] boom");
    if (prev !== undefined) process.env.DEEPSEEK_API_KEY = prev;
    else delete process.env.DEEPSEEK_API_KEY;
  });
});
