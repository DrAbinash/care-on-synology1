import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A report signed in ANOTHER session left every clinical tool control in the
 * reporting workspace live and clickable.
 *
 * The controls gated on `disabled={isLocked || isFinalized}`, and neither half
 * of that knows about a signature made elsewhere:
 *
 *   - `isFinalized` (useWorkspaceClinicalUi.tsx:714) comes straight from the
 *     workspace store, whose only writer of `true` is `completeFinalize`
 *     (store.ts:1236). It is therefore true only for a report signed in this
 *     browser session. store.ts:330-334 says so outright.
 *   - `isLocked` (useWorkspaceClinicalUi.tsx:799) is
 *     `studyLock.status === "locked-by-other"` — another user holding the study
 *     lock. Nothing to do with signedness at all.
 *
 * The file already knew this and had worked around it once, locally:
 * useWorkspaceClinicalUi.tsx:1141-1144 gates the rescue backup on
 * `studyIsSignedElsewhere` with the comment "isFinalized alone is narrower: a
 * report signed in ANOTHER session leaves it false." The tool controls never
 * got the same treatment.
 *
 * What they should have read is `contentLocked`
 * (useWorkspaceClinicalUi.tsx:802-803), the one predicate that includes
 * `studyIsSignedElsewhere` — which itself derives from `authoritativeStatus`
 * (:789), the per-study detail query preferred over the queue row. It was
 * already in the view-model, already pinned as an expression by
 * clinicalStateReset.hardening.test.ts ("drives all three lock decisions from
 * the authoritative status"), and already destructured in every workspace
 * component — seven of which never read it. What no test pinned was that any
 * control actually consulted it.
 *
 * The same file disagreed with itself about the guard shape too: four handler
 * guards already read `contentLocked` (:1795, :1867, :1891, :2163) while three
 * others — the two dictation writers and `handleEditBeforeInsert` — read the
 * blind pair. Both are covered below.
 *
 * These are source-contract ratchets, because this repo has no DOM or React
 * harness (`environment: "node"` repo-wide, no @testing-library, no jsdom). The
 * one exception is the truth table below, which evaluates the real predicate
 * text lifted out of the hook rather than a paraphrase of it.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const HOOK = "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx";
const CANVAS = "components/radiology/workspace/ReportCanvas.tsx";
const RAIL = "components/radiology/workspace/ReportingToolsRail.tsx";
const VIEWER = "components/radiology/workspace/ViewerColumn.tsx";

/** The three files whose clinical tool controls were gated on the blind pair. */
const GATED = [CANVAS, RAIL, VIEWER] as const;

/**
 * The hook is added to the pair ban but not to the REPORT_FINAL or
 * `contentLocked`-count checks below: it is where `authoritativeStatus`,
 * `studyIsSignedElsewhere` and `contentLocked` are all *defined*, so it mentions
 * REPORT_FINAL legitimately and its contentLocked count is a different kind of
 * number. What must hold there is narrower and pinned separately — no handler
 * guard reads the blind pair, and the ones that guard a clinical write read
 * `contentLocked`.
 */
const NO_PAIR = [...GATED, HOOK] as const;

const BLIND = "disabled={isLocked || isFinalized}";

/**
 * The pair itself, not just its `disabled={…}` spelling. A mutation run found
 * that pinning only the `disabled` form let three reverts through: a
 * `measureDisabled={isLocked || isFinalized}` prop, an
 * `if (isLocked || isFinalized) return;` handler guard, and a queue-row variant.
 * None of those is a legitimate gate on a signed report either, so the pair is
 * banned outright in these three files.
 */
const PAIR = "isLocked || isFinalized";

/**
 * The same gate in its negated, render-guard spelling: `{!isLocked && !isFinalized && <Control/>}`.
 *
 * Banning `PAIR` outright did not catch this, because it is a different string — and the
 * substitution `!contentLocked` is not something a reader would write by mistake, so nothing
 * drew attention to it. Fourteen guards in ReportCanvas survived #861 in exactly this spelling,
 * still rendering live on a report signed on another workstation. A ratchet that pins one spelling
 * of a predicate has pinned the spelling, not the property.
 *
 * The reversed order `!isFinalized && !isLocked` does not occur anywhere in the tree; it is
 * covered by the regex below rather than a second literal, so the ban is over the property.
 */
const NEGATED = "!isLocked && !isFinalized";
const NEGATED_RE = /!\s*is(?:Finalized|Locked)\s*&&\s*!\s*is(?:Finalized|Locked)/;

/**
 * Exact `contentLocked` occurrence counts after the substitution, so the zero
 * above cannot be satisfied by deleting the controls instead of re-gating them.
 * Deliberately tight: adding or removing a gated control in these files should
 * break this test and make whoever does it decide whether the new control is a
 * clinical writer, then update the number here.
 *
 * CANVAS is 55 because fourteen render guards moved from the negated pair to
 * `!contentLocked`; each one adds exactly one occurrence.
 */
const EXPECTED_CONTENT_LOCKED: Record<string, number> = {
  [CANVAS]: 55,
  [RAIL]: 33,
  [VIEWER]: 7,
};

/**
 * `REPORT_FINAL` hand-rolled into a gate is the third predicate this replaces —
 * it reads the queue row, which `authoritativeStatus` treats only as the
 * fallback behind the detail query, so it can disagree with `contentLocked`.
 * The remaining occurrences are status displays and the Sign button, pinned
 * below; the counts are what stop a future sweep from quietly changing either.
 */
const EXPECTED_REPORT_FINAL: Record<string, number> = {
  [CANVAS]: 2,
  [RAIL]: 1,
  [VIEWER]: 0,
};

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Lifts the real lock declarations out of the hook and returns `contentLocked`
 * as a callable predicate, so the superset property is measured against the
 * source that ships rather than against a copy of it that could drift.
 *
 * Both declarations are lifted, not just the last one: the predicate is composed
 * (`signedContentLocked` then `contentLocked = isLocked || signedContentLocked`),
 * so evaluating the second alone would reference a name that does not exist in
 * the generated scope. Taking the region verbatim also means this keeps working
 * if the composition is split further, and fails loudly rather than silently if
 * `contentLocked` ever stops being a plain const.
 */
function lockDeclarations(): string {
  const src = read(HOOK);
  const at = src.indexOf("const signedContentLocked =");
  expect(at, "the hook must still define signedContentLocked").toBeGreaterThan(-1);
  const lockedAt = src.indexOf("const contentLocked =", at);
  expect(lockedAt, "the hook must still define contentLocked after it").toBeGreaterThan(at);
  const end = src.indexOf(";", lockedAt);
  expect(end).toBeGreaterThan(lockedAt);
  return src.slice(at, end + 1);
}

function extractContentLocked(): (
  isLocked: boolean,
  isFinalized: boolean,
  studyIsSignedElsewhere: boolean,
  allowEditSigned: boolean,
) => boolean {
  // eslint-disable-next-line no-new-func -- evaluating the shipped expression is the point
  return new Function(
    "isLocked",
    "isFinalized",
    "studyIsSignedElsewhere",
    "allowEditSigned",
    `${lockDeclarations()}\nreturn contentLocked;`,
  ) as (a: boolean, b: boolean, c: boolean, d: boolean) => boolean;
}

describe("a report signed in another session locks the tool controls", () => {
  it("no clinical tool control gates on the session-only pair any more", () => {
    for (const rel of GATED) {
      const src = read(rel);
      // The specific shape this PR replaced, kept as its own assertion so a
      // failure names the original spelling rather than only "the pair".
      expect(count(src, BLIND), `${rel} still has disabled={isLocked || isFinalized}`).toBe(0);
      // The replacement is present in the expected quantity, so neither zero
      // here nor the pair ban below can be satisfied by deleting the controls.
      expect(
        count(src, "contentLocked"),
        `${rel}: contentLocked count changed — if a gated control was added or removed, decide whether it writes clinical content, then update EXPECTED_CONTENT_LOCKED`,
      ).toBe(EXPECTED_CONTENT_LOCKED[rel]);
    }
    // And every other spelling of the same gate, in the views and in the hook
    // that supplies them.
    for (const rel of NO_PAIR) {
      expect(count(read(rel), PAIR), `${rel} still gates something on isLocked || isFinalized`).toBe(0);
      // The negated render-guard spelling, both as the literal that actually
      // occurred and as the property (either operand order) that a future one
      // might take.
      expect(count(read(rel), NEGATED), `${rel} still renders something behind !isLocked && !isFinalized`).toBe(0);
      expect(
        read(rel).match(NEGATED_RE),
        `${rel} still gates a render on the two session-only flags in some order`,
      ).toBeNull();
    }
    // The count is pinned as well as the zero, so a sweep cannot satisfy both by
    // deleting the fourteen guards rather than re-gating them.
    expect(count(read(CANVAS), "!contentLocked"), "ReportCanvas render guards now gated on !contentLocked").toBe(14);
  });

  it("every handler guard in the hook that protects a clinical write reads contentLocked", () => {
    // Seven, not three. Four of these already read contentLocked before this PR
    // (:1795, :1867, :1891, :2163) while three others in the same file — the two
    // dictation writers and handleEditBeforeInsert — read the blind pair, so the
    // file disagreed with itself about what "locked" means. The count is what
    // stops it from splitting again; the three dep arrays are pinned so a guard
    // cannot be left reading a value it no longer closes over.
    const src = read(HOOK);
    expect(count(src, "if (contentLocked) return;")).toBe(7);
    expect(src).toContain("}, [contentLocked, dictationTranscript, voiceComposer, voiceSession]);");
    expect(src).toContain(
      "contentLocked, dictationTranscript, composerQuickFindings, composerRegion, activateReportSection,",
    );
    expect(src).toContain("}, [contentLocked]);");
  });

  it("no gate hand-rolls the queue-row status any more", () => {
    for (const rel of GATED) {
      expect(
        count(read(rel), "REPORT_FINAL"),
        `${rel}: REPORT_FINAL count changed — a gate reading the queue row can disagree with contentLocked, which prefers the detail query`,
      ).toBe(EXPECTED_REPORT_FINAL[rel]);
    }
    // What the surviving occurrences actually are: status displays and the Sign
    // button, none of which is a lock.
    expect(read(RAIL)).toContain(
      'reportFinalized={isFinalized || workflow.currentRow.status === "REPORT_FINAL"}',
    );
    expect(read(CANVAS)).toContain(
      'reportFinalized={isFinalized || workflow.currentRow!.status === "REPORT_FINAL"}',
    );
  });

  it("each of the three files still has contentLocked in scope, not just referenced", () => {
    // A substitution to an identifier that is not destructured in that component
    // would not compile, but this pins the wiring explicitly so the reason a
    // future failure appears is obvious. `\s*$` rather than `$` because this
    // tree is checked out CRLF and a bare `$` matches before the \n, not the \r.
    for (const rel of GATED) {
      expect(read(rel), `${rel} must destructure contentLocked from the view-model`)
        .toMatch(/^\s{4}contentLocked,\s*$/m);
    }
  });

  it("the predicate it now reads really does include the authoritative half", () => {
    const block = lockDeclarations();
    expect(block).toContain("isLocked");
    expect(block).toContain("isFinalized");
    expect(block, "contentLocked must include the signed-elsewhere half").toContain("studyIsSignedElsewhere");
    // The composition itself: contentLocked is the lock OR the signed half, so
    // neither can be dropped without the executable loop below naming a row.
    expect(block).toContain("const contentLocked = isLocked || signedContentLocked;");
  });

  it("and that half comes from the detail query the workspace prefers, not the queue row", () => {
    const src = read(HOOK);
    expect(src).toContain(
      "const authoritativeStatus = worklistDetailQ.data?.status ?? workflow.currentRow?.status ?? null;",
    );
    expect(src).toContain(
      'const studyIsSignedElsewhere = authoritativeStatus === "REPORT_FINAL" || authoritativeStatus === "DELIVERED";',
    );
    expect(src).toContain('const isLocked = studyLock.status === "locked-by-other";');
  });

  it("the substitution can only ever disable more controls, never fewer", () => {
    // Executed, not asserted as text: the real initialiser is lifted out of the
    // hook and evaluated over every input combination against the expression it
    // replaced. If a future edit to contentLocked dropped the isLocked or
    // isFinalized half, some combination would flip from disabled to enabled and
    // this would name it.
    //
    // Scoped to allowEditSigned === false, which is the only value it can have:
    // the flag is `useState(false)` (useWorkspaceClinicalUi.tsx:574) and its one
    // setter call passes false (:1941). With the trial unlock genuinely on,
    // contentLocked is *designed* to re-enable a signed report, so including
    // those rows here would assert against the predicate's own purpose. The next
    // test pins that the unlock is still unreachable.
    const contentLocked = extractContentLocked();
    const regressions: string[] = [];
    for (const isLocked of [false, true]) {
      for (const isFinalized of [false, true]) {
        for (const studyIsSignedElsewhere of [false, true]) {
          const before = isLocked || isFinalized;
          const after = contentLocked(isLocked, isFinalized, studyIsSignedElsewhere, false);
          if (before && !after) {
            regressions.push(
              `{isLocked:${isLocked}, isFinalized:${isFinalized}, signedElsewhere:${studyIsSignedElsewhere}}`,
            );
          }
        }
      }
    }
    expect(regressions, `controls that were disabled and are now enabled: ${regressions.join(", ")}`).toEqual([]);
  });

  it("and, in the render-guard direction, can only ever hide more controls", () => {
    // The fourteen ReportCanvas guards are the negation of the same pair, so the
    // property that matters there is the mirror image: a control that was hidden
    // must not become visible. Substituting `!contentLocked` for
    // `!isLocked && !isFinalized` widens the lock, so it narrows what renders.
    //
    // Executed over the lifted initialiser for the same reason as above, and for
    // the same scoping: allowEditSigned is pinned false by the next test.
    const contentLocked = extractContentLocked();
    const revealed: string[] = [];
    for (const isLocked of [false, true]) {
      for (const isFinalized of [false, true]) {
        for (const studyIsSignedElsewhere of [false, true]) {
          const shownBefore = !isLocked && !isFinalized;
          const shownAfter = !contentLocked(isLocked, isFinalized, studyIsSignedElsewhere, false);
          if (shownAfter && !shownBefore) {
            revealed.push(
              `{isLocked:${isLocked}, isFinalized:${isFinalized}, signedElsewhere:${studyIsSignedElsewhere}}`,
            );
          }
          // The signed-elsewhere row is the whole point of the change: nothing
          // locked before, something locked now, so the guard must have closed.
          if (!isLocked && !isFinalized && studyIsSignedElsewhere) {
            expect(shownBefore, "the old guard rendered this").toBe(true);
            expect(shownAfter, "the new guard still renders it").toBe(false);
          }
        }
      }
    }
    expect(revealed, `controls that were hidden and are now rendered: ${revealed.join(", ")}`).toEqual([]);
  });

  it("and the trial-phase unlock that would weaken it is still unreachable", () => {
    // contentLocked drops the signed half when allowEditSigned is true, so the
    // superset property above rests entirely on that flag never being set. This
    // is the assertion that keeps the previous test honest rather than lucky.
    const src = read(HOOK);
    expect(src).toContain("const [allowEditSigned, setAllowEditSigned] = useState(false);");
    const calls = src.match(/setAllowEditSigned\([^)]*\)/g) ?? [];
    expect(calls.length, "the hook must still have exactly one setter call").toBe(1);
    expect(calls[0]).toBe("setAllowEditSigned(false)");
  });

  it("newly covers exactly the case the old expression missed", () => {
    const contentLocked = extractContentLocked();
    // Signed in another session, nobody else holding the lock, not signed here:
    // the combination all 76 sites were blind to.
    expect(contentLocked(false, false, true, false)).toBe(true);
    // The same study once the signature is withdrawn.
    expect(contentLocked(false, false, false, false)).toBe(false);
    // Locked by another user, nothing signed — disabled before and after.
    expect(contentLocked(true, false, false, false)).toBe(true);
  });
});

describe("what this deliberately does not change", () => {
  it("leaves print, export and share live on a signed report", () => {
    // The whole point of gating the tool controls is that their edits cannot be
    // saved. Reading and handing over the report is still legitimate on a
    // signed one, and ReportExportPanel is hard-wired live rather than gated on
    // any lock predicate. If a future sweep replaces this with contentLocked, a
    // radiologist loses the ability to print a signed report — so it is pinned.
    const canvas = read(CANVAS);
    const at = canvas.indexOf("<ReportExportPanel");
    expect(at, "ReportExportPanel must still be rendered").toBeGreaterThan(-1);
    const block = canvas.slice(at, at + 2000);
    expect(block).toContain("disabled={false}");
    expect(block).toContain("onExportPdf={handleExportPdf}");
    expect(block).toContain("onPrintLikeFinal={handlePrintLikeFinal}");
  });

  it("leaves the Sign and Save buttons on their own explicit predicates", () => {
    // Those two already carry a hand-rolled authoritative check, and they are
    // the subject of other in-flight work. Sweeping them into contentLocked
    // here would change what the Sign button does, which is not this PR's claim.
    const canvas = read(CANVAS);
    expect(canvas).toMatch(/finalizeDisabled=\{!studyId \|\| isLocked \|\| \(!allowEditSigned && \(isFinalized \|\| workflow\.currentRow\?\.status === "REPORT_FINAL"\)\)\}/);
    expect(canvas).toContain("saveDisabled={!isOnline || isLocked || (isFinalized && !allowEditSigned)}");
  });

  it("leaves reportFinalized a statement about the report, not about the lock", () => {
    // contentLocked is true when another user merely holds the study lock, so
    // substituting it here would label an unsigned report as finalized. Pinning
    // the distinction is what keeps the two ideas from being merged later.
    expect(read(RAIL)).toContain(
      'reportFinalized={isFinalized || workflow.currentRow.status === "REPORT_FINAL"}',
    );
  });

  it("does not touch the store guard, which stays same-session", () => {
    // refuseSignedMutation still reads only isFinalized, so it still does not
    // fire for a report signed elsewhere. That is a structural limit, not an
    // oversight: the store has no field carrying the server's status — it
    // mentions REPORT_FINAL and studyIsSignedElsewhere only inside its own
    // comment — so teaching the guard the authoritative status means a new state
    // key plus a hydration path from the hook, not a substitution.
    const store = read("lib/zai-workspace/store.ts");
    expect(store).toContain("function refuseSignedMutation(s: S, action: string, announce = true): boolean {");
    expect(store).toContain("if (!s.isFinalized) return false;");
    // Pinned so the reason stays structural rather than "the refusal is silent":
    // since #858 the guard does have a voice, and this test would need a
    // different justification if that were ever reverted.
    expect(store).toContain("if (announce) announceSignedMutationRefusal(action);");
    const outsideComments = store
      .split(/\r?\n/)
      .filter((l) => (l.includes("REPORT_FINAL") || l.includes("studyIsSignedElsewhere")) && !l.trimStart().startsWith("*"));
    expect(outsideComments, "the store gained a view of the server status — the guard can now be widened").toEqual([]);
  });

  it("leaves two known gaps open, counted so they cannot widen quietly", () => {
    // Disclosed rather than fixed here, for two different reasons.
    //
    // useOhifViewerBridge takes isLocked and isFinalized as parameters and has
    // no contentLocked in scope, so gating its seven guards is a signature
    // change and a call-site change, not a substitution. Its controls are
    // reached through ViewerColumn, which this PR does gate, so the visible
    // affordance is already closed.
    //
    // applyVoiceComposerWithUndo and insertRawDictation have no lock guard at
    // all — a hole wider than this PR's subject, because it is open for a report
    // signed in THIS session too. VoiceCommandBar is rendered without any lock
    // prop (WorkspaceTopBar.tsx:630-644), so closing it properly means deciding
    // whether that bar gets a disabled state.
    expect(count(read("hooks/radiology-workspace/useOhifViewerBridge.ts"), PAIR)).toBe(7);
    const hook = read(HOOK);
    for (const fn of [
      "const applyVoiceComposerWithUndo = useCallback((force?: boolean) => {",
      "const insertRawDictation = useCallback(() => {",
    ]) {
      const at = hook.indexOf(fn);
      expect(at, `${fn} must still exist`).toBeGreaterThan(-1);
      expect(hook.slice(at, hook.indexOf("}, [", at)), `${fn} gained a guard — update this test`).not.toContain("contentLocked");
    }
  });
});
