/**
 * Parity contract: domain validateBaselineManifest and shared structural
 * validation agree on supported Phase-2 structure + ownership slot identity.
 *
 * Separation of responsibilities (intentional, not drift):
 * - Shared / API: kind, version, revision, observation shape, renderedText
 *   presence, ownership uniqueness via persistenceOwnershipSlotKey
 *   (region|concept|level|laterality with normalizeLevel/Laterality).
 * - Domain materialize: additionally builds canon-aware slotKeys via
 *   buildCanonicalObservation so alias collapse fails closed at apply time.
 * Persistence does NOT import the clinical concept canon.
 */
import { describe, expect, it } from "vitest";
import {
  FULL_REPORT_BASELINE_KIND,
  validateBaselineManifestStructure,
} from "@workspace/baseline-manifest";
import { ownedBaselineCatalog } from "./baselines";
import { validateBaselineManifest } from "./fullReportBaseline";

describe("domain ↔ shared baselineManifest parity", () => {
  it("all Phase-2 owned baselines pass both structural and domain gates", () => {
    for (const entry of ownedBaselineCatalog()) {
      const format = {
        findings: entry.findings,
        impression: entry.impression,
        bodyPart: entry.bodyPart,
        baselineManifest: entry.manifest,
      };
      const structural = validateBaselineManifestStructure({
        findings: entry.findings,
        impression: entry.impression,
        defaultRegion: entry.bodyPart,
        baselineManifest: entry.manifest,
      });
      const domain = validateBaselineManifest(format, entry.bodyPart);
      expect(structural, entry.name).toEqual({ ok: true, reason: "ok", details: [] });
      expect(domain, entry.name).toEqual({ ok: true, missing: [], duplicateSlots: [] });
    }
  });

  it("rejects the same malformed structure at both gates", () => {
    const findings = "Normal lumbar lordosis is maintained.";
    const impression = "Normal study.";
    const format = {
      findings,
      impression,
      bodyPart: "LS Spine",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1 as const,
        revision: "r1",
        observations: [
          {
            id: "a",
            field: "findings" as const,
            concept: "alignment",
            conflictGroup: "alignment",
            anatomicalSection: "alignment",
            renderedText: findings,
          },
          {
            id: "b",
            field: "findings" as const,
            concept: "alignment",
            conflictGroup: "alignment",
            anatomicalSection: "alignment",
            level: "  ",
            renderedText: findings,
          },
        ],
      },
    };
    const structural = validateBaselineManifestStructure({
      findings,
      impression,
      defaultRegion: "LS Spine",
      baselineManifest: format.baselineManifest,
    });
    const domain = validateBaselineManifest(format, "LS Spine");
    expect(structural.ok).toBe(false);
    expect(domain.ok).toBe(false);
    expect(domain.duplicateSlots.length + domain.missing.length).toBeGreaterThan(0);
  });

  it("rejects normalized level collisions at both gates", () => {
    const line = "No disc bulge at L4-L5.";
    const format = {
      findings: `${line}\n${line}`,
      impression: "Normal.",
      bodyPart: "LS Spine",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1 as const,
        revision: "r1",
        observations: [
          {
            id: "a",
            field: "findings" as const,
            concept: "disc_contour",
            conflictGroup: "disc_contour",
            anatomicalSection: "disc",
            level: "L4-L5",
            renderedText: line,
          },
          {
            id: "b",
            field: "findings" as const,
            concept: "disc_contour",
            conflictGroup: "disc_contour",
            anatomicalSection: "disc",
            level: "L4/L5",
            renderedText: line,
          },
        ],
      },
    };
    expect(
      validateBaselineManifestStructure({
        findings: format.findings,
        impression: format.impression,
        defaultRegion: "LS Spine",
        baselineManifest: format.baselineManifest,
      }).ok,
    ).toBe(false);
    expect(validateBaselineManifest(format, "LS Spine").ok).toBe(false);
  });
});
