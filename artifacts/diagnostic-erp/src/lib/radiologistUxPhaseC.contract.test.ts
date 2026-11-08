/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase C radiologist-UX fixes, bound by source.
 *
 * The workspace has no component-rendering harness, so these bind the wiring
 * the way the codebase already does (see ReportRefinement.sourceContract.test.ts):
 * each assertion is bounded on a syntactic marker rather than a line number,
 * because the defects here were all of one shape — a surface that SAID one
 * thing while the code did another, or a state change nobody announced:
 *
 *  - U15: a FAILED/CANCELLED/OBSOLETE compose job stopped the poll in silence;
 *    the terminal branch must toast (the radiologist-visible half of B5's reaper).
 *  - U11: Ctrl+Shift+K parked the study AND opened the pen-drive pairing dialog
 *    every time; the pairing listener must yield while the workspace is mounted.
 *  - U1/B11: the macro popover applied on Enter/Tab from ANY input, so a
 *    half-filled macro wrote a literal `___` into clinical text.
 *  - U12/U13: the help overlay, Park tooltip, palette row and Quick Add hint
 *    advertised combos that do not exist (Alt+1–9 finding toggles, bare-P park,
 *    phantom Ctrl+Shift+C).
 *  - U16/U17/U19: no cancel while composing, no elapsed signal, and a
 *    "Findings now:" row that rendered the AI's proposed text.
 *  - U18: a READY draft never opened the AI tab it lives in, and the tab
 *    carried no badge.
 *  - U21/U22: review actions failed silently, had no busy state, and the
 *    refine instruction was wiped before the outcome was known.
 *  - U24: "Copy findings" replaced a non-empty field in one unconfirmed click.
 *  - U26: a stray backdrop click discarded the half-typed critical-results log.
 *  - U3/U4: tile inserts left focus on the rail; compact strips had no search.
 */
const src = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");

const hook = src("hooks", "useReportComposer.ts");
const clinicalUi = src("hooks", "radiology-workspace", "useWorkspaceClinicalUi.tsx");
const assistant = src("components", "radiology", "ReportComposerAssistant.tsx");
const panel = src("components", "radiology", "ReportingToolsPanel.tsx");
const rail = src("components", "radiology", "workspace", "ReportingToolsRail.tsx");
const overlays = src("components", "radiology", "workspace", "WorkspaceOverlays.tsx");
const topBar = src("components", "radiology", "workspace", "WorkspaceTopBar.tsx");
const layout = src("components", "Layout.tsx");
const popover = src("components", "radiology", "zai-workspace", "macro-prompt-popover.tsx");
const help = src("components", "radiology", "ReportingShortcutHelp.tsx");
const palette = src("components", "radiology", "zai-workspace", "command-palette.tsx");
const quickPanel = src("components", "radiology", "QuickFindingsPanel.tsx");
const strip = src("components", "radiology", "zai-workspace", "quick-select-strip.tsx");
const interrupt = src("components", "radiology", "zai-workspace", "interrupt-card.tsx");
const followUp = src("components", "radiology", "FollowUpPanel.tsx");
const viewTypes = src("lib", "reportComposer", "types.ts");

function countOf(s: string, needle: string): number {
  return s.split(needle).length - 1;
}

describe("the composer loop cannot go dark (U15/U16/U17/U18/U19)", () => {
  it("toasts every terminal status the poll can stop on", () => {
    // The terminal list and the toast branches must cover the same statuses.
    expect(hook).toContain('"FAILED", "APPLIED", "DISCARDED", "CANCELLED", "OBSOLETE"');
    expect(hook).toContain('title: "AI composition failed"');
    expect(hook).toContain('title: "AI compose cancelled"');
    expect(hook).toContain('title: "AI draft obsolete"');
    // The failure toast must say the report was untouched and where to retry.
    expect(hook).toContain("Nothing was written to the report. Open the AI tab to retry.");
  });

  it("exposes a cancel door onto the server's own discard path, and stops the poll first", () => {
    const body = hook.slice(hook.indexOf("const cancelCompose"), hook.indexOf("const regenerate"));
    expect(body).toContain('["QUEUED", "COMPOSING"].includes(job.status)');
    expect(body.indexOf("stopPoll()")).toBeLessThan(body.indexOf("reportComposerApi.discard"));
    expect(body).toContain('toast({ title: "AI compose cancelled"');
    expect(hook).toContain("cancelCompose,");
  });

  it("shows an elapsed ticker and a Cancel control while a job is live", () => {
    expect(assistant).toContain("data-testid=\"ai-compose-elapsed\"");
    expect(assistant).toContain("data-testid=\"ai-compose-cancel\"");
    expect(assistant).toContain('job.startedAt ?? job.createdAt');
  });

  it("carries startedAt on the client view (the server already returns it)", () => {
    expect(viewTypes).toContain("startedAt: string | null;");
  });

  it("labels the zero-tracked-changes fallback honestly", () => {
    expect(assistant).toContain("AI proposed findings:");
    expect(assistant).toContain("AI proposed impression:");
    expect(assistant).not.toContain("Findings now:");
    expect(assistant).not.toContain("CURRENT vs AI PROPOSED");
  });

  it("opens the AI tab when a draft lands READY, and badges the tab while one waits", () => {
    expect(hook).toContain("onJobReady?: () => void;");
    expect(clinicalUi).toContain('onJobReady: () => openReportingToolsRef.current("ai")');
    expect(panel).toContain("tabBadge?: Partial<Record<ReportingToolsTab, number>>;");
    expect(panel).toContain("reporting-tools-tab-badge-");
    expect(rail).toContain("tabBadge={{");
    expect(rail).toContain("reportComposer.pendingCount");
  });
});

describe("review actions are not silent and not frozen (U21/U22)", () => {
  it("toasts when the server refuses an accept or reject", () => {
    expect(hook).toContain("reviewActionFailed");
    expect(hook).toContain('title: `${what} failed`');
  });

  it("disables the review action bar while a bulk action is in flight", () => {
    expect(assistant).toContain("reviewBusy?: boolean;");
    expect(assistant.match(/disabled=\{props\.reviewBusy \|\| props\.isFinalized\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps the typed refine instruction until the job is real, in both boxes", () => {
    expect(countOf(rail, "reportComposer.refineReport(instr).then")).toBe(1);
    expect(countOf(overlays, "reportComposer.refineReport(instr).then")).toBe(1);
    expect(rail).toContain('if (jobId != null) setMicroInstruction("")');
    expect(overlays).toContain('if (jobId != null) setMicroInstruction("")');
  });
});

describe("the keyboard map tells the truth (U11/U12/U13)", () => {
  it("the pairing combo yields to the workspace's park-study binding", () => {
    const body = layout.slice(
      layout.indexOf("Hidden pairing trigger: Ctrl+Shift+K."),
      layout.indexOf("const onPairFs"),
    );
    expect(body).toContain("if (workspaceFocusActiveRef.current) return;");
    // The guard must run BEFORE preventDefault takes the gesture for pairing.
    expect(body.indexOf("workspaceFocusActiveRef.current")).toBeLessThan(
      body.indexOf("e.preventDefault()"),
    );
    // And the old lying comment is gone.
    expect(layout).not.toContain("Capture so radiology park-study (also Ctrl+Shift+K) does not win first.");
  });

  it("the help overlay rows match the dispatcher", () => {
    expect(help).toContain('"Jump to the Nth report section"');
    expect(help).toContain('"Open Reporting Tools on the Templates tab"');
    expect(help).not.toContain("Toggle Nth finding");
    // Previously-omitted live bindings.
    expect(help).toContain('"Generate AI impression"');
    expect(help).toContain('"Undo last abnormal insert"');
    expect(help).toContain('"Focus voice bar / toggle dictation"');
    expect(help).toContain('"Toggle the reading queue"');
  });

  it("Park is labelled with the combo that actually parks", () => {
    expect(topBar).toContain('title="Park (Ctrl+Shift+K)"');
    expect(topBar).not.toContain('title="Park (P)"');
    expect(palette).toContain('shortcut: "Ctrl+Shift+K"');
    expect(palette).not.toContain('shortcut: "P" } as CommandItem]');
  });

  it("Ctrl+1–9 has one owner at a time: the Quick panel yields while its drawer is hidden", () => {
    const body = quickPanel.slice(
      quickPanel.indexOf("── Keyboard workflow"),
      quickPanel.indexOf("Learning Engine (Phase 5)"),
    );
    expect(body).toContain(`closest("[data-testid^='findings-drawer-']")`);
    expect(body).toContain('getAttribute("aria-hidden") === "true"');
    // The stale hint no longer promises Alt+1–9 to this panel.
    expect(quickPanel).not.toContain("Alt+1–9 · / search");
  });

  it("no surface advertises the phantom Ctrl+Shift+C", () => {
    expect(interrupt).not.toContain("Ctrl+Shift+C");
  });
});

describe("the macro popover cannot ship a half-filled variable (U1/B11)", () => {
  it("applies from the last control only, and gates on every field having a value", () => {
    expect(popover).toContain("index === vars.length - 1");
    expect(popover).toContain("filledCount");
    expect(popover).toContain("disabled={!allFilled}");
    expect(popover).toContain("of {vars.length} filled");
  });

  it("Tab never applies — Enter is the only apply key, and it moves focus between fields", () => {
    expect(popover).not.toContain('e.key === "Tab"');
    expect(popover).toContain("controlsRef.current[index + 1]?.focus()");
  });
});

describe("one click does not destroy half-written text (U24/U26)", () => {
  it("Copy findings/impression asks before replacing a non-empty field", () => {
    expect(followUp).toContain("guardedCopyFindings");
    expect(followUp).toContain("guardedCopyImpression");
    expect(followUp).toContain('setConfirming("findings")');
    expect(followUp).toContain('setConfirming("impression")');
    expect(followUp).toContain('data-testid="prior-copy-confirm"');
    // The rail must feed the live impression so the guard can judge.
    expect(rail).toContain("currentImpression={impressionText}");
  });

  it("the critical-results modal keeps a half-typed record", () => {
    const body = interrupt.slice(interrupt.indexOf("function Workflow"), interrupt.indexOf("return (", interrupt.indexOf("function Workflow")));
    expect(body).toContain("const dirty =");
    expect(body).toContain("guardedClose");
    expect(interrupt).toContain('window.addEventListener("keydown", onKey, true)');
    // The backdrop now goes through the guard, not straight to onClose.
    expect(interrupt).toContain("onClick={guardedClose}");
  });
});

describe("tile picks and compact strips respect the radiologist's hands (U3/U4)", () => {
  it("a mouse insert hands the caret back to the clinical editor; keyboard inserts do not", () => {
    expect(strip).toContain("onPointerPick?: () => void;");
    expect(strip).toContain("e.detail > 0 && onPointerPick");
    expect(strip).toContain("pick(box, true)");
    expect(strip).toContain("`[data-testid='canonical-${field}-editor']`");
  });

  it("compact strips carry the search affordance too", () => {
    const body = strip.slice(strip.indexOf("Compact strips (Impression / Recommendation)"));
    expect(body).toContain("setShowSearch(true)");
    // The !compact guard around the search button is gone.
    expect(strip).not.toContain("{!compact && (\n                <Button\n                  size=\"sm\"\n                  variant=\"ghost\"\n                  className=\"h-7 px-2 text-[10px] hover:bg-violet-50 hover:text-violet-700\"\n                  onClick={() => setShowSearch(true)}");
  });
});
