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
  isSelfReferralRecord,
  referringDoctorLabel,
  RULE_9_1_COLUMNS,
  buildOpdRegisterRows,
  SELF_REFERRAL_OPD_DOCTOR,
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

  test("statutory cells combine name+spouse and address+phone; referrer comes from referred_by, not the conducting doctor", () => {
    const rows = buildRegisterRows(
      [
        record({ id: 1, doctorName: "", referredBy: "" }),
        // Conducting doctor differs from the referrer — the column must report
        // the referrer (referred_by), never the sonologist who scanned her.
        record({ id: 2, doctorName: "Dr. R. Gupta", referredBy: "Doctor: Dr. Mehta" }),
      ],
      1,
    );
    const csv = registerRowsToCsv(rows);
    const lines = csv.split("\n");
    expect(lines[1]).toContain("Priya Test — Spouse/Father: R. Kumar");
    expect(lines[1]).toContain('"12 MG Road, Ph: 9999900001"');
    expect(lines[1]).toContain("Self");
    expect(lines[2]).toContain("Dr. Mehta");
    expect(lines[2]).not.toContain("Dr. R. Gupta");
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

describe("isSelfReferralRecord — who belongs in the self-referral OPD register", () => {
  test("blank / Self / walk-in referrals with no doctor name are self-referrals", () => {
    for (const referredBy of ["", "  ", "Self", "self", "SELF", "Walk-in", "walkin"]) {
      expect(isSelfReferralRecord({ referredBy, doctorName: "" })).toBe(true);
    }
  });

  test("a named referring doctor in referred_by is NEVER a self-referral", () => {
    expect(isSelfReferralRecord({ referredBy: "Dr. Mehta", doctorName: "" })).toBe(false);
    expect(isSelfReferralRecord({ referredBy: "Doctor", doctorName: "" })).toBe(false);
    // The shape FormF.tsx actually saves for a doctor referral.
    expect(isSelfReferralRecord({ referredBy: "Doctor: Dr. Mehta", doctorName: "" })).toBe(false);
  });

  // Regression: doctor_name is the CONDUCTING sonologist, pre-filled on every
  // new Form F. Consulting it here made this predicate false for every real
  // record — the Self-Referral OPD register could never contain a row, the
  // auto-prescriptions never fired, and self-referred women were mis-filed
  // into the Rule 9(1) register.
  test("the conducting doctor is ignored — a self-referral stays a self-referral", () => {
    expect(isSelfReferralRecord({ referredBy: "Self", doctorName: SELF_REFERRAL_OPD_DOCTOR })).toBe(true);
    expect(isSelfReferralRecord({ referredBy: "", doctorName: "Dr. R. Gupta" })).toBe(true);
    expect(isSelfReferralRecord({ referredBy: null, doctorName: "Dr. R. Gupta" })).toBe(true);
    expect(isSelfReferralRecord({ referredBy: "Walk-in", doctorName: SELF_REFERRAL_OPD_DOCTOR })).toBe(true);
  });
});

describe("Rule 9(1) referring-doctor column reports the REFERRER, not the sonologist", () => {
  const referrerColumn = (r: Partial<RegisterSourceRecord>) =>
    registerRowsToCsv(buildRegisterRows([record({ id: 1, ...r })], 1))
      .split("\n")[1];

  test("a doctor referral prints the referring doctor, never the conducting one", () => {
    const line = referrerColumn({ referredBy: "Doctor: Dr. Mehta", doctorName: SELF_REFERRAL_OPD_DOCTOR });
    expect(line).toContain("Dr. Mehta");
    expect(line).not.toContain(SELF_REFERRAL_OPD_DOCTOR);
  });

  test("a doctor referral saved without a name is not reported as self-referral", () => {
    expect(referrerColumn({ referredBy: "Doctor: ", doctorName: SELF_REFERRAL_OPD_DOCTOR }))
      .toContain("name not recorded");
  });

  // The on-screen table and the A4 print render row.referringDoctor verbatim,
  // while the CSV goes through RULE_9_1_COLUMNS. Both must resolve to the same
  // string or the three views name different doctors on a statutory return.
  test("row.referringDoctor is the single source the CSV column also uses", () => {
    const cases: Array<[string | null, string]> = [
      ["Doctor: Dr. Mehta", "Dr. Mehta"],
      ["Dr. Mehta", "Dr. Mehta"],
      ["Self", "Self"],
      ["Walk-in", "Self"],
      ["", "Self"],
      [null, "Self"],
      ["Doctor: ", "Referring doctor (name not recorded)"],
    ];
    for (const [referredBy, expected] of cases) {
      expect(referringDoctorLabel(referredBy)).toBe(expected);
      const [row] = buildRegisterRows(
        [record({ id: 1, referredBy, doctorName: SELF_REFERRAL_OPD_DOCTOR })],
        1,
      );
      expect(row.referringDoctor).toBe(expected);
      const csvColumn = RULE_9_1_COLUMNS.find((c) => c.header.startsWith("Name of Referring Doctor"))!;
      expect(csvColumn.value(row)).toBe(expected);
    }
  });
});

describe("buildOpdRegisterRows — Form 25 replica prefills", () => {
  test("nature of service, examining doctor and complimentary fees are prefilled; serials continue from the offset", () => {
    const rows = buildOpdRegisterRows([record({ id: 1 }), record({ id: 2 })], 4);
    expect(rows.map((r) => r.serial)).toEqual([4, 5]);
    for (const r of rows) {
      expect(r.natureOfService).toBe("General Obstetrical Checkup");
      expect(r.feesReceived).toBe("Complimentary / Free");
      expect(r.dateOfReceipt).toBe("—");
    }
    expect(SELF_REFERRAL_OPD_DOCTOR).toBe("Dr. Sugandha Priyadarshini");
  });

  test("checkup date resolves procedure date → form date → the record's own creation date (the OPD visit day)", () => {
    const a = buildOpdRegisterRows([record({ id: 1, procedureDate: "2026-07-04" })], 1)[0];
    expect(a.date).toBe("2026-07-04");
    const b = buildOpdRegisterRows([record({ id: 2, procedureDate: "", date: "2026-07-06" })], 1)[0];
    expect(b.date).toBe("2026-07-06");
    const c = buildOpdRegisterRows([record({ id: 3, procedureDate: "", date: "", createdAt: new Date("2026-07-05T06:30:00Z") })], 1)[0];
    expect(c.date).toBe("2026-07-05"); // IST date of the visit
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
