/**
 * PRIORITY 1 wiring — the workspace's "Download PDF" must carry the same
 * documented-region sentence as the printed page, and neither surface may
 * invent its own version of it.
 *
 * The renderers themselves are proven in `reportPdfGenerator.reportingScope.test.ts`.
 * What is proven here is the connection: the export entry point asks the shared
 * rule using the very string it prints as the title, the workspace hands it the
 * open study's transition records, and the sentence exists in exactly one file
 * in the repository.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** EOL-normalised source, so a marker cannot land inside a CRLF-drawn line. */
function source(relativeFromThisFile: string): string {
  return readFileSync(new URL(relativeFromThisFile, import.meta.url), "utf8").replace(/\r\n/g, "\n");
}

function window(text: string, startMarker: string, endMarker: string, label: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `${label}: start marker missing`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(end, `${label}: end marker missing after the start`).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("the workspace PDF export asks the shared rule", () => {
  const exporter = source("../lib/radiologyReportPdfExport.ts");

  it("W1 the note is built from the same booked title the PDF draws", () => {
    // The call itself, not the doc comment that names the function.
    const call = window(exporter, "generateReportPDF(\n    {", "\n  );", "generateReportPDF call");
    expect(call).toContain('reportTitle: input.studyName || "Radiology Report"');
    expect(call).toContain("reportingScopeNote: reportedScopeNote({");
    expect(call).toContain('bookedTitle: input.studyName || "Radiology Report"');
    expect(call).toContain("records: input.regionTransitions");
  });

  it("W2 the reporting workspace hands it the open study's transition history", () => {
    const hook = source("../hooks/radiology-workspace/useWorkspaceExportShare.ts");
    const call = window(hook, "await exportRadiologyReportToPdf({", "\n    });", "PDF export call");
    expect(call).toContain("regionTransitions: useWorkspace.getState().regionTransitions");
    expect(call).toContain("studyName: studyNameForExport");
  });
});

describe("one implementation of the region sentence and the region vocabulary", () => {
  const SENTENCE = "Documented reporting region";

  function sourcesUnder(dir: URL): Array<{ path: string; text: string }> {
    const out: Array<{ path: string; text: string }> = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
      if (entry.isDirectory()) { out.push(...sourcesUnder(child)); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      out.push({ path: child.pathname.replace(/\\/g, "/"), text: readFileSync(child, "utf8") });
    }
    return out;
  }

  const repoRoot = new URL("../../../../", import.meta.url);
  const scanned = [
    ...sourcesUnder(new URL("artifacts/diagnostic-erp/src/", repoRoot)),
    ...sourcesUnder(new URL("artifacts/api-server/src/", repoRoot)),
    ...sourcesUnder(new URL("lib/report-quality/src/", repoRoot)),
  ];

  // A scan that scanned nothing proves nothing.
  it("W0 the sweep covers the shipped source of both surfaces and the shared package", () => {
    expect(scanned.length).toBeGreaterThan(600);
    expect(scanned.some((f) => f.path.includes("reportPdfGenerator.ts"))).toBe(true);
    expect(scanned.some((f) => f.path.includes("reportPresentation.ts"))).toBe(true);
  });

  it("W3 the sentence exists in exactly one shipped file, and it is the shared rule", () => {
    const writers = scanned.filter((file) => file.text.includes(SENTENCE)).map((file) => file.path);
    expect(writers).toEqual([expect.stringContaining("report-quality/src/reportingScope.ts")]);
  });

  it("W4 the workspace re-exports the region vocabulary instead of keeping a second copy", () => {
    const context = source("../lib/reportingStudyContext.ts");
    expect(context).toContain('} from "@workspace/report-quality";');
    expect(context).not.toContain("export function canonicalContentRegion(");
    expect(context).not.toContain("export function spineSegmentFromRegion(");
    const transition = source("../lib/regionTransition.ts");
    expect(transition).not.toContain("export function coverageOfRegion(");
  });
});
