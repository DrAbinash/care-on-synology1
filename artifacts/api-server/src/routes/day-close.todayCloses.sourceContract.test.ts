import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("staff-status exposes today's multi-close history", () => {
  it("API returns todayCloses and UI lists every same-day staff close", () => {
    const api = readFileSync(join(__dirname, "day-close.ts"), "utf8");
    expect(api).toContain("todayCloses");
    expect(api).toContain("beforeCurrentWindow");
    expect(api).toContain("todayCloseCountByUser");
    expect(api).toContain("todayIST");

    const ui = readFileSync(
      join(__dirname, "../../../diagnostic-erp/src/pages/DayClose.tsx"),
      "utf8",
    );
    expect(ui).toContain("Today&apos;s staff closes");
    expect(ui).toContain("todayCloses");
    expect(ui).toContain("todayCloseCount");
    expect(ui).toContain("Before overall close");
  });
});
