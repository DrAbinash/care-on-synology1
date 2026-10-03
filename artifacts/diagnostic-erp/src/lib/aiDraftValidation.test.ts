/**
 * draftValidationNotice — what a radiologist is told about an AI draft.
 *
 * The server computes the grounding verdict (composer's own validator). These
 * tests pin the presentation rule, and in particular the one judgement call
 * that decides whether Ctrl+I is usable: an Impression is a summary, so a
 * missing measurement is not evidence of anything, while a full-report draft is
 * expected to carry every supplied measurement forward. Getting that wrong in
 * either direction is bad — warn on every press and the toast gets ignored,
 * never warn and a rewritten 8.7 mm reaches the signed report unremarked.
 */
import { describe, expect, it } from "vitest";
import type { AiDraftValidation } from "@workspace/api-zod";
import { draftValidationNotice } from "./aiDraftValidation";

function validation(over: Partial<AiDraftValidation> = {}): AiDraftValidation {
  return {
    ok: true,
    blocking: false,
    errors: [],
    warnings: [],
    unsupportedMentions: [],
    lateralitySwaps: [],
    levelChanges: [],
    severityEscalations: [],
    validator: "reportComposer.validateComposerOutput",
    notChecked: [],
    imagesSentToModel: 0,
    ...over,
  };
}

describe("draftValidationNotice", () => {
  it("says nothing when the server did not send a verdict", () => {
    expect(draftValidationNotice(undefined, { impressionOnly: true })).toBeNull();
    expect(draftValidationNotice(null, { impressionOnly: false })).toBeNull();
  });

  it("says nothing when the draft is grounded", () => {
    expect(draftValidationNotice(validation(), { impressionOnly: true })).toBeNull();
  });

  it("names a clinical term the findings never contained", () => {
    const notice = draftValidationNotice(
      validation({ ok: false, errors: ["unsupported_abnormality"], unsupportedMentions: ["stenosis"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/stenosis/);
    expect(notice).toMatch(/nowhere in your findings/);
  });

  it("names a side change", () => {
    const notice = draftValidationNotice(
      validation({ ok: false, lateralitySwaps: ["right→left"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/changed the side/);
    expect(notice).toContain("right→left");
  });

  it("names a spinal level the findings never mentioned", () => {
    const notice = draftValidationNotice(
      validation({ ok: false, errors: ["level_change"], levelChanges: ["L3-L4"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/L3-L4/);
    expect(notice).toMatch(/a level not in your findings/);
  });

  it("names a severity escalation", () => {
    const notice = draftValidationNotice(
      validation({ ok: false, severityEscalations: ["mild→severe"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/escalated severity/);
    expect(notice).toContain("mild→severe");
  });

  it("does NOT warn about a dropped measurement on an impression — a summary condenses", () => {
    const v = validation({ ok: false, errors: ["measurement_mutation"] });
    expect(draftValidationNotice(v, { impressionOnly: true })).toBeNull();
  });

  it("DOES warn about a dropped measurement on a full-report draft", () => {
    const v = validation({ ok: false, errors: ["measurement_mutation"] });
    expect(draftValidationNotice(v, { impressionOnly: false })).toMatch(/dropped or altered a supplied measurement/);
  });

  it("never presents an unvouched-for draft as clean", () => {
    // An error code this module has never seen. It must surface by default
    // rather than be swallowed, or a check added to the validator later would
    // silently stop reaching the radiologist.
    const notice = draftValidationNotice(
      validation({ ok: false, errors: ["some_future_check"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/failed a grounding check \(some_future_check\)/);
  });

  it("phrases an ungrounded impression in clinical language, not as a raw error code", () => {
    // The validator raises this with an EMPTY unsupportedMentions list (it only
    // runs when that list is empty), so it cannot be phrased by the term check
    // above — it has to be phrased here or it reaches the radiologist as
    // "impression_ungrounded".
    const notice = draftValidationNotice(
      validation({ ok: false, errors: ["impression_ungrounded"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/states an abnormality in the Impression that the Findings do not support/);
    expect(notice).not.toMatch(/impression_ungrounded/);
  });

  it("caps the term list instead of dumping the whole vocabulary", () => {
    const notice = draftValidationNotice(
      validation({
        ok: false,
        unsupportedMentions: ["stenosis", "infarct", "aneurysm", "occlusion", "thrombus"],
      }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/stenosis, infarct and 3 more/);
  });

  it("de-duplicates repeated terms", () => {
    const notice = draftValidationNotice(
      validation({ ok: false, unsupportedMentions: ["stenosis", "stenosis"] }),
      { impressionOnly: true },
    );
    expect(notice).toMatch(/names stenosis, which/);
  });

  it("every non-null notice ends by telling the radiologist to verify before accepting", () => {
    const cases: AiDraftValidation[] = [
      validation({ ok: false, unsupportedMentions: ["stenosis"] }),
      validation({ ok: false, lateralitySwaps: ["right→left"] }),
      validation({ ok: false, levelChanges: ["L3-L4"] }),
      validation({ ok: false, severityEscalations: ["mild→severe"] }),
      validation({ ok: false, errors: ["measurement_mutation"] }),
      validation({ ok: false, errors: ["empty_output"] }),
    ];
    for (const v of cases) {
      for (const impressionOnly of [true, false]) {
        const notice = draftValidationNotice(v, { impressionOnly });
        if (notice === null) continue;
        expect(notice).toMatch(/Verify against the images before accepting\.$/);
      }
    }
  });
});
