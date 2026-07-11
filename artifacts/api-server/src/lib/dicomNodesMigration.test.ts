import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Regression test for the startup migration bug where the API crashed on
// restart with: column "pull_interval_seconds" of relation "dicom_nodes" already exists
//
// The migration in index.ts must be idempotent: it must not blindly
// `RENAME COLUMN pull_interval_minutes TO pull_interval_seconds` without
// first checking whether the destination column already exists.

describe("dicom_nodes startup migration (idempotency)", () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, "..", "index.ts"),
    "utf-8"
  );

  // Isolate just the dicom_nodes rename migration block for focused assertions.
  const blockMatch = indexSource.match(
    /-- Rename old dicom_nodes columns[\s\S]*?END \$\$;/
  );

  it("contains the dicom_nodes column-rename migration block", () => {
    expect(blockMatch).not.toBeNull();
  });

  const block = blockMatch ? blockMatch[0] : "";

  it("checks for pull_interval_seconds existing before renaming pull_interval_minutes", () => {
    // Must check has_seconds (or equivalent existence check) before the rename,
    // so it never blindly renames into a column that already exists.
    expect(block).toMatch(/has_seconds/);
    expect(block).toMatch(/has_minutes AND NOT has_seconds/);
  });

  it("does not perform an unconditional RENAME COLUMN pull_interval_minutes", () => {
    // The old buggy pattern: renaming without checking destination existence first.
    // Every RENAME COLUMN pull_interval_minutes must be inside a conditional branch
    // that already confirmed pull_interval_seconds does not exist.
    const renameLines = block
      .split("\n")
      .filter((l) => l.includes("RENAME COLUMN pull_interval_minutes"));
    expect(renameLines.length).toBeGreaterThan(0);

    // Ensure the rename is preceded (within the block) by the has_minutes AND NOT has_seconds guard.
    const guardIndex = block.indexOf("has_minutes AND NOT has_seconds");
    const renameIndex = block.indexOf("RENAME COLUMN pull_interval_minutes");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(renameIndex).toBeGreaterThan(guardIndex);
  });

  it("handles the case where both columns exist without crashing (drops legacy column instead)", () => {
    expect(block).toMatch(/has_minutes AND has_seconds/);
    expect(block).toMatch(/DROP COLUMN pull_interval_minutes/);
  });

  it("applies the same idempotent pattern to pull_query_days -> query_lookback_hours", () => {
    expect(block).toMatch(/has_pull_query_days AND NOT has_lookback_hours/);
    expect(block).toMatch(/has_pull_query_days AND has_lookback_hours/);
  });
});
