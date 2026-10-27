/**
 * P1 — a report that is not signed may not be shown as signed.
 *
 * Reproduced in the browser against real PostgreSQL: a finalize created the
 * report row, the study went REPORT_FINAL, and with no signature on file the
 * row stayed `status = 'draft'` with `signed_at IS NULL` (patient_reports 171)
 * while `WorkspaceOverlays.tsx` read
 *
 *   {linkedReportId ? "Report signed" : "Study marked final — NO report exists"}
 *
 * — an existence test wearing the word "signed". Three seconds earlier the same
 * finalize had toasted "Report saved but NOT signed", so the two halves of one
 * action contradicted each other on the same screen.
 *
 * The three states the owner asked to distinguish are decided here, from the
 * report row's own witnesses, and the witness is NOT re-derived: it is
 * `rowAlreadySigned()`, the existing client mirror of the server's single
 * authority `isSignedArtifact()`, whose parity the matrix below checks against
 * the server function itself rather than against a copy of its rules.
 *
 * Why source contracts for the components: this package's vitest environment is
 * `node` with no DOM, so the chip and the button cannot be rendered here. The
 * claims themselves are tested as behaviour (they are pure functions now);
 * the contracts only pin that the production files call them. Comments are
 * stripped first — this PR's own prose quotes the strings it forbids.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  finalizeActionLabel,
  signedReportBadge,
  signedReportDisplayState,
  type SignedReportDisplayState,
} from "@/lib/radiologyReportLifecycle";
import { isSignedArtifact } from "../../../api-server/src/lib/signedArtifactGuard";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");

function code(path: string): string {
  return readFileSync(resolve(ERP_SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** The row exactly as `GET /api/patient-reports/:id` serves it, plus the one
 *  thing the browser never has to guess about: which id the row answers. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 171, status: "draft", signedAt: null, signedByName: null, structuredJson: null, ...over };
}

describe("signedReportDisplayState — the report row decides, not the id", () => {
  it("a bound row with no witness is NOT signed, whatever the id says", () => {
    expect(signedReportDisplayState({ reportId: 171, report: row(), studyFinal: true }))
      .toEqual({ state: "not-signed", signedByName: null });
  });

  it("signed_at is a signature", () => {
    const r = row({ signedAt: "2026-10-17T09:00:00.000Z", signedByName: "Dr. Sugandha Priyadarshini" });
    expect(signedReportDisplayState({ reportId: 171, report: r, studyFinal: true }))
      .toEqual({ state: "signed", signedByName: "Dr. Sugandha Priyadarshini" });
  });

  it("the signed statuses are signatures — including pending_verification", () => {
    for (const status of ["pending_verification", "verified", "delivered"]) {
      expect(signedReportDisplayState({ reportId: 171, report: row({ status }), studyFinal: true }).state)
        .toBe("signed");
    }
  });

  it("a D5 structured signature keeps status draft and is still a signature", () => {
    const r = row({ structuredJson: { audit: { signature: { state: "final" } } } });
    expect(signedReportDisplayState({ reportId: 171, report: r, studyFinal: true }).state).toBe("signed");
    // ...and a structured document whose signature is still a draft is not.
    expect(signedReportDisplayState({
      reportId: 171, report: row({ structuredJson: { audit: { signature: { state: "draft" } } } }), studyFinal: true,
    }).state).toBe("not-signed");
  });

  it("a bound report whose row has not been read back is unknown, never signed", () => {
    // The row is fetched asynchronously and re-fetched after every finalize, so
    // there is a real window in which the id is known and the signature is not.
    expect(signedReportDisplayState({ reportId: 171, report: null, studyFinal: true }).state).toBe("unknown");
    expect(signedReportDisplayState({ reportId: 171, report: undefined, studyFinal: true }).state).toBe("unknown");
    // A row that answers without an id of its own has not really been read.
    expect(signedReportDisplayState({ reportId: 171, report: row({ id: null }), studyFinal: true }).state).toBe("unknown");
  });

  it("a study closed with nothing behind it is the no-report state", () => {
    expect(signedReportDisplayState({ reportId: null, report: null, studyFinal: true }).state).toBe("no-signed-report");
  });

  it("an open study with no report is neither signed nor unsigned — nothing is bound", () => {
    expect(signedReportDisplayState({ reportId: null, report: null, studyFinal: false }).state).toBe("unknown");
  });

  it("switching studies decides each one from its own row", () => {
    // The radiologist's real sequence: A is signed, B is freshly opened and its
    // row has not arrived yet, B's row lands as a draft. The verdict must follow
    // the row in hand at every step — A's signature is the one state B can never
    // take, because the query is keyed on B's own id and nothing carries over.
    const a = row({ id: 171, signedAt: "2026-10-17T09:00:00.000Z", signedByName: "Dr. Sugandha Priyadarshini" });
    const b = row({ id: 172, status: "draft", signedAt: null, signedByName: null });
    const onA = signedReportDisplayState({ reportId: 171, report: a, studyFinal: true });
    const midSwitch = signedReportDisplayState({ reportId: 172, report: undefined, studyFinal: false });
    const onB = signedReportDisplayState({ reportId: 172, report: b, studyFinal: false });
    expect(onA.state).toBe("signed");
    expect(midSwitch.state).toBe("unknown");
    expect(midSwitch.signedByName).toBeNull();
    expect(onB.state).toBe("not-signed");
    expect(onB.signedByName).toBeNull();
    // And no label reachable from B's inputs may claim a signature.
    for (const st of [midSwitch, onB] as const) {
      expect(signedReportBadge(st.state, st.signedByName).label).not.toMatch(/report signed/i);
    }
  });

  it("attribution is only claimed alongside a signature", () => {
    // A row can carry signedByName from an earlier signature that was withdrawn;
    // withdrawing sets the row back to draft, so the name must not keep the
    // report looking signed.
    const r = row({ status: "draft", signedAt: null, signedByName: "Dr. Sugandha Priyadarshini" });
    const out = signedReportDisplayState({ reportId: 171, report: r, studyFinal: true });
    expect(out.state).toBe("not-signed");
    expect(out.signedByName).toBeNull();
  });
});

describe("the witness matches the server's single authority", () => {
  const WITNESSES: Array<Record<string, unknown>> = [
    { id: 1, status: "draft", signedAt: null, structuredJson: null },
    { id: 1, status: "pending_verification", signedAt: null, structuredJson: null },
    { id: 1, status: "verified", signedAt: null, structuredJson: null },
    { id: 1, status: "delivered", signedAt: null, structuredJson: null },
    { id: 1, status: "draft", signedAt: "2026-10-17T09:00:00.000Z", structuredJson: null },
    { id: 1, status: "draft", signedAt: null, structuredJson: { audit: { signature: { state: "final" } } } },
    { id: 1, status: "draft", signedAt: null, structuredJson: { audit: { signature: { state: "draft" } } } },
    { id: 1, status: "draft", signedAt: null, structuredJson: {} },
  ];

  it.each(WITNESSES.map((r, i) => [i, r]))("witness %#: the UI state agrees with isSignedArtifact", (_i, r) => {
    const serverSays = isSignedArtifact(r as Parameters<typeof isSignedArtifact>[0]);
    const uiSays = signedReportDisplayState({ reportId: 1, report: r, studyFinal: true }).state === "signed";
    expect(uiSays).toBe(serverSays);
  });
});

describe("signedReportBadge — what each state is allowed to say", () => {
  const STATES: SignedReportDisplayState[] = ["signed", "not-signed", "no-signed-report", "unknown"];

  it("only the signed state claims a signature, and only it is green", () => {
    for (const state of STATES) {
      const badge = signedReportBadge(state, "Dr. Sugandha Priyadarshini");
      const claims = /report signed/i.test(badge.label);
      if (state === "signed") {
        expect(claims).toBe(true);
        expect(badge.tone).toBe("success");
      } else {
        // The whole defect was an existence test wearing this word.
        expect(badge.label, `${state} must not read as signed`).not.toMatch(/report signed/i);
        expect(badge.tone, `${state} must not be celebrated in green`).not.toBe("success");
      }
    }
  });

  it("names the three outcomes the owner asked to distinguish", () => {
    expect(signedReportBadge("signed", null).label).toBe("Report signed");
    expect(signedReportBadge("signed", "Dr. S").label).toBe("Report signed — Dr. S");
    expect(signedReportBadge("not-signed", null).label).toBe("Report saved — NOT signed");
    expect(signedReportBadge("no-signed-report", null).label).toBe("Study marked final — NO report exists");
    expect(signedReportBadge("unknown", null).label).toMatch("signature status not confirmed");
  });

  it("points the unsigned report at a signature, not at an administrator", () => {
    // The old chip promised "corrections need an administrator" for every bound
    // row. On an unsigned row there is nothing to withdraw — the remedy is the
    // signature itself, which is why Report Hub shows an Ack/Sign path for it.
    expect(signedReportBadge("not-signed", null).lock).toMatch(/sign this report in Report Hub/i);
    expect(signedReportBadge("no-signed-report", null).lock).toMatch(/link and bill the study/i);
    expect(signedReportBadge("signed", null).lock).toMatch(/corrections need an administrator/i);
  });
});

describe("finalizeActionLabel — the button says the same thing as the chip", () => {
  const closed = { allowEditSigned: false, isFinalized: true, studyFinal: true };

  it("reserves the word Signed for a signed row", () => {
    expect(finalizeActionLabel({ ...closed, signatureState: "signed" })).toBe("Signed");
    for (const state of ["not-signed", "no-signed-report", "unknown"] as SignedReportDisplayState[]) {
      expect(finalizeActionLabel({ ...closed, signatureState: state })).not.toBe("Signed");
    }
    expect(finalizeActionLabel({ ...closed, signatureState: "not-signed" })).toBe("Not signed");
    expect(finalizeActionLabel({ ...closed, signatureState: "no-signed-report" })).toBe("No report");
    expect(finalizeActionLabel({ ...closed, signatureState: "unknown" })).toBe("Finalized");
  });

  it("keeps the pre-signing caption on a study that is still open", () => {
    expect(finalizeActionLabel({ allowEditSigned: false, isFinalized: false, studyFinal: false, signatureState: "not-signed" }))
      .toBe("Confirm & Sign");
    expect(finalizeActionLabel({ allowEditSigned: false, isFinalized: false, studyFinal: false, signatureState: "unknown" }))
      .toBe("Confirm & Sign");
  });

  it("keeps the closed caption while the row refetch is still in flight", () => {
    // `isFinalized` is client state: the gauntlet ran locally and the worklist
    // row has not been re-read yet. Borrowing the word "signed" there would be
    // the original fabrication again; offering "Confirm & Sign" would invite a
    // second finalize of a study that is already closed. "Finalized" is the only
    // caption that is true of both halves of the window.
    expect(finalizeActionLabel({ allowEditSigned: false, isFinalized: true, studyFinal: false, signatureState: "unknown" }))
      .toBe("Finalized");
    expect(finalizeActionLabel({ allowEditSigned: false, isFinalized: true, studyFinal: false, signatureState: "unknown" }))
      .not.toMatch(/sign/i);
  });

  it("after a withdrawal the study is editable again, so the button offers signing", () => {
    // Withdrawal sets the report row back to draft AND reverts the worklist row
    // (status off REPORT_FINAL, reportId cleared) — but the local draft can still
    // point at the report, so an unsigned bound row exists on a study the
    // radiologist can finalize again. Built from those two real rows rather than
    // from a hand-picked state, so the label follows whatever the witness reads.
    const withdrawnReport = row({ id: 171, status: "draft", signedAt: null, signedByName: "Dr. Sugandha Priyadarshini" });
    const { state, signedByName } = signedReportDisplayState({
      reportId: 171,
      report: withdrawnReport,
      studyFinal: false, // the reverted worklist row
    });
    expect(state).toBe("not-signed");
    expect(signedReportBadge(state, signedByName).label).not.toMatch(/report signed/i);
    expect(finalizeActionLabel({ allowEditSigned: false, isFinalized: false, studyFinal: false, signatureState: state }))
      .toBe("Confirm & Sign");
  });

  it("preserves the trial-edit affordance", () => {
    expect(finalizeActionLabel({ allowEditSigned: true, isFinalized: true, studyFinal: true, signatureState: "signed" }))
      .toBe("Re-finalize");
  });
});

describe("the production files read the witness, not the id", () => {
  const overlays = code("components/radiology/workspace/WorkspaceOverlays.tsx");
  const canvas = code("components/radiology/workspace/ReportCanvas.tsx");
  const share = code("hooks/radiology-workspace/useWorkspaceExportShare.ts");
  const hook = code("hooks/radiology-workspace/useStudyFinalize.ts");

  it("the chip's text and colour come from the badge the lib decided", () => {
    expect(overlays).toContain("signedReportBadge(signedReport.state, signedReport.signedByName)");
    expect(overlays).toMatch(/SIGNATURE_TONE_CLASS\[signatureBadge\.tone\]/);
    expect(overlays).toMatch(/data-signature-state=\{signedReport\.state\}/);
    // The existence test that wore the word, pinned out of existence.
    expect(overlays).not.toMatch(/linkedReportId\s*\?\s*"Report signed"/);
  });

  it("the button's caption comes from the lib too", () => {
    expect(canvas).toMatch(/finalizeLabel=\{finalizeActionLabel\(\{/);
    expect(canvas).toMatch(/signatureState: signedReport\.state,/);
    // The caption takes the CLOSED flag from the same single read the badge
    // uses, rather than re-checking the queue row here — which is also what
    // signedElsewhereControlLock counts, because a second hand-rolled
    // REPORT_FINAL test can disagree with contentLocked.
    expect(canvas).toMatch(/studyFinal: signedReport\.studyFinal,/);
    expect(canvas).not.toMatch(/: "Confirm & Sign"\}/);
  });

  it("the witness is built from the authoritative row and the study's own status", () => {
    expect(share).toMatch(/signedReportDisplayState\(\{\s*reportId: linkedReportId,/);
    expect(share).toMatch(/report: \(finalReport as Record<string, unknown> \| null \| undefined\)/);
    // DELIVERED counts as closed: a delivered study cannot be un-signed from the
    // app, so a caption built on REPORT_FINAL alone would offer signing again.
    expect(share).toMatch(
      /const studyFinal =\s*workflow\.currentRow\?\.status === "REPORT_FINAL"\s*\|\|\s*workflow\.currentRow\?\.status === "DELIVERED"/,
    );
    expect(share).toMatch(/studyFinal,\s*\}\)/);
    // ...and handed out WITH the verdict, so the canvas reads it instead of
    // deriving its own. Asserted as the returned object's shape, not as the
    // bare word: `studyFinal,` on its own also matches the argument passed INTO
    // the classifier, so deleting the propagated field kept that assertion green
    // while the canvas was reading `undefined`.
    expect(share).toMatch(/\.\.\.signedReportDisplayState\(\{[\s\S]*?\}\),\s*studyFinal,\s*\};/);
    expect(share).toMatch(/^\s*signedReport,$/m);
  });

  it("every finalize outcome re-reads the report row", () => {
    // Requirement: invalidate after signing AND after a signing refusal, so the
    // claim must be proved by position, not by prose. The invalidation sits
    // AFTER both branches of step 8 — the region between the completion gate and
    // it therefore contains the completion calls and the refusal call — and
    // BEFORE step 10's advance gate. An invalidation moved into either branch
    // would leave the other one showing a stale row.
    const gateAt = hook.indexOf("const completedFinalize = isFinalizeCompletion(finalizeResult)");
    const invalidateAt = hook.indexOf('queryKey: ["workspace-final-report"]');
    const advanceAt = hook.indexOf("if (result.advanceToNext && completedFinalize)");
    expect(gateAt).toBeGreaterThan(-1);
    expect(advanceAt).toBeGreaterThan(gateAt);
    expect(invalidateAt).toBeGreaterThan(gateAt);
    expect(invalidateAt).toBeLessThan(advanceAt);
    const between = hook.slice(gateAt, invalidateAt);
    expect(between).toContain("draftBackup.clear()");   // completion branch
    expect(between).toContain("useWorkspace.getState().cancelFinalize()"); // refusal branch
  });
});
