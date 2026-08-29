import { describe, expect, test, afterEach, vi } from "vitest";
import {
  GLOBAL_BILL_PRINT_DEFAULTS,
  CURSOR_BILL_PRINT_LAYOUT,
  BILL_FORMATS,
  applyCursorBillPrintLayout,
  applyManualBillPaperOverride,
  clearBillPrintSettingsOverride,
  loadBillPrintSettings,
  normalizeBillFormat,
  paperSizeForBillFormat,
  parseGlobalBillPrintSettings,
  printLayoutOpts,
  resolveBillLogoHeightPx,
  resolveBillPrintCopyCount,
  resolveBillPrintDelivery,
  resolveBillPrintPageOpts,
  getPaperSizeCss,
  saveBillPrintSettings,
} from "./billPrintSettings";

function stubWindow(opts: { userId?: string; role?: string; localData?: Record<string, string> } = {}) {
  const store = new Map<string, string>(Object.entries(opts.localData ?? {}));
  if (opts.userId) {
    store.set("erp_session", JSON.stringify({ user: { id: opts.userId, role: opts.role ?? "admin", name: "Test User" } }));
  }
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseGlobalBillPrintSettings — server blob can never break printing", () => {
  test("valid JSON object parses through", () => {
    expect(parseGlobalBillPrintSettings(JSON.stringify({ defaultPaperSize: "A4", printMarginMm: 2 })))
      .toEqual({ defaultPaperSize: "A4", printMarginMm: 2 });
  });

  test("null/undefined/empty degrade to {}", () => {
    expect(parseGlobalBillPrintSettings(null)).toEqual({});
    expect(parseGlobalBillPrintSettings(undefined)).toEqual({});
    expect(parseGlobalBillPrintSettings("")).toEqual({});
  });

  test("malformed JSON degrades to {}", () => {
    expect(parseGlobalBillPrintSettings("{not json")).toEqual({});
  });

  test("non-object JSON (array, number, string) degrades to {}", () => {
    expect(parseGlobalBillPrintSettings("[1,2]")).toEqual({});
    expect(parseGlobalBillPrintSettings("42")).toEqual({});
    expect(parseGlobalBillPrintSettings("\"A4\"")).toEqual({});
  });
});

describe("BILL_FORMATS — settings UI options", () => {
  test("includes classic, classic-portrait, hope-a5, a5-landscape, care-sage, and care-sage-sleeping", () => {
    expect(BILL_FORMATS.map((f) => f.id)).toEqual([
      "classic",
      "classic-portrait",
      "hope-a5",
      "a5-landscape",
      "care-sage",
      "care-sage-sleeping",
    ]);
    const a5Landscape = BILL_FORMATS.find((f) => f.id === "a5-landscape");
    expect(a5Landscape?.label).toBe("A5 Landscape");
    expect(a5Landscape?.hint).toContain("A5 landscape");
    expect(a5Landscape?.hint).toContain("210×148 mm");
    const sage = BILL_FORMATS.find((f) => f.id === "care-sage");
    expect(sage?.label).toBe("CARE Sage");
    expect(sage?.hint).toContain("A5 landscape");
    expect(sage?.hint).toContain("210×148 mm");
    const classicPortrait = BILL_FORMATS.find((f) => f.id === "classic-portrait");
    expect(classicPortrait?.label).toBe("CARE Invoice (A5 Portrait)");
    expect(classicPortrait?.hint).toContain("148×210 mm");
    const sleeping = BILL_FORMATS.find((f) => f.id === "care-sage-sleeping");
    expect(sleeping?.label).toBe("CARE Sage Sleeping");
    expect(sleeping?.hint).toContain("A5 portrait");
    expect(sleeping?.hint).toContain("148×210 mm");
  });
});

describe("normalizeBillFormat + paperSizeForBillFormat", () => {
  test("hope-a5 stays hope-a5; a5-landscape stays a5-landscape; classic-portrait stays; everything else maps to classic", () => {
    expect(normalizeBillFormat("a5-landscape")).toBe("a5-landscape");
    expect(normalizeBillFormat("care-sage")).toBe("care-sage");
    expect(normalizeBillFormat("care-sage-sleeping")).toBe("care-sage-sleeping");
    expect(normalizeBillFormat("hope-a5")).toBe("hope-a5");
    expect(normalizeBillFormat("classic")).toBe("classic");
    expect(normalizeBillFormat("classic-portrait")).toBe("classic-portrait");
    expect(normalizeBillFormat("modern-landscape")).toBe("classic");
    expect(normalizeBillFormat("designer-a")).toBe("classic");
    expect(normalizeBillFormat(undefined)).toBe("classic");
  });

  test("paper follows format", () => {
    expect(paperSizeForBillFormat("classic")).toBe("A5-landscape");
    expect(paperSizeForBillFormat("a5-landscape")).toBe("A5-landscape");
    expect(paperSizeForBillFormat("care-sage")).toBe("A5-landscape");
    expect(paperSizeForBillFormat("hope-a5")).toBe("A5-portrait");
    expect(paperSizeForBillFormat("classic-portrait")).toBe("A5-portrait");
    expect(paperSizeForBillFormat("care-sage-sleeping")).toBe("A5-portrait");
  });
});

describe("loadBillPrintSettings — format + paper merge", () => {
  test("defaults are CARE Invoice (classic) on half A4 landscape", () => {
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultFormat).toBe("classic");
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultPaperSize).toBe("A5-landscape");
    expect(CURSOR_BILL_PRINT_LAYOUT.autoA4Threshold).toBe(8);
    const merged = loadBillPrintSettings();
    expect(merged.defaultFormat).toBe("classic");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });

  test("a5-landscape format forces A5-landscape paper", () => {
    const merged = loadBillPrintSettings({ defaultFormat: "a5-landscape", defaultPaperSize: "A4" });
    expect(merged.defaultFormat).toBe("a5-landscape");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });

  test("hope-a5 format forces A5-portrait paper", () => {
    const merged = loadBillPrintSettings({ defaultFormat: "hope-a5", defaultPaperSize: "A4" });
    expect(merged.defaultFormat).toBe("hope-a5");
    expect(merged.defaultPaperSize).toBe("A5-portrait");
  });

  test("classic-portrait format forces A5-portrait paper", () => {
    const merged = loadBillPrintSettings({ defaultFormat: "classic-portrait", defaultPaperSize: "A4" });
    expect(merged.defaultFormat).toBe("classic-portrait");
    expect(merged.defaultPaperSize).toBe("A5-portrait");
  });

  test("care-sage-sleeping format forces A5-portrait paper", () => {
    const merged = loadBillPrintSettings({ defaultFormat: "care-sage-sleeping", defaultPaperSize: "A4" });
    expect(merged.defaultFormat).toBe("care-sage-sleeping");
    expect(merged.defaultPaperSize).toBe("A5-portrait");
  });

  test("without a server global, built-in defaults apply unchanged", () => {
    const merged = loadBillPrintSettings();
    expect(merged.defaultFormat).toBe("classic");
    expect(merged.showTatOnBill).toBe(false);
  });

  test("per-user local format override applies when admin lock is off", () => {
    const userId = "7";
    stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultFormat: "hope-a5", printMarginMm: 12 }),
      },
    });
    const merged = loadBillPrintSettings({ defaultFormat: "classic", adminLock: false });
    expect(merged.defaultFormat).toBe("hope-a5");
    expect(merged.defaultPaperSize).toBe("A5-portrait");
    expect(merged.printMarginMm).toBe(12);
  });

  test("adminLock ON uses clinic format, not a local override", () => {
    const userId = "7";
    stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultFormat: "hope-a5", printMarginMm: 3 }),
      },
    });
    const merged = loadBillPrintSettings({ defaultFormat: "classic", adminLock: true, printMarginMm: 3 });
    expect(merged.defaultFormat).toBe("classic");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
    expect(merged.printMarginMm).toBe(3);
  });

  test("adminLock ON clears stale localStorage overrides on load", () => {
    const userId = "7";
    const store = stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultFormat: "hope-a5" }),
      },
    });
    loadBillPrintSettings({ defaultFormat: "classic", adminLock: true });
    expect(store.has(`diagnosticErp:billPrintSettings:${userId}`)).toBe(false);
  });

  test("adminLock ON ignores role defaults so every counter matches", () => {
    stubWindow({ userId: "9", role: "accounts" });
    const merged = loadBillPrintSettings({
      defaultFormat: "hope-a5",
      defaultPrintAction: "save-print",
      adminLock: true,
    });
    expect(merged.defaultPrintAction).toBe("save-print");
    expect(merged.defaultFormat).toBe("hope-a5");
    expect(merged.defaultPaperSize).toBe("A5-portrait");
  });

  test("saveBillPrintSettings is a no-op when admin lock is on", () => {
    const userId = "7";
    const store = stubWindow({ userId });
    saveBillPrintSettings({ defaultFormat: "hope-a5" }, { adminLock: true });
    expect(store.has(`diagnosticErp:billPrintSettings:${userId}`)).toBe(false);
  });

  test("clearBillPrintSettingsOverride removes only this user's key", () => {
    const userId = "7";
    const store = stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultFormat: "hope-a5" }),
      },
    });
    clearBillPrintSettingsOverride(userId);
    expect(store.has(`diagnosticErp:billPrintSettings:${userId}`)).toBe(false);
  });

  test("layout & typography from the server blob still apply", () => {
    const merged = loadBillPrintSettings({
      printMarginMm: 2,
      printTitleFontPx: 22,
      printLogoHeightPx: 72,
      defaultFormat: "classic",
    });
    expect(merged.defaultPaperSize).toBe("A5-landscape");
    expect(merged.printMarginMm).toBe(2);
    expect(merged.printTitleFontPx).toBe(22);
    expect(merged.printLogoHeightPx).toBe(72);
    expect(printLayoutOpts(merged).printLogoHeightPx).toBe(72);
  });

  test("resolveBillLogoHeightPx uses format default when unset and clamps range", () => {
    expect(resolveBillLogoHeightPx(null, 44)).toBe(44);
    expect(resolveBillLogoHeightPx(undefined, 100)).toBe(100);
    expect(resolveBillLogoHeightPx(72, 44)).toBe(72);
    expect(resolveBillLogoHeightPx(10, 44)).toBe(24);
    expect(resolveBillLogoHeightPx(200, 44)).toBe(160);
  });

  test("retired premium/designer/modern formats normalize to classic", () => {
    expect(normalizeBillFormat("premium-a5")).toBe("classic");
    expect(normalizeBillFormat("designer-a")).toBe("classic");
    expect(normalizeBillFormat("designer-b")).toBe("classic");
    expect(normalizeBillFormat("designer-c")).toBe("classic");
    expect(normalizeBillFormat("classic")).toBe("classic");
    expect(normalizeBillFormat("modern-landscape")).toBe("classic");
    expect(loadBillPrintSettings({ defaultFormat: "designer-a" as any }).defaultFormat).toBe("classic");
  });

  test("role defaults still apply underneath the global (fields the global doesn't set)", () => {
    stubWindow({ userId: "9", role: "accounts" });
    const merged = loadBillPrintSettings({ defaultFormat: "classic" });
    expect(merged.defaultPrintAction).toBe("save-preview");
    expect(merged.defaultFormat).toBe("classic");
  });
});

describe("resolveBillPrintDelivery", () => {
  const base = {
    enablePreview: false,
    directPrintAfterSave: true,
    autoOpenPrintDialog: true,
  };

  test("explicit Save & Print always reaches the printer", () => {
    expect(resolveBillPrintDelivery({ ...base, enablePreview: true }, "save-print")).toBe(
      "preview-and-print",
    );
    expect(resolveBillPrintDelivery({ ...base, enablePreview: false }, "save-print")).toBe("print");
  });

  test("enablePreview without explicit save-print shows preview only", () => {
    expect(resolveBillPrintDelivery({ ...base, enablePreview: true }, "background")).toBe(
      "preview-only",
    );
  });

  test("save-only skips delivery", () => {
    expect(resolveBillPrintDelivery(base, "save-only")).toBe("skip");
  });

  test("background with printing disabled and no preview skips", () => {
    expect(
      resolveBillPrintDelivery(
        { enablePreview: false, directPrintAfterSave: false, autoOpenPrintDialog: false },
        "background",
      ),
    ).toBe("skip");
  });
});

describe("resolveBillPrintCopyCount — physical copies", () => {
  test("Billing Print both copies yields 2 even if the legacy column is 1", () => {
    expect(resolveBillPrintCopyCount({ billPrintCopies: 1 }, { defaultCopyType: "both" })).toBe(2);
  });

  test("office copy is always 1 sheet", () => {
    expect(resolveBillPrintCopyCount({ billPrintCopies: 2 }, { defaultCopyType: "office" })).toBe(1);
  });

  test("legacy bill_print_copies=2 still prints 2 when JSON is patient or unset", () => {
    expect(resolveBillPrintCopyCount({ billPrintCopies: 2 }, { defaultCopyType: "patient" })).toBe(2);
    expect(resolveBillPrintCopyCount({ billPrintCopies: 2 }, {})).toBe(2);
    expect(resolveBillPrintCopyCount({ billPrintCopies: 1 }, { defaultCopyType: "patient" })).toBe(1);
  });
});

describe("resolveBillPrintPageOpts — format-driven paper", () => {
  test("a5-landscape short bills use A5 landscape @page", () => {
    const opts = resolveBillPrintPageOpts({ defaultFormat: "a5-landscape" }, 1);
    expect(opts.paperSize).toBe("A5");
    expect(opts.orientation).toBe("landscape");
    expect(opts.pageCssSize).toBe("A5 landscape");
    expect(opts.compactFooterGap).toBe(false);
  });

  test("classic short bills use A5 landscape @page", () => {
    const opts = resolveBillPrintPageOpts({ defaultFormat: "classic" }, 1);
    expect(opts.paperSize).toBe("A5");
    expect(opts.orientation).toBe("landscape");
    expect(opts.pageCssSize).toBe("A5 landscape");
    expect(opts.compactFooterGap).toBe(false);
  });

  test("hope-a5 short bills use A5 portrait @page", () => {
    const opts = resolveBillPrintPageOpts({ defaultFormat: "hope-a5" }, 3);
    expect(opts.pageCssSize).toBe("A5 portrait");
    expect(opts.orientation).toBe("portrait");
  });

  test("classic-portrait short bills use A5 portrait @page", () => {
    const opts = resolveBillPrintPageOpts({ defaultFormat: "classic-portrait" }, 1);
    expect(opts.paperSize).toBe("A5");
    expect(opts.orientation).toBe("portrait");
    expect(opts.pageCssSize).toBe("A5 portrait");
    expect(opts.compactFooterGap).toBe(false);
  });

  test("care-sage-sleeping short bills use A5 portrait @page", () => {
    const opts = resolveBillPrintPageOpts({ defaultFormat: "care-sage-sleeping" }, 3);
    expect(opts.paperSize).toBe("A5");
    expect(opts.orientation).toBe("portrait");
    expect(opts.pageCssSize).toBe("A5 portrait");
    expect(opts.compactFooterGap).toBe(false);
  });

  test("long bills (≥ Cursor autoA4Threshold) switch to A4 for any format", () => {
    for (const format of ["classic", "classic-portrait", "hope-a5", "a5-landscape", "care-sage", "care-sage-sleeping"] as const) {
      const opts = resolveBillPrintPageOpts({ defaultFormat: format }, 12);
      expect(opts.paperSize).toBe("A4");
      expect(opts.pageCssSize).toBe("A4 portrait");
    }
  });
});

describe("getPaperSizeCss — named ISO sizes for Chrome print dialog", () => {
  test("A5 landscape and half-a4 emit named A5 landscape, not 210mm 148mm", () => {
    expect(getPaperSizeCss("A5-landscape").pageSize).toBe("A5 landscape");
    expect(getPaperSizeCss("half-a4").pageSize).toBe("A5 landscape");
    expect(getPaperSizeCss("A5-landscape").width).toBe("210mm");
    expect(getPaperSizeCss("A5-landscape").minHeight).toBe("148mm");
  });

  test("A5 portrait emits named A5 portrait, not 148mm 210mm", () => {
    expect(getPaperSizeCss("A5-portrait").pageSize).toBe("A5 portrait");
    expect(getPaperSizeCss("A5-portrait").width).toBe("148mm");
    expect(getPaperSizeCss("A5-portrait").minHeight).toBe("210mm");
  });

  test("A4 emits named A4 portrait", () => {
    expect(getPaperSizeCss("A4").pageSize).toBe("A4 portrait");
  });
});

describe("applyManualBillPaperOverride — paper follows format", () => {
  test("manual A4 / A5 are ignored; format owns paper", () => {
    expect(applyManualBillPaperOverride({ defaultFormat: "classic" }, "A4").defaultPaperSize)
      .toBe("A5-landscape");
    expect(applyManualBillPaperOverride({ defaultFormat: "a5-landscape" }, "A4").defaultPaperSize)
      .toBe("A5-landscape");
    expect(applyManualBillPaperOverride({ defaultFormat: "hope-a5" }, "A4").defaultPaperSize)
      .toBe("A5-portrait");
    expect(applyManualBillPaperOverride({ defaultFormat: "classic-portrait" }, "A4").defaultPaperSize)
      .toBe("A5-portrait");
    expect(applyManualBillPaperOverride({ defaultFormat: "care-sage-sleeping" }, "A4").defaultPaperSize)
      .toBe("A5-portrait");
  });

  test("applyCursorBillPrintLayout syncs paper to format and keeps margin/copy settings", () => {
    const classic = applyCursorBillPrintLayout({ defaultFormat: "classic" as const, printMarginMm: 12, defaultCopyType: "both" as const });
    expect(classic.defaultPaperSize).toBe("A5-landscape");
    expect(classic.printMarginMm).toBe(12);
    expect(classic.defaultCopyType).toBe("both");
    const a5Landscape = applyCursorBillPrintLayout({ defaultFormat: "a5-landscape" as const, printMarginMm: 12 });
    expect(a5Landscape.defaultPaperSize).toBe("A5-landscape");
    const hope = applyCursorBillPrintLayout({ defaultFormat: "hope-a5" as const, printMarginMm: 12 });
    expect(hope.defaultPaperSize).toBe("A5-portrait");
    const classicPortrait = applyCursorBillPrintLayout({ defaultFormat: "classic-portrait" as const, printMarginMm: 12 });
    expect(classicPortrait.defaultPaperSize).toBe("A5-portrait");
  });
});
