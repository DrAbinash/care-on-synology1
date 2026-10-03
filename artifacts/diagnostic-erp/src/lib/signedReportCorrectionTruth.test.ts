/**
 * A signed report must never LOOK correctable when it is not.
 *
 * The Reporting Workspace used to show an "Edit report" button on a signed
 * study. Clicking it set allowEditSigned, cleared isFinalized and promised
 * "Trial mode — edit, save draft, and re-finalize when ready." Every one of
 * those three verbs is refused server-side: assertDraftWritable answers 409
 * REPORT_LOCKED for a REPORT_FINAL worklist row, and POST /api/patient-reports
 * answers 200 with the UNCHANGED existing row (the idempotency branch), so the
 * radiologist retyped the impression, watched the editors open, pressed
 * re-finalize and signed a document that never changed.
 *
 * These are source checks on purpose. The behaviour they guard is a React
 * click handler in a component this repo has no DOM harness for, and the
 * request-level proof of the server half lives in
 * artifacts/api-server/src/routes/signedArtifactTrust.request.test.ts, which
 * runs against real HTTP and a real database in CI.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const overlays = readFileSync(
  join(here, "../components/radiology/workspace/WorkspaceOverlays.tsx"),
  "utf8",
);
const identity = readFileSync(
  join(here, "../../../api-server/src/lib/radiologyIdentity.ts"),
  "utf8",
);

/** The signed-study banner block, from its opening condition to its close. */
function signedBanner(src: string): string {
  const start = src.indexOf("{(isFinalized || workflow.currentRow?.status === \"REPORT_FINAL\")");
  expect(start, "the signed-study banner must still exist").toBeGreaterThan(-1);
  return src.slice(start, start + 1800);
}

describe("the signed-report banner does not fake an editor unlock", () => {
  it("never flips allowEditSigned on from a click", () => {
    expect(overlays).not.toContain("setAllowEditSigned(true)");
  });

  it("never clears the finalized flag behind the server's back", () => {
    expect(overlays).not.toMatch(/useWorkspace\.setState\(\s*\{\s*isFinalized:\s*false/);
  });

  it("does not repeat the promise that was false", () => {
    const banner = signedBanner(overlays);
    expect(banner).not.toContain("Trial edit unlocked");
    expect(banner).not.toContain("Editing unlocked");
    expect(banner).not.toContain("re-finalize when ready");
  });

  it("states that the signed text is locked", () => {
    const banner = signedBanner(overlays);
    expect(banner).toContain('data-testid="signed-report-lock"');
    expect(/locked/i.test(banner)).toBe(true);
  });

  it("does not call a study signed when no report row exists", () => {
    // A worklist row can reach REPORT_FINAL with reportCreationSkipped set —
    // no patient bill, no report. Emerald "Report signed" over that was the
    // calm-success face this PR removes.
    const banner = signedBanner(overlays);
    expect(banner).not.toContain("Report signed & delivered");
    expect(banner).toMatch(/NO report exists/);
    expect(banner).toMatch(/from-rose-500/);
  });
});

describe("the draft lock tells the truth about what it refuses", () => {
  /** Every REPORT_LOCKED refusal in the guard — worklist-level and draft-level. */
  function lockedMessages(): string[] {
    return [...identity.matchAll(/REPORT_LOCKED",\s*"([^"]+)"/g)].map((m) => m[1]);
  }

  it("does not send the reader to the amend route", () => {
    // POST /:id/amend refuses every row without a signed structured document,
    // and the locked-draft guard fires for legacy-signed studies too. A message
    // telling staff to "use amend" sends them to a second 409.
    const messages = lockedMessages();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    for (const message of messages) expect(message).not.toContain("amend");
  });

  it("says the signed text is what is locked", () => {
    expect(lockedMessages().some((m) => /signed text/i.test(m) && /final report/i.test(m))).toBe(true);
  });
});
