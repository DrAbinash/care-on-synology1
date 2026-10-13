/**
 * finalizeDialogResult.contract.test.ts — PR-7 wiring contracts (source-level,
 * per this repo's node-env convention).
 *
 * THE BUG CLASS UNDER GUARD
 *   FinalizeSignDialog collects seven values and hands them back through
 *   useFinalizeFlow's promise. The consumer, useStudyFinalize, read three of
 *   them. The other four were dropped on the floor with no type error, no
 *   warning and no test — because every one of them is optional-or-boolean, so
 *   TypeScript is satisfied by a caller that simply never looks.
 *
 *   Two of the four were harmless: impressionReviewedAnyway / impressionRefreshed
 *   are consumed inside the dialog itself (compositionFinalizeAllowed gates
 *   canConfirm on them, and onRefreshImpression really calls
 *   refreshImpressionFromLedger). Reporting them outward is informational.
 *
 *   The other two existed ONLY to travel outward, and dropping them had clinical
 *   consequences:
 *
 *   1. criticalAcknowledged. The dialog made this tick a precondition of
 *      Confirm (`!input.criticalRequiresAck || criticalAck`), then the value was
 *      discarded. The report was signed with isCritical = true and
 *      criticalAcknowledgedAt = NULL, so Report Hub kept offering its Ack button
 *      (pages/ReportHub.tsx renders it on `isCritical && !criticalAcknowledgedAt`)
 *      and the radiologist had to give the same acknowledgement a second time —
 *      from a different screen, with nothing to say they had already given it.
 *
 *   2. notifyReferring. The label read "Notify referring doctor after finalize
 *      (WhatsApp/email template when configured)" and it was PRE-TICKED by
 *      `setNotifyReferring(input.criticalRequiresAck)`. Nothing sent anything,
 *      and the radiologist never even chose it.
 *
 * WHY SOURCE CONTRACTS AND NOT A BEHAVIOURAL TEST
 *   Same reason as criticalAlertsContract.test.ts and
 *   observationPersistence.hardening.test.ts: this package has no DOM harness,
 *   so the dialog cannot be rendered and the hook cannot be executed. What CAN
 *   be pinned mechanically is the wire itself — that every value the dialog
 *   returns is read, that the acknowledgement is posted to an endpoint that
 *   really exists, and that the label no longer promises a channel nobody
 *   built. Test 1 is the positive control: without it a broken parser would
 *   read zero fields and every ratchet below would pass vacuously.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { criticalFindingBlocksFinalize } from "../../lib/finalizeSafety";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "../..");
const REPO = resolve(HERE, "../../../../..");
/** Line endings are normalised because this repo is checked out with
 *  core.autocrlf=true on the Windows dev box (CRLF in the working tree) and LF
 *  in CI. Without this, every multi-line needle below passes on one and fails
 *  on the other. */
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const FLOW = read(resolve(ERP_SRC, "hooks/useFinalizeFlow.ts"));
const HOOK = read(resolve(ERP_SRC, "hooks/radiology-workspace/useStudyFinalize.ts"));
const DIALOG = read(resolve(ERP_SRC, "components/radiology/FinalizeSignDialog.tsx"));
const REPORTS_ROUTE = read(resolve(REPO, "artifacts/api-server/src/routes/patient-reports.ts"));
const INTERNAL_ROUTE = read(resolve(REPO, "artifacts/api-server/src/routes/internal-radiology.ts"));

/** Every field of FinalizePromptResult, parsed from the real declaration rather
 *  than from a hand-copied list — a hand-copied list is the thing that drifts. */
function promptResultFields(): string[] {
  const decl = /export type FinalizePromptResult = \{([\s\S]*?)\n\};/.exec(FLOW)?.[1] ?? "";
  return [...decl.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!);
}

/** The one field the dialog consumes for itself before enabling Confirm, and
 *  which the hook therefore legitimately ignores. Pinned by the test below, not by
 *  this comment. `impressionReviewedAnyway` left this list when the review became
 *  durable: the hook now records it, because an acknowledgement that dies on reload
 *  is a warning that trains the radiologist to click through it. */
const DIALOG_INTERNAL = ["impressionRefreshed"];

describe("every value the sign dialog returns is read by the finalize hook", () => {
  it("parses the result type at all (positive control)", () => {
    const fields = promptResultFields();
    // A regex that silently matched nothing would make every ratchet in this
    // file pass, so assert the parser really saw the declaration.
    expect(fields.length).toBeGreaterThanOrEqual(7);
    expect(fields).toEqual(
      expect.arrayContaining([
        "confirmed",
        "signatureId",
        "criticalAcknowledged",
        "notifyReferring",
        "impressionReviewedAnyway",
        "impressionRefreshed",
        "advanceToNext",
      ]),
    );
  });

  it("the hook reads every field that exists only to travel outward", () => {
    const dropped = promptResultFields()
      .filter((f) => !DIALOG_INTERNAL.includes(f))
      .filter((f) => !new RegExp(`\\bresult\\.${f}\\b`).test(HOOK));
    // Before PR-7 this was ["criticalAcknowledged", "notifyReferring"].
    expect(dropped).toEqual([]);
  });

  it("the dialog's own gate still consumes the refresh state, and the hook now consumes the review", () => {
    // If this stops matching, DIALOG_INTERNAL has become a place to hide a
    // dropped value rather than a description of one.
    const gate = /compositionFinalizeAllowed\(\{[\s\S]*?\}\)/.exec(DIALOG)?.[0] ?? "";
    expect(gate).toContain("impressionNeedsRefresh");
    expect(gate).toMatch(/\bimpressionRefreshed\b/);
    expect(gate).toMatch(/\bimpressionReviewedAnyway\b/);
    expect(DIALOG).toMatch(/onImpressionReviewedAnyway=\{setImpressionReviewedAnyway\}/);
    expect(DIALOG).toMatch(/refreshImpressionFromLedger\(\)/);
    // And the review is acted on, not just read: the store records it so a reload
    // cannot re-nag a report the radiologist already signed off.
    expect(HOOK).toMatch(
      /if \(result\.impressionReviewedAnyway\) useWorkspace\.getState\(\)\.markImpressionReviewed\(\);/,
    );
  });
});

describe("the critical tick is recorded on the report row", () => {
  it("posts to an endpoint that really exists on the server", () => {
    expect(HOOK).toMatch(
      /api\s*\n\s*\.post\(`\/api\/patient-reports\/\$\{finalizeResult\.reportId\}\/acknowledge-critical`/,
    );
    expect(REPORTS_ROUTE).toContain('"/:id/acknowledge-critical"');
  });

  it("is gated so it cannot fire on the idempotent path, an unsigned report, or a report that is not critical", () => {
    const gate =
      /if \(([^)]*)\) \{\s*\n\s*void api\s*\n\s*\.post\(`\/api\/patient-reports\/\$\{finalizeResult\.reportId\}\/acknowledge-critical`/.exec(
        HOOK,
      )?.[1] ?? "";
    expect(gate).toBeTruthy();
    // The idempotent path means nothing was written by this call, so nothing
    // about it may be recorded.
    expect(gate).toContain("!finalizeResult.idempotent");
    expect(gate).toContain("finalizeResult.signed");
    expect(gate).toContain("result.criticalAcknowledged");
    // criticalRequiresAck is ALSO raised when detector hits exist but the report
    // was not marked critical; the endpoint answers 409 not_a_critical_report
    // for those, so the gate has to carry criticalMarked itself.
    expect(gate).toContain("criticalMarked");
    expect(gate).toContain("finalizeResult.reportId");
  });

  it("a failed acknowledgement is told to the radiologist, not swallowed", () => {
    const block =
      /acknowledge-critical`, \{\}\)([\s\S]*?)\n {4}\}/.exec(HOOK)?.[1] ?? "";
    expect(block).toMatch(/\.catch\(/);
    expect(block).toContain('variant: "destructive"');
    // The one shape that would be a silent failure.
    expect(block).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
    expect(block).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\/\*[^*]*\*\/\s*\}\)/);
  });

  it("the acknowledger still comes from the session, never from this payload", () => {
    // The client posts `{}`. If the endpoint ever started trusting a name in the
    // body, the workspace would be able to discharge someone else's obligation.
    expect(HOOK).toMatch(/acknowledge-critical`, \{\}\)/);
    const handler =
      /acknowledge-critical"[\s\S]{0,1200}?criticalAcknowledgedBy:/.exec(REPORTS_ROUTE)?.[0] ?? "";
    expect(handler).toBeTruthy();
    expect(handler).toMatch(/staffSession/);
    expect(handler).toMatch(/subjectName/);
    expect(handler).not.toMatch(/req\.body/);
  });
});

describe("the notify tick is recorded instead of evaporating", () => {
  it("reaches auditDetails even when no quality gate ran", () => {
    expect(HOOK).toMatch(/if \(result\.notifyReferring\) signingAuditDetails\.referringDoctorNotifyIntent = true;/);
    // The old code built auditDetails only inside `qualityGate ? {...} : undefined`,
    // so any attestation recorded that way would vanish whenever the quality
    // evaluation was absent.
    expect(HOOK).toMatch(
      /auditDetails: Object\.keys\(signingAuditDetails\)\.length > 0 \? signingAuditDetails : undefined/,
    );
    expect(HOOK).not.toMatch(/auditDetails: qualityGate\s*\n/);
  });

  it("the server really persists auditDetails into the audit row", () => {
    // Without this the client is writing into a field the server drops.
    expect(INTERNAL_ROUTE).toMatch(/auditDetails\?:/);
    expect(INTERNAL_ROUTE).toMatch(
      /details: \{ changes, \.\.\.\(typeof b\.auditDetails === "object" && b\.auditDetails \? b\.auditDetails : \{\}\) \}/,
    );
  });
});

describe("the dialog no longer pre-ticks or over-promises", () => {
  it("the notify checkbox starts unticked — an attestation cannot start true", () => {
    expect(DIALOG).toMatch(/setNotifyReferring\(false\)/);
    expect(DIALOG).not.toMatch(/setNotifyReferring\(input\.criticalRequiresAck\)/);
  });

  it("the label states what actually happens", () => {
    expect(DIALOG).not.toContain("Notify referring doctor after finalize");
    expect(DIALOG).not.toContain("WhatsApp/email template when configured");
    expect(DIALOG).toContain("this screen sends no WhatsApp and no email");
    // And the ack label must not claim to be a mere review note now that it
    // writes a permanent, attributed row.
    expect(DIALOG).toContain("Recorded permanently");
  });
});

describe("the ack label's promise is actually reachable — criticalRequiresAck implies criticalMarked", () => {
  // The ack checkbox now says the tick is "recorded permanently". That is only
  // true if a tick can never be collected for a report that is not critical,
  // because the endpoint refuses those with 409. This is the one assertion in
  // the file that is behavioural rather than a source contract: the aggregator is
  // pure, so its first branch can be executed.
  it("the pure aggregator CAN demand a tick for an unmarked report (so the risk is real)", () => {
    expect(
      criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: [{ label: "acute bleed" }],
        criticalMarked: false,
        criticalCommunicated: false,
      }),
    ).toBe(true);
    // And it stays true for the marked-but-uncommunicated case, which is the one
    // the workspace actually reaches.
    expect(
      criticalFindingBlocksFinalize({
        checklistActive: false,
        checklistPercent: 100,
        criticalHits: [{ label: "acute bleed" }],
        criticalMarked: true,
        criticalCommunicated: false,
      }),
    ).toBe(true);
  });

  it("the call site forecloses that branch by gating both hits and the flag together", () => {
    // criticalRequiresAck is fed the GATED hits, never the raw detector output.
    expect(HOOK).toMatch(/criticalHits: gatedCriticalHits\.map\(/);
    expect(HOOK).not.toMatch(/criticalHits: criticalHits\.map\(/);
    // The gate and the mark share one flag, and the mark also treats any hit as
    // critical — so non-empty gated hits force criticalMarked true.
    expect(HOOK).toMatch(/const gatedCriticalHits = criticalCommsOn \? criticalHits : \[\];/);
    expect(HOOK).toMatch(/const criticalMarked = criticalCommsOn \? \(isCritical \|\| criticalHits\.length > 0\) : false;/);
  });

  it("the acknowledge gate still carries criticalMarked even though the invariant makes it redundant", () => {
    // Redundant today, load-bearing if the gating above is ever widened: without
    // it a 409 would surface as a destructive "not recorded" toast for a tick the
    // dialog should never have offered.
    expect(HOOK).toMatch(/result\.criticalAcknowledged && criticalMarked && finalizeResult\.reportId/);
  });
});

