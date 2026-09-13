import { describe, expect, it } from "vitest";
import {
  breakObservationsAtSentenceEnds,
  interceptDictationRunOns,
  needsObservationBreak,
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
  });

  it("title-cases while keeping short acronyms", () => {
    expect(toClinicalTitleCase("no acute mri abnormality in the brain")).toBe(
      "No Acute MRI Abnormality In The Brain",
    );
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
