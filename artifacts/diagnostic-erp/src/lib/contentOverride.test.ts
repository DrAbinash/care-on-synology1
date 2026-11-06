/**
 * The client half of ruling 3's override, scored against the SERVER's own
 * refusal object.
 *
 * Every case below builds its expected 409 body by calling
 * `signedContentRefusal(classifySignedReportBody(...))` — the exact function the
 * routes answer with — instead of hand-writing the JSON. That matters more than
 * it looks: this module reads fields the door happens to send today
 * (`level`, `sections`, `placeholders`, `override.minReasonChars`), and a
 * hand-made fixture would keep passing after the server renamed any of them.
 * It also covers the transport shape, because `HttpError.details` is the only
 * place the machine-readable refusal exists — a test that read `err.message`
 * would pass against a string the radiologist cannot act on.
 */
import { describe, expect, it } from "vitest";
import { HttpError, NetworkError } from "./fetchApi";
import {
  contentOverrideFields,
  contentRefusalHeadline,
  overrideReasonProblem,
  parseContentRefusal,
} from "./contentOverride";
// The door's own classifier and refusal builder: the contract under test is the
// pair of them, and this package's tsconfig excludes test files from typecheck,
// which is what lets the two sides meet here.
import {
  CONTENT_OVERRIDE_MIN_REASON,
  classifySignedReportBody,
  signedContentRefusal,
} from "../../../api-server/src/lib/signedReportContentGuard";

/** The refusal a real body would produce, in the exact JSON the route writes. */
function refusalBodyFor(body: string) {
  const content = classifySignedReportBody(body);
  expect(content.level, `expected a refusal for ${JSON.stringify(body.slice(0, 40))}`).not.toBe("ok");
  return signedContentRefusal(content);
}

/** How fetchApi raises a 409 with a JSON body: message + status + details. */
function http409(body: unknown): HttpError {
  const sentence = (body as { error?: string }).error ?? "Refused.";
  return new HttpError(sentence, 409, body);
}

const EMPTY_FINDINGS = `<div class="section-heading">TECHNIQUE</div><p>MRI without contrast.</p>`
  + `<div class="section-heading">FINDINGS</div><p></p>`
  + `<div class="section-heading">IMPRESSION</div><p>No acute abnormality.</p>`;
const PLACEHOLDER_BODY = `<div class="section-heading">FINDINGS</div><p>A {size} calculus in the gallbladder.</p>`;
const BLANK_BODY = `<div class="section-heading">FINDINGS</div><p></p>`;

describe("the client reads the door's refusal as the door writes it", () => {
  it("parses an incomplete-Findings refusal out of HttpError.details", () => {
    const refusal = parseContentRefusal(http409(refusalBodyFor(EMPTY_FINDINGS)));
    expect(refusal).not.toBeNull();
    expect(refusal!.level).toBe("incomplete");
    expect(refusal!.code).toBe("report_content_incomplete");
    expect(refusal!.sections).toEqual(["findings"]);
    // The sentence is the door's, word for word — the screen adds nothing.
    expect(refusal!.sentence).toContain("Findings is empty");
  });

  it("carries the unresolved tokens through, not just the level", () => {
    const refusal = parseContentRefusal(http409(refusalBodyFor(PLACEHOLDER_BODY)));
    expect(refusal!.level).toBe("placeholder");
    expect(refusal!.placeholders).toEqual(["{size}"]);
  });

  it("parses the wholly blank report too", () => {
    const refusal = parseContentRefusal(http409(refusalBodyFor(BLANK_BODY)));
    expect(refusal!.level).toBe("empty");
  });

  it("takes the minimum length from the response, and it is the server's constant", () => {
    const refusal = parseContentRefusal(http409(refusalBodyFor(EMPTY_FINDINGS)));
    // Not a copy of the number: the same object the route answers with carries
    // it, and this is what the screen validates against.
    expect(refusal!.minReasonChars).toBe(CONTENT_OVERRIDE_MIN_REASON);
  });

  it("falls back to the server's current length when an older body omits it", () => {
    const older = { ...refusalBodyFor(EMPTY_FINDINGS) };
    delete (older as { override?: unknown }).override;
    const refusal = parseContentRefusal(http409(older));
    expect(refusal!.minReasonChars).toBe(CONTENT_OVERRIDE_MIN_REASON);
  });

  it("reads the sentence off the error when the body carries none", () => {
    const body = { ...refusalBodyFor(EMPTY_FINDINGS) };
    delete (body as { error?: string }).error;
    const refusal = parseContentRefusal(new HttpError("Findings is empty.", 409, body));
    expect(refusal!.sentence).toBe("Findings is empty.");
  });

  it("ignores every refusal that is not about content", () => {
    // These are the other 409s the same two routes answer with. None of them
    // may open the reason box: an unsigned signature is not a missing
    // Findings, and offering an override there would tell the radiologist that
    // documenting a reason gets a signature past a block that is not his to
    // override.
    const notContent = [
      { error: "The chosen signature is not active.", code: "signature_not_active" },
      { error: "Presentation template is not published.", code: "report_presentation_unresolved" },
      { error: "This report is locked by another session.", code: "LOCKED_BY_OTHER" },
      { error: "No authored content.", code: "report_content_", level: "" },
      { error: "Blank.", level: "empty" },
    ];
    for (const body of notContent) expect(parseContentRefusal(http409(body))).toBeNull();
    expect(parseContentRefusal(new Error("boom"))).toBeNull();
    expect(parseContentRefusal(new NetworkError("no route", null))).toBeNull();
    expect(parseContentRefusal(undefined)).toBeNull();
  });

  it("refuses to treat a gateway body as a content refusal", () => {
    // The transport rewrites an HTML error page into a message with no details
    // object; guessing a refusal from status 409 alone would arm the reason box
    // for a report the door never looked at.
    expect(parseContentRefusal(new HttpError("Server error (409)", 409, undefined))).toBeNull();
  });
});

describe("the reason the door will accept", () => {
  const MIN = CONTENT_OVERRIDE_MIN_REASON;

  it("names an empty box without pretending it is a length problem", () => {
    expect(overrideReasonProblem("", MIN)).toContain("at least");
    expect(overrideReasonProblem("      ", MIN)).toContain("at least");
  });

  it("counts characters after trimming, exactly as the door does", () => {
    const short = "See addendum";            // 12 characters
    expect(overrideReasonProblem(short, MIN)).toContain("12 of");
    expect(overrideReasonProblem(`  ${short}   `, MIN)).toContain("12 of");
    // Padding is not length. 40 spaces either side of the same 12 characters is
    // still 12 characters, which is the rule `readContentOverride` applies
    // server-side — a client that counted them would send a reason the door
    // then refuses, after the audit has already recorded the attempt.
    expect(overrideReasonProblem(" ".repeat(40) + short + " ".repeat(40), MIN)).toContain("12 of");
    // And a reason that reaches the minimum keeps reaching it once trimmed.
    expect(overrideReasonProblem(`  ${"x".repeat(MIN)}  `, MIN)).toBeNull();
  });

  it("accepts the boundary and rejects one character short", () => {
    const exact = "x".repeat(MIN);
    expect(overrideReasonProblem(exact, MIN)).toBeNull();
    expect(overrideReasonProblem("x".repeat(MIN - 1), MIN)).not.toBeNull();
  });

  it("sends the pair the refusal names, trimmed and with the flag set", () => {
    const sent = contentOverrideFields("  Findings dictated by phone, addendum to follow.  ");
    expect(sent).toEqual({
      contentOverride: true,
      contentOverrideReason: "Findings dictated by phone, addendum to follow.",
    });
    // And the door accepts exactly what this produces.
    expect(overrideReasonProblem(sent.contentOverrideReason, MIN)).toBeNull();
  });
});

describe("the refusal is titled by its level, not by its message", () => {
  it.each([
    ["incomplete", "Report is unfinished"],
    ["placeholder", "Report still has placeholder text"],
    ["empty", "Report has no content"],
  ] as const)("%s → %s", (level, title) => {
    expect(contentRefusalHeadline(level)).toBe(title);
  });
});
