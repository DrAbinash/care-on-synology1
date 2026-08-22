import { describe, expect, it } from "vitest";
import {
  classifyResourceFailure,
  detectOutputBudgetExhausted,
} from "./providerResourceErrors";

describe("detectOutputBudgetExhausted", () => {
  it("detects eval=num_predict with empty content (qwen3 thinking budget)", () => {
    expect(
      detectOutputBudgetExhausted({
        responseLength: 0,
        evalCount: 48,
        numPredict: 48,
        thinkingLength: 120,
        finishReason: "stop",
      }),
    ).toBe(true);
  });

  it("detects done_reason length", () => {
    expect(
      detectOutputBudgetExhausted({
        responseLength: 0,
        evalCount: 10,
        numPredict: 256,
        finishReason: "length",
      }),
    ).toBe(true);
  });

  it("returns false when content is present", () => {
    expect(
      detectOutputBudgetExhausted({
        responseLength: 42,
        evalCount: 48,
        numPredict: 48,
      }),
    ).toBe(false);
  });
});

describe("classifyResourceFailure", () => {
  it("classifies OUTPUT_BUDGET_EXHAUSTED before EMPTY_MODEL_OUTPUT", () => {
    const r = classifyResourceFailure({
      success: true,
      httpStatus: 200,
      responseLength: 0,
      evalCount: 48,
      numPredict: 48,
      thinkingLength: 200,
      finishReason: "stop",
    });
    expect(r.code).toBe("OUTPUT_BUDGET_EXHAUSTED");
    expect(r.detail).toContain("eval=48");
  });

  it("still classifies plain empty as EMPTY_MODEL_OUTPUT", () => {
    const r = classifyResourceFailure({
      success: true,
      httpStatus: 200,
      responseLength: 0,
      evalCount: 5,
      numPredict: 256,
      thinkingLength: 0,
    });
    expect(r.code).toBe("EMPTY_MODEL_OUTPUT");
  });
});
