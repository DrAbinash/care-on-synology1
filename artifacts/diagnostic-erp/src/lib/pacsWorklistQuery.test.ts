import { describe, expect, it } from "vitest";
import {
  buildPacsWorklistUrl,
  readingQueueShouldSearchOrthanc,
  shouldIncludeOrthanc,
} from "./pacsWorklistQuery";

describe("buildPacsWorklistUrl", () => {
  it("includes date and orthanc params", () => {
    const url = buildPacsWorklistUrl({
      dateFrom: "2026-08-20",
      dateTo: "2026-08-20",
      search: "KARISHM",
      orthanc: true,
    });
    expect(url).toContain("dateFrom=2026-08-20");
    expect(url).toContain("orthanc=1");
    expect(url).toContain("search=KARISHM");
  });

  it("omits orthanc when false", () => {
    const url = buildPacsWorklistUrl({
      dateFrom: "2026-09-05",
      dateTo: "2026-09-05",
      orthanc: false,
    });
    expect(url).not.toContain("orthanc=");
  });
});

describe("shouldIncludeOrthanc", () => {
  it("enables for back-date or search when toggled on", () => {
    expect(shouldIncludeOrthanc({ enabled: true, dateFrom: "2026-08-01" })).toBe(true);
    expect(shouldIncludeOrthanc({ enabled: true, search: "pat" })).toBe(true);
    expect(shouldIncludeOrthanc({ enabled: false, dateFrom: "2026-08-01" })).toBe(false);
  });

  it("stays off when toggled on but no date/search", () => {
    expect(shouldIncludeOrthanc({ enabled: true })).toBe(false);
  });

  it("an IMPLICIT default window does not attach Orthanc (few-clicks re-audit pass 3)", () => {
    // The worklist's few-clicks default is the last two IST days. That
    // window is the session's implicit state, not an act of browsing back
    // dates — attaching the Orthanc C-FIND to it put a PACS round-trip on
    // every default load and every 30 s poll, where the pre-default view
    // (no dates, no search) never attached it. Same doctrine as the
    // Reading Queue: Today / Yesterday / Today+Yesterday browse Postgres
    // only. Only a window the user actually chose is a back-date browse.
    expect(
      shouldIncludeOrthanc({
        enabled: true,
        dateFrom: "2026-10-24",
        dateTo: "2026-10-25",
        windowExplicit: false,
      }),
    ).toBe(false);
  });

  it("an EXPLICIT window still attaches Orthanc (back-date browse unchanged)", () => {
    expect(
      shouldIncludeOrthanc({
        enabled: true,
        dateFrom: "2026-08-01",
        windowExplicit: true,
      }),
    ).toBe(true);
    // Omitted flag keeps the legacy meaning: a window implies a browse.
    expect(shouldIncludeOrthanc({ enabled: true, dateFrom: "2026-08-01" })).toBe(true);
  });

  it("search still attaches Orthanc even under an implicit window", () => {
    expect(
      shouldIncludeOrthanc({
        enabled: true,
        dateFrom: "2026-10-24",
        dateTo: "2026-10-25",
        search: "SHARMA",
        windowExplicit: false,
      }),
    ).toBe(true);
  });
});

describe("readingQueueShouldSearchOrthanc", () => {
  it("keeps Orthanc off for routine date presets", () => {
    expect(readingQueueShouldSearchOrthanc({ datePreset: "today" })).toBe(false);
    expect(readingQueueShouldSearchOrthanc({ datePreset: "yesterday" })).toBe(false);
    expect(readingQueueShouldSearchOrthanc({ datePreset: "today-yesterday" })).toBe(false);
    expect(readingQueueShouldSearchOrthanc({ datePreset: "all" })).toBe(false);
  });

  it("enables Orthanc only for patient/accession search", () => {
    expect(
      readingQueueShouldSearchOrthanc({ datePreset: "today-yesterday", search: "SHARMA" }),
    ).toBe(true);
    expect(readingQueueShouldSearchOrthanc({ datePreset: "all", search: "  " })).toBe(false);
  });
});
