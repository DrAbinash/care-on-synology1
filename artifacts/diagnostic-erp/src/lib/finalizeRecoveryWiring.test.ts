import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The recovery's wiring, pinned at the level the local suite can actually reach.
 *
 * This package has no DOM test environment (`vitest.config.ts` sets
 * `environment: "node"`, and jsdom is not installed), so the one-click close
 * cannot be rendered here. What CAN be pinned is the failure this repo has been
 * bitten by repeatedly: a field carried all the way through the view-model and
 * then never used by the JSX, or a recovery wired to the wrong leg. The runtime
 * behaviour of both halves is already proven elsewhere — the decision table in
 * `finalizeOutcomeMessage.test.ts`, the single-leg POST in
 * `finalizePartialFailure.recovery.test.ts` — so these assertions only close the
 * gap between them and the screen.
 *
 * Sources are read with CRLF normalised first: this repository is checked out
 * with Windows line endings on the operator's box, and a slice taken against raw
 * bytes silently matches nothing.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), "utf8").replace(/\r\n/g, "\n");

const barSrc = read("../components/radiology/ReportingStickyActionBar.tsx");
const canvasSrc = read("../components/radiology/workspace/ReportCanvas.tsx");
const overrideDialogSrc = read("../components/radiology/ContentOverrideDialog.tsx");
const hubSrc = read("../pages/ReportHub.tsx");
const hookSrc = read("../hooks/radiology-workspace/useStudyFinalize.ts");
const clinicalUiSrc = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const lifecycleSrc = read("radiologyReportLifecycle.ts");

describe("the one-click close is wired to the screen that offers it", () => {
  it("the sticky bar renders the button only from the pending refusal", () => {
    expect(barSrc).toMatch(/unlinkedClose\?:/);
    // Conditional, not always-present: a button that closes a study without
    // verified images must not sit on the bar waiting for a mis-click.
    expect(barSrc).toMatch(/\{unlinkedClose \? \(/);
    expect(barSrc).toMatch(/data-testid="sticky-close-unlinked"/);
    expect(barSrc).toMatch(/onClick=\{unlinkedClose\.onConfirm\}/);
  });

  it("ReportCanvas passes the pending close through instead of dropping it", () => {
    // The exact shape of the past defect: the state reached the component's props
    // and the JSX never read it.
    expect(canvasSrc).toMatch(/unlinkedClose,/);
    expect(canvasSrc).toMatch(/unlinkedClose=\{unlinkedClose/);
    expect(canvasSrc).toMatch(/onConfirm: \(\) => \{ void closeStudyWithoutImages\(\); \}/);
  });

  it("the hook arms the recovery only when the refusal said a click can answer it", () => {
    expect(hookSrc).toMatch(/refusal\.canConfirmUnlinked && finalizeResult\.reportId != null/);
    // …and it clears the offer when another study is opened, so a pending close
    // cannot follow the radiologist across studies.
    expect(hookSrc).toMatch(/useEffect\(\(\) => \{ setUnlinkedClose\(null\); \}, \[studyId\]\)/);
  });

  it("the recovery posts the status flip and nothing else", () => {
    const start = lifecycleSrc.indexOf("export async function closeStudyWithoutLinkedImages");
    expect(start).toBeGreaterThan(-1);
    const body = lifecycleSrc.slice(start, lifecycleSrc.indexOf("\n}\n", start));
    expect(body).toContain("/api/internal/radiology/report-status");
    expect(body).toContain("confirmUnlinked: true");
    // No create leg, no sign leg — that is what makes it safe to hand a radiologist
    // a button after a finalize that already signed.
    expect(body).not.toMatch(/api\.post\("\/api\/patient-reports"/);
    expect(body).not.toMatch(/\/sign"/);
    expect(body.match(/api\.post\(/g) ?? []).toHaveLength(1);
  });
});

/**
 * Ruling 3's documented content override, pinned at the same level.
 *
 * What the runtime tests already prove lives in `contentOverride.test.ts` (the
 * refusal parser, against the real server objects) and
 * `finalizeContentRefusal.test.ts` (the returned-not-thrown outcome, and which
 * legs run). None of that catches the defect this repo keeps shipping: a value
 * that survives every layer of the view-model and is then never read by the
 * JSX, or a recovery wired to one door while the refusal came from the other.
 * The override is the worse place for that to happen, because the box IS the
 * way out — a refusal that reaches the screen without a way to answer it is a
 * radiologist locked out of a report he can still finish.
 */
describe("the content override is wired to the screens that offer it", () => {
  it("the dialog renders only from a refusal and quotes the door's own sentence", () => {
    // Conditional on the refusal, and it returns null without one: a box that
    // invites signing past an empty Findings must not sit on the workspace
    // waiting for a mis-click.
    expect(overrideDialogSrc).toContain("if (!refusal) return null;");
    expect(overrideDialogSrc).toContain("{refusal.sentence}");
    expect(overrideDialogSrc).toContain('data-testid="content-override-reason"');
    expect(overrideDialogSrc).toContain('data-testid="content-override-confirm"');
    // A disabled button with nothing beside it is a silence, not a refusal: the
    // live length judgement has to be on screen, not only inside the gate.
    expect(overrideDialogSrc).toMatch(/data-testid="content-override-problem">\s*\{problem \?\? blocking\}/);
  });

  it("ReportCanvas renders the dialog from the hook's state, not a local copy", () => {
    expect(canvasSrc).toContain('import { ContentOverrideDialog } from "@/components/radiology/ContentOverrideDialog"');
    expect(canvasSrc).toContain("refusal={contentRefusal}");
    expect(canvasSrc).toContain("busy={signingWithOverride}");
    expect(canvasSrc).toContain("onSign={signWithDocumentedReason}");
    expect(canvasSrc).toContain("onDismiss={dismissContentRefusal}");
    // The four names cross the aggregating hook as both a destructure and a
    // return entry; one of the two missing is exactly how the field used to
    // reach ReportCanvas and stop there.
    for (const name of ["contentRefusal", "signingWithOverride", "signWithDocumentedReason", "dismissContentRefusal"]) {
      expect(clinicalUiSrc.split(`${name},`).length - 1).toBe(2);
    }
  });

  it("a content refusal is its own outcome, kept out of the completion bookkeeping", () => {
    const refusalBranch = hookSrc.indexOf("if (finalizeResult.contentRefusal) {");
    expect(refusalBranch).toBeGreaterThan(-1);
    // The branch returns before the finalize-completion test below it, so an
    // override refusal cannot lock the editors, clear the rescue draft, credit
    // the reading session or advance the queue for a write that never happened.
    expect(hookSrc.indexOf("const completedFinalize = isFinalizeCompletion(finalizeResult);")).toBeGreaterThan(refusalBranch);
    expect(hookSrc.indexOf("setContentRefusal(finalizeResult.contentRefusal);")).toBeGreaterThan(refusalBranch);

    const start = lifecycleSrc.indexOf("function finalizeRefusedForContent");
    expect(start).toBeGreaterThan(-1);
    const body = lifecycleSrc.slice(start, lifecycleSrc.indexOf("\n}\n", start));
    expect(body).toContain("reportId: null");
    expect(body).toContain("signed: false");
    expect(body).toContain("reportStatusSent: false");
    expect(body).toContain("contentRefusal: refusal");
  });

  it("the reason travels on the door that refused it, and only on the retry that carries one", () => {
    // Create and sign BOTH classify content, so a reason that reaches only the
    // create is answered by a second 409 on a row the radiologist meant to sign.
    expect(lifecycleSrc.match(/contentOverrideFields\(content\.contentOverrideReason\)/g) ?? []).toHaveLength(2);
    expect(hookSrc).toContain("? contentOverrideFields(overrideReasonRef.current)");

    // The reason is for one attempt: the wrapper clears it in its `finally`, and
    // it is armed only after the length check has passed, so a short box never
    // reaches the door at all.
    expect(hookSrc.indexOf("if (problem) return problem;")).toBeLessThan(hookSrc.indexOf("overrideReasonRef.current = reason.trim();"));
    expect(hookSrc).toContain("overrideReasonRef.current = null;");

    // And a fresh ordinary Finalize drops the previous offer, while a documented
    // retry keeps the dialog up while its own request is in flight.
    expect(hookSrc).toContain("if (overrideReasonRef.current === null) setContentRefusal(null);");
    expect(hookSrc).toContain("useEffect(() => { setContentRefusal(null); }, [studyId]);");
  });

  it("ReportHub answers the refusal instead of dead-ending on a toast", () => {
    // The same door guards the hub's sign route; before this it produced a
    // message and nothing else, so a hub-signed report with empty Findings had
    // no way forward on the screen that offered the signature.
    expect(hubSrc).toContain("const refusal = parseContentRefusal(err);");
    expect(hubSrc).toContain("...(contentRefusal ? contentOverrideFields(reason) : {}),");
    expect(hubSrc).toContain('data-testid="hub-content-override-reason"');
    expect(hubSrc).toContain('data-testid="hub-content-override-problem"');
    expect(hubSrc).toContain("disabled={busy || reasonProblem !== null}");
  });
});
