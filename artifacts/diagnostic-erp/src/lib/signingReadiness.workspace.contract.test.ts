/**
 * PR-1 (F1) requirement 6, wired into the reporting workspace.
 *
 * The signing certificate already existed as an endpoint; what was missing was a
 * screen that asks it. The owner's complaint was specific: a radiologist
 * discovers at 09:40, after signing, that the clinic's presentation was never
 * published — so the refusal arrives after the report has been written by hand,
 * and the workaround the dialog offers for it is "sign again".
 *
 * This package has no DOM harness (vitest runs `environment: "node"` and
 * `@testing-library/react` is not installed), so — like the other workspace
 * suites here — these are source-contract tests over the shipped files. What the
 * FORMATTING does is tested for real in `finalizeChecks.test.ts`; the route
 * itself is proven over HTTP by T10 of
 * `artifacts/api-server/src/routes/signedPresentationReproducibility.request.test.ts`.
 * What this file pins is the four places a wiring like this dies: the probe not
 * running, running against the wrong subject, arriving at the dialog and not
 * being rendered, or being rendered as a gate nobody authorised.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FINALIZE_CHECK_LABELS } from "@/lib/finalizeChecks";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

const DIALOG = "components/radiology/FinalizeSignDialog.tsx";
const FINALIZE = "hooks/radiology-workspace/useStudyFinalize.ts";
const CHECKS = "lib/finalizeChecks.ts";
const FLOW = "hooks/useFinalizeFlow.ts";

describe("PR-1 F1 requirement 6 — signing readiness in the reporting workspace", () => {
  const finalize = read(FINALIZE);
  const checks = read(CHECKS);
  const flow = read(FLOW);
  const dialog = read(DIALOG);

  it("1. readiness is a named finalize check, so 'it did not run' is sayable", () => {
    expect(checks).toContain('"signingReadiness"');
    expect(FINALIZE_CHECK_LABELS).toHaveProperty("signingReadiness");
    expect(FINALIZE_CHECK_LABELS.signingReadiness.length).toBeGreaterThan(3);
  });

  it("2. the gauntlet actually asks it — and asks the PATIENT, because the report row does not exist yet", () => {
    const at = finalize.search(/runFinalizeCheck\("signingReadiness"/);
    expect(at, "the workspace never asks the signing certificate").toBeGreaterThan(-1);
    const block = finalize.slice(at, at + 400);
    // The whole point of the sibling route: `/:id/signing-readiness` needs a
    // report id, and a first finalize has none. A probe wired to the report id
    // would silently never fire on exactly the study that needs it.
    expect(block).toContain("/api/patient-reports/signing-readiness/${checkPatientId}");
    expect(block).not.toContain("reportId");
    // It resolves in the same Promise.all as the two existing service checks, so
    // the dialog does not pay another round-trip for it.
    expect(finalize).toContain(
      "const [draftOutcome, qualityOutcome, readinessOutcome] = await Promise.all([",
    );
  });

  it("3. the patient id is read once, before the checks, like every other snapshot value", () => {
    const at = finalize.indexOf("const checkPatientId");
    expect(at).toBeGreaterThan(-1);
    expect(finalize.slice(at, at + 120)).toContain("workflow.currentRow.patientId");
    // Declared before `runServiceChecks`, so Retry re-asks about THIS study rather
    // than whatever the radiologist has clicked through meanwhile.
    expect(at).toBeLessThan(finalize.indexOf("const runServiceChecks"));
  });

  it("4. a row with no patient is a recorded skip, not an absence", () => {
    expect(finalize).toMatch(/skippedFinalizeCheck\(\s*"signingReadiness"/);
  });

  it("5. the verdict travels the outcomes array and the prompt input to the dialog", () => {
    const outcomesAt = finalize.indexOf("const outcomes: FinalizeCheckOutcome<unknown>[]");
    expect(finalize.slice(outcomesAt, outcomesAt + 400)).toContain("readinessOutcome");
    expect(checks).toContain("signingReadiness?: SigningReadinessVerdict | null;");
    expect(finalize).toContain("signingReadiness: readiness,");
    expect(finalize).toContain("signingReadiness: checks.signingReadiness,");
    expect(flow).toContain("signingReadiness?: SigningReadinessVerdict | null;");
  });

  it("6. the dialog renders the warning, and renders nothing when the certificate holds", () => {
    expect(dialog).toContain('data-testid="finalize-signing-readiness"');
    const at = dialog.indexOf('data-testid="finalize-signing-readiness"');
    const block = dialog.slice(at, at + 900);
    expect(block).toContain("signingReadinessWarning");
    // `<div role="alert" data-testid=…>` — the role precedes the id, so it lives
    // in the window behind the anchor.
    const opener = dialog.slice(at - 200, at);
    expect(opener).toContain('role="alert"');
    // Rendered behind a guard: an absent verdict draws no block, so "never
    // checked" cannot read as either a warning or an all-clear.
    expect(opener).toContain("{signingReadinessWarning && (");
    expect(dialog).toContain("formatSigningReadinessWarning(");
  });

  it("7. a Retry replaces the warning instead of stacking a second copy", () => {
    const at = dialog.indexOf("const signingReadinessWarning");
    expect(at).toBeGreaterThan(-1);
    const block = dialog.slice(at, at + 300);
    expect(block).toContain("checksAfterRetry?.signingReadiness");
    expect(block).toContain("input?.signingReadiness");
  });

  it("8. advisory: the readiness block touches nothing that gates Confirm", () => {
    // Same rule the clinical warnings and the Not-checked block are held to, and
    // the reason the owner's signing policy stays in one place: whether a
    // certificate fault stops a signature is decided by the door, not by a
    // screen. A future change that wires this into `canConfirm` is a policy
    // change and must be an explicit one.
    const canConfirmAt = dialog.indexOf("const canConfirm");
    expect(canConfirmAt).toBeGreaterThan(-1);
    const canConfirmBlock = dialog.slice(canConfirmAt, canConfirmAt + 700);
    expect(canConfirmBlock).not.toContain("signingReadiness");
  });
});
