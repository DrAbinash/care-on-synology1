/**
 * The signed-artifact trust model, executed rather than read.
 *
 * These are the rules that decide whether an ordinary update may touch a
 * signed report, who the signer of record is, and whether a relayed instant can
 * become the signing time. Every one of them is a pure function of the stored
 * row and the request payload, so this file needs no database, no session and
 * no Express — which is exactly why the behaviour lives here rather than inline
 * in the route, where a source-text grep could only prove the words exist.
 *
 * Each block is mapped to the Phase 5 case it discharges.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RELAYED_FUTURE_SKEW_MS,
  MAX_RELAYED_PERSON_NAME,
  PROTECTED_SIGNED_FIELDS,
  SIGNED_REPORT_STATUSES,
  boundRelayedPersonName,
  authorizeSignatureBlock,
  classifySignedReportPatch,
  isSignedArtifact,
  resolveRelayedInstant,
  resolveSignerIdentity,
} from "./signedArtifactGuard";

// ── isSignedArtifact: three independent witnesses ───────────────────────────

describe("isSignedArtifact — what counts as a signed medico-legal artifact", () => {
  it("an unsigned draft is not signed (Phase 5 #1, #13: drafts stay editable)", () => {
    expect(isSignedArtifact({ status: "draft", signedAt: null, structuredJson: null })).toBe(false);
  });

  it.each([...SIGNED_REPORT_STATUSES])("status %s is signed on its own", (status) => {
    expect(isSignedArtifact({ status, signedAt: null, structuredJson: null })).toBe(true);
  });

  it("signedAt alone is a sufficient witness, even at status draft", () => {
    // The D5 structured path stamps signedByName/signedAt while leaving the
    // schema-default status "draft". Status-only detection cannot see this row,
    // which is precisely how a signed report stayed editable in place.
    expect(isSignedArtifact({ status: "draft", signedAt: new Date("2026-10-03T09:00:00Z") })).toBe(true);
  });

  it("a signed-FINAL structured document alone is a sufficient witness", () => {
    const doc = { document_id: "D1", audit: { signature: { state: "final" } } };
    expect(isSignedArtifact({ status: "draft", signedAt: null, structuredJson: doc })).toBe(true);
  });

  it("a structured document that is NOT final does not make the row signed", () => {
    for (const state of ["draft", "preliminary", "amended", undefined]) {
      expect(
        isSignedArtifact({ status: "draft", signedAt: null, structuredJson: { audit: { signature: { state } } } }),
        `state=${state}`,
      ).toBe(false);
    }
  });

  it("a malformed or absent structuredJson never throws and never fakes a signature", () => {
    for (const structuredJson of [null, undefined, "not an object", 42, [], {}, { audit: null }, { audit: {} }]) {
      expect(() => isSignedArtifact({ structuredJson }), JSON.stringify(structuredJson)).not.toThrow();
      expect(isSignedArtifact({ status: "draft", signedAt: null, structuredJson })).toBe(false);
    }
  });
});

// ── classifySignedReportPatch: immutability of signed content ───────────────

describe("classifySignedReportPatch — signed content is immutable (Phase 5 #3)", () => {
  const signed = true;

  it.each([...PROTECTED_SIGNED_FIELDS])("refuses to overwrite a signed report's %s", (field) => {
    const d = classifySignedReportPatch({ signed, body: { [field]: "changed" } });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.code).toBe("signed_report_immutable");
      expect(d.fields).toEqual([field]);
      // This line used to read `expect(d.message).toContain("Amend")`, which
      // made the defect unfixable by accident: it failed anyone who stopped
      // offering a correction path that does not exist. Inverted, not deleted —
      // the message still has to name a way back, and the test below says which.
      expect(d.message).not.toContain("Amend");
    }
  });

  it("names a correction path that exists for an ordinary signed report", () => {
    // POST /:id/amend answers 409 not_a_signed_structured_report for any row
    // without a signed structured document, and has no ERP caller at all — the
    // Report Hub has a read side for amendment chains but no way to start one.
    // classifySignedReportPatch is handed `signed` and `body` only, so it cannot
    // tell a structured-signed row from the legacy-signed majority; naming Amend
    // therefore sends most radiologists to a door that shuts on them. Withdrawal
    // is the path that exists, and since #847 it reopens the study for real.
    const d = classifySignedReportPatch({ signed, body: { impression: "changed" } });
    expect(d.allow).toBe(false);
    if (d.allow) return;
    // The snapshot. The assertions below it are the invariants, and they are
    // stated even though the snapshot implies them: whoever re-words this
    // sentence will paste their own string in here to make it pass, and it is
    // these that stop the re-wording quietly dropping the place, the permission
    // or the exception.
    expect(d.message).toBe(
      "A signed report cannot be edited in place. To correct it, withdraw the signature from Report Hub — only the signer or an administrator can. A verified or delivered report cannot be withdrawn.",
    );
    // Under #855's measured eight-second reading budget, which is the ceiling
    // every other signed refusal in the app is held to.
    expect(d.message.length).toBeLessThanOrEqual(191);
    // It must say where, and who, or the radiologist is left hunting.
    expect(d.message).toContain("Report Hub");
    expect(d.message).toContain("only the signer or an administrator can");
    // And it must not promise withdrawal for the rows the withdrawal route
    // itself refuses — `already_verified` before its transaction,
    // `already_delivered` inside it.
    expect(d.message).toContain("A verified or delivered report cannot be withdrawn.");
  });

  it("refuses several protected fields at once and names all of them", () => {
    const d = classifySignedReportPatch({
      signed,
      body: { body: "new", impression: "new", title: "new" },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.fields).toEqual(["body", "title", "impression"]);
  });

  it("a field present but set to its existing value is still refused", () => {
    // Immutability is about the write, not about whether the bytes differ: a
    // PATCH that "re-saves" the same body is indistinguishable from an attempt
    // in the request, and allowing it would reopen the hole for any caller that
    // round-trips the stored value.
    const d = classifySignedReportPatch({ signed, body: { body: "" } });
    expect(d.allow).toBe(false);
  });

  it("allows non-clinical metadata on a signed report (Phase 5 #2: workflow unchanged)", () => {
    const d = classifySignedReportPatch({
      signed,
      body: { publicToken: "abc", deliveredAt: "2026-10-03T00:00:00Z", isCritical: true },
    });
    expect(d.allow).toBe(true);
  });

  it("an empty PATCH body is allowed — nothing is being changed", () => {
    expect(classifySignedReportPatch({ signed, body: {} }).allow).toBe(true);
  });

  it("every protected field is editable on an unsigned draft (Phase 5 #1)", () => {
    const d = classifySignedReportPatch({
      signed: false,
      body: { body: "b", parameters: "[]", title: "t", impression: "i" },
    });
    expect(d.allow).toBe(true);
  });

  it("a field explicitly set to undefined is not treated as a change", () => {
    expect(classifySignedReportPatch({ signed, body: { body: undefined } }).allow).toBe(true);
  });

  it("null IS a change — nulling the body would erase the signed content", () => {
    expect(classifySignedReportPatch({ signed, body: { body: null } }).allow).toBe(false);
  });
});

// ── classifySignedReportPatch: critical-result state ────────────────────────

describe("classifySignedReportPatch — critical state cannot be cleared (Phase 5 #5)", () => {
  const acknowledged = new Date("2026-10-03T09:00:00Z");

  it("clearing the flag on a signed report is refused", () => {
    const d = classifySignedReportPatch({ signed: true, body: { isCritical: false } });
    expect(d.allow).toBe(false);
    if (!d.allow) {
      expect(d.code).toBe("critical_state_immutable");
      expect(d.fields).toEqual(["isCritical"]);
    }
  });

  it("clearing the flag on an ACKNOWLEDGED draft is refused too", () => {
    // The acknowledgement is a fact about the world — somebody was told about a
    // life-threatening finding — not a property of the report's lifecycle stage.
    // Gating only on `signed` would let an acknowledged draft be un-criticalled.
    const d = classifySignedReportPatch({
      signed: false,
      criticalAcknowledgedAt: acknowledged,
      body: { isCritical: false },
    });
    expect(d.allow).toBe(false);
  });

  it("nulling the note after acknowledgement is refused", () => {
    const d = classifySignedReportPatch({
      signed: false,
      criticalAcknowledgedAt: acknowledged,
      body: { criticalNote: null },
    });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.fields).toEqual(["criticalNote"]);
  });

  it("blanking the note to an empty or whitespace string is refused", () => {
    for (const criticalNote of ["", "   ", "\n\t "]) {
      const d = classifySignedReportPatch({
        signed: false,
        criticalAcknowledgedAt: acknowledged,
        body: { criticalNote },
      });
      expect(d.allow, JSON.stringify(criticalNote)).toBe(false);
    }
  });

  it("escalating TO critical is always allowed, including on a signed report", () => {
    // This direction adds a safety obligation rather than removing one, so
    // refusing it would be the dangerous choice.
    expect(classifySignedReportPatch({ signed: true, body: { isCritical: true } }).allow).toBe(true);
    expect(
      classifySignedReportPatch({
        signed: true,
        criticalAcknowledgedAt: acknowledged,
        body: { isCritical: true, criticalNote: "Informed Dr. Mehta at 09:05" },
      }).allow,
    ).toBe(true);
  });

  it("clearing the flag on an unsigned, never-acknowledged report is allowed", () => {
    // A draft marked critical in error must be correctable; there is no
    // acknowledgement record to protect yet.
    expect(
      classifySignedReportPatch({ signed: false, criticalAcknowledgedAt: null, body: { isCritical: false } }).allow,
    ).toBe(true);
  });

  it("editing the note's CONTENT after acknowledgement is allowed — only clearing is refused", () => {
    const d = classifySignedReportPatch({
      signed: false,
      criticalAcknowledgedAt: acknowledged,
      body: { criticalNote: "Corrected the clinician's contact time." },
    });
    expect(d.allow).toBe(true);
  });

  it("a string criticalAcknowledgedAt is treated as acknowledged", () => {
    const d = classifySignedReportPatch({
      signed: false,
      criticalAcknowledgedAt: "2026-10-03T09:00:00Z",
      body: { isCritical: false },
    });
    expect(d.allow).toBe(false);
  });
});

// ── resolveSignerIdentity ───────────────────────────────────────────────────

describe("resolveSignerIdentity — the server names the signer (Phase 5 #6, #8)", () => {
  it("the chosen signature record's own name wins", () => {
    const r = resolveSignerIdentity({ sessionName: "Dr. Sen", signatureName: "Dr. Rao" });
    expect(r).toEqual({ name: "Dr. Rao", source: "signature_record", rejectedCallerName: null });
  });

  it("with no signature chosen, the authenticated session subject is the signer", () => {
    const r = resolveSignerIdentity({ sessionName: "Dr. Sen", signatureName: null });
    expect(r).toEqual({ name: "Dr. Sen", source: "session", rejectedCallerName: null });
  });

  it("a caller-supplied name is NEVER used, and is recorded when it differs", () => {
    const r = resolveSignerIdentity({
      sessionName: "Dr. Sen",
      signatureName: null,
      callerSuppliedName: "Dr. Somebody Else",
    });
    expect(r.name).toBe("Dr. Sen");
    expect(r.source).toBe("session");
    expect(r.rejectedCallerName).toBe("Dr. Somebody Else");
  });

  it("a caller name that happens to match the authoritative one is not recorded as rejected", () => {
    const r = resolveSignerIdentity({ sessionName: "Dr. Sen", callerSuppliedName: "Dr. Sen" });
    expect(r).toEqual({ name: "Dr. Sen", source: "session", rejectedCallerName: null });
  });

  it("the caller cannot override the signature record either", () => {
    const r = resolveSignerIdentity({
      sessionName: "Dr. Sen",
      signatureName: "Dr. Rao",
      callerSuppliedName: "Dr. Impostor",
    });
    expect(r.name).toBe("Dr. Rao");
    expect(r.rejectedCallerName).toBe("Dr. Impostor");
  });

  it("returns an empty name when no server-side identity exists, so the route can refuse", () => {
    for (const opts of [
      {},
      { sessionName: null, signatureName: null },
      { sessionName: "   ", signatureName: "" },
      { callerSuppliedName: "Dr. Only The Caller Knows" },
    ]) {
      expect(resolveSignerIdentity(opts).name, JSON.stringify(opts)).toBe("");
    }
  });

  it("surrounding whitespace is trimmed on every input", () => {
    const r = resolveSignerIdentity({ sessionName: "  Dr. Sen  ", callerSuppliedName: "  Dr. Sen  " });
    expect(r).toEqual({ name: "Dr. Sen", source: "session", rejectedCallerName: null });
  });

  it("a non-string caller value is ignored rather than coerced", () => {
    for (const callerSuppliedName of [42, {}, [], true, null]) {
      const r = resolveSignerIdentity({ sessionName: "Dr. Sen", callerSuppliedName });
      expect(r.name, String(callerSuppliedName)).toBe("Dr. Sen");
      expect(r.rejectedCallerName).toBeNull();
    }
  });
});

// ── boundRelayedPersonName ──────────────────────────────────────────────────

describe("boundRelayedPersonName — a relayed name cannot smuggle content", () => {
  it("falls back when the relay supplies nothing usable", () => {
    for (const raw of [undefined, null, "", "   ", 42, {}, []]) {
      expect(boundRelayedPersonName(raw, "Reporting Studio"), JSON.stringify(raw)).toBe("Reporting Studio");
    }
  });

  it("keeps an ordinary name unchanged", () => {
    expect(boundRelayedPersonName("Dr. Sugandha Rao", "Reporting Studio")).toBe("Dr. Sugandha Rao");
  });

  it("caps the length at the documented bound", () => {
    const long = "A".repeat(MAX_RELAYED_PERSON_NAME + 500);
    const out = boundRelayedPersonName(long, "Reporting Studio");
    expect(out).toHaveLength(MAX_RELAYED_PERSON_NAME);
  });

  it("collapses runs of whitespace, so a name cannot carry a forged layout", () => {
    expect(boundRelayedPersonName("Dr.  Rao\n\nRegistrar:\tAnyone", "Reporting Studio")).toBe(
      "Dr. Rao Registrar: Anyone",
    );
  });
});

// ── resolveRelayedInstant ───────────────────────────────────────────────────

describe("resolveRelayedInstant — a relayed signing time cannot become authoritative (Phase 5 #7)", () => {
  const now = new Date("2026-10-03T12:00:00Z");

  it("accepts a parseable past instant from the relay", () => {
    // A bridge re-pushing yesterday's finalized report is normal, and refusing
    // it would push integrations toward lying about the value instead.
    const r = resolveRelayedInstant("2026-10-02T08:00:00Z", now);
    expect(r).toEqual({ at: new Date("2026-10-02T08:00:00Z"), source: "relay", rejected: null });
  });

  it("accepts a value within clock skew of now", () => {
    const at = new Date(now.getTime() + MAX_RELAYED_FUTURE_SKEW_MS - 1000).toISOString();
    expect(resolveRelayedInstant(at, now).source).toBe("relay");
  });

  it("refuses a future-dated instant and substitutes the server clock", () => {
    // The dangerous direction: a signature dated after the event it attests to
    // post-dates its own evidence.
    const r = resolveRelayedInstant("2027-01-01T00:00:00Z", now);
    expect(r).toEqual({ at: now, source: "server", rejected: "future_dated" });
  });

  it("refuses an instant beyond the skew boundary by one millisecond", () => {
    const at = new Date(now.getTime() + MAX_RELAYED_FUTURE_SKEW_MS + 1).toISOString();
    expect(resolveRelayedInstant(at, now).rejected).toBe("future_dated");
  });

  it("substitutes the server clock for an unparseable value instead of storing Invalid Date", () => {
    // `new Date("garbage")` used to reach the driver as an Invalid Date.
    for (const raw of ["garbage", "2026-13-45T99:99:99Z", "not-a-date"]) {
      const r = resolveRelayedInstant(raw, now);
      expect(r, raw).toEqual({ at: now, source: "server", rejected: "unparseable" });
      expect(Number.isNaN(r.at.getTime())).toBe(false);
    }
  });

  it("substitutes the server clock when the relay sends nothing", () => {
    for (const raw of [undefined, null, "", "   ", 12345, {}]) {
      const r = resolveRelayedInstant(raw, now);
      expect(r, JSON.stringify(raw)).toEqual({ at: now, source: "server", rejected: "absent" });
    }
  });

  it("always yields a valid Date, whatever the relay sent", () => {
    for (const raw of [undefined, null, "", "garbage", "2099-01-01", "2026-10-02T08:00:00Z", 42, {}]) {
      const r = resolveRelayedInstant(raw, now);
      expect(r.at instanceof Date, JSON.stringify(raw)).toBe(true);
      expect(Number.isNaN(r.at.getTime()), JSON.stringify(raw)).toBe(false);
    }
  });

  it("the returned instant is never later than the server clock plus skew", () => {
    for (const raw of ["2099-01-01T00:00:00Z", new Date(now.getTime() + 1e12).toISOString()]) {
      expect(resolveRelayedInstant(raw, now).at.getTime()).toBeLessThanOrEqual(now.getTime() + MAX_RELAYED_FUTURE_SKEW_MS);
    }
  });
});

// ── authorizeSignatureBlock: whose block may authorize anything ─────────────
// A `signatureId` is a client-supplied integer. Before it can stand for a person it
// has to be live and belong to the caller; measured on the real app, posting a
// colleague's id answered 200 and printed that colleague's registration number.
describe("authorizeSignatureBlock — own block only", () => {
  const me = 5;
  const other = 6;

  it("accepts the caller's own live block", () => {
    expect(authorizeSignatureBlock({ blockUserId: me, blockIsActive: true, sessionUserId: me }))
      .toEqual({ ok: true, owned: true });
  });

  it("refuses another account's block — the mis-attribution this exists to stop", () => {
    const r = authorizeSignatureBlock({ blockUserId: other, blockIsActive: true, sessionUserId: me });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("signature_not_yours");
  });

  it("refuses any block when the session has no account id to compare against", () => {
    const r = authorizeSignatureBlock({ blockUserId: other, blockIsActive: true, sessionUserId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("signature_not_yours");
  });

  it("keeps a never-claimed block usable, but reports it as unowned so it can be audited", () => {
    expect(authorizeSignatureBlock({ blockUserId: null, blockIsActive: true, sessionUserId: me }))
      .toEqual({ ok: true, owned: false });
    expect(authorizeSignatureBlock({ blockUserId: undefined, blockIsActive: true, sessionUserId: me }))
      .toEqual({ ok: true, owned: false });
  });

  it("refuses a retired block before it ever reaches an ownership question", () => {
    const r = authorizeSignatureBlock({ blockUserId: me, blockIsActive: false, sessionUserId: me });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("signature_not_active");
  });

  it("names the recovery in both refusals — a message that ends in a dead end is not a control", () => {
    for (const [blockUserId, sessionUserId] of [[other, me], [me, me]] as const) {
      const inactive = authorizeSignatureBlock({ blockUserId, blockIsActive: false, sessionUserId });
      if (!inactive.ok) expect(inactive.message).toMatch(/active signature|sign as yourself/i);
      const notYours = authorizeSignatureBlock({ blockUserId, blockIsActive: true, sessionUserId });
      if (!notYours.ok) expect(notYours.message).toMatch(/your own block|no block at all/i);
    }
  });
});
