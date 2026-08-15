import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const mig = readFileSync(join(root, "migrations/zzzz_schema_drift_fix_indexes.sql"), "utf8");

describe("zzzz_schema_drift_fix_indexes accession policy", () => {
  test("does not recreate unique accession_uq (duplicates break care-db-patch-v2)", () => {
    expect(mig).not.toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+radiology_worklist_accession_uq/i);
    expect(mig).toContain("DROP INDEX IF EXISTS radiology_worklist_accession_uq");
    expect(mig).toContain("CREATE INDEX IF NOT EXISTS radiology_worklist_accession_idx");
  });
});
