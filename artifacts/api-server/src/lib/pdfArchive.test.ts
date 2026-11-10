/**
 * E-12 — the PDF/A archival door: unit + source-contract tests.
 *
 * Pure behaviour pinned here: the Ghostscript invocation (PDF/A-2b, streaming
 * stdin→stdout, abort-on-noncompliant) and the probe's cache discipline.
 * The wiring between route and converter — 501 when the NAS has no gs, 502
 * when conversion fails, and bytes-before-bookkeeping ordering — is pinned
 * against the route source, the same way keyImageWindowLevel pins its chain.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ghostscriptBin, pdfArchiveArgs, resetGhostscriptProbeForTests } from "./pdfArchive";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_FILE = join(HERE, "..", "routes", "patient-reports.ts");
const read = (p: string) => readFileSync(p, "utf8");

describe("pdfArchive — the Ghostscript invocation", () => {
  it("targets PDF/A-2b, not the transparency-dropping PDF/A-1", () => {
    expect(pdfArchiveArgs()).toContain("-dPDFA=2");
  });

  it("aborts on non-compliant content instead of emitting fake PDF/A", () => {
    // A legal-retention copy must be honestly compliant or not exist.
    expect(pdfArchiveArgs()).toContain("-dPDFACompatibilityPolicy=1");
  });

  it("embeds fonts and uses device-independent colour", () => {
    const args = pdfArchiveArgs();
    expect(args).toContain("-dEmbedAllFonts=true");
    expect(args).toContain("-sColorConversionStrategy=UseDeviceIndependentColor");
  });

  it("streams — PDF in on stdin, PDF/A out on stdout, no temp files", () => {
    const args = pdfArchiveArgs();
    expect(args).toContain("-sOutputFile=-");
    expect(args[args.length - 1]).toBe("-");
    expect(args).toContain("-dBATCH");
    expect(args).toContain("-dNOPAUSE");
  });
});

describe("pdfArchive — the availability probe", () => {
  it("resolves (never rejects) whether or not gs exists, and caches per process", async () => {
    resetGhostscriptProbeForTests();
    const first = await ghostscriptBin();
    // Whatever this machine has, the answer is a string or null — never a throw.
    expect(first === null || typeof first === "string").toBe(true);
    // The cached probe is the same promise — no second fork.
    const second = await ghostscriptBin();
    expect(second).toBe(first);
  });
});

describe("E-12 — the /pdf door's archival variant (source contract)", () => {
  const route = read(ROUTE_FILE);

  it("reads the archive flag from the query", () => {
    expect(route).toContain('const archive = req.query.archive === "1"');
  });

  it("refuses with 501 and a clear message when Ghostscript is absent", () => {
    const gsIdx = route.indexOf("const gs = await ghostscriptBin();");
    expect(gsIdx).toBeGreaterThan(-1);
    const refuseIdx = route.indexOf("PDF/A conversion needs Ghostscript", gsIdx);
    expect(refuseIdx).toBeGreaterThan(gsIdx);
    expect(route).toContain("res.status(501)");
  });

  it("reports conversion failure as 502, serving nothing", () => {
    expect(route).toContain("res.status(502)");
    expect(route).toContain("PDF/A conversion failed:");
  });

  it("bookkeeping still runs only after bytes exist (D4)", () => {
    const convertIdx = route.indexOf("const converted = await convertPdfToPdfA(gs, pdfBuffer);");
    const shareIdx = route.indexOf("await db.insert(reportSharesTable)", convertIdx);
    expect(shareIdx).toBeGreaterThan(convertIdx);
  });

  it("serves the converted bytes and names the archival copy distinctly", () => {
    expect(route).toContain("servedBytes = converted.bytes;");
    expect(route).toContain('-pdfa.pdf');
    expect(route).toContain("res.send(servedBytes);");
  });
});
