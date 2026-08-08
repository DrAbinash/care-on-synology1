import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards denser spine formats in structuredReportTemplates.ts PRESETS.
 * Reads source (no DB) so CI stays hermetic.
 */
describe("spine structured-report preset density", () => {
  const src = readFileSync(
    join(__dirname, "structuredReportTemplates.ts"),
    "utf8",
  );

  function sectionLabelsForTemplate(templateName: string): string[] {
    const marker = `templateName: "${templateName}"`;
    const start = src.indexOf(marker);
    expect(start, `missing preset ${templateName}`).toBeGreaterThanOrEqual(0);
    const slice = src.slice(start, start + 4500);
    const next = slice.indexOf('templateName: "', marker.length);
    const scoped = next > 0 ? slice.slice(0, next) : slice;
    return [...scoped.matchAll(/\{\s*label:\s*"([^"]+)"/g)].map((m) => m[1]!);
  }

  it("MRI LS Spine includes per-level discs + facet/LF/canal", () => {
    const labels = sectionLabelsForTemplate("MRI LS Spine");
    expect(labels).toEqual(expect.arrayContaining([
      "L1-L2", "L4-L5", "L5-S1", "Facet Joints", "Ligamentum Flavum", "Spinal Canal",
    ]));
    expect(labels.length).toBeGreaterThanOrEqual(12);
  });

  it("MRI Cervical Spine expands per-level C2–C7 (not bundled pack)", () => {
    const labels = sectionLabelsForTemplate("MRI Cervical Spine");
    expect(labels).toEqual(expect.arrayContaining([
      "C2-C3", "C3-C4", "C4-C5", "C5-C6", "C6-C7", "C7-T1", "Craniovertebral Junction",
    ]));
    expect(src).not.toMatch(
      /templateName: "MRI Cervical Spine"[\s\S]{0,800}label: "C2-C3 to C6-C7"/,
    );
    expect(labels.length).toBeGreaterThanOrEqual(13);
  });

  it("MRI Dorsal Spine expands per-level T1–T12 discs", () => {
    const labels = sectionLabelsForTemplate("MRI Dorsal Spine");
    expect(labels).toEqual(expect.arrayContaining([
      "T1-T2", "T5-T6", "T11-T12", "Spinal Canal", "Spinal Cord",
    ]));
    expect(labels.length).toBeGreaterThanOrEqual(16);
  });

  it("exposes upgrade-spine-formats admin route", () => {
    expect(src).toContain('"/upgrade-spine-formats"');
    expect(src).toContain("syncStructuredReportPresets");
    expect(src).toContain("upgradeSpineFindingSections");
  });
});
