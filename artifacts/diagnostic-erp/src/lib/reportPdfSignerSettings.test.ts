/**
 * The signer printed on a downloaded letter-pad PDF is the one configured, taken as
 * saved. `loadPrintSettings` used to test the configured NAME against a particular
 * person and silently substitute the clinic default, so the second radiologist to
 * arrive could fill in Print Settings correctly and still download reports bearing
 * someone else's name and designation. These cases pin the three things that must
 * each survive that function: the clinic default for an unconfigured browser, an
 * explicitly configured person, and the rest of the settings around them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRINT_SETTINGS, loadPrintSettings } from "./reportPdfGenerator";

const KEY = "radiology_print_settings";

function savedSettings(value: unknown) {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k === KEY && value !== undefined ? JSON.stringify(value) : null),
    setItem: () => undefined,
  };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("letter-pad PDF signer", () => {
  it("falls back to the clinic's default radiologist on a browser that configured nothing", () => {
    savedSettings(undefined);
    const s = loadPrintSettings();
    expect(s.signature.name).toBe(DEFAULT_PRINT_SETTINGS.signature.name);
    expect(s.signature.qualification).toBe(DEFAULT_PRINT_SETTINGS.signature.qualification);
  });

  it("prints the configured radiologist, whoever they are", () => {
    savedSettings({ signature: { name: "Dr. Meera Iyer", qualification: "MD (Radiodiagnosis)", registrationNo: "9999/MMC", imageDataUrl: "data:image/png;base64,MEERA" } });
    const s = loadPrintSettings();
    expect(s.signature.name).toBe("Dr. Meera Iyer");
    expect(s.signature.qualification).toBe("MD (Radiodiagnosis)");
    expect(s.signature.registrationNo).toBe("9999/MMC");
    expect(s.signature.imageDataUrl).toBe("data:image/png;base64,MEERA");
  });

  it("does not rewrite a name because it matches someone else's", () => {
    // The case the removed override broke: this name used to be swapped for the
    // clinic default, so the settings dialog showed one person and the PDF printed
    // another.
    savedSettings({ signature: { name: "Dr. Abinash Singh", qualification: "MBBS, MD (Radiology)" } });
    const s = loadPrintSettings();
    expect(s.signature.name).toBe("Dr. Abinash Singh");
    expect(s.signature.qualification).toBe("MBBS, MD (Radiology)");
  });

  it("leaves the rest of the saved settings alone while merging defaults", () => {
    savedSettings({ show: { keyImages: true }, signature: { name: "Dr. Meera Iyer" } });
    const s = loadPrintSettings();
    expect(s.show.keyImages).toBe(true);
    expect(s.show.findings).toBe(DEFAULT_PRINT_SETTINGS.show.findings);
    expect(s.signature.qualification).toBe(DEFAULT_PRINT_SETTINGS.signature.qualification);
  });
});
