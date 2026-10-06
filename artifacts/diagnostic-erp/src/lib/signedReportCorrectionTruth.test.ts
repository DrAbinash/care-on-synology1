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

  it("offers withdrawal to exactly the one row state that can use it", () => {
    // The guard refuses three different states. Only one of them — a final
    // study still pointing at a report — has a reachable way back, so only that
    // message may name it. Naming withdrawal to the other two is the amend
    // mistake again in a new direction: staff get sent to a button that is not
    // there, which costs them a trip and tells them nothing.
    const offering = lockedMessages().filter((m) => /withdraw/i.test(m));
    expect(offering, `expected one withdrawal offer, got ${JSON.stringify(offering)}`).toHaveLength(1);
    expect(offering[0], "the refusal must say where to find it").toContain("Report Hub");
    expect(offering[0], "the button is gated on the signer or an administrator").toMatch(
      /signer or an administrator/i,
    );
    // Without this clause the message promises a button Report Hub is right to
    // hide: the legacy verify route sets status = "verified" with no structured
    // document involved (patient-reports.ts:2622) and withdraw-signature refuses
    // that row (:2866).
    expect(offering[0], "must not promise withdrawal unconditionally").toMatch(
      /unless it has been verified or delivered/i,
    );
  });

  it("does not send a delivered study to a withdrawal that refuses it", () => {
    const delivered = lockedMessages().filter((m) => /has already been delivered/i.test(m));
    expect(delivered, `expected one delivered refusal, got ${JSON.stringify(delivered)}`).toHaveLength(1);
    expect(delivered[0]).not.toMatch(/withdraw/i);
    expect(delivered[0]).not.toContain("Report Hub");
    // It has to say the door is shut, not merely fail to name it. Silence reads
    // as "look harder"; withdraw-signature throws `already_delivered` inside its
    // own transaction (patient-reports.ts:2932) and no UI affordance un-delivers
    // a row, so there is nothing in the app to find.
    expect(delivered[0]).toMatch(/cannot be un-signed from the app/i);
  });

  it("does not send a study with no report to a signature that does not exist", () => {
    // A worklist row can reach REPORT_FINAL with reportId still null —
    // WorkspaceOverlays.tsx:700 renders that state as "Study marked final — NO
    // report exists". There is no patient_reports row, so nothing to un-sign.
    const unlinked = lockedMessages().filter((m) => /no report linked to it/i.test(m));
    expect(unlinked, `expected one unlinked refusal, got ${JSON.stringify(unlinked)}`).toHaveLength(1);
    expect(unlinked[0]).not.toMatch(/withdraw/i);
    expect(unlinked[0]).not.toContain("Report Hub");
  });

  it("checks DELIVERED before reportId, because a delivered row has both", () => {
    // Ordering, not wording: canonical finalize binds reportId and the delivery
    // run then flips the status, so a delivered study satisfies BOTH conditions.
    // Swap these two throws and every delivered study is told to withdraw a
    // signature the server will refuse — the messages stay individually correct
    // and the guard still returns 409 REPORT_LOCKED, so nothing else catches it.
    const deliveredAt = identity.indexOf("worklist.status === \"DELIVERED\") {");
    const reportIdAt = identity.indexOf("worklist.reportId) {");
    expect(deliveredAt, "the delivered branch must still exist").toBeGreaterThan(-1);
    expect(reportIdAt, "the linked-report branch must still exist").toBeGreaterThan(-1);
    expect(deliveredAt, "DELIVERED must be tested first").toBeLessThan(reportIdAt);
  });
});
