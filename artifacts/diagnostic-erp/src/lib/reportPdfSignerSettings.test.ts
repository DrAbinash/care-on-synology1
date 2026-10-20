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
import {
  DEFAULT_PRINT_SETTINGS,
  generateReportPDF,
  loadPrintSettings,
  type PrintSettings,
} from "./reportPdfGenerator";

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

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABICAIAAACGBWc0AAAAhUlEQVR4nO3QQQ0AIBDAsJODCJTgXwgO+LJHkwlYOmsfPZrvB/EAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIU7gItxwstLBsV7wAAAABJRU5ErkJggg==";

/** What the downloaded page actually draws, read off its own text operators (no
 *  pdftotext binary, so this runs in CI). */
function drawnOnPage(settings: PrintSettings, opts: Parameters<typeof generateReportPDF>[3]) {
  const doc = generateReportPDF(
    {
      patientName: "Premchand Mandal", age: "4 Y", sex: "M", studyDate: "20260818",
      referringDoctor: "Dr Tushar Jyoti", findings: "Normal.", impression: "Normal.",
      reportTitle: "MRI LSPINE",
    },
    settings,
    null,
    { save: false, ...opts },
  );
  const pdf = Buffer.from(doc.output("arraybuffer")).toString("latin1");
  return {
    // jsPDF escapes parentheses in the text operators: "MD \(Radiodiagnosis …\)".
    text: [...pdf.matchAll(/\(((?:[^()]|\([^)]*\))*)\)\s*Tj/g)]
      .map((m) => m[1].replace(/\\([()])/g, "$1"))
      .join(" | "),
    imageObjects: (pdf.match(/\/Subtype\s*\/Image/g) ?? []).length,
  };
}

function settingsFor(signature: Partial<PrintSettings["signature"]>): PrintSettings {
  return { ...DEFAULT_PRINT_SETTINGS, signature: { ...DEFAULT_PRINT_SETTINGS.signature, ...signature } };
}

describe("letter-pad PDF signature as drawn", () => {
  it("prints the qualification the clinic typed, not the one a name lookup finds", () => {
    // Settings → Doctors is a contains-match on the name; it used to overwrite the
    // configured designation, so the value in Print Settings was never printed.
    const page = drawnOnPage(
      settingsFor({ name: "Dr. Meera Iyer", qualification: "MD Radiodiagnosis" }),
      { doctorsCatalog: [{ name: "Dr. Meera Iyer", degree: "DNB Radio" }] },
    );
    expect(page.text).toContain("Dr. Meera Iyer");
    expect(page.text).toContain("MD Radiodiagnosis");
    expect(page.text).not.toContain("DNB Radio");
  });

  it("still consults the doctors catalogue for a block saved with no qualification", () => {
    const page = drawnOnPage(
      settingsFor({ name: "Dr. Meera Iyer", qualification: "" }),
      { doctorsCatalog: [{ name: "Dr. Meera Iyer", degree: "DNB Radio" }] },
    );
    expect(page.text).toContain("DNB Radio");
  });

  it("keeps the name and designation on paper when no signature image exists", () => {
    // The clinic default carries no image. Nothing is drawn in its place and the
    // person is still identified — no signature is fabricated either way.
    const withoutImage = drawnOnPage(
      settingsFor({ imageDataUrl: null }),
      {},
    );
    expect(withoutImage.text).toContain(DEFAULT_PRINT_SETTINGS.signature.name);
    expect(withoutImage.text).toContain(DEFAULT_PRINT_SETTINGS.signature.qualification);

    const withImage = drawnOnPage(settingsFor({ imageDataUrl: PNG }), {});
    expect(withImage.imageObjects).toBeGreaterThan(withoutImage.imageObjects);
  });
});
