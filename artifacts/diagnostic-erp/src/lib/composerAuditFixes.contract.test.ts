/**
 * PR #1172 — the remaining two audit fixes' wiring, pinned at the source
 * level (this package has no DOM harness; see finalizeDialogResult.contract
 * for the convention):
 *
 *   IDENTITY STRIP  the composer column prints who the report is about —
 *                   name, UHID, accession, age/sex — persistently, not only
 *                   behind a collapsed accordion or a 10px top-bar mention.
 *   SIGN DIALOG     the demography-armed wrong-report rules (laterality vs
 *                   study, gender vs anatomy, age wording) are the local
 *                   wrong-patient detectors. When the demography has not
 *                   resolved they silently no-oped — no record, no row, the
 *                   same screen as a clean report. And when they DID fire,
 *                   they rendered as unstyled text inside the muted pre blob
 *                   while quality findings got coloured rows.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINALIZE_CHECK_LABELS,
  skippedFinalizeCheck,
  type FinalizeCheckKey,
} from "@/lib/finalizeChecks";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const CANVAS = "components/radiology/workspace/ReportCanvas.tsx";
const STRIP = "components/radiology/workspace/ComposerIdentityStrip.tsx";
const DIALOG = "components/radiology/FinalizeSignDialog.tsx";
const FINALIZE = "hooks/radiology-workspace/useStudyFinalize.ts";
const CHECKS = "lib/finalizeChecks.ts";
const FLOW = "hooks/useFinalizeFlow.ts";

describe("PR #1172 — composer identity strip", () => {
  const canvas = read(CANVAS);
  const strip = read(STRIP);

  it("1. the strip exists as its own component and renders the identity a report is about", () => {
    expect(strip).toContain('data-testid="composer-identity-strip"');
    expect(strip).toContain("patientName");
    expect(strip).toContain("uhid");
    expect(strip).toContain("accessionNumber");
    expect(strip).toMatch(/age.*sex|sex.*age/s);
  });

  it("2. the strip mounts at the top of the composer column, before the starting canvas", () => {
    const at = canvas.indexOf('data-testid="reporting-canvas-r2"');
    expect(at).toBeGreaterThan(-1);
    const column = canvas.slice(at, at + 4000);
    const stripAt = column.indexOf("<ComposerIdentityStrip");
    const canvasAt = column.indexOf('data-testid="full-normal-starting-canvas"');
    expect(stripAt).toBeGreaterThan(-1);
    expect(canvasAt).toBeGreaterThan(-1);
    expect(stripAt).toBeLessThan(canvasAt);
  });

  it("3. the strip is fed the canonical demography — detail-first, filter-proof", () => {
    const at = canvas.indexOf("<ComposerIdentityStrip");
    const block = canvas.slice(at, at + 500);
    expect(block).toContain("canonicalDemography");
  });

  it("4. the strip hides nothing behind the Study details accordion — it renders unconditionally in the column", () => {
    const at = canvas.indexOf("<ComposerIdentityStrip");
    const block = canvas.slice(at - 700, at);
    // Not inside the studyDetailsOpen conditional.
    expect(block.lastIndexOf("studyDetailsOpen ? (")).toBeLessThan(block.lastIndexOf(") : (") >= 0 ? block.lastIndexOf(") : (") : block.length);
  });
});

describe("PR #1172 — demography-armed wrong-report checks are never silent", () => {
  const finalize = read(FINALIZE);
  const checks = read(CHECKS);
  const flow = read(FLOW);
  const dialog = read(DIALOG);

  it("5. finalizeChecks names the demography check and labels it for the screen", () => {
    expect(checks).toContain('"patientDemography"');
    expect(FINALIZE_CHECK_LABELS).toHaveProperty("patientDemography");
    expect(FINALIZE_CHECK_LABELS.patientDemography.length).toBeGreaterThan(3);
  });

  it("6. a skipped demography check is a value the dialog can render", () => {
    const out = skippedFinalizeCheck("patientDemography" as FinalizeCheckKey, "reason");
    expect(out.state).toBe("skipped");
    expect(out.key).toBe("patientDemography");
  });

  it("7. the gauntlet records the skip when getDemography() has not resolved", () => {
    expect(finalize).toMatch(/skippedFinalizeCheck\(\s*"patientDemography"/);
    const at = finalize.search(/skippedFinalizeCheck\(\s*"patientDemography"/);
    const block = finalize.slice(at - 900, at + 900);
    expect(block).toContain("demography == null");
  });

  it("8. ...and when the patient has no sex or age to check against at all", () => {
    const at = finalize.search(/skippedFinalizeCheck\(\s*"patientDemography"/);
    const block = finalize.slice(at - 900, at + 1400);
    expect(block).toMatch(/!demography\.sex && !demography\.age/);
  });

  it("9. the skip rides the same outcomes array as the two service checks", () => {
    const at = finalize.indexOf("const outcomes: FinalizeCheckOutcome<unknown>[]");
    expect(at).toBeGreaterThan(-1);
    const block = finalize.slice(at, at + 400);
    expect(block).toContain("demographyOutcome");
  });

  it("10. the local validation issues travel as clinicalWarnings, not only inside the summary string", () => {
    expect(checks).toContain("clinicalWarnings: string[]");
    expect(finalize).toContain("clinicalWarnings: validationIssues");
    // The prompt input carries them to the dialog.
    expect(flow).toContain("clinicalWarnings?: string[]");
    expect(finalize).toContain("clinicalWarnings: checks.clinicalWarnings");
  });

  it("11. the dialog renders each clinical warning as its own styled row — advisory, never a gate", () => {
    expect(dialog).toContain('data-testid="finalize-clinical-warnings"');
    const at = dialog.indexOf('data-testid="finalize-clinical-warnings"');
    const block = dialog.slice(at - 1200, at + 1600);
    expect(block).toContain("clinicalWarnings.map");
    // Advisory by design: the warnings block must not touch canConfirm.
    const canConfirmAt = dialog.indexOf("const canConfirm");
    const canConfirmBlock = dialog.slice(canConfirmAt, canConfirmAt + 700);
    expect(canConfirmBlock).not.toContain("clinicalWarnings");
  });
});
