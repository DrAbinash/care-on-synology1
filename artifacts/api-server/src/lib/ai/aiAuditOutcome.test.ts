import { describe, expect, test } from "vitest";
import {
  NO_USABLE_CONTENT_MESSAGE,
  isUsableAnswerText,
  resolveAiAuditOutcome,
} from "./aiAuditOutcome";

/**
 * The rule the audit table was supposed to have all along, written down once:
 * `success` answers "did this request produce clinical content a human could use",
 * not "did the HTTP call finish".
 */
describe("resolveAiAuditOutcome — one meaning for the audit `success` column", () => {
  test("a provider that answered 200 with blank text is not a generation", () => {
    const out = resolveAiAuditOutcome({
      providerReportedSuccess: true,
      identityVerified: true,
      answerText: "  \n\t ",
    });
    expect(out.success).toBe(false);
    expect(out.errorMessage).toBe(NO_USABLE_CONTENT_MESSAGE);
  });

  test("whitespace is not a finding, and neither is an absent answer", () => {
    expect(isUsableAnswerText("")).toBe(false);
    expect(isUsableAnswerText("   ")).toBe(false);
    expect(isUsableAnswerText(null)).toBe(false);
    expect(isUsableAnswerText("No acute intracranial abnormality.")).toBe(true);
  });

  test("a real answer under a confirmed provider is a success with no error to explain", () => {
    const out = resolveAiAuditOutcome({
      providerReportedSuccess: true,
      identityVerified: true,
      answerText: "L4-L5 disc protrusion.",
      providerError: null,
    });
    expect(out).toEqual({ success: true, errorMessage: null });
  });

  test("the gateway's verdict is obeyed, not merely used for wording", () => {
    // The defect this closes: `failure` was consulted only after `!success` had
    // already been decided from transport, so a named EMPTY_RESPONSE still filed
    // a success.
    const out = resolveAiAuditOutcome({
      providerReportedSuccess: true,
      identityVerified: true,
      failure: { code: "EMPTY_RESPONSE", message: "The provider answered but returned no text." },
      answerText: "",
    });
    expect(out.success).toBe(false);
    expect(out.errorMessage).toBe("The provider answered but returned no text.");
  });

  test("an unattributable answer cannot be rescued by good-looking text", () => {
    const out = resolveAiAuditOutcome({
      providerReportedSuccess: true,
      identityVerified: false,
      answerText: "Perfectly plausible report text.",
    });
    expect(out.success).toBe(false);
    expect(String(out.errorMessage)).toMatch(/could not be confirmed/);
  });

  test("transport failure wording survives unchanged", () => {
    // An infrastructure PR does not get to rename a clinician-visible message as a
    // side effect, so the provider's own sentence wins when there is one.
    const out = resolveAiAuditOutcome({
      providerReportedSuccess: false,
      identityVerified: true,
      providerError: "Ollama timed out after 300000 ms",
      answerText: "",
    });
    expect(out.success).toBe(false);
    expect(out.errorMessage).toBe("Ollama timed out after 300000 ms");
  });

  test("a structured caller can declare usability without handing over prose", () => {
    // A draft route parses the answer into sections; its usability is the section
    // set, not the length of the raw text. `usableContent` overrides the text rule.
    expect(
      resolveAiAuditOutcome({
        providerReportedSuccess: true,
        identityVerified: true,
        answerText: "{ not prose }",
        usableContent: false,
      }).success,
    ).toBe(false);
    expect(
      resolveAiAuditOutcome({
        providerReportedSuccess: true,
        identityVerified: true,
        answerText: "",
        usableContent: true,
      }).success,
    ).toBe(true);
  });

  test("errorMessage is null exactly when success is true", () => {
    // A row that says `success = true` beside a non-null `error_message` is what
    // made the table unreadable; the two must never disagree.
    for (const input of [
      { providerReportedSuccess: true, identityVerified: true, answerText: "text" },
      { providerReportedSuccess: true, identityVerified: true, answerText: "" },
      { providerReportedSuccess: false, identityVerified: true, answerText: "text" },
      { providerReportedSuccess: true, identityVerified: false, answerText: "text" },
    ]) {
      const out = resolveAiAuditOutcome(input);
      expect(out.success, JSON.stringify(out.errorMessage)).toBe(out.errorMessage === null);
    }
  });
});
