import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  CARE_TIME_ENDPOINT,
  getClinicDateIst,
  getCareTime,
  msUntilBusinessDayRollover,
  refreshCareTime,
  resetCareTimeForTests,
  setCareTime,
} from "@/lib/careTime";

/**
 * STAGE 1A — CLIENT-SIDE CARE BUSINESS DATE CONTRACT.
 *
 * The property under test is narrow but load-bearing: a blank new ERP form may
 * only be seeded with the business date the CARE server named, and when the
 * server has not named one the field stays blank. The workstation clock is not
 * permitted in either role.
 *
 * Deterministic by construction: every case feeds an explicit payload or an
 * explicit "now", so nothing here depends on the clock of the machine running
 * the suite (Stage-1A §10).
 */

const DAY = {
  zone: "Asia/Kolkata",
  clinicDateIst: "2026-09-30",
  serverNowIso: "2026-09-29T23:59:00.000Z", // 05:29 IST — still 30-Sep for CARE
  businessDayStartUtcIso: "2026-09-29T18:30:00.000Z",
  businessDayEndUtcIso: "2026-09-30T18:29:59.999Z",
  source: "care-api-node-clock",
};

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const lib = (rel: string) => read(resolve(__dirname, rel));
const page = (rel: string) => read(resolve(__dirname, "../pages", rel));
const component = (rel: string) => read(resolve(__dirname, "../components", rel));

/**
 * Strip comments so a scan for a forbidden idiom is about the *code*, not about
 * the prose explaining why the code no longer uses it. Several Stage 1A
 * comments quote the exact `toISOString().slice(0, 10)` line they removed, and
 * a naive text scan would read that as a violation.
 */
const codeOnly = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

describe("Stage 1A · §18(9)(12) — the server value is the only source of a blank form's date", () => {
  it("starts with no authority at all, which is not the same as 'today'", () => {
    resetCareTimeForTests();
    expect(getCareTime()).toBeNull();
    expect(getClinicDateIst()).toBeNull();
  });

  it("accepts a well-formed server answer and exposes only the clinic date to forms", () => {
    resetCareTimeForTests();
    expect(setCareTime(DAY)).toBe(true); // the clinic date changed
    expect(getClinicDateIst()).toBe("2026-09-30");
    expect(setCareTime(DAY)).toBe(false); // same day → no event storm
  });

  it("refuses to store a malformed or non-authoritative answer", () => {
    resetCareTimeForTests();
    for (const bad of [
      null,
      undefined,
      {},
      { ...DAY, clinicDateIst: undefined },
      { ...DAY, clinicDateIst: "30/09/2026" }, // not the CARE wire format
      { ...DAY, clinicDateIst: "2026-09-30T00:00:00Z" }, // an instant is not a day
      { ...DAY, serverNowIso: undefined },
      "2026-09-30",
    ]) {
      expect(setCareTime(bad), JSON.stringify(bad)).toBe(false);
      expect(getClinicDateIst(), `after ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("never falls back to the browser clock when the request fails", async () => {
    resetCareTimeForTests();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(refreshCareTime({ getImpl: failing })).resolves.toBeNull();
    expect(getClinicDateIst()).toBeNull();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("treats a non-date response body as no answer", async () => {
    resetCareTimeForTests();
    await refreshCareTime({ getImpl: async () => ({}) }); // fetchApi's empty-body shape
    expect(getClinicDateIst()).toBeNull();
  });

  it("hydrates on success, through exactly one request", async () => {
    resetCareTimeForTests();
    const get = vi.fn(async () => ({ ...DAY }));
    await refreshCareTime({ getImpl: get });
    expect(getClinicDateIst()).toBe("2026-09-30");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(CARE_TIME_ENDPOINT);
  });

  it("deduplicates concurrent refreshes so a form-heavy screen cannot fan out", async () => {
    resetCareTimeForTests();
    let calls = 0;
    const get = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return { ...DAY };
    });
    const [a, b, c] = await Promise.all([
      refreshCareTime({ getImpl: get }),
      refreshCareTime({ getImpl: get }),
      refreshCareTime({ getImpl: get }),
    ]);
    expect(calls).toBe(1);
    expect([a?.clinicDateIst, b?.clinicDateIst, c?.clinicDateIst]).toEqual(["2026-09-30", "2026-09-30", "2026-09-30"]);
  });
});

describe("Stage 1A · §10 — rollover scheduling never depends on the workstation being right", () => {
  it("has nothing to schedule before the server answers", () => {
    resetCareTimeForTests();
    expect(msUntilBusinessDayRollover(Date.parse("2026-09-30T00:00:00Z"))).toBeNull();
  });

  it("schedules the single re-fetch just after the CARE business day ends", () => {
    resetCareTimeForTests();
    setCareTime(DAY);
    const now = Date.parse("2026-09-30T10:00:00.000Z");
    // end of the CARE day (18:29:59.999Z) minus now, plus the 2s grace.
    expect(msUntilBusinessDayRollover(now)).toBe(Date.parse(DAY.businessDayEndUtcIso) - now + 2000);
  });

  it("clamps a clock that is ahead of the clinic day rather than spinning", () => {
    resetCareTimeForTests();
    setCareTime(DAY);
    expect(msUntilBusinessDayRollover(Date.parse("2026-10-01T00:00:00.000Z"))).toBe(30_000);
  });

  it("caps a clock that is far behind so a stale day cannot outlive the day", () => {
    resetCareTimeForTests();
    setCareTime(DAY);
    expect(msUntilBusinessDayRollover(Date.parse("2020-01-01T00:00:00.000Z"))).toBe(24 * 60 * 60 * 1000);
  });
});

describe("Stage 1A · §14/§23 — authority boundaries in the client code", () => {
  it("the holder is memory-only: a cached clinic date would silently become yesterday's", () => {
    const s = codeOnly(lib("./careTime.ts"));
    expect(s).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
    expect(lib("./careTime.ts")).toContain("Never persisted to localStorage or any cache");
  });

  it("the clinic day itself is never computed on the client", () => {
    const s = codeOnly(lib("./careTime.ts"));
    expect(s).not.toMatch(/toISOString\(\)\.slice|toLocaleDateString|new Date\(\)\.getDate/);
    // Date.parse is used only to schedule a re-fetch — a timer, not an authority.
    expect(s).toMatch(/Date\.parse\(current\.businessDayEndUtcIso\)/);
  });

  it("the endpoint is never asked to accept a client date", () => {
    const s = codeOnly(lib("./careTime.ts"));
    expect(s).toMatch(/api\.get<unknown>\(path\)/);
    expect(s).not.toMatch(/\bpost\b|\bput\b|\bpatch\b|body:/);
  });

  it("the service worker may not serve an authoritative date from cache", () => {
    const sw = read(resolve(__dirname, "../../public/sw.js"));
    expect(sw).toContain(`"${CARE_TIME_ENDPOINT}"`);
    const start = sw.indexOf("NETWORK_ONLY_PREFIXES");
    const list = sw.slice(start, start + 3600);
    expect(list).toContain(CARE_TIME_ENDPOINT);
  });

  it("the app shell hydrates once, and forms do not fetch", () => {
    const layout = component("Layout.tsx");
    expect(layout).toContain("useCareTime();");
    const hook = codeOnly(lib("../hooks/useCareTime.ts"));
    expect(hook).toMatch(/refreshCareTime\(\)/);
    expect(hook).toMatch(/setTimeout\(\(\) => void hydrate\(\), ms\)/);
    // The rollover timer is the only recurring trigger; the hook must not
    // listen to its own change event (the feature-flag poll storm, restated).
    expect(hook).not.toMatch(/addEventListener\(CARE_TIME_CHANGED[^;]*refresh/i);
  });

  it("no page or component fetches /api/time/now itself", () => {
    const offenders = ["pages/Expenses.tsx", "pages/Accounting.tsx", "pages/FormF.tsx", "components/expenses/ExpenseDetailDrawer.tsx"];
    for (const rel of offenders) {
      expect(codeOnly(read(resolve(__dirname, "..", rel))), rel).not.toMatch(/api\/time\/now/);
    }
  });
});

describe("Stage 1A · §8 — the blank-form defaults that were browser-derived now are not", () => {
  it("Expenses: a new expense seeds both dates from the server value", () => {
    const s = page("Expenses.tsx");
    const start = s.indexOf("function emptyExpenseForm");
    const fn = codeOnly(s.slice(start, start + 1600));
    expect(fn).toContain("function emptyExpenseForm(clinicDateIst: string | null): ExpenseForm {");
    expect(fn).toContain('const today = clinicDateIst ?? "";');
    expect(fn).toContain("expenseDate: today");
    expect(fn).toContain("paymentDate: today");
    expect(fn).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  });

  it("Expenses: a late-arriving server date fills only a still-blank form", () => {
    const s = page("Expenses.tsx");
    expect(s).toMatch(/if \(!showForm \|\| !clinicDateIst\) return;/);
    expect(s).toMatch(/f\.expenseDate \|\| f\.paymentDate \? f : \{ \.\.\.f, expenseDate: clinicDateIst, paymentDate: clinicDateIst \}/);
  });

  it("Expenses: the OCR-derived invoice date still wins over the default", () => {
    // §8 — an explicit value, here read off a scanned bill, must never be
    // overwritten by the trusted default.
    const s = page("Expenses.tsx");
    expect(s).toContain("expenseDate: result.date || prev.expenseDate");
  });

  it("Accounting: a new voucher seeds its GL date from the server value", () => {
    const s = page("Accounting.tsx");
    expect(s).toContain("resetV({ type: t.value, date: getClinicDateIst() ?? \"\" })");
    expect(s).toContain("defaultValue={getClinicDateIst() ?? \"\"}");
    expect(s).not.toMatch(/date: new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/);
    expect(s).not.toMatch(/defaultValue=\{new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]\}/);
  });

  it("Form F: only the default source changed (§16)", () => {
    const s = page("FormF.tsx");
    expect(s).toMatch(/function today\(\) \{\n  return getClinicDateIst\(\) \?\? "";\n\}/);
    expect(s).toContain("procedureDate: today()");
    expect(s).toContain("date: today()");
    // Statutory dates transcribed from paper keep their existing empty defaults.
    expect(s).toContain('consentDate: ""');
    expect(s).toContain('mtpDate: ""');
    // Loaded entries still take their stored values, so no record is re-dated.
    expect(s).toContain('procedureDate: r.procedureDate ?? ""');
    expect(s).toContain('date: r.date ?? ""');
  });

  it("Expense payment drawer: a new payment seeds from the server value", () => {
    const s = component("expenses/ExpenseDetailDrawer.tsx");
    expect(s).toContain("paymentDate: getClinicDateIst() ?? \"\"");
    expect(s).not.toMatch(/paymentDate: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  });

  it("Scanned bill: the bill's own date wins, the CARE date is the fallback, and neither exists means no save", () => {
    const s = codeOnly(component("BillReceiptScannerPanel.tsx"));
    expect(s).toContain("const expenseDate = draft.date || getClinicDateIst();");
    // §15 — with no authority it refuses rather than inventing or posting "".
    expect(s).toMatch(/if \(!expenseDate\) \{/);
    expect(s).toMatch(/setError\("CARE clinic date is unavailable/);
    expect(s).toContain("expenseDate,");
  });

  it("PCPNDT finalize step and workspace prefill: same authority, stored dates still win", () => {
    expect(component("radiology/PcpndtFormFFinalizeStep.tsx")).toContain("return getClinicDateIst() ?? \"\";");
    expect(component("radiology/PcpndtFormFFinalizeStep.tsx")).toContain("prefill.procedureDate || todayIso()");
    expect(component("radiology/workspace/WorkspaceOverlays.tsx")).toContain('procedureDate: getClinicDateIst() ?? "",');
    expect(component("TumorFollowupPanel.tsx")).toContain('studyDate: getClinicDateIst() ?? "",');
  });
});

describe("Stage 1A · §2 — forward-only: nothing that is already stored gets re-dated", () => {
  it("no Stage 1A file writes, updates or deletes a row", () => {
    const touched = [
      lib("./careTime.ts"),
      lib("../hooks/useCareTime.ts"),
      page("Expenses.tsx"),
      page("Accounting.tsx"),
      page("FormF.tsx"),
      component("expenses/ExpenseDetailDrawer.tsx"),
    ];
    for (const s of touched) {
      expect(s).not.toMatch(/UPDATE\s+\w+\s+SET/i);
      expect(s).not.toMatch(/db\.delete|db\.update/);
    }
  });

  it("no historical-date migration appeared", () => {
    const added = readdirSync(resolve(__dirname, "../../../../migrations")).filter((f) =>
      /stage1a|care_time|business_date|backfill.*date|normalize.*date/i.test(f),
    );
    expect(added).toEqual([]);
  });

  it("the trusted default is not a forced value — no date field gained a min/max/reject", () => {
    const s = page("Expenses.tsx") + page("Accounting.tsx") + page("FormF.tsx");
    expect(s).not.toMatch(/<Input type="date"[^>]*\bmin=|<Input type="date"[^>]*\bmax=/);
    expect(s).not.toMatch(/clinicDateIst !==|date !== clinicDateIst/);
  });
});
