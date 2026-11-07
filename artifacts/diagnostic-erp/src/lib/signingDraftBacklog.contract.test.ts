/**
 * Source contract for the signing/draft-integrity backlog — the flagged
 * items from #1155/#1165/#1156 this PR closes:
 *
 *   1. Signer-of-record read fails OPEN on network errors (both export doors
 *      fell through to a client re-render / live merge of a signed study).
 *   2. Sign-dialog impression refresh: an unconditional "refreshed" cleared
 *      the gate even when the store refused, the refreshed text was never
 *      saved to the draft, and a dependency armed while the dialog was open
 *      signed with no gate at all.
 *   3. Server: signing freezes uncovered picker refs (see the server-side
 *      contract + DB tests in frozenKeyImages.test.ts); multi-draft pickers
 *      agree on ONE ordering rule.
 *
 * Browser-only assembly pinned as source needles, per repo convention.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(join(here, rel), "utf8");

const lifecycle = read("./radiologyReportLifecycle.ts");
const exportShare = read("../hooks/radiology-workspace/useWorkspaceExportShare.ts");
const signDialog = read("../components/radiology/FinalizeSignDialog.tsx");
const finalizeHook = read("../hooks/radiology-workspace/useStudyFinalize.ts");
const ledger = read("./observationLedger.ts");

describe("signer-of-record read: three states, and the doors refuse the third", () => {
  it("loadSignerOfRecord distinguishes a failed read from a verified-unsigned row", () => {
    expect(lifecycle).toContain("readFailed: boolean");
    expect(lifecycle).toMatch(/catch\s*{\s*return\s*\{\s*signerOfRecord:\s*null,\s*unsigned:\s*true,\s*readFailed:\s*true/);
  });

  it("the PDF door aborts on a failed read — no client re-render of a signed study", () => {
    const pdfDoor = exportShare.slice(
      exportShare.indexOf("const handleExportPdf"),
      exportShare.indexOf("const runPrintLikeFinal"),
    );
    expect(pdfDoor).toContain("readFailed");
    expect(pdfDoor).toMatch(/if\s*\(readFailed\)/);
    expect(pdfDoor).toContain("variant: \"destructive\"");
  });

  it("the Word door aborts on a failed read — no live merge over a signed artifact", () => {
    const wordDoor = exportShare.slice(
      exportShare.indexOf("const handleExportWord"),
      exportShare.indexOf("const handleExportPdf"),
    );
    expect(wordDoor).toContain("readFailed");
    expect(wordDoor).toMatch(/if\s*\(.*readFailed\)\s*{/);
  });
});

describe("sign-dialog impression refresh: the gate clears only when the refresh happened", () => {
  it("an unconditional refreshed flag is gone — the store's own answer decides", () => {
    // The OLD wiring: refresh(); setRefreshed(true); — two statements, no check.
    expect(signDialog).not.toMatch(/refreshImpressionFromLedger\(\);\s*\n\s*setImpressionRefreshed\(true\);/);
    expect(signDialog).toMatch(/refreshImpressionFromLedger\(\);/);
    // Writing the text is not the same as settling the pairing: the dialog hands
    // its own refresh outcome plus the store's post-refresh `impressionNeedsRefresh`
    // to one derived decision and sets exactly what that returns. A literal `true`
    // anywhere in this file would re-open the bug — pressing Refresh cleared the
    // gate while a `stale-patch` dependency stayed armed, so Confirm enabled, the
    // finalize caller refused, and no request was sent.
    expect(signDialog).not.toMatch(/setImpressionRefreshed\(true\)/);
    expect(signDialog).toMatch(
      /const outcome = useWorkspace\.getState\(\)\.refreshImpressionFromLedger\(\);/,
    );
    expect(signDialog).toMatch(
      /const needsRefreshAfter = useWorkspace\.getState\(\)\.impressionNeedsRefresh;/,
    );
    expect(signDialog).toMatch(/setImpressionRefreshed\(settled\);/);
    expect(signDialog).toMatch(/refreshAnswersImpressionGate\(\{ outcome, needsRefreshAfter \}\)/);
    // The refusal reason the store can answer with is honoured where the decision
    // now lives — a refresh that returned nothing, or left the pairing armed, is
    // not "refreshed".
    expect(ledger).toMatch(/opts\.outcome === undefined && !opts\.needsRefreshAfter/);
  });
});

describe("the gauntlet re-checks and re-saves after the dialog", () => {
  it("a dependency armed while the dialog was open is re-read before signing", () => {
    // After result.confirmed and the A-01 identity assertion, the live
    // dependency is read again — the pre-dialog snapshot is stale by design.
    const afterConfirm = finalizeHook.slice(finalizeHook.indexOf("if (!result.confirmed) return;"));
    expect(afterConfirm.indexOf("impressionNeedsRefresh")).toBeGreaterThan(0);
    expect(afterConfirm.indexOf("impressionNeedsRefresh")).toBeLessThan(afterConfirm.indexOf("const signed = useWorkspace.getState();"));
    expect(afterConfirm).toMatch(/impressionReviewedAnyway/);
  });

  it("a refresh (or any edit) inside the dialog is saved before the payload is built", () => {
    const afterConfirm = finalizeHook.slice(finalizeHook.indexOf("if (!result.confirmed) return;"));
    expect(afterConfirm.indexOf("saveDraft({ silent: true })")).toBeGreaterThan(0);
    expect(afterConfirm.indexOf("saveDraft({ silent: true })")).toBeLessThan(afterConfirm.indexOf("const signed = useWorkspace.getState();"));
  });
});
