import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../../");
const schema = readFileSync(resolve(__dirname, "structuredReportTemplates.ts"), "utf8");
const migration = readFileSync(resolve(repoRoot, "migrations/zzzz_structured_format_v2.sql"), "utf8");

describe("structured_report_templates v2 columns", () => {
  it("Drizzle schema declares additive v2 columns with snake_case SQL names", () => {
    expect(schema).toContain('integer("schema_version")');
    expect(schema).toContain('integer("format_version")');
    expect(schema).toContain('boolean("is_default")');
    expect(schema).toContain('text("tags")');
    expect(schema).toContain('text("protocol_key")');
    expect(schema).toContain('integer("parent_id")');
    expect(schema).toContain('text("previous_versions")');
    expect(schema).toContain('timestamp("archived_at"');
    expect(schema).toContain('onDelete: "set null"');
  });

  it("feature migration adds the same columns idempotently (snake_case, matching Drizzle)", () => {
    for (const col of [
      "schema_version",
      "format_version",
      "is_default",
      "tags",
      "protocol_key",
      "parent_id",
      "previous_versions",
      "archived_at",
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    expect(migration).toContain("srt_parent_id_fkey");
    expect(migration).toContain("ON DELETE SET NULL");
  });
});
