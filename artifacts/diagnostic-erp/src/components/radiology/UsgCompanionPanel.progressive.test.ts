// §9 — USG Companion progressive-disclosure guard.
//
// The companion panel defaults to a BASIC view (clinical essentials only) and
// hides technical/advanced detail — the provenance ledger (what came from
// where), the completeness/confidence metrics, and the pipeline timeline —
// behind a persisted Advanced toggle. Capability is never removed, only
// disclosed on demand. This static test pins that structure so a future edit
// can't (a) drop the toggle, (b) expose the advanced sections in Basic, or
// (c) accidentally gate a Basic clinical control behind Advanced.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "UsgCompanionPanel.tsx"), "utf8");

test("Basic is the default and the choice is persisted", () => {
  // default false (Basic) unless localStorage says otherwise
  expect(SRC).toMatch(/localStorage\.getItem\("usg-companion-advanced"\)\s*===\s*"1"/);
  expect(SRC).toMatch(/localStorage\.setItem\("usg-companion-advanced"/);
  expect(SRC).toMatch(/data-testid="companion-advanced-toggle"/);
});

test("technical/advanced sections are gated behind the Advanced toggle", () => {
  // Report Confidence (workflow completeness metrics) — advanced only
  expect(SRC).toMatch(/\{advanced && data && \(/);
  // Companion Timeline (pipeline stages) — advanced only
  expect(SRC).toMatch(/Timeline \(Advanced[\s\S]{0,80}\{advanced && \(/);
  // Provenance ledger detail — Basic shows a summary, Advanced shows sources
  expect(SRC).toMatch(/\) : !advanced \? \(/);
});

test("Basic clinical controls are NOT hidden behind Advanced", () => {
  // The one-click actions block (Suggest history / Apply protocol / Template /
  // Copilot) and Machine Measurements must remain visible in Basic — they sit
  // outside any `advanced &&` gate. Assert those anchors exist and are not
  // immediately preceded by an advanced gate.
  for (const anchor of ["Machine Measurements", "Suggest history", "One-click actions"]) {
    expect(SRC).toContain(anchor);
  }
  // crude but effective: the actions block opens with `{!props.disabled && (`,
  // never `{advanced && ... disabled`.
  expect(SRC).toMatch(/\{!props\.disabled && \(\s*<div className="flex flex-wrap gap-1\.5 pt-1/);
});
