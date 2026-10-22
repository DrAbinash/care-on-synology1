import { describe, it, expect } from "vitest";
import {
  serializeReportSnapshot, isReportDirty, withQuickIdsInSnapshot,
  shouldOfferBackupRestore, normalizeImpressionLines, restorableSelections, extractD1QuickSelections,
  toInstanceParams, deriveLifecycleBadges, canVerifyReport,
  matchWorkspaceShortcut, escapeKeyOwner, rescueBackupEnvelope,
  type ReportSnapshotFields,
} from "./workspaceReportState";

// Ticket M1.4 — the canonical Reporting Workspace's report-state RULES.
// Everything here is a pure function; the page wires them to React state.

const F = (over: Partial<ReportSnapshotFields> = {}): ReportSnapshotFields => ({
  clinicalHistory: "", technique: "", rawFindings: "", impression: [],
  recommendation: "", quickSelectIds: [], ...over,
});

describe("normalizeImpressionLines", () => {
  it("accepts arrays, plain strings, and legacy JSON strings", () => {
    expect(normalizeImpressionLines([" a ", "", "b"])).toEqual(["a", "b"]);
    expect(normalizeImpressionLines("Single line")).toEqual(["Single line"]);
    expect(normalizeImpressionLines('["Line one", "Line two"]')).toEqual(["Line one", "Line two"]);
    expect(normalizeImpressionLines("")).toEqual([]);
    expect(normalizeImpressionLines(null)).toEqual([]);
  });

  it("lets serializeReportSnapshot accept a string impression (new workspace shape)", () => {
    const fromString = serializeReportSnapshot(F({ impression: "Chronic SVD." }));
    const fromArray = serializeReportSnapshot(F({ impression: ["Chronic SVD."] }));
    expect(fromString).toBe(fromArray);
  });
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

  /**
   * Reachability, not a rule change. This predicate has no notion of the lock and
   * the banner's render condition in WorkspaceOverlays adds none, so the state a
   * report signed on ANOTHER workstation produces satisfies it and the banner
   * comes up: useLocalDraftBackup's per-key localStorage read is not gated on
   * `enabled` (only its two writers are), and useStudyFinalize's `clear()` runs
   * only when signing happens in this session. Pinning the premise is what stops
   * the gate on the Restore button from reading as defence against a state that
   * cannot occur.
   */
  it("offers the banner for a stale backup on a study whose editor holds signed text", () => {
    // What hydration put into the store. WorkspaceOverlays passes these LIVE
    // store texts as serverContent — not the server draft's own columns.
    const signed = {
      clinicalHistory: "Seizure disorder.",
      rawFindings: "No acute intracranial abnormality.",
      impression: ["Normal study."],
      recommendation: "",
    };
    // Dictation from before the signature, still in this browser's localStorage.
    const stale = {
      at: new Date("2026-07-10T10:05:00Z").getTime(),
      clinicalHistory: "Seizure disorder.",
      rawFindings: "No acute intracranial abnormality. Incidental note only.",
      impression: ["Normal study."],
      recommendation: "",
    };
    // This workstation's last draft SAVE predates the backup — that gap is why
    // the backup exists at all. Signing happened elsewhere, so it never advanced
    // this row, and `serverUpdatedAt` stays the older of the two.
    const lastLocalDraftSave = "2026-07-10T10:00:00Z";
    expect(shouldOfferBackupRestore(stale, lastLocalDraftSave, signed)).toBe(true);
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

  // Priority 3 — Escape scoping (browser-demo defect, 2026-10-21). The bare
  // Escape collapses the Reporting Tools panel ONLY when nothing else owns
  // the key: an open popup layer (Radix dialogs and popovers both render
  // [role=dialog]; menus [role=menu]) wins first, then the Quick Select strip
  // whose own contract is "Escape leaves the tile rail", and only then the
  // workspace shortcut fires. One key press, one owner — the old code collapsed
  // the tools rail "along with" the very dialog the radiologist was dismissing.
  it("escapeKeyOwner: popup → strip → workspace, one key has one owner", () => {
    const popupDoc = { querySelector: (sel: string) => (sel.includes("dialog") ? {} as Element : null) };
    const emptyDoc = { querySelector: () => null };
    const stripTarget = { closest: (sel: string) => (sel.startsWith("[data-testid^=\"quick-select-strip\"") ? {} as Element : null) } as Element;
    const plainTarget = { closest: () => null } as Element;
    // A strip whose inline review panel is open — detected via the document,
    // because a mouse click on a chip never focuses it.
    const reviewDoc = {
      querySelector: (sel: string) => (sel.includes("qs-review-") ? {} as Element : null),
    };

    // 1. An open popup owns Escape — regardless of where focus sits, so the
    // ask-first confirm dialog / tile review popover is dismissed without
    // the tools rail vanishing underneath it.
    expect(escapeKeyOwner(plainTarget, popupDoc)).toBe("popup");
    // Even a target INSIDE the strip yields when a popup is open: the
    // strip's own exit handler is what the popover layer already answers.
    expect(escapeKeyOwner(stripTarget, popupDoc)).toBe("popup");
    // 2. The strip owns Escape when no popup is open — "Escape leaves the
    // tile rail (back to the search field)" must keep the panel mounted.
    expect(escapeKeyOwner(stripTarget, emptyDoc)).toBe("quick-select-strip");
    // ... and when the strip's review panel is open, focus or not: the
    // radiologist dismissing a review must not lose the rail under it.
    expect(escapeKeyOwner(plainTarget, reviewDoc)).toBe("quick-select-strip");
    // 3. Nobody else claims it — the intentional close-the-panel shortcut.
    expect(escapeKeyOwner(plainTarget, emptyDoc)).toBe("workspace");
    // SSR / non-browser callers must read "workspace", not throw.
    expect(escapeKeyOwner(plainTarget, null)).toBe("workspace");
    expect(escapeKeyOwner(null, emptyDoc)).toBe("workspace");
  });

  it("'/' focuses quick-select only OUTSIDE text fields", () => {
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "DIV" } })).toBe("quickselect");
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "/", target: { tagName: "input" } })).toBeNull();
  });

    it("plain typing never matches (except bare N/P/Q outside editors)", () => {
    expect(matchWorkspaceShortcut({ key: "s" })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "Enter" })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "k", altKey: true })).toBeNull();
  });

  it("bare N/P/Q navigate or toggle queue outside text fields", () => {
    expect(matchWorkspaceShortcut({ key: "n", target: { tagName: "DIV" } })).toBe("next-study");
    expect(matchWorkspaceShortcut({ key: "p", target: { tagName: "DIV" } })).toBe("previous-study");
    expect(matchWorkspaceShortcut({ key: "q", target: { tagName: "DIV" } })).toBe("toggle-left-panel");
    expect(matchWorkspaceShortcut({ key: "n", target: { tagName: "TEXTAREA" } })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "q", target: { tagName: "INPUT" } })).toBeNull();
  });


  it("M1.5: Ctrl+Shift+N/P/K → next / previous / park", () => {
    expect(matchWorkspaceShortcut({ key: "N", ctrlKey: true, shiftKey: true })).toBe("next-study");
    expect(matchWorkspaceShortcut({ key: "F", ctrlKey: true, shiftKey: true })).toBe("focus-mode");
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

  it("Layout redesign: Alt+[ / Alt+] / Alt+\\ toggle the panels and viewer", () => {
    expect(matchWorkspaceShortcut({ key: "[", altKey: true })).toBe("toggle-left-panel");
    expect(matchWorkspaceShortcut({ key: "]", altKey: true })).toBe("toggle-right-panel");
    expect(matchWorkspaceShortcut({ key: "\\", altKey: true })).toBe("toggle-viewer");
  });

  it("Layout redesign: panel/viewer toggles fire even while a text editor is focused (Alt combos produce no text)", () => {
    expect(matchWorkspaceShortcut({ key: "[", altKey: true, target: { tagName: "TEXTAREA" } })).toBe("toggle-left-panel");
    expect(matchWorkspaceShortcut({ key: "]", altKey: true, target: { tagName: "INPUT" } })).toBe("toggle-right-panel");
    expect(matchWorkspaceShortcut({ key: "\\", altKey: true, target: { tagName: "TEXTAREA" } })).toBe("toggle-viewer");
  });

  it("Layout redesign: the toggle keys need Alt and never fire on a plain or Ctrl-modified press", () => {
    // Bare bracket/backslash keystrokes are ordinary typing.
    expect(matchWorkspaceShortcut({ key: "[" })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "]" })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "\\" })).toBeNull();
    // Ctrl+Alt (AltGr) must not hijack them either — mod excludes the match.
    expect(matchWorkspaceShortcut({ key: "[", altKey: true, ctrlKey: true })).toBeNull();
    expect(matchWorkspaceShortcut({ key: "\\", altKey: true, metaKey: true })).toBeNull();
  });
});

// PROMPT 4 — the same twelve vectors the API server runs against its own mirror.
//
// `projectStoredImpression` in
// `artifacts/api-server/src/lib/reportComposer/composePersistence.ts` is a copy of
// `normalizeImpressionLines` above: the server computes its durability token over
// the impression the radiologist actually reads, so the two projections must be
// the same function. There is no shared module between the packages (the SPA
// cannot be imported by the API), so the agreement is pinned by running one table
// of vectors on both sides — `composePersistence.contract.test.ts` holds the
// identical list. Drift in either implementation fails both suites, naming the
// vector that drifted.
describe("the server's impression mirror is this function", () => {
  const VECTORS: Array<{ name: string; stored: string; display: string }> = [
    { name: "plain", stored: "Mild disc bulge.", display: "Mild disc bulge." },
    { name: "multi-line", stored: "Line one.\nLine two.", display: "Line one.\nLine two." },
    { name: "outer blank lines dropped, inner kept", stored: "\nLine one.\n\nLine two.\n", display: "Line one.\n\nLine two." },
    { name: "only the element edges are trimmed", stored: "  Line one.  \n  Line two.  ", display: "Line one.  \n  Line two." },
    { name: "whitespace only becomes empty", stored: "   \n  ", display: "" },
    { name: "empty stays empty", stored: "", display: "" },
    { name: "text that looks like a JSON array survives whole", stored: '["Already","an","array"]', display: '["Already","an","array"]' },
    { name: "CRLF inside the element is preserved", stored: "Line one.\r\nLine two.", display: "Line one.\r\nLine two." },
    { name: "clinic punctuation", stored: "Findings · ₹500 — L4/5.", display: "Findings · ₹500 — L4/5." },
    { name: "trailing newline trimmed", stored: "Impression.\n", display: "Impression." },
  ];

  it.each(VECTORS)("$name", ({ stored, display }) => {
    // Exactly what POST /save-draft stores for an editor holding `stored`…
    const column = JSON.stringify([stored]);
    // …and exactly what the reload puts back on screen, which is what the
    // composer's durability token has to describe.
    expect(normalizeImpressionLines(column).join("\n")).toBe(display);
  });

  // The other branch: a column that is not a JSON array. POST /save-draft always
  // writes an array, so this is what a restored or hand-written legacy row looks
  // like — and the server mirror has to read it the same way, so its six cases are
  // pinned on both sides too.
  const PLAIN_VECTORS: Array<{ name: string; stored: string; display: string }> = [
    { name: "plain text column", stored: "Plain impression text", display: "Plain impression text" },
    { name: "padded plain text", stored: "  Padded.  ", display: "Padded." },
    { name: "array-shaped but unparsable stays text", stored: '["unclosed"', display: '["unclosed"' },
    { name: "empty column", stored: "", display: "" },
    { name: "whitespace column", stored: "   ", display: "" },
    { name: "object-shaped JSON is not an array", stored: '{"a":1}', display: '{"a":1}' },
  ];

  it.each(PLAIN_VECTORS)("non-array column: $name", ({ stored, display }) => {
    expect(normalizeImpressionLines(stored).join("\n")).toBe(display);
  });
});

// ─── Structured findings cards are report content (audit §3.6) ───────────────

describe("serializeReportSnapshot / isReportDirty — findingsSections", () => {
  const CARDS = { "Lumbar Spine": { normal: true, text: "No focal lesion." } };

  it("legacy callers without cards hash byte-identically to before", () => {
    const withUndefined = F({ rawFindings: "x", findingsSections: undefined });
    const withNull = F({ rawFindings: "x", findingsSections: null });
    const omitted = F({ rawFindings: "x" });
    expect(serializeReportSnapshot(withUndefined)).toBe(serializeReportSnapshot(omitted));
    expect(serializeReportSnapshot(withNull)).toBe(serializeReportSnapshot(omitted));
  });

  it("a card-only edit changes the hash even when the prose is untouched", () => {
    const before = serializeReportSnapshot(F({ rawFindings: "No focal lesion.", findingsSections: CARDS }));
    const toggled = serializeReportSnapshot(
      F({ rawFindings: "No focal lesion.", findingsSections: { "Lumbar Spine": { normal: false, text: "L4-L5 bulge." } } }),
    );
    expect(toggled).not.toBe(before);
    // The card edit flips dirty against the saved baseline.
    expect(isReportDirty(
      F({ rawFindings: "No focal lesion.", findingsSections: { "Lumbar Spine": { normal: false, text: "L4-L5 bulge." } } }),
      before,
    )).toBe(true);
  });

  it("the hash is stable under section insertion order and value padding", () => {
    const a = serializeReportSnapshot(F({ findingsSections: { A: { normal: true, text: "x" }, B: { normal: false, text: " y " } } }));
    const b = serializeReportSnapshot(F({ findingsSections: { B: { normal: false, text: "y" }, A: { normal: true, text: "x " } } }));
    expect(a).toBe(b);
  });

  it("cards alone count as content for a never-saved report", () => {
    expect(isReportDirty(F({ findingsSections: CARDS }), null)).toBe(true);
    expect(isReportDirty(F({ findingsSections: {} }), null)).toBe(false);
  });
});

describe("rescueBackupEnvelope / shouldOfferBackupRestore — cards ride along", () => {
  const BASE_TEXTS = {
    clinicalHistoryText: "", techniqueText: "", findingsText: "rescued findings",
    impressionText: "", recommendationText: "",
  };
  const CARDS = { "Lumbar Spine": { normal: false, text: "L4-L5 disc bulge." } };

  it("a cards-only session still produces a rescue envelope", () => {
    const envelope = rescueBackupEnvelope(
      { ...BASE_TEXTS, findingsText: "", findingsSections: CARDS, useStructured: true },
      { signed: false },
    );
    expect(envelope).not.toBeNull();
    expect(envelope?.findingsSections).toEqual(CARDS);
    expect(envelope?.useStructured).toBe(true);
  });

  it("prose-only sessions keep the exact legacy envelope (no new keys)", () => {
    const envelope = rescueBackupEnvelope(BASE_TEXTS, { signed: false });
    expect(envelope).not.toBeNull();
    expect("findingsSections" in (envelope ?? {})).toBe(false);
    expect("useStructured" in (envelope ?? {})).toBe(false);
  });

  it("a card-only difference vs the server draft triggers the restore banner", () => {
    const serverAt = "2026-10-22T10:00:00Z";
    const backupAt = new Date("2026-10-22T10:01:00Z").getTime();
    // Server draft carries the same prose and the same cards → echo → no offer.
    const serverEcho = {
      clinicalHistory: "hx", rawFindings: "findings", impression: ["imp"], recommendation: "rec",
      findingsSections: CARDS as Record<string, { normal: boolean; text: string }>,
    };
    const echoBackup = {
      at: backupAt, clinicalHistory: "hx", rawFindings: "findings",
      impression: ["imp"], recommendation: "rec", findingsSections: CARDS,
    };
    expect(shouldOfferBackupRestore(echoBackup, serverAt, serverEcho)).toBe(false);

    // Same prose, one card edited after the save → offer.
    const editedCards = { "Lumbar Spine": { normal: true, text: "No focal lesion." } };
    const editedBackup = { ...echoBackup, findingsSections: editedCards };
    expect(shouldOfferBackupRestore(editedBackup, serverAt, serverEcho)).toBe(true);

    // The server column is a JSON string — parsed and compared as the same map.
    expect(shouldOfferBackupRestore(
      echoBackup,
      serverAt,
      { ...serverEcho, findingsSections: JSON.stringify(CARDS) },
    )).toBe(false);
  });

  it("a backup with cards vs a server draft without them is a visible difference", () => {
    const backupAt = new Date("2026-10-22T10:01:00Z").getTime();
    const serverAt = "2026-10-22T10:00:00Z";
    const proseOnlyServer = {
      clinicalHistory: "hx", rawFindings: "findings", impression: ["imp"], recommendation: "rec",
      findingsSections: null,
    };
    const backup = {
      at: backupAt, clinicalHistory: "hx", rawFindings: "findings",
      impression: ["imp"], recommendation: "rec", findingsSections: CARDS,
    };
    expect(shouldOfferBackupRestore(backup, serverAt, proseOnlyServer)).toBe(true);
  });

  it("a corrupt server sections column never breaks the banner decision", () => {
    const backupAt = new Date("2026-10-22T10:01:00Z").getTime();
    const serverAt = "2026-10-22T10:00:00Z";
    const backup = { at: backupAt, rawFindings: "x", clinicalHistory: "hx" };
    expect(shouldOfferBackupRestore(
      backup, serverAt,
      { clinicalHistory: "hx", rawFindings: "x", impression: [], recommendation: "", findingsSections: "{not json" },
    )).toBe(false); // prose identical, unreadable sections treated as absent
  });
});
