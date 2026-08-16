import { describe, expect, test, afterEach, vi } from "vitest";
import {
  GLOBAL_BILL_PRINT_DEFAULTS,
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
  test("REGRESSION: server global paper size overrides the built-in A5-landscape default", () => {
    // No window at all (worst case: nothing cached locally) — the admin's
    // A4 choice must still win over the built-in default that caused the
    // rotated prints.
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultPaperSize).toBe("A5-landscape");
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultFormat).toBe("classic");
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4" });
    expect(merged.defaultPaperSize).toBe("A4");
  });

  test("without a server global, built-in defaults apply unchanged", () => {
    const merged = loadBillPrintSettings();
    expect(merged.defaultPaperSize).toBe(GLOBAL_BILL_PRINT_DEFAULTS.defaultPaperSize);
    expect(merged.defaultFormat).toBe("classic");
    expect(merged.showTatOnBill).toBe(false);
  });

  test("per-user local override wins over the global when adminLock is OFF", () => {
    const userId = "7";
    stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultPaperSize: "A5-landscape" }),
      },
    });
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4", adminLock: false });
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });

  test("adminLock ON forces the clinic-wide global over any local override", () => {
    const userId = "7";
    stubWindow({
      userId,
      localData: {
        [`diagnosticErp:billPrintSettings:${userId}`]: JSON.stringify({ defaultPaperSize: "A5-landscape", printMarginMm: 3 }),
      },
    });
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4", adminLock: true });
    expect(merged.defaultPaperSize).toBe("A4");
    expect(merged.printMarginMm).toBeNull();
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
    expect(merged.defaultPaperSize).toBe("A4");
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

  test("layout & typography overrides flow through from the server global", () => {
    const merged = loadBillPrintSettings({ printMarginMm: 2, printTitleFontPx: 22, printLogoHeightPx: 72 });
    expect(merged.printMarginMm).toBe(2);
    expect(merged.printTitleFontPx).toBe(22);
    expect(merged.printLogoHeightPx).toBe(72);
    expect(merged.printBodyFontPx).toBeNull();
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
    expect(merged.defaultPaperSize).toBe("A4");
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
  test("billPrintCopies column wins when set to 2", () => {
    expect(resolveBillPrintCopyCount({ billPrintCopies: 2 }, { defaultCopyType: "patient" })).toBe(2);
  });

  test("defaultCopyType both yields 2 when DB column is still 1", () => {
    expect(resolveBillPrintCopyCount({ billPrintCopies: 1 }, { defaultCopyType: "both" })).toBe(2);
  });

  test("patient or office copy type alone yields 1", () => {
    expect(resolveBillPrintCopyCount({ billPrintCopies: 1 }, { defaultCopyType: "patient" })).toBe(1);
    expect(resolveBillPrintCopyCount({ billPrintCopies: 1 }, { defaultCopyType: "office" })).toBe(1);
  });
});

describe("resolveBillPrintPageOpts — paper size reaches the print HTML", () => {
  test("legacy modern-landscape + A5-portrait migrates to landscape @page", () => {
    const settings = loadBillPrintSettings({
      defaultFormat: "modern-landscape" as any,
      defaultPaperSize: "A5-portrait",
    });
    const opts = resolveBillPrintPageOpts(settings, 1);
    expect(opts.orientation).toBe("landscape");
    expect(opts.pageCssSize).toBe("210mm 297mm");
  });
  test("A5-landscape setting yields landscape @page and compact footer for short bills", () => {
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "A5-landscape", autoA4Threshold: 5 }, 1);
    expect(opts.paperSize).toBe("A5");
    expect(opts.orientation).toBe("landscape");
    expect(opts.pageCssSize).toBe("210mm 297mm");
    expect(opts.compactFooterGap).toBe(true);
  });

  test("A5-portrait setting is not dropped by auto-threshold logic", () => {
    const opts = resolveBillPrintPageOpts(
      { defaultPaperSize: "A5-portrait", autoA4Threshold: 5 },
      1,
    );
    expect(opts.orientation).toBe("portrait");
    expect(opts.pageCssSize).toBe("A5 portrait");
  });

  test("half-a4 is the same 210×148 sheet as A5, printed on an A4 portrait tray", () => {
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "half-a4", autoA4Threshold: 5 }, 1);
    expect(opts.pageCssSize).toBe("210mm 297mm");
    expect(opts.orientation).toBe("landscape");
    expect(opts.paperSize).toBe("A5");
  });

  test("A4 short bills use compact footer so content is not half-blank", () => {
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "A4", autoA4Threshold: 8 }, 3);
    expect(opts.paperSize).toBe("A4");
    expect(opts.compactFooterGap).toBe(true);
  });

  test("A4 long bills keep full footer spacing", () => {
    const opts = resolveBillPrintPageOpts({ defaultPaperSize: "A4", autoA4Threshold: 8 }, 12);
    expect(opts.compactFooterGap).toBe(false);
  });
});

describe("applyManualBillPaperOverride — Bill Detail reprint paper toggle", () => {
  test("manual A4 forces A4 regardless of clinic A5-landscape", () => {
    const merged = applyManualBillPaperOverride({ defaultPaperSize: "A5-landscape", adminLock: false }, "A4");
    expect(merged.defaultPaperSize).toBe("A4");
    const opts = resolveBillPrintPageOpts({ ...merged, autoA4Threshold: 5 }, 1);
    expect(opts.pageCssSize).toBe("A4 portrait");
  });

  test("manual A5 keeps clinic landscape orientation", () => {
    const merged = applyManualBillPaperOverride({ defaultPaperSize: "A5-landscape", adminLock: false }, "A5");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
    const opts = resolveBillPrintPageOpts({ ...merged, autoA4Threshold: 5 }, 1);
    expect(opts.pageCssSize).toBe("210mm 297mm");
    expect(opts.compactFooterGap).toBe(true);
  });

  test("null manual paper leaves clinic setting unchanged", () => {
    expect(applyManualBillPaperOverride({ defaultPaperSize: "A5-landscape", adminLock: false }, null))
      .toEqual({ defaultPaperSize: "A5-landscape" });
  });

  test("adminLock ignores manual paper so every counter matches clinic setting", () => {
    const merged = applyManualBillPaperOverride({ defaultPaperSize: "A5-landscape", adminLock: true }, "A4");
    expect(merged.defaultPaperSize).toBe("A5-landscape");
  });
});
