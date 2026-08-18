import { describe, expect, it } from "vitest";
import {
  activeStandardLetterhead,
  DEFAULT_CARE_LETTERPAD,
  parseMeasurementMm,
  parseMeasurementPt,
  resolveCareLetterpadChrome,
} from "./careLetterpadChrome";

describe("careLetterpadChrome", () => {
  it("defaults match the printed CARE pad", () => {
    expect(DEFAULT_CARE_LETTERPAD.email).toBe("care.deoghar@gmail.com");
    expect(DEFAULT_CARE_LETTERPAD.website).toBe("www.caredeoghar.com");
    expect(DEFAULT_CARE_LETTERPAD.addressLine1).toContain("Castair's Town");
    expect(parseMeasurementMm("22mm")).toBe(22);
    expect(parseMeasurementPt("7.2pt")).toBe(7.2);
  });

  it("resolveCareLetterpadChrome overlays template fields on the pad defaults", () => {
    const chrome = resolveCareLetterpadChrome({ email: "desk@caredeoghar.com", website: "www.example-clinic.in" });
    expect(chrome.email).toBe("desk@caredeoghar.com");
    expect(chrome.website).toBe("www.example-clinic.in");
    expect(chrome.phones).toBe(DEFAULT_CARE_LETTERPAD.phones);
  });

  it("activeStandardLetterhead uses the latest published version", () => {
    expect(activeStandardLetterhead({
      active: { standard: "care-classic" },
      templates: [
        { templateKey: "care-classic", isLatest: false, definition: { letterhead: { email: "old@x.com" } } },
        { templateKey: "care-classic", isLatest: true, definition: { letterhead: { email: "new@x.com" } } },
        { templateKey: "hope", isLatest: true, definition: { letterhead: { email: "hope@x.com" } } },
      ],
    })?.email).toBe("new@x.com");
  });
});
