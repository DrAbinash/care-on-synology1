/**
 * Context budget and snapshot identity for the three assistant operations.
 *
 * Phase 5 of the reporting-assistant brief is "remove the destructive truncation,
 * use bounded context planning rather than blindly concatenating unlimited
 * content, and if a request exceeds model capacity, report that clearly". This
 * file is the proof of each half of that sentence: the report is never cut, the
 * window is sized per request, and an oversized request is refused with the
 * ceiling named instead of answered from half a report.
 */
import { describe, expect, it } from "vitest";
import {
  CLOUD_COMPOSER_MAX_CONTEXT_TOKENS,
  COMPOSER_MAX_OUTPUT_TOKENS,
  composerOutputReserveTokens,
  planComposerTextContext,
} from "./composerContextBudget";
import { computeSnapshotHashes } from "./snapshot";
import { parseComposerSnapshot } from "./types";

function lumbarSnap(over: Record<string, unknown> = {}) {
  return parseComposerSnapshot({
    modality: "MR",
    region: "LS Spine",
    findings: "Disc bulge at L4-L5 with 9 mm canal stenosis.",
    impression: "L4-L5 disc bulge with canal stenosis.",
    recommendation: "",
    observations: [],
    ...over,
  });
}

describe("text context is planned, not truncated", () => {
  it("sizes num_ctx up for a request that needs more, never below what the clinic set", () => {
    const small = planComposerTextContext({
      systemPrompt: "s",
      userPrompt: "u",
      transport: "ollama",
      configuredNumCtx: 4096,
    });
    expect(small.fits).toBe(true);
    // A short request does not silently shrink the admin's window.
    expect(small.numCtx).toBe(4096);

    const long = "A".repeat(9000);
    const big = planComposerTextContext({
      systemPrompt: long,
      userPrompt: long,
      transport: "ollama",
      configuredNumCtx: 4096,
    });
    expect(big.requiredTokens).toBeGreaterThan(4096);
    expect(big.numCtx).toBeGreaterThan(4096);
  });

  it("refuses a local request that cannot fit the ceiling, and says what to do", () => {
    const huge = "A".repeat(200000);
    const plan = planComposerTextContext({
      systemPrompt: huge,
      userPrompt: huge,
      transport: "ollama",
      configuredNumCtx: 4096,
    });
    expect(plan.fits).toBe(false);
    expect(plan.reason).toMatch(/ceiling/);
    // The advice has to be actionable: which sections to ask for instead, and the
    // fact that raising the configured number cannot help.
    expect(plan.reason).toMatch(/Findings/);
    expect(plan.reason).toMatch(/cloud/i);
  });

  it("bounds a cloud request against a stated ceiling", () => {
    const fits = planComposerTextContext({
      systemPrompt: "s".repeat(4000),
      userPrompt: "u".repeat(4000),
      transport: "cloud",
    });
    expect(fits.fits).toBe(true);
    expect(fits.ceilingTokens).toBe(CLOUD_COMPOSER_MAX_CONTEXT_TOKENS);

    const over = planComposerTextContext({
      systemPrompt: "s".repeat(200000),
      userPrompt: "u".repeat(200000),
      transport: "cloud",
    });
    expect(over.fits).toBe(false);
    expect(over.reason).toMatch(/Nothing was sent/);
  });

  it("grows the answer allowance with the report, up to the cap", () => {
    expect(composerOutputReserveTokens(200)).toBe(1024);
    expect(composerOutputReserveTokens(6000)).toBe(3000);
    expect(composerOutputReserveTokens(200000)).toBe(COMPOSER_MAX_OUTPUT_TOKENS);
  });
});

describe("additionalReports identity", () => {
  it("leaves every pre-existing snapshot's hashes untouched", () => {
    const before = computeSnapshotHashes(lumbarSnap());
    const asIfEmpty = computeSnapshotHashes(lumbarSnap({ additionalReports: undefined }));
    expect(asIfEmpty.inputHash).toBe(before.inputHash);
    expect(asIfEmpty.reportRevision).toBe(before.reportRevision);
  });

  it("invalidates the frozen input when the second report changes", () => {
    const cervical = { label: "MRI CERVICAL", findings: "C5-C6 disc bulge.", impression: "" };
    const withReport = computeSnapshotHashes(lumbarSnap({ additionalReports: [cervical] }));
    const edited = computeSnapshotHashes(
      lumbarSnap({
        additionalReports: [{ ...cervical, findings: "C5-C6 and C6-C7 disc bulges." }],
      }),
    );
    const without = computeSnapshotHashes(lumbarSnap());
    expect(withReport.inputHash).not.toBe(without.inputHash);
    // Two different combinations must never dedupe onto, or apply onto, each other.
    expect(withReport.inputHash).not.toBe(edited.inputHash);
  });

  it("does not move reportRevision, which guards the study's own editable text", () => {
    const base = computeSnapshotHashes(lumbarSnap());
    const combined = computeSnapshotHashes(
      lumbarSnap({ additionalReports: [{ findings: "C5-C6 bulge.", impression: "" }] }),
    );
    // A supplied second report is not a radiologist edit to this study's narrative,
    // so blind-apply protection keeps working off the same revision.
    expect(combined.reportRevision).toBe(base.reportRevision);
  });
});
