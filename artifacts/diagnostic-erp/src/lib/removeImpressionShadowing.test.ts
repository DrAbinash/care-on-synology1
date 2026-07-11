import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeImpression, removeImpression } from "./quickFindingsMerge";

/**
 * Bug-001 regression coverage.
 *
 * RadiologyReportingWorkspace.tsx declared a local
 * `function removeImpression(index: number)` (the by-index bullet-delete
 * handler for the manual trash-can button) with the same name as the
 * imported pure `removeImpression(lines, line)` from quickFindingsMerge.
 * Because function declarations hoist to the top of their enclosing scope,
 * the local declaration shadowed the import for the component's ENTIRE
 * body — including applyRendered's call, which sits textually earlier in
 * the file. Confirmed via tsc (TS2345 + TS2554 at the call site) before the
 * fix: Quick Select's deselect path was silently calling the wrong
 * function and never actually removed the generated impression bullet.
 *
 * Fix: renamed the local function to deleteImpressionLineAt so the import
 * resolves correctly; no other logic changed.
 *
 * Ticket F1b later extracted applyRendered's entire remove/merge sequence
 * into renderEngine.ts's applyRenderedTransition (a pure function) — so
 * RadiologyReportingWorkspace.tsx no longer imports quickFindingsMerge's
 * removeImpression directly at all, and the two structural checks below
 * that used to assert on that direct import/call were updated accordingly.
 * This is a strictly stronger guarantee than before: the collision-prone
 * import isn't present in this file anymore, so Bug-001's exact failure
 * mode (a local declaration shadowing it) is now structurally impossible
 * here, not just avoided by naming. renderEngine.ts imports the pure
 * function under an aliased name (_removeImpression) specifically to avoid
 * re-introducing the same class of collision there.
 *
 * Two complementary guards below, since applyRendered itself cannot be
 * unit-tested directly — it lives inside a component that imports `@/`-
 * aliased modules the root vitest config can't resolve (same constraint
 * documented in lib/radiologyDraftId.ts):
 *   1. A source-text structural check (same technique as
 *      lib/dockerCompose.test.ts) proving the shadowing shape can't
 *      silently reappear.
 *   2. A pure-function behavioral check proving the exact merge/remove
 *      sequence applyRendered performs on select-then-deselect correctly
 *      round-trips once wired to the real quickFindingsMerge functions.
 */

const WORKSPACE_PATH = resolve(__dirname, "../pages/RadiologyReportingWorkspace.tsx");

describe("RadiologyReportingWorkspace.tsx — removeImpression shadowing regression guard (Bug-001)", () => {
  const source = readFileSync(WORKSPACE_PATH, "utf-8");

  test("no local function named removeImpression is declared (would re-shadow the import)", () => {
    expect(/\bfunction\s+removeImpression\s*\(/.test(source)).toBe(false);
  });

  test("the by-index bullet-delete function exists under its renamed, non-colliding name", () => {
    expect(/\bfunction\s+deleteImpressionLineAt\s*\(\s*index:\s*number\s*\)/.test(source)).toBe(true);
  });

  test("the component no longer imports quickFindingsMerge's removeImpression directly (Ticket F1b moved it into renderEngine)", () => {
    const importBlock = source.match(
      /import QuickFindingsPanel,\s*\{([\s\S]*?)\}\s*from\s*"@\/components\/radiology\/QuickFindingsPanel";/,
    );
    expect(importBlock, "expected the QuickFindingsPanel import block to exist").not.toBeNull();
    expect(importBlock![1]).not.toMatch(/\bremoveImpression\b/);
  });

  test("applyRendered calls renderEngine's applyRenderedTransition (which internally uses the correct removeImpression)", () => {
    const importBlock = source.match(/import\s*\{([\s\S]*?)\}\s*from\s*"@\/lib\/renderEngine";/);
    expect(importBlock, "expected a @/lib/renderEngine import block to exist").not.toBeNull();
    expect(importBlock![1]).toMatch(/\bapplyRenderedTransition\b/);
    expect(/applyRenderedTransition\(/.test(source)).toBe(true);
  });
});

describe("Quick Select deselect removes its generated impression bullet (Bug-001, behavioral)", () => {
  test("select-then-deselect round-trips an impression bullet back to empty — the exact sequence applyRendered performs", () => {
    const generatedLine = "Moderate disc bulge at L4-5.";

    const afterSelect = mergeImpression([], generatedLine); // handleQuickToggle's select path
    expect(afterSelect).toEqual([generatedLine]);

    const afterDeselect = removeImpression(afterSelect, generatedLine); // applyRendered's remove path, now correctly wired
    expect(afterDeselect).toEqual([]);
  });

  test("deselecting one finding does not remove a different finding's impression bullet", () => {
    const lineA = "Moderate disc bulge at L4-5.";
    const lineB = "Mild right foraminal stenosis.";
    const afterBothSelected = mergeImpression(mergeImpression([], lineA), lineB);
    expect(afterBothSelected).toEqual([lineA, lineB]);

    const afterDeselectA = removeImpression(afterBothSelected, lineA);
    expect(afterDeselectA).toEqual([lineB]);
  });

  test("a manually-edited bullet is preserved on deselect — exact-match removal only, edits always win", () => {
    const generatedLine = "Moderate disc bulge at L4-5.";
    const edited = ["Moderate disc bulge at L4-5, radiologist-confirmed."]; // no longer an exact match
    expect(removeImpression(edited, generatedLine)).toEqual(edited); // no-op, edit preserved
  });
});
