/**
 * finalizeStaleImpressionGate.test.ts — the P0 that made "Confirm & sign" close
 * the dialog without sending a request or showing an explanation.
 *
 * MEASURED ROOT CAUSE (browser, synthetic scratch DB, worklist row 10, 2026-11-07
 * 09:52Z — tmp/bs2-journey/p1-gate-run2.txt):
 *
 *   [dlg] refresh outcome=undefined needsRefreshNow=true reasons=["stale-patch"]
 *   [dlg] Confirm & sign pressed canConfirm=true ... dlgRefreshed=true storeNeedsRefresh=true
 *   gate687 needsRefresh=true reviewed=false dlgRefreshed=true
 *   EXIT 687            ← no POST /api/patient-reports, no /sign, nothing written
 *
 * `impressionNeedsRefresh` is a CONJUNCTION (observationLedger.ts:952-965):
 * findings-changed, never-reconciled, contribution-lost, stale-patch,
 * impression-contradicts-findings, participation-changed. Pressing
 * "Refresh Impression now" rebuilds the summary from the ledger, which answers
 * the summary half — but `stale-patch` says a Quick Select sentence the ledger
 * still owns has left the FINDINGS, which no summary rebuild can put back. The
 * flag therefore comes straight back armed (test 1 below pins that).
 *
 * The dialog then accepted its own press as the answer:
 * `compositionFinalizeAllowed` returns true on `impressionRefreshed` alone
 * (observationLedger.ts:1241), so Confirm turned green — while the caller
 * re-read the LIVE store and honoured only the acknowledgement tick
 * (useStudyFinalize.ts:687). Two components, one gate, two different answers.
 * The radiologist got a button that looked ready, clicked it, and nothing
 * happened. The single refusal toast shares TOAST_LIMIT = 1 with the toast the
 * refresh provokes, so in practice even that message was replaced before it
 * could be read — which is how it reached the owner as a silent failure.
 *
 * THE RULE UNDER GUARD
 *   1. A press answers the stale-Impression gate only when the store actually
 *      settled. A press that leaves it armed must not enable Confirm.
 *   2. What the screen says when it does not settle must name the recovery that
 *      works (the explicit acknowledgement), not repeat the remedy that cannot.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { useWorkspace } from "@/lib/zai-workspace/store";
import {
  compositionFinalizeAllowed,
  refreshAnswersImpressionGate,
  staleImpressionRecovery,
} from "@/lib/observationLedger";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const LESION = "Burst fracture of the T12 vertebral body with loss of posterior vertebral body height.";
const REMOVED_TILE_SENTENCE = "Loss of vertebral body height at T12 with retropulsion into the canal.";

function seed() {
  useWorkspace.setState({
    findingsText: `${LESION} A synthetic manual sentence added by the regression fixture.`,
    impressionText: "",
    recommendationText: "",
    techniqueText: "",
    clinicalHistoryText: "",
    appliedPathologyPatches: [
      {
        id: "stale-tile",
        observation: { id: "obs-t12", label: "Burst fracture T12" },
        templates: [],
        lastRendered: { findings: REMOVED_TILE_SENTENCE, impression: "" },
        source: "quick-findings",
        protected: false,
        stale: true,
      },
    ],
    fieldProvenance: {},
    impressionBasis: undefined,
    impressionNeedsRefresh: true,
    impressionDependencyReasons: ["stale-patch"],
    impressionOwnedByRadiologist: false,
    impressionOrderFrozen: false,
    isFinalized: false,
    isFinalizing: false,
    isDirty: true,
    activeStudyId: "study-1",
  } as never);
}

describe("the measured premise: a pressed refresh cannot clear a stale-patch gate", () => {
  beforeEach(seed);

  it("rewrites the Impression and still reports it out of date", () => {
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);

    const outcome = useWorkspace.getState().refreshImpressionFromLedger();

    // The press did its job: a Conclusion was composed and written.
    expect(outcome).toBeUndefined();
    expect(useWorkspace.getState().impressionText).toContain("Burst fracture");

    // …and the gate is still armed, for the reason no summary rebuild can answer.
    // This is the fact the dialog's Confirm gate was allowed to ignore.
    expect(useWorkspace.getState().impressionNeedsRefresh).toBe(true);
    expect(useWorkspace.getState().impressionDependencyReasons).toContain("stale-patch");
  });

  it("is why the dialog enabled Confirm while the caller refused the click", () => {
    useWorkspace.getState().refreshImpressionFromLedger();
    const needsRefresh = useWorkspace.getState().impressionNeedsRefresh;

    // The gate the dialog used: its own press counts as an answer on its own.
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: needsRefresh,
      impressionRefreshed: true,
      impressionReviewedAnyway: false,
    })).toBe(true);
    // The gate the caller used: the live flag, answered only by the tick.
    expect(needsRefresh && !false).toBe(true);
    // Both were true for the same click, which is the defect.
  });
});

describe("refreshAnswersImpressionGate — a press answers the gate when the store settled", () => {
  it("refuses a press that left the flag armed, even though text was written", () => {
    expect(refreshAnswersImpressionGate({ outcome: undefined, needsRefreshAfter: true })).toBe(false);
  });

  it("accepts a press that settled it", () => {
    expect(refreshAnswersImpressionGate({ outcome: undefined, needsRefreshAfter: false })).toBe(true);
  });

  it("refuses a press the store held (nothing was written)", () => {
    expect(refreshAnswersImpressionGate({ outcome: "held-empty", needsRefreshAfter: true })).toBe(false);
    expect(refreshAnswersImpressionGate({ outcome: "held-protected", needsRefreshAfter: true })).toBe(false);
    expect(refreshAnswersImpressionGate({ outcome: "held-adopted", needsRefreshAfter: true })).toBe(false);
  });
});

describe("staleImpressionRecovery — say the remedy that works", () => {
  it("does not tell a radiologist to refresh when refreshing cannot settle it", () => {
    const msg = staleImpressionRecovery(["stale-patch"]);
    expect(msg.mentionsRefreshAsRemedy).toBe(false);
    expect(msg.text).toMatch(/acknowledg|Sign anyway/i);
    expect(msg.text).toMatch(/Quick Select/i);
  });

  it("keeps naming refresh as the remedy when the findings moved", () => {
    const msg = staleImpressionRecovery(["findings-changed"]);
    expect(msg.mentionsRefreshAsRemedy).toBe(true);
    expect(msg.text).toMatch(/refresh/i);
  });

  it("names it when nothing is known about the reason", () => {
    expect(staleImpressionRecovery([]).mentionsRefreshAsRemedy).toBe(true);
  });
});

describe("the trap, closed: the two doors answer the same press the same way", () => {
  it("a press that did not settle leaves Confirm disabled, so the caller's refusal cannot be reached", () => {
    const settled = refreshAnswersImpressionGate({ outcome: undefined, needsRefreshAfter: true });
    expect(settled).toBe(false);
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: true,
      impressionRefreshed: settled,
      impressionReviewedAnyway: false,
    })).toBe(false);
  });

  it("the acknowledgement answers it in both doors", () => {
    expect(compositionFinalizeAllowed({
      impressionNeedsRefresh: true,
      impressionRefreshed: false,
      impressionReviewedAnyway: true,
    })).toBe(true);
  });
});

describe("wiring drift pins", () => {
  it("the dialog decides with the predicate, not with its own press", () => {
    const src = read("../components/radiology/FinalizeSignDialog.tsx");
    expect(src).toContain("refreshAnswersImpressionGate(");
    expect(src).toContain("impressionNeedsRefresh");
    // The bare assignment that caused this — press ⇒ assume settled — must stay gone.
    expect(/if \(outcome === undefined\) setImpressionRefreshed\(true\);/.test(src)).toBe(false);
  });

  it("the caller's refusal names the recovery that answers this reason", () => {
    const src = read("../hooks/radiology-workspace/useStudyFinalize.ts");
    expect(src).toContain("staleImpressionRecovery(");
  });
});
