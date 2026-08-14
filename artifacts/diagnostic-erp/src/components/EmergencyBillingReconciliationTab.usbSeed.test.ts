import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const tab = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "EmergencyBillingReconciliationTab.tsx"),
  "utf8",
);

describe("USB seed download is super-admin ERP login only", () => {
  it("hides the download behind isSuperAdmin and calls the gated API", () => {
    expect(tab).toContain('normalizeRole(readStaffSession()?.user.role ?? "") === "super_admin"');
    expect(tab).toContain("{isSuperAdmin ? (");
    expect(tab).toContain('data-testid="emergency-usb-seed"');
    expect(tab).toContain("/api/emergency-billing/usb-seed");
    expect(tab).toContain("USB seed download is available only when logged in as super admin.");
  });
});
