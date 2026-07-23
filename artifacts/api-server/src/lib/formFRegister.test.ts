import { describe, expect, test, vi } from "vitest";

// The compliance lib imports @workspace/db at module level (for the gate
// function); the pure helpers under test never touch it.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({ formFRecordsTable: {} }));

import { evaluateFormFCompleteness } from "./pcpndtCompliance";
import {
  parseRegisterQuery,
  istMonthWindowUtc,
  buildRegisterRows,
  registerRowsToCsv,
  type RegisterSourceRecord,
} from "./formFRegister";

function record(overrides: Partial<RegisterSourceRecord> & { id: number }): RegisterSourceRecord {
  return {
    createdAt: new Date("2026-07-05T06:30:00Z"),
    patientId: 42,
    billId: 10,
    billNumber: "0042",
    fetalUsgStudyId: null,
    registrationNo: "REG-1",
    patientName: "Priya Test",
    age: "29",
    mobile: "9999900001",
    referredBy: "Dr. Mehta",
    doctorName: "Dr. Sugandha",
    procedure: "Obstetric USG",
    procedurePurpose: "Anomaly scan",
    basisDiagnosis: "",
    gestationalAgeWeeks: "19",
    gestationalAgeDays: "3",
    ultrasoundResult: "Normal",
    abnormality: "",
    resultConveyed: "yes",
    date: "2026-07-05",
    idCardVerified: true,
    husbandFatherName: "R. Kumar",
    address: "12 MG Road",
    consentDate: "2026-07-05",
    procedureDate: "",
    ...overrides,
  };
}

describe("evaluateFormFCompleteness — one engine for gates AND register", () => {
  test("complete record has no missing fields", () => {
    expect(evaluateFormFCompleteness(record({ id: 1 }))).toEqual({ complete: true, missing: [] });
  });

  test("each rule flags with the legacy gate's exact wording", () => {
    const r = evaluateFormFCompleteness({
      idCardVerified: false,
      husbandFatherName: " ",
      address: null,
      consentDate: "",
      procedureDate: null,
    });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual([
      "ID Card must be verified.",
      "Husband/Father Name is required.",
      "Address is required.",
      "Consent Date or Procedure Date is required.",
    ]);
  });

  test("procedureDate alone satisfies the consent-or-procedure-date rule", () => {
    const r = evaluateFormFCompleteness({ idCardVerified: true, husbandFatherName: "X", address: "Y", consentDate: "", procedureDate: "2026-07-01" });
    expect(r.complete).toBe(true);
  });
});

describe("parseRegisterQuery", () => {
  test("valid input with defaults", () => {
    expect(parseRegisterQuery({ month: "7", year: "2026" })).toEqual({ ok: true, value: { month: 7, year: 2026, page: 1, pageSize: 50 } });
  });

  test("rejects out-of-range and non-integer input", () => {
    for (const q of [
      {},
      { month: "0", year: "2026" },
      { month: "13", year: "2026" },
      { month: "7", year: "1999" },
      { month: "7.5", year: "2026" },
      { month: "7", year: "2026", page: "0" },
      { month: "7", year: "2026", pageSize: "501" },
    ]) {
      expect(parseRegisterQuery(q as Record<string, unknown>).ok).toBe(false);
    }
  });
});

describe("istMonthWindowUtc — clinic (IST) month boundaries", () => {
  test("July 2026: starts Jun 30 18:30 UTC, ends Jul 31 18:30 UTC", () => {
    const { start, end } = istMonthWindowUtc(2026, 7);
    expect(start.toISOString()).toBe("2026-06-30T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-07-31T18:30:00.000Z");
  });

  test("December rolls into January of the next year", () => {
    const { end } = istMonthWindowUtc(2026, 12);
    expect(end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
});

describe("buildRegisterRows", () => {
  test("serials continue from the pagination offset; incomplete records are included and graded, never omitted", () => {
    const rows = buildRegisterRows(
      [record({ id: 1 }), record({ id: 2, address: "" }), record({ id: 3 })],
      11,
    );
    expect(rows.map((r) => r.serial)).toEqual([11, 12, 13]);
    expect(rows[1].completionStatus).toBe("incomplete");
    expect(rows[1].missingFields).toEqual(["Address is required."]);
    expect(rows.filter((r) => r.completionStatus === "complete")).toHaveLength(2);
  });

  test("linked billed tests attach per record for ANY test type; unbilled records get an empty list", () => {
    const tests = new Map<number, string[]>([[10, ["USG Obstetric Level 2", "Fetal Echo"]]]);
    const rows = buildRegisterRows([record({ id: 1, billId: 10 }), record({ id: 2, billId: null })], 1, tests);
    expect(rows[0].linkedTests).toEqual(["USG Obstetric Level 2", "Fetal Echo"]);
    expect(rows[1].linkedTests).toEqual([]);
  });

  test("createdAt renders in IST", () => {
    const rows = buildRegisterRows([record({ id: 1, createdAt: new Date("2026-07-05T06:30:00Z") })], 1);
    expect(rows[0].createdAtIst).toBe("2026-07-05 12:00");
  });
});

describe("registerRowsToCsv — Rule 9(1) structure leads", () => {
  test("the five prescribed Rule 9(1) columns come FIRST, in the prescribed order", () => {
    const csv = registerRowsToCsv(buildRegisterRows([record({ id: 1 })], 1));
    const headers = csv.split("\n")[0];
    const idx = (h: string) => headers.indexOf(h);
    const statutory = [
      "Serial Number",
      "Date of Procedure",
      "Name of the Patient & Spouse/Father",
      "Full Address & Contact Details",
      "Name of Referring Doctor / Self-Referral",
    ];
    for (const h of statutory) expect(idx(h)).toBeGreaterThan(-1);
    for (let i = 1; i < statutory.length; i++) {
      expect(idx(statutory[i])).toBeGreaterThan(idx(statutory[i - 1]));
    }
    // Supplementary data follows the statutory block:
    expect(idx("Form F Tests")).toBeGreaterThan(idx(statutory[4]));
  });

  test("statutory cells combine name+spouse and address+phone; referrer resolves doctor-name first, then Self", () => {
    const rows = buildRegisterRows(
      [record({ id: 1, doctorName: "", referredBy: "" }), record({ id: 2, doctorName: "Dr. R. Gupta" })],
      1,
    );
    const csv = registerRowsToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("Priya Test — Spouse/Father: R. Kumar");
    expect(lines[1]).toContain('"12 MG Road, Ph: 9999900001"');
    expect(lines[1]).toContain("Self");
    expect(lines[2]).toContain("Dr. R. Gupta");
  });

  test("emits a header plus one line per row, with commas/quotes escaped", () => {
    const rows = buildRegisterRows(
      [record({ id: 1, address: '12, "A" Block', billId: 10 })],
      1,
      new Map([[10, ["USG OB", "Fetal Echo"]]]),
    );
    const csv = registerRowsToCsv(rows);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Serial Number");
    expect(lines[0]).toContain("Form F Tests");
    expect(lines[1]).toContain('"12, ""A"" Block');
    expect(lines[1]).toContain("USG OB; Fetal Echo");
  });

  test("empty month produces a header-only CSV (valid, no silent failure)", () => {
    expect(registerRowsToCsv([]).split("\n")).toHaveLength(1);
  });
});

describe("dateOfProcedure (Rule 9(1) Column 2) resolution", () => {
  test("uses procedureDate, falls back to the form's date, and stays BLANK when neither exists (never fabricated)", () => {
    const a = buildRegisterRows([record({ id: 1, procedureDate: "2026-07-04", date: "2026-07-05" })], 1)[0];
    expect(a.dateOfProcedure).toBe("2026-07-04");
    const b = buildRegisterRows([record({ id: 2, procedureDate: "", date: "2026-07-05" })], 1)[0];
    expect(b.dateOfProcedure).toBe("2026-07-05");
    const c = buildRegisterRows([record({ id: 3, procedureDate: "", date: "" })], 1)[0];
    expect(c.dateOfProcedure).toBe("");
  });
});
