/**
 * regionTransitionWiring.contract.test.ts — PR E PRIORITY 3: the transition policy is
 * actually on the wire.
 *
 * `regionTransition.test.ts` and `regionTransitionCommit.test.ts` prove the policy and the
 * write. Neither can notice if a later edit stops calling them: the policy is a pure module,
 * the store action is one more method on a 5,000-line store, and the only symptom of a lost
 * call is a report that silently keeps a normal for anatomy the examination no longer
 * covers — which is the defect this PR exists to close, measured in the browser before it:
 * the region changed, sixteen Findings lines stayed, ten naming dorsal or lumbar anatomy,
 * nothing asked, nothing recorded.
 *
 * This package has no DOM harness, so the wiring is pinned at source level (the convention
 * of `startReportDelegation.contract.test.ts` and friends). Every ratchet below is paired
 * with a positive control, because a slice that comes back empty makes "X precedes Y" true
 * for every X and Y.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..");
const REPO = resolve(HERE, "../../../..");
/** CRLF in this working tree, LF in CI: normalise or every multi-line needle passes on one
 *  and fails on the other. */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const HOOK = read(resolve(SRC, "hooks/useReportingStudySetup.ts"));
const STRIP = read(resolve(SRC, "components/radiology/StudyRegionReportFormatSection.tsx"));
const CANVAS = read(resolve(SRC, "components/radiology/workspace/ReportCanvas.tsx"));
const DRAFT = read(resolve(SRC, "hooks/radiology-workspace/useDraftPersistence.ts"));
const COLUMN = read(resolve(REPO, "artifacts/api-server/src/lib/structuredJsonColumn.ts"));
const ROUTE = read(resolve(REPO, "artifacts/api-server/src/routes/radiology-report-generator.ts"));

/** Slice one `useCallback` body out of the hook, bounded on syntax, not on a line budget. */
function hookCallback(name: string): string {
  const start = HOOK.indexOf(`  const ${name} = useCallback(`);
  if (start < 0) throw new Error(`${name} is no longer a useCallback in useReportingStudySetup.ts`);
  const end = HOOK.indexOf("\n  }, [", start);
  if (end < 0) throw new Error(`${name}: no closing deps array`);
  const body = HOOK.slice(start, end);
  // Positive control: a broken bound would make every "contains" below pass on an empty
  // string, which is the shape of every hollow gate this repo has had to re-open.
  expect(body.length, `${name} body is implausibly short`).toBeGreaterThan(120);
  return body;
}

describe("the three writers of the reporting region all ask first", () => {
  it("the dropdown gate consults the plan before it writes the region", () => {
    const body = hookCallback("selectPrimaryRegion");
    expect(body).toContain("transitionPlanFor(");
    expect(body.indexOf("transitionPlanFor(")).toBeLessThan(body.indexOf("setRegionOverrides(["));
    expect(body).toContain("plan?.requiresConfirmation");
    expect(body).toContain("setPendingRegionTransition(");
  });

  it("the chip toggle gates a narrowing and stays silent for an add or a re-order", () => {
    const body = hookCallback("handleRegionToggle");
    // A missing gate would give indexOf -1, which is less than everything: assert presence
    // first, or the ordering check passes on the mutant it exists to catch.
    expect(body.indexOf("transitionPlanFor(")).toBeGreaterThan(-1);
    expect(body.indexOf("transitionPlanFor(")).toBeLessThan(body.indexOf("setRegionOverrides(next)"));
    expect(body).toContain("plan?.requiresConfirmation");
  });

  it("clearing the selection is gated — falling back to auto narrows like any other", () => {
    const body = hookCallback("selectPrimaryRegion");
    // Two writes in one callback: the placeholder branch (region → auto) and the chosen
    // branch (region → the new one). Both must ask, so both are checked in order.
    const firstGate = body.indexOf("transitionPlanFor(");
    const firstWrite = body.indexOf("setRegionOverrides(null)");
    expect(firstGate).toBeGreaterThan(-1);
    expect(firstGate).toBeLessThan(firstWrite);
    expect(body).toContain('source: \"primary\"');
  });

  it("reset-to-auto is gated too — it is the third writer, and it narrows like any other", () => {
    const body = hookCallback("resetRegionOverrides");
    expect(body.indexOf("transitionPlanFor(")).toBeGreaterThan(-1);
    expect(body.indexOf("transitionPlanFor(")).toBeLessThan(body.indexOf("setRegionOverrides(null)"));
    expect(body).toContain('source: \"reset\"');
  });

  it("counts every writer of the region, so a new one cannot arrive ungated", () => {
    // Census of `setRegionOverrides(` in useReportingStudySetup.ts, measured at 7:
    //   gated + confirm writes it    handleRegionToggle, selectPrimaryRegion (both branches),
    //                               resetRegionOverrides, confirmRegionTransition
    //   exempt (documented below)    the study-change effect, the protocol seed
    // A new writer breaks this count and has to be justified here before it can ship.
    const writers = HOOK.split("setRegionOverrides(").length - 1;
    expect(writers).toBe(7);
    expect(hookCallback("confirmRegionTransition")).toContain("setRegionOverrides(pending.nextRegions)");
    // Exempt 1: a new study opening. Its clinical content is reset in the same effect, so
    // there is nothing of the previous study's left to invalidate.
    const studyReset = HOOK.slice(0, HOOK.indexOf("setRegionOverrides(null);"));
    expect(studyReset).toContain("Reset once-per-study guards when the study changes");
    expect(HOOK.slice(HOOK.indexOf("Reset once-per-study"), HOOK.indexOf("setRegionOverrides(null);")).length)
      .toBeLessThan(700);
    // Exempt 2: a manual protocol picked while NO region is resolved. With no previous
    // region there is no previous coverage, so the policy answers \"no opinion\".
    expect(HOOK).toContain("studyRegions.length === 0 && protocol.studyType?.trim()");
  });

  it("only offers rows the store can actually withdraw, so the count never over-promises", () => {
    // Measured: the whole-spine screening-limitation row comes out of the format apply already
    // `protected`. A plan that announced it would tell the radiologist eleven sentences become
    // twelve, then refuse one.
    expect(hookCallback("transitionPlanFor")).toContain("!p.stale && !p.protected");
  });

  it("confirm commits through the store's withdrawal path; cancel writes nothing at all", () => {
    const confirm = hookCallback("confirmRegionTransition");
    expect(confirm).toContain("commitRegionTransition(pending.plan");
    expect(confirm).toContain("regionTransitionActor()");
    const cancel = hookCallback("cancelRegionTransition");
    expect(cancel).not.toContain("setRegionOverrides");
    expect(cancel).not.toContain("commitRegionTransition");
    expect(cancel).toContain("setPendingRegionTransition(null)");
  });
});

describe("the confirmation reaches the radiologist, and the decision reaches the draft", () => {
  it("the strip renders the plan's own summary and both answers", () => {
    expect(STRIP).toContain('data-testid="region-transition-strip"');
    expect(STRIP).toContain('data-testid="region-transition-confirm"');
    expect(STRIP).toContain('data-testid="region-transition-cancel"');
    expect(STRIP).toContain("plan.summary");
    expect(STRIP).toContain("plan.outOfRegionAbnormalities");
    expect(STRIP).toContain("plan.unplaced");
    // The strip inherits the section's lock, so a signed report cannot arm it.
    expect(STRIP).toContain("disabled={disabled}");
  });

  it("the canvas wires the hook's pending plan into that strip", () => {
    expect(CANVAS).toContain("pendingRegionTransition={studySetup.pendingRegionTransition?.plan ?? null}");
    expect(CANVAS).toContain("onConfirmRegionTransition={studySetup.confirmRegionTransition}");
    expect(CANVAS).toContain("onCancelRegionTransition={studySetup.cancelRegionTransition}");
  });

  it("the save body carries the history and the reopen reads it back", () => {
    expect(DRAFT).toContain("regionTransitions: regionTransitionPayload(useWorkspace.getState().regionTransitions)");
    expect(DRAFT).toContain("hydrateRegionTransitions(");
    expect(DRAFT).toContain("extractCareRegionTransitions(draft.structuredJson)");
  });
});

describe("the server's envelope allow-list knows the key in both directions", () => {
  /**
   * `composeStructuredJsonColumn` rebuilds the whole envelope from the keys it recognises:
   * anything it does not know is DROPPED on the next write, not preserved. A client field
   * that reaches the server but is missing from this list is a value that survives one save
   * and vanishes on the next — the Technique defect (B-01) in a different column.
   */
  it("declares, reads, writes and accepts it", () => {
    expect(COLUMN).toContain("careRegionTransitions?: CareRegionTransition[];");
    expect(COLUMN).toContain("export function extractCareRegionTransitions");
    expect(COLUMN).toContain("env.careRegionTransitions = regionTransitions;");
    expect(COLUMN).toContain("regionTransitions?: CareRegionTransition[] | null;");
    expect(COLUMN).toContain("patch.regionTransitions = extractCareRegionTransitions(");
    // The envelope is not composed as "anything non-empty" — the key has to hold the guard
    // that decides whether the envelope shape is written at all.
    expect(COLUMN).toContain("!hasTransitions) return a4 ?? null;");
  });

  it("the save-draft request schema lets the field through", () => {
    expect(ROUTE).toContain("regionTransitions: z.array(z.unknown()).optional(),");
  });
});
