import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { useWorkspace } from "./store";

/**
 * What one Quick Select box click is allowed to claim.
 *
 * #869 found two faults here hiding each other: the use counter never persisted,
 * and the strip rewarded a pick whether or not the write landed. The second was
 * partly invisible because of the first — the false increments did not survive
 * long enough to be noticed.
 *
 * Both halves have since moved, and these tests follow them:
 *
 *  - the strip no longer calls a store writer at all. It calls `onToggle`, the
 *    workspace's one box writer (`handleQuickToggle`), and reads that call's
 *    verdict. The guard #869 added is still what makes a refusal cost nothing;
 *  - the counter is no longer a localStorage key somebody had to remember to
 *    persist. It is the server's own per-user row, so "survives a reload" is now
 *    a property of where the count lives rather than of a `saveTiles` call.
 *
 * `refuseSignedMutation` reads one field, `s.isFinalized`, and that predicate is
 * pinned by signedElsewhereControlLock.contract.test.ts. These tests set it
 * directly rather than replaying a whole signature: the *real* `completeFinalize`
 * path is already covered by the guard-case table in
 * finalizedMutationBoundary.hardening.test.ts, which asserts
 * `refusal: "refused"` for `applyPathologyOverlay`. Duplicating that here would
 * cost a populated report for no extra coverage.
 *
 * There is no DOM harness in this repo (`environment: "node"` repo-wide), so the
 * strip's ordering is pinned from source. Two rules keep that honest:
 *
 *  - every slice is bounded by two of the component's own markers, never a
 *    character budget, because a fixed-width slice silently empties when a
 *    comment grows — and every assertion on an empty string then passes;
 *  - every read normalises CRLF first. An `\n` anchor never matches a `\r\n`
 *    file, and `indexOf` returning -1 slices to garbage rather than failing.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "components", "radiology", "zai-workspace");

const read = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Comments out, so a slice can be asserted on without a prose mention of a word
 * counting as code. `findings-editor.tsx` opens with a docblock that names
 * `<QuickSelectStrip field="findings" />` complete with its own `/>`; scanning
 * raw text counted it as a render site.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const stripSrc = () => codeOnly(read("quick-select-strip.tsx"));

afterEach(() => {
  useWorkspace.setState({ isFinalized: false });
});

describe("a store writer reports a refusal as a refusal", () => {
  beforeEach(() => {
    useWorkspace.setState({ isFinalized: true, findingsText: "", recommendationText: "" });
  });

  it("mergeField refuses the source a box click now carries", () => {
    // `mergeField` returned void until #869, so no caller could ever learn a
    // write was refused. The strip no longer calls it — `applyPathologyOverlay`
    // does, and that refusal is pinned by
    // finalizedMutationBoundary.hardening.test.ts — but every other clinical
    // writer in the workspace still goes through here, and this is the contract
    // that lets any of them find out.
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-findings")).toBe("refused");
    expect(useWorkspace.getState().recommendationText).toBe("");
  });

  it("and refuses the legacy spelling identically", () => {
    // Drafts saved before the box catalogue carry `"quick-select"` provenance. A
    // reopened one re-merges under that source, and it must not find a writer
    // that became permissive on the way.
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-select")).toBe("refused");
    expect(useWorkspace.getState().recommendationText).toBe("");
  });

  it("an unsigned merge still reports applied", () => {
    useWorkspace.setState({ isFinalized: false });
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-findings")).toBe("applied");
    expect(useWorkspace.getState().recommendationText).toBe("Consider MRI.");
  });

  it("a duplicate insert reports applied, so no click loses credit for it", () => {
    // The no-op early return fires when text and provenance are both unchanged.
    // Reporting that as a refusal would withhold credit for a box whose sentence
    // is, in fact, in the report.
    useWorkspace.setState({ isFinalized: false });
    useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-findings");
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-findings")).toBe("applied");
  });
});

describe("the strip rewards a pick only when it landed", () => {
  const pickBody = () => {
    const src = stripSrc();
    const start = src.indexOf("const pick = (box:");
    expect(start, "quick-select-strip must still own a pick handler").toBeGreaterThan(-1);
    const end = src.indexOf("\n  };", start);
    expect(end, "the pick handler must still be closed").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("reads the one writer's verdict instead of discarding it", () => {
    const body = pickBody();
    expect(body).toMatch(/const outcome = onToggle\(/);
    // A bare `onToggle(box, true, …)` statement is the shape that let the refusal
    // go unseen: the call happens, nothing reads it.
    expect(body).not.toMatch(/^\s*onToggle\(/m);
  });

  it("the guard precedes both the counter and the after-pick", () => {
    const body = pickBody();
    const guard = body.indexOf('=== "refused"');
    const count = body.indexOf("countUse.mutate(box.id)");
    const after = body.indexOf("onAfterPick?.(field)");
    expect(guard, "the refusal guard must exist").toBeGreaterThan(-1);
    expect(count, "the counter must still be called").toBeGreaterThan(-1);
    expect(after, "the after-pick must still be called").toBeGreaterThan(-1);
    // Both, not just one. `onAfterPick` is `feedbackAfterAbnormalApply()` at the
    // findings strip — positive feedback for a write that did not happen — and
    // `void saveDraft({ silent: true })` at the impression and recommendation
    // strips, so a refused click also fired a save the server is certain to
    // refuse.
    expect(guard).toBeLessThan(count);
    expect(guard).toBeLessThan(after);
  });

  it("counts a pending pick, because that is a real use awaiting confirmation", () => {
    // Guards the over-correction: gating on `=== "applied"` would drop legitimate
    // uses that went to the same-slot confirmation queue. That queue is resolved
    // by ConfirmOverwriteDialog, not by a second click on the box, so a
    // `"pending"` pick would otherwise never be counted at all.
    expect(pickBody()).toContain('if (outcome === "refused") return;');
    expect(pickBody()).not.toContain('if (outcome !== "applied") return;');
  });

  it("counts a concept-less box, whose warning is advisory and blocks nothing", () => {
    // A box nobody has assigned a clinical concept to writes its own wording and
    // simply cannot conclude or supersede a scaffold normal. That is a permanent
    // legitimate state, so it must not cost the click its use.
    expect(pickBody()).not.toMatch(/concept/i);
  });
});

describe("the count is a row, not a browser key", () => {
  const countUseBlock = () => {
    const src = stripSrc();
    const start = src.indexOf("const countUse = useMutation({");
    expect(start, "the strip must still own the usage counter").toBeGreaterThan(-1);
    const end = src.indexOf("const pick = (box:", start);
    expect(end, "the counter must still sit above the pick that calls it").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("writes the server's per-user usage row", () => {
    expect(countUseBlock()).toContain("api.post<UsageRow>(`/api/radiology/quick-select/usage/${findingId}`");
  });

  it("and takes the count back from the server rather than from its own arithmetic", () => {
    // #869's actual complaint — the count did not survive a reload — is answered
    // by where it lives now: a row keyed to the signed-in radiologist,
    // repopulated by the same query on mount. Replacing the cached row with the
    // server's is what keeps the five strips on one workspace agreeing with each
    // other and with the Clinic Quick Select panel, instead of each holding its
    // own incremented guess.
    const block = countUseBlock();
    expect(block).toContain('["radiology-quick-select-usage"]');
    expect(block).toMatch(/qc\.setQueryData<UsageRow\[\]>/);
    expect(stripSrc()).toContain('queryKey: ["radiology-quick-select-usage"]');
  });

  it("leaves no localStorage in the strip at all", () => {
    // `stripSrc`, not `read`: the counter's own history comment names the key it
    // replaced, and prose is not a write.
    expect(stripSrc()).not.toMatch(/localStorage/);
  });

  it("and a count that fails cannot fail the click that triggered it", () => {
    expect(countUseBlock()).toContain("onError: () => {}");
  });
});

/**
 * Every render site must know about the lock.
 *
 * Scanned across all of `components`, not pinned to a known list of files, so a
 * new `<QuickSelectStrip>` added anywhere breaks this rather than silently
 * joining the set of controls that stay live on a signed report. That is how the
 * strip became the only clinical control #861 did not cover: it had no `disabled`
 * prop to pass, so no call site could express the lock even while a sibling two
 * lines above it did.
 *
 * Element text is sliced to the next `/>`. A `/>` inside an attribute string
 * would truncate that, and the tests below would then fail loudly rather than
 * pass quietly — which is the right direction for a ratchet to break.
 */
describe("every Quick Select render site carries the lock", () => {
  const COMP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "components");

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (name.endsWith(".tsx")) acc.push(p);
    }
    return acc;
  }

  function elements(src: string, tag: string): string[] {
    const out: string[] = [];
    let at = src.indexOf(tag);
    while (at !== -1) {
      // A JSX tag is followed by whitespace, `>` or `/`. The strip's own file
      // declares `useMemo<QuickSelectStripBox[]>`, which starts with the same
      // characters and is not a render site — counting it made the census five
      // and then failed the lock assertion on a type argument.
      const next = src[at + tag.length];
      if (next !== undefined && !/[\s>/]/.test(next)) {
        at = src.indexOf(tag, at + tag.length);
        continue;
      }
      const close = src.indexOf("/>", at);
      expect(close, `${tag} must still be closed`).toBeGreaterThan(at);
      out.push(src.slice(at, close));
      at = src.indexOf(tag, close + 2);
    }
    return out;
  }

  const base = (p: string) => p.split(/[\\/]/).pop();
  const strips: { file: string; el: string }[] = [];
  const editors: { file: string; el: string }[] = [];
  for (const file of walk(COMP)) {
    const src = codeOnly(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    for (const el of elements(src, "<QuickSelectStrip")) strips.push({ file, el });
    for (const el of elements(src, "<FindingsEditor")) editors.push({ file, el });
  }

  it("the scan found the render sites it claims to cover", () => {
    // Positive control. An empty `strips` array would make every assertion below
    // vacuously true, so the population is pinned first.
    expect(strips.length, "no <QuickSelectStrip> render site found — the scan is broken").toBe(4);
    expect(editors.length, "the <FindingsEditor> population changed").toBe(5);
  });

  it("each render passes the composed lock, and nothing else", () => {
    // #861's lesson, restated for the strip: `isFinalized` is a same-session fact
    // and `isLocked` is another user holding the lock, so neither knows about a
    // signature made on another workstation. `contentLocked` composes both plus
    // the signed-elsewhere ratchet.
    //
    // Forwarding a prop is no longer a legitimate shape. The one wrapper that
    // used to do it — `findings-editor.tsx`, rendering a strip on behalf of its
    // own caller — hosts none now, so every site has a view-model to read.
    for (const { file, el } of strips) {
      const m = el.match(/disabled=\{([^}]+)\}/);
      expect(
        m,
        `${base(file)}: a <QuickSelectStrip> renders without disabled={} — `
        + "a box that writes into the report stayed live on a signed report",
      ).not.toBeNull();
      expect(m![1].trim(), `${base(file)}: disabled={${m![1].trim()}} is not the composed lock`).toBe("contentLocked");
    }
  });

  it("and no editor hosts a strip of its own, so a section cannot show an ungated one", () => {
    // The editor's copy was a second, blunter strip stacked directly under the
    // section's own: no `bodyPart`, so it scored every region-scoped box out, and
    // no `onAfterPick`, so a pick from it never saved. Deleting it is what removes
    // `hideQuickSelect` / `quickSelectDisabled` — and with them the one render
    // site whose lock depended on a caller remembering to forward it.
    const editor = codeOnly(read("findings-editor.tsx"));
    expect(editor, "findings-editor hosts a strip again").not.toContain("<QuickSelectStrip");
    expect(editor).not.toMatch(/hideQuickSelect|quickSelectDisabled/);
    // Positive control: `codeOnly` removed the docblock, not the component.
    expect(editor).toContain("export function FindingsEditor({");
    for (const { file, el } of editors) {
      expect(
        el,
        `${base(file)}: a <FindingsEditor> still passes a strip prop it no longer has`,
      ).not.toMatch(/hideQuickSelect|quickSelectDisabled/);
    }
  });

  it("favouriting and editing a box are NOT disabled", () => {
    // They write the clinic catalogue and the radiologist's own favorites, not
    // the report. A signed report is no reason to stop someone reorganising their
    // own boxes, and PR-24 started from a scoping decision that these stay
    // reachable — so the display gate must not quietly widen past the pick.
    const src = stripSrc();
    const at = src.indexOf("function QuickSelectBoxChip");
    expect(at, "the chip component moved or was renamed").toBeGreaterThan(-1);
    const box = src.slice(at);
    expect(box).toContain("onClick={disabled ? undefined : exact ? onReview : onPick}");
    // Bounded on the handler's own markers rather than a list of spellings to
    // avoid: a list is only as complete as the person writing it, and
    // `if (disabled) return;` inserted above `onFav()` is exactly the shape that
    // would slip past one. `lastIndexOf` up to the call, because the chip has
    // three hover buttons and the review one comes first.
    for (const call of ["onFav();", "onEdit();"]) {
      const region = box.slice(box.lastIndexOf("onClick={(e) => {", box.indexOf(call)), box.indexOf(call));
      expect(region.replace(/\s+/g, " ").trim(), `${call} is gated`).toBe("onClick={(e) => { e.stopPropagation();");
    }
    for (const forbidden of ["disabled ? undefined : onFav", "disabled ? undefined : onEdit"]) {
      expect(box, `the lock leaked into a catalogue action: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("adding a box is NOT disabled either", () => {
    const src = stripSrc();
    // Two affordances open the same editor: the header button and the dashed
    // "Add box" tile at the end of the row.
    expect(src.match(/onClick=\{\(\) => setEditing\(\{ box: null \}\)\}/g)).toHaveLength(2);
    expect(src).not.toContain("disabled ? undefined : () => setEditing");
  });

  it("removing a box from a signed report IS disabled", () => {
    // The one control in the review panel that writes the report. Reading back
    // what a box wrote stays available; taking it back does not.
    const src = stripSrc();
    const at = src.indexOf("function QuickSelectReview");
    expect(at, "the review panel moved or was renamed").toBeGreaterThan(-1);
    const review = src.slice(at);
    const label = review.indexOf("Remove from report");
    expect(label, "the review panel lost its Remove control").toBeGreaterThan(-1);
    // lastIndexOf, not indexOf: "Keep" is also a <Button> and comes first.
    expect(review.slice(review.lastIndexOf("<Button", label), label)).toContain("disabled={disabled}");
  });
});
