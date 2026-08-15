import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const authSrc = readFileSync(join(__dirname, "requireStaffAuth.ts"), "utf8");
const billsSrc = readFileSync(join(__dirname, "../routes/bills.ts"), "utf8");

describe("billing pathway green — auth + counter allocation", () => {
  test("staff auth caches session+user for the second half of desk save", () => {
    expect(authSrc).toContain("staff-auth:");
    expect(authSrc).toContain("STAFF_AUTH_CACHE_TTL_MS");
    expect(authSrc).toContain("invalidateStaffAuthCache");
    expect(authSrc).toContain("Cache hit: skip session + user SELECTs");
    // Throttle portal_sessions writes — feature-flags polling was starving the pool
    expect(authSrc).toContain("SESSION_DB_TOUCH_MIN_INTERVAL_MS");
    expect(authSrc).toContain("lastDbTouchAtMs");
  });

  test("bill create preloads patient and allocates via document_number_counters", () => {
    expect(billsSrc).toContain("patientPreload");
    expect(billsSrc).toContain("Patient was preloaded in the guard wave");
    expect(billsSrc).toContain("nextDocumentCounter");
    expect(billsSrc).toContain('nextDocumentCounter(dbHandle, "bill", "global")');
    const codeOnly = billsSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("care_erp_bill_number");
    expect(codeOnly).not.toMatch(/pg_advisory_xact_lock/);
  });
});
