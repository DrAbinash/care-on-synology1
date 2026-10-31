import { describe, it, expect } from "vitest";
import {
  UNLINKED_CONFIRM_REQUIRED,
  finalizeRefusalMessage,
  unlinkedCloseMessage,
} from "./finalizeOutcomeMessage";

/**
 * Production, 2026-11-01, worklist row 12326 (MRI BRAIN + CX SCR). The radiologist
 * signed, and the screen answered:
 *
 *   "Report signed — the study is NOT closed yet. Report #null is signed and
 *    prints from Report Hub."
 *
 * No report row had been created — the queue row carries no patient, so the
 * lifecycle skipped the create and the study was never eligible to sign — and the
 * close was refused because that row is not linked to a billed examination. The
 * toast asserted the opposite of both facts in one sentence, and the sentence it
 * quoted ("No images are linked to this billed examination") described a state the
 * row was not in either: there was no billed examination in the comparison at all.
 *
 * These tests are the refusal-decision table that produced that message, pinned so
 * it cannot come back: the word "signed" is earned by `signed`, a report number is
 * printed only when one exists, and the recovery a click offers is chosen by the
 * server's machine code, never by its prose.
 */
describe("finalizeRefusalMessage — the refused close, told truthfully", () => {
  const PRODUCTION_REFUSAL = {
    signed: false,
    reportId: null,
    reportStatusCode: UNLINKED_CONFIRM_REQUIRED,
    reportStatusError:
      "This worklist row is not linked to a billed examination, so its images cannot be verified against it. "
      + "Relink the study in Match Center, or confirm once to finalize without images.",
    reportCreationSkipped: "no patient is linked to this study",
  };

  it("P1 never claims a signature for a study that has no report row", () => {
    const m = finalizeRefusalMessage(PRODUCTION_REFUSAL);

    expect(m.title).toMatch(/NOT signed/i);
    const text = `${m.title} ${m.description}`;
    // The two false statements the radiologist read, each forbidden separately
    // because a rewrite that keeps either one still misleads him.
    expect(text).not.toMatch(/\bis signed\b/);
    expect(text).not.toMatch(/prints from Report Hub/);
    // And it says why, in the lifecycle's own words, plus the one action that works.
    expect(m.description).toContain("no patient is linked to this study");
    expect(m.description).toMatch(/Match Center/);
    expect(m.canConfirmUnlinked).toBe(false);
  });

  it("P2 never prints an id that does not exist", () => {
    const m = finalizeRefusalMessage(PRODUCTION_REFUSAL);
    expect(m.description).not.toContain("null");
    expect(m.description).not.toContain("#");

    // Defensive half: a signed state with no id is not reachable through the
    // lifecycle today, and must still not produce `#null`.
    const odd = finalizeRefusalMessage({ signed: true, reportId: null, reportStatusCode: "LOCKED_BY_OTHER" });
    expect(`${odd.title} ${odd.description}`).not.toMatch(/#null/);
    expect(odd.description).toContain("#—");
  });

  it("P3 offers the one confirmation when the report IS signed and the code asks for it", () => {
    const m = finalizeRefusalMessage({
      signed: true,
      reportId: 4412,
      reportStatusCode: UNLINKED_CONFIRM_REQUIRED,
      reportStatusError: "This worklist row is not linked to a billed examination.",
    });

    expect(m.title).toMatch(/signed/i);
    expect(m.description).toContain("Report #4412");
    expect(m.canConfirmUnlinked).toBe(true);
    // What the button is NOT, said out loud: the images and the signature are the
    // two things a radiologist would assume a second click puts at risk.
    expect(m.description).toMatch(/NOT discarded/i);
    expect(m.description).toMatch(/NOT signed a second time/i);
  });

  it("P4 refuses to offer that confirmation for any other refusal", () => {
    // A wrong-patient / wrong-examination match is exactly the case that must not
    // be closable by a click, and it arrives with the same shape as the closeable
    // one: a signed report and an open study.
    for (const code of ["MATCH_GATE_BLOCKED", "LOCKED_BY_OTHER", "ALREADY_FINAL", "PATIENT_UNMATCHED", null]) {
      const m = finalizeRefusalMessage({
        signed: true,
        reportId: 4412,
        reportStatusCode: code,
        reportStatusError: "Resolve it in Match Center before finalizing.",
      });
      expect(m.canConfirmUnlinked, `code ${String(code)}`).toBe(false);
    }
  });

  it("P5 branches on the machine code, never on the server's sentence", () => {
    // Three routes each hold their own copy of the refusal text, and the internal
    // one's wording has already changed once in this branch. A button keyed to a
    // substring would silently disappear — or worse, appear on the wrong refusal.
    const looksUnlinkedButNoCode = finalizeRefusalMessage({
      signed: true,
      reportId: 4412,
      reportStatusCode: null,
      reportStatusError: "No images are linked to this billed examination. One explicit confirmation is required.",
    });
    expect(looksUnlinkedButNoCode.canConfirmUnlinked).toBe(false);

    // And the sentence is still shown where it exists: the code decides the action,
    // the prose stays the explanation.
    expect(looksUnlinkedButNoCode.description).toContain("No images are linked to this billed examination.");
  });
});

describe("unlinkedCloseMessage — what the one click did", () => {
  it("says the study closed without ever claiming it signed", () => {
    const m = unlinkedCloseMessage({ closed: true, alreadyClosed: false, error: null });
    expect(m.title).toBe("Study closed");
    expect(m.description).toMatch(/does not sign/);
    expect(m.variant).toBe("default");
  });

  it("treats ALREADY_FINAL as the wanted state, not as a failure", () => {
    const m = unlinkedCloseMessage({ closed: false, alreadyClosed: true, error: "Worklist already finalized." });
    expect(m.title).toMatch(/already closed/i);
    expect(m.variant).toBe("default");
  });

  it("does not read a lost answer as a refusal to retry", () => {
    // "Refused, try again" over a write that may have landed is how a study ends up
    // with two close attempts and no way to tell which one worked.
    const m = unlinkedCloseMessage({ closed: false, alreadyClosed: false, error: "Server not responding", unanswered: true });
    expect(m.title).toMatch(/check before/i);
    expect(m.description).not.toMatch(/refused again/);
    expect(m.variant).toBe("destructive");
  });

  it("keeps the signed report true and the study open on a fresh refusal", () => {
    const m = unlinkedCloseMessage({ closed: false, alreadyClosed: false, error: "Match Center identity is unresolved." });
    expect(m.title).toMatch(/still NOT closed/i);
    expect(m.description).toContain("Match Center identity is unresolved.");
    expect(m.description).toMatch(/no second report/i);
  });
});
