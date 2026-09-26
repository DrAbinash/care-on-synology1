/**
 * Phase-1 baseline ↔ Phase-3 parity gate for RadiologyReportingWorkspace testids.
 * Scans the page plus Phase-2 hooks (querySelector templates may live in hooks).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures/radiologyReportingWorkspace.testids.json");
const workspacePath = join(here, "../pages/RadiologyReportingWorkspace.tsx");
const hooksDir = join(here, "../hooks/radiology-workspace");

type TestIdFixture = {
  declaredInJsx: string[];
  dynamicJsxPatterns: string[];
  querySelectorTemplates: string[];
};

function scanSource(src: string): TestIdFixture {
  const declaredInJsx = [...src.matchAll(/data-testid="([^"$]+)"/g)].map((m) => m[1]);
  const dynamicJsxPatterns = [...src.matchAll(/data-testid=\{`([^`]+)`\}/g)].map((m) => m[1]);
  const querySelectorTemplates = [
    ...src.matchAll(/data-testid=["']([^"']*\$\{[^}]+\}[^"']*)["']/g),
  ].map((m) => m[1]);
  return {
    declaredInJsx: [...new Set(declaredInJsx)].sort(),
    dynamicJsxPatterns: [...new Set(dynamicJsxPatterns)].sort(),
    querySelectorTemplates: [...new Set(querySelectorTemplates)].sort(),
  };
}

function scanWorkspaceTree(): TestIdFixture {
  const chunks = [readFileSync(workspacePath, "utf8")];
  try {
    for (const name of readdirSync(hooksDir)) {
      if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        chunks.push(readFileSync(join(hooksDir, name), "utf8"));
      }
    }
  } catch { /* hooks dir optional on older baselines */ }
  return scanSource(chunks.join("\n"));
}

describe("RadiologyReportingWorkspace data-testid inventory (Phase 1 fixture)", () => {
  it("matches the committed Phase-1 baseline fixture", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as TestIdFixture;
    const live = scanWorkspaceTree();
    expect(live.declaredInJsx).toEqual(fixture.declaredInJsx);
    expect(live.dynamicJsxPatterns).toEqual(fixture.dynamicJsxPatterns);
    expect(live.querySelectorTemplates).toEqual(fixture.querySelectorTemplates);
  });
});
