import { describe, expect, test, vi, beforeEach } from "vitest";

// The ONE shared PCPNDT Form F verification (roadmap §1.4 step 2). These
// tests pin both failure directions the roadmap calls out (§1.6):
//  - false-allow (non-compliant treated as compliant) — the severe one
//  - false-block (compliant treated as non-compliant)
// plus the fail-closed requirement: a DB error must propagate, never
// silently return compliant.

let formFRows: Array<Record<string, unknown>>;
let shouldThrow: boolean;

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => {
        if (shouldThrow) throw new Error("simulated DB outage");
        return {
          where: () => ({
            orderBy: () => ({ limit: async () => formFRows }),
          }),
        };
      },
    }),
  },
}));

vi.mock("@workspace/db/schema", () => ({
  formFRecordsTable: { patientId: "patient_id", createdAt: "created_at" },
}));

const COMPLETE_FORM_F = {
  id: 91,
  patientId: 12,
  idCardVerified: true,
  husbandFatherName: "Ramesh Kumar",
  address: "Deoghar, Jharkhand",
  consentDate: "2026-07-10",
  procedureDate: "",
  createdAt: new Date("2026-07-10T09:00:00Z"),
};

beforeEach(() => {
  formFRows = [];
  shouldThrow = false;
});

describe("checkPcpndtFormFCompliance", () => {
  test("compliant when the latest Form F has all four requirements", async () => {
    formFRows = [COMPLETE_FORM_F];
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    const r = await checkPcpndtFormFCompliance(12);
    expect(r.compliant).toBe(true);
    expect(r.reason).toBe("compliant");
    expect(r.errors).toEqual([]);
    expect(r.formFId).toBe(91);
    expect(r.formFCreatedAt).toBe("2026-07-10T09:00:00.000Z");
  });

  test("procedureDate alone satisfies the consent/procedure date requirement", async () => {
    formFRows = [{ ...COMPLETE_FORM_F, consentDate: "", procedureDate: "2026-07-11" }];
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    expect((await checkPcpndtFormFCompliance(12)).compliant).toBe(true);
  });

  test("missing patient id → non-compliant (no_patient), legacy wording", async () => {
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    for (const pid of [null, undefined, 0]) {
      const r = await checkPcpndtFormFCompliance(pid as number | null | undefined);
      expect(r.compliant).toBe(false);
      expect(r.reason).toBe("no_patient");
      expect(r.errors).toEqual(["Patient ID is missing for this obstetric report."]);
    }
  });

  test("no Form F record at all → non-compliant (no_form_f), legacy wording", async () => {
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    const r = await checkPcpndtFormFCompliance(12);
    expect(r.compliant).toBe(false);
    expect(r.reason).toBe("no_form_f");
    expect(r.errors).toEqual(["PCPNDT Form F record is missing for this obstetric study."]);
  });

  test("each missing requirement is reported with the exact legacy message", async () => {
    const cases: Array<[Partial<typeof COMPLETE_FORM_F>, string]> = [
      [{ idCardVerified: false }, "ID Card must be verified."],
      [{ husbandFatherName: "  " }, "Husband/Father Name is required."],
      [{ address: "" }, "Address is required."],
      [{ consentDate: "", procedureDate: "  " }, "Consent Date or Procedure Date is required."],
    ];
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    for (const [patch, expected] of cases) {
      formFRows = [{ ...COMPLETE_FORM_F, ...patch }];
      const r = await checkPcpndtFormFCompliance(12);
      expect(r.compliant).toBe(false);
      expect(r.reason).toBe("incomplete_form_f");
      expect(r.errors).toContain(expected);
    }
  });

  test("multiple missing requirements are all listed (matches legacy multi-error response)", async () => {
    formFRows = [{ ...COMPLETE_FORM_F, idCardVerified: false, address: "", consentDate: "", procedureDate: "" }];
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    const r = await checkPcpndtFormFCompliance(12);
    expect(r.errors).toEqual([
      "ID Card must be verified.",
      "Address is required.",
      "Consent Date or Procedure Date is required.",
    ]);
  });

  test("FAIL CLOSED: a DB error propagates — never returns compliant on failure", async () => {
    shouldThrow = true;
    const { checkPcpndtFormFCompliance } = await import("./pcpndtCompliance");
    await expect(checkPcpndtFormFCompliance(12)).rejects.toThrow("simulated DB outage");
  });

  test("override roles match the legacy finalize-force gate exactly", async () => {
    const { PCPNDT_OVERRIDE_ROLES } = await import("./pcpndtCompliance");
    expect(PCPNDT_OVERRIDE_ROLES.has("admin")).toBe(true);
    expect(PCPNDT_OVERRIDE_ROLES.has("super_admin")).toBe(true);
    expect(PCPNDT_OVERRIDE_ROLES.has("radiologist")).toBe(false);
    expect(PCPNDT_OVERRIDE_ROLES.has("")).toBe(false);
  });
});
