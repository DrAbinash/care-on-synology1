/**
 * F1 / D-13 / F4 — what the AI Apply may overwrite, and what a failed Apply
 * owes the radiologist.
 *
 * The gate (`composerApplyGate`) is pure and executed directly against the
 * real store below. The hook wiring inside `applyAccepted` cannot be mounted in
 * this repo (no DOM/React harness, `environment: "node"` repo-wide — the same
 * limitation `refusedSaveIsNotAFailedSave.test.ts` documents), so its contract
 * is pinned the same way that suite pins the auto-save guard: the real gate is
 * executed at the store boundary, and the hook's wiring is asserted from its
 * source — placement, order and rollback — so a regression in the wiring fails
 * here rather than only in a browser.
 *
 * The scenarios this file discharges (owner Part "clinical text preservation"):
 *   G. AI Apply must not overwrite text entered while its asynchronous
 *      operation is pending — the gate reads the live store at the last
 *      instant before the write, not the click-time closure.
 *   H. Failed Apply must preserve the original clinical text — a THROWN
 *      exception from persist/confirm is rolled back through the same
 *      `undoLastPatch` the server-refusal branch uses, with a notice.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composerApplyGate } from "./composerApplyGate";
import { readWorkspaceClinicalTexts, type WorkspaceClinicalTexts } from "./zai-workspace/workspaceClinicalTexts";
import { useWorkspace } from "./zai-workspace/store";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const HOOK = "hooks/useReportComposer.ts";

const CLICK_TIME = {
  findings: "L4-L5: No significant disc bulge or protrusion is seen.",
  impression: "Normal MRI of the lumbosacral spine.",
  recommendation: "Clinical correlation.",
};

function resetStore(texts: Partial<WorkspaceClinicalTexts> = {}) {
  useWorkspace.setState({
    findingsText: CLICK_TIME.findings,
    impressionText: CLICK_TIME.impression,
    recommendationText: CLICK_TIME.recommendation,
    techniqueText: "",
    clinicalHistoryText: "",
    fieldProvenance: {},
    appliedPathologyPatches: [],
    ...texts,
  });
}

describe("composerApplyGate — executed against the real store", () => {
  it("proceeds when nothing was typed inside the async window", () => {
    resetStore();
    const decision = composerApplyGate(CLICK_TIME, readWorkspaceClinicalTexts());
    expect(decision.proceed).toBe(true);
  });

  it("refuses when the radiologist typed more Findings while Apply was running (G)", () => {
    resetStore({ findingsText: CLICK_TIME.findings + " Typed in flight." });
    const decision = composerApplyGate(CLICK_TIME, readWorkspaceClinicalTexts());
    expect(decision.proceed).toBe(false);
    if (!decision.proceed) expect(decision.reason).toBe("content-moved-in-window");
  });

  it("refuses per field: Impression and Recommendation edits count too", () => {
    resetStore({ impressionText: "A different conclusion was dictated in the window." });
    expect(composerApplyGate(CLICK_TIME, readWorkspaceClinicalTexts()).proceed).toBe(false);
    resetStore({ recommendationText: "Different advice typed in flight." });
    expect(composerApplyGate(CLICK_TIME, readWorkspaceClinicalTexts()).proceed).toBe(false);
  });

  it("refuses on a study switch: another patient's content is not this draft's baseline (D-13)", () => {
    resetStore({
      findingsText: "C2 fracture with prevertebral soft tissue swelling.",
      impressionText: "C2 fracture.",
      recommendationText: "CT cervical spine advised.",
    });
    const decision = composerApplyGate(CLICK_TIME, readWorkspaceClinicalTexts());
    expect(decision.proceed).toBe(false);
  });

  it("byte identity is the contract: a one-character difference stops the write", () => {
    resetStore({ findingsText: CLICK_TIME.findings.slice(0, -1) });
    expect(composerApplyGate(CLICK_TIME, readWorkspaceClinicalTexts()).proceed).toBe(false);
  });
});

describe("the applyAccepted wiring, pinned from the hook source", () => {
  const src = read(HOOK);

  it("reads the LIVE store for the gate — not the click-time closure values", () => {
    const gateAt = src.indexOf("composerApplyGate(");
    expect(gateAt).toBeGreaterThan(-1);
    const live = src.indexOf("readWorkspaceClinicalTexts()", gateAt);
    expect(live).toBeGreaterThan(gateAt);
    expect(live).toBeLessThan(gateAt + 400);
  });

  it("runs the gate after the freshness check and BEFORE the editor write", () => {
    const freshness = src.indexOf("reportComposerApi.freshness(");
    const gate = src.indexOf("composerApplyGate(");
    const write = src.indexOf("applyAiComposerAccepted(text)");
    expect(freshness).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(freshness);
    expect(write).toBeGreaterThan(gate);
  });

  it("the refusal keeps the radiologist's text and says so — no silent loss, no 'lost edits' claim", () => {
    const refuseAt = src.indexOf("Report changed while Apply was running");
    expect(refuseAt).toBeGreaterThan(-1);
    expect(src).toContain("Your newest edits are safe and nothing was written.");
    expect(src.slice(refuseAt, refuseAt + 600)).not.toContain("lost");
  });

  it("F4: a thrown persist/confirm exception is caught, rolled back and noticed (H)", () => {
    const tryAt = src.indexOf("try {", src.indexOf("applyAiComposerAccepted(text)"));
    const persist = src.indexOf("await opts.persistAccepted(tag)");
    const confirm = src.indexOf("reportComposerApi.confirmApplied");
    const catchAt = src.indexOf("} catch (err) {", tryAt);
    const rollback = src.indexOf("undoLastPatch()", catchAt);
    const notice = src.indexOf("Apply did not complete", catchAt);
    expect(tryAt).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(tryAt);
    expect(confirm).toBeGreaterThan(persist);
    expect(catchAt).toBeGreaterThan(confirm);
    expect(rollback).toBeGreaterThan(catchAt);
    expect(notice).toBeGreaterThan(rollback);
    // The catch restores before it refreshes or toasts — the text is back
    // before anything else is promised.
    expect(rollback).toBeLessThan(src.indexOf("getJob(job.id)", catchAt));
  });

  it("the server-refusal rollback still exists inside the try — F4 narrows nothing", () => {
    const tryAt = src.indexOf("try {", src.indexOf("applyAiComposerAccepted(text)"));
    const refuseRollback = src.indexOf("undoLastPatch()", tryAt);
    expect(refuseRollback).toBeGreaterThan(tryAt);
    expect(src).toContain("Apply blocked");
  });
});
