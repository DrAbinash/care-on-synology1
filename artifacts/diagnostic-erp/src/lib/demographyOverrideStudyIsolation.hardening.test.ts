import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildDemographyHeaderHtml,
  buildLetterpadDemographyHtml,
  mergeReportDemography,
  type ReportDemography,
} from "./reportDemography";

/**
 * P0 — a demographic correction typed for one patient must not appear in the next
 * patient's report.
 *
 * `demographyOverrides` is radiologist-local component state, not store state, so the
 * store-side `studyTransitionReset()` cannot reach it. The only place that can clear it
 * is the component-side reset that `useDraftPersistence` invokes on the ROUTE study id.
 *
 * The route-keyed reset matters more than the `openStudy()` click handler: a deep link
 * or a browser Back changes the study without ever calling `openStudy()`. That is the
 * same reason A-02 moved `activeStudyId` into the route-keyed transition.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");

// Blobs are LF, but this repo does not pin `*.ts` in .gitattributes, so a Windows
// checkout with core.autocrlf=true puts CRLF on disk. An unnormalised multi-line match
// would then read green on CI and red here (or the reverse) for a reason that has
// nothing to do with the clinical defect.
const readSource = (absPath: string) => readFileSync(absPath, "utf8").replace(/\r\n/g, "\n");
const HOOK_SRC = readSource(SRC);

/**
 * Extract one `useCallback` body by brace counting.
 *
 * Scoping is the whole point of this file's assertions: `setDemographyOverrides`
 * already occurs elsewhere in the hook (it is returned to consumers), so a whole-file
 * `toContain` passes on the defective code and proves nothing.
 */
function useCallbackBody(src: string, name: string): string {
  const decl = src.indexOf(`const ${name} = useCallback(`);
  if (decl === -1) throw new Error(`could not find useCallback for "${name}"`);
  const firstBrace = src.indexOf("{", src.indexOf("=>", decl));
  if (firstBrace === -1) throw new Error(`could not find body of useCallback "${name}"`);
  let depth = 0;
  for (let i = firstBrace; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(firstBrace + 1, i);
    }
  }
  throw new Error(`unbalanced braces in useCallback "${name}"`);
}

/**
 * Strip comments before matching.
 *
 * Without this, a commented-out `// setDemographyOverrides({});` satisfies the guard
 * while executing nothing. This repo has already been bitten by contract tests that
 * slice raw source before stripping comments (see .gitattributes), so the strip is
 * pinned by its own test below rather than assumed.
 */
function stripComments(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .map((line) => line.replace(/\/\/[^\n]*$/g, ""))
    .join("\n");
}

const pageResetRaw = useCallbackBody(HOOK_SRC, "onStudySwitchPageReset");
const pageReset = stripComments(pageResetRaw);

describe("demography override isolation — extractor sanity", () => {
  // A source-assertion test is only as good as its extractor. If the slice came back
  // empty or oversized, every assertion below would be vacuous. These pins fail loudly
  // if the callback is ever restructured, instead of silently going green.
  it("extracted the real reset body, not an empty or whole-file slice", () => {
    expect(pageReset.length).toBeGreaterThan(100);
    expect(pageReset).toContain("setSelectedQuickIds(new Set())");
    expect(pageReset).toContain("setChecklistComm");
    expect(pageReset).toContain("setStagedAiProposals([])");
    // The reset body must NOT run on into the hook's return object, where
    // setDemographyOverrides legitimately appears as an exported setter.
    expect(pageReset).not.toContain("demographyOverrides,");
    expect(pageReset).not.toContain("return {");
  });

  it("a commented-out call does NOT satisfy the guard", () => {
    // Pins the reason stripComments exists: source-text guards must check the fact,
    // not the line. Commented out is not cleared.
    const commented = "    setChecklistComm({});\n    // setDemographyOverrides({});\n";
    expect(commented).toMatch(/setDemographyOverrides\(\s*\{\s*\}\s*\)/); // raw text lies
    expect(stripComments(commented)).not.toMatch(/setDemographyOverrides\(\s*\{\s*\}\s*\)/);
    expect(stripComments(commented)).not.toContain("setDemographyOverrides");
  });
});

describe("demography override isolation — P0 study transition", () => {
  it("RED-UNTIL-FIXED: the route-keyed reset clears the demographic overrides", () => {
    // This is the defect. Every other study-scoped patient state is reset here;
    // demographyOverrides is the one that is absent, so it survives A -> B.
    expect(pageReset).toMatch(/setDemographyOverrides\(\s*\{\s*\}\s*\)/);
  });

  it("clears the WHOLE override object, not a per-field subset", () => {
    // 8 fields are editable (ReportDemographyCard.FIELDS) and they are a mix of
    // patient-scoped (name/age/sex/DOB/UHID) and study-scoped (studyDate/
    // studyDescription/referringDoctor). Clearing only the patient-scoped ones would
    // still leak a study date and a referrer between two studies of the SAME patient,
    // which this brief explicitly asks about.
    const resetsEverything = /setDemographyOverrides\(\s*\{\s*\}\s*\)/.test(pageReset);
    const picksFieldsOnly = /setDemographyOverrides\(\s*\(\s*\{[^}]*\}\s*\)/.test(pageReset)
      && !resetsEverything;
    expect(picksFieldsOnly).toBe(false);
    expect(resetsEverything).toBe(true);
  });

  it("still resets unconditionally — no guard that can skip the clear", () => {
    // A conditional reset ("only if the patient changed") reintroduces the leak for the
    // same-patient/different-study case.
    const clearIndex = pageReset.search(/setDemographyOverrides\(\s*\{\s*\}\s*\)/);
    expect(clearIndex).toBeGreaterThan(-1);
    const before = pageReset.slice(0, clearIndex);
    expect(before).not.toMatch(/^\s*if\s*\(/m);
    expect(pageReset.slice(clearIndex).split("\n")[0]).not.toMatch(/\?\?|&&|\?\s/);
  });
});

describe("demography override isolation — mechanism", () => {
  const studyA = {
    patientName: "SYNTHETIC PATIENT ALPHA",
    age: "34Y",
    sex: "F",
    uhid: "UH-1001",
    accessionNumber: "ACC-1001",
    studyDescription: "MRI BRAIN",
    studyDate: "01/01/2026",
    referringDoctor: "Dr. Alpha Referrer",
  };
  const studyB = {
    patientName: "SYNTHETIC PATIENT BETA",
    age: "61Y",
    sex: "M",
    uhid: "UH-2002",
    accessionNumber: "ACC-2002",
    studyDescription: "CT HEAD",
    studyDate: "02/02/2026",
    referringDoctor: "Dr. Beta Referrer",
  };

  const canonical = (row: typeof studyA): ReportDemography =>
    mergeReportDemography({
      erp: {
        patientName: row.patientName,
        age: row.age,
        sex: row.sex,
        uhid: row.uhid,
        accessionNumber: row.accessionNumber,
        studyDescription: row.studyDescription,
        studyDate: row.studyDate,
        referringDoctor: row.referringDoctor,
      },
      dicom: {},
    });

  it("the corrected block is invisible, not obviously wrong — that is why it ships", () => {
    // Applying study A's stale overrides to study B produces a header that still
    // resolves most of its own fields: only name and age are wrong. The mixed block is
    // what makes this defect survive review.
    const aCorrection = { patientName: "CORRECTED ALPHA NAME", age: "35Y" };
    const leaked = mergeReportDemography({
      erp: {
        patientName: studyB.patientName,
        age: studyB.age,
        sex: studyB.sex,
        uhid: studyB.uhid,
        accessionNumber: studyB.accessionNumber,
        studyDescription: studyB.studyDescription,
      },
      dicom: {},
      overrides: aCorrection,
    });

    expect(leaked.patientName).toBe("CORRECTED ALPHA NAME"); // wrong patient
    expect(leaked.age).toBe("35Y"); // wrong age
    expect(leaked.sex).toBe("M"); // still B — looks plausible next to a wrong name
    expect(leaked.uhid).toBe("UH-2002"); // still B
    expect(leaked.accessionNumber).toBe("ACC-2002"); // still B
  });

  it("with the overrides cleared, study B shows B's canonical demographics", () => {
    // Asserted as a property against B's own canonical merge, not against literal
    // strings: mergeReportDemography normalises age ("61Y" -> "61 Yrs") and sex, and
    // pinning that formatting here would test the formatter rather than the isolation.
    const bErp = {
      patientName: studyB.patientName,
      age: studyB.age,
      sex: studyB.sex,
      uhid: studyB.uhid,
      accessionNumber: studyB.accessionNumber,
      studyDescription: studyB.studyDescription,
    };
    const bCanonical = mergeReportDemography({ erp: bErp, dicom: {} });
    const bAfterReset = mergeReportDemography({ erp: bErp, dicom: {}, overrides: {} });

    expect(bAfterReset).toEqual(bCanonical);
    expect(bAfterReset.patientName).toBe("SYNTHETIC PATIENT BETA");
    expect(bAfterReset.patientName).not.toBe(studyA.patientName);
    expect(bAfterReset.uhid).toBe("UH-2002");
    expect(bAfterReset.accessionNumber).toBe("ACC-2002");

    // Same B row, A's stale overrides still applied — the state the defect leaves.
    const bLeaked = mergeReportDemography({
      erp: bErp,
      dicom: {},
      overrides: { patientName: studyA.patientName, age: studyA.age },
    });
    expect(bLeaked).not.toEqual(bCanonical);
  });

  it("same patient, different study — study-scoped fields must not carry over", () => {
    // One patient, two studies. A correction to the first study's date / examination /
    // referrer is not that patient's truth for the second study.
    const firstStudyCorrection = {
      studyDate: "01/01/2026",
      studyDescription: "MRI BRAIN",
      referringDoctor: "Dr. Alpha Referrer",
    };

    const carriedOver = mergeReportDemography({ erp: {
      patientName: studyB.patientName, sex: studyB.sex, studyDate: "02/02/2026",
      studyDescription: "CT HEAD", referringDoctor: "Dr. Beta Referrer",
    }, dicom: {}, overrides: firstStudyCorrection });
    expect(carriedOver.studyDate).toBe("01/01/2026"); // wrong study
    expect(carriedOver.studyDescription).toBe("MRI BRAIN"); // wrong study
    expect(carriedOver.referringDoctor).toBe("Dr. Alpha Referrer"); // wrong referrer

    const cleared = mergeReportDemography({ erp: {
      patientName: studyB.patientName, sex: studyB.sex, studyDate: "02/02/2026",
      studyDescription: "CT HEAD", referringDoctor: "Dr. Beta Referrer",
    }, dicom: {}, overrides: {} });
    expect(cleared.studyDate).toBe("02/02/2026");
    expect(cleared.studyDescription).toBe("CT HEAD");
    expect(cleared.referringDoctor).toBe("Dr. Beta Referrer");
  });

  it("a correction on the CURRENT study still wins — the fix must not erase it", () => {
    // Requirement: normal editing on one study keeps working. Overrides beat the ERP
    // row for the study they belong to; only the transition discards them.
    const corrected = canonical(studyA);
    const withCorrection = mergeReportDemography({
      erp: { patientName: studyA.patientName, age: studyA.age, sex: studyA.sex },
      dicom: {},
      overrides: { patientName: "CORRECTED ALPHA NAME", age: "35Y" },
    });
    expect(withCorrection.patientName).toBe("CORRECTED ALPHA NAME");
    expect(withCorrection.age).toBe("35Y");
    expect(withCorrection.sex).toBe(corrected.sex);
  });

  it("an empty-string override does not blank a real canonical value", () => {
    // The merge skips blank overrides, so a partially-cleared override object cannot
    // erase a patient's real name. This is why clearing to {} is safe.
    const erp = { patientName: "SYNTHETIC PATIENT BETA", age: "61Y", sex: "M" };
    const d = mergeReportDemography({ erp, dicom: {}, overrides: { patientName: "", age: "   " } });
    expect(d).toEqual(mergeReportDemography({ erp, dicom: {} }));
    expect(d.patientName).toBe("SYNTHETIC PATIENT BETA");
    expect(d.age).not.toBe("");
  });
});

describe("demography override isolation — rendered output", () => {
  // The reset happens on one piece of state, and every output surface is downstream of
  // it: canonicalDemography feeds the demographic card, the Preview pane, the print
  // panel, the Word export and the downloaded PDF (useWorkspaceExportShare.ts,
  // ReportCanvas.tsx). These render the REAL header builders so the blast radius is
  // demonstrated on produced markup rather than argued from a call graph.
  const rowB = {
    patientName: "SYNTHETIC PATIENT BETA",
    age: "61Y",
    sex: "M",
    uhid: "UH-2002",
    accessionNumber: "ACC-2002",
    studyDescription: "CT HEAD",
    studyDate: "02/02/2026",
    referringDoctor: "Dr. Beta Referrer",
  };
  const staleOverrideFromA = { patientName: "CORRECTED ALPHA NAME", age: "35Y" };

  const erpB = {
    patientName: rowB.patientName,
    age: rowB.age,
    sex: rowB.sex,
    uhid: rowB.uhid,
    accessionNumber: rowB.accessionNumber,
    studyDescription: rowB.studyDescription,
    studyDate: rowB.studyDate,
    referringDoctor: rowB.referringDoctor,
  };

  it("a stale override puts patient A's name into B's printed header", () => {
    const leaked = mergeReportDemography({ erp: erpB, dicom: {}, overrides: staleOverrideFromA });
    const html = buildDemographyHeaderHtml(leaked);

    expect(html).toContain("CORRECTED ALPHA NAME"); // wrong patient, real markup
    expect(html).toContain("35Y"); // wrong age
    expect(html).not.toContain("SYNTHETIC PATIENT BETA");
    // The rest of the block is genuinely B's — referrer, sex, date and accession all
    // resolve correctly. That mixed block is why the header still looks trustworthy to
    // the radiologist, and is the reason this defect ships instead of being noticed.
    expect(html).toContain("DR. BETA REFERRER");
    expect(html).toContain("ACC-2002");
    expect(html).toContain("02/02/2026");
  });

  it("with overrides cleared, the same header renders B and never mentions A", () => {
    const cleared = mergeReportDemography({ erp: erpB, dicom: {}, overrides: {} });
    const html = buildDemographyHeaderHtml(cleared);

    expect(html).toContain("SYNTHETIC PATIENT BETA");
    expect(html).not.toContain("CORRECTED ALPHA NAME");
    expect(html).not.toContain("35Y");
  });

  it("the letterpad (PDF) demography block behaves the same way", () => {
    const leaked = buildLetterpadDemographyHtml(
      mergeReportDemography({ erp: erpB, dicom: {}, overrides: staleOverrideFromA }),
    );
    const cleared = buildLetterpadDemographyHtml(
      mergeReportDemography({ erp: erpB, dicom: {}, overrides: {} }),
    );

    expect(leaked).toContain("CORRECTED ALPHA NAME");
    expect(cleared).toContain("SYNTHETIC PATIENT BETA");
    expect(cleared).not.toContain("CORRECTED ALPHA NAME");
  });
});
