import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * STAGE 0 — BUSINESS-TIME CHARACTERIZATION, CLIENT SIDE.
 *
 * Companion to artifacts/api-server/src/lib/businessTime.stage0.characterization.test.ts.
 * This file answers one question only: **where does a date or time that reaches
 * the CARE API actually come from?** It freezes today's behaviour in the React
 * ERP so the later stages can prove they changed something.
 *
 * No test here asserts that the client *should* stop sending dates. That is a
 * Stage-1+ decision (§19 of the Stage-0 brief: do not turn a future requirement
 * into a failing current test). What is frozen is the measurable fact that the
 * workstation clock currently supplies default business dates, and that the
 * workstation timezone is not Asia/Kolkata-safe.
 *
 * Do NOT "fix" a failure in this file by changing application code.
 */

const page = (rel: string) => readFileSync(resolve(__dirname, "../pages", rel), "utf8");
const lib = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

/** Reproduce the exact helper the pages define, so the assertion is about behaviour. */
const utcSlice = (d: Date) => d.toISOString().slice(0, 10);
const clinicDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

describe("Stage 0 · U-4 — the workstation clock supplies default business dates", () => {
  it("CHARACTERIZATION: a new expense defaults expenseDate and paymentDate from the browser, via a UTC slice", () => {
    const s = page("Expenses.tsx");
    const fn = s.slice(s.indexOf("function emptyExpenseForm"), s.indexOf("function emptyExpenseForm") + 900);
    expect(fn).toContain("const today = new Date().toISOString().slice(0, 10)");
    expect(fn).toContain("expenseDate: today");
    expect(fn).toContain("paymentDate: today");
    // The same object also pre-fills the approver name from a locally cached
    // session (see the U-8 test below) — defaults are the path of least
    // resistance, so what they contain is what gets saved.
  });

  it("CHARACTERIZATION: the GL voucher form defaults its date from the browser, twice over", () => {
    const s = page("Accounting.tsx");
    expect(s).toContain('resetV({ type: t.value, date: new Date().toISOString().split("T")[0] })');
    expect(s).toContain('defaultValue={new Date().toISOString().split("T")[0]}');
  });

  it("CHARACTERIZATION: Form F defaults its procedure date from the browser too", () => {
    const s = page("FormF.tsx");
    const helper = s.slice(s.indexOf("function today()"), s.indexOf("function today()") + 90);
    expect(helper).toContain("new Date().toISOString().slice(0, 10)");
    expect(s).toContain("procedureDate: today()");
    expect(s).toContain("date: today()");
    // consentDate / mtpDate default to the empty string, which is why the
    // text-date columns hold "" rather than NULL (audit F-23).
    expect(s).toContain('consentDate: ""');
  });

  it("MEASURED CONSEQUENCE: a UTC slice and the clinic day disagree for 5h30m every day", () => {
    // 03:00 IST on 30-Sep = 21:00 UTC on 29-Sep. A clinic laptop set to any
    // timezone, at that instant, pre-fills "2026-09-29" — an accidental
    // backdated default with no malicious intent whatsoever.
    const instant = new Date("2026-09-29T21:00:00Z");
    expect(clinicDay(instant)).toBe("2026-09-30");
    expect(utcSlice(instant)).toBe("2026-09-29");
    expect(utcSlice(instant)).not.toBe(clinicDay(instant));
  });

  it("MEASURED CONSEQUENCE: browser-local formatting is not the clinic calendar either", () => {
    // Dashboard's own helper builds the string from getFullYear/getMonth/getDate,
    // i.e. the workstation's local calendar, which equals the clinic day only if
    // the workstation is actually set to Asia/Kolkata.
    const s = page("Dashboard.tsx");
    const helper = s.slice(s.indexOf("function todayISO()"), s.indexOf("function todayISO()") + 260);
    expect(helper).toContain("d.getFullYear()");
    expect(helper).toContain("d.getMonth()");
    expect(helper).not.toContain("timeZone");
    // In a Kolkata-configured browser these agree; in a UTC-configured
    // workstation at 03:00 IST they do not. Proven by construction, not assumed.
    const ist = new Date("2026-09-30T03:00:00+05:30");
    expect(ist.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })).toBe("2026-09-30");
    expect(utcSlice(ist)).toBe("2026-09-29");
  });
});

describe("Stage 0 · U-4 — GOOD PATTERNS that must not regress", () => {
  it("DailySummary derives its clinic day with an explicit timeZone, which is the target shape", () => {
    const s = page("DailySummary.tsx");
    expect(s).toContain('new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })');
    expect(s).toMatch(/function offsetIST/);
    // This helper exists in the browser, so it still trusts the workstation
    // *instant*; it only fixes the calendar mapping. That distinction is the
    // whole point of the A–F classification in the Stage-0 report.
  });

  it("The offline billing queue sends no date at all, so the server clock records the entry", () => {
    const q = lib("offlineBillingQueue.ts");
    expect(q).toContain("/api/billing/save");
    // queuedAt is queue bookkeeping; it is deliberately not part of the payload.
    expect(q).not.toMatch(/body:\s*\{[^}]*expenseDate/);
    const desk = page("BillingDesk.tsx");
    expect(desk).toMatch(/clientRef/);
  });
});

describe("Stage 0 · U-8 — the client also supplies actor names", () => {
  it("CHARACTERIZATION: approvedBy is pre-filled from a locally cached staff session, then sent as data", () => {
    const s = page("Expenses.tsx");
    expect(s).toContain("readStaffSession()?.user?.name?.trim()");
    const fn = s.slice(s.indexOf("function emptyExpenseForm"));
    expect(fn).toContain("approvedBy: name");
    const payload = s.slice(s.indexOf("const payload: Record<string, unknown> = {"), s.indexOf("const payload: Record<string, unknown> = {") + 900);
    expect(payload).toContain("approvedBy: form.approvedBy || null");
  });

  it("CHARACTERIZATION: the voucher PATCH dialog sends the actor the operator typed", () => {
    const s = page("Accounting.tsx");
    expect(s).toMatch(/editedBy/);
  });
});

describe("Stage 0 · U-12/U-13 — dates rendered onto clinical and invoice documents", () => {
  it("CHARACTERIZATION: echo/fetal report PDFs are dated by the workstation in a locale-dependent format", () => {
    for (const f of ["EchoCardiology.tsx", "FetalEcho.tsx"]) {
      const s = page(f);
      // `toLocaleDateString()` with no arguments = the browser UI locale. On
      // en-IN/en-US that yields "9/30/2026" or "30/9/2026" on a printed report.
      expect(s).toMatch(/studyDate: new Date\(\)\.toLocaleDateString\(\)/);
    }
    // Rendering, not persistence: this is a document-generation defect, and
    // Stage 0 records it as such rather than as a database integrity issue.
  });

  it("CHARACTERIZATION: Form F prints dates through an explicit en-IN formatter", () => {
    const s = page("FormF.tsx");
    expect(s).toContain('toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })');
  });

  it("CHARACTERIZATION: the expense OCR confirmation timestamp is a browser instant, stored inside metaJson", () => {
    const s = page("Expenses.tsx");
    expect(s).toContain("confirmedAt: new Date().toISOString()");
  });

  it("FORWARD-ONLY GUARD: there is still no shared client IST helper — each page rolls its own", () => {
    const helpers = readdirSync(resolve(__dirname)).filter((f) =>
      /^(ist[-_]?date|business[-_]?time|clinic[-_]?today|business[-_]?date).*\.ts$/i.test(f) && !f.includes(".test."),
    );
    expect(helpers).toEqual([]);
    // Three different local "today" implementations, three different answers:
    const naive = readdirSync(resolve(__dirname, "../pages")).filter((f) => {
      if (!/\.(ts|tsx)$/.test(f)) return false;
      return readFileSync(resolve(__dirname, "../pages", f), "utf8").includes("toISOString().slice(0, 10)");
    });
    const tzPinned = readdirSync(resolve(__dirname, "../pages")).filter((f) => {
      if (!/\.(ts|tsx)$/.test(f)) return false;
      return readFileSync(resolve(__dirname, "../pages", f), "utf8").includes('toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })');
    });
    expect(naive.length).toBeGreaterThan(tzPinned.length);
    // The count is the finding: the correct pattern exists but has not been
    // adopted, and no helper module is shared. Stage 0 documents the ratio,
    // Stage 1+ decides what to do about it.
  });
});
