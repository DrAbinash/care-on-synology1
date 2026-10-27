/**
 * Finding E — the patient-identity verdict CARE already computes must reach the
 * screen the report is composed on.
 *
 * Nothing here matches a DICOM study to an order. The matching engine
 * (`api-server/src/lib/pacs/matchingEngine.ts`) wrote `match_score`,
 * `match_warnings` and `match_decision` onto the worklist row, `/pacs-worklist`
 * already selects all three and its list-field stripper removes only
 * `dicomMetadata` and `aiDraftJson`, so they were on the wire to the reporting
 * workspace all along. The only thing missing was a reader: My Collection had
 * one, the Composer did not.
 *
 * The cases below are therefore about the reader, and the one that matters most
 * is case 5 — the row shape the server builds for a study that exists only in
 * Orthanc, which is hardcoded RED/PENDING. Warning on that would put a red
 * identity banner on every study nobody has linked yet, and a banner on
 * everything is a banner nobody reads.
 *
 * No browser harness on this machine, so the wiring is pinned at source in the
 * last describe rather than clicked through.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  composerIdentityConflict,
  isResolvedMatch,
  isUnbilledScan,
  needsMatchReview,
  parseMatchStringArray,
} from "./pacsMatchIdentity";

const read = (...parts: string[]) =>
  readFileSync(resolve(__dirname, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("parseMatchStringArray — a warning that cannot be read is no warning", () => {
  it("1. reads the JSON array the column stores", () => {
    expect(parseMatchStringArray('["Name similarity 0.62","Accession not on the order"]'))
      .toEqual(["Name similarity 0.62", "Accession not on the order"]);
  });

  it("2. survives a malformed row instead of throwing", () => {
    // The queue screen used to call JSON.parse directly, so one bad row took the
    // whole panel down. Degrading to silence is the point of this function.
    expect(parseMatchStringArray("{not json")).toEqual([]);
    expect(parseMatchStringArray('"a bare string"')).toEqual([]);
    expect(parseMatchStringArray("null")).toEqual([]);
  });

  it("3. accepts an already-decoded array and drops blanks", () => {
    expect(parseMatchStringArray(["  Age differs by 9 years  ", "", null as unknown as string]))
      .toEqual(["Age differs by 9 years"]);
  });

  it("4. absent is empty", () => {
    expect(parseMatchStringArray(null)).toEqual([]);
    expect(parseMatchStringArray(undefined)).toEqual([]);
    expect(parseMatchStringArray("")).toEqual([]);
  });
});

describe("the identity verdict", () => {
  it("5. an Orthanc-only row does not warn — RED/PENDING is hardcoded before any link", () => {
    // Exactly the row `routes/radiology.ts` builds for a study with no ERP side.
    const orthancOnly = {
      studyId: null,
      matchScore: "RED",
      matchWarnings: null,
      matchDecision: "PENDING",
    };
    expect(isUnbilledScan(orthancOnly)).toBe(true);
    expect(needsMatchReview(orthancOnly)).toBe(false);
    expect(composerIdentityConflict(orthancOnly)).toBeNull();
  });

  it("6. a linked study the matcher is not confident about does warn, with its reasons", () => {
    const conflict = composerIdentityConflict({
      studyId: 4211,
      matchScore: "YELLOW",
      matchWarnings: '["Patient name similarity 0.62","Referring doctor differs"]',
      matchDecision: "PENDING",
    });
    expect(conflict).not.toBeNull();
    expect(conflict?.score).toBe("YELLOW");
    expect(conflict?.warnings).toEqual(["Patient name similarity 0.62", "Referring doctor differs"]);
  });

  it("7. RED is carried through, and a RED row with no parsable warnings still warns", () => {
    const red = composerIdentityConflict({
      studyId: 9,
      matchScore: "RED",
      matchWarnings: null,
      matchDecision: "PENDING",
    });
    expect(red?.score).toBe("RED");
    expect(red?.warnings).toEqual([]);
  });

  it("8. GREEN and an approved match are silence", () => {
    expect(composerIdentityConflict({
      studyId: 1, matchScore: "GREEN", matchWarnings: null, matchDecision: "PENDING",
    })).toBeNull();
    expect(composerIdentityConflict({
      studyId: 1, matchScore: "RED", matchWarnings: null, matchDecision: "APPROVED",
    })).toBeNull();
    expect(isResolvedMatch({ studyId: 1, matchScore: "GREEN", matchDecision: "PENDING" })).toBe(true);
    expect(isResolvedMatch({ studyId: 1, matchScore: "RED", matchDecision: "APPROVED" })).toBe(true);
  });

  it("9. a payload that predates the match says nothing rather than guessing", () => {
    expect(composerIdentityConflict({ studyId: 7 })).toBeNull();
    expect(composerIdentityConflict(null)).toBeNull();
    expect(composerIdentityConflict(undefined)).toBeNull();
  });
});

describe("the verdict reaches the panel, and one rule serves both screens", () => {
  const QUEUE = read("./reportingWorkflow.ts");
  const RAIL = read("../components/radiology/workspace/ReportingToolsRail.tsx");
  const PANEL = read("../components/radiology/ReportComposerAssistant.tsx");
  const MY_COLLECTION = read("../pages/MyCollection.tsx");

  it("10. the queue row type carries the three fields the server already sends", () => {
    // `omitHeavyPacsWorklistFields` strips only dicomMetadata and aiDraftJson, so
    // these arrive whether or not the client type admits them. Without the fields
    // on `QueueStudy` the reader has nothing to read.
    expect(QUEUE).toContain("matchScore?: string | null;");
    expect(QUEUE).toContain("matchWarnings?: string | null;");
    expect(QUEUE).toContain("matchDecision?: string | null;");
  });

  it("11. the rail feeds the live panel, and the panel really renders the strip", () => {
    expect(RAIL).toContain("identityConflict={composerIdentityConflict(workflow.currentRow)}");

    // The gate, not just the markup. A strip wrapped in `{false && …}` still
    // contains every string below and passes every assertion about them, so the
    // region is bounded by the conditional that decides whether it renders at
    // all — and the disable shape itself is forbidden in this file.
    expect(PANEL).not.toContain("false &&");
    const at = PANEL.indexOf("{props.identityConflict && (");
    expect(at, "the strip's render gate is gone").toBeGreaterThanOrEqual(0);
    const end = PANEL.indexOf('data-testid="ai-compose-mode"', at);
    expect(end, "could not bound the strip").toBeGreaterThan(at);
    const strip = PANEL.slice(at, end);

    expect(strip).toContain('data-testid="composer-identity-conflict"');
    expect(strip).toContain("data-match-score={props.identityConflict.score}");
    expect(strip).toContain("props.identityConflict.decision");
    expect(strip).toContain("props.identityConflict.warnings");
    // The warnings have to be listed, not merely counted, or the radiologist is
    // told that something disagrees without being told what.
    expect(strip).toContain("props.identityConflict.warnings.slice(0, 6).map(");
    // Positive control: the bounded region is the strip and not a stray match.
    expect(strip.length).toBeGreaterThan(400);
    expect(strip.length).toBeLessThan(2500);
  });

  it("12. the queue screen imports the shared rule instead of keeping its own copy", () => {
    // Two spellings of "needs review" is how the badge on one screen starts
    // disagreeing with the banner on the other.
    expect(MY_COLLECTION).toContain('} from "@/lib/pacsMatchIdentity";');
    expect(MY_COLLECTION).not.toContain("function needsMatchReview(");
    expect(MY_COLLECTION).not.toContain("function isResolvedMatch(");
    expect(MY_COLLECTION).not.toContain("function isUnbilledScan(");
    // And the unguarded parse that could throw the panel away is gone.
    expect(MY_COLLECTION).not.toContain("JSON.parse(selectedItem.matchWarnings)");
    expect(MY_COLLECTION).not.toContain("JSON.parse(selectedItem.matchReasons)");
  });
});
