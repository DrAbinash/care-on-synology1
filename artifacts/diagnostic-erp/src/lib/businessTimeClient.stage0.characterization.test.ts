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

/**
 * Strip comment lines. Stage 1A left the removed idioms quoted in comments as a
 * transition record, so a forbidden-idiom scan must look at code only.
 */
const code = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

/** A field being *seeded* from the browser clock is the thing that is forbidden. */
const NAIVE_FIELD_SEED =
  /\b(expenseDate|paymentDate|procedureDate|studyDate|date)\s*[:=]\s*new Date\(\)\.toISOString\(\)\.(slice\(0, ?10\)|split\("T"\)\[0\])/;

/** Reproduce the exact helper the pages define, so the assertion is about behaviour. */
const utcSlice = (d: Date) => d.toISOString().slice(0, 10);
const clinicDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * ── TRANSITION LOG · Stage 1A ───────────────────────────────────────────────
 * Three of the four tests in this block originally CHARACTERIZED the browser
 * clock as the source of a blank form's business date. Stage 1A deliberately
 * changed that behaviour, so per §19 of the Stage-1A brief the assertions were
 * converted rather than deleted: each keeps the BEFORE fact on record and
 * states the contract that replaced it.
 *
 *   BEFORE Stage 1A (characterized, main @ 27dab054, Stage 0 §11 rows 3/7/10):
 *     Expenses.tsx     `const today = new Date().toISOString().slice(0, 10)`
 *                      → expenseDate/paymentDate
 *     Accounting.tsx   `date: new Date().toISOString().split("T")[0]` (×2 sites)
 *     FormF.tsx        `function today() { return new Date().toISOString()… }`
 *                      → procedureDate / date
 *   AFTER Stage 1A (contract):
 *     The same three defaults read the CARE business date supplied by
 *     GET /api/time/now, and are blank — never browser-derived — when that
 *     authority has not answered. See lib/careTime.stage1a.test.ts.
 *
 * The measured consequence below is unchanged on purpose: it documents why the
 * old behaviour was wrong, which is history, not a current defect.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("Stage 0 · U-4 — default business dates: transitioned to server authority in Stage 1A", () => {
  it("AFTER STAGE 1A: a new expense takes expenseDate/paymentDate from the CARE server, not the browser", () => {
    const s = page("Expenses.tsx");
    const start = s.indexOf("function emptyExpenseForm");
    const fn = code(s.slice(start, start + 1600));
    expect(fn).toContain("function emptyExpenseForm(clinicDateIst: string | null): ExpenseForm {");
    expect(fn).toContain('const today = clinicDateIst ?? "";');
    expect(fn).toContain("expenseDate: today");
    expect(fn).toContain("paymentDate: today");
    // BEFORE, this line read `const today = new Date().toISOString().slice(0, 10)`.
    // It must stay gone: the browser clock is not a CARE business-date authority.
    expect(fn).not.toContain("new Date().toISOString().slice(0, 10)");
    // The approver pre-fill from the locally cached session (U-8 below) is
    // untouched: actor attribution is Stage 2/5 work, not Stage 1A.
  });

  it("AFTER STAGE 1A: the GL voucher form takes its date from the CARE server, at both former sites", () => {
    const s = page("Accounting.tsx");
    expect(s).toContain('resetV({ type: t.value, date: getClinicDateIst() ?? "" })');
    expect(s).toContain('defaultValue={getClinicDateIst() ?? ""}');
    // BEFORE: two `new Date().toISOString().split("T")[0]` defaults.
    expect(s).not.toMatch(/date: new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/);
    expect(s).not.toMatch(/defaultValue=\{new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]\}/);
  });

  it("AFTER STAGE 1A: Form F's procedure default is the CARE server date; its statutory blanks stay blank", () => {
    const s = page("FormF.tsx");
    const helper = s.slice(s.indexOf("function today()"), s.indexOf("function today()") + 200);
    expect(helper).toContain("return getClinicDateIst() ?? \"\";");
    // BEFORE: `return new Date().toISOString().slice(0, 10);`
    expect(helper).not.toContain("new Date().toISOString().slice(0, 10)");
    expect(s).toContain("procedureDate: today()");
    expect(s).toContain("date: today()");
    // Unchanged, and deliberately so (§16): consentDate / mtpDate are transcribed
    // from paper and still default to "" — which is why the text-date columns
    // hold "" rather than NULL (audit F-23). Stage 1A did not touch that.
    expect(s).toContain('consentDate: ""');
  });

  it("MEASURED CONSEQUENCE (why the old default was wrong): a UTC slice and the clinic day disagree for 5h30m every day", () => {
    // 03:00 IST on 30-Sep = 21:00 UTC on 29-Sep. Under the pre-Stage-1A default
    // a clinic laptop at that instant pre-filled "2026-09-29" — an accidental
    // backdated record with no malicious intent whatsoever. Kept as a pure
    // function test: it is history of the defect, not a claim about the UI.
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

  /**
   * ── TRANSITION LOG · Stage 1A ────────────────────────────────────────────
   * BEFORE: the client had NO shared date module — every page rolled its own
   * "today", in three mutually inconsistent ways (naive UTC slice, browser-local
   * getFullYear/getMonth, timeZone-pinned en-CA). That ratio was the finding.
   * AFTER: exactly one shared holder exists, `lib/careTime.ts`, which is not
   * allowed to compute a clinic day at all — it only holds what
   * GET /api/time/now said, and it is memory-only so a stale day cannot age
   * into tomorrow.
   * The per-page naive idiom still exists in large numbers, but only as query
   * filters, CSV/download filenames, display formatting and HR/payroll/booking
   * defaults. Those are enumerated and classified in
   * docs/audits/business-time-stage1a-implementation-2026-09-30.md §Q, and are
   * deliberately NOT Stage 1A's job.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it("TRANSITION (Stage 1A): exactly one shared client holder exists, and it computes nothing", () => {
    const holders = readdirSync(resolve(__dirname)).filter(
      (f) => f.endsWith(".ts") && !f.includes(".test.") && /^(careTime|ist[-_]?date|business[-_]?time|clinic[-_]?today|business[-_]?date)\.ts$/i.test(f),
    );
    expect(holders.sort()).toEqual(["careTime.ts"]); // one, and only one
    const s = code(readFileSync(resolve(__dirname, "careTime.ts"), "utf8"));
    expect(s).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/); // it does not name a day
    expect(s).toMatch(/getClinicDateIst\(\): string \| null/); // null is the honest answer
    expect(s).not.toMatch(/localStorage|sessionStorage/); // never persisted
  });

  it("GUARD (Stage 1A): no blank-new-record default takes a business date from the browser clock", () => {
    // The files whose default writes a PERSISTED CARE business date. This list
    // is the contract; adding a new one means the same rule applies to it.
    const authoritativeDefaults = [
      "../pages/Expenses.tsx",
      "../pages/Accounting.tsx",
      "../pages/FormF.tsx",
      "../components/expenses/ExpenseDetailDrawer.tsx",
      "../components/BillReceiptScannerPanel.tsx",
      "../components/radiology/PcpndtFormFFinalizeStep.tsx",
      "../components/radiology/workspace/WorkspaceOverlays.tsx",
      "../components/TumorFollowupPanel.tsx",
    ];
    for (const rel of authoritativeDefaults) {
      const c = code(readFileSync(resolve(__dirname, rel), "utf8"));
      expect(c, rel).not.toMatch(NAIVE_FIELD_SEED);
    }
    // And they are not merely "no longer naive" — each reads the authority,
    // either synchronously (`getClinicDateIst`) or through the subscribing hook
    // (`useClinicDateIst`) when the value seeds a long-lived form state.
    for (const rel of authoritativeDefaults) {
      expect(readFileSync(resolve(__dirname, rel), "utf8"), rel).toMatch(/\b(?:use|get)ClinicDateIst\(/);
    }
  });
});
