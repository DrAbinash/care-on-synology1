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

/**
 * Comments removed, string literals preserved.
 *
 * Every absence assertion in this file reads raw source text, and raw text
 * contains the comments that explain the code that was removed. A comment
 * quoting the old badge — `dialog rendered a hard-coded green "Ready to sign"` —
 * satisfies `toContain("Ready to sign")` exactly as the badge itself once did, so
 * a "the old thing is gone" ratchet turns on prose about the old thing instead of
 * on the old thing. Strip first, then assert absence.
 *
 * Strings are skipped so a `//` inside one (a URL, a Windows path) cannot
 * truncate code. Used ONLY for absence: a stripper that ate code would make a
 * presence ratchet pass vacuously, so presence assertions below still read the
 * raw text and there is a control proving this did not eat the dialog.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const e = src.indexOf("\n", i);
      i = e === -1 ? src.length : e;
      continue;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e === -1 ? src.length : e + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j += 1; break; }
        j += 1;
      }
      out += src.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const FLOW = read(resolve(ERP_SRC, "hooks/useFinalizeFlow.ts"));
const HOOK = read(resolve(ERP_SRC, "hooks/radiology-workspace/useStudyFinalize.ts"));
const DIALOG = read(resolve(ERP_SRC, "components/radiology/FinalizeSignDialog.tsx"));
/** The dialog's code without its prose — what absence assertions are made against. */
const DIALOG_CODE = stripComments(DIALOG);
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

describe("a validation check that did not run is shown, retried, and never a gate", () => {
  // D-4. The hook used to swallow both service failures — one in an empty
  // `catch {}`, one as a null gate that hid the dialog's quality block. The
  // screen for "clean" and the screen for "never looked" were the same screen.
  it("the hook passes the failures and the retry down instead of dropping them", () => {
    expect(HOOK).toMatch(/checksIncomplete: checks\.checksIncomplete,/);
    expect(HOOK).toMatch(/onRetryChecks: runServiceChecks,/);
    // Both service calls go through runFinalizeCheck, so a rejection becomes a
    // named failure value. An empty catch anywhere in this file is the regression.
    expect(HOOK).toMatch(/runFinalizeCheck\("validateDraft"/);
    expect(HOOK).toMatch(/runFinalizeCheck\("qualityEvaluation"/);
    expect(HOOK).not.toMatch(/catch \{ \/\* non-fatal/);
  });

  it("the dialog renders the block from the check state it was given", () => {
    expect(DIALOG).toMatch(/checksIncomplete\.length > 0 &&/);
    expect(DIALOG).toContain("formatIncompleteChecks(checksIncomplete)");
    expect(DIALOG).toContain("role=\"alert\"");
    expect(DIALOG).toMatch(/input\.onRetryChecks\(\)\.then\(setChecksAfterRetry\)/);
    // A retry replaces what is rendered, so a check that failed on the way in and
    // passed on retry cannot keep being reported as missing.
    expect(DIALOG).toMatch(/checksAfterRetry\?\.checksIncomplete \?\? input\?\.checksIncomplete/);
  });

  it("nothing about an incomplete check gates Confirm — that policy is not ours to set", () => {
    const gate = /const canConfirm =\s*\(([\s\S]*?)\);/.exec(DIALOG)?.[1] ?? "";
    expect(gate).toBeTruthy();
    expect(gate).not.toContain("checksIncomplete");
    expect(gate).not.toContain("retryBusy");
  });

  it("what is recorded at signing is what was on the screen when Sign was pressed", () => {
    expect(DIALOG).toMatch(/checksIncompleteAtSigning: checksIncomplete\.map\(\(f\) => f\.key\)/);
    expect(HOOK).toMatch(/result\.checksIncompleteAtSigning \?\? checks\.checksIncomplete\.map\(\(f\) => f\.key\)/);
    expect(HOOK).toMatch(/signingAuditDetails\.validationChecksIncomplete =/);
    // And the server persists auditDetails, so this is a record and not a promise.
    expect(INTERNAL_ROUTE).toMatch(/details: \{ changes, \.\.\.\(typeof b\.auditDetails === "object"/);
  });

  it("a check that was never ATTEMPTED is recorded too, not only one that threw", () => {
    // D-3 (C1). The fix above covered a rejection. It did not cover the draft
    // validator's own guard: `if (effectiveDraftId) { runFinalizeCheck(...) }` with
    // no else. A finalize with no saved draft pushed no outcome at all, so
    // `checksIncomplete` was empty, the amber block stayed hidden, and the report
    // reached the radiologist looking fully validated by a validator that had
    // nothing to validate.
    const branch = /if \(effectiveDraftId\) \{([\s\S]*?)\n    \} else \{([\s\S]*?)\n    \}/.exec(HOOK);
    expect(branch, "the draft validator must have an else branch").not.toBeNull();
    expect(branch?.[1] ?? "").toMatch(/runFinalizeCheck\("validateDraft"/);
    expect(branch?.[2] ?? "").toMatch(/outcomes\.push\(skippedFinalizeCheck\("validateDraft"/);

    // And the list that reaches the dialog must be the "did not run" list, not the
    // narrower "threw" list. `failedFinalizeChecks` is gone from the module so
    // that a future caller cannot reach for it by name and re-open this.
    expect(HOOK).toMatch(/checksIncomplete: incompleteFinalizeChecks\(outcomes\),/);
    expect(HOOK).not.toContain("failedFinalizeChecks");
  });

  it("the retry is offered only where retrying can change the answer", () => {
    // A skipped check re-runs the same closure over the same absent draft. Offering
    // Retry for it is naming a remedy that does not work — and worse, it invites the
    // radiologist to conclude the second attempt looked at the report.
    expect(DIALOG_CODE).toMatch(/hasRetryableCheck\(checksIncomplete\)/);
    expect(DIALOG_CODE).toMatch(/\{retryCanHelp && \(/);
    expect(DIALOG_CODE).not.toMatch(/\{input\.onRetryChecks && \(\n\s*<Button/);
  });
});

describe("the comment stripper the badge ratchets depend on", () => {
  it("drops a comment, keeps code, and does not truncate at a // inside a string", () => {
    const src = [
      '// the old badge read "Ready to sign" here',
      'const url = "https://example.test/a"; /* gone too */ const kept = 1;',
      "<Badge>{label}</Badge>",
    ].join("\n");
    const out = stripComments(src);
    expect(out).not.toContain("Ready to sign");
    expect(out).not.toContain("gone too");
    expect(out).toContain('const url = "https://example.test/a";');
    expect(out).toContain("const kept = 1;");
    expect(out).toContain("<Badge>{label}</Badge>");
  });

  it("did not eat the dialog, so the absence ratchets below are not vacuous", () => {
    expect(DIALOG_CODE).toContain("describeFinalizeQualityStatus(qualityGate)");
    expect(DIALOG_CODE).toContain("{qualityStatus.label}");
    expect(DIALOG_CODE).toContain("const canConfirm =");
    // A stripper that returned "" would satisfy every `not.toContain` in this
    // file. Half the file's size is a floor no correct stripper falls under:
    // the dialog is mostly JSX, and JSX is not a comment.
    expect(DIALOG_CODE.length).toBeGreaterThan(DIALOG.length / 2);
  });
});

describe("the quality badge says what the findings say", () => {
  // D-1/D-2 (C1). The dialog rendered a hard-coded green "Ready to sign" beside a
  // grey `{warningCount} advisory`. Every rule in the catalogue is severity
  // "warning" + tier "heuristic" by settled policy (rules/text/index.ts, pinned by
  // lib/report-quality/src/phase2.test.ts), so `isHardBlockingFinding` is never
  // true, `computeUnresolvedBlockers` always returns [], and the green badge had
  // no reachable input that could change it. Measured: Findings "right frontal
  // infarct" against Impression "left frontal infarct" → score 95, one Q104
  // finding, zero red-block entries, and a green "Ready to sign".
  it("the badge is derived, not a constant", () => {
    expect(DIALOG).not.toContain('<Badge className="bg-emerald-600">Ready to sign</Badge>');
    // Against the code, not the raw file: the comment above quotes the old badge,
    // and raw text would fail this for describing the defect instead of having it.
    expect(DIALOG_CODE).not.toContain("Ready to sign");
    expect(DIALOG_CODE).toMatch(/describeFinalizeQualityStatus\(qualityGate\)/);
    expect(DIALOG_CODE).toMatch(/\{qualityStatus\.label\}/);
    // The old second badge counted severity, and severity cannot separate a wrong
    // side from a repeated word when every rule is "warning".
    expect(DIALOG_CODE).not.toMatch(/qualityGate\.warningCount/);
    // Green is reachable only through the tone map, and only for tone "positive"
    // — which describeFinalizeQualityStatus returns solely when all three lists
    // are empty. One occurrence, in the map.
    expect(DIALOG_CODE.match(/bg-emerald-600/g)?.length).toBe(1);
    expect(DIALOG_CODE).toMatch(/positive: "bg-emerald-600",/);
  });

  it("the badge and the three lists come from one partition, so they cannot disagree", () => {
    expect(DIALOG_CODE).toMatch(/qualityStatus\.unresolved\.length > 0 &&/);
    expect(DIALOG_CODE).toMatch(/qualityStatus\.clinical\.length > 0 &&/);
    expect(DIALOG_CODE).toMatch(/qualityStatus\.advisory\.length > 0 &&/);
    expect(DIALOG_CODE).not.toContain("advisoryWarnings");
    // The dialog must not keep its own second copy of the blocker computation.
    expect(DIALOG_CODE).not.toContain("computeUnresolvedBlockers");
  });

  it("a contradiction is named as one, and is still explicitly not a gate", () => {
    expect(DIALOG).toContain("Clinical contradictions in this report (review before signing — does not block)");
    // C1-E: promoting an advisory rule to a signing blocker is the owner's
    // clinical-policy decision (ARCHITECTURE.md §8.1). This is the executable form
    // of "the classification enforces nothing" — if a future change wires the
    // quality status into authorization, this fails and the decision gets made
    // deliberately instead of by accident.
    const gate = /const canConfirm =\s*\(([\s\S]*?)\);/.exec(DIALOG_CODE)?.[1] ?? "";
    expect(gate).toBeTruthy();
    expect(gate).not.toContain("qualityStatus");
    expect(gate).not.toContain("qualityGate");
    expect(gate).not.toContain("unresolved");
    expect(gate).not.toContain("clinical");
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

