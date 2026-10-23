/**
 * @vitest-environment node
 *
 * Smart Dictation — failed-turn preservation WIRING (source contract).
 *
 * smartDictationFailure.test.ts pins the pure fold; this file pins that the
 * UI layer actually routes through it. Three things a pure test cannot see:
 *
 *   1. useSmartDictation must fold EVERY failure shape (route !ok, thrown
 *      timeout) into a visible error turn — the old defect was exactly here:
 *      the hook set the error banner and returned, so the only copy of the
 *      radiologist's words lived in an invisible ref.
 *   2. SmartDictationPanel must offer an obvious Retry for the last failed
 *      turn, so recovery never requires re-dictation.
 *   3. insertRawDictation must carry the same contentLocked guard its two
 *      siblings (dictateAddAsNote / dictateAddAsFinding) have had all along —
 *      a locked/signed report must not be silently mergeField-ed.
 *
 * And the half that was already correct stays pinned: on failure the hook
 * must not touch the report store — the only store write is Apply.
 *
 * Hybrid v1 pins (2026-10-23, owner-approved "dictate continuously, compose
 * on command"): typed lines and completed voice captures STAGE on the panel
 * with NO model call; ONE Compose press runs the batch through the same
 * fold/preview/Apply lane. The per-utterance inference path must not
 * quietly come back.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = join(__dirname, "..", "..", "..", "src");

describe("failed-dictation preservation wiring (source contract)", () => {
  const hook = readFileSync(join(here, "hooks", "useSmartDictation.ts"), "utf8");
  const panel = readFileSync(
    join(here, "components", "radiology", "SmartDictationPanel.tsx"),
    "utf8",
  );
  const workspaceUi = readFileSync(
    join(here, "hooks", "radiology-workspace", "useWorkspaceClinicalUi.tsx"),
    "utf8",
  );

  it("the hook folds the route-failure shape into an error turn, not just a banner", () => {
    // The failure branch routes through the fold that appends the turn.
    expect(hook).toMatch(/foldComposeTurn\(/);
    expect(hook).toMatch(/import \{[^}]*foldComposeTurn[^}]*\} from "@\/lib\/voiceReportComposer\/smartDictationSession"/);
    // The old invisible ref is gone — the session turn IS the retry source.
    expect(hook).not.toContain("lastTranscriptRef");
    // Every failure path preserves the words: the catch arm (network throw /
    // timeout) folds too, with the standard message.
    expect(hook).toMatch(/catch[\s\S]{0,200}foldComposeTurn\(sessionRef\.current, text, \{\s*ok: false,\s*error: DICTATION_PRESERVED_MSG/);
  });

  it("the failure banner translates reason codes — the WHY reaches the radiologist", () => {
    // The server's generic text says WHAT failed; diagnostics.failureReason
    // says WHY. The hook must map it through dictationFailureMessage so the
    // single radiologist sees the action (Retry / check Ollama / pull model),
    // never a bare "Local composer unavailable" for a code the UI knows.
    expect(hook).toMatch(
      /error: dictationFailureMessage\(res\.error, res\.diagnostics\?\.failureReason\)/,
    );
    expect(hook).toMatch(
      /import \{[^}]*dictationFailureMessage[^}]*\} from "@\/lib\/voiceReportComposer\/smartDictationSession"/,
    );
  });

  it("the error banner state still comes from the fold — no parallel hand-rolled path", () => {
    // setError must only be called with the folded message (plus the two
    // legit non-compose errors: Apply conflicts), never a bespoke string on
    // a path that skips the session turn.
    const failureBranch = hook.match(/const plan = res\.plan \?\? null;[\s\S]{0,1700}?finally \{/)?.[0] ?? "";
    expect(failureBranch, "the compose try/catch body could not be located").toContain("foldComposeTurn");
    expect(failureBranch).toContain("setError(folded.error)");
    expect(failureBranch).toContain("setSession(folded.session)");
  });

  it("failed AI processing still never writes the report — Apply is the only store write", () => {
    const storeWrites = hook.match(/useWorkspace\.getState\(\)\.applyVoiceComposerPlan/g) ?? [];
    expect(storeWrites).toHaveLength(1);
    // The fold is pure; the hook must not write the store inside the compose path.
    const composeBody = hook.match(/const dictateInternal = useCallback\([\s\S]*?\n  \}, \[compose\]\);/)?.[0] ?? "";
    expect(composeBody).not.toContain("applyVoiceComposerPlan");
    expect(composeBody).not.toContain("mergeField");
  });

  it("retry actions read the session's trailing error turn and re-send it verbatim", () => {
    // Plain retry — the SAME words through the composer again.
    expect(hook).toMatch(/const retryLastTurn = useCallback\(\(\) => \{[\s\S]{0,220}dictateInternal\(failed\.transcript, false\)/);
    // Phrase-catalog retry keeps its deterministic lane, same source of truth.
    expect(hook).toMatch(/retryWithPhraseFallback[\s\S]{0,260}dictateInternal\(failed\.transcript, true\)/);
    // The panel is told whether a retryable turn exists.
    expect(hook).toMatch(/canRetryLast/);
  });

  it("the panel shows an obvious Retry on the error band, next to the phrase-catalog lane", () => {
    expect(panel).toContain('data-testid="smart-dictation-retry"');
    // Offered whenever a trailing failed turn exists, disabled while composing.
    expect(panel).toMatch(/\{vm\.canRetryLast \&& \(/);
    expect(panel).toMatch(/onClick=\{\(\) => vm\.retryLastTurn\(\)\}/);
    // The deterministic phrase lane keeps its existing contract.
    expect(panel).toContain('data-testid="smart-dictation-phrase-retry"');
    expect(panel).toMatch(/\{vm\.phraseFallbackAvailable \&& \(/);
  });

  it("insertRawDictation carries the same contentLocked guard as its two siblings", () => {
    const fn = workspaceUi.match(
      /const insertRawDictation = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/,
    )?.[0] ?? "";
    expect(fn, "insertRawDictation could not be located").toBeTruthy();
    // The guard fires BEFORE any store write.
    const guardAt = fn.indexOf("if (contentLocked) return;");
    const mergeAt = fn.indexOf('mergeField("findings"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(mergeAt);
    // And the guard is in the dependency array, so a lock mid-session
    // cannot leave a stale unlocked closure.
    expect(fn).toMatch(/\}, \[[^\]]*contentLocked[^\]]*\]\);/);
    // Sibling parity is still in place — the guard is not a one-off here.
    const siblings = workspaceUi.match(
      /const dictateAddAs(?:Note|Finding) = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/g,
    ) ?? [];
    expect(siblings.length).toBe(2);
    expect(siblings.every((s) => s.includes("if (contentLocked) return;"))).toBe(true);
  });
});

describe("hybrid staging wiring (source contract)", () => {
  const hook = readFileSync(join(here, "hooks", "useSmartDictation.ts"), "utf8");
  const panel = readFileSync(
    join(here, "components", "radiology", "SmartDictationPanel.tsx"),
    "utf8",
  );
  const workspaceUi = readFileSync(
    join(here, "hooks", "radiology-workspace", "useWorkspaceClinicalUi.tsx"),
    "utf8",
  );

  it("stageDictation accumulates WITHOUT a model call — the API post lives elsewhere", () => {
    const fn = hook.match(
      /const stageDictation = useCallback\(\([\s\S]*?\n  \}, \[\]\);/,
    )?.[0] ?? "";
    expect(fn, "stageDictation could not be located").toBeTruthy();
    expect(fn).toContain("appendStagedSegment");
    // The whole point of hybrid v1: staging never touches the network.
    expect(fn).not.toMatch(/\bcompose\(|api\.post|dictateInternal/);
  });

  it("composeStaged runs the batch through the ONE existing lane (dictateInternal) and clears staging", () => {
    const fn = hook.match(
      /const composeStaged = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/,
    )?.[0] ?? "";
    expect(fn, "composeStaged could not be located").toBeTruthy();
    expect(fn).toMatch(/dictateInternal\(text, false\)/);
    expect(fn).toMatch(/setStaged\(""\)/);
    // Re-entry guard: a second Compose press while one is in flight is a no-op.
    expect(fn).toMatch(/composingRef\.current/);
  });

  it("the panel stages typed lines — submit no longer fires the composer per utterance", () => {
    expect(panel).toMatch(/vm\.stageDictation\(text\)/);
    expect(panel).not.toMatch(/vm\.dictate\(text\)/);
  });

  it("the panel stages completed voice transcripts, even while a compose is in flight", () => {
    // Capturing DURING a compose must still land on screen (accumulate),
    // so the guard must not bail on vm.composing any more.
    expect(panel).toMatch(/vm\.stageDictation\(t\)/);
    const consumeEffect = panel.match(
      /useEffect\(\(\) => \{[\s\S]*?onLiveTranscriptConsumed/,
    )?.[0] ?? "";
    expect(consumeEffect).toBeTruthy();
    expect(consumeEffect).not.toContain("vm.composing");
  });

  it("the Compose button exists, is the only path to inference, and is disabled while composing or empty", () => {
    expect(panel).toContain('data-testid="smart-dictation-compose"');
    expect(panel).toMatch(/disabled=\{!vm\.staged\.trim\(\) \|\| vm\.composing\}/);
    expect(panel).toMatch(/onClick=\{\(\) => vm\.composeStaged\(\)\}/);
  });

  it("the staged words are visible with a word count and a clear affordance", () => {
    expect(panel).toContain('data-testid="smart-dictation-staged"');
    expect(panel).toMatch(/vm\.stagedWords/);
    expect(panel).toMatch(/vm\.discardStaged/);
  });

  it("the workspace mic routing stages completed captures instead of composing per capture", () => {
    const routing = workspaceUi.match(
      /if \(smartDictationOpenRef\.current && smartDictationEligible\) \{[\s\S]*?return;\s*\n\s*\}/,
    )?.[0] ?? "";
    expect(routing, "the smart-dictation mic routing branch could not be located").toBeTruthy();
    expect(routing).toMatch(/smartDictation\.stageDictation\(pending\.editableText\)/);
    expect(routing).not.toContain("smartDictation.dictate(");
  });
});

describe("auto-compose on pause (source contract) — opt-in, default OFF", () => {
  const session = readFileSync(
    join(here, "lib", "voiceReportComposer", "smartDictationSession.ts"),
    "utf8",
  );
  const panel = readFileSync(
    join(here, "components", "radiology", "SmartDictationPanel.tsx"),
    "utf8",
  );

  it("the pure knob exists and its shipped default is OFF (0 s)", () => {
    expect(session).toMatch(/export function normalizeAutoComposeSeconds/);
    // The strict list: anything not in it normalises to 0 — a corrupted
    // stored value must never enable auto-compose at an untested delay.
    expect(session).toMatch(/AUTO_COMPOSE_PAUSE_OPTIONS/);
  });

  it("the panel reads the stored preference through the normaliser — never raw", () => {
    expect(panel).toMatch(/normalizeAutoComposeSeconds\(/);
    expect(panel).not.toMatch(/JSON\.parse\(localStorage/);
    expect(panel).toMatch(/autoComposeSeconds/);
  });

  it("the timer fires the SAME lane as the Compose button (vm.composeStaged), gated four ways", () => {
    const timer = panel.match(
      /useEffect\(\(\) => \{[\s\S]{0,700}?setTimeout\([\s\S]{0,200}?vm\.composeStaged\(\)/,
    )?.[0] ?? "";
    expect(timer, "the auto-compose timer effect could not be located").toBeTruthy();
    // Gate 1: the panel must be open.
    expect(timer).toMatch(/!open/);
    // Gate 2: the knob must be ON (non-zero).
    expect(timer).toMatch(/autoSec\s*(?:===\s*0|<=\s*0|!\s*autoSec)/);
    // Gate 3: there must be staged words to compose.
    expect(timer).toMatch(/vm\.staged\.trim\(\)/);
    // Gate 4: never while a compose is already in flight.
    expect(timer).toMatch(/vm\.composing/);
  });

  it("the control is visibly an opt-in with OFF first, and persists through the normaliser", () => {
    expect(panel).toContain('data-testid="smart-dictation-autocompose"');
    // The Off option must exist and be the fallback.
    expect(panel).toMatch(/<option value=\{0\}>Off<\/option>/);
    // Persisting goes through the normaliser too — never a raw value.
    expect(panel).toMatch(/normalizeAutoComposeSeconds\(e\.target\.value\)/);
  });
});

describe("undo-after-apply wiring (source contract)", () => {
  const store = readFileSync(join(here, "lib", "zai-workspace", "store.ts"), "utf8");
  const hook = readFileSync(join(here, "hooks", "useSmartDictation.ts"), "utf8");
  const panel = readFileSync(
    join(here, "components", "radiology", "SmartDictationPanel.tsx"),
    "utf8",
  );

  it("the store names each voice apply's own frame — marker compared to the TOP frame, never trusted", () => {
    const at = store.indexOf("undoLastVoiceApply: () => {");
    expect(at, "undoLastVoiceApply must exist on the workspace store").toBeGreaterThan(-1);
    const body = store.slice(at, at + 1800);
    // Signed reports refuse first, before any stack inspection — announced,
    // so the standard withdrawal guidance speaks for the refusal.
    expect(body).toMatch(/refuseSignedMutation\(get\(\), "undoLastVoiceApply"\)/);
    // The affordance is only honest while the apply frame is still the TOP
    // undo frame — a buried or evicted apply says "gone", never a guess.
    expect(body).toMatch(/top\.voiceApplyId !== marker/);
    // Reverts through the same restore path Ctrl/⌘+Z uses — no second undo
    // engine with its own bookkeeping to drift.
    expect(body).toMatch(/undoLastPatch\(\)/);
    // The apply stamps the frame it will name, atomically with the marker.
    expect(store).toMatch(/voiceApplyId: applyId/);
    expect(store).toMatch(/lastVoiceApplyId: applyId/);
  });

  it("the hook exposes the affordance reactively — hidden the moment a newer edit buries the frame", () => {
    expect(hook).toMatch(/lastApplyUndoable/);
    // The selector must compare the TOP frame against the marker — not just
    // check the marker exists, which would stay true after newer edits.
    expect(hook).toMatch(/lastVoiceApplyId/);
    expect(hook).toMatch(/patchUndoStack\[s\.patchUndoStack\.length - 1\]\?\.voiceApplyId === s\.lastVoiceApplyId/);
    expect(hook).toMatch(/undoLastVoiceApply/);
  });

  it("the panel offers Undo where the Apply happened — only while it is still the newest change", () => {
    expect(panel).toContain('data-testid="smart-dictation-undo-apply"');
    expect(panel).toMatch(/\{vm\.lastApplyUndoable && \(/);
    // The gone-explanation is a visible notice, not a silent no-op.
    expect(panel).toContain('data-testid="smart-dictation-apply-notice"');
  });
});
