/**
 * The sentence a radiologist gets when the AI produced nothing usable, and the
 * predicate that decides whether an answer is usable at all.
 *
 * Measured on 2026-10-21: `qwen3-vl:8b` answered the clinic's own vision endpoint
 * with HTTP 200 and no text on 9 of 9 attempts. Every surface that trusted
 * transport alone — or trusted a non-null response object — showed that as a
 * completed request. These two functions are the only place that decision is made.
 */
import { describe, expect, it } from "vitest";

import {
  AI_NO_USABLE_RESULT,
  AI_NO_USABLE_RESULT_TITLE,
  aiAnswerIsUsable,
  aiResponseCarriesFailure,
} from "./aiUsableResult";

describe("AI_NO_USABLE_RESULT", () => {
  it("is the owner's sentence, verbatim, as one unit", () => {
    expect(AI_NO_USABLE_RESULT).toBe(
      "AI could not generate a usable response. Your report has not been changed.",
    );
    expect(AI_NO_USABLE_RESULT_TITLE).toBe("No usable AI response");
  });

  it("carries no technical detail a clinician would have to interpret", () => {
    const lowered = AI_NO_USABLE_RESULT.toLowerCase();
    for (const internal of ["provider", "timeout", "error", "ollama", "http", "null", "failed code"]) {
      expect(lowered, `the sentence must not name ${internal}`).not.toContain(internal);
    }
  });
});

describe("aiAnswerIsUsable", () => {
  it("refuses the shapes a provider returns when it generated nothing", () => {
    expect(aiAnswerIsUsable("")).toBe(false);
    expect(aiAnswerIsUsable("   \n\t ")).toBe(false);
    expect(aiAnswerIsUsable(null)).toBe(false);
    expect(aiAnswerIsUsable(undefined)).toBe(false);
  });

  it("accepts real text, including text that only becomes readable after trimming", () => {
    expect(aiAnswerIsUsable(" No acute intracranial abnormality. ")).toBe(true);
    expect(aiAnswerIsUsable("0")).toBe(true);
  });
});

describe("aiResponseCarriesFailure", () => {
  it("reads the server's own verdict, which it sends as null on success", () => {
    expect(aiResponseCarriesFailure(null)).toBe(false);
    expect(aiResponseCarriesFailure(undefined)).toBe(false);
    expect(aiResponseCarriesFailure({ code: "EMPTY_RESPONSE", message: "…", provider: "ollama" })).toBe(true);
  });
});
