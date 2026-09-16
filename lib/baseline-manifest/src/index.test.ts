import { describe, expect, it } from "vitest";
import {
  FULL_REPORT_BASELINE_KIND,
  normalizeLevel,
  normalizeLaterality,
  persistenceOwnershipSlotKey,
  validateBaselineManifestStructure,
} from "./index";

describe("@workspace/baseline-manifest structural invariants", () => {
  it("normalizes level and laterality for ownership slots", () => {
    expect(normalizeLevel("L4/L5")).toBe("L4-L5");
    expect(normalizeLevel("thoracic")).toBe("dorsal");
    expect(normalizeLaterality("L")).toBe("left");
    expect(
      persistenceOwnershipSlotKey({
        region: "LS Spine",
        concept: "disc_contour",
        level: "l4-l5",
        laterality: "bilat",
      }),
    ).toBe("LS Spine|disc_contour|L4-L5|bilateral");
  });

  it("ownership slot ignores field (findings vs impression share family)", () => {
    const a = persistenceOwnershipSlotKey({
      region: "Brain",
      concept: "normal_study",
    });
    const b = persistenceOwnershipSlotKey({
      region: "Brain",
      concept: "normal_study",
      level: "",
      laterality: "",
    });
    expect(a).toBe(b);
  });

  it("rejects duplicate ownership slots that differ only by field", () => {
    const findings = "Normal brain parenchyma.";
    const impression = "Normal study.";
    const r = validateBaselineManifestStructure({
      findings,
      impression,
      defaultRegion: "Brain",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1,
        revision: "r1",
        observations: [
          {
            id: "f",
            field: "findings",
            concept: "parenchyma",
            conflictGroup: "parenchyma",
            anatomicalSection: "parenchyma",
            renderedText: findings,
          },
          {
            id: "i",
            field: "impression",
            concept: "parenchyma",
            conflictGroup: "parenchyma",
            anatomicalSection: "",
            renderedText: impression,
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.details.some((d) => /duplicate ownership slot/i.test(d))).toBe(true);
  });

  it("rejects level aliases that normalize to the same slot", () => {
    const line = "No disc bulge at L4-L5.";
    const r = validateBaselineManifestStructure({
      findings: `${line}\n${line}`,
      impression: "Normal.",
      defaultRegion: "LS Spine",
      baselineManifest: {
        kind: FULL_REPORT_BASELINE_KIND,
        version: 1,
        revision: "r1",
        observations: [
          {
            id: "a",
            field: "findings",
            concept: "disc_contour",
            conflictGroup: "disc_contour",
            anatomicalSection: "disc",
            level: "L4-L5",
            renderedText: line,
          },
          {
            id: "b",
            field: "findings",
            concept: "disc_contour",
            conflictGroup: "disc_contour",
            anatomicalSection: "disc",
            level: "L4/L5",
            renderedText: line,
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.details.some((d) => /duplicate ownership slot/i.test(d))).toBe(true);
  });
});
