/**
 * startReportDelegation.contract.test.ts — PR B: Start Report is the deterministic
 * generator, and nothing else.
 *
 * What the workflow used to do: the amber "Start Report" banner called
 * `startReportBootstrap`, which wrote the structured template's normal text over
 * the Findings box with `setFindings`, wrote the template's default Impression
 * over the Conclusion, filled "Please correlate with clinical findings." into
 * every Recommendation, and then set `useStructured` so the section cards became
 * the report body — a surface that is switched off, while the PDF and Word
 * export still build the printed findings out of those cards. The banner itself
 * sat behind `{false && …}`, so the one status line that told the radiologist to
 * press Start Report named a button that did not exist anywhere on screen.
 *
 * These cases pin the four properties PR B claims, each written so it fails when
 * the property breaks:
 *   1. Start Report's setup half writes no report prose at all.
 *   2. Its content half is `generateProfessionalReport` and nothing else.
 *   3. There is exactly one whole-report generator, and the strip that stays
 *      switched off cannot quietly become a second one.
 *   4. The AI generator is named as AI; the deterministic one says "No AI".
 *
 * There is no browser harness on this machine, so the UI is pinned at source
 * rather than simulated — stated plainly so nobody reads a green suite as a
 * clicked-through workflow.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (...parts: string[]) =>
  readFileSync(resolve(__dirname, ...parts), "utf8").replace(/\r\n/g, "\n");

const STUDY_SETUP = read("../hooks/useReportingStudySetup.ts");
const CLINICAL_UI = read("../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const CANVAS = read("../components/radiology/workspace/ReportCanvas.tsx");
const READY_STRIP = read("../lib/studyReadyStatus.ts");
const AI_PANEL = read("../components/ai/AiDraftPanel.tsx");

/**
 * One function body, bounded on syntactic markers rather than a character budget:
 * a fixed-length slice silently empties itself when a comment above the function
 * grows, and every assertion inside it then passes on nothing.
 */
function boundedBy(src: string, startMarker: string, endMarker: string, label: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `${label}: could not find "${startMarker}"`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(end, `${label}: no end marker "${endMarker}" after it`).toBeGreaterThan(start);
  const body = src.slice(start, end);
  // Positive control — the slice must really hold the code it claims to hold.
  expect(body.length, `${label}: sliced an empty body`).toBeGreaterThan(200);
  return body;
}

/**
 * The opening tag of the Button that carries this `data-testid`, located at run
 * time instead of by counting characters from it.
 *
 * A fixed window is a prop budget wearing a hat: any attribute added to the
 * button — including one that changes nothing — pushes the disclaimer outside it
 * and the test fails on the layout rather than on the claim. Taking the element's
 * own tag says what is actually promised *on that control*, which is the thing
 * that matters: a "No AI" sitting on a neighbouring element would not tell the
 * radiologist anything about the button he presses.
 */
function openingTag(src: string, testid: string): string {
  const at = src.indexOf(`data-testid="${testid}"`);
  expect(at, `no control with data-testid="${testid}"`).toBeGreaterThanOrEqual(0);
  const open = src.lastIndexOf("<Button", at);
  expect(open, `the "${testid}" control is not a Button`).toBeGreaterThanOrEqual(0);
  // An inline handler's `=>` is not the end of the tag.
  let close = src.indexOf(">", at);
  while (close !== -1 && src[close - 1] === "=") close = src.indexOf(">", close + 1);
  expect(close, `the "${testid}" Button never closes`).toBeGreaterThan(at);
  return src.slice(open, close);
}

/** Count every occurrence, so "exactly one" is a measurement and not a guess. */
function occurrences(src: string, needle: string): number {
  let n = 0;
  let at = src.indexOf(needle);
  while (at !== -1) {
    n += 1;
    at = src.indexOf(needle, at + needle.length);
  }
  return n;
}

describe("Start Report's setup half writes no report prose", () => {
  const setup = boundedBy(
    STUDY_SETUP,
    "const startReportSetup = useCallback(",
    "\n  /** Parse findings section cards",
    "startReportSetup",
  );

  it("replaces no report field", () => {
    // `setX`/`replaceX` on the prose fields are the destructive writers — they
    // are what deleted a radiologist's pre-selected findings. Checked against
    // the call shape (`(`) rather than the bare name, because the body explains
    // in prose why `replaceTechnique` is not one of them.
    for (const writer of [
      "setFindings(", "setImpression(", "setRecommendation(", "setClinicalHistory(",
      "replaceFindings(", "replaceImpression(", "replaceRecommendation(",
      "setTechnique(", "replaceTechnique(",
    ]) {
      expect(setup, `the setup half writes prose again: ${writer}`).not.toContain(writer);
    }
  });

  it("does not select the template the way the Templates dropdown does", () => {
    // `selectTemplateManual` is not a label — it is the trigger. The effect
    // behind it replaces technique, findings and impression with the template's
    // copy, so calling it here would re-create the overwrite one line away from
    // where the overwrite was deleted.
    expect(setup).not.toContain("selectTemplateManual(");
    expect(setup).toContain('templateApplySourceRef.current = "auto"');
  });

  it("still loads the study's protocol and template", () => {
    // Removing the destructive writes must not remove the setup the one-click was
    // actually for, or Start Report becomes a button that does nothing.
    expect(setup).toContain("applyProtocol(");
    expect(setup).toContain("pickStructuredTemplateForRegion(");
    expect(setup).toContain("setSelectedTemplateId(");
    expect(setup).toContain("setters.mergeTechnique(");
  });

  it("cannot move the report body to the invisible section cards", () => {
    // `useStructured` flips the on-screen editor to free text but flips the
    // printed findings to the cards, so a report could print something nobody
    // could see or edit.
    expect(setup).not.toContain("setUseStructured(");
    expect(setup).not.toContain("setFindingsMap(");
    expect(CLINICAL_UI.slice(
      CLINICAL_UI.indexOf("const handleStartReport = useCallback("),
      CLINICAL_UI.indexOf("const undoStartReport = useCallback("),
    )).not.toContain("setUseStructured(");
  });

  it("no longer hands the caller a section map to render as cards", () => {
    expect(setup).not.toContain("sectionMap");
  });

  it("has stopped promising the filler recommendation", () => {
    // The one-click used to write this over the Recommendation box, including
    // over one the radiologist had dictated. It still exists as a *fill-empty*
    // default on the template-apply effect and as a Recommendation chip, which
    // is a content decision CARE has already made; replacing text nobody wrote
    // is not the same defect and is not what this pins.
    expect(setup).not.toContain("Please correlate with clinical findings.");
  });

  it("leaves no destructive bootstrap behind to be re-pointed at", () => {
    expect(STUDY_SETUP).not.toContain("startReportBootstrap");
    expect(CLINICAL_UI).not.toContain("startReportBootstrap");
  });
});

describe("Start Report's content half is the deterministic generator", () => {
  const handler = boundedBy(
    CLINICAL_UI,
    "const handleStartReport = useCallback(",
    "const undoStartReport = useCallback(",
    "handleStartReport",
  );

  it("delegates the report to generateProfessionalReport, after the setup", () => {
    expect(handler).toContain("studySetup.startReportSetup()");
    expect(handler).toContain("generateProfessionalReport(");
    // Setup first, generation second: generating first would snapshot the state
    // before the protocol line existed, so Undo would leave half the click behind.
    expect(handler.indexOf("startReportSetup()")).toBeLessThan(handler.indexOf("generateProfessionalReport("));
  });

  it("resolves the exam from the billed name, the same way Quick Normal does", () => {
    // Two identity rules would let the two buttons pick two different reports.
    expect(handler).toContain("billedStudyContextForNormal(");
    expect(handler).toContain("billedNameFromWorklistRow(workflow.currentRow)");
  });

  it("refuses on the composed lock before writing anything", () => {
    expect(handler).toMatch(/if \(contentLocked\) return;/);
  });

  it("says what happened, including when nothing was generated", () => {
    expect(handler).toContain('"Professional report generated"');
    expect(handler).toContain('variant: "destructive"');
    expect(handler).toContain("outcome.reason");
  });

  it("writes no prose itself — it delegates the whole report", () => {
    // The handler is allowed to read the store and to call the one action. Every
    // field write it makes for its own would be a second implementation of the
    // report, outside the merge rules and outside the store's test suite.
    for (const writer of [
      "setField(", "mergeField(", "setFindings(", "setImpression(", "setRecommendation(",
      "replaceFindings(", "applyFormatById(", "applySelectedFormats(",
    ]) {
      expect(handler, `Start Report writes the report itself: ${writer}`).not.toContain(writer);
    }
  });

  it("keeps one undo mechanism instead of adding a second snapshot", () => {
    // The store's clinical frame is the undo. A hand-kept field snapshot restores
    // the prose while the ledger keeps the baseline observations the press also
    // wrote — which is what the old bootstrap did.
    expect(handler).not.toContain("startReportUndoRef");
    expect(handler).not.toContain("setCanUndoStartReport");
  });
});

describe("exactly one whole-report generator", () => {
  it("the canvas holds one generator control", () => {
    expect(occurrences(CANVAS, 'data-testid="generate-professional-report"')).toBe(1);
  });

  it("the canvas holds no generation path of its own", () => {
    // The button calls the shared handler. An inline call here would be a second
    // implementation the store's test suite never runs.
    expect(occurrences(CANVAS, "generateProfessionalReport(")).toBe(0);
  });

  it("the retired banner stays switched off, so it cannot become a duplicate", () => {
    expect(CANVAS).toContain("{false && !contentLocked && reportNeedsStart");
    expect(occurrences(CANVAS, 'data-testid="btn-start-report"')).toBe(1);
  });

  it("the status strip names the button that is actually on the screen", () => {
    // The defect this replaces: "Empty report · Start Report" while no Start
    // Report button rendered. Pin both sides — a label naming a control only
    // means something if that control exists.
    const label = READY_STRIP.match(/kind: "empty_start",\s*\n\s*label: "([^"]+)"/);
    expect(label, "empty_start no longer returns a single-line label").not.toBeNull();
    const named = label![1].replace(/^Empty report · press /, "");
    expect(named).toBe("Generate Professional Report");
    expect(CANVAS).toContain(named);
  });
});

describe("the AI path is named as AI and the deterministic path says so", () => {
  it("the AI draft button names the model as its author", () => {
    expect(AI_PANEL).toContain('"Generate Draft with AI"');
    // The bare label it had before: two controls in one workspace both saying
    // "Generate", one of which was optional and one of which was the report.
    expect(AI_PANEL).not.toContain(': "Generate"}');
  });

  it("no deterministic control in the canvas wears the AI icon", () => {
    expect(occurrences(CANVAS, "<Sparkles")).toBe(0);
  });

  it("the generator tells him plainly that it is not AI", () => {
    // Pinned on the control itself, and on the handler that makes it the
    // generator: the disclaimer and the action have to be the same element, or
    // "No AI" is decoration somewhere on the canvas rather than a promise about
    // what this press does.
    const tag = openingTag(CANVAS, "generate-professional-report");
    expect(tag).toContain("No AI");
    expect(tag).toContain("onClick={handleStartReport}");
  });
});
