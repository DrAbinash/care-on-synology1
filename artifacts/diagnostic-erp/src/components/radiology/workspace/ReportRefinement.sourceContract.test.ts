/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The "Refine Report" path has exactly one owner, and the wording the radiologist
 * reads is the wording the prompts require.
 *
 * The workspace has no component-rendering harness, so these bind the wiring by
 * source. They exist because of what was deleted: the rail used to classify the
 * instruction itself (`/translat/`, `/shorten/`, `/expand/`, default REPHRASE) and
 * to send `findingsText.slice(0, 800)`, so a second, wrong refinement path could be
 * re-added here without anything noticing. Each assertion is bounded on a syntactic
 * marker rather than a line number or a character budget.
 *
 * The box is rendered TWICE — in the tools rail and in the floating overlay — and
 * both are checked by counting markers, not by naming files, so a third copy has to
 * satisfy the same contract. The overlay kept its own local classification and its
 * own truncation after the rail was fixed, which is why it is counted here too.
 */
const rail = readFileSync(join(__dirname, "ReportingToolsRail.tsx"), "utf8");
const overlays = readFileSync(join(__dirname, "WorkspaceOverlays.tsx"), "utf8");
const hook = readFileSync(join(__dirname, "..", "..", "..", "hooks", "useReportComposer.ts"), "utf8");
const panel = readFileSync(join(__dirname, "..", "ReportComposerAssistant.tsx"), "utf8");
const viewTypes = readFileSync(
  join(__dirname, "..", "..", "..", "lib", "reportComposer", "types.ts"),
  "utf8",
);

const BOX = "onMicroSubmit={() => {";
const REFINE_CALL = "reportComposer.refineReport(instr)";

function countOf(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

/** One shared-owner call per rendered box, in every file that renders one. */
function expectBoxesRouteThroughTheOwner(label: string, src: string): void {
  const boxes = countOf(src, BOX);
  const calls = countOf(src, REFINE_CALL);
  expect(boxes, `${label} renders no Refine Report box`).toBeGreaterThan(0);
  // A box without the call is still on the retired local path; a second call inside
  // one box would submit the same instruction twice and burn two model runs.
  expect(calls, `${label}: ${boxes} box(es), ${calls} refineReport call(s)`).toBe(boxes);
}

describe("the refinement path has one owner", () => {
  const refineBody = hook.slice(
    hook.indexOf("const refineReport = "),
    hook.indexOf("const pendingCount"),
  );

  it("submits the instruction through refineReport, as written", () => {
    expect(refineBody).toContain("resolveRefineTarget(");
    expect(refineBody).toContain("enqueue(target.jobKind");
    // The instruction must reach the job; a paraphrase of it is a different request.
    expect(refineBody).toContain("instruction: target.instruction");
    expect(rail).toContain("reportComposer.refineReport(instr)");
  });

  it("routes the floating overlay box through the same owner as the rail", () => {
    expectBoxesRouteThroughTheOwner("ReportingToolsRail", rail);
    expectBoxesRouteThroughTheOwner("WorkspaceOverlays", overlays);
  });

  it("keeps classification out of the component that renders the box", () => {
    const boxes: Array<[string, string]> = [
      ["rail", rail],
      ["overlay", overlays],
    ];
    for (const [label, src] of boxes) {
      expect(src, `${label} classifies the instruction itself`).not.toContain("resolveRefineTarget");
      expect(src, `${label} truncates the report before refining`).not.toContain(".slice(0, 800)");
      expect(src, `${label} still calls the retired per-kind micro-edit path`).not.toContain(
        "microEdit(",
      );
    }
    expect(panel).not.toContain(".slice(0, 800)");
  });

  it("refuses an empty instruction before it becomes a job", () => {
    expect(refineBody).toContain("if (!target) return");
    // Both boxes guard before they call. An empty instruction would otherwise become
    // a real job, spend a model run, and return the report unchanged.
    const boxes: Array<[string, string]> = [
      ["rail", rail],
      ["overlay", overlays],
    ];
    for (const [label, src] of boxes) {
      const start = src.indexOf(BOX);
      const call = src.indexOf(REFINE_CALL, start);
      expect(call, `${label} has no refine call after its box`).toBeGreaterThan(start);
      expect(src.slice(start, call), `${label} submits without guarding an empty box`).toContain(
        "if (!instr) return;",
      );
    }
  });
});

describe("what the radiologist is shown", () => {
  /**
   * Bounded on product copy and JSX conditionals, never on a `data-testid` literal:
   * radiologyReportingWorkspace.testids.test.ts harvests every such string in this
   * directory, including from tests, and would read an assertion as a declaration.
   */
  function blockBetween(startMarker: string, endMarker: string): string {
    const start = panel.indexOf(startMarker);
    expect(start, `panel has no "${startMarker}" copy`).toBeGreaterThan(-1);
    const end = panel.indexOf(endMarker, start);
    expect(end, `panel has no "${endMarker}" after "${startMarker}"`).toBeGreaterThan(start);
    return panel.slice(start, end);
  }

  it("shows the question CARE AI refused to guess at", () => {
    // Without this the model's refusal is silent: the persona is told to answer an
    // impossible instruction by returning the text unchanged and explaining why, and
    // an explanation nobody renders is the same as no explanation.
    const block = blockBetween("did not guess", "props.reviewOpen && props.job");
    expect(block).toContain("unresolvedQuestions");
    // Only when there is a question: an empty list would render the heading over
    // nothing and read as a malfunction.
    expect(panel).toContain("(props.job?.draft?.unresolvedQuestions?.length ?? 0) > 0 && (");
  });

  it("says why a refused draft was refused", () => {
    // safeError carries the code ("observation_dropped"); the stored validation
    // carries the sentence naming the statement the AI deleted. Only one of those
    // two tells a clinician what to do next.
    const block = blockBetween("Why CARE refused this draft", 'props.job?.status === "STALE_READY"');
    expect(block).toContain("provenance.warnings");
    // Gated on FAILED: the same warnings render in the review section for a draft
    // that passed, so an ungated block would say "refused" about an accepted draft.
    expect(panel).toContain('props.job?.status === "FAILED" && (provenance.warnings?.length ?? 0) > 0');
  });

  it("names the two actions the prompts specify", () => {
    expect(panel).toContain("Generate Professional Report");
    expect(panel).toContain("Refine Report");
    expect(panel).toContain("Accept Revision");
    expect(panel).toContain("Discard Revision");
  });

  it("reads a draft field the server actually sends", () => {
    // publicJobView passes outputPlanJson through verbatim; the view type has to say
    // the same thing or this block is reading a field that cannot exist.
    expect(viewTypes).toMatch(/unresolvedQuestions\?:\s*string\[\]/);
  });
});
