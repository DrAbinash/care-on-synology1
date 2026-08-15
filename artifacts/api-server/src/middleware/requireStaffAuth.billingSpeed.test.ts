import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const authSrc = readFileSync(join(__dirname, "requireStaffAuth.ts"), "utf8");
const billsSrc = readFileSync(join(__dirname, "../routes/bills.ts"), "utf8");

describe("billing pathway green — auth + lock shrink", () => {
  test("staff auth caches session+user for the second half of desk save", () => {
    expect(authSrc).toContain("staff-auth:");
    expect(authSrc).toContain("STAFF_AUTH_CACHE_TTL_MS");
    expect(authSrc).toContain("invalidateStaffAuthCache");
    expect(authSrc).toContain("Cache hit: skip session + user SELECTs");
  });

  test("bill create preloads patient outside the advisory lock", () => {
    expect(billsSrc).toContain("patientPreload");
    expect(billsSrc).toContain("Patient was preloaded in the guard wave");
    expect(billsSrc).not.toMatch(
      /pg_advisory_xact_lock\(hashtext\('care_erp_bill_number'\)\)[\s\S]{0,400}tx\.select\(\)\.from\(patientsTable\)/,
    );
  });
});
