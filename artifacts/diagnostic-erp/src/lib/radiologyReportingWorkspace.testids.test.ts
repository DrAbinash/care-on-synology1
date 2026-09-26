/**
 * Phase-1 baseline ↔ Phase-3 parity gate for RadiologyReportingWorkspace testids.
 * Fails if JSX gains/loses a data-testid without updating the fixture.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures/radiologyReportingWorkspace.testids.json");
const workspacePath = join(here, "../pages/RadiologyReportingWorkspace.tsx");

type TestIdFixture = {
  declaredInJsx: string[];
  dynamicJsxPatterns: string[];
  querySelectorTemplates: string[];
};

function scanWorkspace(src: string): Omit<TestIdFixture, never> {
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

describe("RadiologyReportingWorkspace data-testid inventory (Phase 1 fixture)", () => {
  it("matches the committed Phase-1 baseline fixture", () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as TestIdFixture;
    const live = scanWorkspace(readFileSync(workspacePath, "utf8"));
    expect(live.declaredInJsx).toEqual(fixture.declaredInJsx);
    expect(live.dynamicJsxPatterns).toEqual(fixture.dynamicJsxPatterns);
    expect(live.querySelectorTemplates).toEqual(fixture.querySelectorTemplates);
  });
});
