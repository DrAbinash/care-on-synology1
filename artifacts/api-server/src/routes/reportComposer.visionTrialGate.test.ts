import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

// Cloud image egress is meant to need an explicit admin opt-in. The
// /vision-trial route let the request body grant it twice over: directly, and
// again on the branch where the ops settings failed to load. That is a privacy
// gate the caller can open, so it is not a gate.
//
// Static guard, deliberately: reportComposerRouter pulls in the job queue, the
// compose engine and the database, so it has no no-database handler harness
// like aiReporting.query.test.ts has for /query. A literal assignment is a
// static property, and this catches the exact regression.

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "reportComposer.ts"), "utf8");

describe("POST /vision-trial cloud-vision gate", () => {
  test("the request body can never grant cloud vision", () => {
    expect(source).not.toMatch(/cloudVisionAllowed\s*=\s*body\.cloudVisionAllowed/);
    expect(source).not.toMatch(/if \(body\.cloudVisionAllowed === true\) cloudVisionAllowed = true/);
  });

  test("the only writer of the flag reads the admin setting", () => {
    const assignments = source.match(/cloudVisionAllowed = [^;\n]+/g) ?? [];
    expect(assignments.length).toBeGreaterThanOrEqual(2);
    for (const a of assignments) {
      expect(a).toMatch(/= false|ops\.deepseekCloudVisionAllowed === true/);
    }
  });
});
