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
 *   I. (P1-4) "Apply must accurately reflect whether anything changed" — the
 *      sentence that closes an Apply is decided from what the store did and from
 *      what the editors hold at the moment of the claim, not from the code having
 *      reached the end of the function.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composerApplyGate, composerApplyOutcome } from "./composerApplyGate";
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

/** What a Findings+Impression accept is meant to leave in the editors. */
const ACCEPTED = {
  findings: "L4-L5: Broad-based disc bulge indenting the thecal sac.",
  impression: "1. L4-L5 disc bulge indenting the thecal sac.",
  recommendation: CLICK_TIME.recommendation,
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
    isFinalized: false,
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

describe("composerApplyOutcome — the closing sentence, executed against the real store", () => {
  it("a store refusal is neither a success nor recorded as applied (I)", () => {
    resetStore();
    useWorkspace.setState({ isFinalized: true });
    const verdict = useWorkspace.getState().applyAiComposerAccepted(ACCEPTED);
    const outcome = composerApplyOutcome({
      verdict,
      intended: ACCEPTED,
      beforeWrite: CLICK_TIME,
      landed: readWorkspaceClinicalTexts(),
      unreviewedAccepted: 0,
    });
    useWorkspace.setState({ isFinalized: false });

    expect(verdict).toBe("blocked");
    expect(outcome.kind).toBe("refused");
    expect(outcome.claimSuccess).toBe(false);
    expect(outcome.recordApplied).toBe(false);
    expect(outcome.title).toBe("Nothing was written");
    // The wording would be a lie twice over if the store had written: the report
    // is still exactly what it was.
    expect(readWorkspaceClinicalTexts().findingsText).toBe(CLICK_TIME.findings);
    expect(readWorkspaceClinicalTexts().impressionText).toBe(CLICK_TIME.impression);
  });

  it("an accept that moves the Conclusion is the only thing called applied (I)", () => {
    resetStore();
    const verdict = useWorkspace.getState().applyAiComposerAccepted(ACCEPTED);
    const outcome = composerApplyOutcome({
      verdict,
      intended: ACCEPTED,
      beforeWrite: CLICK_TIME,
      landed: readWorkspaceClinicalTexts(),
      unreviewedAccepted: 0,
    });

    expect(verdict).toBe("applied");
    expect(outcome.kind).toBe("applied");
    expect(outcome.claimSuccess).toBe(true);
    expect(outcome.recordApplied).toBe(true);
    expect(outcome.description).toBe("One Undo restores the previous report.");
  });

  it("an accept that changes no wording says so instead of claiming a change (I)", () => {
    resetStore();
    // A Findings-only accept re-sends the Impression the ledger already wrote: the
    // shape `impressionManualProsePreservation.test.ts` drives, and the case whose
    // "AI draft applied" toast described no clinical change at all.
    const verdict = useWorkspace.getState().applyAiComposerAccepted(CLICK_TIME);
    const outcome = composerApplyOutcome({
      verdict,
      intended: CLICK_TIME,
      beforeWrite: CLICK_TIME,
      landed: readWorkspaceClinicalTexts(),
      unreviewedAccepted: 0,
    });

    expect(verdict).toBe("applied");
    expect(outcome.kind).toBe("already-there");
    expect(outcome.claimSuccess).toBe(false);
    // The draft WAS consumed, so the job legitimately moves to APPLIED — it is
    // just not owed the word "applied" as a description of the report.
    expect(outcome.recordApplied).toBe(true);
  });

  it("text that leaves the editors before the claim is not claimed (I)", () => {
    resetStore();
    const verdict = useWorkspace.getState().applyAiComposerAccepted(ACCEPTED);
    const atWrite = composerApplyOutcome({
      verdict,
      intended: ACCEPTED,
      beforeWrite: CLICK_TIME,
      landed: readWorkspaceClinicalTexts(),
      unreviewedAccepted: 0,
    });
    // The rewrite production measured after Save + Reopen: the accepted Conclusion
    // replaced by a derived one while the persistence awaits were still running.
    useWorkspace.setState({ impressionText: CLICK_TIME.impression });
    const closing = composerApplyOutcome({
      verdict,
      intended: ACCEPTED,
      beforeWrite: CLICK_TIME,
      landed: readWorkspaceClinicalTexts(),
      unreviewedAccepted: 0,
    });

    expect(atWrite.kind).toBe("applied");
    expect(closing.kind).toBe("did-not-land");
    expect(closing.claimSuccess).toBe(false);
    expect(closing.recordApplied).toBe(false);
    expect(closing.title).toBe("Accepted text is not in the report");
  });

  it("the unreviewed sweep is disclosed only in the sentence that describes it (I)", () => {
    const landed = {
      findingsText: ACCEPTED.findings,
      impressionText: ACCEPTED.impression,
      recommendationText: ACCEPTED.recommendation,
    };
    const base = { verdict: "applied" as const, intended: ACCEPTED, beforeWrite: CLICK_TIME, landed };

    expect(composerApplyOutcome({ ...base, unreviewedAccepted: 3 }).description)
      .toContain("3 changes you had not reviewed");
    expect(composerApplyOutcome({ ...base, unreviewedAccepted: 1 }).description)
      .toContain("1 change you had not reviewed");
    expect(composerApplyOutcome({ ...base, unreviewedAccepted: 0 }).description)
      .not.toContain("not reviewed");
  });

  it("an already-there accept still names the changes it stamped accepted (I)", () => {
    const outcome = composerApplyOutcome({
      verdict: "applied",
      intended: CLICK_TIME,
      beforeWrite: CLICK_TIME,
      landed: {
        findingsText: CLICK_TIME.findings,
        impressionText: CLICK_TIME.impression,
        recommendationText: CLICK_TIME.recommendation,
      },
      unreviewedAccepted: 2,
    });

    expect(outcome.kind).toBe("already-there");
    expect(outcome.description).toContain("2 changes you had not reviewed are now recorded as accepted");
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

  it("P1-4: the store's verdict is captured — no bare, discarded applyAiComposerAccepted call", () => {
    // A call on its own line is the shape that threw the "applied" | "blocked"
    // answer away, and the assertion has to be able to see it: the pattern is
    // anchored on the line break, not on `$`, because this repo checks out CRLF.
    expect(/\r?\n[ \t]*applyAiComposerAccepted\(text\);/.test(src)).toBe(false);
    expect(src.includes("const verdict = applyAiComposerAccepted(text);")).toBe(true);
  });

  it("P1-4: an Apply the store refused never reaches the server as applied", () => {
    const write = src.indexOf("const verdict = applyAiComposerAccepted(text);");
    const gate = src.indexOf("if (!atWrite.recordApplied) {");
    const persist = src.indexOf("await opts.persistAccepted(tag)");
    const confirm = src.indexOf("reportComposerApi.confirmApplied");
    expect(write).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(write);
    expect(persist).toBeGreaterThan(gate);
    expect(confirm).toBeGreaterThan(persist);
    // The refusal returns before the persist: nothing between the two may be an
    // await that records the draft as consumed.
    expect(src.slice(gate, persist).includes("return;")).toBe(true);
    expect(src.slice(gate, persist).includes("persistAccepted")).toBe(false);
  });

  it("P1-4: the closing sentence is decided from the live store AFTER the awaits", () => {
    const first = src.indexOf("composerApplyOutcome({");
    const second = src.indexOf("composerApplyOutcome({", first + 1);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    const confirm = src.indexOf("reportComposerApi.confirmApplied");
    expect(second).toBeGreaterThan(confirm);
    const reread = src.indexOf("readWorkspaceClinicalTexts()", second);
    expect(reread).toBeGreaterThan(second);
    expect(reread).toBeLessThan(second + 400);
    // and it is the toast that speaks, not a literal
    const finalToast = src.indexOf("toast({", reread);
    expect(finalToast).toBeGreaterThan(reread);
    expect(src.slice(finalToast, finalToast + 320).includes("closing.title")).toBe(true);
    expect(src.slice(finalToast, finalToast + 320).includes("closing.description")).toBe(true);
  });

  it("P1-4: no success sentence is hard-coded in applyAccepted any more", () => {
    const start = src.indexOf("const applyAccepted = async () => {");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("const discard = async", start));
    // "AI draft applied" belongs to the pure decision, which can only return it
    // when the accepted text is what the editors hold.
    expect(body.includes('title: "AI draft applied"')).toBe(false);
    expect(read("lib/composerApplyGate.ts").includes('title: "AI draft applied"')).toBe(true);
  });
});
