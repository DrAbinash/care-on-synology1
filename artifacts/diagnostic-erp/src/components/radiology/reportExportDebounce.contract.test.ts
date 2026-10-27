/**
 * reportExportDebounce.contract.test.ts — wiring contract for the few-clicks
 * pass 2, Section-9 preview debounce (owner's order: FEW CLICKS, easy quick
 * reports), re-audited by pass 3.
 *
 * THE COST UNDER GUARD
 *   ReportExportPanel's server-preview query keyed on the RAW editor texts.
 *   Every keystroke in Findings/Impression minted a fresh queryKey → an
 *   immediate refetch of /print-preview AND a silent draft save (the queryFn
 *   saves via onEnsureDraftSaved) — per keypress, for as long as the
 *   radiologist types. The preview is a side panel that reads the SAVED
 *   draft; it needs settle-freshness, not keystroke-freshness.
 *
 * PASS 3 ADDS: the debounce must be IDENTITY-KEYED. A plain debounce held
 *   the PREVIOUS study's texts for 350 ms after a study switch, while
 *   serverPreviewUrl (draftId/linkedReportId) flushed at once — so every
 *   in-workspace switch minted the mixture key [study-B URL, study-A
 *   texts], refetched twice (url change, then debounce landing), and cached
 *   a render under a pairing that describes no real report. The texts now
 *   adopt immediately when the preview identity changes (see
 *   useKeyedDebouncedValue) and debounce only WITHIN one report.
 *
 * WHY SOURCE CONTRACTS: the behavior harness (ReportExportPanel.test.ts)
 * mocks React's useEffect to a no-op, so a debounce can never advance inside
 * it — and the debounce is exactly what this pass adds. What CAN be pinned:
 * the key's text parts read the debounced values, deliberate inputs
 * (imageRefs / frozenKeyImages / previewRefresh / serverPreviewUrl) stay
 * outside the debounce, the debounce is keyed by the preview identity, and
 * the queryFn still merges the LIVE texts so a fetch that runs can never
 * render behind the editor.
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
    // Pass 3: identity-keyed debounce (see the pass-3 block below). The
    // plain import was replaced deliberately.
    expect(SRC).toContain('import { useKeyedDebouncedValue } from "@/hooks/useDebouncedValue";');
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
    expect(SRC).toContain(
      "useKeyedDebouncedValue(livePrintBodyHtml, previewIdentityKey, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)",
    );
    expect(SRC).toContain(
      "useKeyedDebouncedValue(demographyKey, previewIdentityKey, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)",
    );
  });

  it("the debounce is keyed by the preview identity — study switches adopt, keystrokes settle (pass 3)", () => {
    // The identity the texts are keyed by must be the saved artifact this
    // preview reads: the signed report id, else the draft id.
    expect(SRC).toMatch(
      /const previewIdentityKey = `\$\{linkedReportId \? "r" : "d"\}-\$\{linkedReportId \?\? draftId \?\? "none"\}`;/,
    );
    // All four study-scoped text parts of the key adopt on identity change.
    for (const part of [
      "livePrintBodyHtml",
      "findingsText",
      "impressionText",
      "demographyKey",
    ]) {
      expect(SRC).toContain(
        `useKeyedDebouncedValue(${part}, previewIdentityKey, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)`,
      );
    }
    // The plain debounce is gone from these surfaces: a study switch must
    // never leave the previous study's text in the key for 350 ms.
    expect(SRC).not.toContain("useDebouncedValue(livePrintBodyHtml, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)");
    expect(SRC).not.toContain("useDebouncedValue(demographyKey, SERVER_PREVIEW_TEXT_DEBOUNCE_MS)");
  });
});
