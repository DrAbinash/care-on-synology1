import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const headerSrc = readFileSync(resolve(__dirname, "./PageHeader.tsx"), "utf8");
const doctorsSrc = readFileSync(resolve(__dirname, "../pages/Doctors.tsx"), "utf8");
const testsSrc = readFileSync(resolve(__dirname, "../pages/Tests.tsx"), "utf8");

describe("PageHeader — mobile action buttons wrap instead of clipping", () => {
  it("uses a full-width flex-wrap actions row so toolbar buttons stay on screen", () => {
    expect(headerSrc).toContain('data-testid="page-header-actions"');
    expect(headerSrc).toMatch(/w-full sm:w-auto[\s\S]{0,120}flex flex-wrap/);
    expect(headerSrc).toContain("min-w-0");
  });

  it("flattens legacy single-row action wrappers via display:contents", () => {
    expect(headerSrc).toContain("[&>div]:contents");
  });
});

describe("Doctors & Test Catalog — primary add action visible on mobile", () => {
  it("puts Add Doctor first in the mobile toolbar order", () => {
    expect(doctorsSrc).toContain('className="order-first sm:order-last"');
    expect(doctorsSrc).toContain("Add Doctor");
    expect(doctorsSrc).not.toMatch(/actions=\{\s*\n\s*<div className="flex gap-2">/);
  });

  it("puts Add Test first in the mobile toolbar order", () => {
    expect(testsSrc).toContain('className="order-first sm:order-last"');
    expect(testsSrc).toContain("Add Test");
    expect(testsSrc).not.toMatch(/actions=\{\s*\n\s*<div className="flex gap-2">/);
  });
});
