import { describe, expect, it } from "vitest";
import {
  breakObservationsAtSentenceEnds,
  interceptDictationRunOns,
  interceptDictationRunOnsWithCaret,
  isClinicalAbbreviationPeriod,
  isDecimalPeriod,
  needsObservationBreak,
  shouldBreakAfterPeriod,
  toClinicalTitleCase,
} from "./dictationObservationBreak";
import {
  appendPersonalTemplate,
  createPersonalTemplate,
  insertTemplateText,
  readPersonalReportTemplates,
  removePersonalTemplate,
  writePersonalReportTemplates,
  PERSONAL_TEMPLATES_STORAGE_KEY,
} from "./personalReportTemplates";

describe("dictationObservationBreak", () => {
  it("splits on period-space into newlines", () => {
    expect(breakObservationsAtSentenceEnds("Lung clear. Heart normal. No effusion.")).toBe(
      "Lung clear.\nHeart normal.\nNo effusion.",
    );
  });

  it("does not stack extra newlines when already broken", () => {
    expect(breakObservationsAtSentenceEnds("Lung clear.\nHeart normal.")).toBe(
      "Lung clear.\nHeart normal.",
    );
  });

  it("intercepts live run-ons", () => {
    expect(interceptDictationRunOns("A. B. C")).toBe("A.\nB.\nC");
  });

  it("detects when a break is needed", () => {
    expect(needsObservationBreak("A.", "A. B")).toBe(true);
    expect(needsObservationBreak("A.\n", "A.\nB")).toBe(false);
    expect(needsObservationBreak("Seen by Dr.", "Seen by Dr. Smith")).toBe(false);
  });

  it("title-cases while keeping short acronyms", () => {
    expect(toClinicalTitleCase("no acute mri abnormality in the brain")).toBe(
      "No Acute MRI Abnormality In The Brain",
    );
  });

  it("does not break after clinical abbreviations", () => {
    expect(breakObservationsAtSentenceEnds("Seen by Dr. Smith today.")).toBe(
      "Seen by Dr. Smith today.",
    );
    expect(breakObservationsAtSentenceEnds("Measures approx. 2 cm today.")).toBe(
      "Measures approx. 2 cm today.",
    );
    expect(breakObservationsAtSentenceEnds("Compare with Fig. 2 and Ref. 3.")).toBe(
      "Compare with Fig. 2 and Ref. 3.",
    );
    expect(breakObservationsAtSentenceEnds("Findings vs. prior. New nodule.")).toBe(
      "Findings vs. prior.\nNew nodule.",
    );
    expect(breakObservationsAtSentenceEnds("Pt. is stable. Rt. apex clear.")).toBe(
      "Pt. is stable.\nRt. apex clear.",
    );
  });

  it("does not break inside or after decimal numbers", () => {
    expect(breakObservationsAtSentenceEnds("Lesion measures 1.5 cm in size.")).toBe(
      "Lesion measures 1.5 cm in size.",
    );
    expect(breakObservationsAtSentenceEnds("AP diameter 0.9 mm at L4.")).toBe(
      "AP diameter 0.9 mm at L4.",
    );
    expect(breakObservationsAtSentenceEnds("Density is 3.2 HU. No bleed.")).toBe(
      "Density is 3.2 HU.\nNo bleed.",
    );
  });

  it("still breaks real observation boundaries around guarded tokens", () => {
    expect(
      breakObservationsAtSentenceEnds(
        "Seen by Dr. Rao. Lungs are clear. Heart size is normal.",
      ),
    ).toBe("Seen by Dr. Rao.\nLungs are clear.\nHeart size is normal.");
  });

  it("exposes helpers for abbreviation and decimal detection", () => {
    const sample = "Dr. Smith measured 1.5 cm.";
    expect(isClinicalAbbreviationPeriod(sample, sample.indexOf("."))).toBe(true);
    expect(isDecimalPeriod("1.5 cm", 1)).toBe(true);
    expect(shouldBreakAfterPeriod("Clear. Next", 5)).toBe(true);
    expect(shouldBreakAfterPeriod("Dr. Next", 2)).toBe(false);
  });

  it("remaps caret when live intercept inserts newlines", () => {
    const raw = "Clear. Next";
    // Caret after the space following the period (index 7).
    const { text, caret } = interceptDictationRunOnsWithCaret(raw, 7);
    expect(text).toBe("Clear.\nNext");
    expect(caret).toBe(7);
    // Abbreviation path keeps length-stable ". ".
    const kept = interceptDictationRunOnsWithCaret("Dr. Smith", 4);
    expect(kept.text).toBe("Dr. Smith");
    expect(kept.caret).toBe(4);
  });
});

describe("personalReportTemplates", () => {
  it("seeds defaults when storage is empty", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    const seeded = readPersonalReportTemplates(storage);
    expect(seeded.some((t) => t.name === "Normal Chest XR")).toBe(true);
    expect(seeded.some((t) => t.name === "CT Brain Normal")).toBe(true);
  });

  it("persists physician-saved templates", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    const created = createPersonalTemplate({
      name: "My Normal",
      text: "Unremarkable study.",
      target: "impression",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    writePersonalReportTemplates(storage, [created]);
    expect(mem.get(PERSONAL_TEMPLATES_STORAGE_KEY)).toContain("My Normal");
    const roundTrip = readPersonalReportTemplates(storage);
    expect(roundTrip).toHaveLength(1);
    expect(roundTrip[0]?.name).toBe("My Normal");
  });

  it("appends, removes, and inserts text", () => {
    const a = createPersonalTemplate({ name: "A", text: "aaa", target: "findings" });
    const b = createPersonalTemplate({ name: "B", text: "bbb", target: "findings" });
    const list = appendPersonalTemplate([a], b);
    expect(list[0]?.id).toBe(b.id);
    expect(removePersonalTemplate(list, b.id)).toEqual([a]);
    expect(insertTemplateText("", "Hello")).toBe("Hello");
    expect(insertTemplateText("Prior.", "Hello")).toBe("Prior.\n\nHello");
  });
});
