import { describe, it, expect } from "vitest";
import { EMPTY_INSTANCE, type AbnormalityInstance } from "./abnormalityEngine";
import { deriveQuickSelectFindings } from "./quickSelectFindingsPayload";

// Ticket A3.1 coverage: the payload derived from Quick Select's selection
// state (selectedQuickIds + quickInstances) — the shape that will become
// the optional findings[] field on the save-draft POST body. This is a
// serialization test only: it proves what the frontend now SENDS, not
// anything about what the backend does with it (A3.2's scope).

const MODERATE_L4_5: AbnormalityInstance = { side: "", severity: "moderate", chronicity: "", level: "L4-5", value: "" };
const MILD_RIGHT: AbnormalityInstance = { side: "right", severity: "mild", chronicity: "chronic", level: "", value: "" };

describe("deriveQuickSelectFindings — with findings selected", () => {
  it("produces one entry per selected finding, with its exact instance params", () => {
    const selectedQuickIds = new Set([8842, 9001]);
    const quickInstances = new Map<number, AbnormalityInstance>([
      [8842, MODERATE_L4_5],
      [9001, MILD_RIGHT],
    ]);

    const findings = deriveQuickSelectFindings(selectedQuickIds, quickInstances);

    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual({ findingId: 8842, params: MODERATE_L4_5 });
    expect(findings).toContainEqual({ findingId: 9001, params: MILD_RIGHT });
  });

  it("falls back to EMPTY_INSTANCE for a selected id with no matching instance (defensive, should not normally happen)", () => {
    const selectedQuickIds = new Set([123]);
    const quickInstances = new Map<number, AbnormalityInstance>(); // deliberately out of sync

    const findings = deriveQuickSelectFindings(selectedQuickIds, quickInstances);

    expect(findings).toEqual([{ findingId: 123, params: EMPTY_INSTANCE }]);
  });
});

describe("deriveQuickSelectFindings — without findings selected", () => {
  it("returns an empty array when nothing is selected", () => {
    const findings = deriveQuickSelectFindings(new Set(), new Map());
    expect(findings).toEqual([]);
  });

  it("ignores stale quickInstances entries for ids no longer in selectedQuickIds", () => {
    const selectedQuickIds = new Set<number>(); // everything deselected
    const quickInstances = new Map<number, AbnormalityInstance>([[8842, MODERATE_L4_5]]); // stale leftover
    const findings = deriveQuickSelectFindings(selectedQuickIds, quickInstances);
    expect(findings).toEqual([]);
  });
});
