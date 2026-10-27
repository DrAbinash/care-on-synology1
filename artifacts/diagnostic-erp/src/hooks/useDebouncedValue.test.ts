/**
 * useDebouncedValue.test.ts — behavior of the identity-keyed debounce
 * (few-clicks re-audit pass 3).
 *
 * THE DEFECT UNDER GUARD
 *   `useKeyedDebouncedValue`'s doc promises: on identity change the new
 *   value is adopted "immediately — no debounce window, no flush wait", so
 *   nothing downstream can pair one study's identity with another study's
 *   value. The implementation adopted in a useEffect: the commit that
 *   carried the NEW key still rendered the OLD value, so one committed
 *   render always paired study B's identity with study A's text. Any
 *   consumer that derives a cache/identity key in that render (the
 *   Section-9 preview's queryKey) minted a two-study mixture key — a
 *   guaranteed extra server round-trip per study switch, cached under a
 *   pairing that describes no real report.
 *
 * Adoption must happen DURING the render that first sees the new key
 * (React's adjust-state-on-prop-change pattern), so no committed render
 * ever mixes identities.
 *
 * Harness: same convention as useDraftPersistence.behavior.test.ts — no
 * jsdom; ReactDOM mounts a null-rendering probe and only the host root is
 * stubbed. Commits are observed via useEffect logs (effects run only for
 * committed renders, never for a render that React threw away and retried).
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyedDebouncedValue } from "./useDebouncedValue";

function hostContainer(): HTMLElement {
  const document = Object.assign(new EventTarget(), {
    nodeType: 9,
    activeElement: null,
    documentElement: null,
  });
  const window = Object.assign(new EventTarget(), {
    document,
    HTMLIFrameElement: class {},
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return Object.assign(new EventTarget(), {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
  }) as unknown as HTMLElement;
}

type Render = { key: string; value: string; committed: boolean };

function Probe({
  value,
  valueKey,
  onRender,
}: {
  value: string;
  valueKey: string;
  onRender: (r: Render) => void;
}) {
  const debounced = useKeyedDebouncedValue(value, valueKey, 350);
  // Effects run only on COMMITTED renders — a render React abandoned
  // (render-phase setState retry) never fires them. That is exactly the
  // signal we need: a committed (key, value) pairing.
  useEffect(() => {
    onRender({ key: valueKey, value: debounced, committed: true });
  });
  return null;
}

let root: Root | null = null;

function mount(initial: { value: string; valueKey: string }, log: Render[]) {
  const container = hostContainer();
  root = createRoot(container);
  let props = initial;
  const setProps = (next: typeof initial) => {
    props = next;
    rerender();
  };
  const rerender = () => {
    act(() => {
      root!.render(createElement(Probe, { ...props, onRender: (r) => log.push(r) }));
    });
  };
  rerender();
  return setProps;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useKeyedDebouncedValue — identity adoption", () => {
  it("adopts the new identity's value with NO committed two-study mixture", () => {
    const log: Render[] = [];
    const setProps = mount({ value: "study A findings", valueKey: "draft-1" }, log);

    // Switch studies: new identity AND new value arrive together (the draft
    // read resolves draftId and hydrated text in one batch).
    setProps({ value: "study B findings", valueKey: "draft-2" });

    const committed = log.filter((r) => r.committed);
    // The first committed render under draft-2 must already carry B's text —
    // not A's. A committed pairing (draft-2, study A findings) is the
    // mixture the queryKey would have minted into the cache.
    const firstB = committed.find((r) => r.key === "draft-2");
    expect(firstB).toBeDefined();
    expect(firstB!.value).toBe("study B findings");
    expect(committed.some((r) => r.key === "draft-2" && r.value === "study A findings")).toBe(
      false,
    );
  });

  it("still debounces value changes WITHIN one identity", () => {
    const log: Render[] = [];
    const setProps = mount({ value: "first", valueKey: "draft-1" }, log);

    setProps({ value: "second", valueKey: "draft-1" });
    // Not adopted yet — within the identity, the 350 ms settle window owns it.
    let committed = log.filter((r) => r.committed);
    let latest = committed[committed.length - 1];
    expect(latest.value).toBe("first");

    act(() => {
      vi.advanceTimersByTime(350);
    });
    committed = log.filter((r) => r.committed);
    latest = committed[committed.length - 1];
    expect(latest.value).toBe("second");
  });

  it("a value change raced with the identity change never leaks across", () => {
    const log: Render[] = [];
    const setProps = mount({ value: "A text", valueKey: "draft-1" }, log);
    // Identity switches first (draft read resolves), text still old...
    setProps({ value: "A text", valueKey: "draft-2" });
    // ...then hydration lands the new text in the same identity.
    setProps({ value: "B text", valueKey: "draft-2" });
    act(() => {
      vi.advanceTimersByTime(350);
    });

    const committed = log.filter((r) => r.committed);
    const bs = committed.filter((r) => r.key === "draft-2");
    expect(bs.length).toBeGreaterThan(0);
    // Every committed draft-2 render carries either the adopted A text
    // (identity-switch moment, value unchanged) or B text after the settle
    // — but the settled value must be B text.
    expect(bs[bs.length - 1].value).toBe("B text");
  });
});
