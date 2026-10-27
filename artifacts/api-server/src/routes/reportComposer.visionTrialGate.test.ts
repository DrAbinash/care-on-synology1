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

// The picture-set rule is executed, not grepped — see
// `../lib/reportComposer/trialImageSet.test.ts`, eleven cases that run in CI without a
// database. What cannot be executed there is the wiring: that the handler actually calls
// the normaliser, and refuses before it reaches a provider. That is what this block pins,
// in the one file that can read the route's source without importing it.
//
// A windowed source-scan is only meaningful if the window is real, so the first case
// asserts the slice length. An empty window makes every `not.toMatch` below pass by
// accident, which is the failure mode this convention has produced before.

const trialStart = source.indexOf(`post("/vision-trial"`);
const handler = source.slice(
  trialStart,
  source.indexOf("reportComposerRouter.post(", trialStart + 1),
);
// The handler explains the retired `.slice(0, 6)` in a comment, and a comment is not code.
// Scanning the raw text would make the negative assertions below fail on the prose that
// documents the fix, which is the wrong kind of red.
const handlerCode = handler.replace(/^\s*\/\/.*$/gm, "");

describe("POST /vision-trial picture set wiring", () => {
  test("the window under test is the real handler", () => {
    expect(trialStart).toBeGreaterThan(0);
    expect(handler.length).toBeGreaterThan(600);
    expect(handler).toContain("runDeepSeekVisionAbTrial(");
  });

  test("the set goes through the whole-set normaliser", () => {
    expect(handlerCode).toContain("normalizeTrialImageSet(body.images)");
  });

  test("a refused set answers 400 before any provider is reached", () => {
    expect(handlerCode).toMatch(/res\.status\(400\)/);
    expect(handlerCode.indexOf("if (!imageSet.ok)")).toBeGreaterThan(-1);
    expect(handlerCode.indexOf("if (!imageSet.ok)")).toBeLessThan(
      handlerCode.indexOf("runDeepSeekVisionAbTrial("),
    );
  });

  test("nothing in the handler trims or drops pictures", () => {
    expect(handlerCode).not.toMatch(/\.slice\(0,\s*\d+\)/);
    expect(handlerCode).not.toMatch(/\.filter\(\(x\): x is NonNullable/);
    expect(handlerCode).not.toMatch(/return null;/);
  });
});
