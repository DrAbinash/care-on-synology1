/**
 * The exam identity the auto-opened normal report is chosen from.
 *
 * The billing row and the DICOM header do not always say the same thing. A study
 * booked as "MR BRAIN" but billed "MRI Brain with contrast" carries no contrast
 * marker in the DICOM description at all, so a resolver that reads only the
 * description picks the PLAIN technique — and the technique line of a signed
 * report would then claim sequences that were never run. Quick Normal has always
 * folded the billed name in; the auto-open bootstrap did not, which meant the
 * report you got by opening the study could differ from the report you got by
 * clicking the button for the same study.
 *
 * The React effect itself is not reachable without a browser here, so the shared
 * helper is tested for behaviour and the two call sites are pinned by source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_REPORT_FORMATS } from "./report-formats-library";
import { buildReportingStudyContext } from "@/lib/reportingStudyContext";
import {
  billedNameFromWorklistRow,
  billedStudyContextForNormal,
  resolveNormalBootstrapFormat,
} from "./normalBootstrap";

const FORMATS = DEFAULT_REPORT_FORMATS;

function dicomCtx(studyDescription: string) {
  return buildReportingStudyContext({
    modality: "MR",
    studyDescription,
    regions: ["Brain"],
    source: "auto",
    protocolName: null,
  });
}

function appliedFormatName(ctx: Parameters<typeof resolveNormalBootstrapFormat>[0]["ctx"]): string | null {
  const decision = resolveNormalBootstrapFormat({ ctx, formats: FORMATS });
  return decision?.status === "apply" ? decision.format.name : `(${decision?.status})`;
}

describe("billedNameFromWorklistRow", () => {
  it("prefers the billed test name over the order description", () => {
    expect(billedNameFromWorklistRow({
      testName: "MRI Brain with contrast",
      billedTestName: "MRI BRAIN",
      studyDescription: "MR BRAIN",
    })).toBe("MRI Brain with contrast");
  });

  it("falls back through billedTestName to studyDescription", () => {
    expect(billedNameFromWorklistRow({ billedTestName: "MRI BRAIN", studyDescription: "MR BRAIN" }))
      .toBe("MRI BRAIN");
    expect(billedNameFromWorklistRow({ studyDescription: "MR BRAIN" })).toBe("MR BRAIN");
  });

  it("is null for a row that has not arrived yet", () => {
    expect(billedNameFromWorklistRow(null)).toBeNull();
    expect(billedNameFromWorklistRow(undefined)).toBeNull();
    expect(billedNameFromWorklistRow({})).toBeNull();
  });

  it("falls through to the by-id detail row when the queue row is absent (deep link)", () => {
    // The reading-queue filter can hide the open study's row; the by-id detail
    // read always carries it. Without this fallback a deep-linked study lost
    // its billed identity and could auto-open the wrong normal report.
    expect(billedNameFromWorklistRow(null, { testName: "MRI Brain with contrast" }))
      .toBe("MRI Brain with contrast");
    expect(billedNameFromWorklistRow(null, { billedTestName: "MRI BRAIN" }))
      .toBe("MRI BRAIN");
    expect(billedNameFromWorklistRow(null, { studyDescription: "MR BRAIN" }))
      .toBe("MR BRAIN");
    expect(billedNameFromWorklistRow(null, null)).toBeNull();
  });

  it("the queue row wins over the detail row — they describe the same study", () => {
    expect(billedNameFromWorklistRow(
      { testName: "MRI Brain with contrast", studyDescription: "MR BRAIN" },
      { testName: "MRI BRAIN PLAIN", studyDescription: "MR BRAIN" },
    )).toBe("MRI Brain with contrast");
  });

  it("the detail row fills the field the queue row lacks", () => {
    expect(billedNameFromWorklistRow(
      { studyDescription: "MR BRAIN" },
      { testName: "MRI BRAIN", studyDescription: "MR BRAIN" },
    )).toBe("MRI BRAIN");
  });
});

describe("the billed exam name decides which normal auto-opens", () => {
  it("DICOM says plain, billing says contrast → the contrast normal, not the plain one", () => {
    const row = { testName: "MRI Brain with contrast" };
    const raw = dicomCtx("MR BRAIN");
    // The defect, stated as a fact about the output rather than about the code:
    // without the billed name the resolver commits to the wrong technique.
    expect(appliedFormatName(raw)).toBe("MRI Brain — Standard Normal");
    expect(appliedFormatName(billedStudyContextForNormal(raw, billedNameFromWorklistRow(row))))
      .toBe("MRI Brain — Normal (Contrast)");
  });

  it("a contrast exam with no contrast normal in the library opens nothing, rather than a plain report", () => {
    const plainOnly = FORMATS.filter((f) => !/contrast/i.test(f.name));
    const ctx = billedStudyContextForNormal(
      dicomCtx("MR BRAIN"),
      billedNameFromWorklistRow({ testName: "MRI Brain with contrast" }),
    );
    expect(resolveNormalBootstrapFormat({ ctx, formats: plainOnly })?.status).toBe("no-match");
  });

  it("an empty billed name leaves the DICOM decision untouched", () => {
    const raw = dicomCtx("MRI BRAIN EPILEPSY PROTOCOL");
    expect(appliedFormatName(billedStudyContextForNormal(raw, billedNameFromWorklistRow({}))))
      .toBe("MRI Brain — Epilepsy Protocol (Normal)");
  });

  it("folding is idempotent — a description that already names the exam is not doubled", () => {
    // The workspace can hand the same string in as both the DICOM description and
    // the billed name. Folding it twice must not produce "X. X", which would still
    // resolve but would corrupt any report built from the description.
    const row = { testName: "MRI Brain with contrast" };
    const once = billedStudyContextForNormal(
      dicomCtx("MRI Brain with contrast"),
      billedNameFromWorklistRow(row),
    );
    expect(once.studyDescription).toBe("MRI Brain with contrast");
    const twice = billedStudyContextForNormal(once, billedNameFromWorklistRow(row));
    expect(twice.studyDescription).toBe("MRI Brain with contrast");
    expect(appliedFormatName(twice)).toBe("MRI Brain — Normal (Contrast)");
  });
});

describe("both routes read the billed name", () => {
  const hook = readFileSync(
    resolve(__dirname, "../../hooks/radiology-workspace/useWorkspaceClinicalUi.tsx"),
    "utf8",
  );
  const canvas = readFileSync(
    resolve(__dirname, "../../components/radiology/workspace/ReportCanvas.tsx"),
    "utf8",
  );

  it("the auto-open bootstrap folds it before resolving — with the detail row in tow", () => {
    expect(hook).toMatch(/billedStudyContextForNormal\(\s*studySetup\.studyContext,\s*billedNameFromWorklistRow\(workflow\.currentRow, worklistDetailQ\.data\),?\s*\)/);
  });

  it("Quick Normal reads the very same helper, not a second copy of the lookup", () => {
    expect(canvas).toContain("billedNameFromWorklistRow(workflow.currentRow, worklistDetailQ.data)");
    expect(canvas).toContain("billedStudyContextForNormal(studySetup.studyContext, billed)");
    // A re-forked inline chain is how the two paths drifted apart in the first place.
    expect(canvas).not.toMatch(/currentRow\?\.testName\s*\|\|\s*workflow\.currentRow\?\.billedTestName\s*\|\|\s*workflow\.currentRow\?\.studyDescription/);
  });
});
