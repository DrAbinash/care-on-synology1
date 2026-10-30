/**
 * PR-20 — a save the server was certain to refuse.
 *
 * `useDraftPersistence`'s 30-second auto-save effect has refused a signed study
 * since it was written. `saveDraft`, the function that effect calls, never did.
 * That was harmless while the effect was the only caller, and it stopped being
 * harmless as callers accumulated around it: the top bar's Save button, the
 * command palette's `save`, four Quick Select pick handlers, the structured-values
 * debounce and the Word export all call `saveDraft` directly, and none of them
 * checks anything first.
 *
 * On a signed study every one of those is a request the server is certain to
 * refuse. `assertDraftWritable` throws 409 REPORT_LOCKED when the worklist row is
 * REPORT_FINAL or DELIVERED or already carries a reportId, and again when the
 * draft itself is finalized; `radiologyHardening.request.test.ts` case 14 has
 * pinned the endpoint's answer for years. So the client was not at risk of
 * writing anything — it was at risk of *saying* something wrong.
 *
 * What it said. `saveDraft`'s catch toasts `{ title: "Save failed" }` and honours
 * `silent` only on the success path, so a silent caller still got the red toast.
 * Two consequences, both visible:
 *
 *   • Exporting a signed report to Word ran `saveDraft({ silent: true })` first,
 *     because the letter-pad branch prefers a server-rendered layout when a draft
 *     or a linked report exists. The export then succeeded from the signed report
 *     and the radiologist was shown "Save failed" during a save that was never
 *     needed and could never have worked.
 *   • Clicking a Quick Select tile on a signed study refused the write in the
 *     store, announced that refusal (PR-19), and then `onAfterPick` fired a
 *     silent draft save whose 409 replaced the announcement. `TOAST_LIMIT` is 1,
 *     so the explanation was evicted within one round trip by a message that
 *     blamed the system for a policy.
 *
 * The guard is in `saveDraft` rather than in its callers because the callers are
 * ten and growing, and because the failure mode of a missed one is a toast that
 * contradicts the one next to it.
 *
 * Why the composed predicate. `isFinalized` is written only by `completeFinalize`
 * and nothing rehydrates it from the server, so it is true only inside the
 * session that signed. A study signed elsewhere, or signed here and reopened,
 * arrives with `isFinalized` false and the server's REPORT_LOCKED as the only
 * thing standing in the way. `contentLocked` in `useWorkspaceClinicalUi` already
 * knew this — it ORs in `studyIsSignedElsewhere`, read from the worklist detail
 * query. This passes that same signed half down composed, so the two cannot
 * drift, and deliberately leaves out `isLocked`: a study held by another
 * radiologist deserves the server's message, which names them.
 *
 * Source-contract tests, and that is a real limit. `saveDraft` is a `useCallback`
 * inside a hook, this repo has no DOM or React harness (`environment: "node"`
 * repo-wide, no `@testing-library/*`, no jsdom), so nothing here executes the
 * refusal. What follows pins that it is present, that it precedes the request,
 * what it says, and what it must not say. The behavioural backstop is the server's
 * 409, which request-level tests do cover.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ERP = resolve(HERE, "..");

const persistencePath = resolve(ERP, "hooks/radiology-workspace/useDraftPersistence.ts");
const clinicalUiPath = resolve(ERP, "hooks/radiology-workspace/useWorkspaceClinicalUi.tsx");
const persistence = readFileSync(persistencePath, "utf8");
const clinicalUi = readFileSync(clinicalUiPath, "utf8");

/**
 * The body of the `saveDraft` callback: from its declaration to the dependency
 * array that closes it. Located by both ends rather than by a brace count,
 * because the callback contains template-free but deeply nested object literals
 * and a brace matcher would have to understand strings to be trustworthy.
 */
function saveDraftSpan(): string {
  const start = persistence.indexOf("const saveDraft = useCallback(");
  expect(start, "saveDraft must still be declared as a useCallback").toBeGreaterThan(-1);
  const deps = persistence.indexOf("}, [studyId, draftId, isOnline,", start);
  expect(deps, "saveDraft's dependency array must still start with studyId, draftId, isOnline").toBeGreaterThan(start);
  return persistence.slice(start, deps);
}

/**
 * The `if (signedContentLocked) { … }` block, brace-matched. Scoped to the block
 * and not to the whole callback because the callback legitimately contains two
 * `setAutoSaveStatus("error")` calls and a "Save failed" toast that must survive:
 * a genuine failure offline or on the network still has to be reported.
 */
function guardBlock(): string {
  const span = saveDraftSpan();
  const start = span.indexOf("if (signedContentLocked) {");
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < span.length; i += 1) {
    if (span[i] === "{") depth += 1;
    else if (span[i] === "}") {
      depth -= 1;
      if (depth === 0) return span.slice(start, i + 1);
    }
  }
  return "";
}

/** Every non-test source file under the ERP `src` tree. */
function erpSources(dir: string = ERP, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      erpSources(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const sources = erpSources();

describe("the refusal sits inside saveDraft, before anything can be sent", () => {
  it("saveDraft tests the composed signed predicate", () => {
    const block = guardBlock();
    expect(block, "saveDraft must still refuse a signed study").not.toBe("");
    expect(block).toContain("if (signedContentLocked) {");
  });

  it("the refusal comes before the request", () => {
    const span = saveDraftSpan();
    const guard = span.indexOf("if (signedContentLocked) {");
    const request = span.indexOf("saveRadiologyDraft<");
    expect(request, "saveDraft must still post through saveRadiologyDraft").toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(
      guard < request,
      "a refusal placed after the request would only explain a 409 that already happened",
    ).toBe(true);
  });

  it("the refusal comes before the offline branch", () => {
    const span = saveDraftSpan();
    const guard = span.indexOf("if (signedContentLocked) {");
    const offline = span.indexOf("offlineBlockMessage(");
    expect(offline, "saveDraft must still check the offline state").toBeGreaterThan(-1);
    expect(
      guard < offline,
      '"Offline" on a signed report promises that reconnecting would let it save',
    ).toBe(true);
  });

  it("returns without saving and without claiming a failure", () => {
    const block = guardBlock();
    expect(block).toContain("return null;");
    // The offline branch and the catch both set this. The signed refusal must
    // not: nothing failed, and a red "save error" chip in the footer of a
    // correctly signed report is a fault the radiologist did not cause.
    expect(block).not.toContain("setAutoSaveStatus");
    expect(block).not.toContain("Save failed");
  });

  it("does not hand the machine code to the person reading it", () => {
    const block = guardBlock();
    expect(block).not.toContain("REPORT_LOCKED");
    expect(block).not.toContain("signedContentLocked\"");
    expect(block).not.toContain("saveDraft");
  });
});

describe("an explicit save is told why, and a silent one is left to its caller", () => {
  it("speaks only when the caller did not ask for silence", () => {
    const block = guardBlock();
    expect(block).toContain("if (!opts?.silent) {");
    expect(block).toContain("toast({");
  });

  it("names the way back instead of stopping at the refusal", () => {
    const block = guardBlock();
    expect(block).toContain("Report Hub");
    expect(block.toLowerCase()).toContain("withdraw");
    expect(block).toContain("only the signer or an administrator can");
  });

  it("says what was not done, and that the report is signed", () => {
    const block = guardBlock();
    expect(block).toContain("Nothing was saved.");
    expect(block).toContain("the report is signed");
    expect(block).toContain('variant: "destructive"');
    expect(block).toContain("duration: 8000");
  });

  it("stays shorter than the message #855 measured against eight seconds", () => {
    const block = guardBlock();
    const description = block.match(/description:\s*\n\s*"([^"]+)"/);
    expect(description, "the refusal must carry a description").toBeTruthy();
    // #855 shortened the undo refusal from 295 characters to 191 on the grounds
    // that fifty-odd words is twelve to fifteen seconds of reading and the
    // ending was the part nobody reached. This is not the number to beat, but it
    // is the number to stay under.
    expect(description![1].length).toBeLessThanOrEqual(191);
  });
});

describe("the predicate is the composed one, and both halves agree on it", () => {
  it("is a declared option of the hook", () => {
    expect(persistence).toContain("signedContentLocked: boolean;");
    expect(persistence).toContain("isDirty, isFinalized, signedContentLocked, isMobile");
  });

  it("is in saveDraft's dependency array, so it cannot go stale", () => {
    const deps = persistence.match(/\}, \[studyId, draftId, isOnline,([^\]]*)\]\);/);
    expect(deps, "saveDraft's dependency array must still be recognisable").toBeTruthy();
    expect(deps![1]).toContain("signedContentLocked");
  });

  it("does not fall back to the same-session flag alone", () => {
    // `isFinalized` is written only by `completeFinalize`, so guarding on it
    // alone would let through every study signed on another workstation —
    // exactly the population the server refuses.
    expect(saveDraftSpan()).not.toContain("if (isFinalized)");
  });

  it("is composed once in the caller and reused by contentLocked", () => {
    expect(clinicalUi).toContain(
      "const signedContentLocked = (isFinalized || studyIsSignedElsewhere) && !allowEditSigned;",
    );
    expect(clinicalUi).toContain("const contentLocked = isLocked || signedContentLocked;");
    expect(clinicalUi).toContain("signedContentLocked,");
  });

  it("leaves the lock-by-other refusal to the server, which names the holder", () => {
    expect(clinicalUi).not.toContain("const contentLocked = signedContentLocked;");
    expect(saveDraftSpan()).not.toContain("isLocked");
  });
});

describe("what this deliberately does not replace", () => {
  it("the auto-save effect guards on the same composed predicate", () => {
    // This used to read `expect(persistence).toContain("if (!isDirty || !isOnline
    // || isFinalized || isMobile) {")` under the heading "the auto-save effect
    // keeps its own guard". It did keep one, and that guard was blind to a
    // signature made elsewhere — so the effect armed its 30 s timer, called
    // `saveDraft({ silent: true })`, and the refusal above returned null without
    // speaking, which the caller mapped onto `setAutoSaveStatus("error")`. That
    // is the red sticky "Save failed" the test at "returns without saving and
    // without claiming a failure" exists to prevent, arriving through the caller
    // instead of through the guard. Narrowing the guard is not enough on its own:
    // `"idle"|"saving"|"saved"|"error"` had no member that means *refused*, so
    // the effect now sets one.
    expect(persistence).toContain("if (!isDirty || !isOnline || signedContentLocked || isMobile) {");
    expect(persistence).toContain('if (isDirty && signedContentLocked) setAutoSaveStatus("refused");');
    // And the value cannot go stale the way `isFinalized` did.
    const effectDeps = persistence.match(/\}, \[isDirty, isOnline, draftId, ([^\]]*)\]\);/);
    expect(effectDeps, "the auto-save effect's dependency array must still be recognisable").toBeTruthy();
    expect(effectDeps![1]).toContain("signedContentLocked");
    expect(effectDeps![1]).not.toContain("isFinalized");
  });

  it("the leave gate no longer calls a refusal a failed save", () => {
    // `saveAndConfirmLeave` passed `silent: true` to both of its calls, so on a
    // signed report it reached the refusal twice, got null twice, and toasted
    // "Save failed / Could not save before leaving. Stay on this study." — which
    // reads as an invitation to retry, and left Discard as the only way out with
    // nothing on screen to say that Discard was the right answer.
    const start = persistence.indexOf("const saveAndConfirmLeave = useCallback(async () => {");
    expect(start, "saveAndConfirmLeave must still be declared").toBeGreaterThan(-1);
    const body = persistence.slice(start, persistence.indexOf("}, [ensureDraftOnce", start));
    expect(body).toContain("if (signedContentLocked) {");
    expect(body.indexOf("if (signedContentLocked) {")).toBeLessThan(body.indexOf("await ensureDraftOnce();"));
    expect(body).toContain("Nothing to save — the report is signed");
    expect(body).toContain("Choose Discard to leave");
    // The exact wording, the reading budget and the shared "withdraw the
    // signature from Report Hub" sentence are pinned in
    // refusedSaveIsNotAFailedSave.test.ts, which is where a change to this toast
    // should be argued. Kept here only so that someone editing saveDraft's guard
    // finds out the leave gate depends on it.
    expect(body).toContain("withdraw the signature from Report Hub — only the signer or an administrator can.");
    // The genuine-failure branch below it must survive untouched.
    expect(body).toContain('title: "Save failed"');
    expect(body).toContain("Could not save before leaving. Stay on this study.");
    // The leave gate must depend on the ORDERED save (`saveDraftOrdered`, the one
    // save per study that lib/draftSaveQueue.ts serialises), never on the
    // unordered `saveDraft` body it wraps: this gate is one of the saves that
    // races the autosave out of a study, and reaching the body directly would
    // put it back in that race.
    expect(persistence).toContain("}, [ensureDraftOnce, saveDraftOrdered, toast, signedContentLocked]);");
  });

  it("a genuine save failure is still reported", () => {
    expect(persistence).toContain('toast({ title: "Save failed"');
    expect(persistence).toContain('setAutoSaveStatus("error")');
  });

  it("the server still refuses, for both the worklist row and the draft", () => {
    const identity = readFileSync(
      resolve(ERP, "../../api-server/src/lib/radiologyIdentity.ts"),
      "utf8",
    );
    expect(identity).toContain(
      'worklist.status === "REPORT_FINAL" || worklist.status === "DELIVERED" || worklist.reportId',
    );
    expect(identity).toContain("draft.finalReportId || draft.status === \"FINAL\"");
    expect(identity).toContain('"REPORT_LOCKED"');
  });

  it("the request-level pin on the endpoint is still there", () => {
    const hardening = readFileSync(
      resolve(ERP, "../../api-server/src/routes/radiologyHardening.request.test.ts"),
      "utf8",
    );
    expect(hardening).toContain("save-draft after FINAL is rejected");
    expect(hardening).toContain('expect(res.body.code).toBe("REPORT_LOCKED")');
  });
});

describe("the other callers of the same endpoint are named, not fixed", () => {
  it("saveRadiologyDraft is called from exactly three places in two files", () => {
    const callers: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line) => {
        // A call, not the import, the declaration or a comment:
        // `saveRadiologyDraft(` or `saveRadiologyDraft<…>(`.
        if (
          /saveRadiologyDraft(<[^>]*>)?\(/.test(line)
          && !/^\s*(\*|\/\/)/.test(line)
          && !/function saveRadiologyDraft/.test(line)
        ) {
          callers.push(relative(ERP, file).split(sep).join("/"));
        }
      });
    }
    // File names rather than line numbers on purpose: a line pin would fail on
    // any edit above it and would say nothing about the invariant, which is that
    // no new surface grew a path to this endpoint.
    //
    // B-10 removed the Command Center from this register, then its standalone USG
    // shell (pages/UsgCompanionWorkspace.tsx, deleted — it called saveRadiologyDraft
    // and finalizeRadiologyReport directly). Each is a real reduction, not a
    // relabelling: neither page contains a draft-save call any more, so the count
    // cannot come back down by adding a client-side guard — it can only go up if a
    // surface grows an authoring path again. RadiologyReportGenerator.tsx stays
    // listed because the file still exists even though no route renders it
    // (usgWorkspaceContract.test.ts proves the unreachability; deleting the dead
    // page is orphan cleanup, deliberately not part of B-10).
    expect(callers.sort()).toEqual([
      "hooks/radiology-workspace/useDraftPersistence.ts",
      "pages/RadiologyReportGenerator.tsx",
      "pages/RadiologyReportGenerator.tsx",
    ]);
  });

  it("the deleted USG shell cannot be silently reinstated into this register", () => {
    // The register above would go RED if someone re-added a call site, but only
    // after the file came back too. This pins the deletion itself, so a restored
    // file plus a removed register entry cannot both land quietly.
    expect(existsSync(resolve(ERP, "pages/UsgCompanionWorkspace.tsx"))).toBe(false);
    const app = readFileSync(resolve(ERP, "App.tsx"), "utf8");
    expect(app).not.toContain("UsgCompanionWorkspace");
  });

  it("only the workspace one has a client-side signed check", () => {
    // Pinned as a register, not as an achievement. This surface posts to the same
    // endpoint and relies entirely on the server's 409; it contains neither
    // `isFinalized` nor a REPORT_FINAL gate around its save. If it grows a guard
    // this list should shrink, and if another surface appears the test above fails
    // first. (The USG shell used to be the second entry here — it is deleted.)
    for (const rel of [
      "pages/RadiologyReportGenerator.tsx",
    ]) {
      const text = readFileSync(resolve(ERP, rel), "utf8");
      expect(text, `${rel} must not mention isFinalized yet`).not.toContain("isFinalized");
      expect(text, `${rel} must not mention signedContentLocked yet`).not.toContain("signedContentLocked");
    }
  });

  it("the command center is not in either register because it cannot save at all", () => {
    const text = readFileSync(resolve(ERP, "pages/RadiologyCommandCenter.tsx"), "utf8");
    expect(text).not.toContain("saveRadiologyDraft");
    expect(text).not.toContain("writeRescueDraft");
    expect(text).not.toContain("report-status");
  });
});

describe("the locators can say no", () => {
  it("guardBlock returns empty for a callback with no such guard", () => {
    const without = persistence.replaceAll("if (signedContentLocked) {", "if (neverTrueFlag) {");
    const start = without.indexOf("const saveDraft = useCallback(");
    const deps = without.indexOf("}, [studyId, draftId, isOnline,", start);
    const span = without.slice(start, deps);
    expect(span.indexOf("if (signedContentLocked) {")).toBe(-1);
  });

  it("the brace matcher stops at the guard and does not swallow the offline branch", () => {
    const block = guardBlock();
    expect(block).not.toBe("");
    expect(block, "a block that ran on into the offline branch would also contain this").not.toContain("Offline");
    expect(block, "a block that ran on into the catch would also contain this").not.toContain("Save failed");
    expect(block.split("\n").length).toBeLessThan(20);
  });

  it("saveDraftSpan is the callback and not the whole file", () => {
    const span = saveDraftSpan();
    expect(span.length).toBeLessThan(persistence.length / 2);
    expect(span).not.toContain("const ensureDraftOnce");
  });
});
