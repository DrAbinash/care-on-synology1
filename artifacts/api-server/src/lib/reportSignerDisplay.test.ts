import { describe, expect, it } from "vitest";
import {
  captureSignerDisplay,
  effectiveSignerDisplay,
  signerDisplayFromStyle,
  type FrozenSignerDisplay,
} from "./reportStudyIdentity";

const ALL_ON = {
  showRadiologistName: true,
  showDegree: true,
  showRegNumber: true,
  showDigitalSignature: true,
  showTimestamp: true,
  showQrVerification: true,
};

describe("signerDisplayFromStyle — the same rule the renderer already used", () => {
  it("shows everything when the clinic has no style row at all", () => {
    expect(signerDisplayFromStyle(null)).toEqual(ALL_ON);
    expect(signerDisplayFromStyle(undefined)).toEqual(ALL_ON);
  });

  it("reads each flag off the style row", () => {
    expect(signerDisplayFromStyle({ ...ALL_ON, showRegNumber: false, showTimestamp: false }))
      .toEqual({ ...ALL_ON, showRegNumber: false, showTimestamp: false });
  });

  it("treats a style that does not decide a flag as off, not as the default", () => {
    // This is the pre-existing behaviour: `instStyle ? instStyle.showDegree : true`
    // — once a style row exists, an absent/false value hides the line. Pinned here
    // so the freeze cannot quietly re-enable fields the clinic had switched off.
    expect(signerDisplayFromStyle({ presetName: "x" })).toEqual({
      showRadiologistName: false,
      showDegree: false,
      showRegNumber: false,
      showDigitalSignature: false,
      showTimestamp: false,
      showQrVerification: false,
    });
  });
});

describe("captureSignerDisplay — what the signing event writes down", () => {
  it("records the six flags, the preset name and a capture instant", () => {
    const captured = captureSignerDisplay({ ...ALL_ON, showQrVerification: false, presetName: "Compact Radiology" });
    expect(captured.showQrVerification).toBe(false);
    expect(captured.stylePresetName).toBe("Compact Radiology");
    expect(new Date(captured.capturedAt).toISOString()).toBe(captured.capturedAt);
    expect(Object.keys(captured).sort()).toEqual(
      [...Object.keys(ALL_ON), "capturedAt", "stylePresetName"].sort(),
    );
  });

  it("a preset with no name still captures the flags", () => {
    expect(captureSignerDisplay(ALL_ON).stylePresetName).toBeNull();
  });
});

describe("effectiveSignerDisplay — a signed report shows what it showed when it was signed", () => {
  const frozen: FrozenSignerDisplay = {
    ...ALL_ON, showRegNumber: false, showTimestamp: false,
    stylePresetName: "Care Diagnostics Default",
    capturedAt: "2026-10-21T00:00:00.000Z",
  };

  it("the frozen half wins whole, so a live edit cannot rewrite an authorized signer block", () => {
    const { flags, source } = effectiveSignerDisplay(frozen, ALL_ON);
    expect(source).toBe("frozen");
    expect(flags.showRegNumber).toBe(false);
    expect(flags.showTimestamp).toBe(false);
  });

  it("is never field-by-field: a flag added to the snapshot later defaults off rather than mixing", () => {
    // A snapshot missing a key must not silently inherit the live value — the
    // document would then be part-what-was-signed, part-what-the-clinic-says-today.
    const partial = { ...frozen } as FrozenSignerDisplay;
    delete (partial as Record<string, unknown>).showDegree;
    expect(effectiveSignerDisplay(partial, ALL_ON).flags.showDegree).toBeUndefined();
  });

  it("reports signed before this field existed keep the live behaviour", () => {
    const { flags, source } = effectiveSignerDisplay(null, { ...ALL_ON, showTimestamp: false });
    expect(source).toBe("live");
    expect(flags.showTimestamp).toBe(false);
  });

  it("a pre-signing snapshot object without flags is treated as absent, not as all-off", () => {
    expect(effectiveSignerDisplay({} as FrozenSignerDisplay, ALL_ON).source).toBe("live");
  });
});
