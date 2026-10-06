import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { useWorkspace } from "./store";
import { loadTiles } from "./quick-select-library";

/**
 * The Quick Select tile counter.
 *
 * Two separate faults lived here, and they hid each other:
 *
 *  - `incrementTileUsage` was the only tile mutator that never called `saveTiles`,
 *    so counts reset on every reload;
 *  - the strip rewarded a pick whether or not the write landed, because both
 *    writers it calls reported a signed-report refusal as success.
 *
 * The second was partly invisible because of the first — the false increments did
 * not survive long enough to be noticed.
 *
 * `refuseSignedMutation` reads one field, `s.isFinalized`, and that predicate is
 * pinned by signedElsewhereControlLock.contract.test.ts. These tests set it
 * directly rather than replaying a whole signature: the *real* `completeFinalize`
 * path is already covered by the guard-case table in
 * finalizedMutationBoundary.hardening.test.ts, which now asserts
 * `refusal: "refused"` for `applyPathologyOverlay`. Duplicating that here would
 * cost a populated report for no extra coverage.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "components", "radiology", "zai-workspace");

let storage: Record<string, string>;
let actualStorage: unknown;

beforeEach(() => {
  storage = {};
  actualStorage = globalThis.localStorage;
  // @ts-expect-error test stub — localStorage is not defined under node.
  globalThis.localStorage = {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
  };
});

afterEach(() => {
  globalThis.localStorage = actualStorage as Storage;
  useWorkspace.setState({ isFinalized: false });
});

const tile = (id: string, usageCount?: number) => ({
  id,
  field: "findings" as const,
  sentence: `sentence for ${id}`,
  bodyParts: ["lumbar_spine"],
  custom: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...(usageCount === undefined ? {} : { usageCount }),
});

describe("the tile usage counter persists", () => {
  it("an increment survives the store, which is what a reload reads back", () => {
    useWorkspace.setState({ quickSelectTiles: [tile("t-1")] });

    useWorkspace.getState().incrementTileUsage("t-1");

    const persisted = loadTiles().find((t) => t.id === "t-1");
    expect(persisted?.usageCount, "the count never reached localStorage").toBe(1);
  });

  it("increments accumulate across calls rather than re-writing a stale array", () => {
    useWorkspace.setState({ quickSelectTiles: [tile("t-2", 4)] });

    useWorkspace.getState().incrementTileUsage("t-2");
    useWorkspace.getState().incrementTileUsage("t-2");

    expect(loadTiles().find((t) => t.id === "t-2")?.usageCount).toBe(6);
  });

  it("leaves updatedAt alone — a use is not an edit to the tile's content", () => {
    useWorkspace.setState({ quickSelectTiles: [tile("t-3")] });
    const before = useWorkspace.getState().quickSelectTiles.find((t) => t.id === "t-3")?.updatedAt;

    useWorkspace.getState().incrementTileUsage("t-3");

    expect(useWorkspace.getState().quickSelectTiles.find((t) => t.id === "t-3")?.updatedAt).toBe(before);
  });

  it("and the mutator this one was measured against still persists", () => {
    // The positive control. `saveTiles` is real and reaches the stub, so the
    // three passing assertions above cannot be green because nothing persists at
    // all in this harness.
    useWorkspace.setState({ quickSelectTiles: [tile("t-4")] });
    useWorkspace.getState().toggleTileFavorite("t-4");
    expect(loadTiles().find((t) => t.id === "t-4")?.favorite).toBe(true);
    // And it is the stub being read, not the in-memory array.
    expect(Object.keys(storage).length, "the library key was never written").toBeGreaterThan(0);
  });
});

describe("the writers report a refusal as a refusal", () => {
  beforeEach(() => {
    useWorkspace.setState({
      isFinalized: true,
      quickSelectTiles: [tile("t-5")],
      findingsText: "",
      recommendationText: "",
    });
  });

  it("mergeField refuses a tile source instead of saying nothing", () => {
    // `mergeField` returned void, so no caller could ever learn a tile was
    // refused. Its unsigned behaviour is covered by
    // finalizedMutationBoundary.hardening.test.ts; this pins the return contract.
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-select")).toBe("refused");
    expect(useWorkspace.getState().recommendationText).toBe("");
  });

  it("an unsigned merge still reports applied", () => {
    useWorkspace.setState({ isFinalized: false });
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-select")).toBe("applied");
    expect(useWorkspace.getState().recommendationText).toBe("Consider MRI.");
  });

  it("a duplicate insert is nothing-refused, not a rejection", () => {
    // The no-op early return fires when text and provenance are both unchanged.
    // Reporting that as a refusal would make the strip withhold credit for a tile
    // whose sentence is, in fact, in the report.
    useWorkspace.setState({ isFinalized: false });
    const st = useWorkspace.getState();
    st.mergeField("recommendation", "Consider MRI.", "quick-select");
    expect(useWorkspace.getState().mergeField("recommendation", "Consider MRI.", "quick-select")).toBe("applied");
  });
});

describe("the strip rewards a pick only when it landed", () => {
  // No DOM harness in this repo (`environment: "node"` repo-wide), so the
  // handler's ordering is pinned from source. Sliced between two of the
  // component's own props rather than a character budget, because a fixed-width
  // slice silently empties when a comment grows and every assertion on an empty
  // string then passes.
  const onPickBody = () => {
    const src = readFileSync(join(SRC, "quick-select-strip.tsx"), "utf8");
    const start = src.indexOf("onPick={() => {");
    expect(start, "quick-select-strip must still own an onPick handler").toBeGreaterThan(-1);
    const end = src.indexOf("onFav={() =>", start);
    expect(end, "the prop after onPick must still be onFav").toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it("both writers' results are consulted, not discarded", () => {
    const body = onPickBody();
    expect(body).toContain("? ws.applyPathologyOverlay(");
    expect(body).toContain(": ws.mergeField(");
    // Neither call may be a bare statement, which is how the refusal went unseen.
    expect(body).not.toMatch(/^\s*ws\.applyPathologyOverlay\(/m);
    expect(body).not.toMatch(/^\s*ws\.mergeField\(/m);
  });

  it("the guard precedes both the counter and the after-pick", () => {
    const body = onPickBody();
    const guard = body.indexOf('=== "refused"');
    const count = body.indexOf("incUsage(tile.id)");
    const after = body.indexOf("onAfterPick?.(field)");
    expect(guard, "the refusal guard must exist").toBeGreaterThan(-1);
    expect(count, "the counter must still be called").toBeGreaterThan(-1);
    expect(after, "the after-pick must still be called").toBeGreaterThan(-1);
    // Both, not just one: `onAfterPick` is `feedbackAfterAbnormalApply()` on the
    // findings strip and `void saveDraft({ silent: true })` on the impression and
    // recommendation strips, so a refused tile also fired a doomed save.
    expect(guard).toBeLessThan(count);
    expect(guard).toBeLessThan(after);
  });

  it("counts a pending pick, because that is a real use awaiting confirmation", () => {
    // Guards against the over-correction: gating on `=== "applied"` would drop
    // legitimate uses that went to the same-slot confirmation queue.
    expect(onPickBody()).toContain('if (result === "refused") return;');
    expect(onPickBody()).not.toContain('if (result !== "applied") return;');
  });
});

/**
 * Every render site must know about the lock.
 *
 * Scanned across all of `components`, not pinned to a known list of files, so a
 * new `<QuickSelectStrip>` added anywhere — or a new `<FindingsEditor>` that
 * leaves its strip visible — breaks this rather than silently joining the set of
 * controls that stay live on a signed report. That is how the strip became the
 * only clinical control #861 did not cover: it had no `disabled` prop to pass, so
 * no call site could express the lock even while a sibling two lines above it
 * did.
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

  /**
   * `findings-editor.tsx` opens with a docblock that names `<QuickSelectStrip
   * field="findings" />` in prose, complete with its own `/>`. Scanning raw text
   * counted it as a sixth render site, so comments are removed first. The count
   * assertion below is what turns that from a lucky guess into a checked one.
   */
  function codeOnly(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  function elements(src: string, tag: string): string[] {
    const out: string[] = [];
    let at = src.indexOf(tag);
    while (at !== -1) {
      const close = src.indexOf("/>", at);
      expect(close, `${tag} must still be closed`).toBeGreaterThan(at);
      out.push(src.slice(at, close));
      at = src.indexOf(tag, close + 2);
    }
    return out;
  }

  const strips: { file: string; el: string }[] = [];
  const editors: { file: string; el: string }[] = [];
  for (const file of walk(COMP)) {
    const src = codeOnly(readFileSync(file, "utf8"));
    for (const el of elements(src, "<QuickSelectStrip")) strips.push({ file, el });
    for (const el of elements(src, "<FindingsEditor")) editors.push({ file, el });
  }

  it("the scan found the render sites it claims to cover", () => {
    // Positive control. An empty `strips` array would make every assertion below
    // vacuously true, so the population is pinned first.
    expect(strips.length, "no <QuickSelectStrip> render site found — the scan is broken").toBe(5);
    // Three of the five FindingsEditor sites pass `hideQuickSelect`, so only two
    // can actually show a strip.
    const showing = editors.filter((e) => !/\bhideQuickSelect\b/.test(e.el));
    expect(editors.length, "the <FindingsEditor> population changed").toBe(5);
    expect(showing.length).toBe(2);
  });

  it("each direct strip render passes disabled", () => {
    for (const { file, el } of strips) {
      expect(
        /\bdisabled=\{/.test(el),
        `${file.split(/[\\/]/).pop()}: a <QuickSelectStrip> renders without disabled={} — `
        + "a tile that writes into the report stayed live on a signed report",
      ).toBe(true);
    }
  });

  it("each editor that can show its strip threads the composed lock to it", () => {
    for (const { file, el } of editors) {
      if (/\bhideQuickSelect\b/.test(el)) continue;
      expect(
        /quickSelectDisabled=\{contentLocked\}/.test(el),
        `${file.split(/[\\/]/).pop()}: a <FindingsEditor> leaves its strip visible without `
        + "quickSelectDisabled={contentLocked} — forwarding any other expression re-opens the gap",
      ).toBe(true);
    }
  });

  it("and the value they pass is the composed lock, not the session-only pair", () => {
    // #861's lesson, restated for the strip: `isFinalized` is a same-session fact
    // and `isLocked` is another user holding the lock, so neither knows about a
    // signature made on another workstation.
    //
    // Two shapes are legitimate and only two. A workspace component that already
    // has the composed predicate in scope passes `contentLocked`. The one wrapper
    // that renders a strip on behalf of its own caller forwards the prop it was
    // given, because it has no view-model to read — naming that file explicitly is
    // what keeps "accept a prop" from becoming a way to dodge the lock.
    const base = (p: string) => p.split(/[\\/]/).pop();
    for (const { file, el } of strips) {
      const m = el.match(/disabled=\{([^}]+)\}/);
      expect(m, `${base(file)}: <QuickSelectStrip> passes no disabled expression`).not.toBeNull();
      const expr = m![1].trim();
      expect(
        expr === "contentLocked" || expr === "quickSelectDisabled",
        `${base(file)}: disabled={${expr}} is not the composed lock`,
      ).toBe(true);
    }
    const forwarding = strips.filter((s) => /disabled=\{quickSelectDisabled\}/.test(s.el)).map((s) => base(s.file)).sort();
    expect(
      forwarding,
      "exactly one wrapper may forward the prop; every other render site must read contentLocked",
    ).toEqual(["findings-editor.tsx"]);
  });

  it("favouriting, adding and editing a tile are NOT disabled", () => {
    // They write the personal library, not the report. A signed report is no
    // reason to stop a radiologist reorganising their own tiles, and PR-24
    // started from a scoping decision that the tile mutators stay reachable — so
    // the display gate must not quietly widen past the pick.
    const src = readFileSync(join(COMP, "radiology", "zai-workspace", "quick-select-strip.tsx"), "utf8");
    const box = src.slice(src.indexOf("function QuickSelectTileBox"));
    expect(box).toContain("onClick={disabled ? undefined : onPick}");
    // Bounded on the handler's own markers rather than a list of spellings to
    // avoid: a list is only as complete as the person writing it, and "if
    // (disabled) return;" inserted above onFav() is exactly the shape that would
    // slip past one.
    const favRegion = box.slice(box.indexOf("onClick={(e) => {"), box.indexOf("onFav();"));
    expect(favRegion.replace(/\s+/g, " ").trim()).toBe("onClick={(e) => { e.stopPropagation();");
    const editRegion = box.slice(box.lastIndexOf("onClick={(e) => {"), box.indexOf("onEdit("));
    expect(editRegion.replace(/\s+/g, " ").trim()).toBe("onClick={(e) => { e.stopPropagation();");
    for (const forbidden of ["disabled ? undefined : onFav", "disabled ? undefined : onEdit"]) {
      expect(box, `the lock leaked into a library action: ${forbidden}`).not.toContain(forbidden);
    }
  });
});
