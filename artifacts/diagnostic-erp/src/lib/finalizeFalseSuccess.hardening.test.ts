/**
 * P0 — a finalization that wrote nothing must not be completed, locked,
 * cleared, or advanced as if it had written something.
 *
 * Reproduced against real PostgreSQL with synthetic patients on the workspace's
 * own route (evidence: `tmp-c1-mut/p0/probe-4.json`, produced by
 * `artifacts/diagnostic-erp/tmp/pw-c3-p0probe.mjs`). Pressing Confirm & Sign on
 * the CT study issued exactly one request —
 *   `GET /api/patient-reports/from-study/4 -> 404`
 * — and no create and no status flip after it. The workspace then showed
 *   `signedLockPresent: true, signedLockText: "Locked — corrections need an administrator"`
 * while the same row's queue entry still read
 *   `{status: "STUDY_RECEIVED", reportId: null}`.
 * The study left the queue, both local draft backups were deleted, and the
 * radiologist was moved onto the next row — whose worklist lock was then claimed
 * for a study nobody had opened, which is where the foreign-row lock claim, the
 * DRAFT_WORKLIST_MISMATCH refusal and the patient-header change all come from.
 *
 * TWO DEFECTS, ONE CAUSE EACH:
 *   1. `useStudyFinalize` passed the workspace route param — a
 *      `radiology_worklist.id` — as `FinalizeStudyContext.studyId`, which is a
 *      `radiology_studies.id`. The two sequences overlap by design, so
 *      GET /api/patient-reports/from-study/:id answers with whichever billed
 *      study shares the number: its patient, its test, its order, its bill.
 *   2. The cleanup and auto-advance gated on "did not throw AND not idempotent"
 *      rather than on whether the study is actually REPORT_FINAL in the
 *      database, so a finalize that sent nothing was indistinguishable from one
 *      that signed.
 *
 * WHY PREDICATES PLUS SOURCE CONTRACTS: this package's vitest environment is
 * `node` with no DOM, so the gauntlet cannot be clicked here. The behavioural
 * half is carried by the two exported functions below, which the production hook
 * calls; the contract half pins that it calls them and gates in the right order.
 * Comments are stripped before every match — this file and the fix's own prose
 * name the calls they pin, and an unstripped grep passes on the explanation.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  finalizeContextForWorkspaceStudy,
  isFinalizeCompletion,
  type FinalizeResult,
} from "@/lib/radiologyReportLifecycle";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "..");

/** Production source with its comments removed, so a contract cannot be
 *  satisfied by prose. */
function code(path: string): string {
  return readFileSync(resolve(ERP_SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const FINALIZE_HOOK = "hooks/radiology-workspace/useStudyFinalize.ts";
const hook = code(FINALIZE_HOOK);

// Sanity: the strip must not have eaten the file. If these vanish, every
// contract below is asserting against an empty string.
it("the stripped hook still contains its own code", () => {
  expect(hook).toContain("const runFinalizeGauntlet = useCallback");
  expect(hook).toContain("finalizeRadiologyReport(");
});

/** A finalize that created the row, signed it and flipped the study. */
const COMPLETED: FinalizeResult = {
  reportId: 7,
  report: { id: 7 },
  structuredFinal: null,
  reportCreationSkipped: null,
  reportStatusSent: true,
  signed: true,
  signError: null,
};

const outcome = (over: Partial<FinalizeResult>) => isFinalizeCompletion({ ...COMPLETED, ...over });

describe("the two study id spaces are never the same number by accident", () => {
  const row = {
    patientId: 12,
    studyId: 303,
    modality: "CT",
    studyDescription: "CT Brain Plain",
    accessionNumber: "ACC-C3-4",
    studyInstanceUID: "1.2.840.CT.4",
  };

  it("maps the queue row's BILLED study id to the prefill slot and the route param to the row slot", () => {
    const ctx = finalizeContextForWorkspaceStudy({ worklistRowId: 4, row });
    expect(ctx.studyId).toBe(303);
    expect(ctx.worklistId).toBe(4);
    expect(ctx.patientId).toBe(12);
    expect(ctx.accessionNumber).toBe("ACC-C3-4");
    expect(ctx.studyInstanceUID).toBe("1.2.840.CT.4");
    expect(ctx.modality).toBe("CT");
  });

  it("never puts the route param in the billed-study slot when the row is unbilled", () => {
    const ctx = finalizeContextForWorkspaceStudy({ worklistRowId: 4, row: { ...row, studyId: null } });
    expect(ctx.studyId).toBeNull();
    expect(ctx.worklistId).toBe(4);
  });

  it("treats a non-numeric or zero billed id as unbilled rather than fetching /from-study/NaN", () => {
    for (const junk of ["abc", "", 0, -1, undefined, "NaN", Number.NaN]) {
      expect(finalizeContextForWorkspaceStudy({ worklistRowId: 4, row: { ...row, studyId: junk as any } }).studyId)
        .toBeNull();
    }
  });

  it("accepts a numeric STRING billed id, because the queue row's type allows it", () => {
    expect(finalizeContextForWorkspaceStudy({ worklistRowId: 4, row: { ...row, studyId: "303" } }).studyId).toBe(303);
  });

  it("keeps the authorized combined report's second study", () => {
    const ctx = finalizeContextForWorkspaceStudy({
      worklistRowId: 4,
      row,
      linked: { studyId: "9", accessionNumber: "ACC-C3-9", studyInstanceUID: "1.2.840.MR.9" },
    });
    expect(ctx.linkedStudyId).toBe("9");
    expect(ctx.linkedAccessionNumber).toBe("ACC-C3-9");
    expect(ctx.linkedStudyInstanceUID).toBe("1.2.840.MR.9");
  });

  it("survives a row that has not loaded instead of throwing at sign-off", () => {
    const ctx = finalizeContextForWorkspaceStudy({ worklistRowId: 4, row: null });
    expect(ctx.patientId).toBeNull();
    expect(ctx.studyId).toBeNull();
    expect(ctx.worklistId).toBe(4);
  });
});

describe("isFinalizeCompletion — signing and finalizing are different outcomes", () => {
  it("a finalize that sent the status flip is a completion", () => {
    expect(outcome({})).toBe(true);
  });

  it("the skipped creation for a patient-linked study is NOT — no flip was sent, so the row is still STUDY_RECEIVED", () => {
    expect(outcome({
      reportId: null,
      report: null,
      reportStatusSent: false,
      reportCreationSkipped: "the study's billed test could not be resolved (from-study lookup)",
      signed: false,
      signError: null,
    })).toBe(false);
  });

  it("the documented soft-final for a study with no patient IS a completion", () => {
    expect(outcome({
      reportId: null,
      report: null,
      reportCreationSkipped: "no patient is linked to this study",
      signed: false,
    })).toBe(true);
  });

  it("the idempotent refusal is NOT, even though it answers 200 with a report id", () => {
    expect(outcome({ idempotent: true })).toBe(false);
  });

  it("a study the server closed whose signing failed IS finalized — and still not signed", () => {
    // The predicate answers the finalization question only. `signed` stays the
    // separate, equally loud answer, which is what keeps "Report saved but NOT
    // signed" truthful without re-opening the study.
    const result = { ...COMPLETED, signed: false, signError: "No active signature is configured" };
    expect(isFinalizeCompletion(result)).toBe(true);
    expect(result.signed).toBe(false);
  });

  it("a D-5 resume of a study already REPORT_FINAL is a completion although no flip was sent", () => {
    expect(outcome({ reportStatusSent: false, resumedAfterLostResponse: true })).toBe(true);
  });

  it("a resume that found no bound row is never reported as a completion", () => {
    // `finalizeRadiologyReport` re-throws in that case, so a caller never sees
    // this shape — the predicate must still not invent a completion for it.
    expect(outcome({
      reportStatusSent: false,
      resumedAfterLostResponse: true,
      reportId: null,
      report: null,
    })).toBe(false);
  });
});

describe("the workspace hook hands the lifecycle one row id and one billed id", () => {
  it("builds its context through the canonical builder", () => {
    expect(hook).toMatch(/finalizeRadiologyReport\(\s*finalizeContextForWorkspaceStudy\(\s*\{/);
  });

  it("no longer sends the route param as a billed study id", () => {
    // Scoped to the context argument: further down the hook legitimately posts
    // `worklistId: studyId` to the HOPE endpoint, where the route param really
    // is the worklist row.
    const at = hook.indexOf("finalizeRadiologyReport(");
    const contextArg = hook.slice(at, at + 400);
    expect(contextArg).not.toMatch(/worklistId:\s*studyId/);
    expect(contextArg).not.toMatch(/\{\s*studyId,\s/);
  });

  it("gives the builder the route param as the row and the queue row for everything else", () => {
    expect(hook).toMatch(/finalizeContextForWorkspaceStudy\(\s*\{\s*worklistRowId:\s*studyId,\s*row:\s*workflow\.currentRow,/);
  });
});

describe("the workspace hook gates every post-finalize consequence", () => {
  const gate = hook.indexOf("= isFinalizeCompletion(finalizeResult)");

  it("asks the predicate before it acts on the answer", () => {
    expect(gate).toBeGreaterThan(-1);
    const cleanup = hook.indexOf("completedFinalize", gate);
    expect(cleanup).toBeGreaterThan(gate);
    // The four irreversible consequences, each inside the gated block.
    for (const act of [
      "workflow.markCompleted(studyId)",
      "draftBackup.clear()",
      "clearRescueDraft()",
      "useWorkspace.getState().completeFinalize()",
    ]) {
      expect(hook.slice(cleanup, cleanup + 1200)).toContain(act);
    }
  });

  it("runs them only under the completion branch, in one block", () => {
    expect(hook).toMatch(
      /if\s*\(completedFinalize\)\s*\{\s*workflow\.markCompleted\(studyId\);[\s\S]*?setReadingSession\(/,
    );
  });

  it("no longer treats the absence of a throw as a completion", () => {
    // The pre-fix cleanup gate, pinned out of existence. `finalizeResult.idempotent`
    // still legitimately gates the toasts, HOPE push and acknowledgement — but
    // not the cleanup.
    expect(hook).not.toMatch(/if\s*\(finalizeResult\.idempotent\)\s*\{[\s\S]{0,400}?cancelFinalize\(\)/);
  });

  it("keeps the study open when nothing was written: backups live, flag released", () => {
    const elseBlock = hook.slice(hook.indexOf("} else {", gate), hook.indexOf("} else {", gate) + 900);
    expect(elseBlock).toContain("useWorkspace.getState().cancelFinalize()");
    expect(elseBlock).not.toContain("draftBackup.clear()");
    expect(elseBlock).not.toContain("markCompleted");
  });

  it("does not advance the queue on a finalize that did not complete", () => {
    expect(hook).toMatch(/if\s*\(result\.advanceToNext\s*&&\s*completedFinalize\)\s*\{\s*goNextStudy\(\);/);
  });
});

describe("the refusal says what actually happened to the study", () => {
  const branch = hook.slice(hook.indexOf("finalizeResult.reportCreationSkipped) {"));
  const title = branch.slice(branch.indexOf("title:"), branch.indexOf("description:"));

  it("only calls a study final when the flip was really sent", () => {
    expect(title).toContain("finalizeResult.reportStatusSent");
    // "Study marked final" must be the THEN-branch of that test, never the
    // unconditional title.
    expect(title).toMatch(/reportStatusSent\s*\?\s*"Study marked final/);
  });

  it("says NOT finalized when nothing was written", () => {
    expect(title).toContain("NOT signed and NOT finalized — no report was created");
  });

  it("tells the radiologist where the work is and that the draft survived", () => {
    const description = branch.slice(branch.indexOf("description:"), branch.indexOf("variant:"));
    expect(description).toContain("stays in your queue");
    expect(description).toContain("draft is still saved");
  });
});
