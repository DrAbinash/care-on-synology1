import { describe, expect, test, beforeEach } from "vitest";
import {
  loadReadingSession,
  toggleReadingSession,
  bumpSessionCompleted,
} from "./readingSession";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    },
  });
});

describe("readingSession", () => {
  test("defaults off", () => {
    expect(loadReadingSession().enabled).toBe(false);
  });

  test("toggle enables and bump increments", () => {
    const on = toggleReadingSession(loadReadingSession());
    expect(on.enabled).toBe(true);
    const bumped = bumpSessionCompleted(on);
    expect(bumped.completedInSession).toBe(1);
    expect(loadReadingSession().completedInSession).toBe(1);
  });
});
