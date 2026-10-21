/**
 * The shape check that stands between a model's answer and a clinician's Findings.
 *
 * Two failure directions matter, and the second is the one that gets reports wrong:
 * a false refusal costs a radiologist their own text, so the ordinary prose of a
 * report has to pass untouched. Each accepting case below is a line a real CARE report
 * carries; each rejecting case is a line a local model actually produced in the browser
 * run of 2026-10-21 and that Apply wrote into Findings verbatim.
 */
import { describe, it, expect } from "vitest";
import { findAiReportTextDefects, describeAiReportTextRefusal } from "./aiDraftShape";

const kinds = (text: string) => findAiReportTextDefects(text).map((d) => d.kind);

describe("report prose is accepted — a false refusal costs the radiologist their own text", () => {
  it.each([
    ["a plain finding", "Small disc bulge at L4-L5 with no canal stenosis. The neural foramina are patent."],
    ["a dictated brain finding", "There is a 6 mm non-enhancing T2/FLAIR hyperintense focus in the right frontal subcortical white matter.\nThe remainder of the examination is unremarkable."],
    ["a numbered conclusion", "1. Normal MRI of the brain.\n2. No acute intracranial abnormality."],
    ["sequence names with hyphens and slashes", "T2-weighted and FLAIR sequences were obtained. No restricted diffusion is seen on DWI/ADC."],
    ["a sentence that begins by pointing something out", "Note the small right posterior fossa arachnoid cyst, unchanged from the prior study."],
    ["measurements and laterality", "A 2.4 cm x 1.8 cm lesion in the left hepatic lobe shows peripheral nodular enhancement."],
    ["a normal study line", "No acute infarct is seen. No intracranial hemorrhage is seen."],
    ["an em-dash and a parenthetical", "Mild degenerative change — endplate Modic type 1 at L4-L5 (see prior MR of 12/2025)."],
    ["a colon-led heading the model likes to write", "Findings: no acute intracranial abnormality."],
    ["a comparison sentence", "The appearance is similar to the examination of 3 September 2026."],
  ])("accepts %s", (_label, text) => {
    expect(findAiReportTextDefects(text)).toEqual([]);
  });

  it("accepts an empty draft as fit — emptiness is a different refusal, and it already exists", () => {
    expect(findAiReportTextDefects("")).toEqual([]);
    expect(findAiReportTextDefects("   \n  ")).toEqual([]);
  });
});

describe("chat and machine output are rejected before they can become a finding", () => {
  it("rejects the preamble this project measured from the local model", () => {
    const chat = [
      "Here's the report wording based on your dictation and clinical history: \"There is a 6 mm non-enhancing, T2/FLAIR hyperintense focus within the right frontal subcortical white matter.\"",
      "*   **This is a draft.** A radiologist would likely add more context and nuance to the report.",
      "*   **Correlation is key.** The report should state something like: \"Correlation with clinical findings may be warranted.\"",
    ].join("\n");
    expect(kinds(chat)).toEqual(expect.arrayContaining(["markdown", "conversational"]));
  });

  it("rejects a fenced code block and a JSON body", () => {
    expect(kinds("```json\n{\"findings\": \"Normal.\"}\n```")).toEqual(expect.arrayContaining(["markdown", "structured"]));
    expect(kinds('{"impression": "No acute abnormality.", "confidence": 0.9}')).toContain("structured");
  });

  it("rejects model self-reference and advice about the report", () => {
    for (const line of [
      "As an AI language model, I can't provide a diagnosis.",
      "I cannot determine the significance of this finding without clinical context.",
      "Important Considerations:",
      "Please note that this is a preliminary interpretation.",
      "You should correlate these findings with the patient's symptoms.",
      "Would you like me to expand on any of these points?",
    ]) {
      expect(kinds(line), line).toContain("conversational");
    }
  });

  it("rejects bullet lists and bold markup in any position on the line", () => {
    expect(kinds("- No acute infarct is seen.")).toContain("markdown");
    expect(kinds("• Mild disc bulge at L4-L5.")).toContain("markdown");
    expect(kinds("**Impression:** Normal study.")).toContain("markdown");
    expect(kinds("# Findings")).toContain("markdown");
    expect(kinds("> Quoted from the prior report.")).toContain("markdown");
  });

  it("rejects an XML-shaped response", () => {
    expect(kinds("<finding>No acute abnormality.</finding>")).toContain("structured");
  });

  it("reports each defect once, and names the line so a clinician can see which one", () => {
    const defects = findAiReportTextDefects("- One.\n- Two.\n- Three.");
    expect(defects).toHaveLength(1);
    expect(defects[0].line).toBe("- One.");
  });

  it("keeps a valid sentence that sits in the same draft, rather than pretending it is fine", () => {
    const mixed = "Small disc bulge at L4-L5 with no canal stenosis.\nHere's the rest of the report:";
    expect(kinds(mixed)).toEqual(["conversational"]);
    // The whole draft is refused: silently dropping the chatty line would be an
    // unreviewed edit to a clinical document, which is not this check's to make.
    expect(findAiReportTextDefects(mixed)[0].line).toBe("Here's the rest of the report:");
  });
});

describe("the refusal is the clinician's, not a stack trace", () => {
  it("says what was seen, that nothing was changed, and how to recover", () => {
    const sentence = describeAiReportTextRefusal(findAiReportTextDefects("- Normal study."));
    expect(sentence).toContain("Markdown formatting");
    expect(sentence).toContain("nothing was changed");
    expect(sentence).toContain("Saved Drafts");
  });

  it("joins two reasons without a dangling comma", () => {
    const sentence = describeAiReportTextRefusal([
      { kind: "markdown", line: "- a" },
      { kind: "conversational", line: "Here's a summary:" },
    ]);
    expect(sentence).toContain(
      "carries Markdown formatting (bullets, bold or code) and a conversational introduction or commentary rather than report text",
    );
    expect(sentence).not.toContain("code), and a conversational");
  });
});
