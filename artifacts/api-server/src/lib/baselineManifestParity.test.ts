/**
 * Parity contract: API persistence wrapper and shared structural validator
 * must agree on supported structure + ownership slot identity.
 *
 * Domain materialize adds concept-canon awareness (separate responsibility);
 * see diagnostic-erp baselineManifestParity.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  FULL_REPORT_BASELINE_KIND,
  validateBaselineManifestStructure,
} from "@workspace/baseline-manifest";
import { validateBaselineManifestForPersistence } from "./baselineManifestValidation";

function sampleValid() {
  return {
    findings: "Normal lumbar lordosis is maintained.",
    impression: "Normal study.",
    defaultRegion: "LS Spine",
    baselineManifest: {
      kind: FULL_REPORT_BASELINE_KIND,
      version: 1,
      revision: "r1",
      observations: [
        {
          id: "alignment",
          field: "findings" as const,
          concept: "alignment",
          conflictGroup: "alignment",
          anatomicalSection: "alignment",
          renderedText: "Normal lumbar lordosis is maintained.",
        },
        {
          id: "imp",
          field: "impression" as const,
          concept: "normal_study",
          conflictGroup: "normal_study",
          anatomicalSection: "",
          renderedText: "Normal study.",
        },
      ],
    },
  };
}

describe("API ↔ shared baselineManifest parity", () => {
  it("accepts the same valid supported manifest", () => {
    const sample = sampleValid();
    expect(validateBaselineManifestStructure(sample).ok).toBe(true);
    expect(validateBaselineManifestForPersistence(sample).ok).toBe(true);
  });

  it("rejects unknown kind with the same unsupported signal", () => {
    const sample = sampleValid();
    sample.baselineManifest.kind = "care.full_report_baseline.v99";
    const structural = validateBaselineManifestStructure(sample);
    const api = validateBaselineManifestForPersistence(sample);
    expect(structural.ok).toBe(false);
    expect(structural.unsupported).toBe(true);
    expect(api.ok).toBe(false);
    expect(api.status).toBe(422);
  });

  it("rejects duplicate ownership slots that differ only by field", () => {
    const sample = {
      findings: "Normal parenchyma.",
      impression: "Normal parenchyma.",
      defaultRegion: "Brain",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1,
        revision: "r1",
        observations: [
          {
            id: "a",
            field: "findings" as const,
            concept: "parenchyma",
            conflictGroup: "parenchyma",
            anatomicalSection: "parenchyma",
            renderedText: "Normal parenchyma.",
          },
          {
            id: "b",
            field: "impression" as const,
            concept: "parenchyma",
            conflictGroup: "parenchyma",
            anatomicalSection: "",
            renderedText: "Normal parenchyma.",
          },
        ],
      },
    };
    const structural = validateBaselineManifestStructure(sample);
    const api = validateBaselineManifestForPersistence(sample);
    expect(structural.ok).toBe(false);
    expect(api.ok).toBe(false);
    expect(api.status).toBe(400);
    expect(api.details?.some((d) => /duplicate ownership slot/i.test(d))).toBe(true);
  });

  it("treats null manifest as legacy-ok only at the API boundary", () => {
    expect(validateBaselineManifestForPersistence({ baselineManifest: null }).ok).toBe(true);
  });
});
