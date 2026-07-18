// Grounding CI as a test gate (Gate G1). Runs the zero-dependency
// documentation<->code grounding checker; a non-zero exit (any architecture
// claim contradicted by the code) fails the test suite. This is what makes
// `pnpm test` and CI reject a build where the docs and code disagree.
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

test("architecture grounding manifest matches the code (scripts/grounding-check.cjs)", () => {
  const script = path.join(here, "grounding-check.cjs");
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  // Surface the checker's report on failure so the diff is obvious in CI logs.
  if (result.status !== 0) {
    throw new Error(`grounding-check failed:\n${result.stdout}\n${result.stderr}`);
  }
  expect(result.status).toBe(0);
});
