import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("save-draft structured format persist status", () => {
  const src = readFileSync(join(__dirname, "radiology-report-generator.ts"), "utf8");

  it("returns formatStatePersistFailed instead of hiding persist errors", () => {
    expect(src).toContain("let formatStatePersistFailed = false");
    expect(src).toContain("formatStatePersistFailed = true");
    expect(src).toContain("res.json({ success: true, draft, formatStatePersistFailed })");
  });
});
