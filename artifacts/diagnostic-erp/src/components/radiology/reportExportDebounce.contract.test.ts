/**
 * reportExportDebounce.contract.test.ts — wiring contract for the few-clicks
 * pass 2, Section-9 preview debounce (owner's order: FEW CLICKS, easy quick
 * reports).
 *
 * THE COST UNDER GUARD
 *   ReportExportPanel's server-preview query keyed on the RAW editor texts.
 *   Every keystroke in Findings/Impression minted a fresh queryKey → an
 *   immediate refetch of /print-preview AND a silent draft save (the queryFn
 *   saves via onEnsureDraftSaved) — per keypress, for as long as the
 *   radiologist types. The preview is a side panel that reads the SAVED
 *   draft; it needs settle-freshness, not keystroke-freshness.
 *
 * WHY SOURCE CONTRACTS: the behavior harness (ReportExportPanel.test.ts)
 * mocks React's useEffect to a no-op, so a debounce can never advance inside
 * it — and the debounce is exactly what this pass adds. What CAN be pinned:
 * the key's text parts read the debounced values, deliberate inputs
 * (imageRefs / frozenKeyImages / previewRefresh / serverPreviewUrl) stay
 * outside the debounce, and the queryFn still merges the LIVE texts so a
 * fetch that runs can never render behind the editor.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  resolve(__dirname, "ReportExportPanel.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Section-9 preview refetch debounces keystrokes (few-clicks pass 2)", () => {
  it("the text parts of the queryKey are debounced", () => {
    expect(SRC).toContain('import { useDebouncedValue } from "@/hooks/useDebouncedValue";');
    const keyIdx = SRC.indexOf('queryKey: [');
    const keyEnd = SRC.indexOf("],", keyIdx);
    const key = SRC.slice(keyIdx, keyEnd);
    expect(key).toContain("debouncedLivePrintBodyHtml");
    expect(key).toContain("debouncedFindingsText");
    expect(key).toContain("debouncedImpressionText");
    expect(key).toContain("debouncedDemographyKey");
    // The raw texts no longer mint keys.
    expect(key).not.toMatch(/^\s*livePrintBodyHtml,?$/m);
    expect(key).not.toMatch(/^\s*findingsText,?$/m);
    expect(key).not.toMatch(/^\s*impressionText,?$/m);
    expect(key).not.toContain("demography?.patientName");
  });

  it("deliberate acts still refetch immediately — image and refresh inputs stay live", () => {
    const keyIdx = SRC.indexOf('queryKey: [');
    const keyEnd = SRC.indexOf("],", keyIdx);
    const key = SRC.slice(keyIdx, keyEnd);
    expect(key).toContain("serverPreviewUrl");
    expect(key).toContain("previewRefresh");
    expect(key).toContain("imageRefs");
    expect(key).toContain("linkedReportId ? null : frozenKeyImages");
  });

  it("a fetch that runs still merges the LIVE texts — the preview never lags the editor", () => {
    const fnIdx = SRC.indexOf("queryFn: async () => {");
    const fnEnd = SRC.indexOf("enabled:", fnIdx);
    const fn = SRC.slice(fnIdx, fnEnd);
    expect(fn).toContain("await onEnsureDraftSaved?.();");
    expect(fn).toMatch(/livePrintBodyHtml,/);
    expect(fn).toMatch(/findingsText,/);
    expect(fn).toMatch(/impressionText,/);
    expect(fn).toContain("demography,");
  });

  it("the debounce window is the shared 350ms convention, as a named constant", () => {
    expect(SRC).toContain("const SERVER_PREVIEW_TEXT_DEBOUNCE_MS = 350;");
    expect(SRC).toContain("useDebouncedValue(livePrintBodyHtml, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)");
    expect(SRC).toContain("useDebouncedValue(demographyKey, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)");
  });
});
