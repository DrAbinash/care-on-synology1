import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
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
