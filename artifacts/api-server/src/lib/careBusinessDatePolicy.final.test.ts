/**
 * Final business-time policy — Phase C enforcement primitive (§18 test matrix).
 *
 * PR 1 changes no route behaviour: it adds the guard and proves the contract.
 * Every case below is decided against an injected authority, so nothing here
 * depends on the workstation clock, the browser clock, or the timezone this
 * suite happens to run in.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  careBusinessDateErrorBody,
  clinicDateAuthority,
  describeBusinessDateRejection,
  policedCareBusinessDateFields,
  resolveCreateBusinessDate,
  resolveUpdateBusinessDate,
} from "./careBusinessDatePolicy";
import { CARE_CLASS_A_DATE_FIELDS, CARE_NEVER_BUSINESS_DATE_FIELDS } from "./careDateFieldRegistry";
import { careTimeResponse } from "./careTimeContract";

const at = (iso: string) => new Date(iso);
const src = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8").replace(/\r\n/g, "\n");
/** Comments stripped, so a guard is about code and never about prose. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The clinic day rolls at 2026-09-30T18:30:00Z (= 00:00 IST on 1 October). */
const AUTHORITY_DAYS = [at("2026-09-30T18:29:59.999Z"), at("2026-09-30T18:30:00.000Z")] as const;

describe("§14 — the authority reuses Stage 1A, it does not compete with it", () => {
  it("agrees with the /api/time/now contract for the same instant", () => {
    for (const instant of [...AUTHORITY_DAYS, at("2026-10-01T00:00:00Z"), at("2026-09-30T02:00:00+05:30")]) {
      const authority = clinicDateAuthority(instant);
      const served = careTimeResponse(instant);
      expect(authority.clinicDate, instant.toISOString()).toBe(served.clinicDateIst);
      expect(authority.businessDayStartUtcIso).toBe(served.businessDayStartUtcIso);
      expect(authority.businessDayEndUtcIso).toBe(served.businessDayEndUtcIso);
      expect(authority.zone).toBe("Asia/Kolkata");
    }
  });

  it("computes no new time arithmetic of its own", () => {
    for (const rel of ["./careBusinessDatePolicy.ts", "./careDateFieldRegistry.ts"]) {
      const code = codeOnly(src(rel));
      expect(code, rel).not.toMatch(/toLocale|Intl\.|Date\.parse|getTime\(\)|toISOString\(\)\.slice|new Date\(\)\.get/);
    }
    expect(src("./careBusinessDatePolicy.ts")).toContain('from "./istDate"');
  });

  it("names the clock it used, and never claims to be the database", () => {
    expect(clinicDateAuthority(at("2026-10-01T04:00:00+05:30")).clockSource).toBe("care-server-clock");
  });
});

describe("§23 — the permitted date follows the CARE clinic day, at every boundary, under any process timezone", () => {
  const CASES: ReadonlyArray<{ label: string; iso: string; clinicDate: string; wrongUtcDay: string }> = [
    { label: "23:59:59.999 IST on 30-Sep", iso: "2026-09-30T18:29:59.999Z", clinicDate: "2026-09-30", wrongUtcDay: "2026-09-30" },
    { label: "00:00:00.000 IST on 01-Oct (day rolls)", iso: "2026-09-30T18:30:00.000Z", clinicDate: "2026-10-01", wrongUtcDay: "2026-09-30" },
    { label: "00:00:00.001 IST on 01-Oct", iso: "2026-09-30T18:30:00.001Z", clinicDate: "2026-10-01", wrongUtcDay: "2026-09-30" },
    { label: "05:29 IST on 01-Oct (UTC still 30-Sep)", iso: "2026-09-30T23:59:00.000Z", clinicDate: "2026-10-01", wrongUtcDay: "2026-09-30" },
    { label: "05:30 IST on 01-Oct (UTC rolls too)", iso: "2026-10-01T00:00:00.000Z", clinicDate: "2026-10-01", wrongUtcDay: "2026-10-01" },
  ];

  for (const zone of ["UTC", "Asia/Kolkata", "America/New_York"]) {
    it(`is identical under TZ=${zone}`, () => {
      const before = process.env.TZ;
      try {
        process.env.TZ = zone;
        for (const c of CASES) {
          const authority = clinicDateAuthority(at(c.iso));
          expect(authority.clinicDate, `${c.label} @ ${zone}`).toBe(c.clinicDate);
          // The same instant, judged only by the guard, permits exactly one date.
          expect(resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted: c.clinicDate, authority }).ok, c.label).toBe(true);
          const wrong = c.wrongUtcDay === c.clinicDate ? null : c.wrongUtcDay;
          if (wrong) {
            const rejected = resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted: wrong, authority });
            expect(rejected.ok, `${c.label}: ${wrong} must not be accepted`).toBe(false);
            if (!rejected.ok) expect(rejected.direction).toBe(wrong < c.clinicDate ? "past" : "future");
          }
        }
      } finally {
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
      }
    });
  }

  it("the day length is exactly 24h minus 1ms and both edges are inclusive", () => {
    const authority = clinicDateAuthority(at("2026-10-01T04:00:00+05:30"));
    const span = at(authority.businessDayEndUtcIso).getTime() - at(authority.businessDayStartUtcIso).getTime();
    expect(span).toBe(24 * 60 * 60 * 1000 - 1);
    expect(resolveCreateBusinessDate({ table: "expenses", column: "expense_date", submitted: "2026-10-01", authority }).ok).toBe(true);
  });
});

describe("§2 — CREATE: the submitted business date must equal the trusted CARE clinic date", () => {
  const authority = clinicDateAuthority(at("2026-10-01T04:00:00+05:30")); // CARE date 2026-10-01

  const rejected = (submitted: string | null | undefined, code?: string) => {
    const v = resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted, authority });
    expect(v.ok, `submitted=${JSON.stringify(submitted)} should be rejected`).toBe(false);
    if (v.ok) throw new Error("unreachable");
    if (code) expect(v.code).toBe(code);
    // §2: never silently substitute. A rejection carries no value to write.
    expect(v).not.toHaveProperty("businessDate");
    return v;
  };

  it("accepts exactly the current CARE business date", () => {
    const v = resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted: "2026-10-01", authority });
    expect(v.ok && v.origin).toBe("client-matches-trusted");
    expect(v.ok && v.businessDate).toBe("2026-10-01");
  });

  it("derives the CARE date itself when the client sent no date, blank, or null", () => {
    for (const submitted of [undefined, null, ""]) {
      const v = resolveCreateBusinessDate({ table: "expenses", column: "expense_date", submitted, authority });
      expect(v.ok, JSON.stringify(submitted)).toBe(true);
      expect(v.ok && v.origin).toBe("server-derived");
      expect(v.ok && v.businessDate).toBe("2026-10-01");
    }
  });

  it("REJECTS the PC-clock attack: yesterday, last week, last month, 1900, any earlier day", () => {
    for (const submitted of ["2026-09-30", "2026-09-25", "2026-09-24", "2026-08-31", "2026-01-01", "1900-01-01", "1999-12-31"]) {
      const v = rejected(submitted, "CARE_BUSINESS_DATE_NOT_CURRENT");
      expect(v.direction).toBe("past");
      expect(v.careBusinessDate).toBe("2026-10-01");
      expect(v.attempted).toBe(submitted);
    }
  });

  it("REJECTS the future-date attack for ordinary staff", () => {
    for (const submitted of ["2026-10-02", "2026-12-31", "2035-01-01"]) {
      expect(rejected(submitted, "CARE_BUSINESS_DATE_NOT_CURRENT").direction).toBe("future");
    }
  });

  it("REJECTS anything that is not a CARE business date, without guessing at it", () => {
    for (const submitted of ["30/09/2026", "2026-9-5", "2026-10-1", "01-10-2026", "2026-10-01T00:00:00Z", "today", " 2026-10-01", "2026-10-01 "]) {
      expect(rejected(submitted, "CARE_BUSINESS_DATE_MALFORMED").direction).toBe("unparseable");
    }
  });

  it("says what the permitted date is, so a rejected form is recoverable", () => {
    const v = rejected("2026-09-30");
    expect(v.message).toContain("Entry date must be the current CARE business date (2026-10-01)");
    expect(v.zone).toBe("Asia/Kolkata");
    expect(v.trustedInstantIso).toBe(at("2026-09-30T22:30:00.000Z").toISOString());
  });

  it("applies to both Class-A fields, not just vouchers", () => {
    for (const [table, column] of [["expenses", "expense_date"], ["vouchers", "date"]] as const) {
      expect(resolveCreateBusinessDate({ table, column, submitted: "2026-09-30", authority }).ok, `${table}.${column}`).toBe(false);
      expect(resolveCreateBusinessDate({ table, column, submitted: "2026-10-01", authority }).ok, `${table}.${column}`).toBe(true);
    }
  });

  it("is decided by the injected authority, never by the wall clock", () => {
    // A past CARE date is still the only permitted value for an authority that
    // says so: this is what makes the behaviour deterministic and what proves
    // no internal `new Date()` is consulted.
    const historic = clinicDateAuthority(at("2024-03-15T04:00:00+05:30"));
    expect(historic.clinicDate).toBe("2024-03-15");
    expect(resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted: "2024-03-15", authority: historic }).ok).toBe(true);
    expect(resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted: "2026-10-01", authority: historic }).ok).toBe(false);
  });
});

describe("§3 — UPDATE: an existing record's business date is not editable by ordinary staff", () => {
  const authority = clinicDateAuthority(at("2026-10-01T04:00:00+05:30"));

  it("accepts the row's own date unchanged, even when it is months old (forward-only)", () => {
    for (const stored of ["2024-03-15", "2026-01-01", "2026-09-30"]) {
      const v = resolveUpdateBusinessDate({ table: "vouchers", column: "date", stored, submitted: stored, authority });
      expect(v.ok, stored).toBe(true);
      if (v.ok && v.origin === "identical") expect(v.businessDate).toBe(stored);
    }
  });

  it("treats an absent field as no change and hands back the stored value", () => {
    for (const submitted of [undefined, null]) {
      const v = resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: "2026-09-12", submitted, authority });
      expect(v.ok).toBe(true);
      if (v.ok && v.origin === "absent") expect(v.businessDate).toBe("2026-09-12");
    }
  });

  it("REJECTS re-dating to an earlier day", () => {
    const v = resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: "2026-09-28", submitted: "2026-09-25", authority });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("CARE_BUSINESS_DATE_IMMUTABLE");
      expect(v.direction).toBe("past");
    }
  });

  it("REJECTS re-dating forward, including onto today's CARE date", () => {
    for (const submitted of ["2026-10-01", "2026-10-05", "2026-09-30"]) {
      const v = resolveUpdateBusinessDate({ table: "vouchers", column: "date", stored: "2026-09-29", submitted, authority });
      expect(v.ok, submitted).toBe(false);
      if (!v.ok) expect(v.code).toBe("CARE_BUSINESS_DATE_IMMUTABLE");
    }
  });

  it("REJECTS a 30-seconds-old row being re-dated — recency is not an exception", () => {
    const createdJustNow = "2026-10-01";
    const v = resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: createdJustNow, submitted: "2026-09-30", authority });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toContain("cannot be changed");
  });

  it("REJECTS blanking the date, which would otherwise erase the business date", () => {
    const v = resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: "2026-09-28", submitted: "", authority });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("CARE_BUSINESS_DATE_MALFORMED");
  });

  it("never mutates the stored value on the way to a verdict", () => {
    const stored = "2026-09-28";
    resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored, submitted: "2024-01-31", authority });
    expect(stored).toBe("2026-09-28");
    const untouched = { stored };
    resolveUpdateBusinessDate({ table: "expenses", column: "expense_date", stored: untouched.stored, submitted: "2024-01-31", authority });
    expect(untouched.stored).toBe("2026-09-28");
  });
});

describe("§9 — clinical and planned dates are never policed, even by accident", () => {
  const authority = clinicDateAuthority(at("2026-10-01T04:00:00+05:30"));

  it("passes a legitimately historical value straight through, unchanged", () => {
    const cases: ReadonlyArray<[string, string, string]> = [
      ["patients", "date_of_birth", "1980-05-05"],
      ["fetal_usg_studies", "lmp", "2026-01-11"],
      ["form_f_records", "procedure_date", "2026-07-02"],
      ["form_f_records", "consent_date", "2026-06-28"],
      ["form_f_records", "mtp_date", ""],
      ["radiology_studies", "study_date", "2025-11-30"],
      ["radiology_tumor_followups", "study_date", "2024-02-02"],
      ["purchase_invoices", "invoice_date", "2026-03-03"],
      ["expense_attachments", "uploaded_at", "2020-01-01T00:00:00Z"],
    ];
    for (const [table, column, value] of cases) {
      const v = resolveCreateBusinessDate({ table, column, submitted: value, authority });
      expect(v.ok, `${table}.${column}`).toBe(true);
      if (v.ok && v.origin === "not-policed") {
        expect(v.businessDate, `${table}.${column} must be stored exactly as entered`).toBe(value);
      } else {
        throw new Error(`${table}.${column} was not refused enforcement`);
      }
    }
  });

  it("passes a legitimately future value straight through", () => {
    for (const [table, column] of [["appointments", "appointment_date"], ["recall_queue", "due_date"], ["fetal_usg_studies", "edd"], ["bills", "due_date"], ["online_bookings", "selected_date"]] as const) {
      const v = resolveCreateBusinessDate({ table, column, submitted: "2027-06-15", authority });
      expect(v.ok && v.origin).toBe("not-policed");
      expect(v.ok && v.businessDate).toBe("2027-06-15");
    }
  });

  it("an UPDATE of a non-Class-A field is also not policed, so the guard cannot freeze clinical data", () => {
    const v = resolveUpdateBusinessDate({ table: "patients", column: "date_of_birth", stored: "1980-05-05", submitted: "1980-05-06", authority });
    expect(v.ok).toBe(true);
    if (v.ok && v.origin === "not-policed") expect(v.businessDate).toBe("1980-05-06");
  });

  it("an unregistered field is not-policed and says why, rather than defaulting to enforcement", () => {
    const v = resolveCreateBusinessDate({ table: "sometable", column: "somedate", submitted: "1900-01-01", authority });
    expect(v.ok && v.origin).toBe("not-policed");
    expect(v.ok && v.origin === "not-policed" && v.reason).toContain("not registered as Class A");
  });

  it("the enforcement surface is exactly the two proven fields, and disjoint from the blocklist", () => {
    expect(policedCareBusinessDateFields().sort()).toEqual(["expenses.expense_date", "vouchers.date"]);
    const blocked = Object.keys(CARE_NEVER_BUSINESS_DATE_FIELDS);
    for (const key of Object.keys(CARE_CLASS_A_DATE_FIELDS)) expect(blocked, `${key} cannot be both`).not.toContain(key);
    // The fields the policy insists stay historical:
    for (const key of ["patients.date_of_birth", "fetal_usg_studies.lmp", "fetal_usg_studies.edd", "form_f_records.procedure_date", "radiology_studies.study_date", "bills.due_date"]) {
      expect(blocked, key).toContain(key);
    }
  });
});

describe("§6/§19/§24 — actor identity, rejection evidence, and no client-authority path", () => {
  const authority = clinicDateAuthority(at("2026-10-01T04:00:00+05:30"));
  const rejection = resolveCreateBusinessDate({ table: "vouchers", column: "date", submitted: "2026-09-25", authority });

  it("the guard reads nothing from a request", () => {
    for (const rel of ["./careBusinessDatePolicy.ts", "./careDateFieldRegistry.ts"]) {
      const code = codeOnly(src(rel));
      expect(code, rel).not.toMatch(/\breq\b|\.body\b|headers|query\.|req\.query/);
    }
  });

  it("the guard cannot touch a row: no database import, no select/insert/update/delete", () => {
    for (const rel of ["./careBusinessDatePolicy.ts", "./careDateFieldRegistry.ts"]) {
      const code = codeOnly(src(rel));
      expect(code, rel).not.toMatch(/@workspace\/db|db\.(select|insert|update|delete|execute|transaction)/);
    }
  });

  it("the browser idiom is not reintroduced server-side", () => {
    const code = codeOnly(src("./careBusinessDatePolicy.ts"));
    expect(code).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)|new Date\(\)\.toISOString\(\)/);
    expect(code).toMatch(/clinicDateAuthority\(now: Date = new Date\(\)\)/);
  });

  it("evidence names the session actor and never the body", () => {
    if (rejection.ok) throw new Error("expected a rejection");
    const evidence = describeBusinessDateRejection({
      rejection,
      actor: { subjectId: "staff-42", role: "staff", displayName: "whoever-the-body-says" },
      endpoint: "/api/accounting/vouchers",
      method: "POST",
      entity: 771,
      now: at("2026-10-01T04:05:00+05:30"),
    });
    expect(evidence).toEqual({
      action: "care-business-date.rejected",
      entity: "vouchers#771",
      endpoint: "/api/accounting/vouchers",
      method: "POST",
      actorSubjectId: "staff-42",
      actorRole: "staff",
      identitySource: "authenticated-session",
      attemptedBusinessDate: "2026-09-25",
      careBusinessDate: "2026-10-01",
      trustedInstant: "2026-09-30T22:30:00.000Z",
      outcome: "rejected",
      code: "CARE_BUSINESS_DATE_NOT_CURRENT",
      recordedAt: at("2026-10-01T04:05:00+05:30").toISOString(),
    });
    // The display name the caller could have typed is not trusted, so it is not recorded.
    expect(JSON.stringify(evidence)).not.toContain("whoever-the-body-says");
  });

  it("evidence carries no secret or patient payload", () => {
    if (rejection.ok) throw new Error("expected a rejection");
    const json = JSON.stringify(
      describeBusinessDateRejection({
        rejection,
        actor: { subjectId: "s1", role: "staff", sessionId: "sess-1" },
        endpoint: "/api/expenses",
        method: "POST",
      }),
    ).toLowerCase();
    for (const forbidden of ["token", "password", "authorization", "bearer", "patient", "phone", "email", "address"]) {
      expect(json, `evidence must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("the error body keeps `error` for existing clients and adds the machine fields", () => {
    if (rejection.ok) throw new Error("expected a rejection");
    const body = careBusinessDateErrorBody(rejection);
    expect(typeof body.error).toBe("string");
    expect(body.code).toBe("CARE_BUSINESS_DATE_NOT_CURRENT");
    expect(body.attemptedBusinessDate).toBe("2026-09-25");
    expect(body.careBusinessDate).toBe("2026-10-01");
    expect(body.zone).toBe("Asia/Kolkata");
    expect(body.direction).toBe("past");
    expect(Object.keys(body).sort()).toEqual([
      "attemptedBusinessDate",
      "careBusinessDate",
      "code",
      "direction",
      "error",
      "field",
      "trustedInstant",
      "zone",
    ]);
  });
});

describe("§2/§3 — PR 1 is inert: the guard is not wired into any route yet", () => {
  it("no route or service imports the policy in this PR", () => {
    const files = ["../routes/accounting.ts", "../routes/expenses.ts", "../routes/bills.ts", "../routes/day-close.ts", "../lib/expenseV2Service.ts"];
    for (const rel of files) {
      expect(src(rel), rel).not.toMatch(/careBusinessDatePolicy|resolveCreateBusinessDate|resolveUpdateBusinessDate/);
    }
  });

  it("the money path still parses the dates the guard will later reject — a BEFORE record for Phase D", () => {
    // Recorded, not enforced: PR 2 converts these into documented transitions.
    const body = codeOnly(src("../../../../lib/api-zod/src/generated/api.ts"));
    expect(body).toMatch(/export const CreateExpenseBody = zod\.object\(\{/);
    expect(body).toMatch(/expenseDate: zod\.string\(\),/);
    expect(body).toMatch(/expenseDate: zod\.string\(\)\.optional\(\),/);
  });
});
