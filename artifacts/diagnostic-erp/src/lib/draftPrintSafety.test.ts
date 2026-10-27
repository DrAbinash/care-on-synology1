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
import { createInstrumentedPdf, getAllText } from "./testSupport/instrumentedPdf";

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

  it("a configured watermark composes with DRAFT on an unsigned export — never suppresses it (ruling on 3.4)", () => {
    const own: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, watermark: "COPY" };
    expect(draftAwarePrintSettings(own, { unsigned: true }).watermark).toBe("COPY · DRAFT");
    // A signed export still prints exactly what the clinic configured.
    expect(draftAwarePrintSettings(own, { unsigned: false }).watermark).toBe("COPY");
  });

  it("a configured watermark that already says DRAFT is not duplicated", () => {
    const own: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, watermark: "draft" };
    expect(draftAwarePrintSettings(own, { unsigned: true }).watermark).toBe("draft");
  });

  it("a whitespace-only configured watermark falls back to DRAFT", () => {
    const own: PrintSettings = { ...DEFAULT_PRINT_SETTINGS, watermark: "   " };
    expect(draftAwarePrintSettings(own, { unsigned: true }).watermark).toBe(DRAFT_WATERMARK_TEXT);
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

  it("the print window opens at the click, and is only WRITTEN after the save", () => {
    // Few-clicks pass: the popup order flipped deliberately. `window.open`
    // now runs BEFORE the awaits (popup blockers key off the click's transient
    // user activation, which the save round-trip can outlast — a blocked popup
    // after the save wasted the save and forced a re-click). The D-22 content
    // guarantee is unchanged and pinned here: the SAVED version is still what
    // gets rendered into the tab — the save precedes both the server fetch and
    // the write into the popup. Scoped to runPrintLikeFinal's own body: the
    // file has an earlier api.get(url) in the preview pane's fetch.
    const body = src.slice(
      src.indexOf("const runPrintLikeFinal = useCallback"),
      src.indexOf("const confirmedPrintLikeFinal"),
    );
    const open = body.indexOf('window.open("", "_blank")');
    const save = body.indexOf("saved = await saveDraft({ silent: true });");
    const fetch = body.indexOf("await api.get<string>(url)");
    const write = body.indexOf("w.document.write(html)");
    expect(save).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(-1);
    expect(fetch).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(open).toBeLessThan(save); // opened at the gesture, before any await
    expect(save).toBeLessThan(fetch); // persisted before the layout is drawn
    expect(fetch).toBeLessThan(write); // ...and written after both
  });

  it("a failed save aborts the print with an honest message", () => {
    const abort = src.indexOf("if (saved == null)");
    const notice = src.indexOf("Save before print");
    const write = src.indexOf("w.document.write(html)");
    expect(abort).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(abort);
    // The tab the click opened does not outlive the abort — the window exists
    // by then (opened at the gesture), so the abort must close it.
    expect(src).toMatch(/if \(saved == null\) \{[\s\S]{0,80}?w\.close\(\)/);
    // And nothing was written into it before the refusal.
    expect(write).toBeGreaterThan(abort);
    expect(write).toBeGreaterThan(notice);
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

/**
 * Finding A — the LAB page's export is precisely the case `reportPdfGenerator.ts`
 * names in its own comment ("a page with no report row behind it — the
 * non-radiology generators — keeps printing this browser's configured signer").
 * `pages/ReportGenerator.tsx` writes nothing to `patient_reports`, yet all three
 * of its exports spoke as though a report existed and somebody had authorized it:
 * the PDF printed the abnormal-parameter COUNT as its Impression and one
 * hardcoded recommendation on every document, the HTML preview declared itself
 * "valid without signature", and the .txt export printed "Authorized By:" over a
 * name typed into a free-text box.
 *
 * The page is NOT retired. It is routed, listed in the sidebar, linked from
 * Report Delivery and the command palette, used as a post-login landing, and it
 * is the only surface that renders `ReportTemplatesManager` while
 * `/api/report-templates` is gated on its permission string — retiring it would
 * take template administration down too. So the correction is that each output
 * states what the document is, reusing the two mechanisms already shipped for
 * that fact: `report.unsigned` and `draftAwarePrintSettings`.
 */
const REPORT_GENERATOR = "pages/ReportGenerator.tsx";

/** A signer that exists only in this file's print-settings stand-in. The real
 *  default is the clinic's own radiologist, so a LAB document printed through
 *  the pre-fix call carried a radiologist's name and degree as its author. */
const LAB_BROWSER_SIGNER = "Dr. Browser Station";

/** What `handlePrintPDF` builds from the entered parameters, flags included. */
const LAB_MEASUREMENTS = [
  { label: "CBC - Haemoglobin", value: "8.2 g/dL (LOW)" },
  { label: "CBC - WBC", value: "14900 /cumm (HIGH)" },
];

/**
 * Runs the real generator over `handlePrintPDF`'s arguments. Each flag selects
 * one half of the before/after pair, so the control is the SAME render path
 * with the pre-fix arguments rather than a second harness that could differ.
 */
function renderLabExport(opts: {
  /** The pre-fix call passed `printSettings` straight through. */
  draftAware: boolean;
  /** The pre-fix call passed no `unsigned` at all. */
  unsigned: boolean;
  /** The pre-fix call invented both conclusions. */
  fabricatedConclusions: boolean;
}): { drawn: string[]; text: string } {
  const settings: PrintSettings = {
    ...DEFAULT_PRINT_SETTINGS,
    signature: { ...DEFAULT_PRINT_SETTINGS.signature, name: LAB_BROWSER_SIGNER },
  };
  const inst = createInstrumentedPdf({ unit: "mm", format: "a4", orientation: "portrait" });
  generateReportPDF(
    {
      patientName: "SYNTHETIC LAB PATIENT",
      age: "41 Y",
      sex: "F",
      accessionNumber: "SYN-LAB-0001",
      studyDate: "20261027",
      referringDoctor: "Dr Referring",
      modality: "LAB",
      findings: "Haemoglobin 8.2 g/dL. WBC 14900 /cumm.",
      measurements: LAB_MEASUREMENTS,
      reportTitle: "Diagnostic Laboratory Report",
      ...(opts.fabricatedConclusions
        ? {
            impression: "2 abnormal findings",
            recommendation: "Please correlate with clinical findings.",
          }
        : {}),
      ...(opts.unsigned ? { unsigned: true } : {}),
    },
    opts.draftAware ? draftAwarePrintSettings(settings, { unsigned: true }) : settings,
    null,
    { save: false, doc: inst.doc },
  );
  return {
    drawn: inst.drawnTexts.map((t) => t.text.trim()),
    text: getAllText(inst),
  };
}

const FIXED = { draftAware: true, unsigned: true, fabricatedConclusions: false };
const PRE_FIX = { draftAware: false, unsigned: false, fabricatedConclusions: true };

describe("Finding A — the LAB export says what the document is", () => {
  it("prints NOT SIGNED where the browser's configured signer used to be", () => {
    const now = renderLabExport(FIXED);
    expect(now.drawn).toContain("NOT SIGNED");
    expect(now.text).not.toContain(LAB_BROWSER_SIGNER);
  });

  it("CONTROL: the pre-fix arguments printed this browser's signer and no NOT SIGNED", () => {
    const before = renderLabExport(PRE_FIX);
    expect(before.text).toContain(LAB_BROWSER_SIGNER);
    expect(before.drawn).not.toContain("NOT SIGNED");
  });

  it("carries the DRAFT watermark the pre-fix call never set", () => {
    expect(renderLabExport(FIXED).drawn).toContain(DRAFT_WATERMARK_TEXT);
    expect(renderLabExport(PRE_FIX).drawn).not.toContain(DRAFT_WATERMARK_TEXT);
  });

  it("prints no Impression or Recommendation — a count is not a conclusion", () => {
    const now = renderLabExport(FIXED);
    expect(now.text).not.toContain("IMPRESSION");
    expect(now.text).not.toContain("RECOMMENDATION");
    expect(now.text).not.toContain("abnormal findings");
    expect(now.text).not.toContain("Please correlate with clinical findings");
  });

  it("CONTROL: both fabricated sections did print before", () => {
    const before = renderLabExport(PRE_FIX);
    expect(before.text).toContain("IMPRESSION");
    expect(before.text).toContain("2 abnormal findings");
    expect(before.text).toContain("RECOMMENDATION");
    expect(before.text).toContain("Please correlate with clinical findings.");
  });

  it("still prints every result the operator entered — nothing went with the fabrication", () => {
    const now = renderLabExport(FIXED);
    expect(now.text).toContain("Haemoglobin");
    expect(now.text).toContain("8.2 g/dL (LOW)");
    expect(now.text).toContain("WBC");
    expect(now.text).toContain("14900 /cumm (HIGH)");
    // The generator uppercases the title it draws (reportPdfGenerator.ts).
    expect(now.text).toContain("DIAGNOSTIC LABORATORY REPORT");
  });
});

describe("Finding A wiring — all three exports carry one status", () => {
  const src = read(REPORT_GENERATOR);

  it("handlePrintPDF declares the document unsigned, and invents no conclusion", () => {
    const at = src.indexOf("const handlePrintPDF = () => {");
    const end = src.indexOf("const handleDownloadHTML = () => {");
    expect(at).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(at);
    const body = src.slice(at, end);
    expect(body).toContain("unsigned: true,");
    expect(body).toContain("draftAwarePrintSettings(printSettings, { unsigned: true })");
    // Neither key may come back in any form: not a count, not a constant.
    expect(body).not.toMatch(/^\s*impression:/m);
    expect(body).not.toMatch(/^\s*recommendation:/m);
    expect(body).not.toContain("Please correlate with clinical findings");
    expect(body).not.toContain("abnormal finding");
  });

  it("imports the helper its settings argument now goes through", () => {
    expect(src).toContain('import { draftAwarePrintSettings } from "@/lib/draftAwarePrintSettings";');
  });

  it("the preview the HTML export copies no longer claims the report is valid unsigned", () => {
    // A pattern, not the old sentence quoted back: pinning one spelling would let
    // "valid without a signature" through, and the fact being guarded is that no
    // output tells the reader an unsigned document counts as authorized.
    expect(src).not.toMatch(/valid without/i);
    // handleDownloadHTML copies #report-preview's innerHTML verbatim, so pin the
    // copy as well as the wording: a corrected footer that the export stopped
    // reading would leave the downloaded file saying nothing at all.
    expect(src).toContain('id="report-preview"');
    expect(src).toContain('document.getElementById("report-preview")?.innerHTML');
    const preview = src.slice(src.indexOf('id="report-preview"'));
    expect(preview).toContain("NOT SIGNED — working copy");
    expect(preview).toContain("Report Hub");
  });

  it("the .txt export names a contact, not an authorization", () => {
    expect(src).not.toContain("Authorized By:");
    const at = src.indexOf("const handleDownloadText = () => {");
    const end = src.indexOf("const handleExport = () => {");
    expect(at).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(at);
    const body = src.slice(at, end);
    expect(body).toContain("NOT SIGNED");
    expect(body).toContain("Report Hub");
  });

  it("the page still writes no report row — honesty, not a rebuild", () => {
    expect(src).not.toContain("patient-reports");
    const writes = [
      ...new Set(
        [...src.matchAll(/api\.(?:post|patch|put|delete)[\s\S]{0,40}?["`](\/api\/[^"'`]+)/g)].map((m) =>
          // One entry per endpoint, not per interpolated id.
          m[1].replace(/\$\{[^}]*\}/g, ":id"),
        ),
      ),
    ].sort();
    // The findings library, template CRUD and teaching cases — the writes this
    // page has always made. A new one appearing here would mean the correction
    // had quietly become a persisting surface.
    expect(writes).toEqual([
      "/api/abnormal-findings",
      "/api/report-templates",
      "/api/report-templates/:id",
      "/api/teaching-cases/generate-from-report",
    ]);
    // Both Save buttons belong to dialogs, not to a report: nothing here looks
    // like a save that silently does nothing.
    expect(src).toContain("<Button onClick={saveFinding}>Save</Button>");
    expect(src).toContain("<Button onClick={saveTemplate}>Save Template</Button>");
  });
});
