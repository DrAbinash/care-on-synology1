import { describe, it, expect } from "vitest";
import { parseSrContentTree, collectSrMeasurements, extractSrMeasurements } from "./usgSrContentTree";
import { OB_SR_FIXTURE, SR_NO_IMAGE_FIXTURE, MALFORMED_FIXTURE } from "./__fixtures__/usgSrFixtures";

describe("P3.4 SR content-tree parser", () => {
  const measurements = extractSrMeasurements(OB_SR_FIXTURE as unknown as Record<string, unknown>);
  const by = (name: string) => measurements.find((m) => m.conceptText === name)!;

  it("parses all NUM measurements from a nested container", () => {
    expect(measurements.map((m) => m.conceptText)).toEqual(
      expect.arrayContaining([
        "Biparietal diameter", "Head circumference", "Renal length", "Umbilical artery pulsatility index",
      ]),
    );
    expect(measurements).toHaveLength(4);
  });

  it("BPD resolves exact image SOP + frame + SCOORD caliper (TID-1400 NUM→SCOORD→IMAGE)", () => {
    const bpd = by("Biparietal diameter");
    expect(bpd.value).toBe(74.2);
    expect(bpd.unitText).toBe("millimeter");
    expect(bpd.imageRef?.sopInstanceUID).toBe("1.2.3.4.5.IMG.7");
    expect(bpd.imageRef?.frameNumber).toBe(3);              // NOT fabricated as 1
    expect(bpd.scoord?.graphicType).toBe("POLYLINE");
    expect(bpd.scoord?.graphicData).toEqual([10, 20, 84.2, 20]);
  });

  it("HC resolves a referenced image (frame 1) but no caliper", () => {
    const hc = by("Head circumference");
    expect(hc.imageRef?.sopInstanceUID).toBe("1.2.3.4.5.IMG.8");
    expect(hc.imageRef?.frameNumber).toBe(1);
    expect(hc.scoord).toBeUndefined();
  });

  it("laterality is read from a CODE modifier when no image is referenced", () => {
    const renal = by("Renal length");
    expect(renal.value).toBe(98);
    expect(renal.laterality).toBe("right");
    expect(renal.imageRef).toBeUndefined();                // never fabricated
  });

  it("a NUM with no image/SCOORD yields no imageRef (honest)", () => {
    const m = extractSrMeasurements(SR_NO_IMAGE_FIXTURE as unknown as Record<string, unknown>);
    expect(m).toHaveLength(1);
    expect(m[0].imageRef).toBeUndefined();
    expect(m[0].scoord).toBeUndefined();
  });

  it("malformed input never throws → empty", () => {
    expect(() => parseSrContentTree(MALFORMED_FIXTURE)).not.toThrow();
    expect(collectSrMeasurements(parseSrContentTree(MALFORMED_FIXTURE))).toEqual([]);
    expect(extractSrMeasurements("not json")).toEqual([]);
  });
});
