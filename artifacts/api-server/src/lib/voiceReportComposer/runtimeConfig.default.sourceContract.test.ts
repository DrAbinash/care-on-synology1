/**
 * @vitest-environment node
 *
 * Source contract: the compose timeout DEFAULT is 90 seconds.
 *
 * Owner approval (2026-10-23, deploy-gate recommendation doc): 45 s measured
 * a 3.1 % cold-start timeout rate (LS-1 rep 1, first request) and loses every
 * contended request (second concurrent dictation: 60.4 s; post-eviction
 * reload: 55.7 s) — 90 s covers the worst measured case with ~49 % margin.
 * Production runs on the DEFAULT (no clinic_settings override exists), so the
 * default IS the production setting; a silent revert to 45 would quietly
 * re-lose every contended/cold dictation while every DB-backed test stays
 * green. This pin makes that impossible.
 *
 * The clamp stays 10–120: an explicit clinic_settings value
 * (ollamaComposerTimeoutSeconds) still wins over the default.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "runtimeConfig.ts"), "utf8");

describe("compose timeout default (source contract)", () => {
  it("defaults to 90 seconds — the approved deploy-gate value", () => {
    // The initializer and the row fallback must BOTH say 90.
    const inits = source.match(/let timeoutSeconds = (\d+);/);
    expect(inits?.[1], "timeout initializer not found").toBe("90");
    const fallback = source.match(/row\.ollamaComposerTimeoutSeconds \?\? (\d+)/);
    expect(fallback?.[1], "row fallback not found").toBe("90");
  });

  it("keeps the 10–120 second clamp — explicit settings still win", () => {
    expect(source).toMatch(/Math\.max\(10, Math\.min\(120, Number\(row\.ollamaComposerTimeoutSeconds/);
  });
});
