import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compactAccordionSummary,
  CONSTRAINED_REPORTING_VIEWPORT_MAX_PX,
  CONTINUOUS_PRIMARY_MIN_HEIGHT_PX,
  CONTINUOUS_PRIMARY_MIN_WIDTH_PX,
  autoFocusPersistsByModeSizes,
  clearPaneManualOverride,
  EMBEDDED_VIEWER_TESTID,
  isConstrainedReportingViewport,
  isEmbeddedViewerFrame,
  isTypingEpisodeActive,
  layoutModeForPaneBias,
  markPaneManualOverride,
  outerPanelPercents,
  REPORTING_FOCUS_VIEWER_SHARE,
  shouldApplyAutomaticPaneFocus,
  shouldHandBackUnpromptedViewerFocus,
  shouldIgnorePaneFocusTarget,
  shouldUseCompactAccordion,
  shouldUseContinuousPrimarySections,
  shouldUseExclusiveReportSections,
  VIEWER_FOCUS_HANDBACKS_PER_EPISODE,
  VIEWER_FOCUS_TYPING_WINDOW_MS,
  VIEWER_FOCUS_VIEWER_SHARE,
  viewerFocusHandbacksAfterKeystroke,
} from "./reportingPaneFocus";

describe("reportingPaneFocus viewport policy", () => {
  it("treats classic laptop widths as constrained, ultrawide as not", () => {
    expect(isConstrainedReportingViewport(1280)).toBe(true);
    expect(isConstrainedReportingViewport(1366)).toBe(true);
    expect(isConstrainedReportingViewport(CONSTRAINED_REPORTING_VIEWPORT_MAX_PX)).toBe(true);
    expect(isConstrainedReportingViewport(1440)).toBe(false);
    expect(isConstrainedReportingViewport(1920)).toBe(false);
  });

  it("enables exclusive + compact accordion on every clinic monitor", () => {
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1366, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "viewerFocus" }),
    ).toBe(true);
    // Ultrawide used to keep comfortable two-line rows and starve Findings.
    expect(
      shouldUseExclusiveReportSections({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseCompactAccordion({ viewportWidthPx: 1920, layoutMode: "split" }),
    ).toBe(true);
  });
});

describe("outerPanelPercents — Reporting Focus ↔ Viewer Focus", () => {
  it("A: Reporting Focus ≈ viewer 1/3, report 2/3 with queue collapsed", () => {
    const p = outerPanelPercents({ bias: "reporting", queueCollapsed: true });
    expect(p.queue).toBe(3);
    expect(p.viewer + p.report).toBe(97);
    expect(p.viewer / 97).toBeCloseTo(REPORTING_FOCUS_VIEWER_SHARE, 1);
    expect(p.report).toBeGreaterThanOrEqual(60);
    expect(p.viewer).toBeLessThanOrEqual(40);
    // Clinical laptop targets
    expect(p.report).toBeGreaterThanOrEqual(63);
    expect(p.report).toBeLessThanOrEqual(70);
  });

  it("B: Viewer Focus ≈ viewer 2/3, report 1/3", () => {
    const p = outerPanelPercents({ bias: "viewer", queueCollapsed: true });
    expect(p.viewer / 97).toBeCloseTo(VIEWER_FOCUS_VIEWER_SHARE, 1);
    expect(p.viewer).toBeGreaterThanOrEqual(60);
    expect(p.report).toBeLessThanOrEqual(40);
  });

  it("C: Impression after Findings — same reporting bias targets (section state separate)", () => {
    const findings = outerPanelPercents({ bias: "reporting", queueCollapsed: true });
    const impression = outerPanelPercents({ bias: "reporting", queueCollapsed: true });
    expect(impression).toEqual(findings);
  });

  it("maps bias onto existing layout modes", () => {
    expect(layoutModeForPaneBias("reporting")).toBe("split");
    expect(layoutModeForPaneBias("viewer")).toBe("viewerFocus");
  });

  it("softens extremes on very narrow viewports", () => {
    const p = outerPanelPercents({ bias: "reporting", queueCollapsed: true, narrow: true });
    expect(p.viewer).toBeGreaterThan(35);
    expect(p.report).toBeLessThan(65);
  });

  it("phone viewports give OHIF nearly the full band", () => {
    const viewer = outerPanelPercents({ bias: "viewer", queueCollapsed: true, phone: true });
    expect(viewer.viewer).toBeGreaterThanOrEqual(80);
    expect(viewer.report).toBeLessThanOrEqual(15);
    const reporting = outerPanelPercents({ bias: "reporting", queueCollapsed: true, phone: true });
    expect(reporting.viewer).toBeGreaterThanOrEqual(65);
  });
});

describe("viewerOverlayShellClass", () => {
  it("uses edge-to-edge overlay on phone", async () => {
    const { viewerOverlayShellClass } = await import("./reportingPaneFocus");
    expect(viewerOverlayShellClass({ expanded: false, phone: true })).toContain("relative");
    expect(viewerOverlayShellClass({ expanded: true, phone: true })).toContain("inset-0");
    expect(viewerOverlayShellClass({ expanded: true, phone: false })).toContain("inset-4");
  });
});

describe("compactAccordionSummary", () => {
  it("keeps clinical text but shortens bulky secondary lines", () => {
    expect(compactAccordionSummary("Kapil Mandal • 48 Yrs/M • P-06186", 36)).toMatch(
      /Kapil Mandal/,
    );
    expect(compactAccordionSummary("Dr. Rakesh Kumar Tridev Hospital", 28).endsWith("…")).toBe(
      true,
    );
  });
});

describe("shouldIgnorePaneFocusTarget", () => {
  it("is a no-op without DOM Element", () => {
    expect(shouldIgnorePaneFocusTarget(null)).toBe(false);
  });
});

describe("transient auto-focus vs manual byMode memory", () => {
  it("automatic focus must not persist byMode viewer/report sizes", () => {
    expect(autoFocusPersistsByModeSizes()).toBe(false);
  });

  it("manual drag sets a session override that survives far beyond 2.5s", () => {
    let override = markPaneManualOverride({}, "split");
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "split",
        manualOverride: override,
      }),
    ).toBe(false);
    // Still blocked after a long pause — not a 2500ms timer.
    override = markPaneManualOverride(override, "split");
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "split",
        manualOverride: override,
      }),
    ).toBe(false);
  });

  it("explicit mode reset/change re-enables automatic focus for that mode", () => {
    let override = markPaneManualOverride({}, "split");
    override = markPaneManualOverride(override, "viewerFocus");
    override = clearPaneManualOverride(override, "split");
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "split",
        manualOverride: override,
      }),
    ).toBe(true);
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: true,
        mode: "viewerFocus",
        manualOverride: override,
      }),
    ).toBe(false);
  });

  it("wide desktop never auto-snaps even without override", () => {
    expect(
      shouldApplyAutomaticPaneFocus({
        constrained: false,
        mode: "split",
        manualOverride: {},
      }),
    ).toBe(false);
  });
});

describe("continuous primary sections — the wide-desktop Findings+Impression cockpit", () => {
  // FEW-CLICKS (pass 2): with Findings and Impression both open, the
  // Findings→Impression transition costs zero clicks on screens that can
  // genuinely seat both editors. The accordion's `continuous` prop existed
  // for exactly this ("wide desktop Findings+Impression cockpit") but was
  // never wired. Gates: a viewport wide enough to spare the report column
  // beside the viewer, tall enough to seat two editors, and a layout that
  // still gives the report column real width (viewerFocus starves it).
  it("wide and tall desktops get the cockpit, laptops and viewer-focus do not", () => {
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1920, viewportHeightPx: 1080, layoutMode: "split" }),
    ).toBe(true);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 2560, viewportHeightPx: 1440, layoutMode: "reportFocus" }),
    ).toBe(true);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1920, viewportHeightPx: 1080, layoutMode: "viewerFocus" }),
    ).toBe(false);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1366, viewportHeightPx: 900, layoutMode: "split" }),
    ).toBe(false);
    expect(
      shouldUseContinuousPrimarySections({ viewportWidthPx: 1920, viewportHeightPx: 700, layoutMode: "split" }),
    ).toBe(false);
  });

  it("the thresholds are named, and the width gate is the 2xl breakpoint", () => {
    expect(CONTINUOUS_PRIMARY_MIN_WIDTH_PX).toBe(1536);
    expect(CONTINUOUS_PRIMARY_MIN_HEIGHT_PX).toBe(800);
  });
});

describe("unprompted viewer focus is handed back to the editor (P4)", () => {
  const editor = { connected: true };
  const budget = VIEWER_FOCUS_HANDBACKS_PER_EPISODE;

  it("returns a focus the frame took while the radiologist was still typing", () => {
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: true, editor, handbacksLeft: budget,
    })).toBe(true);
  });

  it("leaves the pane switch alone when he had stopped typing before clicking into the viewer", () => {
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: false, editor, handbacksLeft: budget,
    })).toBe(false);
  });

  it("has nothing to hand back to when no field held the caret, or when it left the document", () => {
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: true, editor: null, handbacksLeft: budget,
    })).toBe(false);
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: true, editor: { connected: false }, handbacksLeft: budget,
    })).toBe(false);
  });

  it("stops after the episode budget, so a frame that insists on focusing itself cannot fight the caret", () => {
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: true, editor, handbacksLeft: 1,
    })).toBe(true);
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: true, editor, handbacksLeft: 0,
    })).toBe(false);
    expect(VIEWER_FOCUS_HANDBACKS_PER_EPISODE).toBe(3);
  });

  it("names the typing window the caller measures against", () => {
    expect(VIEWER_FOCUS_TYPING_WINDOW_MS).toBe(400);
  });
});

/**
 * THE SECOND HALF OF P4 — the steal the events never showed.
 *
 * MEASURED 2026-11-07 (tmp/bs2-p4-focuslog.cjs 7 60 2000 mid, six runs on a clean
 * synthetic study 7; the OHIF document response held 2 s so the frame boots while
 * the string is typed). Three of six runs lost the rest of the sentence:
 *
 *   run 3: kept 74/100, focus ended IFRAME#ohif-embed
 *   run 4: kept 65/100, focus ended IFRAME#ohif-embed
 *   run 6: kept 66/100, focus ended IFRAME#ohif-embed
 *
 * The failing trace (tmp/p4t-FAIL.txt) shows the frame re-asserting its viewport
 * about every 35 ms — the hand-back works, and the frame takes focus again:
 *
 *   6866ms TEXTAREA -> IFRAME   6875ms IFRAME -> TEXTAREA (hand-back #1)
 *   6911ms TEXTAREA -> IFRAME   …and the parent document then reports NOTHING:
 *   no focusout, no window blur, so no decide and no give-up. The third steal is
 *   invisible, 34 characters go into the viewer, and the draft saves 66.
 *
 * So the detection cannot be keyed on the editor losing focus. Chromium delivers no
 * parent-side event when a cross-origin iframe re-asserts focus milliseconds after
 * it was itself refocused, and a rule that waits for one will miss exactly the case
 * that costs text. What is always observable is `document.activeElement`, so the
 * watcher has to read it while the radiologist is typing — a caret guard, running
 * for the length of the typing episode rather than 300 ms after one focusout.
 *
 * Two consequences need their own rules, because they are the two ways a guard like
 * this goes wrong:
 *   1. it must stop. `isTypingEpisodeActive` is the single clock: while it holds the
 *      guard runs and a steal is answered; when it lapses the guard tears itself down
 *      and a deliberate click into the viewer is once again just a pane switch.
 *   2. its budget must count consecutive unanswered steals, not steals per session.
 *      Measured here, ONE sentence needed three hand-backs, so a session-wide budget
 *      of three is exhausted by the second steal of the next sentence and the report
 *      silently loses the rest of it. A keystroke that reached the field proves the
 *      previous hand-back worked, which makes the next steal a new episode.
 */
describe("the caret guard answers a steal no event reported (P4)", () => {
  it("is live while the keystrokes are arriving and lapses after the window", () => {
    expect(isTypingEpisodeActive({ msSinceLastKeystroke: 0 })).toBe(true);
    expect(isTypingEpisodeActive({ msSinceLastKeystroke: VIEWER_FOCUS_TYPING_WINDOW_MS - 1 })).toBe(true);
    expect(isTypingEpisodeActive({ msSinceLastKeystroke: VIEWER_FOCUS_TYPING_WINDOW_MS })).toBe(false);
    expect(isTypingEpisodeActive({ msSinceLastKeystroke: 5_000 })).toBe(false);
  });

  it("restores the budget when a keystroke reached the field, because that hand-back worked", () => {
    expect(viewerFocusHandbacksAfterKeystroke({
      handbacksLeft: 1, keystrokeReachedEditor: true,
    })).toBe(VIEWER_FOCUS_HANDBACKS_PER_EPISODE);
    // Without one, the steals were unanswered and the budget keeps draining.
    expect(viewerFocusHandbacksAfterKeystroke({
      handbacksLeft: 1, keystrokeReachedEditor: false,
    })).toBe(1);
    expect(viewerFocusHandbacksAfterKeystroke({
      handbacksLeft: 0, keystrokeReachedEditor: false,
    })).toBe(0);
  });

  it("still refuses a frame that keeps winning: the drained budget is not refilled by nothing", () => {
    // Three consecutive steals with no keystroke reaching the editor is the fight
    // the cap exists to end — it must end it, and hand the pane over.
    let handbacksLeft = VIEWER_FOCUS_HANDBACKS_PER_EPISODE;
    for (let i = 0; i < 3; i += 1) {
      expect(shouldHandBackUnpromptedViewerFocus({
        wasTyping: true, editor: { connected: true }, handbacksLeft,
      })).toBe(true);
      handbacksLeft = viewerFocusHandbacksAfterKeystroke({ handbacksLeft, keystrokeReachedEditor: false }) - 1;
    }
    expect(handbacksLeft).toBe(0);
    expect(shouldHandBackUnpromptedViewerFocus({
      wasTyping: true, editor: { connected: true }, handbacksLeft,
    })).toBe(false);
  });
});

describe("the guard is wired, not just named", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../hooks/radiology-workspace/useWorkspaceLayout.ts", import.meta.url)), "utf8",
  );

  it("reads activeElement on a caret guard armed by keystrokes", () => {
    expect(src).toContain("isTypingEpisodeActive(");
    expect(src).toContain("viewerFocusHandbacksAfterKeystroke(");
    expect(src).toContain("viewerFrameHoldsFocus()");
  });

  it("no longer bets the sentence on one focusout and a 300 ms wait", () => {
    // The measured failure is an unanswered steal that produced no event at all, so
    // an event-triggered poll with a fixed give-up must not come back as the only
    // detector. (A guard that stops when typing stops is the bound now.)
    expect(src).not.toMatch(/performance\.now\(\) - startedAt >= 300/);
    expect(src).not.toMatch(/let handbacksLeft = VIEWER_FOCUS_HANDBACKS_PER_EPISODE;\n    let watch/);
  });

  it("reclaims the caret in the task that reports the steal, not the next tick", () => {
    // A steal Chromium reports is worth acting on immediately, because the poll
    // would not look again for up to a whole interval. Pinned as wiring, not as a
    // measured gain: the paired 20-run battery on the boot race (100 characters
    // into Findings, viewer document held 2 s, burst pace) kept 19/20 runs whole
    // WITH and WITHOUT this handler, so the sentence is not what this buys.
    expect(src).toContain('document.addEventListener("focusout", onFocusOut, true);');
    expect(src).toContain('document.removeEventListener("focusout", onFocusOut, true);');
    // Gated, or every focusout in the app (clicking a toolbar button, closing a
    // dialog) would try to hand the caret back from a field nobody was typing in.
    expect(src).toContain("if (viewerFrameHoldsFocus()) handBackOrHandOver();");
  });

  it("polls faster than a dictated character arrives while he is typing", () => {
    // The event is not enough on its own: the measured failure includes steals
    // that deliver no event at all, so the poll stays as the fallback. 8 ms was
    // half the gap between characters at a burst pace; the same battery counted
    // 17 steals across 20 runs at 2 ms against 25 at 8 ms, which is a direction
    // and not a result (p=0.28 at n=20). The loop only runs for the duration of a
    // typing episode, so this is not a permanent 2 ms timer.
    expect(src).toContain("window.setInterval(tick, 2)");
    expect(src).not.toContain("window.setInterval(tick, 8)");
  });

  it("survives a layout change, because enterViewerPaneFocus rebuilds itself", () => {
    // The guard's state lives in a ref and the listeners bind on mount: rebuilding
    // the effect on `enterViewerPaneFocus` — whose identity changes when the layout
    // mode changes, including by its own call — reset `lastKeyAt` to 0 mid-sentence,
    // which made `wasTyping` false for a radiologist who was still typing, so the
    // steal went unanswered and 33 characters were lost (measured 2026-11-07).
    expect(src).toContain("const caretGuardRef = useRef<");
    expect(src).toContain("paneFocusFnRef.current()");
    expect(src).not.toContain("}, [enterViewerPaneFocus]);");
    const bound = src.slice(src.indexOf('document.addEventListener("keydown", onEditorKey, true);'));
    const close = bound.indexOf("}, [");
    expect(bound.slice(close).startsWith("}, []);")).toBe(true);
  });

  it("names the frame the same way the accordion does", () => {    const chrome = readFileSync(
      fileURLToPath(new URL("../hooks/radiology-workspace/useReportSectionChrome.ts", import.meta.url)), "utf8",
    );
    // Two readers of one fact: the guard hands the caret back from the frame, and
    // the reveal rule defers while the frame holds it. If they disagreed about which
    // iframe counts, the reveal would close Findings on the very focus the guard is
    // fighting — which is what happened before the rule shared a predicate.
    expect(src).toContain("isEmbeddedViewerFrame(document.activeElement)");
    expect(src).not.toContain('"ohif-embed"');
    expect(chrome).toContain("isEmbeddedViewerFrame(");
    expect(chrome).not.toContain('"ohif-embed"');
  });
});

describe("the embedded viewer frame is one predicate", () => {
  const frame = (testid: string | null) => ({
    tagName: "IFRAME",
    getAttribute: (name: string) => (name === "data-testid" ? testid : null),
  });

  it("recognises the frame the workspace embeds", () => {
    expect(isEmbeddedViewerFrame(frame(EMBEDDED_VIEWER_TESTID))).toBe(true);
    expect(isEmbeddedViewerFrame(frame("some-other-embed"))).toBe(false);
  });

  it("does not mistake a field or nothing for the frame", () => {
    expect(isEmbeddedViewerFrame({ tagName: "TEXTAREA", getAttribute: () => EMBEDDED_VIEWER_TESTID })).toBe(false);
    expect(isEmbeddedViewerFrame(null)).toBe(false);
    expect(isEmbeddedViewerFrame(undefined)).toBe(false);
  });

  it("uses the attribute name the frame is rendered with", () => {
    const viewer = readFileSync(
      fileURLToPath(new URL("../components/EmbeddedWadoViewer.tsx", import.meta.url)), "utf8",
    );
    expect(viewer).toContain(`data-testid="${EMBEDDED_VIEWER_TESTID}"`);
  });
});

