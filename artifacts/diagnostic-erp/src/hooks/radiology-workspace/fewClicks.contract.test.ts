/**
 * fewClicks.contract.test.ts — wiring contracts for the few-clicks pass
 * (owner's order: radiologists use FEW CLICKS, easy and quick report
 * generation), source-level per this repo's node-env convention.
 *
 * WHY SOURCE CONTRACTS: this package has no DOM harness — the sign dialog,
 * the workspace hooks and the print flow cannot be mounted here. What CAN be
 * pinned mechanically is the wiring: the keys that are consumed, the order
 * the async steps run in, and the guards the new affordances carry. Pure
 * halves (shortcut matching) live in lib/fewClicksShortcut.test.ts.
 *
 * THE CLICKS UNDER GUARD, END TO END
 *   Open study → (auto-focus findings — no click) → type → Ctrl+P (print,
 *   popup opened at the gesture) → Ctrl+Enter → Enter (sign — the dialog's
 *   Enter no longer cancels) → signed report prints itself → next study.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ERP_SRC = resolve(HERE, "../..");

/** CRLF-safe read (Windows dev box / LF in CI). */
const read = (rel: string) => readFileSync(resolve(ERP_SRC, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Comments stripped, string literals preserved — for ABSENCE pins only.
 * A presence pin must read raw text or it can pass on prose.
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

const DIALOG = read("components/radiology/FinalizeSignDialog.tsx");
const FLOW = read("hooks/useFinalizeFlow.ts");
const HOOK = read("hooks/radiology-workspace/useStudyFinalize.ts");
const COMMANDS = read("lib/workspaceCommands.ts");
const SHORTCUTS = read("lib/workspaceReportState.ts");
const RESOLVER = read("lib/workspaceShortcutResolve.ts");
const COMMANDS_HOOK = read("hooks/radiology-workspace/useWorkspaceCommands.ts");
const CLINICAL_UI = read("hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const SHORTCUT_HELP = read("components/radiology/ReportingShortcutHelp.tsx");
const STUDY_SETUP = read("hooks/useReportingStudySetup.ts");
const STRIP = read("components/radiology/TechniqueChoiceStrip.tsx");
const CANVAS = read("components/radiology/workspace/ReportCanvas.tsx");
const EDITOR = read("components/radiology/zai-workspace/findings-editor.tsx");
const EXPORT_SHARE = read("hooks/radiology-workspace/useWorkspaceExportShare.ts");
const WORKLIST_PAGE = read("pages/RadiologyWorklist.tsx");

/** Slice between two anchors (exclusive end), for order pins inside a region. */
function between(src: string, startAnchor: string, endAnchor: string): string {
  const s = src.indexOf(startAnchor);
  const e = src.indexOf(endAnchor, s + startAnchor.length);
  return s >= 0 && e > s ? src.slice(s, e) : "";
}

describe("1 — the sign dialog confirms from the keyboard", () => {
  it("opens with focus on Confirm, not on the close glyph", () => {
    const autofocus = DIALOG.match(/onOpenAutoFocus=\{\(e\) => \{([\s\S]*?)\n {10}\}\}/);
    expect(autofocus).toBeTruthy();
    expect(autofocus![0]).toContain("confirmRef.current");
    expect(autofocus![0]).toContain("e.preventDefault()");
    // A gated dialog must stay gated: a disabled Confirm cannot take focus.
    expect(autofocus![0]).toContain("confirmRef.current.disabled");
  });

  it("Enter signs when Confirm is enabled and the key has no other owner", () => {
    const keydown = DIALOG.match(/onKeyDown=\{\(e\) => \{([\s\S]*?)\n {10}\}\}/);
    expect(keydown).toBeTruthy();
    expect(keydown![0]).toContain('e.key !== "Enter"');
    // The signer Select, checkboxes and the Confirm button's own native
    // Enter-click all keep their meaning.
    expect(keydown![0]).toMatch(/closest\?\.\("button, input, textarea, select, a, \[role=combobox\]"\)/);
    expect(keydown![0]).toContain("if (!canConfirm) return;");
    expect(keydown![0]).toContain("confirmRef.current?.click()");
  });

  it("the Confirm button carries the ref the handlers click", () => {
    const footer = between(DIALOG, "DialogFooter", "</DialogFooter>");
    expect(footer).toContain("ref={confirmRef}");
  });
});

describe("2 — print-after-sign: one action for sign + print", () => {
  it("the dialog offers a persisted print-after-finalize checkbox", () => {
    expect(DIALOG).toContain('data-testid="finalize-print-after-sign"');
    expect(DIALOG).toContain("Print the signed report when finalize completes");
    expect(DIALOG).toMatch(/const PRINT_AFTER_KEY = "care_print_after_finalize"/);
    expect(DIALOG).toMatch(/function loadPrintAfterFinalize\(\): boolean/);
    expect(DIALOG).toMatch(/function savePrintAfterFinalize\(v: boolean\)/);
  });

  it("the tick defaults OFF — printing is per-clinic practice, not a software default", () => {
    const loader = DIALOG.match(/export function loadPrintAfterFinalize\(\): boolean \{([\s\S]*?)\n\}/);
    expect(loader).toBeTruthy();
    expect(loader![0]).toContain("if (raw == null) return false");
  });

  it("the value travels outward with the rest of the dialog's result", () => {
    expect(DIALOG).toMatch(/printAfterSigning,/);
    expect(FLOW).toMatch(/printAfterSigning\?: boolean/);
    expect(FLOW).toMatch(/advanceToNext: false,\s*\n\s*printAfterSigning: false,/);
  });

  it("the finalize hook opens the popup at the confirm gesture, BEFORE the sign call", () => {
    const openAt = HOOK.indexOf('const printWindow = result.printAfterSigning ? window.open("", "_blank") : null;');
    const signAt = HOOK.indexOf("await finalizeRadiologyReport(");
    expect(openAt).toBeGreaterThan(0);
    expect(signAt).toBeGreaterThan(0);
    expect(openAt).toBeLessThan(signAt);
    // A blocked popup is named, not silent.
    const blocked = between(HOOK, "const printWindow = result.printAfterSigning", "try {");
    expect(blocked).toContain("Popup blocked");
  });

  it("the signed artifact fills the popup; every refusal path closes it", () => {
    const fill = between(HOOK, "if (printWindow) {", "if (result.advanceToNext && completedFinalize)");
    expect(fill).toContain("completedFinalize && finalizeResult.reportId");
    expect(fill).toMatch(/api\.get<string>\(`\/api\/patient-reports\/\$\{finalizeResult\.reportId\}\/print`\)/);
    expect(fill).toContain("printWindow.document.write(html)");
    expect(fill).toContain("printWindow.close()");
    // And a thrown sign closes the tab too.
    const catchBlock = HOOK.match(/catch \(err\) \{\s*\n\s*printWindow\?\.close\(\);\s*\n\s*toast\(\{ title: "Finalize failed"/);
    expect(catchBlock).toBeTruthy();
  });
});

describe("3 — Ctrl+P reaches the same print the top-bar button runs", () => {
  it("the command vocabulary and the shortcut resolver both know print", () => {
    expect(COMMANDS).toMatch(/"print",/);
    expect(SHORTCUTS).toMatch(/if \(mod && !shift && key === "p"\) return "print";/);
    expect(SHORTCUTS).toMatch(/\| "print"/);
    expect(RESOLVER).toMatch(/print: "print",/);
  });

  it("the dispatcher routes print through a ref-held action, like verify", () => {
    expect(COMMANDS_HOOK).toContain("printActionRef: MutableRefObject<(() => void) | null>;");
    expect(COMMANDS_HOOK).toMatch(/print: \(\) => \{ printActionRef\.current\?\.\(\); \},/);
    expect(COMMANDS_HOOK).toContain("printActionRef,");
  });

  it("the workspace wires the ref to print-like-final", () => {
    expect(CLINICAL_UI).toMatch(/const printActionRef = useRef<\(\(\) => void\) \| null>\(null\);/);
    expect(CLINICAL_UI).toMatch(/printActionRef\.current = \(\) => \{ void handlePrintLikeFinal\(\); \};/);
    // and hands it to the command hook
    const call = between(CLINICAL_UI, "useWorkspaceCommands({", "handleFrictionlessSaveAndNext");
    expect(call).toContain("printActionRef,");
  });

  it("the shortcut help documents the key it now answers to", () => {
    expect(SHORTCUT_HELP).toContain('keys: "Ctrl + P"');
    expect(SHORTCUT_HELP).toContain("Print like final");
  });
});

describe("4 — a fresh study opens with the caret already in Findings", () => {
  it("a once-per-study effect focuses findings after hydration settles", () => {
    const effect = between(CLINICAL_UI, "land the caret in Findings when a fresh study opens", "Preload next study");
    expect(effect).toContain('focusReportField("findings")');
    expect(effect).toContain("draftHydratedStudyId !== studyId");
    expect(effect).toContain("contentLocked");
    expect(effect).toMatch(/autoFocusedFindingsStudyRef\.current === studyId/);
  });

  it("focus is never stolen from a text field or the OHIF iframe", () => {
    const effect = between(CLINICAL_UI, "land the caret in Findings when a fresh study opens", "Preload next study");
    expect(effect).toContain("HTMLIFrameElement");
    expect(effect).toMatch(/tagName === "INPUT" \|\| .*tagName === "TEXTAREA" \|\| .*isContentEditable/);
  });
});

describe("5 — the deep-link intents the worklist buttons promise are honored", () => {
  it("?ai=1 opens the AI review rail; ?tab=print opens the print tab; both consumed once", () => {
    const effect = between(CLINICAL_UI, "the deep-link intents the worklist buttons already promise", "PCPNDT gate");
    expect(effect).toContain('params.get("ai") === "1"');
    expect(effect).toContain('openReportingToolsRef.current("ai")');
    expect(effect).toContain('params.get("tab") === "print"');
    expect(effect).toContain('openLegacyTabRef.current("print")');
    expect(effect).toContain('params.delete("ai")');
    expect(effect).toContain('params.delete("tab")');
    expect(effect).toContain("history.replaceState");
  });

  it("the worklist really navigates with those params (the buttons exist)", () => {
    expect(WORKLIST_PAGE).toMatch(/reportingWorkspacePath\(id, \{ ai: true \}\)/);
    expect(WORKLIST_PAGE).toMatch(/reportingWorkspacePath\(draftViewer\.id, \{ ai: true \}\)/);
    expect(WORKLIST_PAGE).toContain("`/radiology/report/${entry.id}?tab=print`");
  });
});

describe("6 — the technique one-shot is not spent on a pass that picks nothing", () => {
  it("the token burns only when technique exists or a protocol actually seeded", () => {
    const effect = STUDY_SETUP.slice(
      STUDY_SETUP.indexOf("Auto protocol once per study"),
      STUDY_SETUP.indexOf("Auto protocol once per study") + 2600,
    );
    const guardAt = effect.indexOf("if (!hasIdentitySignal) return;");
    const pickersAt = effect.indexOf("pickQuickProtocolForBilledName(quickSelectData.protocols");
    // The SUCCESS-path burn — the one immediately before applyProtocol. The
    // technique-already-exists burn above it is fine (the goal is achieved),
    // so firstIndexOf cannot be the pin: lastIndexOf names the burn that
    // must follow a successful pick.
    const burnAt = effect.lastIndexOf("autoProtocolForStudyRef.current = studyId");
    const noPickAt = effect.indexOf("if (!protocol) return;");
    expect(guardAt).toBeGreaterThan(0);
    expect(pickersAt).toBeGreaterThan(0);
    expect(burnAt).toBeGreaterThan(0);
    expect(noPickAt).toBeGreaterThan(0);
    // Guard before decision, decision before the success burn, and the no-pick
    // exit BEFORE that burn: a modality-only signal makes both pickers answer
    // null, and the exit above must spend nothing — the region that arrives a
    // moment later still has a token to seed Technique with.
    expect(guardAt).toBeLessThan(pickersAt);
    expect(pickersAt).toBeLessThan(noPickAt);
    expect(noPickAt).toBeLessThan(burnAt);
  });
});

describe("7 — an empty Technique has a one-click recovery on the strip", () => {
  it("the strip learns whether technique is empty and offers the region default", () => {
    expect(STRIP).toContain("techniqueEmpty?: boolean;");
    expect(STRIP).toContain("techniqueEmpty,");
    expect(STRIP).toContain('data-testid="technique-empty-load-default"');
    expect(STRIP).toMatch(/techniqueEmpty\s*&&\s*!activeProtocolId/);
    expect(STRIP).toMatch(/sortedChoices\.length > 0/);
    expect(STRIP).toContain("onLoadCurrentDefault");
  });

  it("the canvas passes the emptiness of the technique it renders", () => {
    const stripUsage = between(CANVAS, "<TechniqueChoiceStrip", "canonical-technique-editor");
    expect(stripUsage).toContain("techniqueEmpty={!techniqueText.trim()}");
  });
});

describe("8 — pathology impression sentences are one click away", () => {
  it("the workspace derives impression chips from the observation ledger", () => {
    expect(CLINICAL_UI).toMatch(
      /const impressionShortcutChips = useMemo<string\[\]>\(\s*\(\) => collectPathologyImpressionShortcuts\(appliedPathologyPatches\),/,
    );
    expect(CLINICAL_UI).toMatch(/impressionShortcutChips,\s*\n\s*recommendationChips,/);
  });

  it("the impression section renders a toggle chip row", () => {
    const rowAt = CANVAS.indexOf('data-testid="impression-chips"');
    expect(rowAt).toBeGreaterThan(0);
    // The chips row's map body follows the testid; slice far enough to cover it.
    const block = CANVAS.slice(rowAt, rowAt + 2400);
    expect(block).toContain('state.mergeField("impression", trimmed, "quick-findings")');
    expect(block).toContain('state.setField("impression", removeBlock(cur, trimmed))');
    expect(block).toContain("aria-pressed={active}");
    expect(block).toMatch(/active = impressionText\.includes\(chip\.trim\(\)\)/);
  });

  it("the helper is no longer dead code", () => {
    expect(CANVAS).toMatch(/from "@\/lib\/quickFindingsMerge"/);
  });
});

describe("9 — a late ghost never steals the caret", () => {
  it("the focus effect checks who owns focus before taking it", () => {
    const effect = between(EDITOR, "gTarget === field && gt && ref.current", "const hk =");
    expect(effect).toContain("document.activeElement");
    expect(effect).toContain("owner !== ref.current");
    expect(effect).toMatch(/isContentEditable/);
    // Guard BEFORE the focus call.
    const guardAt = effect.indexOf("document.activeElement");
    const focusAt = effect.indexOf("ref.current.focus()");
    expect(guardAt).toBeGreaterThan(0);
    expect(focusAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(focusAt);
  });
});

describe("10 — the print popup opens at the click, before any await", () => {
  it("window.open precedes the save/ensure awaits in runPrintLikeFinal", () => {
    const body = between(EXPORT_SHARE, "const runPrintLikeFinal = useCallback", "const templateQs =");
    const openAt = body.indexOf('window.open("", "_blank")');
    const saveAt = body.indexOf("await saveDraft(");
    const ensureAt = body.indexOf("await ensureDraftOnce()");
    expect(openAt).toBeGreaterThan(0);
    expect(saveAt).toBeGreaterThan(0);
    expect(openAt).toBeLessThan(saveAt);
    expect(openAt).toBeLessThan(ensureAt);
    // Blocked popup named before anything runs.
    expect(body).toContain("Popup blocked");
  });

  it("every abort path closes the tab it opened", () => {
    const body = between(EXPORT_SHARE, "const runPrintLikeFinal = useCallback", "const templateQs =");
    // save refused → close; no draft id → close. Short windows so the pin
    // names WHICH close (the aborts') and not some later cleanup.
    expect(body).toMatch(/if \(saved == null\) \{[\s\S]{0,80}?w\.close\(\)/);
    expect(body).toMatch(/if \(!id\) \{[\s\S]{0,80}?w\.close\(\)/);
  });
});

describe("11 — the worklist poll no longer prints PHI to the console", () => {
  const pageCode = stripComments(WORKLIST_PAGE);

  it("no first-row patient dump, no full-response dump, no token-presence log", () => {
    expect(pageCode).not.toContain("[PACS-WORKLIST] First row:");
    expect(pageCode).not.toContain("PACS API RESPONSE");
    expect(pageCode).not.toContain("[PACS-WORKLIST] Fetching:");
    expect(pageCode).not.toContain("[PACS-WORKLIST] Auth token present:");
    expect(pageCode).not.toContain("[PACS-WORKLIST] DB total rows:");
  });

  it("the fetch still throws onward on error (diagnostics kept, PHI not dumped)", () => {
    expect(pageCode).toMatch(/\[PACS-WORKLIST\] Fetch\/auth error:/);
  });
});
