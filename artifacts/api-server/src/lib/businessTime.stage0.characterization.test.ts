import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { CreateExpenseBody, UpdateExpenseBody } from "@workspace/api-zod";
import { billsTable, paymentsTable } from "@workspace/db/schema";
import { expensesTable, expensePaymentsTable } from "@workspace/db/schema";
import { vouchersTable, voucherAuditsTable } from "@workspace/db/schema";
import { patientReportsTable } from "@workspace/db/schema";
import { studyTatMetricsTable } from "@workspace/db/schema";
import { echoValveAssessmentTable } from "@workspace/db/schema";
import { clinicDateOf, istHourMinute, todayIST } from "./istDate";
import {
  clinicDateAuthority,
  resolveCreateBusinessDate,
  resolveUpdateBusinessDate,
} from "./careBusinessDatePolicy";

/**
 * STAGE 0 — BUSINESS-TIME CHARACTERIZATION.
 *
 * Every test here asserts **what CARE does today**, not what it should do.
 * Several tests deliberately prove undesirable behaviour (a malformed GL date
 * is accepted, an audit actor comes from the request body, a UTC slice returns
 * yesterday). That is the point: Stage 0 freezes the current contract so that
 * the later remediation stages change something provable, and so that no stage
 * can quietly redefine history.
 *
 * Companion documents:
 *   docs/audits/business-time-timezone-integrity-audit-2026-09-30.md
 *   docs/audits/business-time-integrity-remediation-plan-2026-09-30.md
 *
 * Forward-only scope (§0 of the plan) also constrains these tests: nothing here
 * inspects, classifies or ranks historical rows, and nothing here mutates data.
 * These are pure functions, request-schema objects, Drizzle table metadata and
 * source text. No database connection is opened by this file.
 *
 * Do NOT "fix" a failure in this file by changing application code. If a test
 * here turns red, the application changed its behaviour and that change has to
 * be reviewed on its own merits.
 */

const src = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

/** A wall-clock instant expressed as an ISO string, independent of this host. */
const at = (iso: string) => new Date(iso);

type Col = { columnType?: string; hasDefault?: boolean; notNull?: boolean };
const col = (table: object, name: string): Col | undefined =>
  (getTableColumns(table as never) as Record<string, Col>)[name];
const colNames = (table: object) => Object.keys(getTableColumns(table as never));

describe("Stage 0 · U-10 — CARE business-day derivation at the IST/UTC boundary", () => {
  // 2026-09-29 18:30Z is 2026-09-30 00:00 IST: the clinic's new day has begun,
  // and every UTC-derived "today" in the product is still one day behind.
  const boundaries: Array<{ label: string; iso: string; istDay: string }> = [
    { label: "23:59 IST (29-Sep)", iso: "2026-09-29T18:29:00Z", istDay: "2026-09-29" },
    { label: "00:00 IST (30-Sep)", iso: "2026-09-29T18:30:00Z", istDay: "2026-09-30" },
    { label: "00:01 IST (30-Sep)", iso: "2026-09-29T18:31:00Z", istDay: "2026-09-30" },
    { label: "05:29 IST (30-Sep)", iso: "2026-09-29T23:59:00Z", istDay: "2026-09-30" },
    { label: "05:30 IST (30-Sep)", iso: "2026-09-30T00:00:00Z", istDay: "2026-09-30" },
  ];

  it("todayIST() names the correct clinic day across the whole boundary window", () => {
    for (const b of boundaries) {
      expect(todayIST(at(b.iso)), b.label).toBe(b.istDay);
    }
  });

  it("CHARACTERIZATION: toISOString().slice(0,10) — the idiom used across the product — returns the PREVIOUS clinic day from 00:00 to 05:29 IST", () => {
    const utcSlice = (iso: string) => at(iso).toISOString().slice(0, 10);
    // Proves the defect is in the idiom, not in a missing TZ pin: this holds
    // whether or not process.env.TZ is Asia/Kolkata, because toISOString() is
    // always UTC.
    expect(utcSlice("2026-09-29T18:30:00Z")).toBe("2026-09-29"); // clinic: 30-Sep
    expect(utcSlice("2026-09-29T23:59:00Z")).toBe("2026-09-29"); // clinic: 05:29 IST 30-Sep
    expect(utcSlice("2026-09-30T00:00:00Z")).toBe("2026-09-30"); // clinic: 05:30 IST, agrees again
    for (const b of boundaries) {
      const sliced = utcSlice(b.iso);
      if (sliced !== b.istDay) expect(sliced, b.label).toBe("2026-09-29");
      else expect(b.label, b.label).toMatch(/05:30|23:59/);
    }
  });

  it("todayIST() is independent of the process timezone (so a lost TZ pin does not move the clinic day)", () => {
    const iso = "2026-09-29T18:30:00Z";
    const before = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = todayIST(at(iso));
      process.env.TZ = "America/New_York";
      const ny = todayIST(at(iso));
      process.env.TZ = "Asia/Kolkata";
      const ist = todayIST(at(iso));
      expect(new Set([utc, ny, ist])).toEqual(new Set(["2026-09-30"]));
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it("istHourMinute() reports clinic clock hour/minute, including midnight as 00 not 24", () => {
    expect(istHourMinute(at("2026-09-29T18:30:00Z"))).toEqual({ hour: 0, minute: 0 });
    expect(istHourMinute(at("2026-09-30T04:00:00+05:30"))).toEqual({ hour: 4, minute: 0 });
    expect(istHourMinute(at("2026-09-29T18:29:00Z"))).toEqual({ hour: 23, minute: 59 });
  });

  /**
   * ── TRANSITION LOG · Stage 1A ────────────────────────────────────────────
   * BEFORE Stage 0/1A: `nowIST()` round-tripped an `en-CA` locale string
   * through `new Date(...)` and returned Invalid Date; it had zero callers, so
   * Stage 0 characterized it as broken-and-dead rather than repairing it.
   * AFTER Stage 1A: it is deleted, not repaired. "The current instant in IST"
   * is a category error — an instant has no timezone — and the primitive people
   * actually need is `clinicDateOf(instant)` plus `clinicDayBoundsIST(instant)`.
   * Leaving a plausible-looking wrong helper in `lib/` would invite it back.
   * ──────────────────────────────────────────────────────────────────────────
   */
  it("TRANSITION (Stage 1A): the broken `nowIST()` helper is gone, replaced by explicit primitives", () => {
    const source = src("./istDate.ts");
    // BEFORE: `export function nowIST(): Date { … toLocaleString( … replace(",", "T")`
    expect(source).not.toContain("export function nowIST");
    expect(source).not.toContain('replace(",", "T")');
    expect(source).toContain("was removed in Stage 1A"); // the reason stays in the file
    // AFTER: the two primitives Stage 1A actually exposes.
    expect(source).toContain("export function clinicDateOf(");
    expect(source).toContain("export function clinicDayBoundsIST(");
    // And the replacement answers correctly where the old helper returned garbage.
    expect(clinicDateOf(at("2026-09-29T18:30:00Z"))).toBe("2026-09-30");    expect(istHourMinute(at("2026-09-29T18:30:00Z"))).toEqual({ hour: 0, minute: 0 });
  });
});

describe("Stage 0 · U-4/U-5 — request-schema characterization (no DB touched)", () => {
  const base = { category: "utilities", description: "x", amount: 1 };

  it("TRANSITION (PR 2): expenseDate is still a bare string at the schema — the control moved to the business-date guard", () => {
    // BEFORE (Stage 0, 2026-09-30): "not-a-date", "1900-01-01", "2035-01-01",
    // "2026-02-31", "30/09/2026" and "" parsed, and nothing downstream stopped
    // them reaching the row. AFTER: the schema fact is unchanged — zod is not
    // where the control lives — but every one of those values is now refused by
    // `resolveCreateBusinessDate`, and an empty value becomes the trusted CARE
    // clinic date instead of an empty business date.
    const authority = clinicDateAuthority(at("2026-09-30T10:00:00+05:30"));
    for (const expenseDate of ["not-a-date", "1900-01-01", "2035-01-01", "2026-02-31", "30/09/2026", ""]) {
      const parsed = CreateExpenseBody.safeParse({ ...base, expenseDate });
      expect(parsed.success, `expenseDate=${JSON.stringify(expenseDate)}`).toBe(true);
      const decision = resolveCreateBusinessDate({
        table: "expenses",
        column: "expense_date",
        submitted: expenseDate,
        authority,
      });
      if (expenseDate === "") {
        expect(decision.ok).toBe(true);
        if (decision.ok) expect(decision.businessDate).toBe("2026-09-30");
      } else {
        expect(decision.ok, `guard must refuse ${JSON.stringify(expenseDate)}`).toBe(false);
      }
    }
  });

  it("CHARACTERIZATION: the approved-by name is free text on the same schema", () => {
    const parsed = CreateExpenseBody.safeParse({ ...base, expenseDate: "2026-09-29", approvedBy: "whoever-i-say" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.approvedBy).toBe("whoever-i-say");
  });

  it("TRANSITION (PR 2): an update body still accepts any date — and the route now refuses to act on it", () => {
    // BEFORE: "an update body may move an expense to any date, and carries no
    // reason field at all", and `PATCH /expenses/:id` wrote it whenever the
    // expense had no linked voucher. AFTER: the schema is untouched (it is a
    // wire contract, not a policy), but `expense_date` is removed from the
    // writable set and any differing value is rejected.
    const keys = Object.keys((UpdateExpenseBody as unknown as { shape: Record<string, unknown> }).shape);
    expect(keys).toContain("expenseDate");
    expect(keys).not.toContain("reason");
    expect(UpdateExpenseBody.safeParse({ expenseDate: "1900-01-01" }).success).toBe(true);

    const authority = clinicDateAuthority(at("2026-09-30T10:00:00+05:30"));
    for (const submitted of ["1900-01-01", "2026-09-29", "2026-09-30", "2026-10-01"]) {
      expect(
        resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: "2026-08-14", submitted, authority }).ok,
        `re-dating to ${submitted} must be refused`,
      ).toBe(false);
    }
    // Forward-only: the row's own date is a no-op, not a violation.
    expect(
      resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: "2026-08-14", submitted: "2026-08-14", authority }).ok,
    ).toBe(true);

    const route = src("../routes/expenses.ts");
    expect(route).toContain("delete updates.expenseDate;");
    expect(route).not.toMatch(/if \(date !== undefined && date !== existing\.date\)\s*\{\s*updates\.date/);
  });
});

describe("Stage 0 · U-1/U-7 — persisted time authority from Drizzle metadata (no DB touched)", () => {
  it("business dates are untyped text columns with no database default (so the DB cannot enforce a calendar)", () => {
    for (const [table, name] of [
      [expensesTable, "expenseDate"],
      [expensePaymentsTable, "paymentDate"],
      [vouchersTable, "date"],
      [billsTable, "dueDate"],
    ] as const) {
      const c = col(table, name);
      expect(c, name).toBeTruthy();
      expect(c!.columnType, `${name} is a text column, not a date`).toBe("PgText");
      expect(c!.hasDefault, `${name} has no DB default`).toBe(false);
    }
  });

  it("money/audit recorded instants ARE DB-defaulted (Postgres now()), which is why the audit calls them trustworthy", () => {
    for (const [table, name] of [
      [billsTable, "createdAt"],
      [paymentsTable, "createdAt"],
      [expensesTable, "createdAt"],
      [vouchersTable, "createdAt"],
      [voucherAuditsTable, "createdAt"],
      [echoValveAssessmentTable, "createdAt"],
      [studyTatMetricsTable, "createdAt"],
    ] as const) {
      const c = col(table, name);
      expect(c!.columnType, name).toBe("PgTimestamp");
      expect(c!.hasDefault, `${name} defaults server-side`).toBe(true);
    }
  });

  it("CHARACTERIZATION: bills.updated_at is rewritten by the Node clock, not the database clock", () => {
    const schema = src("../../../../lib/db/src/schema/bills.ts");
    const line = schema.split("\n").find((l) => l.includes("updatedAt: timestamp")) ?? "";
    expect(line).toContain("defaultNow()"); // DB clock available
    expect(line).toContain("$onUpdate(() => new Date())"); // but Node clock wins on every write
    // Two clocks therefore live in one row: created_at is Postgres now(),
    // updated_at is the API container's clock. Stage 0 measures both.
  });

  it("payments has exactly one time column — the instant-only design that D-5 keeps in place", () => {
    const timeCols = Object.entries(getTableColumns(paymentsTable as never) as Record<string, Col>)
      .filter(([, c]) => c.columnType === "PgTimestamp")
      .map(([n]) => n);
    expect(timeCols).toEqual(["createdAt"]);
  });

  it("TAT/SLA instants are nullable timestamps with no default: whatever the caller sends is what is stored", () => {
    for (const name of ["receivedAt", "reportStartedAt", "reportVerifiedAt", "reportFinalizedAt"] as const) {
      const c = col(studyTatMetricsTable, name);
      expect(c, name).toBeTruthy();
      expect(c!.columnType, name).toBe("PgTimestamp");
      expect(c!.hasDefault, `${name} has no DB default`).toBe(false);
      expect(c!.notNull, `${name} is nullable`).toBe(false);
    }
  });

  it("FORWARD-ONLY GUARD: none of the remediation's new columns exist yet", () => {
    const tables = [expensesTable, vouchersTable, billsTable, paymentsTable, expensePaymentsTable];
    for (const t of tables) {
      const names = colNames(t);
      expect(names).not.toContain("effectiveDate");
      expect(names).not.toContain("effective_date");
      expect(names).not.toContain("effectiveDateSource");
      expect(names).not.toContain("backdated");
    }
  });
});

describe("Stage 0 · U-8 — actor authority characterization (source contracts)", () => {
  it("auditFromRequest derives only IP and UA; every actor value is chosen by the call site", () => {
    const s = src("./audit.ts");
    const fn = s.slice(s.indexOf("export async function auditFromRequest"));
    expect(fn).toContain("x-forwarded-for");
    expect(fn).toContain("user-agent");
    expect(fn).not.toMatch(/staffSession|subjectId|session\./);
  });

  it("TRANSITION (PR 2): the GL voucher PATCH still has no request schema — but date and actor are no longer caller-supplied truth", () => {
    // BEFORE: "the GL voucher PATCH has no request schema and takes both date
    // and actor from the body." AFTER: still schema-less (that debt is recorded
    // and unrepaired), while the posting date is judged against the stored row
    // and the editor is read from the authenticated session.
    const s = src("../routes/accounting.ts");
    const patch = s.slice(s.indexOf('router.patch("/vouchers/:id"'));
    const body = patch.slice(0, patch.indexOf("if (!reason"));
    expect(body).toContain("req.body");
    expect(body).not.toMatch(/safeParse|\.parse\(/);
    expect(patch).toContain("resolveUpdateBusinessDate");
    expect(patch.slice(0, 2000)).not.toMatch(/updates\.date\s*=/);
    expect(patch).toContain('const session = (req as StaffAuthRequest).staffSession;');
    expect(patch).toContain("editedBy: actorName");
    // `editedBy` is destructured off the body nowhere in this handler any more.
    expect(patch.slice(0, patch.indexOf("const [updated]"))).not.toMatch(/const \{[^}]*\beditedBy\b/);
  });

  it("CHARACTERIZATION: a bill discount-override audit row prefers the body's editedBy over the session", () => {
    const s = src("../routes/bills.ts");
    const i = s.indexOf("const actor = (req.body?.editedBy as string | undefined)");
    expect(i).toBeGreaterThan(-1);
    expect(s.slice(i, i + 240)).toContain("session?.subjectName"); // fallback, not source
    expect(s.slice(i, i + 900)).toContain('changeType: "discount_override_warning"');
  });

  it("CHARACTERIZATION: some audit_logs writers hard-code an anonymous actor", () => {
    const s = src("../routes/accounting.ts");
    expect(s).toMatch(/userName:\s*"staff"/);
    expect(s).toMatch(/userId:\s*null/);
  });

  it("CHARACTERIZATION: the clinical worklist audit actor is body-supplied with a \"system\" fallback", () => {
    const s = src("../routes/internal-radiology.ts");
    expect(s).toContain('actor: b.actor ?? "system"');
    expect(s).toContain('actor: b.actor ?? "mwl-agent"');
  });

  it("CHARACTERIZATION: a critical-result acknowledgement names whoever the body says and writes no audit row", () => {
    const s = src("../routes/patient-reports.ts");
    const ack = s.slice(s.indexOf("acknowledge-critical"));
    expect(ack).toContain('b.acknowledgedBy === "string"');
    expect(ack).toContain("criticalAcknowledgedAt: new Date()"); // instant trusted, actor not
    expect(ack.slice(0, 1200)).not.toMatch(/auditFromRequest|auditLifecycleEvent/);
  });

  it("GOOD PATTERN (must not regress): the structured finalize path ignores a client-supplied createdBy", () => {
    const s = src("../routes/patient-reports.ts");
    expect(s).toMatch(/client [`']?createdBy[`']? ignored|session\.subjectName/);
  });

  it("CHARACTERIZATION: staff/payroll writes carry no audit row and no persisted actor anywhere in the router", () => {
    const s = src("../routes/staff.ts");
    expect(s).toMatch(/^router\.delete\("\/advances\/:advanceId"/m);
    expect(s).toMatch(/^router\.delete\("\/salary\/:paymentId"/m);
    expect(s).not.toMatch(/audit/i);
  });
});

describe("Stage 0 · U-4/U-12 — client-supplied instants reaching timestamp columns", () => {
  it("CHARACTERIZATION: the Reporting Studio finalize path takes signedAt and the signer name from the body, behind a shared studio key", () => {
    const s = src("../routes/internal-reporting-studio.ts");
    expect(s).toContain("router.use(requireStudioKey)");
    const fin = s.slice(s.indexOf('router.post("/finalize"'));
    expect(fin).toContain("b.finalizedAt");
    expect(fin).toContain("signedAt: finalizedAt");
    expect(fin).toContain("signedByName: radiologistName");
    expect(fin).toMatch(/radiologistName[\s\S]{0,120}b\.radiologistName/);
  });

  it("CHARACTERIZATION: TAT/SLA accepts client instants and derives the breach verdict from them", () => {
    const s = src("../routes/smartRadiology.ts");
    const tat = s.slice(s.indexOf('router.post("/tat-metrics/:studyId"'));
    expect(tat).toContain("receivedAt: z.string().optional()");
    expect(tat).toContain("b.receivedAt ? new Date(b.receivedAt) : new Date()");
    expect(tat).toContain("const slaBreached = totalTat !== null && totalTat > threshold");
    expect(tat.slice(0, 3000)).not.toMatch(/auditFromRequest|audit\(/);
  });

  it("CHARACTERIZATION: echo/Doppler/learning routes spread raw bodies, so any client key can reach a stored instant", () => {
    const echo = src("../routes/echoCardiology.ts");
    expect(echo).toContain(".values({ studyId, ...b })");
    expect(echo).toContain(".set({ ...b, updatedAt: new Date() })");
    const doppler = src("../routes/usgDoppler.ts");
    expect(doppler).toMatch(/\.\.\.b/);
    const smart = src("../routes/smartRadiology.ts");
    expect(smart).toContain(".set({ ...req.body, updatedAt: new Date() })");
  });

  it("GOOD PATTERN (must not regress): dicom_studies parses its body, so unknown keys such as createdAt are stripped", () => {
    const s = src("../routes/dicomStudyManager.ts");
    expect(s).toMatch(/safeParse|\.parse\(/);
    expect(s).not.toContain("values({ ...req.body");
  });

  it("CHARACTERIZATION: equipment breakdown time may come from the body too", () => {
    const s = src("../routes/machines.ts");
    expect(s).toMatch(/reportedAt[\s\S]{0,80}new Date\(/);
  });
});

describe("Stage 0 · U-11 — day-close is annotation, not a boundary", () => {
  it("closureBoundary says in code that it does not block", () => {
    const s = src("./closureBoundary.ts");
    expect(s.toLowerCase()).toMatch(/inform(ation|al)/);
    expect(s).not.toMatch(/throw|res\.status\(403\)|res\.status\(409\)/);
  });

  it("CHARACTERIZATION: a post-close edit appends text to an audit reason and still returns success", () => {
    const s = src("../routes/bills.ts");
    expect(s).toContain("[post-close edit:");
    expect(s).toMatch(/closedPeriodWarning:\s*null/);
  });

  it("CHARACTERIZATION: the declared post_close_override drawer action has no writer", () => {
    const decl = src("../../../../lib/db/src/schema/drawerAuditLog.ts");
    expect(decl).toContain("post_close_override");
    const writers = ["../routes/day-close.ts", "../routes/bills.ts", "../routes/expenses.ts"];
    for (const f of writers) expect(src(f)).not.toContain('action: "post_close_override"');
  });

  it("CHARACTERIZATION: a closed day is a timestamp window, not a date — two clocks meet inside it", () => {
    const s = src("../routes/day-close.ts");
    const window = s.slice(s.indexOf("coveredFromTs"));
    expect(window).toMatch(/gt\((\w+\.)?createdAt/); // Postgres now() …
    expect(window).toMatch(/lte\(/); // … bounded by Node new Date()
    expect(s).toMatch(/const to = new Date\(/);
    // closureDate is a derived IST *label*, and the read path re-derives "today"
    // with a different helper than the write path used.
    expect(s).toMatch(/closureDate/);
    expect(s).toMatch(/todayIST\(\)/);
  });

  it("CHARACTERIZATION: closing is not blocked by the boundary; only reopening is gated", () => {
    const s = src("../routes/day-close.ts");
    expect(s).toMatch(/requireOwnerOrAdmin/);
    expect(s).toMatch(/requireSuperAdminStaff/);
    // Reopen preserves history instead of deleting it (forward-only friendly).
    expect(s).toMatch(/do NOT delete the row/i);
  });

  it("GOOD PATTERN: reopening a closed day is super-admin-only and requires a reason", () => {
    const s = src("../routes/day-close.ts");
    expect(s).toMatch(/requireSuperAdminStaff/);
    expect(s).toMatch(/min\(3\)/);
    expect(s).toMatch(/reopenedAt/);
  });
});

describe("Stage 0 · U-3/U-6/U-9 — non-browser writers of date, and two notions of 'today' inside one file", () => {
  it("CHARACTERIZATION: cron.ts derives 'today' two different ways, which disagree for 5h30m every day", () => {
    const s = src("../cron.ts");
    // Correct: the clinic day via todayIST().
    expect(s).toMatch(/const dateStr = todayIST\(now\)/);
    expect(s).toMatch(/T00:00:00\+05:30/);
    // Also present: a UTC calendar key from the same `now`.
    expect(s).toMatch(/toISOString\(\)\.split\("T"\)\[0\]/);
    // The divergence is the measured fact: at 03:00 IST todayIST() is 30-Sep
    // while the UTC key is still 29-Sep. Stage 0 records both, fixes neither.
    expect(todayIST(at("2026-09-30T00:00:00+05:30"))).toBe("2026-09-30");
    expect(at("2026-09-30T00:00:00+05:30").toISOString().split("T")[0]).toBe("2026-09-29");
  });

  it("GOOD PATTERN: auto-voucher writes server-derived IST dates, never client dates", () => {
    const s = src("../lib/auto-voucher.ts");
    expect(s).toMatch(/function istDateStr\(\)/);
    expect(s).toMatch(/date: istDateStr\(\)/);
    expect(s).not.toMatch(/date: *req\.body/);
  });

  it("CHARACTERIZATION: the DICOM pull agent supplies studyDate (body or raw DICOM tag); only the format is coerced", () => {
    const s = src("../routes/internal-radiology.ts");
    const line = s.split("\n").find((l) => l.includes("const studyDate = typeof b.studyDate"));
    expect(line).toContain("b.studyDate");
    expect(line).toContain("b.StudyDate"); // raw DICOM attribute accepted
    expect(s).toContain("/^\\d{8}$/"); // YYYYMMDD → YYYY-MM-DD
    // A format fix is not a trust check: the machine's own calendar value is the
    // one persisted, and Stage 0 records that as class D/E depending on column.
  });

  it("CHARACTERIZATION: audit-log retention archives, then DELETES rows — so the hash chain cannot be continuous forever", () => {
    const s = src("../cron.ts");
    expect(s).toMatch(/RETENTION_DAYS = 730/);
    const retention = s.slice(s.indexOf("audit_archive_"));
    expect(retention).toContain(".json.gz");
    expect(retention).toContain("createHash(\"sha256\")");
    expect(retention).toMatch(/db\.delete\(auditLogsTable\)/);
    // Archive-before-purge is a GOOD pattern (G2); deletion itself is what
    // removes previousHash links, which is why verifyAuditChain must be scoped
    // to retained segments. Documented in Stage 0, not changed.
  });

  it("FORWARD-ONLY GUARD: no timezone or container-configuration change has been smuggled into Stage 0", () => {
    const compose = src("../../../../docker-compose.yml");
    expect(compose).toMatch(/TZ: \$\{TZ:-Asia\/Kolkata\}/); // pinned for the api service
    // Line-based scan of the Postgres service block: it carries no TZ/PGTZ, so
    // its session timezone is whatever initdb chose — measured separately (U-1).
    const lines = compose.split(/\r?\n/);
    const start = lines.findIndex((l) => /^ {2}db:\s*$/.test(l));
    expect(start).toBeGreaterThan(-1);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
    }
    const block = lines.slice(start, end).join("\n");
    expect(block).toContain("postgres:16-alpine");
    expect(block).not.toMatch(/^\s*TZ:/m);
    expect(block).not.toMatch(/^\s*PGTZ:/m);
  });
});

describe("Stage 0 · §18(8) — an old record edited today: what the code actually does", () => {
  it("CHARACTERIZATION: re-dating an expense writes no audit row, because the audit call only fires on amount/mode/category", () => {
    const s = src("../routes/expenses.ts");
    const i = s.indexOf("const amountChanged =");
    expect(i).toBeGreaterThan(-1);
    const gate = s.slice(i, i + 700);
    expect(gate).toMatch(/if \(amountChanged \|\| modeChanged \|\| categoryChanged\) \{/);
    expect(gate).not.toMatch(/dateChanged/i);
    // There is also no expense_audits table anywhere in the schema or migrations:
    const schemaDir = resolve(__dirname, "../../../../lib/db/src/schema");
    const mentions = readdirSync(schemaDir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => readFileSync(resolve(schemaDir, f), "utf8").includes("expense_audits"));
    expect(mentions).toEqual([]);
    // Consequence: the ONLY evidence that an expense's business date ever moved is
    // the difference between expense_date and created_at — and nothing computes
    // that comparison today.
  });

  it("CHARACTERIZATION: the UPDATE does not touch created_at, so the row keeps its original server instant", () => {
    const s = src("../routes/expenses.ts");
    const start = s.indexOf(".update(expensesTable)");
    expect(start).toBeGreaterThan(-1);
    const upd = s.slice(start, start + 240);
    expect(upd).toContain(".set(updates)");
    expect(upd).not.toMatch(/createdAt:/); // created_at survives the edit
    expect(col(expensesTable, "createdAt")!.hasDefault).toBe(true);
  });

  it("CHARACTERIZATION: the audit row's reason is whatever the client typed, even when the actor is session-derived", () => {
    const s = src("../routes/expenses.ts");
    expect(s).toContain('typeof req.body?.reason === "string"');
    expect(s).toContain("userName: session?.subjectName ?? \"staff\""); // actor trusted, reason not
  });

  it("GOOD PATTERN (must not regress): self-approval of an expense is blocked by default", () => {
    const s = src("../routes/expenses.ts");
    expect(s).toContain("Self-approval is currently disabled");
    expect(s).toContain("isSelfApprovalAllowed()");
  });
});

describe("Stage 0 · §18(9) — the ordinary current-day workflow still works", () => {
  it("A same-day expense created by the normal UI path passes every check that exists today", () => {
    // Frozen as a guard: Stage 1+ must not break this. A fresh clinic-day payload
    // with a server-agreeable date must keep parsing and keep being accepted.
    const today = todayIST();
    const parsed = CreateExpenseBody.safeParse({ category: "utilities", description: "x", amount: 1, expenseDate: today });
    expect(parsed.success).toBe(true);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(today)).toBe(true);
  });

  it("TRANSITION (PR 2): the client's date string is no longer what gets stored", () => {
    // BEFORE: "`expenseDate,` as an object shorthand inside the service call:
    // the parsed client string is the value persisted, with no server-side
    // normalization." AFTER: the service receives the guard's answer. The
    // shorthand is gone, so this assertion is inverted rather than deleted.
    const s = src("../routes/expenses.ts");
    expect(s).toContain("const { category, description, amount, expenseDate, paymentMode, paidTo, approvedBy, notes } = parsed.data;");
    expect(s).toMatch(/createExpenseV2\(\{[\s\S]{0,600}?expenseDate: postedExpenseDate,/);
    expect(s).not.toMatch(/createExpenseV2\(\{[\s\S]{0,400}?expenseDate,/);
    expect(s).toContain("resolveCreateBusinessDate");
  });

  it("CHARACTERIZATION: a staff member closes their own drawer from their session alone — the boundary never blocks the day", () => {
    const s = src("../routes/day-close.ts");
    const myClose = s.slice(s.indexOf('dayCloseRouter.post("/my-close"'));
    expect(myClose).toContain("staffSession");
    expect(myClose.slice(0, 400)).toContain("Not authenticated");
    expect(myClose.slice(0, 1500)).not.toMatch(/requireOwnerOrAdmin|requireSuperAdminStaff/);
  });
});

describe("Stage 0 · §18(10) — legacy records stay valid without any new field", () => {
  it("FORWARD-ONLY: no request schema requires a reason, an effective date or an approval", () => {
    const shape = (b: unknown) => Object.keys((b as { shape: Record<string, unknown> }).shape);
    for (const forbidden of ["reason", "effectiveDate", "backdated", "approvedAt", "approvalReason"]) {
      expect(shape(CreateExpenseBody), `CreateExpenseBody must not require ${forbidden}`).not.toContain(forbidden);
      expect(shape(UpdateExpenseBody), `UpdateExpenseBody must not require ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("FORWARD-ONLY: a partial update body — i.e. exactly what an old row would receive — still parses", () => {
    expect(UpdateExpenseBody.safeParse({}).success).toBe(true);
    expect(UpdateExpenseBody.safeParse({ description: "typo fix, no date at all" }).success).toBe(true);
  });

  it("FORWARD-ONLY: a legacy ISO business date is accepted today, unchanged, and is not reinterpreted", () => {
    for (const legacy of ["2024-01-31", "2023-12-31", "2026-09-29"]) {
      const parsed = CreateExpenseBody.safeParse({ category: "utilities", description: "x", amount: 1, expenseDate: legacy });
      expect(parsed.success, legacy).toBe(true);
      if (parsed.success) expect((parsed.data as { expenseDate: string }).expenseDate, legacy).toBe(legacy);
    }
    // The stored string is the string received — no normalization, no clamping.
    // That is precisely the property the forward-only rule depends on.
  });
});

describe("Stage 0 · U-7 — audit immutability is real on exactly two tables", () => {
  const dir = resolve(__dirname, "../../../../migrations");
  const sqlFiles = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const read = (f: string) => readFileSync(resolve(dir, f), "utf8");
  const all = sqlFiles.map(read).join("\n");

  // Tables the audit says carry financial, audit or clinical-record evidence.
  const PROTECTED_TABLES = [
    "audit_logs",
    "voucher_audits",
    "bill_audits",
    "patient_report_amendments",
    "radiology_audit_log",
    "bills",
    "payments",
    "expenses",
    "expense_payments",
    "vouchers",
  ];

  it("append-only guards exist for study_snapshots and ai_shadow_drafts (including TRUNCATE)", () => {
    const hardening = read("add_ai_shadow_uniqueness_hardening.sql");
    expect(hardening).toContain("BEFORE UPDATE OR DELETE ON study_snapshots");
    expect(hardening).toContain("BEFORE TRUNCATE ON ai_shadow_drafts");
    expect(read("add_ai_provisional_report_versioning.sql")).toContain(
      "BEFORE UPDATE OR DELETE ON ai_shadow_drafts",
    );
  });

  it("CHARACTERIZATION: no audit, money or clinical-record table is DB-guarded", () => {
    const triggers = [...all.matchAll(/CREATE TRIGGER\s+([A-Za-z_0-9]+)[\s\S]{0,240}?\bON\s+([A-Za-z_0-9"]+)[\s\S]{0,240}?EXECUTE (?:FUNCTION|PROCEDURE)\s+([a-z_0-9.]+)/gi)];
    expect(triggers.length).toBeGreaterThan(0);
    const guards = triggers.filter((m) => /reject|prevent|immutable|append|guard/i.test(m[1] + m[3]));
    const guardTables = guards.map((m) => m[2].replace(/"/g, "").toLowerCase());
    expect([...new Set(guardTables)].sort()).toEqual(["ai_shadow_drafts", "study_snapshots"]);
    for (const t of PROTECTED_TABLES) {
      expect(guardTables, `no append-only DB guard on ${t}`).not.toContain(t);
    }
    // The remaining triggers are updated_at bookkeeping, which does not make a
    // row immutable — it rewrites a timestamp on every UPDATE.
    const maintenance = triggers.filter((m) => /update_updated_at_column/i.test(m[3]));
    expect(maintenance.length).toBeGreaterThan(0);
  });

  it("CHARACTERIZATION: no REVOKE exists anywhere, so the app DB role can rewrite its own evidence if it is ever compromised", () => {
    // Every `revok*` hit in migrations/ is a revoked_at/revoked_by column.
    const revokeStmts = all.match(/^\s*REVOKE\b/gim) ?? [];
    expect(revokeStmts).toEqual([]);
    expect(all).toMatch(/revoked_at|revoked_by/); // proves the grep is not empty by accident
  });

  it("CHARACTERIZATION: updated_at maintenance triggers are NOT immutability guards", () => {
    const seed = read("seed_mri_protocols.sql");
    expect(seed).toMatch(/update_updated_at_column/);
  });

  it("FORWARD-ONLY GUARD: nothing in the migrations rewrites historical dates or normalizes history", () => {
    const suspects = sqlFiles.filter((f) => {
      const sql = read(f);
      return /UPDATE\s+(expenses|bills|payments|vouchers|form_f)\b[\s\S]{0,120}(expense_date|due_date|created_at|procedure_date)\s*=/i.test(sql);
    });
    expect(suspects).toEqual([]);
  });
});
