/**
 * D-06 / D-22 — an unauthorized export must look unauthorized, and print must
 * reflect what is persisted, not what only the editor remembers.
 *
 * D-06: the PDF generator has carried a print-settings watermark for years and
 * nothing ever set it for the radiology export, so an unsigned draft exported
 * through Download PDF was pixel-identical to a signed report. The draft-aware
 * helper sets the DRAFT watermark for any document with no authorization on
 * record (a draft, an unsigned row, an unknown state — omitted counts
 * unauthorized), and leaves a signed report untouched.
 *
 * The helper is deliberately watermark-ONLY. Who may sign the document — the
 * signer's identity and what an unsigned export prints in the signature
 * block's place — is the signer-authority system (merged #1085's
 * signatures-from-records, open #1088's signer-of-record). Nothing here touches
 * `settings.signature`, which is what keeps the two systems composable.
 *
 * D-22: handlePrintLikeFinal used to open the print window on a server preview
 * of the SAVED draft while merging the editor's unsaved text over it, so the
 * printed page could exist nowhere but the popup. Print now saves first when
 * the study is dirty and writable, and a failed save aborts the print.
 *
 * The generator is genuinely executed below with an instrumented jsPDF document
 * (the journeys' own harness); the hook wiring is pinned from source in this
 * repo's documented no-DOM-harness idiom.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PRINT_SETTINGS,
  generateReportPDF,
  loadPrintSettings,
  type PrintSettings,
} from "./reportPdfGenerator";
import { draftAwarePrintSettings, DRAFT_WATERMARK_TEXT } from "./draftAwarePrintSettings";
import { createInstrumentedPdf } from "./testSupport/instrumentedPdf";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const EXPORT_SHARE = "hooks/radiology-workspace/useWorkspaceExportShare.ts";
const PDF_EXPORT = "lib/radiologyReportPdfExport.ts";
const CLINICAL_UI = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";

function render(
  settings: PrintSettings,
  findings: string,
): { drawn: string[]; pages: number } {
  const inst = createInstrumentedPdf({ unit: "mm", format: "a4", orientation: "portrait" });
  generateReportPDF(
    {
      patientName: "WATERMARK PATIENT",
      age: "40 Y",
      sex: "M",
      uhid: "WM-1",
      accessionNumber: "WM-1001",
      studyDate: "20261020",
      referringDoctor: "Dr Referrer",
      reportTitle: "MRI LUMBOSACRAL SPINE",
      findings,
      impression: "Normal MRI of the lumbosacral spine.",
      recommendation: "Clinical correlation.",
    },
    settings,
    { name: "TEST DIAGNOSTICS", address: "TEST ADDRESS", phone: "TEST PHONE", email: "t@e.com" },
    { save: false, doc: inst.doc },
  );
  return { drawn: inst.drawnTexts.map((t) => t.text.trim()), pages: inst.doc.getNumberOfPages() };
}

const LONG_FINDINGS = Array.from({ length: 30 }, (_, i) =>
  `L${i + 1}-L${i + 2}: Intervertebral disc signal is preserved. No significant disc bulge or protrusion is seen. Neural foramina are patent bilaterally. No exiting or traversing nerve root compression is seen.`,
).join("\n");

describe("draftAwarePrintSettings — the pure rule, executed", () => {
  it("an unsigned draft exports watermarked: omitted authorization counts unsigned", () => {
    const s = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, {});
    expect(s.watermark).toBe(DRAFT_WATERMARK_TEXT);
  });

  it("a report with no authorization on record (unsigned row) exports watermarked", () => {
    const s = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, { unsigned: true });
    expect(s.watermark).toBe(DRAFT_WATERMARK_TEXT);
  });

  it("a signed report exports exactly as configured — no watermark appears", () => {
    const s = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, { unsigned: false });
    expect(s.watermark).toBe(DEFAULT_PRINT_SETTINGS.watermark);
  });

  it("the clinic's own configured watermark outranks the draft default", () => {
    const own: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, watermark: "COPY" };
    expect(draftAwarePrintSettings(own, { unsigned: true }).watermark).toBe("COPY");
  });

  it("does not touch the signature block — signer authority belongs to #1085/#1088", () => {
    const s = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, { unsigned: true });
    expect(s.signature).toEqual(DEFAULT_PRINT_SETTINGS.signature);
  });
});

describe("D-06 — the watermark is genuinely drawn by the real generator", () => {
  it("an unsigned draft PDF carries the DRAFT watermark on every page", () => {
    const settings = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, { unsigned: true });
    const { drawn, pages } = render(settings, LONG_FINDINGS);
    expect(pages).toBeGreaterThan(1);
    expect(drawn.filter((t) => t === DRAFT_WATERMARK_TEXT).length).toBe(pages);
  });

  it("a signed report PDF carries no DRAFT watermark", () => {
    const settings = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, { unsigned: false });
    const { drawn } = render(settings, LONG_FINDINGS);
    expect(drawn).not.toContain(DRAFT_WATERMARK_TEXT);
  });

  it("the clinical content is still complete under the watermark — nothing is replaced", () => {
    const settings = draftAwarePrintSettings(DEFAULT_PRINT_SETTINGS, { unsigned: true });
    const { drawn } = render(settings, "There is mild canal stenosis of the lumbar spine.");
    // jsPDF lays a long findings line out word by word, so the page is
    // re-assembled with spaces rather than newlines.
    const page = drawn.join(" ").replace(/\s+/g, " ");
    expect(page).toContain("mild canal stenosis");
    expect(page).toContain("MRI LUMBOSACRAL SPINE");
    expect(page).toContain("Normal MRI of the lumbosacral spine.");
  });
});

describe("D-06 wiring — the export path reads the report row's own signing state", () => {
  it("exportRadiologyReportToPdf applies draft-aware settings to the loaded print settings", () => {
    const src = read(PDF_EXPORT);
    const apply = src.indexOf("draftAwarePrintSettings(loadPrintSettings(), { unsigned: input.unsignedDraft })");
    expect(apply).toBeGreaterThan(-1);
  });

  it("handleExportPdf passes the row's unsignedDraft state, not a render-time capture", () => {
    const src = read(EXPORT_SHARE);
    const refDecl = src.indexOf("const unsignedDraftRef = useRef(true);");
    const memoWrite = src.indexOf('unsignedDraftRef.current = signedReport.state !== "signed";');
    const passDown = src.indexOf("unsignedDraft: unsignedDraftRef.current,");
    // The ref is declared once, read by the export callback at click time, and
    // written by the signedReport memo on every render — the runtime order the
    // linkedReportIdRef pattern already uses (source order puts the export
    // callback above the memo; only the ref connects them).
    expect(refDecl).toBeGreaterThan(-1);
    expect(memoWrite).toBeGreaterThan(refDecl);
    expect(passDown).toBeGreaterThan(refDecl);
    expect(src).toContain('signedReport.state !== "signed"');
    // The fail-safe default is unauthorized: until the row says signed, DRAFT.
    expect(src).toContain("useRef(true)");
  });
});

describe("D-22 — print reflects the persisted version", () => {
  const src = read(EXPORT_SHARE);

  it("a dirty, writable study is saved before the print window opens", () => {
    const save = src.indexOf("const saved = await saveDraft({ silent: true });");
    const open = src.indexOf('window.open("", "_blank")');
    expect(save).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(save);
  });

  it("a failed save aborts the print with an honest message", () => {
    const abort = src.indexOf("if (saved == null)");
    const notice = src.indexOf("Save before print");
    const open = src.indexOf('window.open("", "_blank")');
    expect(abort).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(abort);
    expect(open).toBeGreaterThan(notice);
  });

  it("the save-first condition is exactly dirty-and-writable, evaluated", () => {
    // The condition lifted from the source, evaluated over its truth table:
    // a signed study must print without a doomed save, and a clean study
    // without a redundant one.
    const m = src.match(/if \((dirty && !contentLocked)\) \{/);
    expect(m, "the save-first guard must read exactly dirty && !contentLocked").not.toBeNull();
    const evaluate = new Function("dirty", "contentLocked", `return ${m![1]};`);
    expect(evaluate(true, false)).toBe(true);   // dirty draft: save first
    expect(evaluate(true, true)).toBe(false);   // signed study: print, no doomed save
    expect(evaluate(false, false)).toBe(false);  // clean study: no redundant save
    expect(evaluate(false, true)).toBe(false);
  });

  it("the clinical UI passes the editor's dirty flag and the content lock through", () => {
    const ui = read(CLINICAL_UI);
    expect(ui).toContain("dirty: isDirty,");
    expect(ui).toContain("contentLocked: signedContentLocked,");
  });
});
