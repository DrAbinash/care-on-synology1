import { describe, expect, test, afterEach, vi } from "vitest";
import {
  GLOBAL_BILL_PRINT_DEFAULTS,
  CURSOR_BILL_PRINT_LAYOUT,
  applyCursorBillPrintLayout,
  applyManualBillPaperOverride,
  clearBillPrintSettingsOverride,
  loadBillPrintSettings,
  normalizeBillFormat,
  parseGlobalBillPrintSettings,
  printLayoutOpts,
  resolveBillLogoHeightPx,
  resolveBillPrintCopyCount,
  resolveBillPrintDelivery,
  resolveBillPrintPageOpts,
  saveBillPrintSettings,
} from "./billPrintSettings";

// Regression coverage for the rotated-bill-print incident: bill print
// settings were per-browser localStorage only, so the paper size the admin
// configured (and verified in the Settings live preview) never reached the
// billing counters — a counter still on the built-in A5-portrait default
// sent A5 jobs to an A4-loaded tray, which the printer driver rotated 90°.
// These tests pin the merge semantics that fix that: server global (from
// clinic_settings.bill_print_settings_json) overrides built-in defaults at
// every print call site, and adminLock makes the global win over any
// per-user local override.

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

describe("loadBillPrintSettings — clinic-wide global reaches the print sites", () => {
  test("Cursor-default paper wins over any saved A4 / A5-portrait blob", () => {
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultPaperSize).toBe("A5-landscape");
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultFormat).toBe("classic");
    expect(CURSOR_BILL_PRINT_LAYOUT.defaultPaperSize).toBe("A5-landscape");
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4" });
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });

  test("without a server global, built-in defaults apply unchanged", () => {
    const merged = loadBillPrintSettings();
    expect(merged.defaultPaperSize).toBe(CURSOR_BILL_PRINT_LAYOUT.defaultPaperSize);
    expect(merged.defaultFormat).toBe("classic");
    expect(merged.showTatOnBill).toBe(false);
  });

  test("per-user local paper override cannot beat Cursor-default", () => {
    const userId = "7";
    stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultPaperSize: "A4", printMarginMm: 12 }),
      },
    });
    const merged = loadBillPrintSettings({ defaultPaperSize: "A5-portrait", adminLock: false });
    expect(merged.defaultPaperSize).toBe("A5-landscape");
    expect(merged.printMarginMm).toBe(12);
  });

  test("adminLock ON still uses Cursor-default paper, not a saved A4 blob", () => {
    const userId = "7";
    stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultPaperSize: "A5-landscape", printMarginMm: 3 }),
      },
    });
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4", adminLock: true, printMarginMm: 3 });
    expect(merged.defaultPaperSize).toBe("A5-landscape");
    expect(merged.printMarginMm).toBe(3);
  });

  test("adminLock ON clears stale localStorage overrides on load", () => {
    const userId = "7";
    const store = stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultPaperSize: "A5-landscape" }),
      },
    });
    loadBillPrintSettings({ defaultPaperSize: "A4", adminLock: true });
    expect(store.has(`diagnosticErp:billPrintSettings:${userId}`)).toBe(false);
  });

  test("adminLock ON ignores role defaults so every counter matches", () => {
    stubWindow({ userId: "9", role: "accounts" });
    const merged = loadBillPrintSettings({
      defaultPaperSize: "A4",
      defaultPrintAction: "save-print",
      adminLock: true,
    });
    expect(merged.defaultPrintAction).toBe("save-print");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });

  test("saveBillPrintSettings is a no-op when admin lock is on", () => {
    const userId = "7";
    const store = stubWindow({ userId });
    saveBillPrintSettings({ defaultPaperSize: "A5-landscape" }, { adminLock: true });
    expect(store.has(`diagnosticErp:billPrintSettings:${userId}`)).toBe(false);
  });

  test("clearBillPrintSettingsOverride removes only this user's key", () => {
    const userId = "7";
    const store = stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultPaperSize: "half-a4" }),
      },
    });
    clearBillPrintSettingsOverride(userId);
    expect(store.has(`diagnosticErp:billPrintSettings:${userId}`)).toBe(false);
  });

  test("layout & typography from the server blob still apply; only paper is Cursor-forced", () => {
    const merged = loadBillPrintSettings({ printMarginMm: 2, printTitleFontPx: 22, printLogoHeightPx: 72, defaultPaperSize: "A4" });
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

  test("legacy modern-landscape + A5-portrait migrates paper to A5-landscape on load", () => {
    const merged = loadBillPrintSettings({
      defaultFormat: "modern-landscape" as any,
      defaultPaperSize: "A5-portrait",
    });
    expect(merged.defaultFormat).toBe("classic");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });

  test("role defaults still apply underneath the global (fields the global doesn't set)", () => {
    stubWindow({ userId: "9", role: "accounts" });
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4" });
    // accounts role default — untouched by the global
    expect(merged.defaultPrintAction).toBe("save-preview");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
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

describe("resolveBillPrintPageOpts — Cursor-default paper", () => {
  test("short bills always use pre-cut half A4 @page (210×148)", () => {
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "A5-portrait", autoA4Threshold: 5 }, 1);
    expect(opts.paperSize).toBe("A5");
    expect(opts.orientation).toBe("landscape");
    expect(opts.pageCssSize).toBe("210mm 148mm");
    expect(opts.compactFooterGap).toBe(false);
  });

  test("saved A4 / half-a4 / landscape blobs cannot change short-bill paper", () => {
    for (const size of ["A4", "half-a4", "A5-landscape", "A5-portrait"] as const) {
      const opts = resolveBillPrintPageOpts({ defaultPaperSize: size, autoA4Threshold: 1 }, 3);
      expect(opts.pageCssSize).toBe("210mm 148mm");
      expect(opts.orientation).toBe("landscape");
    }
  });

  test("long bills (≥ Cursor autoA4Threshold) switch to A4", () => {
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "A5-landscape" }, 12);
    expect(opts.paperSize).toBe("A4");
    expect(opts.pageCssSize).toBe("A4 portrait");
    expect(opts.compactFooterGap).toBe(false);
  });
});

describe("applyManualBillPaperOverride — ignored; Cursor-default owns paper", () => {
  test("manual A4 / A5 / null all resolve to Cursor-default half A4", () => {
    expect(applyManualBillPaperOverride({ defaultPaperSize: "A4", adminLock: false }, "A4").defaultPaperSize)
      .toBe("A5-landscape");
    expect(applyManualBillPaperOverride({ defaultPaperSize: "A4", adminLock: false }, "A5").defaultPaperSize)
      .toBe("A5-landscape");
    expect(applyManualBillPaperOverride({ defaultPaperSize: "A4", adminLock: true }, "A4").defaultPaperSize)
      .toBe("A5-landscape");
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "A4" }, 1);
    expect(opts.pageCssSize).toBe("210mm 148mm");
  });

  test("applyCursorBillPrintLayout forces paper only — keeps margin/copy settings", () => {
    const applied = applyCursorBillPrintLayout({ defaultPaperSize: "A4" as const, printMarginMm: 12, defaultCopyType: "both" as const });
    expect(applied.defaultPaperSize).toBe("A5-landscape");
    expect(applied.printMarginMm).toBe(12);
    expect(applied.defaultCopyType).toBe("both");
  });
});
