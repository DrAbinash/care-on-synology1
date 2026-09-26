/**
 * Phase-1 baseline ↔ Phase-4 parity gate for RadiologyReportingWorkspace testids.
 * Scans the page plus radiology-workspace hooks and shell components.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures/radiologyReportingWorkspace.testids.json");
const workspacePath = join(here, "../pages/RadiologyReportingWorkspace.tsx");
const hooksDir = join(here, "../hooks/radiology-workspace");
const shellDir = join(here, "../components/radiology/workspace");

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

function readTree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const chunks: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".ts") || name.endsWith(".tsx")) {
      chunks.push(readFileSync(join(dir, name), "utf8"));
    }
  }
  return chunks;
}

function scanWorkspaceTree(): TestIdFixture {
  const chunks = [
    readFileSync(workspacePath, "utf8"),
    ...readTree(hooksDir),
    ...readTree(shellDir),
  ];
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
