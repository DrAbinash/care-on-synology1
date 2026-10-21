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
  aiIdentityProblem,
  aiResponseCarriesFailure,
} from "./aiUsableResult";
import { HttpError } from "./fetchApi";

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

describe("aiIdentityProblem", () => {
  /** Built the way the client actually throws one: message from the body's `error`,
   *  `details` the parsed body, so `code` is read from where `fetchApi` puts it. */
  const refused = (status: number, code: string, error: string) =>
    new HttpError(error, status, { error, code });

  it("names each refusal as itself, not as a failed generation", () => {
    const cases: Array<[string, string]> = [
      ["STUDY_NOT_IN_CLINIC", "This study is not in the clinic"],
      ["PATIENT_ID_MISMATCH", "The patient does not match this study"],
      ["STUDY_UID_MISMATCH", "The study does not match this record"],
      ["WORKLIST_NOT_FOUND", "This worklist row does not exist"],
      ["NO_STUDY_UID", "No study to report on"],
      ["DRAFT_NOT_FOUND", "That draft no longer exists"],
      ["DRAFT_STUDY_MISMATCH", "That draft belongs to another study"],
      ["DRAFT_NOT_YOURS", "That draft belongs to another radiologist"],
    ];
    for (const [code, title] of cases) {
      const problem = aiIdentityProblem(refused(409, code, "The server's own sentence."));
      expect(problem, code).not.toBeNull();
      expect(problem?.title, code).toBe(title);
    }
  });

  it("carries the server's sentence verbatim, because it names the two values", () => {
    const sentence =
      "This request names patient 12, but the clinic's record for study 1.2.840.1 names patient 9. "
      + "Nothing was sent to the AI and no draft was saved.";
    const problem = aiIdentityProblem(refused(409, "PATIENT_ID_MISMATCH", sentence));
    expect(problem?.description).toBe(sentence);
    // Both sides survive the trip: a message that only says "mismatch" asks the
    // clinician to guess which patient the clinic means.
    expect(problem?.description).toContain("patient 12");
    expect(problem?.description).toContain("patient 9");
  });

  it("leaves an ordinary failure to the shared no-usable-result sentence", () => {
    // A provider outage is the case `AI_NO_USABLE_RESULT` was written for; claiming a
    // study/patient problem that does not exist would send the clinician to the wrong
    // conclusion about their own screen.
    for (const error of [
      new HttpError("AI provider error", 502, { error: "AI provider error", failure: null }),
      new HttpError("Insufficient permissions.", 403, { error: "Insufficient permissions." }),
      new Error("fetch failed"),
      "a string",
      null,
      undefined,
    ]) {
      expect(aiIdentityProblem(error)).toBeNull();
    }
  });

  it("still headlines a refusal whose body carried no readable sentence", () => {
    const problem = aiIdentityProblem(new HttpError("", 403, { code: "DRAFT_NOT_YOURS" }));
    expect(problem?.title).toBe("That draft belongs to another radiologist");
    // Never an empty toast: the clinician has to be told nothing was written.
    expect(problem?.description).toMatch(/nothing was/i);
  });
});
