import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ComposerIdentityStrip from "@/components/radiology/workspace/ComposerIdentityStrip";
import { describeComposerStudyScope, type ComposerScopeDisplay } from "./composerStudyScopeDisplay";
import type { ReportDemography } from "./reportDemography";
import type { StudyScopeProposal } from "./studyRegion";

// vitest's node config compiles JSX with the classic runtime, so a component
// module reads `React` off the global when it renders. Vite's browser build
// injects the automatic runtime and needs nothing of the kind — this line
// exists only so the assertions below can look at real markup.
(globalThis as { React?: unknown }).React = React;

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const scope = (over: Partial<StudyScopeProposal>): StudyScopeProposal => ({
  billedRegions: ["Brain"],
  performedRegions: ["Brain", "C Spine"],
  addedRegions: ["C Spine"],
  proposedRegions: ["Brain", "C Spine"],
  ...over,
});

describe("item 22 — booked examination and performed acquisition, as two statements", () => {
  it("1. a booked appointment says nothing has arrived, whatever the worklist description claims", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI BRAIN + CX SCR",
      status: "SCHEDULED",
    });
    expect(out.acquisition.state).toBe("awaiting");
    expect(out.acquisition.label).toMatch(/no images/i);
    expect(out.booked).toBe("MRI Brain");
    expect(out.bookedIsBilled).toBe(true);
    // The two names cannot disagree about an acquisition that has not happened,
    // and a warning about it would be a warning about the appointment.
    expect(out.notice).toBeNull();
  });

  it("2. the status is read case- and space-insensitively, like the readiness rule it reuses", () => {
    expect(
      describeComposerStudyScope({ status: " scheduled ", worklistStudyDescription: "MRI BRAIN" })
        .acquisition.state,
    ).toBe("awaiting");
  });

  it("3. an unknown status never claims the study is awaiting images", () => {
    // A deep-linked study with no queue row must not be told its images have not
    // arrived — that assertion needs a status, and the honest answer is the
    // description the study row does carry.
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI Brain",
      status: null,
    });
    expect(out.acquisition.state).toBe("described");
  });

  it("4. an arrived study with no description says so instead of going blank", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "   ",
      status: "STUDY_RECEIVED",
    });
    expect(out.acquisition.state).toBe("unlabelled");
    expect(out.acquisition.label).toMatch(/no examination name/i);
    expect(out.notice).toBeNull();
  });

  it("5. the same examination spelled two ways is not a conflict", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "BRAIN MRI",
      status: "STUDY_RECEIVED",
    });
    expect(out.acquisition.state).toBe("described");
    expect(out.acquisition.label).toBe("BRAIN MRI");
    expect(out.notice).toBeNull();

    // The other side of the same rule, and the one a word count cannot see:
    // `MRI Brain Orbits` and `MRI BRAIN STEM` are two requests of two words
    // each. Ordering alone must stay silent, or every re-spelling shouts.
    const near = describeComposerStudyScope({
      billedTestName: "MRI Brain Orbits",
      worklistStudyDescription: "MRI BRAIN STEM",
      status: "STUDY_RECEIVED",
    });
    expect(near.notice).toBe("Booked MRI Brain Orbits — the study row says MRI BRAIN STEM");
    const reordered = describeComposerStudyScope({
      billedTestName: "MRI Brain Orbits",
      worklistStudyDescription: "MRI ORBITS BRAIN",
      status: "STUDY_RECEIVED",
    });
    expect(reordered.notice).toBeNull();
  });

  it("6. punctuation and case alone do not make two examinations either", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI - Brain",
      worklistStudyDescription: "MRI BRAIN",
      status: "STUDY_RECEIVED",
    });
    expect(out.notice).toBeNull();
  });

  it("7. a different modality on the same body part is a conflict, not a spelling", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "CT BRAIN",
      status: "STUDY_RECEIVED",
    });
    expect(out.notice).toBe("Booked MRI Brain — the study row says CT BRAIN");
  });

  it("8. MR and MRI are one modality, and a name that spells none cannot contradict one", () => {
    expect(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "MR BRAIN",
        status: "STUDY_RECEIVED",
      }).notice,
    ).toBeNull();
    expect(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "BRAIN",
        status: "STUDY_RECEIVED",
      }).notice,
    ).toBeNull();
    // A study row that names no examination at all cannot contradict the bill —
    // it is the `unlabelled` case wearing a modality.
    expect(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "MRI",
        status: "STUDY_RECEIVED",
      }).notice,
    ).toBeNull();
  });

  it("9. a real addition is named, in the bill's words and the study's words", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI BRAIN + CX SCR",
      status: "STUDY_RECEIVED",
      scopeProposal: scope({}),
    });
    expect(out.notice).toBe("Booked Brain — the study covers Brain + C Spine");
  });

  it("10. the region reading leads the text reading, so the strip cannot contradict the scope question", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI BRAIN + CX SCR",
      status: "STUDY_RECEIVED",
      scopeProposal: scope({ billedRegions: ["Brain"], performedRegions: ["Brain", "C Spine"] }),
    });
    expect(out.notice).not.toContain("the study row says");
  });

  it("11. with no region match to lean on, a different name is still named", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI Brain, C Spine",
      status: "STUDY_RECEIVED",
      scopeProposal: null,
    });
    expect(out.notice).toBe("Booked MRI Brain — the study row says MRI Brain, C Spine");
  });

  it("12. an empty addition list does not count as a region reading", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI Brain, C Spine",
      status: "STUDY_RECEIVED",
      scopeProposal: scope({ addedRegions: [] }),
    });
    expect(out.notice).toContain("the study row says");
  });

  it("13. the notice only ever speaks about a described acquisition", () => {
    const awaiting = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI BRAIN + CX SCR",
      status: "SCHEDULED",
      scopeProposal: scope({}),
    });
    const unlabelled = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      status: "STUDY_RECEIVED",
      scopeProposal: scope({ billedRegions: [], addedRegions: [], performedRegions: [], proposedRegions: [] }),
    });
    expect(awaiting.notice).toBeNull();
    expect(unlabelled.notice).toBeNull();
  });

  it("14. a study with no billed name falls back to the merged description and says it is not the bill", () => {
    const out = describeComposerStudyScope({
      billedTestName: null,
      mergedDescription: "MRI BRAIN + CX SCR",
      worklistStudyDescription: "MRI BRAIN + CX SCR",
      status: "STUDY_RECEIVED",
    });
    expect(out.booked).toBe("MRI BRAIN + CX SCR");
    expect(out.bookedIsBilled).toBe(false);
    expect(out.notice).toBeNull();
  });

  it("15. nothing named at all yields an empty booked line, which the strip renders as a dash", () => {
    const out = describeComposerStudyScope({});
    expect(out.booked).toBe("");
    expect(out.bookedIsBilled).toBe(false);
    expect(out.acquisition.state).toBe("unlabelled");
    expect(out.notice).toBeNull();
  });

  it("16. the body-part tag reaches the tooltip, underscores turned into words", () => {
    const out = describeComposerStudyScope({
      billedTestName: "MRI Brain",
      worklistStudyDescription: "MRI Brain",
      status: "STUDY_RECEIVED",
      bodyPart: "SPINE_CERVICAL",
    });
    expect(out.acquisition.detail).toContain("body part SPINE CERVICAL");
  });

  it("17. an empty billed name never wins over the merged description with whitespace", () => {
    const out = describeComposerStudyScope({
      billedTestName: "   ",
      mergedDescription: "CT Head",
      status: "STUDY_RECEIVED",
    });
    expect(out.booked).toBe("CT Head");
    expect(out.bookedIsBilled).toBe(false);
  });
});

describe("item 22 — the strip and its wiring", () => {
  const strip = read("components/radiology/workspace/ComposerIdentityStrip.tsx");
  const canvas = read("components/radiology/workspace/ReportCanvas.tsx");
  const hook = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");

  it("18. the identity row is untouched — the addition is a second row, not a replacement", () => {
    expect(strip).toContain('data-testid="composer-identity-strip"');
    expect(strip).toContain('data-testid="composer-identity-name"');
    expect(strip).toContain("demography.patientName");
    expect(strip).toContain("UHID {demography.uhid}");
    expect(strip).toContain("ACC {demography.accessionNumber}");
  });

  it("19. the strip renders all three statements, and its own testids are not behind a condition", () => {
    expect(strip).toContain('data-testid="composer-scope-booked"');
    expect(strip).toContain('data-testid="composer-scope-acquisition"');
    expect(strip).toContain('data-testid="composer-scope-notice"');
    // booked and acquisition always render: an absent line would look like
    // "nothing disagrees" rather than "nothing was said".
    const bookedAt = strip.indexOf('data-testid="composer-scope-booked"');
    expect(strip.slice(bookedAt - 120, bookedAt)).not.toMatch(/\?\s*\(/);
    const acqAt = strip.indexOf('data-testid="composer-scope-acquisition"');
    expect(strip.slice(acqAt - 120, acqAt)).not.toMatch(/\?\s*\(/);
    // The notice IS conditional — but on the notice, and on nothing else. Bounded
    // region, so `{false && …}` and a flag that is never true both fail here.
    expect(strip).not.toContain("false &&");
    const gateAt = strip.indexOf("{scope.notice ? (");
    const noticeAt = strip.indexOf('data-testid="composer-scope-notice"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(noticeAt).toBeGreaterThan(gateAt);
    expect(noticeAt - gateAt).toBeLessThan(200);
  });

  it("20. the single ambiguous description string is gone from the strip", () => {
    // The old row printed `demography.studyDescription` — one string that
    // `mergeReportDemography` fills from the worklist whenever it has one, which
    // is the ambiguity this item exists to remove.
    expect(strip).not.toContain("demography.studyDescription");
    expect(strip).toContain("scope.acquisition.label");
    expect(strip).toContain("scope.booked");
  });

  it("21. the canvas feeds the strip both the demography and the scope, unconditionally", () => {
    const at = canvas.indexOf("<ComposerIdentityStrip");
    expect(at).toBeGreaterThan(-1);
    const block = canvas.slice(at, at + 300);
    expect(block).toContain("demography={canonicalDemography}");
    expect(block).toContain("scope={composerScopeDisplay}");
    // Not `{someFlag ? <ComposerIdentityStrip … /> : null}`.
    expect(canvas.slice(at - 40, at)).not.toMatch(/\?\s*\($/);
  });

  it("22. the view model is built from the names CARE already has, with the queue row first", () => {
    expect(hook).toContain('describeComposerStudyScope');
    const from = hook.indexOf("describeComposerStudyScope({");
    expect(from).toBeGreaterThan(-1);
    // Bounded at the call's own close, so a pin cannot be satisfied by the
    // dependency array below it — the dep repeats the expression, the argument
    // is the wiring.
    const args = hook.slice(from, from + hook.slice(from).indexOf("})"));
    expect(args).toContain("workflow.currentRow?.testName");
    expect(args).toContain("worklistDetailQ.data?.testName");
    expect(args).toContain("worklistStudyDescription: studySetup.studyContext.studyDescription,");
    expect(args).toContain("modality: studySetup.studyContext.modality,");
    expect(args).toContain("scopeProposal: studySetup.autoRegionMatch?.scopeProposal ?? null,");
    expect(args).toContain("status: authoritativeStatus,");
    expect(args).toContain("mergedDescription: canonicalDemography.studyDescription,");
    // The billed name is compared, never replaced: nothing here can move a region.
    expect(args).not.toContain("handleRegionToggle");
    // ...and the memo re-runs when any of those reads change. The array is read
    // from AFTER the call's close, or the argument lines above answer for it.
    const argsEnd = from + hook.slice(from).indexOf("})");
    const deps = hook.slice(argsEnd, argsEnd + hook.slice(argsEnd).indexOf("],"));
    expect(deps).toContain("[");
    expect(deps).toContain("authoritativeStatus,");
    expect(deps).toContain("studySetup.autoRegionMatch,");
    expect(deps).toContain("canonicalDemography.studyDescription,");
  });

  it("23. the scope display is returned by the hook that feeds the canvas", () => {
    const at = hook.indexOf("const composerScopeDisplay = useMemo(");
    expect(at).toBeGreaterThan(-1);
    const rest = hook.slice(at);
    expect(rest.slice(0, rest.indexOf("composerScopeDisplay,"))).toContain("describeComposerStudyScope");
    expect(rest).toContain("composerScopeDisplay,");
  });
});

const DEMOGRAPHY: ReportDemography = {
  patientName: "SYNTHETIC PATIENT ALPHA",
  age: "42Y",
  sex: "F",
  patientId: "PID-1",
  uhid: "UH-9",
  accessionNumber: "ACC-9",
  studyDescription: "MRI BRAIN + CX SCR",
  studyDate: "13/11/2026",
  referringDoctor: "DR REFERRING",
  dateOfBirth: "01/01/1984",
};

const renderStrip = (view: ComposerScopeDisplay) =>
  renderToStaticMarkup(React.createElement(ComposerIdentityStrip, { demography: DEMOGRAPHY, scope: view }));

const countOf = (html: string, needle: string) => html.split(needle).length - 1;

describe("item 22 — what the strip actually renders", () => {
  it("24. a booked appointment says the machine has sent nothing, and names no conflict", () => {
    const html = renderStrip(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "MRI BRAIN + CX SCR",
        status: "SCHEDULED",
      }),
    );
    expect(html).toContain("Booked");
    expect(html).toContain("MRI Brain");
    expect(html).toContain("No images received from the machine yet");
    expect(countOf(html, 'data-testid="composer-scope-notice"')).toBe(0);
  });

  it("25. a study row that names a different examination prints both names and the notice", () => {
    const html = renderStrip(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "MRI BRAIN + CX SCR",
        status: "STUDY_RECEIVED",
      }),
    );
    expect(countOf(html, 'data-testid="composer-scope-booked"')).toBe(1);
    expect(countOf(html, 'data-testid="composer-scope-acquisition"')).toBe(1);
    expect(html).toContain("Study says");
    expect(html).toContain("Booked MRI Brain — the study row says MRI BRAIN + CX SCR");
    expect(countOf(html, 'data-testid="composer-scope-notice"')).toBe(1);
  });

  it("26. agreement keeps both statements and drops only the notice", () => {
    const html = renderStrip(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "BRAIN MRI",
        status: "STUDY_RECEIVED",
      }),
    );
    expect(countOf(html, 'data-testid="composer-scope-booked"')).toBe(1);
    expect(countOf(html, 'data-testid="composer-scope-acquisition"')).toBe(1);
    expect(countOf(html, 'data-testid="composer-scope-notice"')).toBe(0);
  });

  it("27. the region reading is the sentence the radiologist sees", () => {
    const html = renderStrip(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "MRI BRAIN + CX SCR",
        status: "STUDY_RECEIVED",
        scopeProposal: scope({}),
      }),
    );
    expect(html).toContain("Booked Brain — the study covers Brain + C Spine");
  });

  it("28. a study whose name is not the bill says so", () => {
    const html = renderStrip(
      describeComposerStudyScope({
        billedTestName: null,
        mergedDescription: "MRI BRAIN + CX SCR",
        worklistStudyDescription: "MRI BRAIN + CX SCR",
        status: "STUDY_RECEIVED",
      }),
    );
    expect(html).toContain("Booked (not billed)");
    expect(html).not.toContain(">Booked<");
  });

  it("29. the identity row the strip was built for still renders, unchanged", () => {
    const html = renderStrip(
      describeComposerStudyScope({
        billedTestName: "MRI Brain",
        worklistStudyDescription: "MRI Brain",
        status: "STUDY_RECEIVED",
      }),
    );
    expect(html).toContain('data-testid="composer-identity-strip"');
    expect(html).toContain("SYNTHETIC PATIENT ALPHA");
    expect(html).toContain("UHID UH-9");
    expect(html).toContain("ACC ACC-9");
    expect(html).toContain("42Y / F");
  });

  it("30. nothing is rendered behind a value the view model did not produce", () => {
    // The empty study — a deep-linked row with nothing resolved yet — must still
    // say both lines (as dashes/unknowns) rather than collapse into the old
    // one-string strip.
    const html = renderStrip(describeComposerStudyScope({}));
    expect(countOf(html, 'data-testid="composer-scope-booked"')).toBe(1);
    expect(countOf(html, 'data-testid="composer-scope-acquisition"')).toBe(1);
    expect(html).toContain("no examination name");
  });
});
