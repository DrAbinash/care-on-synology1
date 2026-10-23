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
