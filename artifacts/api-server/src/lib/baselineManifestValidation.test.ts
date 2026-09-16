import { describe, expect, it } from "vitest";
import {
  FULL_REPORT_BASELINE_KIND,
  validateBaselineManifestForPersistence,
} from "./baselineManifestValidation";

describe("server baselineManifest integrity", () => {
  it("accepts formats with no manifest (legacy)", () => {
    expect(validateBaselineManifestForPersistence({ findings: "x", impression: "y" }).ok).toBe(true);
    expect(validateBaselineManifestForPersistence({ baselineManifest: null }).ok).toBe(true);
  });

  it("rejects unknown kind", () => {
    const r = validateBaselineManifestForPersistence({
      findings: "Hello.",
      impression: "Normal.",
      baselineManifest: {
        kind: "care.full_report_baseline.v99",
        version: 1,
        revision: "r1",
        observations: [],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.reason).toMatch(/Unsupported baselineManifest.kind/);
  });

  it("rejects unsupported version", () => {
    const r = validateBaselineManifestForPersistence({
      findings: "Hello.",
      impression: "Normal.",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 99,
        revision: "r1",
        observations: [],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.reason).toMatch(/Unsupported baselineManifest.version/);
  });

  it("rejects missing concept / renderedText and duplicate slots", () => {
    const r = validateBaselineManifestForPersistence({
      findings: "Normal lumbar lordosis is maintained.\nNormal lumbar lordosis is maintained.",
      impression: "Normal.",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1,
        revision: "r1",
        observations: [
          {
            id: "a",
            field: "findings",
            concept: "alignment",
            conflictGroup: "alignment",
            anatomicalSection: "alignment",
            renderedText: "Normal lumbar lordosis is maintained.",
          },
          {
            id: "b",
            field: "findings",
            concept: "alignment",
            conflictGroup: "alignment",
            anatomicalSection: "alignment",
            renderedText: "Normal lumbar lordosis is maintained.",
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.details?.some((d) => /duplicate ownership slot/i.test(d))).toBe(true);
  });

  it("accepts a valid supported manifest", () => {
    const r = validateBaselineManifestForPersistence({
      findings: "Normal lumbar lordosis is maintained.",
      impression: "Normal study.",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1,
        revision: "r1",
        observations: [
          {
            id: "alignment",
            field: "findings",
            concept: "alignment",
            conflictGroup: "alignment",
            anatomicalSection: "alignment",
            renderedText: "Normal lumbar lordosis is maintained.",
          },
          {
            id: "imp",
            field: "impression",
            concept: "normal_study",
            conflictGroup: "normal_study",
            anatomicalSection: "",
            renderedText: "Normal study.",
          },
        ],
      },
    });
    expect(r).toEqual({ ok: true, status: 400, reason: "ok" });
  });
});
