/**
 * formFRegisterContract.test.ts — PR 2 wiring contracts (source-level, same
 * technique as aiQueryContract.test.ts / platform-contract.test.ts — this
 * repo's node test environment has no DOM).
 *
 * Contracts:
 *  1. The fetal-echo finalize gate exists server-side (shared engine, block
 *     audited, override contract) and the draft-save escalation hole stays
 *     closed. Frontend disabling alone is never the enforcement.
 *  2. The monthly register + export routes exist, are admin-gated, precede
 *     the /:id catch-all, and the export is audited.
 *  3. The FormF page mounts the register tab for management only, and the
 *     component fetches the canonical endpoints with full-month print/CSV.
 *  4. FetalEcho surfaces the compliance 409 as a readable Form F toast.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const REPO = resolve(HERE, "../../../..");
const read = (p: string) => readFileSync(p, "utf8");

const echoRoute = read(resolve(REPO, "artifacts/api-server/src/routes/echoCardiology.ts"));
const formFRoute = read(resolve(REPO, "artifacts/api-server/src/routes/form-f.ts"));

describe("fetal-echo PCPNDT gate (server-side)", () => {
  it("finalize runs the ONE shared compliance engine — no duplicated Form F logic", () => {
    expect(echoRoute).toContain('from "../lib/pcpndtCompliance"');
    expect(echoRoute).toContain("checkPcpndtFormFCompliance");
    expect(echoRoute).toContain("enforceFetalEchoPcpndtGate");
    // No local reimplementation of the four statutory predicates:
    expect(echoRoute).not.toContain("idCardVerified");
  });

  it("blocked attempts are audited, with the same override contract as fetalUsgLevel4", () => {
    expect(echoRoute).toContain('"pcpndt_blocked"');
    expect(echoRoute).toContain("pcpndt_override_finalize");
    expect(echoRoute).toContain("PCPNDT_OVERRIDE_ROLES");
    expect(echoRoute).toContain("pcpndtOverrideReason");
  });

  it("the draft-save endpoint can never escalate a fetal echo to final", () => {
    expect(echoRoute).toContain('requestedStatus === "final"');
    expect(echoRoute).toContain("finalize_endpoint_required");
  });
});

describe("monthly register routes", () => {
  it("register + export exist, admin-gated, before the /:id catch-all", () => {
    expect(formFRoute).toMatch(/formFRouter\.get\(\s*"\/register",\s*requireAdminRole/);
    expect(formFRoute).toMatch(/formFRouter\.get\(\s*"\/register\/export",\s*requireAdminRole/);
    const registerIdx = formFRoute.indexOf('formFRouter.get("/register"');
    const idIdx = formFRoute.indexOf('formFRouter.get("/:id"');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeLessThan(idIdx);
  });

  it("the export is written to the tamper-evident audit chain", () => {
    expect(formFRoute).toContain("auditFromRequest");
    expect(formFRoute).toContain('entityType: "form_f_register"');
  });

  it("linked tests use the configured Form-F designation (all modalities), not every billed test", () => {
    expect(formFRoute).toContain("resolveFormFTestsByBillId");
    expect(formFRoute.match(/formFTestIds/g)!.length).toBeGreaterThanOrEqual(3); // pending ×2 + register resolver
  });

  it("PARTITION: the 9(1) register carries doctor-referred records only; self/walk-in go to the OPD register", () => {
    expect(formFRoute).toContain("!isSelfReferralRecord(r)");
    // Export applies the same partition — the two statutory books never overlap:
    expect(formFRoute.match(/!isSelfReferralRecord/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("FormF page + register component", () => {
  const page = read(resolve(ERP_SRC, "pages/FormF.tsx"));
  const component = read(resolve(ERP_SRC, "components/FormFMonthlyRegister.tsx"));

  it("register tab renders for management only and mounts the component", () => {
    expect(page).toContain("FormFMonthlyRegister");
    expect(page).toMatch(/isFormFAdmin && \(\s*<button/);
    expect(page).toMatch(/activeTab === "register" && isFormFAdmin/);
  });

  it("component uses the canonical endpoints, shows incomplete records, and covers the full month for CSV + print", () => {
    expect(component).toContain("/api/form-f/register?month=");
    expect(component).toContain("/api/form-f/register/export?month=");
    expect(component).toContain("incompleteCount");
    expect(component).toContain("missingFields");
    expect(component).toContain("totalPagesToFetch"); // print loops every page
    expect(component).toContain("formf-register-error"); // distinct error state with retry
  });

  it("print + table carry the five Rule 9(1) prescribed columns, and the print is exactly that structure", () => {
    for (const header of [
      "Serial Number",
      "Date of Procedure",
      "Name of the Patient",
      "Full Address",
      "Referring Doctor / Self-Referral",
    ]) {
      expect(component).toContain(header);
    }
    expect(component).toContain("Rule 9(1)");
    // The statutory print never back-fills a missing procedure date:
    expect(component).not.toMatch(/dateOfProcedure \|\| r\.createdAtIst/);
    // And the server lib pins the CSV order:
    const lib = read(resolve(REPO, "artifacts/api-server/src/lib/formFRegister.ts"));
    expect(lib).toContain("RULE_9_1_COLUMNS");
    expect(lib).toMatch(/CSV_COLUMNS = \[\.\.\.RULE_9_1_COLUMNS, \.\.\.SUPPLEMENTARY_COLUMNS\]/);
  });
});

describe("Self-referral OPD register (Form 25 replica)", () => {
  const component = read(resolve(ERP_SRC, "components/FormFSelfReferralOpdRegister.tsx"));
  const page = read(resolve(ERP_SRC, "pages/FormF.tsx"));

  it("route exists, admin-gated, before /:id, and filters to self-referrals via the shared predicate", () => {
    expect(formFRoute).toMatch(/formFRouter\.get\(\s*"\/register\/self-referral-opd",\s*requireAdminRole/);
    expect(formFRoute).toContain("isSelfReferralRecord");
    const opdIdx = formFRoute.indexOf('"/register/self-referral-opd"');
    const idIdx = formFRoute.indexOf('formFRouter.get("/:id"');
    expect(opdIdx).toBeGreaterThan(-1);
    expect(opdIdx).toBeLessThan(idIdx);
  });

  it("kept beside the Rule 9(1) register as a management-only tab", () => {
    expect(page).toContain("FormFSelfReferralOpdRegister");
    expect(page).toMatch(/activeTab === "selfRefOpd" && isFormFAdmin/);
  });

  it("component renders the Form 25 structure with the prescribed prefills and full-month print", () => {
    expect(component).toContain("/api/form-f/register/self-referral-opd?month=");
    expect(component).toContain("FORM 25 (Formerly 3C)");
    expect(component).toContain("General Obstetrical Checkup");
    expect(component).toContain("Complimentary / Free");
    expect(component).toContain("Dr. Sugandha Priyadarshini");
    expect(component).toContain("totalPagesToFetch"); // print covers the whole month
    expect(component).toContain("formf-selfref-opd-error");
  });

  it("the server pins doctor/service/fees constants next to the register logic (single source)", () => {
    const lib = read(resolve(REPO, "artifacts/api-server/src/lib/formFRegister.ts"));
    expect(lib).toContain('SELF_REFERRAL_OPD_DOCTOR = "Dr. Sugandha Priyadarshini"');
    expect(lib).toContain('SELF_REFERRAL_OPD_DOCTOR_QUALIFICATIONS = "MBBS, MD"');
    expect(lib).toContain('SELF_REFERRAL_OPD_SERVICE = "General Obstetrical Checkup"');
    expect(lib).toContain('SELF_REFERRAL_OPD_FEES = "Complimentary / Free"');
    expect(lib).toContain("Sonography for Fetal Well Being (FWB)");
  });

  it("auto-prescription: signed at save time AND ensured from the register; print wired with the digital-signature block", () => {
    // Save hook (both-criteria rule) + register-view ensure:
    expect(formFRoute).toContain("ensureSelfReferralPrescriptions");
    expect(formFRoute.match(/ensureSelfReferralPrescriptions/g)!.length).toBeGreaterThanOrEqual(3); // import + save hook + register
    expect(formFRoute).toContain("hasFormFTestEvidence");
    // Prescription endpoint registered before the /:id catch-all:
    const rxIdx = formFRoute.indexOf('"/register/self-referral-opd/prescription/:recordId"');
    const idIdx = formFRoute.indexOf('formFRouter.get("/:id"');
    expect(rxIdx).toBeGreaterThan(-1);
    expect(rxIdx).toBeLessThan(idIdx);
    // The signing engine snapshots the signature and hashes the content:
    const rxLib = read(resolve(REPO, "artifacts/api-server/src/lib/selfReferralPrescriptions.ts"));
    expect(rxLib).toContain("onConflictDoNothing"); // never re-signs
    expect(rxLib).toContain('createHash("sha256")');
    expect(rxLib).toContain("signaturesTable");
    // UI prints the signed prescription:
    const component = read(resolve(ERP_SRC, "components/FormFSelfReferralOpdRegister.tsx"));
    expect(component).toContain("printPrescription");
    expect(component).toContain("Digitally signed by");
    expect(component).toContain("prescriptionId");
  });
});

describe("FetalEcho compliance-error surfacing", () => {
  it("the finalize catch branches on the Form F message and surfaces it verbatim", () => {
    const page = read(resolve(ERP_SRC, "pages/FetalEcho.tsx"));
    expect(page).toMatch(/PCPNDT\|Form F/);
    expect(page).toContain("PCPNDT Form F required");
  });
});
