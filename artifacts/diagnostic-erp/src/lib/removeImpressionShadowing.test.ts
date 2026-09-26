import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { mergeImpression, removeImpression } from "./quickFindingsMerge";

/**
 * Bug-001 regression coverage.
 *
 * Originally guarded the monolith's local `function removeImpression` shadowing
 * the quickFindingsMerge import. The monolith snapshot was deleted after Phase 4;
 * modular Quick Select uses `applyPathologyOverlay` via `handleQuickToggle` and
 * must not reintroduce a colliding local `removeImpression` declaration.
 */

const ERP_SRC = resolve(__dirname, "..");

function readWorkspaceSrc(): string {
  const chunks = [readFileSync(join(ERP_SRC, "pages/RadiologyReportingWorkspace.tsx"), "utf8")];
  for (const dir of ["hooks/radiology-workspace", "components/radiology/workspace"]) {
    for (const name of readdirSync(join(ERP_SRC, dir))) {
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        chunks.push(readFileSync(join(ERP_SRC, dir, name), "utf8"));
      }
    }
  }
  return chunks.join("\n");
}

describe("RadiologyReportingWorkspace (modular) — removeImpression shadowing regression guard (Bug-001)", () => {
  const source = readWorkspaceSrc();

  test("no local function named removeImpression is declared (would re-shadow an import)", () => {
    expect(/\bfunction\s+removeImpression\s*\(/.test(source)).toBe(false);
  });

  test("Quick Select toggle routes through applyPathologyOverlay (no shadowed removeImpression path)", () => {
    expect(source).toContain("applyPathologyOverlay");
    expect(source).toContain("handleQuickToggle");
  });
});

describe("Quick Select deselect removes its generated impression bullet (Bug-001, behavioral)", () => {
  test("select-then-deselect round-trips an impression bullet back to empty — the exact sequence applyRendered performs", () => {
    const generatedLine = "Moderate disc bulge at L4-5.";

    const afterSelect = mergeImpression([], generatedLine);
    expect(afterSelect).toEqual([generatedLine]);

    const afterDeselect = removeImpression(afterSelect, generatedLine);
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
    const edited = ["Moderate disc bulge at L4-5, radiologist-confirmed."];
    expect(removeImpression(edited, generatedLine)).toEqual(edited);
  });
});
