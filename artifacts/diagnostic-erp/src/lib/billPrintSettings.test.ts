import { describe, expect, test, afterEach, vi } from "vitest";
import {
  GLOBAL_BILL_PRINT_DEFAULTS,
  loadBillPrintSettings,
  parseGlobalBillPrintSettings,
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
  test("REGRESSION: server global paper size overrides the built-in A5-portrait default", () => {
    // No window at all (worst case: nothing cached locally) — the admin's
    // A4 choice must still win over the built-in default that caused the
    // rotated prints.
    expect(GLOBAL_BILL_PRINT_DEFAULTS.defaultPaperSize).toBe("A5-portrait");
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4" });
    expect(merged.defaultPaperSize).toBe("A4");
  });

  test("without a server global, built-in defaults apply unchanged", () => {
    const merged = loadBillPrintSettings();
    expect(merged.defaultPaperSize).toBe(GLOBAL_BILL_PRINT_DEFAULTS.defaultPaperSize);
    expect(merged.defaultFormat).toBe("classic");
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

  test("layout & typography overrides flow through from the server global", () => {
    const merged = loadBillPrintSettings({ printMarginMm: 2, printTitleFontPx: 22 });
    expect(merged.printMarginMm).toBe(2);
    expect(merged.printTitleFontPx).toBe(22);
    expect(merged.printBodyFontPx).toBeNull();
  });

  test("role defaults still apply underneath the global (fields the global doesn't set)", () => {
    stubWindow({ userId: "9", role: "accounts" });
    const merged = loadBillPrintSettings({ defaultPaperSize: "A4" });
    // accounts role default — untouched by the global
    expect(merged.defaultPrintAction).toBe("save-preview");
    expect(merged.defaultPaperSize).toBe("A4");
  });
});
