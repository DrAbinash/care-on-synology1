/**
 * Every live AI surface must show the same failure sentence, and none of them may
 * write an empty answer into the report while doing it.
 *
 * These are source contracts, the same weaker form of proof
 * `reportingWorkspaceJourneys.hardening.test.ts` uses for hooks the ERP test
 * environment cannot mount: they pin the wiring (which branch runs before which
 * state write) that a runtime unit test cannot reach without a browser. They do
 * NOT prove the toast renders — that is stated per PR, not implied here.
 *
 * Why each line exists:
 *   DicomViewer wrote `setDraftText(data.aiResponse)` unconditionally, so an empty
 *     answer erased the text the clinician had typed in the panel's own editor.
 *   The impression hook is the live Ctrl+I path and had two different wordings for
 *     the same event (empty answer vs thrown request).
 *   The comparison page printed "Answered" for an arm that returned HTTP 200 and no
 *     body, because its card keyed off `success` alone.
 *   AI polish has no mounted surface at all, which is asserted here so the gap is
 *     visible instead of silent.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8");

const QUERY_SRC = "pages/DicomViewer.tsx";
const COMPARISON_SRC = "pages/AiComparisonWorkspace.tsx";
const IMAGE_REVIEW_SRC = "pages/ImageReviewAssistant.tsx";
const IMPRESSION_SRC = "hooks/radiology-workspace/useTriggerAiImpression.ts";
const SHARED_SRC = "lib/aiUsableResult.ts";

const count = (src: string, needle: string) => src.split(needle).length - 1;

describe("one sentence, four surfaces", () => {
  for (const rel of [QUERY_SRC, COMPARISON_SRC, IMAGE_REVIEW_SRC, IMPRESSION_SRC]) {
    it(`${rel} takes the sentence from the shared module`, () => {
      const src = read(rel);
      expect(src).toContain("from \"@/lib/aiUsableResult\"");
      expect(src, `${rel} must show the shared sentence`).toContain("description: AI_NO_USABLE_RESULT");
    });
  }

  it("the sentence is defined exactly once, in the shared module", () => {
    expect(count(read(SHARED_SRC), "could not generate a usable response")).toBe(1);
    for (const rel of [QUERY_SRC, COMPARISON_SRC, IMAGE_REVIEW_SRC, IMPRESSION_SRC]) {
      expect(read(rel), `${rel} must not re-type it`).not.toContain("could not generate a usable response");
    }
  });
});

describe("the failure is shown instead of being written into the report", () => {
  it("the AI query panel refuses the answer before it touches any state", () => {
    const src = read(QUERY_SRC);
    const guard = src.indexOf("if (!aiAnswerIsUsable(data.aiResponse) || aiResponseCarriesFailure(data.failure))");
    expect(guard, "no usability guard on the query success path").toBeGreaterThan(-1);
    // Order IS the fix: the old branch wrote the empty answer into draftText first.
    expect(src.indexOf("setAiResponse(data.aiResponse)"), "setAiResponse runs before the guard").toBeGreaterThan(guard);
    expect(src.indexOf("setDraftText(data.aiResponse)"), "setDraftText runs before the guard").toBeGreaterThan(guard);
  });

  it("the comparison card keys 'Answered' off usable text, not off transport success", () => {
    const src = read(COMPARISON_SRC);
    expect(src).toContain("r.success && aiAnswerIsUsable(r.response)");
  });

  it("an unusable impression proposal is never handed to the ghost layer", () => {
    const src = read(IMPRESSION_SRC);
    expect(src).toContain("res.impression && !aiResponseCarriesFailure(res.failure)");
    // Both nothing-arrived cases now say the same thing.
    expect(count(src, "description: AI_NO_USABLE_RESULT"), "empty answer and thrown request").toBe(2);
  });
});

describe("the retired wordings are gone from the live surfaces", () => {
  it("no live surface prints an exception message at the clinician", () => {
    expect(read(QUERY_SRC)).not.toContain('title: "AI query failed"');
    expect(read(IMAGE_REVIEW_SRC)).not.toContain('"Review failed"');
    expect(read(IMPRESSION_SRC)).not.toContain('title: "AI impression failed"');
    expect(read(IMPRESSION_SRC)).not.toContain('title: "AI returned no impression"');
  });

  it("AI polish has no mounted surface, so it has nothing to fix here", () => {
    // The panel that calls /polish is not imported anywhere. If someone mounts it,
    // this fails — which is the moment its "No additional findings suggested."
    // wording (a fabricated clinical negative for an empty answer) becomes live and
    // must be brought onto the shared sentence first.
    expect(read("App.tsx"), "RadiologyAICopilotPanel became mounted").not.toContain("RadiologyAICopilotPanel");
  });
});
