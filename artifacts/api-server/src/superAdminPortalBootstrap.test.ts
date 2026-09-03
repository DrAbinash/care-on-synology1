import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("super-admin portal bootstrap safety", () => {
  it("bootstrap HTML marks #root with data-sa-bootstrap for USB UI createRoot gate", () => {
    const app = readFileSync(join(__dirname, "app.ts"), "utf8");
    expect(app).toMatch(/data-sa-bootstrap="1"/);
    expect(app).toMatch(/\/\^\\\/super-admin-portal/);
  });
});
