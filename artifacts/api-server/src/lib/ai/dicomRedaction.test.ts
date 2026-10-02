import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DICOM_REDACTION_PERFORMED } from "./dicomRedaction";

// These guard a specific class of defect: an AI audit row or a settings banner
// asserting that identifiers were removed when no code path removes any. The
// route-level behaviour is covered in routes/aiReporting.query.test.ts; what
// cannot be covered there is the other seven audit inserts, so they are
// asserted statically — a literal in source is a static property.

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = join(here, "..", "..", "routes");

/** Every route file that writes an AI audit row. */
const auditWriters = readdirSync(routesDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .filter((f) => readFileSync(join(routesDir, f), "utf8").includes("aiReportingAuditLogsTable"))
  .map((f) => join(routesDir, f));

describe("AI privacy record", () => {
  test("no de-identification is performed, so the record cannot claim otherwise", () => {
    expect(DICOM_REDACTION_PERFORMED).toBe(false);
  });

  test("the audit surface is where we expect it", () => {
    expect(auditWriters.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of auditWriters) {
    const name = file.split(/[\\/]/).pop() as string;
    const source = readFileSync(file, "utf8");

    test(`${name} never files a hard-coded 'identifiers were removed'`, () => {
      expect(source).not.toMatch(/anonymized:\s*true/);
      for (const hit of source.match(/anonymized:\s*[A-Za-z_]\w*/g) ?? []) {
        expect(hit).toBe("anonymized: DICOM_REDACTION_PERFORMED");
      }
    });
  }

  test("the prompt never tells the model identifiers were removed", () => {
    for (const file of auditWriters) {
      expect(readFileSync(file, "utf8")).not.toMatch(/identifiers have been removed/i);
    }
  });
});
