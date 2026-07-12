import { describe, it, expect } from "vitest";
import {
  serializeReportSnapshot, isReportDirty, withQuickIdsInSnapshot,
  shouldOfferBackupRestore, restorableSelections, extractD1QuickSelections,
  toInstanceParams, deriveLifecycleBadges, canVerifyReport,
  matchWorkspaceShortcut,
  type ReportSnapshotFields,
} from "./workspaceReportState";

// Ticket M1.4 — the canonical Reporting Workspace's report-state RULES.
// Everything here is a pure function; the page wires them to React state.

const F = (over: Partial<ReportSnapshotFields> = {}): ReportSnapshotFields => ({
  clinicalHistory: "", technique: "", rawFindings: "", impression: [],
  recommendation: "", quickSelectIds: [], ...over,
});

describe("serializeReportSnapshot / isReportDirty", () => {
  it("is stable under whitespace and empty impression lines", () => {
    const a = serializeReportSnapshot(F({ clinicalHistory: " x ", impression: ["a", "", " b "] }));
    const b = serializeReportSnapshot(F({ clinicalHistory: "x", impression: ["a", "b"] }));
    expect(a).toBe(b);
  });

  it("sorts quick-select ids so insertion order never fakes a difference", () => {
    expect(serializeReportSnapshot(F({ quickSelectIds: [9, 2, 5] })))
      .toBe(serializeReportSnapshot(F({ quickSelectIds: [2, 5, 9] })));
  });

  it("null baseline: clean while empty, dirty once content exists", () => {
    expect(isReportDirty(F(), null)).toBe(false);
    expect(isReportDirty(F({ rawFindings: "No acute infarct." }), null)).toBe(true);
  });

  it("detects text, impression, and selection-only changes against a baseline", () => {
    const base = serializeReportSnapshot(F({ rawFindings: "A", quickSelectIds: [1] }));
    expect(isReportDirty(F({ rawFindings: "A", quickSelectIds: [1] }), base)).toBe(false);
    expect(isReportDirty(F({ rawFindings: "B", quickSelectIds: [1] }), base)).toBe(true);
    expect(isReportDirty(F({ rawFindings: "A", quickSelectIds: [1, 2] }), base)).toBe(true);
    expect(isReportDirty(F({ rawFindings: "A", quickSelectIds: [1], impression: ["new"] }), base)).toBe(true);
  });

  it("withQuickIdsInSnapshot folds restored ids into an existing baseline only", () => {
    expect(withQuickIdsInSnapshot(null, [1, 2])).toBeNull();
    const base = serializeReportSnapshot(F({ rawFindings: "A" }));
    const folded = withQuickIdsInSnapshot(base, [3, 1]);
    expect(folded).toBe(serializeReportSnapshot(F({ rawFindings: "A", quickSelectIds: [1, 3] })));
    expect(withQuickIdsInSnapshot("not-json", [1])).toBe("not-json");
  });
});

describe("shouldOfferBackupRestore (Phase 3 rule 7)", () => {
  const serverContent = {
    clinicalHistory: "hx", rawFindings: "findings", impression: ["imp"], recommendation: "rec",
  };

  it("never offers without a backup or without content", () => {
    expect(shouldOfferBackupRestore(null, null, null)).toBe(false);
    expect(shouldOfferBackupRestore({ at: Date.now() }, null, null)).toBe(false);
    expect(shouldOfferBackupRestore({ at: Date.now(), clinicalHistory: "  " }, null, null)).toBe(false);
  });

  it("server draft present: backup must be strictly NEWER", () => {
    const serverAt = "2026-07-10T10:00:00Z";
    const older = { at: new Date("2026-07-10T09:59:00Z").getTime(), rawFindings: "x" };
    const equal = { at: new Date(serverAt).getTime(), rawFindings: "x" };
    const newer = { at: new Date("2026-07-10T10:01:00Z").getTime(), rawFindings: "x" };
    expect(shouldOfferBackupRestore(older, serverAt, serverContent)).toBe(false);
    expect(shouldOfferBackupRestore(equal, serverAt, serverContent)).toBe(false);
    expect(shouldOfferBackupRestore(newer, serverAt, serverContent)).toBe(true);
  });

  it("legacy backup without a timestamp loses to any server draft, wins with none", () => {
    expect(shouldOfferBackupRestore({ rawFindings: "x" }, "2026-07-10T10:00:00Z", serverContent)).toBe(false);
    expect(shouldOfferBackupRestore({ rawFindings: "x" }, null, null)).toBe(true);
  });

  it("a backup that merely echoes the saved draft never nags", () => {
    const echo = {
      at: new Date("2026-07-10T10:01:00Z").getTime(),
      clinicalHistory: "hx ", rawFindings: " findings", impression: ["imp", ""], recommendation: "rec",
    };
    expect(shouldOfferBackupRestore(echo, "2026-07-10T10:00:00Z", serverContent)).toBe(false);
  });

  it("technique-only differences do not trigger the banner (technique has no server column)", () => {
    const techniqueOnly = {
      at: new Date("2026-07-10T10:01:00Z").getTime(),
      technique: "MRI protocol edited by hand",
      clinicalHistory: "hx", rawFindings: "findings", impression: ["imp"], recommendation: "rec",
    };
    expect(shouldOfferBackupRestore(techniqueOnly, "2026-07-10T10:00:00Z", serverContent)).toBe(false);
  });
});

describe("restorableSelections / extractD1QuickSelections / toInstanceParams", () => {
  it("dedupes, drops invalid ids, and sanitizes params", () => {
    const out = restorableSelections([
      { findingId: 4, structuredJson: { side: "left" } },
      { findingId: 4, structuredJson: { side: "right" } }, // dup → first wins
      { findingId: 0, structuredJson: {} },
      { findingId: -2, structuredJson: {} },
      { findingId: 2.5, structuredJson: {} },
      { findingId: 9, structuredJson: ["not", "an", "object"] },
      { findingId: 11, structuredJson: null },
    ]);
    expect(out).toEqual([
      { findingId: 4, params: { side: "left" } },
      { findingId: 9, params: {} },
      { findingId: 11, params: {} },
    ]);
  });

  it("extracts D1 extension selections from both D3 and D3.5 documents", () => {
    const d3Doc = {
      extensions: { x_care_draft: { quick_select_findings: [
        { finding_id: 4, params: { side: "left" }, source: "quickselect" },
        { finding_id: "junk" },
      ] } },
    };
    expect(extractD1QuickSelections(d3Doc)).toEqual([{ findingId: 4, structuredJson: { side: "left" } }]);

    const d35Doc = {
      extensions: { x_care_draft: { skipped_findings: [{ finding_id: 7, params: {} }] } },
    };
    expect(extractD1QuickSelections(d35Doc)).toEqual([{ findingId: 7, structuredJson: {} }]);

    expect(extractD1QuickSelections(null)).toEqual([]);
    expect(extractD1QuickSelections({})).toEqual([]);
    expect(extractD1QuickSelections({ extensions: { x_care_draft: "bad" } })).toEqual([]);
  });

  it("toInstanceParams keeps only in-vocabulary values and never fabricates", () => {
    expect(toInstanceParams({ side: "left", severity: "severe", chronicity: "acute", level: "L4-L5", value: "8" }))
      .toEqual({ side: "left", severity: "severe", chronicity: "acute", level: "L4-L5", value: "8" });
    expect(toInstanceParams({ side: "sideways", severity: 3, chronicity: null, level: 42, extra: "x" }))
      .toEqual({ side: "", severity: "", chronicity: "", level: "", value: "" });
  });
});

describe("deriveLifecycleBadges (Phase 9 — D8/D9 metadata display)", () => {
  it("no report → no badges", () => {
    expect(deriveLifecycleBadges(null)).toEqual([]);
  });

  it("superseded wins over state and shows revision info", () => {
    const badges = deriveLifecycleBadges({
      status: "verified",
      lifecycle: { state: "verified", superseded: true },
      version: { sequenceNumber: 1, totalVersions: 3, superseded: true, amendmentReason: null, latestAmendmentReason: "wrong laterality" },
    });
    expect(badges[0]).toEqual({ label: "SUPERSEDED — newer amendment exists", tone: "red" });
    expect(badges).toContainEqual({ label: "Revision 1 of 3", tone: "blue" });
    expect(badges).toContainEqual({ label: "Amendment: wrong laterality", tone: "slate" });
  });

  it("maps each lifecycle state to its badge", () => {
    expect(deriveLifecycleBadges({ lifecycle: { state: "pending_verification" } })[0])
      .toEqual({ label: "Pending verification", tone: "amber" });
    expect(deriveLifecycleBadges({ lifecycle: { state: "pending_verification", amendmentPendingVerification: true } })[0])
      .toEqual({ label: "Amendment pending verification", tone: "amber" });
    expect(deriveLifecycleBadges({ lifecycle: { state: "verified", verifiedBy: "Dr. B" } })[0])
      .toEqual({ label: "Verified by Dr. B", tone: "green" });
    expect(deriveLifecycleBadges({ lifecycle: { state: "delivered" } })[0])
      .toEqual({ label: "Delivered", tone: "green" });
    expect(deriveLifecycleBadges({ lifecycle: { state: "amendment_created" } })[0])
      .toEqual({ label: "Amendment created", tone: "amber" });
    expect(deriveLifecycleBadges({ status: "signed" })[0])
      .toEqual({ label: "signed", tone: "slate" });
  });

  it("re-delivery pending rides along", () => {
    const badges = deriveLifecycleBadges({ lifecycle: { state: "verified", recipientNotificationPending: true } });
    expect(badges).toContainEqual({ label: "Re-delivery pending", tone: "amber" });
  });
});

describe("canVerifyReport (Phase 9 — mirrors the D9 server rules, UI gating only)", () => {
  const report = { signedByName: "Dr. Signer" };

  it("requires a signed-in session", () => {
    expect(canVerifyReport(null, report).allowed).toBe(false);
    expect(canVerifyReport({ subjectName: "  " }, report).allowed).toBe(false);
  });

  it("denies typist/ai/system/bot roles regardless of permissions", () => {
    for (const role of ["typist", "ai", "system", "bot", "Typist"]) {
      const r = canVerifyReport({ subjectName: "X", role, permissions: ["/reports:verify"] }, report);
      expect(r).toEqual({ allowed: false, reason: "role cannot verify" });
    }
  });

  it("grants via admin/super_admin or /reports:verify or /reports:sign", () => {
    expect(canVerifyReport({ subjectName: "X", role: "admin", permissions: [] }, report).allowed).toBe(true);
    expect(canVerifyReport({ subjectName: "X", role: "radiologist", permissions: ["/reports:verify"] }, report).allowed).toBe(true);
    expect(canVerifyReport({ subjectName: "X", role: "radiologist", permissions: ["/reports:sign"] }, report).allowed).toBe(true);
    expect(canVerifyReport({ subjectName: "X", role: "radiologist", permissions: ["/orders"] }, report))
      .toEqual({ allowed: false, reason: "missing verify permission" });
  });

  it("verifier must differ from signer (case-insensitive)", () => {
    const r = canVerifyReport({ subjectName: "dr. signer", role: "admin", permissions: [] }, report);
    expect(r).toEqual({ allowed: false, reason: "verifier must differ from signer" });
    expect(canVerifyReport({ subjectName: "Dr. Other", role: "admin", permissions: [] }, report).allowed).toBe(true);
    // no recorded signer → cannot conflict
    expect(canVerifyReport({ subjectName: "Dr. Other", role: "admin", permissions: [] }, { signedByName: null }).allowed).toBe(true);
  });
});

describe("matchWorkspaceShortcut (Phase 11)", () => {
  it("Ctrl+S / Cmd+S → save; Ctrl+Enter → finalize; Ctrl+K → quickselect; Alt+O → open study; Escape", () => {
    expect(matchWorkspaceShortcut({ key: "s", ctrlKey: true })).toBe("save");
    expect(matchWorkspaceShortcut({ key: "S", metaKey: true })).toBe("save");
    expect(matchWorkspaceShortcut({ key: "Enter", ctrlKey: true })).toBe("finalize");
    expect(matchWorkspaceShortcut({ key: "k", ctrlKey: true })).toBe("quickselect");
    expect(matchWorkspaceShortcut({ key: "o", altKey: true })).toBe("open-study");
    expect(matchWorkspaceShortcut({ key: "Escape" })).toBe("escape");
  });

  it("'/' focuses quick-select only OUTSIDE text fields", () => {
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "DIV" } })).toBe("quickselect");
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "input" } })).toBeNull();
  });

  it("plain typing never matches", () => {
    expect(matchWorkspaceShortcut({ key: "s" })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "Enter" })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "k", altKey: true })).toBeNull();
  });

  it("M1.5: Ctrl+Shift+N/P/K → next / previous / park", () => {
    expect(matchWorkspaceShortcut({ key: "N", ctrlKey: true, shiftKey: true })).toBe("next-study");
    expect(matchWorkspaceShortcut({ key: "P", metaKey: true, shiftKey: true })).toBe("previous-study");
    expect(matchWorkspaceShortcut({ key: "K", ctrlKey: true, shiftKey: true })).toBe("park-study");
  });

  it("M1.5: shift-combos never fall through to the plain combos (and vice versa)", () => {
    // Ctrl+Shift+K must NOT be quickselect; plain Ctrl+K must NOT be park.
    expect(matchWorkspaceShortcut({ key: "k", ctrlKey: true, shiftKey: true })).toBe("park-study");
    expect(matchWorkspaceShortcut({ key: "k", ctrlKey: true, shiftKey: false })).toBe("quickselect");
    // Ctrl+Shift+S (browser screenshot on some platforms) must not save.
    expect(matchWorkspaceShortcut({ key: "s", ctrlKey: true, shiftKey: true })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "Enter", ctrlKey: true, shiftKey: true })).toBeNull();
    // Ctrl+Alt+O (AltGr on some layouts) must not hijack typing.
    expect(matchWorkspaceShortcut({ key: "o", altKey: true, ctrlKey: true })).toBeNull();
  });
});
