import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("staff drawer status for My Daily Summary staff filter", () => {
  it("exposes admin staff-drawer-status and frontend uses it when filtering", () => {
    const api = readFileSync(join(__dirname, "day-close.ts"), "utf8");
    expect(api).toContain("buildDrawerStatusPayload");
    expect(api).toContain('dayCloseRouter.get("/staff-drawer-status/:userName"');
    expect(api).toContain("requireOwnerOrAdmin");

    const ui = readFileSync(
      join(__dirname, "../../../diagnostic-erp/src/pages/MyDailySummary.tsx"),
      "utf8",
    );
    expect(ui).toContain("staff-drawer-status");
    expect(ui).toContain("drawerStaffName");
    expect(ui).toMatch(/Shift window snapshot/);
    expect(ui).toMatch(/Calendar day \(IST\)/);
  });
});
