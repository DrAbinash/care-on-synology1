import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatHumanSaveStatus,
  saveStatusDotClass,
  type AutoSaveStatus,
  type HumanSaveStatusInput,
} from "./humanSaveStatus";

/**
 * A save the report was never going to accept was reported to the radiologist as
 * a failure.
 *
 * PR-20 put a signed-study guard inside `saveDraft` and was careful about what
 * that guard must NOT do: `draftSaveSignedRefusal.hardening.test.ts` still pins
 * that the refusal block contains neither `setAutoSaveStatus` nor "Save failed",
 * on the reasoning that "nothing failed, and a red 'save error' chip in the
 * footer of a correctly signed report is a fault the radiologist did not cause."
 *
 * That reasoning was right and the outcome still happened, because the guard was
 * not the only thing that could set the chip. `saveDraft` returns
 * `Promise<number | null>`, and `null` means both "refused" and "failed". Three
 * callers read only the null:
 *
 *   • The 30-second auto-save effect gated on bare `isFinalized`, which is
 *     written only by `completeFinalize` and never rehydrated — so a report
 *     signed in ANOTHER session sailed past it. The effect armed its timer,
 *     fired, called `saveDraft({ silent: true })`, and `silent` suppressed the
 *     one message that explained the refusal. The `.then` mapped the null onto
 *     `setAutoSaveStatus("error")`, which `formatHumanSaveStatus` renders as a
 *     red "Save failed" — sticky, because the only thing that clears it is a
 *     later successful save, and on a signed report there can never be one.
 *   • The auto-save's other branch, `ensureDraftOnce()`, is
 *     `createDraft: () => saveDraft({ silent: true })` — the same refusal, the
 *     same null, the same chip.
 *   • `saveAndConfirmLeave` passed `silent: true` to BOTH of its calls, so on a
 *     signed report it reached the refusal twice and toasted "Save failed /
 *     Could not save before leaving. Stay on this study." A radiologist who
 *     chose "Save & leave" on a study signed elsewhere was held on it by a
 *     message that reads as an invitation to retry, with nothing on screen to
 *     say that Discard was the correct answer.
 *
 * The fix has two halves, and the second is why this is not a one-word change.
 * Narrowing the guards to `signedContentLocked` — the composed predicate PR-20
 * already threaded into this hook — stops the refusal reaching those mappings.
 * But that alone would leave the chip saying nothing at all while the radiologist
 * types into a report that will never save, because `AutoSaveStatus` had no
 * member meaning *refused*. So it gains one, `"refused"`, rendered amber rather
 * than red and worded as a policy rather than a fault.
 *
 * `formatHumanSaveStatus` is a pure exported function, so the label and tone
 * half of this is genuinely executed rather than grepped. The guard half cannot
 * be: it lives inside a `useEffect` in a hook, and this repo has no DOM or React
 * harness (`environment: "node"` repo-wide, no `@testing-library/*`, no jsdom).
 * What is executed there is the real condition text lifted out of the effect and
 * evaluated over a truth table against the expression it replaced.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const PERSIST = "hooks/radiology-workspace/useDraftPersistence.ts";
const UX = "lib/reportingWorkspaceUx.test.ts";
const PR20 = "lib/draftSaveSignedRefusal.hardening.test.ts";

const base: Omit<HumanSaveStatusInput, "autoSaveStatus"> = {
  lastSavedAt: null,
  nowMs: 1_000_000,
  isDirty: true,
  isOnline: true,
  hasOfflineCopy: false,
};
const fmt = (autoSaveStatus: AutoSaveStatus, over: Partial<typeof base> = {}) =>
  formatHumanSaveStatus({ ...base, ...over, autoSaveStatus });

/**
 * Lifts the condition of the auto-save effect's early return. Located by the ref
 * declared immediately above the effect rather than by searching for the `if`,
 * because the file contains several.
 */
function autoSaveGuardCondition(): string {
  const src = read(PERSIST);
  const anchor = src.indexOf("const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);");
  expect(anchor, "the auto-save effect must still be preceded by its timer ref").toBeGreaterThan(-1);
  const at = src.indexOf("if (", anchor);
  expect(at).toBeGreaterThan(anchor);
  const end = src.indexOf(") {", at);
  expect(end).toBeGreaterThan(at);
  return src.slice(at + "if (".length, end);
}

/** Lifts the condition on the `setAutoSaveStatus("refused")` call. */
function refusedStatusCondition(): string {
  const src = read(PERSIST);
  const at = src.indexOf('if (isDirty && signedContentLocked) setAutoSaveStatus("refused");');
  expect(at, "the auto-save effect must set a refused status").toBeGreaterThan(-1);
  return src.slice(at + "if (".length, src.indexOf(") setAutoSaveStatus", at));
}

function evaluate(condition: string) {
  return new Function(
    "isDirty",
    "isOnline",
    "isFinalized",
    "signedContentLocked",
    "isMobile",
    `return (${condition});`,
  ) as (isDirty: boolean, isOnline: boolean, isFinalized: boolean, signedContentLocked: boolean, isMobile: boolean) => boolean;
}

/** The auto-save effect's guard before this change, quoted from PR-20's pin. */
const OLD_GUARD = "!isDirty || !isOnline || isFinalized || isMobile";

describe("the chip says a refusal is a refusal, not a failure", () => {
  it("renders 'refused' as a policy in amber", () => {
    expect(fmt("refused")?.label).toBe("Edits not saved — signed");
    expect(fmt("refused")?.tone).toBe("amber");
  });

  it("is not red, and is not the word 'failed'", () => {
    const s = fmt("refused");
    expect(s?.tone).not.toBe("red");
    expect(s?.label.toLowerCase()).not.toContain("fail");
    expect(saveStatusDotClass(s!.tone)).not.toBe(saveStatusDotClass("red"));
  });

  it("leaves every other status exactly as it was", () => {
    expect(fmt("saving")?.label).toBe("Saving…");
    expect(fmt("error")?.label).toBe("Save failed");
    expect(fmt("error")?.tone).toBe("red");
    // Corrected by D-05: this row used to assert "Saved 25 sec ago" for
    // `autoSaveStatus === "saved"` OVER A DIRTY EDITOR (this suite's `base`
    // defaults `isDirty: true`) — the exact defective behaviour the stale-ack
    // bug produced, printed as a green success. "Saved" is a claim about the
    // current text, so over a dirty editor the branch now prints nothing and
    // the chrome's Unsaved badge speaks; the label appears only once the
    // newest text really is on the server.
    expect(fmt("saved", { lastSavedAt: new Date(1_000_000 - 25_000), isDirty: true })).toBeNull();
    expect(fmt("saved", { lastSavedAt: new Date(1_000_000 - 25_000), isDirty: false })?.label)
      .toBe("Saved 25 sec ago");
    expect(fmt("idle", { isOnline: false, hasOfflineCopy: true })?.label).toBe("Offline copy saved");
  });

  it("outranks the offline branch, because signed is the more useful fact", () => {
    expect(fmt("refused", { isOnline: false, hasOfflineCopy: true })?.label).toBe("Edits not saved — signed");
  });

  it("sits below 'Saving…' and above 'Save failed', so a request in flight still wins", () => {
    const src = read("lib/humanSaveStatus.ts");
    const saving = src.indexOf('input.autoSaveStatus === "saving"');
    const refused = src.indexOf('input.autoSaveStatus === "refused"');
    const error = src.indexOf('input.autoSaveStatus === "error"');
    expect(saving).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(saving);
    expect(error).toBeGreaterThan(refused);
  });

  it("is a single clause short enough for the 10px chip it renders into", () => {
    // HumanSaveStatusChip is text-[10px] inside a flex-wrap toolbar, and the
    // sibling labels run from "Saved" to "Saved 25 sec ago". A sentence here
    // would wrap the action bar.
    expect(fmt("refused")!.label.length).toBeLessThanOrEqual("Offline copy saved".length + 8);
    expect(fmt("refused")!.label.split(" — ").length).toBe(2);
  });

  it("is not a status a caller can reach by accident", () => {
    // The invariant is not "exactly two" — it is that every writer of "refused"
    // sits under a test that actually refused to write, so the label can never
    // lie about why nothing saved. Two are the signedContentLocked branches. The
    // third is PROMPT 4's composer-tagged save, which stops because the study's
    // saved report moved since the AI draft was generated: a refusal decided by
    // the server before writing, carrying a 409, and leaving the radiologist's
    // text in the editor. A writer that is neither of those (a network timeout
    // dressed up as a refusal, say) makes the chip claim something false, and a
    // fourth writer has to be argued for here rather than just counted.
    const src = read(PERSIST);
    const lines = src.split(/\r?\n/);
    const writers = lines.map((l, i) => ({ l, n: i + 1 })).filter((x) => x.l.includes('setAutoSaveStatus("refused")'));
    expect(writers.length, "exactly three writers of the refused status").toBe(3);
    for (const w of writers) {
      const above = lines.slice(Math.max(0, w.n - 12), w.n - 1).join("\n");
      const signedRefusal = above.includes("signedContentLocked");
      const composerRefusal = /opts\?\.composer/.test(above) && /err\.status === 409/.test(above);
      expect(
        signedRefusal || composerRefusal,
        `the writer at :${w.n} must sit under a refusal branch, not a failure path`,
      ).toBe(true);
      // Every one of them also has to say out loud that this is not a lost save.
      expect(above, `the writer at :${w.n} needs a comment naming the refusal`).toMatch(/refus/i);
    }
  });
});

describe("the auto-save effect refuses before it can arm a timer", () => {
  it("guards on the composed predicate rather than the same-session flag", () => {
    expect(autoSaveGuardCondition()).toBe("!isDirty || !isOnline || signedContentLocked || isMobile");
  });

  it("and its dependency array carries the value it reads", () => {
    const src = read(PERSIST);
    const deps = src.match(/\}, \[isDirty, isOnline, draftId, ([^\]]*)\]\);/);
    expect(deps, "the effect's dependency array must still be recognisable").toBeTruthy();
    expect(deps![1]).toContain("signedContentLocked");
    // Leaving `isFinalized` in would be a stale dependency: the effect no longer
    // reads it, and a value that is read nowhere but depended on everywhere is
    // how a guard gets quietly reverted later.
    expect(deps![1]).not.toContain("isFinalized");
  });

  it("newly refuses exactly the case PR-20's guard could not see", () => {
    const now = evaluate(autoSaveGuardCondition());
    const was = evaluate(OLD_GUARD);
    // `signedContentLocked` is `(isFinalized || studyIsSignedElsewhere) &&
    // !allowEditSigned`, and `allowEditSigned` has exactly one setter call in the
    // whole workspace, passing false — so it is the plain OR here. Deduplicated,
    // because (signed here, not elsewhere) and (signed here, and elsewhere) are
    // the same state as far as the guard is concerned.
    const seen = new Set<string>();
    const rows: Array<[boolean, boolean, boolean, boolean, boolean]> = [];
    for (const isDirty of [false, true]) {
      for (const isOnline of [false, true]) {
        for (const isFinalized of [false, true]) {
          for (const signedElsewhere of [false, true]) {
            for (const isMobile of [false, true]) {
              const row: [boolean, boolean, boolean, boolean, boolean] = [isDirty, isOnline, isFinalized, isFinalized || signedElsewhere, isMobile];
              const key = row.join(",");
              if (seen.has(key)) continue;
              seen.add(key);
              rows.push(row);
            }
          }
        }
      }
    }
    expect(rows.length, "24 distinct states over the five inputs").toBe(24);
    const changed = rows.filter((r) => was(...r) !== now(...r));
    // One state changes: dirty, online, desktop, signed somewhere other than this
    // session. That is the whole defect, and it is the common one — a report
    // signed from Report Hub, or from a second window, and then opened here.
    expect(changed.length).toBe(1);
    const [isDirty, isOnline, isFinalized, signedContentLocked, isMobile] = changed[0];
    expect([isDirty, isOnline, isFinalized, signedContentLocked, isMobile]).toEqual([true, true, false, true, false]);
    expect(was(true, true, false, true, false), "the old guard let this state through to the timer").toBe(false);
    expect(now(true, true, false, true, false), "the new one refuses it").toBe(true);
  });

  it("sets the refused status only when there was something to save", () => {
    expect(refusedStatusCondition()).toBe("isDirty && signedContentLocked");
    const set = evaluate(refusedStatusCondition());
    expect(set(true, true, false, true, false)).toBe(true);
    expect(set(false, true, false, true, false)).toBe(false);
    expect(set(true, true, false, false, false)).toBe(false);
    expect(set(true, true, true, true, false)).toBe(true);
  });

  it("still arms the timer for an unsigned dirty report", () => {
    const now = evaluate(autoSaveGuardCondition());
    expect(now(true, true, false, false, false)).toBe(false);
  });
});

describe("the null return still reaches a failure mapping only when it is one", () => {
  const src = read(PERSIST);

  it("keeps the `null` -> error mapping for a genuine failure", () => {
    expect(src).toContain('setAutoSaveStatus(id != null ? "saved" : "error");');
  });

  it("and that mapping is now unreachable with a signed refusal", () => {
    // Not by inspection of the callback, which cannot see why `saveDraft`
    // returned null, but by ordering: the effect returns before the timer is
    // created, and `signedContentLocked` is in its dependency array, so a change
    // in it re-runs the effect and the previous run's cleanup clears any pending
    // timer. A timer that survives to fire therefore fired with the predicate
    // false, which is the same value `saveDraft`'s own guard reads.
    const anchor = src.indexOf("const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);");
    const guard = src.indexOf("if (!isDirty || !isOnline || signedContentLocked || isMobile) {", anchor);
    const arm = src.indexOf("autoSaveTimerRef.current = setTimeout(", anchor);
    const map = src.indexOf('setAutoSaveStatus(id != null ? "saved" : "error");', anchor);
    expect(guard).toBeGreaterThan(anchor);
    expect(arm).toBeGreaterThan(guard);
    expect(map).toBeGreaterThan(arm);
    expect(src.slice(anchor, arm)).toContain('if (isDirty && signedContentLocked) setAutoSaveStatus("refused");');
  });

  it("the other branch of the timer callback goes through the same guard", () => {
    // `ensureDraftOnce` is `createDraft: () => saveDraftOrdered({ silent: true })`,
    // which is the ordered entry into `saveDraft` — so it refuses the same way and
    // returns the same null. It is reached only from inside the timer callback,
    // which the effect's early return now precedes.
    expect(src).toContain("createDraft: () => saveDraftOrdered({ silent: true }),");
    const anchor = src.indexOf("const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);");
    expect(src.indexOf("return ensureDraftOnce();", anchor)).toBeGreaterThan(src.indexOf("autoSaveTimerRef.current = setTimeout(", anchor));
  });
});

describe("the leave gate says what the two real options are", () => {
  const src = read(PERSIST);
  const start = src.indexOf("const saveAndConfirmLeave = useCallback(async () => {");
  const body = () => src.slice(start, src.indexOf("}, [ensureDraftOnce", start));

  it("refuses before either call, so neither null is mistaken for a failure", () => {
    expect(start).toBeGreaterThan(-1);
    const b = body();
    expect(b).toContain("if (signedContentLocked) {");
    expect(b.indexOf("if (signedContentLocked) {")).toBeLessThan(b.indexOf("await ensureDraftOnce();"));
    expect(b.indexOf("if (signedContentLocked) {")).toBeLessThan(b.indexOf("await saveDraftOrdered({ silent: true });"));
  });

  it("names Discard, which is the action that actually works", () => {
    const b = body();
    expect(b).toContain("Nothing to save — the report is signed");
    expect(b).toContain("Local edits cannot be added to a signed report.");
    expect(b).toContain("Choose Discard to leave");
    expect(b).toContain("Report Hub");
  });

  it("ends with the sentence the other three signed refusals already used", () => {
    // #855, #858 and #859 each wrote their own version of where the way back is:
    // "To correct it, withdraw the signature from Report Hub — only the signer or
    // an administrator can." This one first said "withdraw the signature in
    // Report Hub to change it" and dropped who can do it, which is the drift
    // those three had already avoided by copying each other. Pinned as a single
    // literal in all four files so a fifth refusal cannot invent a sixth
    // phrasing, and so the side-by-side reading these four still need is a
    // wording review rather than a search for what each one called the place.
    const SHARED = "withdraw the signature from Report Hub — only the signer or an administrator can.";
    const description = body().match(/title: "Nothing to save — the report is signed",\s*\n\s*description:\s*\n\s*"([^"]+)"/);
    expect(description, "the refusal must carry a description").toBeTruthy();
    expect(description![1].endsWith(SHARED), "this refusal must end with the shared sentence").toBe(true);
    for (const [rel, own] of [
      ["hooks/radiology-workspace/useDraftPersistence.ts", 'title: "Save refused — the report is signed"'],
      // Stage C Phase 1 gave Redo the same refusal Undo had, so the two inline toasts
      // #855 wrote in the key handler became one helper that takes the verb. The
      // wording is the same literal, now built once for both directions.
      ["lib/reportingWorkspaceShortcuts.ts", "refused — the report is signed"],
      ["lib/zai-workspace/signedMutationRefusalNotice.ts", "Nothing was applied."],
    ] as const) {
      const text = read(rel);
      expect(text, `${rel} must still carry its own signed refusal`).toContain(own);
      expect(text, `${rel} must use the shared sentence`).toContain(SHARED);
    }
    // And the key handler may not re-inline a voice of its own again: both history
    // keys route through the helper above, which is why the sentence has one home.
    const keys = read("hooks/radiology-workspace/useWorkspaceCommands.ts");
    expect(
      (keys.match(/clinicalHistoryRefusal\(/g) ?? []).length,
      "both Undo and Redo must ask the shared refusal builder",
    ).toBe(2);
  });

  it("stays inside the reading budget #855 measured against eight seconds", () => {
    const description = body().match(/title: "Nothing to save — the report is signed",\s*\n\s*description:\s*\n\s*"([^"]+)"/);
    expect(description, "the refusal must carry a description").toBeTruthy();
    // #855 shortened the undo refusal from 295 characters to 191 on the grounds
    // that fifty-odd words is twelve to fifteen seconds of reading and the
    // ending was the part nobody reached. PR-20 pinned its own refusal to the
    // same ceiling. This is not the number to beat, but it is the number to
    // stay under.
    expect(description![1].length).toBeLessThanOrEqual(191);
  });

  it("still blocks navigation, because the local edits are genuinely unsaved", () => {
    // Returning true here would navigate away from a dirty store and lose the
    // radiologist's typing without ever having said it could not be kept.
    const b = body();
    expect(b.slice(b.indexOf("if (signedContentLocked) {"), b.indexOf("await ensureDraftOnce();"))).toContain("return false;");
  });

  it("keeps the genuine-failure branch word for word", () => {
    const b = body();
    expect(b).toContain('title: "Save failed"');
    expect(b).toContain("Could not save before leaving. Stay on this study.");
    expect(src).toContain("}, [ensureDraftOnce, saveDraftOrdered, toast, signedContentLocked]);");
  });
});

describe("the two types cannot drift again", () => {
  it("AutoSaveStatus has exactly the six members", () => {
    // Sixth member added by P0-2: `conflict`, the save the server refused because
    // the report moved underneath this editor. It is not `refused`, which reads
    // "signed" on the chip — see the describe below that names it.
    const src = read("lib/humanSaveStatus.ts");
    const m = src.match(/export type AutoSaveStatus = ([^;]+);/);
    expect(m, "the union must still be exported from humanSaveStatus").toBeTruthy();
    expect(m![1].split("|").map((s) => s.trim().replace(/"/g, "")).sort()).toEqual(
      ["conflict", "error", "idle", "refused", "saved", "saving"],
    );
  });

  it("and the hook's state uses it instead of repeating it inline", () => {
    // It used to declare `useState<"idle"|"saving"|"saved"|"error">`, a second
    // copy of the same union in a second file. Adding a fifth member there would
    // have compiled and silently never rendered.
    const src = read(PERSIST);
    expect(src).toContain('import type { AutoSaveStatus } from "@/lib/humanSaveStatus";');
    expect(src).toContain("useState<AutoSaveStatus>(\"idle\")");
    expect(src).not.toContain('useState<"idle"|"saving"|"saved"|"error">');
  });

  it("every status the hook can set is a member", () => {
    const src = read(PERSIST);
    const set = [...src.matchAll(/setAutoSaveStatus\("([a-z]+)"\)/g)].map((m) => m[1]);
    expect(set.length).toBeGreaterThan(0);
    // Read from the union rather than repeated here: a second hard-coded list is
    // how the two files drifted once already (see the test above this one), and a
    // member added on the formatter side alone would silently never render.
    const members = read("lib/humanSaveStatus.ts")
      .match(/export type AutoSaveStatus = ([^;]+);/)![1]
      .split("|").map((s) => s.trim().replace(/"/g, ""));
    for (const s of new Set(set)) expect(members, `setAutoSaveStatus("${s}") is not in the union`).toContain(s);
  });
});

describe("what this does not touch", () => {
  it("PR-20's guard inside saveDraft is unchanged", () => {
    const src = read(PERSIST);
    const at = src.indexOf("if (signedContentLocked) {");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("return null;", at) + "return null;".length);
    // It still refuses without claiming a failure and without setting a chip:
    // the chip is the caller's business, and the caller is what changed.
    expect(block).not.toContain("setAutoSaveStatus");
    expect(block).not.toContain("Save failed");
    expect(block).toContain("if (!opts?.silent) {");
    expect(block).toContain("Save refused — the report is signed");
    expect(block).toContain("return null;");
  });

  it("PR-20's ratchet still holds its own line, deliberately rewritten", () => {
    const t = read(PR20);
    expect(t).not.toContain('expect(persistence).toContain("if (!isDirty || !isOnline || isFinalized || isMobile) {");');
    expect(t).toContain("the auto-save effect guards on the same composed predicate");
    expect(t).toContain("the leave gate no longer calls a refusal a failed save");
  });

  it("the existing label tests are untouched", () => {
    const t = read(UX);
    expect(t).toContain('expect(formatHumanSaveStatus({ ...base, autoSaveStatus: "error" })?.label).toBe("Save failed");');
    expect(t).toContain('it("shows Saving… / Saved / relative / Offline / failed"');
  });

  it("the leave gate's busy-guard is unaffected by the new member", () => {
    // `leaveDirtyStudy` blocks on `saving: autoSaveStatus === "saving"`. A
    // refused save is not in flight, so it must not hold the radiologist on the
    // study through that door as well.
    const src = read(PERSIST);
    expect(src).toContain('saving: autoSaveStatus === "saving",');
  });
});

describe("a concurrency refusal says which thing refused it", () => {
  // P0-2 — `refused` is the wording for a POLICY: the report is signed, so the
  // autosave was never going to be allowed. A save the server stopped because the
  // row moved underneath it is a different fact, and printing "Edits not saved —
  // signed" over an unsigned draft would be the chip claiming a reason that is not
  // the one that stopped the save — the exact invariant the `refused` status above
  // is guarded by.
  it("renders the moved-report refusal as its own amber policy", () => {
    expect(fmt("conflict")?.label).toBe("Not saved — other window");
    expect(fmt("conflict")?.tone).toBe("amber");
  });

  it("borrows neither the signed wording nor the failure wording", () => {
    expect(fmt("conflict")?.label).not.toBe(fmt("refused")!.label);
    expect(fmt("conflict")!.label.toLowerCase()).not.toContain("signed");
    expect(fmt("conflict")!.label.toLowerCase()).not.toContain("fail");
  });

  it("fits the 10px chip and keeps the two-clause shape", () => {
    expect(fmt("conflict")!.label.length).toBeLessThanOrEqual("Offline copy saved".length + 8);
    expect(fmt("conflict")!.label.split(" — ").length).toBe(2);
  });

  it("sits below Saving… and refused, and above Save failed", () => {
    const src = read("lib/humanSaveStatus.ts");
    const saving = src.indexOf('input.autoSaveStatus === "saving"');
    const refused = src.indexOf('input.autoSaveStatus === "refused"');
    const conflict = src.indexOf('input.autoSaveStatus === "conflict"');
    const error = src.indexOf('input.autoSaveStatus === "error"');
    expect(refused).toBeGreaterThan(saving);
    expect(conflict).toBeGreaterThan(refused);
    expect(error).toBeGreaterThan(conflict);
  });

  it("has one writer, and it sits under the server's revision refusal", () => {
    const src = read(PERSIST);
    const writers = src.split(/\r?\n/).filter((l) => l.includes('setAutoSaveStatus("conflict")'));
    expect(writers.length, "exactly one writer of the conflict status").toBe(1);
    expect(src, "the writer must be the DRAFT_REVISION_CONFLICT branch")
      .toMatch(/DRAFT_REVISION_CONFLICT[\s\S]{0,600}?setAutoSaveStatus\("conflict"\)/);
    // A refused save is not in flight, so it must not hold the radiologist on the
    // study through the leave gate either.
    expect(src).toContain('saving: autoSaveStatus === "saving",');
  });

  // The refusal's chip survived the save path, and then the 30-second autosave
  // timer — whose own save gets the same 409 and resolves `null` — wrote
  // "Save failed" over it. Two writers, one of them silent, and the sentence the
  // radiologist could act on was replaced by a red label that names no cause.
  it("does not let the autosave timer answer for a refusal", () => {
    const src = read(PERSIST);
    const at = src.indexOf("run().then((id) => {");
    expect(at, "the scheduled autosave must still report back through run().then").toBeGreaterThan(-1);
    const thenBlock = src.slice(at, src.indexOf("}).catch(", at));
    const guard = thenBlock.indexOf("if (id == null && lastSaveRefusalRef.current != null) return;");
    const write = thenBlock.indexOf('setAutoSaveStatus(id != null ? "saved" : "error")');
    expect(write, "the timer writes the chip").toBeGreaterThan(-1);
    expect(guard, "a refusal must return before the timer writes anything").toBeGreaterThan(-1);
    expect(guard, "the guard belongs above the status write").toBeLessThan(write);
    expect(thenBlock.split("setAutoSaveStatus").length - 1, "one status writer in this continuation").toBe(1);
  });
});
