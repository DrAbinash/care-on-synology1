import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source contract: Billing Desk "Register & Select" (POST /api/patients) must
 * allocate UHIDs via SEQUENCE nextval — never session-scoped pg_advisory_lock
 * on a pooled drizzle connection (unlock can run on a different connection and
 * leave the lock held → Registering… hangs → gateway 500).
 */
const root = dirname(fileURLToPath(import.meta.url));
const patientsSrc = readFileSync(join(root, "patients.ts"), "utf8");
const countersSrc = readFileSync(join(root, "../lib/documentNumberCounters.ts"), "utf8");
const migrationSrc = readFileSync(
  join(root, "../../../../migrations/zzzz_patient_id_seq.sql"),
  "utf8",
);
const reconcileSrc = readFileSync(join(root, "../lib/emergencyReconcile.ts"), "utf8");
const selfRegSrc = readFileSync(join(root, "../services/self-registration.ts"), "utf8");

describe("patient UHID allocation", () => {
  it("patients route uses nextPatientId SEQUENCE allocator", () => {
    expect(patientsSrc).toContain('from "../lib/documentNumberCounters"');
    expect(patientsSrc).toContain("nextPatientId(db)");
    expect(countersSrc).toContain("nextval('patient_id_seq')");
    expect(migrationSrc).toContain("CREATE SEQUENCE IF NOT EXISTS patient_id_seq");
  });

  it("does not use session-scoped pg_advisory_lock for patient IDs", () => {
    const codeOnly = patientsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("pg_advisory_lock");
    expect(codeOnly).not.toContain("pg_advisory_unlock");
    expect(codeOnly).not.toContain("0x50617469656e74");
    expect(codeOnly).not.toContain("releasePatientIdLock");
  });

  it("emergency reconcile and self-registration share the same allocator", () => {
    expect(reconcileSrc).toContain("nextPatientId");
    expect(reconcileSrc).not.toMatch(/pg_advisory_xact_lock\(hashtext\('care_erp_patient_id'\)\)/);
    expect(selfRegSrc).toContain("nextPatientId(db)");
    expect(selfRegSrc).not.toContain("patientCounterTable");
  });
});
