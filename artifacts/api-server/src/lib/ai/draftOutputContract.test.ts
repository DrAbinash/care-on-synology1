/**
 * draftOutputContract.test.ts — the prompt and the parser, tied together.
 *
 * Audit C reproduced this by hand: `/draft` asked for an Impression, the model
 * answered in prose without the `IMPRESSION:` marker it was told to emit, and the
 * handler's `?? aiResponse` fallback returned THE ENTIRE RESPONSE as the
 * impression — labelled as a summarised Impression, with `parserSuccess: true`,
 * one Tab away into the radiologist's Impression field.
 *
 * These tests are the fence. They also pin the two halves together, because a
 * prompt that demands a marker the parser does not require (or vice versa) is the
 * same defect waiting to be written again.
 */
import { describe, expect, it } from "vitest";
import {
  DRAFT_SECTION_MARKERS,
  draftInstructionBlock,
  draftParseFailureMessage,
  parseDraftOutput,
} from "./draftOutputContract";

const FINDINGS = [
  "The ventricles and sulci are normal for age.",
  "No acute infarct, haemorrhage or mass lesion.",
  "Mild L4-L5 canal stenosis.",
].join(" ");

describe("an impression-only response is only ever an impression", () => {
  it("G16 — a marked impression parses", () => {
    const parsed = parseDraftOutput({
      aiResponse: `IMPRESSION: ${FINDINGS}`,
      field: "impression",
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.impression).toBe(FINDINGS);
    // An impression-only answer never produces findings, so no surface can offer
    // model text as a replacement for what the radiologist typed.
    expect(parsed.findings).toBe("");
  });

  it("the marker is read case-insensitively and with or without a colon, as before", () => {
    for (const form of ["IMPRESSION: Disc herniation L4-L5.", "Impression: Disc herniation L4-L5.", "IMPRESSION Disc herniation L4-L5."]) {
      const parsed = parseDraftOutput({ aiResponse: form, field: "impression" });
      expect(parsed.ok, form).toBe(true);
      expect(parsed.impression, form).toContain("Disc herniation L4-L5.");
    }
  });

  it("G15 — an unmarked answer is refused, not returned as an impression", () => {
    const blob = `${FINDINGS} No acute abnormality.`;
    const parsed = parseDraftOutput({ aiResponse: blob, field: "impression" });
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("missing_impression_marker");
    expect(parsed.impression).toBe("");
    // The defect, named: this is exactly what main handed back.
    expect(parsed.impression).not.toBe(blob);
    expect(parsed.findings).toBe("");
  });

  it("a chat preamble does not smuggle prose into the impression", () => {
    const parsed = parseDraftOutput({
      aiResponse: "Sure! Here is a summary of the study:\nNo acute infarct.",
      field: "impression",
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.impression).toBe("");
  });

  it("the refusal has an operator-facing sentence", () => {
    expect(draftParseFailureMessage("missing_impression_marker")).toMatch(/IMPRESSION:/);
    expect(draftParseFailureMessage("empty_response")).toMatch(/no text/i);
  });
});

describe("a full report response", () => {
  it("G17 — both marked sections parse", () => {
    const parsed = parseDraftOutput({
      aiResponse: `FINDINGS: ${FINDINGS}\nIMPRESSION: Mild L4-L5 canal stenosis.`,
      field: "full",
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.findings).toContain("canal stenosis");
    expect(parsed.impression).toBe("Mild L4-L5 canal stenosis.");
  });

  it("a full answer whose impression section is missing still yields its findings", () => {
    const parsed = parseDraftOutput({ aiResponse: `FINDINGS: ${FINDINGS}`, field: "full" });
    expect(parsed.ok).toBe(true);
    expect(parsed.impression).toBe("");
    expect(parsed.impressionMarkerFound).toBe(false);
  });

  it("an answer with no FINDINGS: marker is refused rather than echoed whole", () => {
    const parsed = parseDraftOutput({ aiResponse: FINDINGS, field: "full" });
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("missing_findings_marker");
    expect(parsed.findings).not.toBe(FINDINGS);
  });

  it("G18 — an empty response is refused with a reason", () => {
    for (const empty of ["", "   ", "\n\n"]) {
      for (const field of ["impression", "full"] as const) {
        const parsed = parseDraftOutput({ aiResponse: empty, field });
        expect(parsed.ok).toBe(false);
        expect(parsed.reason).toBe("empty_response");
      }
    }
  });

  it("null or undefined model output cannot throw or fabricate a section", () => {
    expect(parseDraftOutput({ aiResponse: null, field: "impression" }).reason).toBe("empty_response");
    expect(parseDraftOutput({ aiResponse: undefined, field: "full" }).ok).toBe(false);
  });
});

describe("the prompt and the parser are one contract", () => {
  it("the impression instruction demands exactly the marker the parser requires", () => {
    const instruction = draftInstructionBlock("impression");
    expect(instruction).toContain(DRAFT_SECTION_MARKERS.impression);
    // And it must not ask for a section the impression-only parser would then
    // refuse: this is the pairing that used to be able to drift.
    expect(instruction).not.toContain(DRAFT_SECTION_MARKERS.findings);
    const roundTrip = parseDraftOutput({
      aiResponse: `${DRAFT_SECTION_MARKERS.impression} No acute abnormality.`,
      field: "impression",
    });
    expect(roundTrip.ok).toBe(true);
  });

  it("the full instruction demands both markers and both parse", () => {
    const instruction = draftInstructionBlock("full");
    expect(instruction).toContain(DRAFT_SECTION_MARKERS.findings);
    expect(instruction).toContain(DRAFT_SECTION_MARKERS.impression);
    const roundTrip = parseDraftOutput({
      aiResponse: `${DRAFT_SECTION_MARKERS.findings} Normal study.\n${DRAFT_SECTION_MARKERS.impression} Normal.`,
      field: "full",
    });
    expect(roundTrip.ok).toBe(true);
  });

  it("every marker named in the `Return ONLY` block is a marker the parser knows", () => {
    for (const field of ["impression", "full"] as const) {
      const block = draftInstructionBlock(field).split("Return ONLY")[1] ?? "";
      const named = [...block.matchAll(/^([A-Z]{4,}):\s*\(/gm)].map((m) => `${m[1]}:`);
      expect(named.length).toBeGreaterThan(0);
      for (const marker of named) {
        expect(Object.values(DRAFT_SECTION_MARKERS)).toContain(marker);
      }
    }
  });

  it("the safety wording the clinic relies on is still in the instruction", () => {
    // A rewrite of the prompt is a clinical change and should not happen inside an
    // infrastructure PR; these sentences are the ones radiologists were promised.
    const impression = draftInstructionBlock("impression");
    expect(impression).toContain("Write ONLY the IMPRESSION for THIS study");
    expect(impression).toMatch(/Do NOT restate or rewrite the findings/);
    expect(impression).toMatch(/different modality or body region/);
    expect(draftInstructionBlock("full")).toMatch(/refined radiology report for THIS study only/);
  });
});
