/**
 * finalizeDeliveredGuard.test.ts — the finalize button's disabled predicate
 * must agree with the lock layer on what "closed" means (audit F-19).
 *
 * The disabled predicate covered isFinalized and REPORT_FINAL but not
 * DELIVERED, which the lock layer already treats as closed
 * (useWorkspaceClinicalUi: studyIsSignedElsewhere). A delivered study
 * therefore showed an ENABLED "Signed"-labelled finalize button that the
 * finalize gauntlet then refused — a guard-versus-label mismatch at the
 * highest-stakes moment of the workflow.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "../..");
const body = readFileSync(
  resolve(PKG_DIR, "src/components/radiology/workspace/ReportCanvas.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("F-19: DELIVERED studies cannot press Finalize", () => {
  it("the finalize predicate includes DELIVERED beside REPORT_FINAL", () => {
    expect(body).toMatch(
      /finalizeDisabled=\{!studyId \|\| isLocked \|\| \(!allowEditSigned && \(isFinalized \|\| workflow\.currentRow\?\.status === "REPORT_FINAL" \|\| workflow\.currentRow\?\.status === "DELIVERED"\)\)\}/,
    );
  });

  it("the finalized badge tells the truth for delivered studies too", () => {
    expect(body).toMatch(
      /reportFinalized=\{isFinalized \|\| workflow\.currentRow!\.status === "REPORT_FINAL" \|\| workflow\.currentRow!\.status === "DELIVERED"\}/,
    );
  });
});
