/**
 * Who is allowed to sign, decided from the signature records — never from a name.
 *
 * The rule this tests replaces was `/sugandha/i.test(name)` in two places on the
 * authorization pathway (`radiologyReportLifecycle.ts:314`, `FinalizeSignDialog.tsx:125`).
 * That regular expression decided which person a finalized report is recorded as signed
 * by, so the day a second radiologist joined, every study finalized without an explicit
 * choice was authorized under the first one's identity.
 *
 * The clinic today has exactly one active signature block, and every case below that
 * matches that shape ends the same way the clinic finishes today — the point of the rule
 * is that it no longer depends on who that person is called.
 */
import { describe, expect, it } from "vitest";
import { eligibleSigners, resolveSignerChoice, type SignerRow } from "./reportSignerEligibility";

function row(over: Partial<SignerRow> & { id: number; name: string }): SignerRow {
  return { role: "Radiologist", isActive: true, ...over };
}

const SUGANDHA = row({ id: 1, name: "Dr. Sugandha Priyadarshini" });
const MEOERA = row({ id: 2, name: "Dr. Meera Iyer" });

describe("eligibleSigners", () => {
  it("keeps the one active radiologist — the clinic exactly as it is today", () => {
    expect(eligibleSigners([SUGANDHA])).toEqual([SUGANDHA]);
  });

  it("excludes a signature block the clinic has deactivated", () => {
    // DELETE /api/signatures/:id is a soft deactivate (patient-reports.ts:1330) so old
    // reports keep their reference; a retired block must not stay signable.
    expect(eligibleSigners([SUGANDHA, row({ id: 3, name: "Dr. Retired Locum", isActive: false })]))
      .toEqual([SUGANDHA]);
  });

  it("does not treat a leftover referring-doctor or pathologist block as a signing radiologist", () => {
    // The old comment on the name branch called this out: "a leftover second signature
    // (e.g. referring / neurosurgeon) must not block sign-off". Role answers it without
    // naming anybody.
    const referring = row({ id: 4, name: "Dr. Tushar Jyoti", role: "Doctor" });
    expect(eligibleSigners([SUGANDHA, referring])).toEqual([SUGANDHA]);
  });

  it("falls back to the active set when the clinic has set no Radiologist role", () => {
    // Report Hub's role dropdown opens on Pathologist and POST defaults role to "Doctor"
    // (patient-reports.ts:1293), so a correctly configured block can carry neither value.
    // Refusing to sign then would break the live clinic, so the active set is the pool.
    const unroled = [row({ id: 1, name: "Dr. One", role: null }), row({ id: 2, name: "Dr. Two", role: "Pathologist" })];
    expect(eligibleSigners(unroled)).toEqual(unroled);
  });

  it("returns nothing when the clinic has no active signature at all", () => {
    expect(eligibleSigners([row({ id: 9, name: "Dr. Off", isActive: false })])).toEqual([]);
    expect(eligibleSigners([])).toEqual([]);
  });
});

describe("resolveSignerChoice", () => {
  it("selects the only eligible signature by default", () => {
    expect(resolveSignerChoice([SUGANDHA, row({ id: 5, name: "Dr. Referring", role: "Doctor" })]))
      .toEqual({ kind: "single", signatureId: 1 });
  });

  it("refuses to choose between two radiologists — no silent authorization", () => {
    const choice = resolveSignerChoice([SUGANDHA, MEOERA]);
    // The candidates are the two radiologists, in the order the server listed them.
    expect(choice).toEqual({ kind: "choose", candidates: [SUGANDHA, MEOERA] });
  });

  it("honours an explicit choice of either radiologist", () => {
    expect(resolveSignerChoice([SUGANDHA, MEOERA], 2)).toEqual({ kind: "preferred", signatureId: 2 });
  });

  it("honours a remembered preference only while it stays eligible", () => {
    // The remembered id is browser sessionStorage (`radiology_finalize_signer_id`), so it
    // is a preference, not authority: it is checked against the active records here and
    // nowhere trusted on its own.
    expect(resolveSignerChoice([SUGANDHA, MEOERA], 1)).toEqual({ kind: "preferred", signatureId: 1 });
    const retired = row({ id: 2, name: "Dr. Meera Iyer", isActive: false });
    expect(resolveSignerChoice([SUGANDHA, retired], 2).kind).toBe("refused");
    expect(resolveSignerChoice([SUGANDHA, MEOERA], 99).kind).toBe("refused");
  });

  it("does not let a preference name a non-radiologist when the clinic has radiologists", () => {
    // Two blocks: one Radiologist, one Doctor. Default is the radiologist; a remembered
    // id pointing at the referring doctor's block is refused rather than honored, because
    // signing under it would misattribute the report to a person who did not read it.
    const referring = row({ id: 4, name: "Dr. Tushar Jyoti", role: "Doctor" });
    expect(resolveSignerChoice([SUGANDHA, referring], 4).kind).toBe("refused");
    expect(resolveSignerChoice([SUGANDHA, referring])).toEqual({ kind: "single", signatureId: 1 });
  });

  it("says none when there is nothing to sign with", () => {
    expect(resolveSignerChoice([]).kind).toBe("none");
  });

  it("requires a choice when no role is set and two blocks are active", () => {
    const a = row({ id: 1, name: "Dr. One", role: null });
    const b = row({ id: 2, name: "Dr. Two", role: null });
    expect(resolveSignerChoice([a, b]).kind).toBe("choose");
  });
});

// ── own block only: whose block the picker may offer ────────────────────────
// Measured in a browser: logged in as a doctor whose own block had been retired, the
// Report Hub Sign dialog's default was a COLLEAGUE'S block, so one click authorized the
// report under that colleague's name and registration number. The server now refuses a
// block that is not the caller's; this is what stops the UI from offering one at all.
describe("eligibleSigners with a viewer — own block only", () => {
  const MINE = row({ id: 7, name: "Dr. Mine", userId: 5 });
  const THEIRS = row({ id: 8, name: "Dr. Theirs", userId: 6 });
  const UNOWNED = row({ id: 9, name: "Dr. Legacy" });

  it("hides a colleague's block from the pool", () => {
    expect(eligibleSigners([MINE, THEIRS, UNOWNED], 5).map((r) => r.id)).toEqual([7, 9]);
  });

  it("leaves never-claimed blocks usable, so a clinic that has not bound anything keeps signing", () => {
    expect(eligibleSigners([UNOWNED], 5).map((r) => r.id)).toEqual([9]);
  });

  it("without a viewer id it changes nothing for existing callers", () => {
    expect(eligibleSigners([MINE, THEIRS, UNOWNED]).map((r) => r.id)).toEqual([7, 8, 9]);
  });

  it("auto-signs with my own single block rather than defaulting to someone else's", () => {
    // Two active Radiologist blocks, one mine. Before ownership, the pool length was
    // 2 so the dialog showed a picker whose default was `active[0]` — the colleague.
    const other = row({ id: 10, name: "Dr. Other", userId: 6 });
    expect(resolveSignerChoice([THEIRS, other, MINE], null, 5)).toEqual({ kind: "single", signatureId: 7 });
  });

  it("refuses a remembered preference that belongs to a colleague", () => {
    // `radiology_finalize_signer_id` in sessionStorage is a convenience, not authority:
    // a remembered id that is not mine must not silently sign with it.
    expect(resolveSignerChoice([MINE, THEIRS], THEIRS.id, 5)).toEqual({ kind: "refused", reason: "not-eligible" });
    expect(resolveSignerChoice([MINE, THEIRS], MINE.id, 5)).toEqual({ kind: "preferred", signatureId: MINE.id });
  });
});
