import { describe, expect, it } from "vitest";
import {
  missingSequenceLabels,
  parseBrainSequences,
  sequenceAllows,
} from "./mriBrainSequences";

const FULL =
  "MRI brain on 3T. Multiplanar T1W, T2W, FLAIR, DWI, ADC and GRE/SWI sequences were obtained. Contrast administered.";

describe("parseBrainSequences", () => {
  it("recognizes a full stroke protocol", () => {
    const ctx = parseBrainSequences(FULL);
    expect(ctx.performed.t1 && ctx.performed.t2 && ctx.performed.flair).toBe(true);
    expect(ctx.performed.dwi && ctx.performed.adc).toBe(true);
    expect(ctx.performed.swiGre).toBe(true);
    expect(ctx.performed.contrast).toBe(true);
    expect(ctx.hasTechniqueSignal).toBe(true);
  });

  it("does not claim DWI/SWI/contrast from conventional-only technique", () => {
    const ctx = parseBrainSequences("MRI brain. T1W, T2W and FLAIR acquired.");
    expect(ctx.performed.dwi).toBe(false);
    expect(ctx.performed.adc).toBe(false);
    expect(ctx.performed.swiGre).toBe(false);
    expect(ctx.performed.contrast).toBe(false);
  });

  it("treats 'non-contrast' as NO contrast", () =>
  {
    const ctx = parseBrainSequences("Non-contrast MRI brain with DWI/ADC.");
    expect(ctx.performed.contrast).toBe(false);
    expect(ctx.performed.dwi).toBe(true);
  });

  it("detects MRS / MRA / MRV and pediatric markers", () => {
    expect(parseBrainSequences("MRI brain; MRS voxel over lesion; MRA and MRV performed.").performed.mrs).toBe(true);
    const ped = parseBrainSequences("MRI brain, pediatric protocol, 4 years old.");
    expect(ped.performed.pediatric).toBe(true);
  });

  it("empty technique produces no positive sequences", () => {
    const ctx = parseBrainSequences("");
    expect(ctx.hasTechniqueSignal).toBe(false);
    expect(Object.values(ctx.performed).every((v) => !v)).toBe(true);
  });

  it("sequenceAllows + missingSequenceLabels", () => {
    const ctx = parseBrainSequences("MRI brain T1 T2 FLAIR");
    expect(sequenceAllows(ctx, ["dwi", "adc"])).toBe(false);
    expect(missingSequenceLabels(ctx, ["dwi", "contrast"])).toEqual(["DWI", "contrast"]);
  });
});
